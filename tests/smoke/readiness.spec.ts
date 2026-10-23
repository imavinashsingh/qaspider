import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {runCli} from '../../packages/cli/src/cli.js';
import {SqliteStore,ArtifactStore} from '../../packages/storage/src/index.js';
import {NavigationEngine} from '../../packages/navigation/src/engine.js';
import {navigationConfigSchema,type Scope} from '../../packages/core/src/index.js';
test.use({trace:'off'});
test('measures fresh discovery versus approved persistent replay with identical destination checks',async({browser,baseURL,request},info)=>{
 test.setTimeout(90000);
 await request.post('/__fixtures/reset',{headers:{'x-fixture-token':'smoke-fixture-token'}});
 const samples=[];
 for(let sample=0;sample<3;sample++){
  const workspace=info.outputPath(`sample-${sample}`);mkdirSync(workspace,{recursive:true});runCli(['init','--workspace',workspace,'--origin',baseURL!],()=>{},{});
  const scope:Scope={applicationId:'benchmark',environmentId:'development',roleId:'guest',build:'m5-benchmark',tenant:'public',featureFlags:{}};
  const store=new SqliteStore(join(workspace,'.qaspider/memory.db'));
  try{
   const start=performance.now();const discovery=await new NavigationEngine(store,new ArtifactStore(store,join(workspace,'.qaspider/artifacts')),browser).map(scope,`${baseURL}/`,navigationConfigSchema.parse({}),{depth:1,intervalMs:0});const discoveryMs=performance.now()-start;
   expect(discovery.status).toBe('complete');const graph=store.navigation.snapshot(scope);const from=graph.states.find(s=>s.observation.url===`${baseURL}/`)!;const to=graph.states.find(s=>s.observation.headings.includes('Registration'))!;expect(to).toBeDefined();
   store.navigation.approveBatch(scope,graph.transitions.filter(t=>t.status==='verified').map(t=>t.id),'explicit-benchmark-reviewer');
   const started=performance.now();const replay=JSON.parse(execFileSync(process.execPath,['dist/packages/cli/src/main.js','replay','--workspace',workspace,'--role','guest','--build',scope.build,'--from',from.id,'--to',to.id,'--interval','0','--no-ai'],{encoding:'utf8',env:{...process.env,QASPIDER_CODEX_BIN:'/unavailable-provider'}}));const replayMs=performance.now()-started;
   expect(replay.status).toBe('complete');expect(replay.providerUsed).toBe(false);expect(replay.actions).toBeLessThan(discovery.actions);expect(replay.requests).toBeLessThan(discovery.requests);
   samples.push({sample,discoveryMs,replayMs,discoveryActions:discovery.actions,replayActions:replay.actions,discoveryRequests:discovery.requests,replayRequests:replay.requests,states:graph.states.length,transitions:graph.transitions.length,from:from.id,to:to.id,replayRunId:replay.id,providerUsed:false});
  }finally{store.close();}
 }
 writeFileSync(info.outputPath('m5-benchmark.json'),JSON.stringify({method:'3 independent fresh workspaces; depth 1 guest discovery; approved path to Registration replayed in a new CLI process. Discovery shares harness browser; replay includes process/browser startup. No latency claim asserted.',samples},null,2));
});
