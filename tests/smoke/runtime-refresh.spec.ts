import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {FakeProvider,navigationConfigSchema,type ProviderContext,type PlanProposal} from '../../packages/core/src/index.js';
import {SqliteStore,ArtifactStore} from '../../packages/storage/src/index.js';
import {runCli} from '../../packages/cli/src/cli.js';
import {NavigationEngine} from '../../packages/navigation/src/engine.js';
import {QaService} from '../../packages/qa/src/service.js';
import {createGraphServer} from '../../packages/navigation/src/viewer.js';
test.use({trace:'off'});
test('persisted planning and execution activities reopen after browser refresh; new drafts clear prior data',async({browser,baseURL},info)=>{
 test.setTimeout(60000);
 const workspace=info.outputPath('workspace');mkdirSync(workspace,{recursive:true,mode:0o700});
 runCli(['init','--workspace',workspace,'--origin',baseURL!],()=>{},{});
 const store=new SqliteStore(join(workspace,'.qaspider/memory.db'));
 const artifacts=new ArtifactStore(store,join(workspace,'.qaspider/artifacts'));
 const scope={applicationId:'benchmark',environmentId:'development',roleId:'guest',build:'refresh',tenant:'public',featureFlags:{}};
 await new NavigationEngine(store,artifacts,browser).map(scope,baseURL+'/',navigationConfigSchema.parse({}),{depth:1,intervalMs:0});
 const graph=store.navigation.snapshot(scope);store.navigation.approveBatch(scope,graph.transitions.filter(t=>t.status==='verified').map(t=>t.id),'explicit-test-owner');
 let release:(()=>void)|undefined;const pending=new Promise<void>(resolve=>{release=resolve;});let calls=0;
 class Planner extends FakeProvider{
  override async plan(context:ProviderContext):Promise<PlanProposal>{calls++;await pending;
   const data=JSON.parse(context.summary) as {story:{requirements:{id:string}[]}};
   const requirementId=data.story.requirements[0]!.id;
   return{title:'Explicit synthetic refresh fixture',feature:'Home',inferredRequirements:[],scenarios:[{id:'heading',title:'Home heading',roleId:'guest',requirementIds:[requirementId],targetStateId:graph.states.find(s=>s.observation.headings.includes('QASpider benchmark'))!.id,data:[],steps:[],assertions:[{id:'heading-visible',requirementId,kind:'visible',locator:{kind:'role',role:'heading',name:'QASpider benchmark'},expected:true}],allowedActions:[],cleanup:'owned-fixtures',severity:'low',retries:0}]};
  }
 }
 const qa=new QaService(store,artifacts,new Planner(),browser);
 const viewer=createGraphServer(store,artifacts,qa);await new Promise<void>(resolve=>viewer.server.listen(0,'127.0.0.1',resolve));
 const address=viewer.server.address();if(!address||typeof address==='string')throw new Error('No viewer');
 const page=await browser.newPage();
 try{
  await page.goto(`http://127.0.0.1:${address.port}/#token=${viewer.token}`);
  await page.getByRole('button',{name:'Test Studio',exact:true}).click();
  await page.getByLabel('Markdown story',{exact:true}).fill('# Home\n## Acceptance Criteria\n- AC-1: QASpider benchmark heading is visible.');
  await page.getByLabel('Source reference',{exact:true}).fill('synthetic-refresh.md');
  await page.getByRole('button',{name:'Generate Test Plan',exact:true}).click();
  await expect(page.getByLabel('Job progress')).toContainText('plan · running');
  await page.reload();await page.getByRole('button',{name:'Test Studio',exact:true}).click();
  await expect(page.getByLabel('Job progress')).toContainText('plan · running');
  release!();await expect(page.getByLabel('Scenario title heading',{exact:true})).toBeVisible();
  await page.locator('.criterion input').check();await page.getByRole('button',{name:'Approve displayed plan and selected requirements',exact:true}).click();
  await page.getByRole('button',{name:'Execute approved plan without AI',exact:true}).click();
  await expect(page.getByTestId('test-report')).toContainText('PASS: 1');
  const originalRun=store.testing.listRuns()[0]!.id;
  await page.reload();await page.getByRole('button',{name:'Test Studio',exact:true}).click();
  await page.getByText('Persisted activity · resume work after refresh',{exact:true}).click();
  await page.getByRole('button',{name:/^Open execute activity/}).first().click();
  await expect(page.getByTestId('test-report')).toContainText('PASS: 1');
  await page.getByRole('button',{name:'Replay selected scenarios without AI',exact:true}).click();
  await expect.poll(()=>store.testing.listRuns().length).toBe(2);
  await expect.poll(()=>store.testing.listRuns()[0]!.status).toBe('complete');expect(calls).toBe(1);
  expect(store.testing.listRuns()[0]!.id).not.toBe(originalRun);
  await page.getByRole('button',{name:'1. Describe',exact:true}).click();
  await page.getByText('Saved stories and plans',{exact:true}).click();
  await page.getByLabel('Stored story',{exact:true}).selectOption(store.testing.listStories()[0]!.id);
  await expect(page.getByLabel('Markdown story',{exact:true})).toHaveValue(/# Home/);
  await page.getByLabel('Stored story',{exact:true}).selectOption('');
  await expect(page.getByLabel('Markdown story',{exact:true})).toHaveValue('');
  await expect(page.getByLabel('Source reference',{exact:true})).toHaveValue('story.md');
  await expect(page.getByTestId('test-report')).toHaveCount(0);
 }finally{release?.();await delay(10);await page.close();await viewer.shutdown();viewer.server.closeAllConnections();if(viewer.server.listening)await new Promise<void>(resolve=>viewer.server.close(()=>resolve()));store.close();}
});
