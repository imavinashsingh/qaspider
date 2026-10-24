import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {StudioStore} from '../../packages/studio/src/store.js';
import {ProjectRegistry} from '../../packages/studio/src/projects.js';
import {SqliteStore,ArtifactStore} from '../../packages/storage/src/index.js';
import {NavigationEngine} from '../../packages/navigation/src/engine.js';
import {navigationConfigSchema,type Scope} from '../../packages/core/src/index.js';
import {createEngine} from '../../packages/engine/src/server.js';
import {createStudioClient} from '../../packages/studio/src/client.js';
import {EngineClient} from '../../packages/bridge/src/client.js';
test.use({trace:'off'});
test('engine-only approved browser replay survives client disconnect and engine restart without AI',async({browser,baseURL},info)=>{
 test.setTimeout(60000);const root=info.outputPath('engine-root'),home=join(root,'engine'),projects=join(root,'projects');mkdirSync(projects,{recursive:true});
 const registryStore=new StudioStore(home),registry=new ProjectRegistry(registryStore,[projects]);const project=registry.create({name:'Browser proof',origin:baseURL!});registryStore.close();
 const dbPath=join(project.path,'.qaspider/memory.db');const store=new SqliteStore(dbPath);const artifacts=new ArtifactStore(store,join(project.path,'.qaspider/artifacts'));
 const scope:Scope={applicationId:'benchmark',environmentId:'development',roleId:'guest',build:'engine-proof',tenant:'public',featureFlags:{}};
 const mapped=await new NavigationEngine(store,artifacts,browser).map(scope,baseURL+'/',navigationConfigSchema.parse({}),{depth:0,intervalMs:0});expect(mapped.status,mapped.message).toBe('complete');const state=store.navigation.snapshot(scope).states.find(s=>s.observation.headings.includes('QASpider benchmark'))!;
 const story=store.testing.importStory('# Home\n## Acceptance Criteria\n- AC-1: QASpider benchmark heading is visible.','owned-benchmark', {applicationId:scope.applicationId,environmentId:scope.environmentId,build:scope.build,tenant:scope.tenant,featureFlags:scope.featureFlags,roleIds:['guest']});
 const req=story.requirements[0]!;
 const plan=store.testing.savePlan(story.id,{title:'Home',feature:'Home',inferredRequirements:[],scenarios:[{id:'home',title:'Home heading',roleId:'guest',requirementIds:[req.id],targetStateId:state.id,data:[],steps:[],assertions:[{id:'heading',requirementId:req.id,kind:'visible',locator:{kind:'role',role:'heading',name:'QASpider benchmark'},expected:true}],allowedActions:[],cleanup:'owned-fixtures',severity:'low',retries:0}]},{actionGrants:[],readGrants:[],fixtures:null,discovery:false},{id:'synthetic-fixture',synthetic:true,validationId:null});store.testing.approvePlan(plan.id,'fixture-owner',[req.id]);store.close();
 const token='engine-browser-proof-private-fixture-token',authFile=join(root,'auth.json');writeFileSync(authFile,JSON.stringify([{id:'tool',kind:'agent',tokenHash:createHash('sha256').update(token).digest('hex'),projects:[project.id],actions:['read','plan','execute']}]),{mode:0o600});
 let engine=createEngine(home,[projects],authFile,{planningProvider:()=>{throw new Error('No AI allowed');}});await new Promise<void>(r=>engine.server.listen(0,'127.0.0.1',r));let address=engine.server.address();if(!address||typeof address==='string')throw new Error('No listener');
 try{
  const client=new EngineClient({endpoint:`http://127.0.0.1:${address.port}`,token,projectId:project.id});const job=await client.request('execute',{planRevisionId:plan.id}) as {id:string};
  await expect.poll(async()=>(await client.request('job?id='+job.id) as {status:string}).status,{timeout:30000}).toBe('complete');
  const completed=await client.request('job?id='+job.id) as {resultId:string};const report=await client.request('report?id='+completed.resultId) as {summary:{PASS:number}};expect(report.summary.PASS).toBe(1);
  await engine.auth.setup(engine.auth.open(),'synthetic-engine-browser-password');engine.registry.select(project.id);const session=engine.auth.open(true);const web=createStudioClient(`http://127.0.0.1:${address.port}`);await new Promise<void>(r=>web.listen(0,'127.0.0.1',r));const webAddress=web.address();if(!webAddress||typeof webAddress==='string')throw new Error('No Studio');const page=await browser.newPage();
  try{await page.context().addCookies([{name:`qaspider-studio-${address.port}`,value:session.token,domain:'127.0.0.1',path:'/',httpOnly:true,sameSite:'Strict'}]);const opened=await page.goto(`http://127.0.0.1:${webAddress.port}`);expect(opened?.ok()).toBe(true);await page.getByRole('button',{name:'CLI & MCP',exact:true}).click({timeout:10000});await expect(page.getByRole('heading',{name:'Engine MCP bridge',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Enable MCP',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'CLI commands',exact:true})).toHaveCount(0);await expect(page.getByLabel('Host MCP configuration template')).toHaveValue(/QASPIDER_ENGINE_CONNECTION_FILE/);}finally{await page.close();web.closeAllConnections();await new Promise<void>(r=>web.close(()=>r()));}
  await engine.shutdown();engine=createEngine(home,[projects],authFile,{planningProvider:()=>{throw new Error('No AI allowed');}});await new Promise<void>(r=>engine.server.listen(0,'127.0.0.1',r));address=engine.server.address();if(!address||typeof address==='string')throw new Error('No listener');const next=new EngineClient({endpoint:`http://127.0.0.1:${address.port}`,token,projectId:project.id});
  expect((await next.request('report?id='+completed.resultId) as {summary:{PASS:number}}).summary.PASS).toBe(1);expect((await next.request('jobs') as unknown[]).length).toBe(1);
  const tasks=await next.request('tasks',{commandKey:'known-regression-after-restart',tickets:[{markdown:story.markdown,sourceRef:'new-ticket',context:story.context}]}) as {id:string}[];
  await expect.poll(async()=>((await next.request('task?id='+tasks[0]!.id)) as {planId:string|null}).planId).toBe(plan.id);
  const reused=await next.request('task?id='+tasks[0]!.id) as {jobs:{id:string;status:string}[]};expect(JSON.stringify(await next.request('task-events?id='+reused.jobs[0]!.id))).toContain('REGRESSION_REUSED');
  const replay=await next.request('task-execute',{taskId:tasks[0]!.id,planRevisionId:plan.id,commandKey:'known-regression-execute'}) as {id:string};
  await expect.poll(async()=>((await next.request('task-job?id='+replay.id)) as {status:string}).status).toBe('complete');
  const replayed=await next.request('task-job?id='+replay.id) as {result:{runId:string}};expect((await next.request('report?id='+replayed.result.runId) as {summary:{PASS:number}}).summary.PASS).toBe(1);

 }finally{await engine.shutdown();}
});
