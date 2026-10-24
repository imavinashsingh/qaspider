import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {EngineContext} from '../../studio/src/server.js';
import {storyContextSchema,permissionDecisionInputSchema,policySchema,parseStory,httpUrlSchema} from '../../core/src/index.js';
import {authorize,type Principal} from './auth.js';
import {jsonBody,send} from './api.js';
import {EngineStore,contentHash,safeText} from './store.js';
import {Coordinator} from './coordinator.js';
const taskInput=z.object({markdown:z.string().min(1).max(32000),sourceRef:z.string().min(1).max(1000),context:storyContextSchema.extend({build:z.string().min(1).default('development')}),strategy:z.enum(['intelligent','deep']).default('intelligent'),explore:z.boolean().default(false),dependsOn:z.array(z.string().uuid()).max(20).default([])}).strict();
const keySchema=z.string().min(8).max(200);
const textSchema=z.string().trim().min(1).max(4000).refine(v=>safeText(v)===v,'Use credential references, not secret values');
export class TaskApi {
 constructor(readonly store:EngineStore,readonly coordinator:Coordinator){}
 async handle(request:IncomingMessage,response:ServerResponse,context:EngineContext,principal:Principal){
  const url=new URL(request.url??'/','http://engine');const match=/^\/api\/v1\/projects\/([a-f0-9-]{36})\/(tasks|task|task-jobs|task-job|task-events|task-control|task-execute|task-clarify|task-requests|task-approve|task-access|task-reconcile|task-replan|threads|thread|messages|thread-search|data-memory|permission-memory|permission-revoke|revalidate|revalidation-config|knowledge|changes|investigations)$/.exec(url.pathname);if(!match)return false;
  const projectId=z.string().uuid().parse(match[1]),operation=match[2]!,id=url.searchParams.get('id')??'';
  const action=request.method==='GET'?'read':['task-approve','task-access','permission-memory','permission-revoke','task-reconcile','revalidation-config'].includes(operation)?'review':operation==='revalidate'?'explore':operation==='task-execute'||operation==='task-control'?'execute':'plan';authorize(principal,projectId,action);
  if(request.method==='GET'){
   if(operation==='tasks')send(response,this.store.tasks(projectId).map(task=>({...task,jobs:this.store.jobs(projectId).filter(j=>j.taskId===task.id)})));
   else if(operation==='task')send(response,{...this.store.task(id,projectId),jobs:this.store.jobs(projectId).filter(j=>j.taskId===id),requests:this.store.requests(id,projectId)});
   else if(operation==='task-jobs')send(response,this.store.jobs(projectId));
   else if(operation==='task-job')send(response,this.store.job(id,projectId));
   else if(operation==='task-events')send(response,this.store.events(id,projectId,z.coerce.number().int().min(0).parse(url.searchParams.get('after')??0)));
   else if(operation==='task-requests')send(response,this.store.requests(id,projectId));
   else if(operation==='threads')send(response,this.store.db.prepare('SELECT id,title,archived,created_at FROM engine_threads WHERE project_id=? ORDER BY created_at DESC').all(projectId));
   else if(operation==='messages'){this.thread(id,projectId);send(response,this.store.db.prepare('SELECT id,role,text,task_id,created_at FROM engine_messages WHERE thread_id=? ORDER BY created_at,rowid').all(id));}
   else if(operation==='thread-search'){
    const terms=z.string().min(2).max(200).parse(url.searchParams.get('q')).match(/[\p{L}\p{N}]+/gu)??[];const query=terms.map(t=>'"'+t+'"').join(' OR ');send(response,query?this.store.db.prepare('SELECT message_id,thread_id,text FROM engine_message_search WHERE engine_message_search MATCH ? AND project_id=? UNION SELECT m.id,m.thread_id,m.text FROM engine_messages m JOIN engine_threads t ON t.id=m.thread_id LEFT JOIN engine_tasks k ON k.id=m.task_id WHERE t.project_id=? AND (t.title LIKE ? OR k.id LIKE ? OR k.title LIKE ? OR k.source_ref LIKE ?) LIMIT 50').all(query,projectId,projectId,...Array(4).fill('%'+url.searchParams.get('q')+'%')):[]);
   }else if(operation==='data-memory')send(response,this.store.db.prepare('SELECT id,reuse_key,guidance,references_json,actor,created_at FROM engine_data_memory WHERE project_id=?').all(projectId));
   else send(response,{error:'Unknown task resource'},404);return true;
  }
  if(request.method!=='POST'){send(response,{error:'Method not allowed'},405);return true;}
  const data=await jsonBody(request);
  if(operation==='tasks'){
   const v=z.object({commandKey:keySchema,tickets:z.array(taskInput).min(1).max(50)}).strict().parse(data);
   const backend=await context.project(projectId);
   // Validate all source contexts before the atomic intake; no work starts during validation.
   for(const ticket of v.tickets){if(ticket.explore)authorize(principal,projectId,'explore');for(const prerequisite of ticket.dependsOn)this.store.task(prerequisite,projectId);const env=backend.database.getEnvironment(ticket.context.environmentId);if(!env||env.applicationId!==ticket.context.applicationId||env.kind==='production'||ticket.context.roleIds.some(role=>backend.database.getRole(role)?.environmentId!==env.id))throw new Error('Invalid ticket context');}
   const prepared=v.tickets.map(input=>{let ready=false;try{parseStory(safeText(input.markdown),input.sourceRef);ready=true;}catch{}return {input,ready};});
   const result=this.store.command(projectId,v.commandKey,v,()=>prepared.map(({input,ready})=>{
    const markdown=safeText(input.markdown);const storyId=null;
    // Requirements live in the existing append-only workspace store. Incomplete intake stays explicit.
    const title=markdown.split('\n').find(l=>l.startsWith('# '))?.slice(2,202)??'QA ticket';
    const task=this.store.createTask({projectId,title,context:input.context,markdown,sourceRef:input.sourceRef,storyId,status:ready?'Queued':'Needs Clarification',strategy:input.strategy});
    for(const prerequisite of input.dependsOn)this.store.db.prepare('INSERT INTO engine_dependencies VALUES(?,?)').run(task.id,prerequisite);
    if(ready)this.store.enqueue(task,'plan',{allowExplore:input.explore});else this.store.request(task.id,'requirements','Provide source-backed acceptance criteria using an Acceptance Criteria section with AC identifiers.');return task;
   }));send(response,result,201);this.coordinator.tick();
  }else if(['task-control','task-execute','task-clarify','task-approve','task-access'].includes(operation)){
   if(operation==='task-control'){
    const v=z.object({taskId:z.string().uuid(),action:z.enum(['pause','resume','cancel']),commandKey:keySchema}).strict().parse(data);const task=this.store.task(v.taskId,projectId);
    const result=this.store.command(projectId,v.commandKey,v,()=>{if(v.action==='resume'){
      if(task.status!=='Paused')throw new Error('Only paused work can resume; unresolved effects need review');
      const previous=this.store.jobs(projectId).filter(j=>j.taskId===task.id).at(-1);if(!previous||previous.kind==='execute'&&previous.result?.runId)throw new Error('Interrupted execution requires review and a linked retest, not blind resume');
      this.store.updateTask(task.id,{status:'Queued'});return this.store.enqueue(task,previous.kind,previous.payload);
     }this.coordinator.control(task,v.action);return {status:v.action==='pause'?'Paused':'Cancelled'};});send(response,result);this.coordinator.tick();
   }else if(operation==='task-execute'){
    const v=z.object({taskId:z.string().uuid(),planRevisionId:z.string(),commandKey:keySchema}).strict().parse(data);const task=this.store.task(v.taskId,projectId),backend=await context.project(projectId),plan=backend.database.testing.getPlan(v.planRevisionId);
    if(!plan||(plan.storyRevisionId!==task.storyId&&!this.coordinator.knowledge.canReuse(task,plan.id,backend.viewer.application.qa))||plan.status!=='approved')throw new Error('Approved task plan required');
    const result=this.store.command(projectId,v.commandKey,v,()=>{if(this.store.jobs(projectId).some(j=>j.taskId===task.id&&['running','queued'].includes(j.status)))throw new Error('Task already has active work');this.store.updateTask(task.id,{planId:plan.id,status:'Queued'});this.store.db.prepare("UPDATE engine_requests SET status='resolved' WHERE task_id=? AND kind='plan-review' AND status='pending'").run(task.id);return this.store.enqueue({...task,planId:plan.id},'execute',{planId:plan.id,allowExplore:this.store.jobs(projectId).some(j=>j.taskId===task.id&&j.payload.allowExplore===true)});});send(response,result,202);this.coordinator.tick();
   }else if(operation==='task-clarify'){
    const v=z.object({taskId:z.string().uuid(),requestId:z.string().uuid(),answer:textSchema,reuseKey:z.string().trim().min(1).max(100).optional(),credentialReferences:z.record(z.string(),z.string().regex(/^[A-Z_][A-Z0-9_]*$/)).default({}),commandKey:keySchema}).strict().parse(data);
    const task=this.store.task(v.taskId,projectId);
    const result=this.store.command(projectId,v.commandKey,v,()=>{
     const pending=this.store.db.prepare("SELECT * FROM engine_requests WHERE id=? AND task_id=? AND status='pending'").get(v.requestId,task.id) as {kind:string}|undefined;if(!pending)throw new Error('Unknown pending request');if(pending.kind==='plan-review')throw new Error('Plan approval requires the authenticated human review operation');
     if(pending.kind==='requirements')parseStory(v.answer,task.sourceRef);
     this.store.db.prepare("UPDATE engine_requests SET status='answered',answer=? WHERE id=?").run(v.answer,v.requestId);
     if(v.reuseKey)this.store.db.prepare('INSERT INTO engine_data_memory VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),projectId,contentHash(task.context),v.reuseKey,v.answer,JSON.stringify(v.credentialReferences),principal.id,v.requestId,Date.now());
     // Preserve the original source. An answer is guidance, not authority to rewrite criteria or rerun a write.
     this.store.updateTask(task.id,{status:'Queued',...(pending.kind==='requirements'?{markdown:v.answer}:{})});this.store.enqueue(task,'plan',{inputRequestId:v.requestId,answeredBy:principal.id});return {taskId:task.id,status:'Answered',nextAction:'Planning queued using scoped guidance; new access or expected behavior still requires review.'};
    });send(response,result);this.coordinator.tick();
   }else if(operation==='task-approve'){
    const v=z.object({taskId:z.string().uuid(),planRevisionId:z.string(),planHash:z.string(),requirementIds:z.array(z.string()),decisions:z.array(permissionDecisionInputSchema),commandKey:keySchema}).strict().parse(data);
    const task=this.store.task(v.taskId,projectId),backend=await context.project(projectId),plan=backend.database.testing.getPlan(v.planRevisionId);if(!plan||plan.storyRevisionId!==task.storyId||plan.hash!==v.planHash)throw new Error('Changed task plan');
    send(response,this.store.command(projectId,v.commandKey,v,()=>backend.database.transaction(()=>{backend.database.testing.approvePlan(plan.id,principal.id,v.requirementIds);backend.database.testing.decidePermissions(plan.id,plan.hash,v.decisions,principal.id);this.store.updateTask(task.id,{planId:plan.id,status:'Queued'});this.store.db.prepare("UPDATE engine_requests SET status='resolved' WHERE task_id=? AND kind='plan-review' AND status='pending'").run(task.id);return {planId:plan.id,status:'approved'};})));
   }else{
    const v=z.object({taskId:z.string().uuid(),planRevisionId:z.string(),policy:policySchema}).strict().parse(data);const task=this.store.task(v.taskId,projectId),backend=await context.project(projectId),plan=backend.database.testing.getPlan(v.planRevisionId);if(!plan||plan.storyRevisionId!==task.storyId)throw new Error('Cross-task plan');const revised=backend.database.testing.configureAccess(plan.id,v.policy);this.store.updateTask(task.id,{planId:revised.id,status:'Needs Permission'});send(response,revised);
   }
  }else if(operation==='task-replan'){
   const v=z.object({taskId:z.string().uuid(),feedback:textSchema,commandKey:keySchema}).strict().parse(data),task=this.store.task(v.taskId,projectId);send(response,this.store.command(projectId,v.commandKey,v,()=>{if(this.store.jobs(projectId).some(j=>j.taskId===task.id&&['queued','running'].includes(j.status)))throw new Error('Task already active');this.store.updateTask(task.id,{status:'Queued'});return this.store.enqueue(task,'plan',{feedback:v.feedback,allowExplore:this.store.jobs(projectId).some(j=>j.taskId===task.id&&j.payload.allowExplore===true)});}),202);this.coordinator.tick();
  }else if(operation==='revalidate'){
   const v=z.object({taskId:z.string().uuid(),commandKey:keySchema}).strict().parse(data),task=this.store.task(v.taskId,projectId);send(response,this.store.command(projectId,v.commandKey,v,()=>this.store.enqueue(task,'plan',{revalidateOnly:true,previousStatus:task.status,allowExplore:true})),202);this.coordinator.tick();
  }else if(operation==='revalidation-config'){
   const v=z.object({taskId:z.string().uuid(),enabled:z.boolean(),intervalMs:z.number().int().min(3600000).max(604800000).default(86400000)}).strict().parse(data);this.store.task(v.taskId,projectId);this.store.db.prepare('INSERT INTO engine_revalidation_schedules VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(project_id,task_id) DO UPDATE SET enabled=excluded.enabled,interval_ms=excluded.interval_ms,next_at=excluded.next_at,actor=excluded.actor,updated_at=excluded.updated_at').run(randomUUID(),projectId,v.taskId,principal.id,Number(v.enabled),v.intervalMs,Date.now()+v.intervalMs,Date.now());send(response,{taskId:v.taskId,enabled:v.enabled});
  }else if(operation==='task-reconcile'){
   const v=z.object({taskId:z.string().uuid(),jobId:z.string().uuid(),notes:textSchema,confirm:z.literal(true),commandKey:keySchema}).strict().parse(data);const task=this.store.task(v.taskId,projectId),job=this.store.job(v.jobId,projectId);if(job.taskId!==task.id||!['blocked','paused'].includes(job.status))throw new Error('Only stopped scoped work can be reconciled');
   const journal=this.store.db.prepare('SELECT * FROM engine_operations WHERE job_id=? ORDER BY created_at DESC LIMIT 1').get(job.id) as {reference_id:string|null;state:string}|undefined;
   if(journal?.reference_id){const backend=await context.project(projectId);let report=backend.database.testing.report(journal.reference_id);if(!report)throw new Error('Execution evidence missing');if(report.run.status==='interrupted')report=await backend.viewer.application.qa.reconcileRun(report.run.id,principal.id,v.notes);if(report.run.status==='running'||report.fixtures.some(f=>f.status!=='cleaned'))throw new Error('Uncertain execution or fixture cleanup remains unresolved');}
   else if(journal&&journal.state!=='prepared')throw new Error('Operation outcome remains uncertain');
   send(response,this.store.command(projectId,v.commandKey,v,()=>{this.store.db.prepare("UPDATE engine_jobs SET status='cancelled',owner=NULL,lease_until=NULL,fence=fence+1 WHERE id=?").run(job.id);this.store.db.prepare('DELETE FROM engine_locks WHERE job_id=?').run(job.id);this.store.updateTask(task.id,{status:'Needs Permission'});this.store.event(job.id,'RECOVERY_REVIEWED',{actor:principal.id,notes:v.notes});return {jobId:job.id,status:'Reconciled',nextAction:'Review and submit a new execution explicitly.'};}));
  }else if(operation==='permission-memory'){
   const v=z.object({context:storyContextSchema,operation:z.object({kind:z.enum(['read','submit','fixture-setup','fixture-cleanup']),roleId:z.string(),url:httpUrlSchema}).strict(),decision:z.enum(['allow','deny']),expiresAt:z.number().int(),reason:textSchema,commandKey:keySchema}).strict().parse(data);
   if(v.expiresAt<=Date.now()||v.expiresAt>Date.now()+86400000)throw new Error('Permission lifetime must be within 24 hours');
   const backend=await context.project(projectId),environment=backend.database.getEnvironment(v.context.environmentId);
   if(!environment||environment.applicationId!==v.context.applicationId||environment.kind==='production'||!environment.allowedOrigins.includes(new URL(v.operation.url).origin)||!v.context.roleIds.includes(v.operation.roleId)||backend.database.getRole(v.operation.roleId)?.environmentId!==environment.id)throw new Error('Permission scope invalid');
   if(v.decision==='allow'&&v.operation.kind!=='read')throw new Error('Reusable allow is initially limited to exact read endpoints; consequential operations require fresh plan approval');
   send(response,this.store.command(projectId,v.commandKey,v,()=>{const id=randomUUID();const prior=this.store.db.prepare('SELECT id FROM engine_permission_memory WHERE project_id=? AND scope_hash=? AND operation_json=? AND revoked_at IS NULL').all(projectId,contentHash(v.context),JSON.stringify(v.operation)) as {id:string}[];for(const previous of prior){this.store.db.prepare('UPDATE engine_permission_memory SET revoked_at=? WHERE id=?').run(Date.now(),previous.id);this.store.db.prepare('INSERT INTO engine_permission_events VALUES(?,?,?,?,?,?)').run(randomUUID(),previous.id,principal.id,'supersede',v.reason,Date.now());}this.store.db.prepare('INSERT INTO engine_permission_memory VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,projectId,contentHash(v.context),JSON.stringify(v.operation),v.decision,principal.id,v.reason,1,v.expiresAt,null,Date.now());this.store.db.prepare('INSERT INTO engine_permission_events VALUES(?,?,?,?,?,?)').run(randomUUID(),id,principal.id,v.decision,v.reason,Date.now());return {id};}));
  }else if(operation==='permission-revoke'){
   const v=z.object({id:z.string().uuid(),reason:textSchema}).strict().parse(data);send(response,this.store.atomic(()=>{const item=this.store.db.prepare('SELECT id FROM engine_permission_memory WHERE id=? AND project_id=?').get(v.id,projectId);if(!item)throw new Error('Unknown permission');this.store.db.prepare('UPDATE engine_permission_memory SET revoked_at=? WHERE id=?').run(Date.now(),v.id);this.store.db.prepare('INSERT INTO engine_permission_events VALUES(?,?,?,?,?,?)').run(randomUUID(),v.id,principal.id,'revoke',v.reason,Date.now());return {id:v.id,status:'revoked'};}));
  }else if(operation==='thread'){
   const v=z.object({id:z.string().uuid(),title:textSchema.optional(),archived:z.boolean().optional()}).strict().parse(data);this.thread(v.id,projectId);this.store.db.prepare('UPDATE engine_threads SET title=coalesce(?,title),archived=coalesce(?,archived) WHERE id=? AND project_id=?').run(v.title??null,v.archived===undefined?null:Number(v.archived),v.id,projectId);send(response,{id:v.id});
  }else if(operation==='messages'){
   const v=z.object({threadId:z.string().uuid().optional(),text:textSchema,taskId:z.string().uuid().optional(),commandKey:keySchema}).strict().parse(data);
   if(v.threadId)this.thread(v.threadId,projectId);if(v.taskId)this.store.task(v.taskId,projectId);
   send(response,this.store.command(projectId,v.commandKey,v,()=>{const threadId=v.threadId??randomUUID();if(!v.threadId)this.store.db.prepare('INSERT INTO engine_threads VALUES(?,?,?,0,?)').run(threadId,projectId,v.text.slice(0,100),Date.now());const id=randomUUID();this.store.db.prepare("INSERT INTO engine_messages VALUES(?,?,'user',?,?,?)").run(id,threadId,v.text,v.taskId??null,Date.now());this.store.db.prepare('INSERT INTO engine_message_search VALUES(?,?,?,?)').run(id,threadId,projectId,v.text);return {threadId,messageId:id};}),201);
  }else send(response,{error:'Unknown task operation'},404);
  return true;
 }
 private thread(id:string,projectId:string){if(!this.store.db.prepare('SELECT 1 FROM engine_threads WHERE id=? AND project_id=?').get(id,projectId))throw new Error('Unknown project thread');}
}
