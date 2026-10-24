import {randomUUID} from 'node:crypto';
import type {EngineContext} from '../../studio/src/server.js';
import {TestExecutor} from '../../qa/src/execution.js';
import type {EngineJob,EngineTask} from './store.js';
import {Knowledge} from './knowledge.js';
import {EngineStore,safeText} from './store.js';
export interface WorkerLimits {global:number;perProject:number;leaseMs:number;jobMs?:number;}
/** Deterministic scheduling and coordination; an LLM never owns leases or authorization. */
export class Coordinator {
 readonly owner=randomUUID();
 readonly knowledge:Knowledge;
 private pending=new Map<string,{controller:AbortController;work:Promise<void>}>();
 private timer:ReturnType<typeof setInterval>|undefined;
 private stopping=false;
 private reconciling=false;
 private requested=new Map<string,'pause'|'cancel'>();
 constructor(readonly store:EngineStore,private readonly context:EngineContext,readonly limits:WorkerLimits={global:3,perProject:2,leaseMs:30000}){
  this.knowledge=new Knowledge(store);
  if(!Number.isInteger(limits.global)||!Number.isInteger(limits.perProject)||limits.global<1||limits.perProject<1||limits.leaseMs<1000)throw new Error('Invalid worker limits');
  if(limits.jobMs!==undefined&&(!Number.isInteger(limits.jobMs)||limits.jobMs<1000||limits.jobMs>3600000))throw new Error('Invalid job time budget');
 }
 start(){this.store.recover();this.timer=setInterval(()=>this.tick(),250);this.timer.unref();this.tick();}
 tick(){if(this.stopping)return;this.store.recover();if(!this.reconciling){this.reconciling=true;void this.reconcileCompleted().finally(()=>{this.reconciling=false;});}for(const [id,pending]of this.pending){const job=this.store.jobs().find(j=>j.id===id);if(!job||job.status!=='running')pending.controller.abort();}
  if(!this.store.jobs().some(j=>j.status==='queued'||j.status==='running')){
   const due=this.store.db.prepare('SELECT * FROM engine_revalidation_schedules WHERE enabled=1 AND next_at<=? ORDER BY next_at LIMIT 1').get(Date.now()) as {id:string;project_id:string;task_id:string;interval_ms:number}|undefined;
   if(due)this.store.atomic(()=>{const task=this.store.task(due.task_id,due.project_id);this.store.enqueue(task,'plan',{revalidateOnly:true,previousStatus:task.status,allowExplore:true,background:true});this.store.db.prepare('UPDATE engine_revalidation_schedules SET next_at=? WHERE id=?').run(Date.now()+due.interval_ms,due.id);});
  }
  while(this.pending.size<this.limits.global){const job=this.store.claim(this.owner,this.limits.global,this.limits.perProject,this.limits.leaseMs);if(!job)break;const controller=new AbortController();const work=this.work(job,controller.signal).finally(()=>this.pending.delete(job.id));this.pending.set(job.id,{controller,work});}
 }
 private async work(job:EngineJob,inputSignal:AbortSignal){
  const signal=AbortSignal.any([inputSignal,AbortSignal.timeout(this.limits.jobMs??120000)]);
  const beat=setInterval(()=>{if(!this.store.heartbeat(job,this.limits.leaseMs))this.pending.get(job.id)?.controller.abort();},Math.max(250,Math.floor(this.limits.leaseMs/3)));
  try{
   const task=this.store.task(job.taskId,job.projectId),{viewer}=await this.context.project(job.projectId),qa=viewer.application.qa;
   if(!this.store.valid(job))return;this.store.updateTask(task.id,{status:job.kind==='plan'?'Planning':'Testing'});
   if(job.payload.revalidateOnly===true){
    const result=await this.knowledge.revalidate(task,qa,signal);this.store.finish(job,result.incomplete?'blocked':'complete',{...result,providerCalls:0},{status:result.incomplete?'Blocked':String(job.payload.previousStatus??'Ready for Review')});return;
   }
   if(job.kind==='plan'){
    if(!task.storyId){
     const sourceRef=task.sourceRef+'#qaspider-task:'+task.id;
     const story=qa.store.testing.listStories().find(s=>s.sourceRef===sourceRef)??qa.store.testing.importStory(task.markdown,sourceRef,task.context);
     this.store.updateTask(task.id,{storyId:story.id});task.storyId=story.id;
    }
    if(job.payload.allowExplore===true){this.store.event(job.id,'REVALIDATION_STARTED',{});await this.knowledge.revalidate(task,qa,signal);}
    const reused=this.knowledge.regression(task,qa);
    const plan=reused??await qa.plan(task.storyId,undefined,signal);signal.throwIfAborted();
    if(reused)this.store.event(job.id,'REGRESSION_REUSED',{planId:plan.id,providerCalls:0});
    if(this.store.finish(job,'complete',{planId:plan.id},{status:reused?'Queued':'Needs Permission',planId:plan.id})&&!reused)this.store.request(task.id,'plan-review','Review the proposed plan and approve its source expectations and required access.');
   }else{
    const planId=String(job.payload.planId??task.planId??''),plan=qa.store.testing.getPlan(planId);
    if(!plan||(plan.storyRevisionId!==task.storyId&&!this.knowledge.canReuse(task,plan.id,qa))||plan.status!=='approved')throw new Error('Exact task plan requires approval');
    const operationId=randomUUID();this.store.db.prepare("INSERT INTO engine_operations(id,job_id,kind,state,created_at) VALUES(?,?,'execute','prepared',?)").run(operationId,job.id,Date.now());
    const operational={riskOrder:true,target:(scope:import('../../core/src/index.js').Scope,id:string)=>this.knowledge.target(job.projectId,scope,id)};
    const report=await new TestExecutor(qa.store,qa.artifacts,undefined,process.env,operational).execute(plan.id,Array.isArray(job.payload.selected)?job.payload.selected as string[]:undefined,signal,(run,message)=>{
     if(!this.store.valid(job))throw new Error('Worker lease expired');
     this.store.atomic(()=>{this.store.db.prepare("UPDATE engine_operations SET state='executing',reference_id=? WHERE id=?").run(run.id,operationId);this.store.event(job.id,'WORKER_PROGRESS',{runId:run.id,message:safeText(message)});});
    });
    if(!this.store.valid(job))return;
    this.store.db.prepare("UPDATE engine_operations SET state='checkpointed',evidence_json=? WHERE id=?").run(JSON.stringify({runId:report.run.id,summary:report.summary}),operationId);
    if(report.results.some(r=>r.status!=='PASS')){
     this.store.updateTask(task.id,{status:'Investigating'});this.store.event(job.id,'INVESTIGATION_STARTED',{originalRunId:report.run.id});
     const safe=report.plan.proposal.scenarios.filter(s=>report.results.some(r=>r.scenarioId===s.id&&r.status!=='PASS')&&!s.data.length&&!s.steps.some(step=>step.kind==='fill'||step.kind==='click'&&step.submitUrl)).slice(0,3);
     let investigationRunId:string|null=null;
     if(safe.length&&!signal.aborted){if(job.payload.allowExplore===true)await this.knowledge.revalidate(task,qa,signal);const followup=await new TestExecutor(qa.store,qa.artifacts,undefined,process.env,operational).execute(plan.id,safe.map(s=>s.id),signal);investigationRunId=followup.run.id;}
     this.knowledge.investigate(task,report,investigationRunId);this.store.event(job.id,'FINDING_RECORDED',{originalRunId:report.run.id,investigationRunId});
    }
    const incomplete=report.run.status!=='complete'||report.summary.BLOCKED+report.summary.INCONCLUSIVE+report.summary['NOT RUN']>0;
    const hasDataBlocker=report.results.some(r=>r.attempts.some(a=>/fixture|test.data|credential|input/i.test(a.reason)&&a.status==='BLOCKED'));
    const cancelled=this.requested.get(job.id)==='cancel';
    const state=signal.aborted?(inputSignal.aborted?(cancelled?'Cancelled':'Paused'):'Blocked'):hasDataBlocker?'Needs Clarification':'Ready for Review';
    if(this.store.finish(job,signal.aborted?(inputSignal.aborted?(cancelled?'cancelled':'paused'):'blocked'):hasDataBlocker?'blocked':'complete',{runId:report.run.id,incomplete},{status:state})&&hasDataBlocker)this.store.request(task.id,'test-data','Provide the missing authorized test-data setup guidance or credential references shown in the run blockers. Values containing passwords, tokens or OTPs must not be submitted as ordinary answers.');
   }
  }catch(error){
   const reason=safeText(error instanceof Error?error.message:'Worker failed');
   if(this.store.valid(job)){const interrupted=inputSignal.aborted;const cancelled=this.requested.get(job.id)==='cancel';this.store.finish(job,interrupted?(cancelled?'cancelled':'paused'):'blocked',{reason},{status:interrupted?(cancelled?'Cancelled':'Paused'):'Blocked'});if(!interrupted)this.store.request(job.taskId,'blocked',reason);}
  }finally{clearInterval(beat);this.requested.delete(job.id);
   if(typeof job.payload.legacyJobId==='string'){
    try{const current=this.store.job(job.id,job.projectId),backend=await this.context.project(job.projectId);const status=current.status==='complete'?'complete':current.status==='cancelled'?'cancelled':current.status==='paused'?'interrupted':'failed';backend.database.testing.updateJob(job.payload.legacyJobId,status,'Engine '+current.status,typeof current.result?.runId==='string'?current.result.runId:typeof current.result?.planId==='string'?current.result.planId:undefined);}catch{/* Durable engine job remains canonical if legacy projection is unavailable. */}
   }
  }
 }
 private async reconcileCompleted(){
  for(const job of this.store.jobs().filter(j=>j.status==='blocked')){
   const journal=this.store.db.prepare('SELECT reference_id FROM engine_operations WHERE job_id=? ORDER BY created_at DESC LIMIT 1').get(job.id) as {reference_id:string|null}|undefined;
   if(!journal?.reference_id)continue;
   try{const backend=await this.context.project(job.projectId),report=backend.database.testing.report(journal.reference_id);if(report?.run.status!=='complete'||report.fixtures.some(f=>f.status!=='cleaned'))continue;
    this.store.atomic(()=>{const current=this.store.job(job.id,job.projectId);if(current.status!=='blocked'||current.fence!==job.fence)return;
     this.store.db.prepare("UPDATE engine_jobs SET status='complete',result_json=?,owner=NULL,lease_until=NULL WHERE id=?").run(JSON.stringify({runId:report.run.id,recovered:true,incomplete:report.summary.BLOCKED+report.summary.INCONCLUSIVE+report.summary['NOT RUN']>0}),job.id);this.store.updateTask(job.taskId,{status:'Ready for Review'});this.store.db.prepare('DELETE FROM engine_locks WHERE job_id=?').run(job.id);this.store.event(job.id,'RECOVERY_VERIFIED',{runId:report.run.id,source:'Persisted complete execution; no external action repeated'});
    });
   }catch{/* Missing/unavailable project or evidence leaves the job blocked. */}
  }
 }
 control(task:EngineTask,action:'pause'|'cancel'){
  this.store.atomic(()=>{for(const job of this.store.jobs(task.projectId).filter(j=>j.taskId===task.id&&['queued','running'].includes(j.status))){if(job.status==='running'){this.requested.set(job.id,action);this.pending.get(job.id)?.controller.abort();this.store.event(job.id,action==='pause'?'PAUSE_REQUESTED':'CANCEL_REQUESTED',{});}else{this.store.db.prepare('UPDATE engine_jobs SET status=? WHERE id=?').run(action==='pause'?'paused':'cancelled',job.id);this.store.event(job.id,'JOB_'+(action==='pause'?'PAUSED':'CANCELLED'),{});}}this.store.updateTask(task.id,{status:action==='pause'?'Paused':'Cancelled'});});
 }
 async shutdown(){this.stopping=true;if(this.timer)clearInterval(this.timer);for(const p of this.pending.values())p.controller.abort();await Promise.allSettled([...this.pending.values()].map(p=>p.work));}
}
