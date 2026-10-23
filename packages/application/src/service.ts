import type { Browser } from 'playwright';
import { SqliteStore, ArtifactStore } from '../../storage/src/index.js';
import { QaService } from '../../qa/src/service.js';
import { LearningService, explorationRequestSchema } from '../../learning/src/service.js';
import { NavigationEngine } from '../../navigation/src/engine.js';
import { onboardingSchema, mapRequestSchema, settingsSchema, hash, type Onboarding, type Scope, type OperationJob } from '../../core/src/index.js';
export class ApplicationService {
 readonly qa:QaService;readonly learning:LearningService;
 private readonly pending=new Map<string,{controller:AbortController;promise:Promise<void>}>();
 constructor(readonly store:SqliteStore,readonly artifacts:ArtifactStore,private readonly browser?:Browser,private readonly env:NodeJS.ProcessEnv=process.env,qa?:QaService){this.qa=qa??new QaService(store,artifacts,undefined,browser,env);this.learning=new LearningService(store,artifacts,browser,env);}
 configuration(){return{applications:this.store.listApplications(),environments:this.store.listEnvironments(),roles:this.store.listRoles(),settings:this.store.getSettings()};}
 onboard(input:Onboarding){const v=onboardingSchema.parse(input);return this.store.transaction(()=>{
  const existing=this.store.getApplication(v.application.id);if(existing&&hash(existing)!==hash(v.application))throw new Error('Application ID already configured');if(!existing)this.store.createApplication(v.application);
  const environment=this.store.getEnvironment(v.environment.id);if(environment&&hash(environment)!==hash(v.environment))throw new Error('Environment ID already configured; create a new environment');if(!environment)this.store.createEnvironment(v.environment);
  for(const role of v.roles){const old=this.store.getRole(role.id);if(old&&hash(old)!==hash(role))throw new Error('Role ID already configured');if(!old)this.store.createRole(role);}return this.configuration();
 });}
 settings(input:unknown){const v=settingsSchema.parse(input);this.store.setSettings(v);return this.store.getSettings();}
 overview(){const scopes=this.store.navigation.listScopes();return{applications:this.store.listApplications().length,environments:this.store.listEnvironments().length,scopes:scopes.length,states:scopes.reduce((n,s)=>n+this.store.navigation.snapshot(s.scope).states.length,0),transitions:scopes.reduce((n,s)=>n+this.store.navigation.snapshot(s.scope).transitions.length,0),plans:this.store.testing.listPlans().length,runs:this.store.testing.listRuns().length,availableArtifactBytes:this.store.listArtifacts().filter(a=>a.status==='available').reduce((n,a)=>n+a.sizeBytes,0),jobs:this.store.operationJobs.list()};}
 private validate(scope:Scope,serialized:string){const environment=this.store.getEnvironment(scope.environmentId),role=this.store.getRole(scope.roleId);if(!environment||environment.applicationId!==scope.applicationId||environment.kind==='production'||!role||role.environmentId!==environment.id)throw new Error('Invalid execution scope');const secrets=role.auth.kind==='form'?[this.env[role.auth.usernameEnv],this.env[role.auth.passwordEnv]]:[];if(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/.test(serialized)||secrets.some(secret=>secret&&serialized.includes(secret)))throw new Error('Configuration must contain references only');}
 startMap(input:unknown){const v=mapRequestSchema.parse(input);this.validate(v.scope,JSON.stringify(v));this.store.navigation.ensureScope(v.scope,v.seedUrl,v.config);return this.job(v.scope,'map',signal=>new NavigationEngine(this.store,this.artifacts,this.browser).map(v.scope,v.seedUrl,v.config,v.limits,signal,this.env));}
 startExplore(input:unknown){const v=explorationRequestSchema.parse(input);this.validate(v.head,JSON.stringify(v));return this.job(v.head,'explore',signal=>this.learning.explore(v.base,v.head,v.terms,v.config,v.limits,v.reviewer,signal));}
 private job(scope:Scope,kind:OperationJob['kind'],work:(signal:AbortSignal)=>Promise<unknown>){const job=this.store.operationJobs.create(scope,kind),controller=new AbortController();const promise=Promise.resolve().then(()=>work(controller.signal)).then(result=>{const run=(result as {run?:{status:string};status?:string});const status=run.run?.status??run.status;this.store.operationJobs.finish(job.id,controller.signal.aborted?'cancelled':status==='complete'?'complete':'failed',result);}).catch(()=>{this.store.operationJobs.finish(job.id,controller.signal.aborted?'cancelled':'failed',{error:'Operation failed; inspect local run evidence'});}).finally(()=>this.pending.delete(job.id));this.pending.set(job.id,{controller,promise});return job;}
 cancel(id:string){const operation=this.pending.get(id);if(operation){operation.controller.abort();return;}this.qa.cancel(id);}
 async shutdown(){for(const operation of this.pending.values())operation.controller.abort();await Promise.allSettled([...this.pending.values()].map(p=>p.promise));await this.qa.shutdown();}
}
