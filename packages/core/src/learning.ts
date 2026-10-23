import { z } from 'zod';
import { scopeId, hash, type NavigationGraph, type Transition } from './navigation.js';
import { scopeSchema, type Scope } from './contracts.js';
export const reviewerSchema=z.string().trim().min(1).max(200);
export const memoryCandidateSchema=z.object({id:z.string().uuid(),scope:scopeSchema,kind:z.enum(['navigation','business-rule','security']),transitionIds:z.array(z.string()).max(1000),changeSetId:z.string().uuid().nullable(),source:z.string().trim().min(1).max(2000),expectation:z.string().max(4000).nullable(),createdAt:z.number().int(),evidenceIds:z.array(z.string()).max(2000)}).strict();
export type MemoryCandidate=z.infer<typeof memoryCandidateSchema>;
export interface MemoryRevision {id:string;scopeId:string;kind:'approve'|'reject'|'rollback'|'expectation-approval';candidateIds:string[];reviewer:string;reason:string;createdAt:number;parentId:string|null;before:Record<string,Transition['status']>;after:Record<string,Transition['status']>;navigationApprovalId?:string;}
export interface ChangeSet {id:string;base:Scope;head:Scope;createdAt:number;reviewer:string;newStateIds:string[];missingStateIds:string[];changedTransitions:string[];newTransitionIds:string[];impactedScenarioIds:string[];}
export interface LearningRepository {
 compare(base:Scope,head:Scope,reviewer:string):ChangeSet;
 listChanges(scope:Scope):ChangeSet[];
 proposeNavigation(scope:Scope,transitionIds:string[],changeSetId:string|null,source:string):MemoryCandidate;
 proposeExpectation(scope:Scope,kind:'business-rule'|'security',expectation:string,source:string,reviewer:string):MemoryCandidate;
 listCandidates(scope:Scope):MemoryCandidate[];
 listRevisions(scope:Scope):MemoryRevision[];
 decide(scope:Scope,ids:string[],decision:'approve'|'reject',reviewer:string,reason:string):MemoryRevision;
 approveExpectation(scope:Scope,id:string,reviewer:string,authoritativeSource:string):MemoryRevision;
 rollback(scope:Scope,revisionId:string,reviewer:string,reason:string):MemoryRevision;
}
export function sameBuildFamily(base:Scope,head:Scope):boolean { const {build:baseBuild,...a}=scopeSchema.parse(base);const {build:headBuild,...b}=scopeSchema.parse(head);return baseBuild!==headBuild&&scopeId({...a,build:'comparison'})===scopeId({...b,build:'comparison'}); }
export function graphDifference(base:NavigationGraph,head:NavigationGraph) {
 if(!base.scope||!head.scope||!sameBuildFamily(base.scope.scope,head.scope.scope))throw new Error('Build comparison requires matching application/environment/role/tenant/flags scope and different builds');
 const fingerprints=(graph:NavigationGraph)=>new Set(graph.states.map(s=>s.observation.fingerprint));const a=fingerprints(base),b=fingerprints(head);
 const signature=(graph:NavigationGraph,t:Transition)=>hash([graph.states.find(s=>s.id===t.fromStateId)?.observation.fingerprint,t.action,graph.states.find(s=>s.id===t.toStateId)?.observation.fingerprint]);
 const old=new Set(base.transitions.map(t=>signature(base,t))),current=new Set(head.transitions.map(t=>signature(head,t)));
 return {newStateIds:head.states.filter(s=>!a.has(s.observation.fingerprint)).map(s=>s.id),missingStateIds:base.states.filter(s=>!b.has(s.observation.fingerprint)).map(s=>s.id),changedTransitions:base.transitions.filter(t=>!current.has(signature(base,t))).map(t=>t.id),newTransitionIds:head.transitions.filter(t=>!old.has(signature(head,t))).map(t=>t.id)};
}
