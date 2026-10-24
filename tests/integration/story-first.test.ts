import type {Browser} from 'playwright';
import {it,expect} from 'vitest';
import {SqliteStore,ArtifactStore} from '../../packages/storage/src/index.js';
import {FakeProvider,navigationConfigSchema,normalizeObservation,type PlanProposal} from '../../packages/core/src/index.js';
import {QaService} from '../../packages/qa/src/service.js';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
it('plans without grants, derives minimum access, persists exact decisions and invalidates them on revision',async()=>{
 const root=mkdtempSync(join(tmpdir(),'story-first-'));const path=join(root,'memory.db');let store=new SqliteStore(path);
 try{
 store.createApplication({id:'app',name:'App'});store.createEnvironment({id:'qa',applicationId:'app',name:'QA',kind:'qa',allowedOrigins:['http://localhost:3000']});store.createRole({id:'guest',environmentId:'qa',name:'Guest',auth:{kind:'guest'}});
 const context={applicationId:'app',environmentId:'qa',roleIds:['guest'],tenant:'public',build:'v1',featureFlags:{}};const {roleIds,...base}=context;const scope={...base,roleId:'guest'};const config=navigationConfigSchema.parse({});store.navigation.ensureScope(scope,'http://localhost:3000/',config);const artifacts=new ArtifactStore(store,join(root,'artifacts'));const evidence=artifacts.put(store.navigation.startRun(scope,'map').id,Buffer.from('{}'),'event-log');const state=store.navigation.saveState(scope,normalizeObservation({url:'http://localhost:3000/',headings:['Registration'],dialogs:[],controls:[]},config),evidence.id);
 const story=store.testing.importStory('# Registration\n## Acceptance Criteria\n- AC-1: Registration heading is visible.','story.md',context);const requirementId=story.requirements[0]!.id;
 const proposal:PlanProposal={title:'Registration',feature:'Registration',inferredRequirements:[],scenarios:[{id:'register',title:'Submit registration',roleId:'guest',requirementIds:[requirementId],targetStateId:state.id,data:[],steps:[{kind:'click',locator:{kind:'role',role:'button',name:'Create account'},submitUrl:'http://localhost:3000/api/register'}],assertions:[{id:'visible',requirementId,kind:'visible',locator:{kind:'role',role:'heading',name:'Registration'},expected:true}],allowedActions:[{roleId:'guest',url:'http://localhost:3000/api/register',method:'POST'}],cleanup:'owned-fixtures',severity:'high',retries:0}]};
 const planner=new FakeProvider({plan:proposal});const forbiddenBrowser=new Proxy({},{get(){throw new Error('Planning must not use browser actions');}}) as Browser;const plan=await new QaService(store,artifacts,planner,forbiddenBrowser).plan(story.id);
 expect(plan.status).toBe('draft');const access=store.testing.permissions(plan.id);expect(access.requirements).toHaveLength(1);expect(access.requirements[0]).toMatchObject({kind:'submit',scenarioIds:['register'],status:'pending',changesData:true});
 expect(()=>store.testing.assertAuthorized(plan.id,'register')).toThrow('approved');store.testing.approvePlan(plan.id,'owner',[requirementId]);expect(()=>store.testing.assertAuthorized(plan.id,'register')).toThrow('permission');
 const request=access.requirements[0]!;expect(()=>store.testing.decidePermissions(plan.id,'wrong',[{permissionId:request.id,decision:'allow'}],'owner')).toThrow('revision');
 store.testing.decidePermissions(plan.id,plan.hash,[{permissionId:request.id,decision:'deny'}],'owner');expect(()=>store.testing.assertAuthorized(plan.id,'register')).toThrow('deny');
 store.testing.decidePermissions(plan.id,plan.hash,[{permissionId:request.id,decision:'allow'}],'owner');expect(()=>store.testing.assertAuthorized(plan.id,'register')).not.toThrow();expect(store.testing.executionPolicy(plan.id,'register').actionGrants).toEqual([{roleId:'guest',url:'http://localhost:3000/api/register',method:'POST'}]);
 store.close();store=new SqliteStore(path);expect(store.testing.permissions(plan.id).decisions).toHaveLength(2);expect(()=>store.testing.assertAuthorized(plan.id,'register')).not.toThrow();
 const edited=store.testing.revisePlan(plan.id,{...proposal,title:'Edited'});expect(edited.status).toBe('draft');expect(store.testing.permissions(edited.id).requirements[0]?.status).toBe('pending');expect(()=>store.testing.assertAuthorized(edited.id,'register')).toThrow();
 const unsupported=store.testing.saveProposedPlan(story.id,{...proposal,scenarios:proposal.scenarios.map(s=>({...s,data:[{key:'email',type:'email' as const,source:{kind:'unique-email' as const}}]}))},plan.policy,plan.provider);
 const missing=store.testing.permissions(unsupported.id).requirements.find(r=>r.kind==='fixture-cleanup')!;expect(missing.status).toBe('unsupported');expect(()=>store.testing.decidePermissions(unsupported.id,unsupported.hash,[{permissionId:missing.id,decision:'allow'}],'owner')).toThrow('Unsupported');
 const wrongRole={...proposal,scenarios:proposal.scenarios.map(s=>({...s,roleId:'admin'}))};expect(()=>store.testing.saveProposedPlan(story.id,wrongRole,plan.policy,plan.provider)).toThrow('scope');
 const otherProject=new SqliteStore(':memory:');try{expect(()=>otherProject.testing.decidePermissions(plan.id,plan.hash,[{permissionId:request.id,decision:'allow'}],'owner')).toThrow('revision');}finally{otherProject.close();}
 const unrelated=store.testing.saveProposedPlan(story.id,proposal,plan.policy,plan.provider);
 expect(()=>store.testing.decidePermissions(unrelated.id,plan.hash,[{permissionId:request.id,decision:'allow'}],'owner')).not.toThrow();
 // Identical content hashes can repeat across distinct revisions. Decisions remain tied to revision IDs.
 expect(store.testing.permissions(edited.id).decisions).toHaveLength(0);
 const tenantStory=store.testing.importStory('# Tenant registration\n## Acceptance Criteria\n- AC-1: Registration heading is visible.','tenant.md',{...context,tenant:'other'});
 const tenantProposal={...proposal,scenarios:proposal.scenarios.map(s=>({...s,requirementIds:[tenantStory.requirements[0]!.id],assertions:s.assertions.map(a=>({...a,requirementId:tenantStory.requirements[0]!.id}))}))};
 const tenantPlan=store.testing.saveProposedPlan(tenantStory.id,tenantProposal,plan.policy,plan.provider);store.testing.approvePlan(tenantPlan.id,'owner',[tenantStory.requirements[0]!.id]);
 expect(()=>store.testing.decidePermissions(tenantPlan.id,plan.hash,[{permissionId:request.id,decision:'allow'}],'owner')).toThrow('revision');expect(()=>store.testing.assertAuthorized(tenantPlan.id,'register')).toThrow('permission');
 expect(()=>store.testing.decidePermissions(tenantPlan.id,tenantPlan.hash,[{permissionId:request.id,decision:'allow',scope:context} as never],'owner')).toThrow();
 for(const [suffix,kind] of [['role','qa'],['environment','qa'],['production','production']] as const){
   const environmentId=suffix==='role'?'qa':suffix;const roleId=`${suffix}-role`;
   if(suffix!=='role')store.createEnvironment({id:environmentId,applicationId:'app',name:suffix,kind,allowedOrigins:['http://localhost:3000']});
   store.createRole({id:roleId,environmentId,name:roleId,auth:{kind:'guest'}});
   const scopedStory=store.testing.importStory('# Scoped registration\n## Acceptance Criteria\n- AC-1: Registration heading is visible.','scoped.md',{...context,environmentId,roleIds:[roleId]});
   const scopedProposal={...proposal,scenarios:proposal.scenarios.map(s=>({...s,roleId,allowedActions:s.allowedActions.map(g=>({...g,roleId})),requirementIds:[scopedStory.requirements[0]!.id],assertions:s.assertions.map(a=>({...a,requirementId:scopedStory.requirements[0]!.id}))}))};
   const scopedPlan=store.testing.saveProposedPlan(scopedStory.id,scopedProposal,plan.policy,plan.provider);store.testing.approvePlan(scopedPlan.id,'owner',[scopedStory.requirements[0]!.id]);expect(store.testing.permissions(scopedPlan.id).decisions).toHaveLength(0);expect(()=>store.testing.assertAuthorized(scopedPlan.id,'register')).toThrow('permission');
   if(kind==='production')expect(()=>store.testing.decidePermissions(scopedPlan.id,scopedPlan.hash,[{permissionId:store.testing.permissions(scopedPlan.id).requirements[0]!.id,decision:'allow'}],'owner')).toThrow('forbidden');
 }
 const forged=structuredClone(proposal);forged.scenarios[0]!.steps=[{kind:'click',locator:{kind:'role',role:'button',name:'Create account'},submitUrl:'https://evil.test/write'}];expect(()=>store.testing.saveProposedPlan(story.id,forged,{actionGrants:[],readGrants:[],fixtures:null,discovery:false},plan.provider)).toThrow('scope');
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
it('validates the resolved real provider factory before sharing any story context',async()=>{
 const {CodexPlanningAdapter}=await import('../../packages/providers/src/codex.js');const store=new SqliteStore(':memory:');const root=mkdtempSync(join(tmpdir(),'planning-gate-'));let validations=0,plans=0;
 try{store.createApplication({id:'app',name:'App'});store.createEnvironment({id:'qa',applicationId:'app',name:'QA',kind:'qa',allowedOrigins:['http://localhost:3000']});store.createRole({id:'guest',environmentId:'qa',name:'Guest',auth:{kind:'guest'}});const story=store.testing.importStory('# Missing feature\n## Acceptance Criteria\n- AC-1: The heading is visible.','story.md',{applicationId:'app',environmentId:'qa',roleIds:['guest'],build:'v1',tenant:'public',featureFlags:{}});
 class Gate extends CodexPlanningAdapter{override async validateIsolation():Promise<never>{validations++;throw new Error('synthetic gate sentinel');}override async plan():Promise<never>{plans++;throw new Error('Must not receive context');}}
 await expect(new QaService(store,new ArtifactStore(store,join(root,'artifacts')),()=>new Gate()).plan(story.id)).rejects.toThrow('synthetic gate sentinel');expect(validations).toBe(1);expect(plans).toBe(0);expect(store.testing.listPlans()).toHaveLength(0);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
