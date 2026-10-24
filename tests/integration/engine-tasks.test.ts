import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {StudioStore} from '../../packages/studio/src/store.js';import {ProjectRegistry} from '../../packages/studio/src/projects.js';
import {createEngine} from '../../packages/engine/src/server.js';
import {FakeProvider,type ProviderContext} from '../../packages/core/src/index.js';
class Planner extends FakeProvider{override async plan(context:ProviderContext){const c=JSON.parse(context.summary) as {story:{requirements:{id:string}[]}};const id=c.story.requirements[0]!.id;return {title:'Plan',feature:'Home',inferredRequirements:[],scenarios:[{id:'home',title:'Heading',roleId:'guest',requirementIds:[id],targetStateId:'missing-navigation',data:[],steps:[],assertions:[{id:'heading',kind:'visible',locator:{kind:'role',role:'heading',name:'Home'},expected:true,requirementId:id}],allowedActions:[],cleanup:'owned-fixtures',severity:'low',retries:0}]};}}
it('queues independent tickets, preserves idempotency, remembers scoped answers and keeps human authority separate',async()=>{
 const root=mkdtempSync(join(tmpdir(),'engine-tasks-')),home=join(root,'engine'),projects=join(root,'projects');mkdirSync(projects);const s=new StudioStore(home),p=new ProjectRegistry(s,[projects]).create({name:'Tasks',origin:'http://127.0.0.1:3000'});s.close();
 const token='tasks-private-agent-fixture-token-longer-than-32',file=join(root,'auth.json');writeFileSync(file,JSON.stringify([{id:'agent',kind:'agent',tokenHash:createHash('sha256').update(token).digest('hex'),projects:[p.id],actions:['read','plan','execute','review']}]),{mode:0o600});
 const engine=createEngine(home,[projects],file,{planningProvider:()=>new Planner()});await new Promise<void>(r=>engine.server.listen(0,'127.0.0.1',r));const address=engine.server.address();if(!address||typeof address==='string')throw new Error('Listener missing');const endpoint=`http://127.0.0.1:${address.port}`,base=endpoint+`/api/v1/projects/${p.id}/`;
 const request=async(path:string,body?:unknown,human=false)=>{const session=human?engine.auth.open(true):null;return fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(session?{cookie:`qaspider-studio-${address.port}=${session.token}`,origin:endpoint,'x-csrf-token':session.csrf}:{authorization:`Bearer ${token}`}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});};
 const context={applicationId:'benchmark',environmentId:'development',build:'b',tenant:'public',featureFlags:{},roleIds:['guest']};
 try{
  const batch={commandKey:'create-batch-1',tickets:[{markdown:'# Unclear',sourceRef:'ticket-1',context},{markdown:'# Home\n## Acceptance Criteria\n- AC-1: Home is visible.',sourceRef:'ticket-2',context}]};
  const created=await request('tasks',batch);expect(created.status).toBe(201);const tasks=await created.json() as {id:string;status:string}[];expect(tasks[0]!.status).toBe('Needs Clarification');
  expect(await (await request('tasks',batch)).json()).toEqual(tasks);
  expect((await request('tasks',{...batch,tickets:batch.tickets.slice(1)})).status).toBe(403);
  await expect.poll(async()=>{const task=await (await request('task?id='+tasks[1]!.id)).json() as {status:string};return task.status;}).toBe('Needs Permission');
  const ready=engine.orchestration.task(tasks[1]!.id,p.id);const job=engine.orchestration.jobs(p.id).find(j=>j.taskId===ready.id)!;expect(engine.orchestration.events(job.id,p.id).length).toBeGreaterThan(2);
  expect((await request('task-approve',{taskId:ready.id,planRevisionId:ready.planId,planHash:'wrong',requirementIds:[],decisions:[],commandKey:'approval-agent'})).status).toBe(403);
  const pending=engine.orchestration.requests(tasks[0]!.id,p.id) as {id:string}[];
  const answer={taskId:tasks[0]!.id,requestId:pending[0]!.id,answer:'# Login\n## Acceptance Criteria\n- AC-1: Login is visible.',reuseKey:'login-fixture',credentialReferences:{account:'QA_USER_ACCOUNT'},commandKey:'answer-once-1'};
  expect((await request('task-clarify',answer)).ok).toBe(true);expect((await request('task-clarify',answer)).ok).toBe(true);
  expect(engine.orchestration.db.prepare('SELECT count(*) AS n FROM engine_data_memory').get()).toEqual({n:1});
  const thread=await (await request('messages',{text:'Check these tickets',taskId:ready.id,commandKey:'thread-create'})).json() as {threadId:string};expect((await request('thread',{id:thread.threadId,archived:true})).ok).toBe(true);expect(engine.orchestration.task(ready.id,p.id).id).toBe(ready.id);
  expect((await request('messages',{text:'password=private-fixture',commandKey:'secret-rejected'})).status).toBe(403);
  const permission={context,operation:{kind:'read',roleId:'guest',url:'http://127.0.0.1:3000/health'},decision:'allow',expiresAt:Date.now()+60000,reason:'Authorized disposable benchmark read',commandKey:'grant-read-1'};
  const grant=await request('permission-memory',permission,true);expect(grant.ok).toBe(true);const grantId=(await grant.json() as {id:string}).id;expect((await request('permission-revoke',{id:grantId,reason:'Revoke fixture grant'},true)).ok).toBe(true);
 }finally{await engine.shutdown();rmSync(root,{recursive:true,force:true});}
});
