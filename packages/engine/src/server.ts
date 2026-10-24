import {createStudioServer,type StudioDependencies} from '../../studio/src/server.js';
import {createEngineApi} from './api.js';
import {EngineStore,contentHash,safeText} from './store.js';
import {Coordinator} from './coordinator.js';
import {TaskApi} from './tasks.js';
import {Knowledge} from './knowledge.js';
import {Reports} from './reports.js';
export function createEngine(home:string,roots:string[],authFile:string,options:Omit<StudioDependencies,'api'|'serveAssets'>={}){
 const store=new EngineStore(home),knowledge=new Knowledge(store);let tasks:TaskApi;let reports:Reports;let coordinator:Coordinator;
 const engine=createStudioServer(home,roots,{...options,serveAssets:false,engineMode:true,configureProject:(qa,projectId)=>{options.configureProject?.(qa,projectId);qa.planningMemory=story=>knowledge.retrieve(projectId,story,qa);qa.store.testing.permissionMemory=(_plan,request,scope)=>{const operation={kind:request.kind,roleId:request.roleId,url:request.url};const row=store.db.prepare('SELECT decision FROM engine_permission_memory WHERE project_id=? AND scope_hash=? AND operation_json=? AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(projectId,contentHash(scope),JSON.stringify(operation),Date.now()) as {decision:'allow'|'deny'}|undefined;return row?.decision??null;};
  const queue=(kind:'plan'|'execute',referenceId:string,selected?:string[])=>{
   const plan=kind==='execute'?qa.store.testing.getPlan(referenceId):null;
   if(kind==='execute'&&plan?.status!=='approved')throw new Error('Approved plan required');
   const story=qa.store.testing.getStory(plan?.storyRevisionId??referenceId);if(!story)throw new Error('Unknown story');
   const legacy=qa.store.testing.createJob(kind,referenceId);
   store.atomic(()=>{const task=store.createTask({projectId,title:story.title,context:story.context,markdown:story.markdown,sourceRef:story.sourceRef,storyId:story.id,status:'Queued',strategy:'intelligent'});if(plan)store.updateTask(task.id,{planId:plan.id});store.enqueue(task,kind,{legacyJobId:legacy.id,...(plan?{planId:plan.id}:{}),...(selected?{selected}:{} )});});coordinator.tick();return legacy;
  };
  qa.startPlanning=(storyId)=>queue('plan',storyId);qa.startExecution=(planId,selected)=>queue('execute',planId,selected);
  qa.startRevision=(planId,feedback)=>{const plan=qa.store.testing.getPlan(planId),story=plan?qa.store.testing.getStory(plan.storyRevisionId):null;if(!plan||!story)throw new Error('Unknown source plan');const legacy=qa.store.testing.createJob('plan',story.id);store.atomic(()=>{const task=store.createTask({projectId,title:story.title,context:story.context,markdown:story.markdown,sourceRef:story.sourceRef,storyId:story.id,status:'Queued',strategy:'intelligent'});store.updateTask(task.id,{planId:plan.id});store.enqueue(task,'plan',{legacyJobId:legacy.id,feedback:safeText(feedback)});});coordinator.tick();return legacy;};
  const cancel=qa.cancel.bind(qa);qa.cancel=(id)=>{const job=store.jobs(projectId).find(j=>j.payload.legacyJobId===id);if(job){coordinator.control(store.task(job.taskId,projectId),'cancel');return;}cancel(id);};
 },api:createEngineApi(authFile,async(req,res,context,principal)=>await reports.handle(req,res,context,principal)||await tasks.handle(req,res,context,principal))});
 coordinator=new Coordinator(store,engine.context,{global:Number(process.env.QASPIDER_WORKERS??3),perProject:Number(process.env.QASPIDER_PROJECT_WORKERS??2),leaseMs:30000,jobMs:Number(process.env.QASPIDER_JOB_TIMEOUT_MS??120000)});tasks=new TaskApi(store,coordinator);reports=new Reports(store,coordinator);coordinator.start();
 return {...engine,orchestration:store,coordinator,reports,async shutdown(){await coordinator.shutdown();await engine.shutdown();store.close();}};
}
