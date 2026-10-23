import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {CodexPlanningAdapter} from '../dist/packages/providers/src/codex.js';
import {ProviderEvidence} from '../dist/packages/providers/src/evidence.js';
import {SqliteStore,ArtifactStore} from '../dist/packages/storage/src/index.js';
import {QaService} from '../dist/packages/qa/src/service.js';
import {FakeProvider,navigationConfigSchema,normalizeObservation} from '../dist/packages/core/src/index.js';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const validation=await new CodexPlanningAdapter().validateIsolation(undefined,resolve('.qaspider/provider-validation'));
assert(validation.evidence,'Synthetic receipts missing');const root=validation.evidence.directory;
const read=name=>JSON.parse(readFileSync(join(root,name),'utf8'));
const timeout=read('process-timeout.json'),cancel=read('process-cancellation.json');
assert.equal(timeout.terminationRequested,'Codex planning timed out');assert.equal(cancel.terminationRequested,'Codex planning cancelled');
for(const process of [timeout,cancel]){assert.equal(process.signal,'SIGKILL');assert(process.pid);let alive=false;try{globalThis.process.kill(process.pid,0);alive=true;}catch(error){assert.equal(error.code,'ESRCH');}assert.equal(alive,false,'Probe subprocess survived termination');}
const wires=validation.evidence.receipts.filter(r=>r.name.startsWith('wire-'));assert(wires.length>=1);
for(const wire of wires)assert.equal((read(wire.name).body.tools??[]).length,0);
const store=new SqliteStore(':memory:');let captured;
const canaries={FIXTURE_TOKEN:'SYNTHETIC_FIXTURE_SECRET',ADMIN_EMAIL:'admin@synthetic.invalid',ADMIN_PASSWORD:'SYNTHETIC_ADMIN_SECRET',USER_EMAIL:'user@synthetic.invalid',USER_PASSWORD:'SYNTHETIC_USER_SECRET'};
const rawArtifactCanary='SYNTHETIC_RAW_ARTIFACT_NOT_PROVIDER_CONTEXT';
try{
 store.createApplication({id:'synthetic',name:'Synthetic context check'});store.createEnvironment({id:'qa',applicationId:'synthetic',name:'QA',kind:'qa',allowedOrigins:['http://127.0.0.1:3000']});
 const config=navigationConfigSchema.parse({});const context={applicationId:'synthetic',environmentId:'qa',roleIds:['guest','admin','user'],build:'synthetic',tenant:'public',featureFlags:{}};
 const artifacts=new ArtifactStore(store,join(root,'synthetic-artifacts'));let target;
 for(const roleId of context.roleIds){store.createRole({id:roleId,environmentId:'qa',name:roleId,auth:roleId==='guest'?{kind:'guest'}:{kind:'form',usernameEnv:`${roleId.toUpperCase()}_EMAIL`,passwordEnv:`${roleId.toUpperCase()}_PASSWORD`}});
  const {roleIds,...base}=context;const scope={...base,roleId};store.navigation.ensureScope(scope,'http://127.0.0.1:3000/',config);const run=store.navigation.startRun(scope,'map');const evidence=artifacts.put(run.id,Buffer.from(rawArtifactCanary),'event-log');const state=store.navigation.saveState(scope,normalizeObservation({url:'http://127.0.0.1:3000/',headings:['Registration'],controls:[],dialogs:[]},config),evidence.id);if(roleId==='guest')target=state.id;
 }
 const story=store.testing.importStory('# Registration\n## Acceptance Criteria\n- AC-1: Heading reads Registration. Synthetic credentials must be redacted: '+Object.values(canaries).join(' '),'synthetic-context.md',context);
 class Capture extends FakeProvider{async plan(context){captured=context.summary;return{title:'Synthetic sanitizer verification',feature:'Registration',inferredRequirements:[],scenarios:[{id:'check',title:'Synthetic context',roleId:'guest',requirementIds:[story.requirements[0].id],targetStateId:target,data:[],steps:[],assertions:[{id:'heading',requirementId:story.requirements[0].id,kind:'text',locator:{kind:'role',role:'heading',name:'Registration'},expected:'Registration',comparison:'equals'}],allowedActions:[],cleanup:'owned-fixtures',severity:'low',retries:0}]};}}
 await new QaService(store,artifacts,new Capture(),undefined,canaries).plan(story.id,{actionGrants:[],readGrants:[],fixtures:{setupUrl:'http://127.0.0.1:3000/setup',cleanupUrl:'http://127.0.0.1:3000/cleanup',tokenEnv:'FIXTURE_TOKEN',emailDomain:'synthetic.invalid'},discovery:false});
 for(const secret of [...Object.values(canaries),rawArtifactCanary])assert(!captured.includes(secret),'Synthetic secret/raw artifact reached provider boundary');assert(captured.includes('[redacted]'));assert(captured.includes(target));
}finally{store.close();}
const extra=new ProviderEvidence(root);extra.write('context-sanitization.json',{synthetic:true,realAiInvoked:false,sourceCanaries:canaries,rawArtifactCanary,capturedProviderContext:JSON.parse(captured),assertions:{credentialAndFixtureCanariesAbsent:true,rawArtifactAbsent:true,navigationRetained:true},contextSha256:sha(captured)});
const receipts=[...validation.evidence.receipts,...extra.receipts()];
for(const receipt of receipts)assert.equal(sha(readFileSync(join(root,receipt.name))),receipt.sha256);
const sourceHashes=Object.fromEntries(['packages/providers/src/codex.ts','packages/providers/src/evidence.ts','packages/qa/src/service.ts','scripts/verify-provider.mjs'].map(file=>[file,sha(readFileSync(file))]));
const result={verifiedAt:new Date().toISOString(),isolation:validation,sourceHashes,syntheticOnly:true,realAiInvoked:false,disabledToolWireRequests:wires.length,timeout:{pid:timeout.pid,signal:timeout.signal,reason:timeout.terminationRequested,durationMs:timeout.endedAt-timeout.startedAt,processExited:true},cancellation:{pid:cancel.pid,signal:cancel.signal,reason:cancel.terminationRequested,durationMs:cancel.endedAt-cancel.startedAt,processExited:true},sanitizedContext:{credentialAndFixtureCanariesAbsent:true,rawArtifactAbsent:true,receipt:'context-sanitization.json'},privateEvidenceDirectory:root,receipts};
extra.write('verification-manifest.json',result);writeFileSync('validation/m2-isolation-recheck.json',JSON.stringify({...result,manifestSha256:extra.receipts().find(r=>r.name==='verification-manifest.json').sha256},null,2)+'\n');
console.log(JSON.stringify({status:'passed',toolCount:0,timeoutProcessExited:true,cancellationProcessExited:true,sanitizedContextVerified:true,evidenceDirectory:root}));
