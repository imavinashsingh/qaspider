import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync,existsSync,chmodSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {SqliteStore} from '../dist/packages/storage/src/index.js';
import {createBenchmark} from '../dist/apps/benchmark/src/server.js';
const {values}=parseArgs({options:{workspace:{type:'string'},plan:{type:'string'}}});
assert(values.workspace&&values.plan,'Explicit --workspace and --plan required; benchmark plans only');
const workspace=resolve(values.workspace),database=join(workspace,'.qaspider/memory.db');
let store=new SqliteStore(database);const before=store.testing.getPlan(values.plan);assert(before,'Unknown plan');const story=store.testing.getStory(before.storyRevisionId);assert(story);assert.equal(before.proposal.scenarios.length,6,'This gate verifies all six approved M2 scenarios');store.close();
const root=resolve('.qaspider/m5-replay');mkdirSync(root,{recursive:true,mode:0o700});chmodSync(root,0o700);
const invoked=join(root,'provider-invoked');assert(!existsSync(invoked),'Remove/reconcile earlier provider invocation receipt');
const canary=join(root,'unavailable-provider');writeFileSync(canary,"#!/usr/bin/env node\nvoid import('node:fs').then(fs=>{fs.writeFileSync("+JSON.stringify(invoked)+",'invoked',{mode:0o600});process.exitCode=90;});\n",{mode:0o700});
const token=randomBytes(32).toString('hex');const server=createBenchmark(token);
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(4317,'127.0.0.1',resolve);});
try{
 const args=['dist/packages/cli/src/main.js','test','replay','--workspace',workspace,'--plan',values.plan,'--no-ai'];
 const started=Date.now();const child=spawn(process.execPath,args,{env:{...process.env,QASPIDER_CODEX_BIN:canary,BENCHMARK_FIXTURE_TOKEN:token,QASPIDER_ADMIN_EMAIL:'admin@example.test',QASPIDER_ADMIN_PASSWORD:'benchmark-password',QASPIDER_USER_EMAIL:'user@example.test',QASPIDER_USER_PASSWORD:'benchmark-password'},stdio:['ignore','pipe','pipe']});
 let output='',errors='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>errors+=b);const timer=setTimeout(()=>child.kill('SIGKILL'),60000);const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});clearTimeout(timer);
 writeFileSync(join(root,'private-report.json'),output,{mode:0o600});writeFileSync(join(root,'private-stderr.txt'),errors,{mode:0o600});assert.equal(code,0,'Replay process failed; inspect private receipts');const result=JSON.parse(output);
 assert.equal(result.providerUsed,false);assert.equal(result.summary.PASS,6);for(const [key,count] of Object.entries(result.summary))if(key!=='PASS')assert.equal(count,0);
 assert.equal(existsSync(invoked),false);store=new SqliteStore(database);try{assert.equal(store.testing.getPlan(before.id).hash,before.hash);assert.equal(store.testing.getStory(story.id).markdown,story.markdown);}finally{store.close();}
 const summary={status:'passed',checkedAt:new Date().toISOString(),durationMs:Date.now()-started,restartedProcess:true,selectedAllScenarios:true,planRevisionId:before.id,planHash:before.hash,planUnchanged:true,requirementsUnchanged:true,providerCanaryInvoked:false,providerUsed:false,runId:result.run.id,summary:result.summary,scenarios:result.results.map(r=>({scenarioId:r.scenarioId,status:r.status})),privateEvidenceDirectory:'.qaspider/m5-replay'};
 writeFileSync('validation/m5-full-suite-replay.json',JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
