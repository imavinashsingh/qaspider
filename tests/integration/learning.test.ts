import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { runLearningCli } from '../../packages/cli/src/learning.js';
import { SqliteStore, ArtifactStore } from '../../packages/storage/src/index.js';
import { navigationConfigSchema, normalizeObservation, scopeId, type Scope } from '../../packages/core/src/index.js';

describe('governed memory', () => {
 it('compares isolated builds, validates every candidate, records decisions and rolls back without erasing evidence', async () => {
  const root=mkdtempSync(join(tmpdir(),'qaspider-learning-')); const path=join(root,'.qaspider','memory.db'); let store=new SqliteStore(path);
  try {
   store.createApplication({id:'app',name:'App'});store.createEnvironment({id:'qa',applicationId:'app',name:'QA',kind:'qa',allowedOrigins:['http://127.0.0.1:3000']});store.createRole({id:'guest',environmentId:'qa',name:'Guest',auth:{kind:'guest'}});
   const artifacts=new ArtifactStore(store,join(root,'artifacts'));const base:Scope={applicationId:'app',environmentId:'qa',roleId:'guest',tenant:'public',build:'base',featureFlags:{}}; const head={...base,build:'head'};
   function seed(scope:Scope,title:string) {
    const config=navigationConfigSchema.parse({});store.navigation.ensureScope(scope,'http://127.0.0.1:3000/',config);const run=store.navigation.startRun(scope,'map');const evidence=artifacts.put(run.id,Buffer.from('{}'),'event-log');
    const from=store.navigation.saveState(scope,normalizeObservation({url:'http://127.0.0.1:3000/',headings:['Home'],controls:[],dialogs:[]},config),evidence.id);
    const to=store.navigation.saveState(scope,normalizeObservation({url:'http://127.0.0.1:3000/register',headings:[title],controls:[],dialogs:[]},config),evidence.id);
    const edge=store.navigation.saveTransition(scope,from.id,to.id,{kind:'link',locator:{kind:'role',role:'link',name:'Register'},targetUrl:'http://127.0.0.1:3000/register'});store.navigation.recordVerification(scope,edge.id,run.id,evidence.id,true);return {edge,evidence};
   }
   const old=seed(base,'Registration');store.navigation.approveBatch(base,[old.edge.id],'owner');const current=seed(head,'Consent');
   expect(()=>store.learning.compare(base,{...head,tenant:'other'},'reviewer')).toThrow(/scope/i);
   const output:string[]=[];expect(await runLearningCli(['diff','--workspace',root,'--base',scopeId(base),'--head',scopeId(head),'--reviewer','owner'],line=>output.push(line))).toBe(0);expect(JSON.parse(output[0]!).changedTransitions).toContain(old.edge.id);
   const change=store.learning.compare(base,head,'reviewer');expect(change.changedTransitions).toContain(old.edge.id);expect(change.newStateIds).toHaveLength(1);
   expect(store.navigation.snapshot(base).transitions[0]?.status).toBe('approved');

   const candidate=store.learning.proposeNavigation(head,[current.edge.id],change.id,'benchmark change');
   expect(()=>store.learning.decide(head,[candidate.id,'unknown'],'approve','owner','reviewed')).toThrow();expect(store.navigation.snapshot(head).transitions[0]?.status).toBe('verified');
   const revision=store.learning.decide(head,[candidate.id],'approve','owner','checked replay');expect(store.navigation.snapshot(head).transitions[0]?.status).toBe('approved');
   expect(()=>store.learning.decide({...head,tenant:'other'},[candidate.id],'reject','owner','wrong scope')).toThrow();
   expect(()=>store.learning.decide(head,[candidate.id],'approve','owner','again')).toThrow();
   store.learning.rollback(head,revision.id,'owner','revert navigation');expect(store.navigation.snapshot(head).transitions[0]?.status).toBe('verified');expect(store.getArtifact(current.evidence.id)?.status).toBe('available');
   const rejected=store.learning.proposeNavigation(head,[current.edge.id],change.id,'second review');store.learning.decide(head,[rejected.id],'reject','owner','unnecessary');expect(store.navigation.snapshot(head).transitions[0]?.status).toBe('verified');
   expect(()=>store.learning.rollback(head,revision.id,'owner','again')).toThrow();
   const laterCandidate=store.learning.proposeNavigation(head,[current.edge.id],change.id,'new review');const laterRevision=store.learning.decide(head,[laterCandidate.id],'approve','owner','reapproved');
   store.navigation.approveBatch(head,[current.edge.id],'later-owner');expect(()=>store.learning.rollback(head,laterRevision.id,'owner','stale rollback')).toThrow(/Later navigation approval/);
   store.setArtifactStatus(current.evidence.id,'expired');const expired=store.learning.proposeNavigation(head,[current.edge.id],change.id,'expired evidence');expect(()=>store.learning.decide(head,[expired.id],'approve','owner','unavailable evidence')).toThrow(/evidence/i);
   store.close();store=new SqliteStore(path);expect(store.learning.listRevisions(head)).toHaveLength(4);expect(store.learning.listCandidates(head)).toHaveLength(4);
   const db=new Database(path);try {expect(()=>db.prepare('DELETE FROM memory_revisions').run()).toThrow(/immutable/);expect(()=>db.prepare("UPDATE memory_candidates SET source='changed'").run()).toThrow(/immutable/);}finally{db.close();}
  } finally {store.close();rmSync(root,{recursive:true,force:true});}
 });
 it('requires individual authoritative approval for expectation proposals without mutating accepted requirements',()=>{
  const store=new SqliteStore(':memory:');try {
   store.createApplication({id:'a',name:'A'});store.createEnvironment({id:'qa',applicationId:'a',name:'QA',kind:'qa',allowedOrigins:['http://localhost:3000']});store.createRole({id:'guest',environmentId:'qa',name:'Guest',auth:{kind:'guest'}});
   const scope:Scope={applicationId:'a',environmentId:'qa',roleId:'guest',build:'b',tenant:'public',featureFlags:{}};store.navigation.ensureScope(scope,'http://localhost:3000/',navigationConfigSchema.parse({}));
   const candidate=store.learning.proposeExpectation(scope,'security','Never disclose private records','spec.md#access','owner');
   expect(()=>store.learning.decide(scope,[candidate.id],'approve','owner','batch')).toThrow(/individual/);
   expect(()=>store.learning.approveExpectation(scope,candidate.id,'owner','')).toThrow();
   store.learning.approveExpectation(scope,candidate.id,'owner','spec.md#access');expect(store.learning.listRevisions(scope)[0]?.kind).toBe('expectation-approval');expect(store.testing.listStories()).toEqual([]);
  } finally {store.close();}
 });
});
