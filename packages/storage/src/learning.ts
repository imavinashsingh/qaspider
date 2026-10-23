import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { graphDifference, scopeId, memoryCandidateSchema, reviewerSchema, isSafeNavigation, type Scope, type LearningRepository, type MemoryCandidate, type MemoryRevision, type ChangeSet } from '../../core/src/index.js';
import type { SqliteNavigationRepository } from './navigation.js';
export class SqliteLearningRepository implements LearningRepository {
 constructor(private readonly db:Database.Database,private readonly navigation:SqliteNavigationRepository){}
 private atomic<T>(fn:()=>T):T{return this.db.transaction(fn).immediate();}
 private scoped(scope:Scope){const graph=this.navigation.snapshot(scope);if(!graph.scope)throw new Error('Unknown memory scope');return graph;}
 private rows<T>(table:'memory_change_sets'|'memory_candidates'|'memory_revisions',column:'head_scope_id'|'scope_id',scope:Scope):T[]{this.scoped(scope);return (this.db.prepare(`SELECT data_json FROM ${table} WHERE ${column}=? ORDER BY rowid`).all(scopeId(scope)) as {data_json:string}[]).map(r=>JSON.parse(r.data_json) as T);}
 listChanges(scope:Scope){return this.rows<ChangeSet>('memory_change_sets','head_scope_id',scope);}
 listCandidates(scope:Scope){return this.rows<MemoryCandidate>('memory_candidates','scope_id',scope);}
 listRevisions(scope:Scope){return this.rows<MemoryRevision>('memory_revisions','scope_id',scope);}
 compare(base:Scope,head:Scope,reviewer:string):ChangeSet {
  return this.atomic(()=>{reviewer=reviewerSchema.parse(reviewer);const a=this.scoped(base),b=this.scoped(head);const diff=graphDifference(a,b);
   const missing=new Set(diff.missingStateIds);const targets=new Set(a.transitions.filter(t=>diff.changedTransitions.includes(t.id)).flatMap(t=>[t.fromStateId,t.toStateId]));
   // Conservatively include downstream dependencies, even when their destination snapshot is unchanged.
   let expanded=true;while(expanded){expanded=false;for(const edge of a.transitions)if(targets.has(edge.fromStateId)&&!targets.has(edge.toStateId)){targets.add(edge.toStateId);expanded=true;}}
   // Exact source/build/role/tenant/flags filtering; observations never alter scenarios.
   const plans=this.db.prepare('SELECT p.proposal_json, s.context_json FROM plan_revisions p JOIN story_revisions s ON s.id=p.story_revision_id').all() as {proposal_json:string;context_json:string}[];
   const impactedScenarioIds=plans.flatMap(row=>{const context=JSON.parse(row.context_json) as {applicationId:string;environmentId:string;build:string;tenant:string;featureFlags:Record<string,boolean>;roleIds:string[]};const {roleIds,...rest}=context;if(!roleIds.includes(base.roleId)||scopeId({...rest,roleId:base.roleId})!==scopeId(base))return [];const proposal=JSON.parse(row.proposal_json) as {scenarios:{id:string;roleId:string;targetStateId:string}[]};return proposal.scenarios.filter(s=>s.roleId===base.roleId&&(missing.has(s.targetStateId)||targets.has(s.targetStateId))).map(s=>s.id);});
   const change:ChangeSet={id:randomUUID(),base,head,reviewer,createdAt:Date.now(),...diff,impactedScenarioIds:[...new Set(impactedScenarioIds)]};
   this.db.prepare('INSERT INTO memory_change_sets VALUES(?,?,?,?)').run(change.id,scopeId(base),scopeId(head),JSON.stringify(change));return change;});
 }
 private insert(candidate:MemoryCandidate){const parsed=memoryCandidateSchema.parse(candidate);this.db.prepare('INSERT INTO memory_candidates VALUES(?,?,?,?)').run(parsed.id,scopeId(parsed.scope),parsed.source,JSON.stringify(parsed));return parsed;}
 proposeNavigation(scope:Scope,transitionIds:string[],changeSetId:string|null,source:string){return this.atomic(()=>{
  const graph=this.scoped(scope);z.array(z.string()).min(1).max(1000).refine(ids=>new Set(ids).size===ids.length).parse(transitionIds);
  if(changeSetId&&!this.listChanges(scope).some(c=>c.id===changeSetId))throw new Error('Cross-scope or unknown change set');
  const edges=transitionIds.map(id=>graph.transitions.find(t=>t.id===id));if(edges.some(e=>!e))throw new Error('Unknown scoped transition');
  return this.insert({id:randomUUID(),scope,kind:'navigation',transitionIds,changeSetId,source,expectation:null,createdAt:Date.now(),evidenceIds:[...new Set(edges.flatMap(e=>e!.evidenceId?[e!.evidenceId]:[]))]});
 });}
 proposeExpectation(scope:Scope,kind:'business-rule'|'security',expectation:string,source:string,reviewer:string){this.scoped(scope);reviewerSchema.parse(reviewer);z.enum(['business-rule','security']).parse(kind);z.string().trim().min(1).max(4000).parse(expectation);return this.insert({id:randomUUID(),scope,kind,transitionIds:[],changeSetId:null,source,expectation,createdAt:Date.now(),evidenceIds:[]});}
 private pending(scope:Scope,ids:string[]){z.array(z.string()).min(1).max(1000).refine(a=>new Set(a).size===a.length).parse(ids);const all=this.listCandidates(scope),revisions=this.listRevisions(scope);return ids.map(id=>{const candidate=all.find(c=>c.id===id);if(!candidate||revisions.some(r=>r.candidateIds.includes(id)))throw new Error('Unknown, cross-scope or already decided candidate');return candidate;});}
 private revision(scope:Scope,input:Omit<MemoryRevision,'id'|'scopeId'|'createdAt'>){reviewerSchema.parse(input.reviewer);z.string().trim().min(1).max(2000).parse(input.reason);const value:MemoryRevision={...input,id:randomUUID(),scopeId:scopeId(scope),createdAt:Date.now()};this.db.prepare('INSERT INTO memory_revisions VALUES(?,?,?,?)').run(value.id,value.scopeId,value.parentId,JSON.stringify(value));return value;}
 decide(scope:Scope,ids:string[],decision:'approve'|'reject',reviewer:string,reason:string){return this.atomic(()=>{
  z.enum(['approve','reject']).parse(decision);const candidates=this.pending(scope,ids);if(candidates.some(c=>c.kind!=='navigation'))throw new Error('Expectation changes require individual authoritative approval');
  const graph=this.scoped(scope);const edgeIds=[...new Set(candidates.flatMap(c=>c.transitionIds))];const before:MemoryRevision['before']={},after:MemoryRevision['after']={};
  for(const id of edgeIds){const edge=graph.transitions.find(e=>e.id===id);if(!edge)throw new Error('Unknown scoped transition');before[id]=edge.status;after[id]=decision==='approve'?'approved':edge.status;}
  let navigationApprovalId:string|undefined;
  if(decision==='approve'){
   // Existing repository checks replay status, safe action and available scoped evidence atomically.
   navigationApprovalId=this.navigation.approveBatch(scope,edgeIds,reviewer).id;
  }
  return this.revision(scope,{kind:decision,candidateIds:ids,reviewer,reason,parentId:null,before,after,...(navigationApprovalId?{navigationApprovalId}:{})});
 });}
 approveExpectation(scope:Scope,id:string,reviewer:string,authoritativeSource:string){return this.atomic(()=>{const [candidate]=this.pending(scope,[id]);if(candidate?.kind==='navigation')throw new Error('Use navigation batch review');z.string().trim().min(1).max(2000).parse(authoritativeSource);if(candidate?.source!==authoritativeSource)throw new Error('Authoritative source must match proposal');return this.revision(scope,{kind:'expectation-approval',candidateIds:[id],reviewer,reason:authoritativeSource,parentId:null,before:{},after:{}});});}
 rollback(scope:Scope,revisionId:string,reviewer:string,reason:string){return this.atomic(()=>{
  const revisions=this.listRevisions(scope);const revision=revisions.find(r=>r.id===revisionId);if(!revision||revision.kind!=='approve'||revisions.some(r=>r.parentId===revisionId))throw new Error('Unknown or already rolled back navigation revision');
  if(revision.navigationApprovalId){const laterApprovals=this.db.prepare('SELECT transition_ids FROM navigation_approvals WHERE scope_id=? AND rowid>(SELECT rowid FROM navigation_approvals WHERE id=?)').all(scopeId(scope),revision.navigationApprovalId) as {transition_ids:string}[];if(laterApprovals.some(row=>(JSON.parse(row.transition_ids) as string[]).some(id=>id in revision.after)))throw new Error('Later navigation approval overlaps rollback; review required');}
  const later=revisions.slice(revisions.indexOf(revision)+1);if(later.some(r=>Object.keys(r.after).some(id=>id in revision.after)))throw new Error('Later navigation revision overlaps rollback; review required');
  const graph=this.scoped(scope);const before:MemoryRevision['before']={},after:MemoryRevision['after']={};
  for(const [id,status]of Object.entries(revision.before)){
   const edge=graph.transitions.find(e=>e.id===id);if(!edge||edge.status!==revision.after[id])throw new Error('Navigation changed since approval; review required');
   // Rollback only revokes new approval; it never revives a suspect edge.
   if(!isSafeNavigation(edge.action,this.environmentOrigins(scope),graph.scope!.config))throw new Error('Unsafe rollback');
   before[id]=edge.status;after[id]=status;
  }
  const rollback=this.revision(scope,{kind:'rollback',candidateIds:revision.candidateIds,reviewer,reason,parentId:revisionId,before,after});
  for(const[id,status]of Object.entries(after))this.db.prepare('UPDATE navigation_transitions SET status=? WHERE id=? AND scope_id=?').run(status,id,scopeId(scope));return rollback;
 });}
 private environmentOrigins(scope:Scope){const row=this.db.prepare('SELECT allowed_origins FROM environments WHERE id=?').get(scope.environmentId) as {allowed_origins:string};return JSON.parse(row.allowed_origins) as string[];}
}
