import {randomUUID} from 'node:crypto';
import {NavigationEngine} from '../../navigation/src/engine.js';
import {navigationConfigSchema,scenarioScope,type Scope,type StoryRevision,type TestReport} from '../../core/src/index.js';
import type {QaService} from '../../qa/src/service.js';
import {EngineStore,contentHash,safeText,type EngineTask} from './store.js';
export class Knowledge {
 constructor(readonly store:EngineStore){}
 refresh(projectId:string,story:StoryRevision,qa:QaService){
  const scopeHash=contentHash(story.context),now=Date.now();
  this.store.atomic(()=>{
   this.store.db.prepare('DELETE FROM engine_knowledge_search WHERE project_id=? AND scope_hash=?').run(projectId,scopeHash);this.store.db.prepare('DELETE FROM engine_knowledge WHERE project_id=? AND scope_hash=?').run(projectId,scopeHash);
   const add=(kind:string,status:string,text:string,sourceRef:string,evidence:string[]=[],verifiedAt=now)=>{const id=contentHash({projectId,scopeHash,kind,text,sourceRef});text=safeText(text).slice(0,2000);this.store.db.prepare('INSERT OR IGNORE INTO engine_knowledge VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,projectId,scopeHash,kind,status,text,sourceRef,JSON.stringify(evidence),verifiedAt,verifiedAt+86400000);this.store.db.prepare('INSERT INTO engine_knowledge_search VALUES(?,?,?,?)').run(id,projectId,scopeHash,text);};
   for(const other of qa.store.testing.listStories().filter(s=>contentHash(s.context)===scopeHash))for(const req of other.requirements)add('requirement',req.approved?'approved':'provisional',req.text,req.sourceRef,[],now);
   for(const roleId of story.context.roleIds){const graph=qa.store.navigation.snapshot(scenarioScope(story.context,{roleId}));for(const state of graph.states){const evidence=qa.store.getArtifact(state.evidenceId);if(evidence?.status!=='available')continue;add('observation','verified',JSON.stringify({stateId:state.id,roleId,url:state.observation.url,headings:state.observation.headings,dialogs:state.observation.dialogs}),state.evidenceId,[state.evidenceId],evidence.createdAt);}}
   for(const plan of qa.store.testing.listPlans().filter(p=>p.status==='approved')){const original=qa.store.testing.getStory(plan.storyRevisionId);if(original&&contentHash(original.context)===scopeHash)add('workflow','approved',JSON.stringify({planId:plan.id,title:plan.proposal.title,scenarios:plan.proposal.scenarios.map(s=>({title:s.title,roleId:s.roleId,requirements:s.requirementIds}))}),plan.id,[],plan.createdAt);}
   const guidance=this.store.db.prepare('SELECT m.* FROM engine_data_memory m WHERE m.project_id=? AND m.scope_hash=? AND NOT EXISTS (SELECT 1 FROM engine_data_memory n WHERE n.project_id=m.project_id AND n.scope_hash=m.scope_hash AND n.reuse_key=m.reuse_key AND (n.created_at>m.created_at OR (n.created_at=m.created_at AND n.rowid>m.rowid))) ORDER BY m.created_at DESC LIMIT 30').all(projectId,scopeHash) as {guidance:string;reuse_key:string;references_json:string;source_request_id:string;created_at:number}[];
   const corrections=this.store.db.prepare("SELECT r.id,r.reason,r.created_at,t.context_json FROM engine_review_decisions r JOIN engine_tasks t ON t.id=r.task_id WHERE t.project_id=? AND r.decision='rejected-defect' ORDER BY r.created_at DESC LIMIT 30").all(projectId) as {id:string;reason:string;created_at:number;context_json:string}[];
   for(const correction of corrections)if(contentHash(JSON.parse(correction.context_json))===scopeHash)add('guidance','verified','Human diagnostic correction, not a business expectation: '+correction.reason,correction.id,[],correction.created_at);
   for(const row of guidance)add('guidance','provisional',JSON.stringify({key:row.reuse_key,guidance:row.guidance,credentialReferences:JSON.parse(row.references_json)}),row.source_request_id,[],row.created_at);
  });
 }
 retrieve(projectId:string,story:StoryRevision,qa:QaService){
  this.refresh(projectId,story,qa);const scopeHash=contentHash(story.context);const terms=(story.title+' '+story.requirements.map(r=>r.text).join(' ')).match(/[\p{L}\p{N}]{3,}/gu)?.slice(0,24)??[];
  const query=[...new Set(terms)].map(t=>'"'+t+'"').join(' OR ');
  const rows=query?this.store.db.prepare('SELECT k.* FROM engine_knowledge_search f JOIN engine_knowledge k ON k.id=f.entry_id WHERE engine_knowledge_search MATCH ? AND k.project_id=? AND k.scope_hash=? ORDER BY bm25(engine_knowledge_search) LIMIT 16').all(query,projectId,scopeHash):[];
  const guidance=this.store.db.prepare("SELECT * FROM engine_knowledge WHERE project_id=? AND scope_hash=? AND kind='guidance' ORDER BY verified_at DESC LIMIT 4").all(projectId,scopeHash);
  const unique=new Map<string,Record<string,unknown>>();let remaining=5000;
  for(const row of [...guidance,...rows] as Record<string,unknown>[]){if(unique.has(String(row.id)))continue;const text=String(row.text);if(text.length>remaining)continue;remaining-=text.length;unique.set(String(row.id),{id:row.id,kind:row.kind,status:row.status,sourceRef:row.source_ref,evidenceIds:JSON.parse(String(row.evidence_json)),stale:Number(row.expires_at)<Date.now(),text});}
  const strategy=this.store.tasks(projectId).find(t=>t.storyId===story.id)?.strategy??'intelligent';
  return {scopeHash,strategy,items:[...unique.values()],rules:'Approved requirements carry authority. Verified observations and setup guidance do not grant permission or define business expectations. Revalidate stale operations; hypotheses remain uncertain.'};
 }
 regression(task:EngineTask,qa:QaService){
  const story=task.storyId?qa.store.testing.getStory(task.storyId):undefined;if(!story)return null;
  const required=story.requirements.filter(r=>r.origin==='specified').map(r=>r.text).sort();if(!required.length)return null;
  for(const plan of qa.store.testing.listPlans().filter(p=>p.status==='approved'&&!qa.store.testing.listPlans().some(other=>other.planId===p.planId&&other.revision>p.revision))){
   if(this.store.db.prepare('SELECT 1 FROM engine_data_memory WHERE project_id=? AND scope_hash=? AND created_at>? LIMIT 1').get(task.projectId,contentHash(story.context),plan.createdAt))continue;
   const previous=qa.store.testing.getStory(plan.storyRevisionId);if(!previous||contentHash(previous.context)!==contentHash(story.context)||previous.requirements.some(r=>!r.approved)||contentHash(previous.requirements.filter(r=>r.origin==='specified').map(r=>r.text).sort())!==contentHash(required))continue;
   if(plan.proposal.scenarios.some(s=>s.requirementIds.some(id=>previous.requirements.find(r=>r.id===id)?.origin!=='specified')))continue;
   const successful=qa.store.testing.listRuns().some(run=>{if(run.planRevisionId!==plan.id||run.status!=='complete')return false;const report=qa.store.testing.report(run.id)!;return report.summary.PASS===plan.proposal.scenarios.length&&report.results.every(r=>r.attempts.flatMap(a=>a.evidenceIds).every(id=>qa.store.getArtifact(id)?.status==='available'));});if(!successful)continue;
   this.store.db.prepare('INSERT OR REPLACE INTO engine_regression_links VALUES(?,?,?,?,?)').run(task.id,story.id,plan.id,contentHash({context:story.context,requirements:required}),Date.now());return plan;
  }return null;
 }
 canReuse(task:EngineTask,planId:string,qa:QaService){const link=this.store.db.prepare('SELECT reused_plan_id FROM engine_regression_links WHERE task_id=? AND requested_story_id=?').get(task.id,task.storyId) as {reused_plan_id:string}|undefined;if(link?.reused_plan_id!==planId)return false;return this.regression(task,qa)?.id===planId;}
 async revalidate(task:EngineTask,qa:QaService,signal:AbortSignal){
  const revisions:string[]=[];let incomplete=false;let changed=false;
  for(const roleId of task.context.roleIds){signal.throwIfAborted();const scope=scenarioScope(task.context,{roleId}),before=qa.store.navigation.snapshot(scope),environment=qa.store.getEnvironment(scope.environmentId)!;const config=before.scope?.config??navigationConfigSchema.parse({});
   const run=await new NavigationEngine(qa.store,qa.artifacts).map(scope,before.scope?.seedUrl??environment.allowedOrigins[0]+'/',config,{depth:task.strategy==='deep'?3:2,maxStates:30,maxActions:100,maxRequests:500,maxMs:30000,intervalMs:100},signal);
   if(run.status!=='complete'){incomplete=true;
    this.store.db.prepare('INSERT INTO engine_observed_changes VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),task.id,'revalidation-blocked',JSON.stringify({scope}),JSON.stringify({status:run.status,message:run.message}),JSON.stringify(run.evidenceIds),'unknown',Date.now());this.store.request(task.id,'access','Safe revalidation could not complete: '+run.message+'. Provide the missing authorized setup or verification method; credentials must be references.');continue;
   }
   const graph=qa.store.navigation.snapshot(scope),verified=graph.transitions.filter(t=>t.status==='verified');let revisionId:string|null=null;
   if(verified.length){const candidate=qa.store.learning.proposeNavigation(scope,verified.map(t=>t.id),null,'Independent bounded navigation replay under engine operational policy v1');const revision=qa.store.learning.decide(scope,[candidate.id],'approve','engine-operational-policy-v1','Only safe independently replay-verified navigation; no business expectations changed');revisionId=revision.id;revisions.push(revision.id);}
   const added=graph.states.filter(s=>!before.states.some(old=>old.id===s.id));
   if(added.length){changed=true;this.store.updateTask(task.id,{status:'Ready for Review'});}
   if(added.length)this.store.db.prepare('INSERT INTO engine_observed_changes VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),task.id,'workflow-changed',JSON.stringify({stateIds:before.states.map(s=>s.id)}),JSON.stringify({stateIds:added.map(s=>s.id),operationalRevisionId:revisionId}),JSON.stringify(run.evidenceIds),'unknown',Date.now());
   for(const old of before.states){const candidates=added.filter(s=>s.observation.url===old.observation.url&&contentHash(s.observation.headings)===contentHash(old.observation.headings)&&contentHash(s.observation.dialogs)===contentHash(old.observation.dialogs));if(candidates.length!==1)continue;const current=candidates[0]!;this.store.db.prepare('INSERT INTO engine_operational_targets VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),task.projectId,contentHash(scope),old.id,current.id,revisionId,JSON.stringify(run.evidenceIds),Date.now());}
  }return {revisionIds:revisions,incomplete,changed};
 }
 target(projectId:string,scope:Scope,originalId:string){const row=this.store.db.prepare('SELECT current_state_id,revision_id,evidence_json FROM engine_operational_targets WHERE project_id=? AND scope_hash=? AND original_state_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(projectId,contentHash(scope),originalId) as {current_state_id:string;revision_id:string|null;evidence_json:string}|undefined;return row?{stateId:row.current_state_id,revisionId:row.revision_id,evidenceIds:JSON.parse(row.evidence_json) as string[]}:null;}
 investigate(task:EngineTask,report:TestReport,investigationRunId:string|null=null){
  for(const result of report.results.filter(r=>r.status!=='PASS')){
   const reasons=result.attempts.map(a=>a.reason).join(' ');const classification=result.status==='FLAKY'?'flaky-behavior':/fixture|credential|test.data/i.test(reasons)?'test-data-issue':/locator|navigation|state is unknown|entry state/i.test(reasons)?'automation-issue':/timeout|browser|network|environment/i.test(reasons)?'environment-issue':result.status==='FAIL'?'suspected-application-defect':'inconclusive';
   const evidenceIds=[...new Set(result.attempts.flatMap(a=>a.evidenceIds))];this.store.db.prepare('INSERT INTO engine_investigations VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),task.id,report.run.id,result.scenarioId,classification,result.status==='FAIL'&&result.attempts.length>1?'medium':'low',safeText(reasons||'No completed assertion evidence; outcome remains uncertain').slice(0,4000),JSON.stringify(evidenceIds),investigationRunId,Date.now());
  }
 }
}
