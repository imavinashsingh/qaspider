import {z} from 'zod';
import {hash,httpUrlSchema} from './navigation.js';
import type {PlanRevision,StoryContext} from './testing.js';
export const permissionDecisionInputSchema=z.object({permissionId:z.string().min(1).max(100),decision:z.enum(['allow','deny'])}).strict();
export type PermissionDecisionInput=z.infer<typeof permissionDecisionInputSchema>;
export const permissionRequirementSchema=z.object({
 id:z.string().regex(/^[a-f0-9]{64}$/),kind:z.enum(['submit','read','fixture-setup','fixture-cleanup']),name:z.string().min(1),reason:z.string().min(1),scenarioIds:z.array(z.string()).min(1),roleId:z.string().min(1),url:httpUrlSchema.nullable(),origin:z.string().nullable(),method:z.enum(['GET','POST']),changesData:z.boolean(),impact:z.string().min(1),cleanup:z.string().min(1),risk:z.enum(['low','high']),status:z.enum(['pending','allow','deny','unsupported'])
}).strict();
export type PermissionRequirement=z.infer<typeof permissionRequirementSchema>;
export interface PermissionDecision extends PermissionDecisionInput {id:string;planRevisionId:string;planHash:string;scope:StoryContext;reviewer:string;decidedAt:number;request:PermissionRequirement;}
export interface ExecutionAuthorization {planRevisionId:string;planHash:string;managed:boolean;requirements:PermissionRequirement[];decisions:PermissionDecision[];}
export type ProposedTestPlan=PlanRevision['proposal'];
export type ProposedScenario=ProposedTestPlan['scenarios'][number];
export type ApprovedExecutionPlan=PlanRevision & {status:'approved'};
/** Derivation is deterministic. Provider allowedActions are proposals, never authority. */
export function derivePermissions(plan:PlanRevision):PermissionRequirement[]{
 const requirements:PermissionRequirement[]=[];
 function add(kind:PermissionRequirement['kind'],roleId:string,url:string|null,scenarioId:string){
  if(url)httpUrlSchema.parse(url);
  const id=hash({kind,roleId,url});let item=requirements.find(r=>r.id===id);
  if(item){if(!item.scenarioIds.includes(scenarioId))item.scenarioIds.push(scenarioId);return;}
  const changesData=kind!=='read';
  const names={submit:'Submit test form',read:'Read assertion endpoint','fixture-setup':'Create owned test fixture','fixture-cleanup':'Cleanup owned test record'};
  item={id,kind,name:names[kind],reason:kind==='submit'?'Required by an explicit form submission step.':kind==='read'?'Required to verify the expected HTTP status.':kind==='fixture-setup'?'The duplicate-email case needs a pre-existing owned test account.':'Remove only records reserved by this test run.',scenarioIds:[scenarioId],roleId,url,origin:url?new URL(url).origin:null,method:changesData?'POST':'GET',changesData,impact:kind==='read'?'Reads application data.':kind==='fixture-cleanup'?'Deletes the owned fixture only.':kind==='fixture-setup'?'Creates a unique owned test account.':'May create or change application data; review the target endpoint.',cleanup:plan.policy.fixtures?'Owned fixtures cleaned through the configured endpoint.':'Not configured; inspect the scenario before authorizing.',risk:changesData?'high':'low',status:url?'pending':'unsupported'};requirements.push(item);
 }
 for(const s of plan.proposal.scenarios){
  for(const step of s.steps)if(step.kind==='click'&&step.submitUrl)add('submit',s.roleId,step.submitUrl,s.id);
  for(const assertion of s.assertions)if(assertion.kind==='http-status')add('read',s.roleId,assertion.url,s.id);
  if(s.data.some(d=>d.source.kind==='duplicate-email'))add('fixture-setup',s.roleId,plan.policy.fixtures?.setupUrl??null,s.id);
  if(s.data.some(d=>['unique-email','duplicate-email'].includes(d.source.kind)))add('fixture-cleanup',s.roleId,plan.policy.fixtures?.cleanupUrl??null,s.id);
 }
 return requirements.map(r=>permissionRequirementSchema.parse(r));
}
