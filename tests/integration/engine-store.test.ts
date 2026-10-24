import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EngineStore} from '../../packages/engine/src/store.js';
it('persists idempotent commands, ordered events, safe resource locks and rejects stale workers',()=>{
 const root=mkdtempSync(join(tmpdir(),'engine-store-'));let store=new EngineStore(root);
 try{
  const input={projectId:'p',title:'A',context:{applicationId:'a',environmentId:'qa',build:'b',roleIds:['guest'],tenant:'public',featureFlags:{}},markdown:'criterion',sourceRef:'test',storyId:null,status:'Queued',strategy:'intelligent' as const};
  const first=store.command('p','key',input,()=>store.createTask(input));expect(store.command('p','key',input,()=>{throw new Error('Duplicate');})).toEqual(first);expect(()=>store.command('p','key',{other:true},()=>first)).toThrow('Idempotency');
  const a=store.enqueue(first,'execute',{}),b=store.enqueue(first,'execute',{}),other=store.createTask({...input,projectId:'q'});store.enqueue(other,'execute',{});
  const claim=store.claim('owner',3,2,30000)!;expect(claim.id).toBe(a.id);expect(store.claim('peer',3,2,30000)?.projectId).toBe('q');expect(store.claim('peer',3,2,30000)).toBeNull();
  expect(store.finish({...claim,fence:claim.fence-1},'complete',{}, {status:'Ready for Review'})).toBe(false);
  store.db.prepare('UPDATE engine_jobs SET lease_until=0 WHERE id=?').run(claim.id);store.recover();expect(store.job(a.id,'p').status).toBe('blocked');expect(store.finish(claim,'complete',{}, {status:'Ready for Review'})).toBe(false);expect(store.claim('new',3,2,30000)).toBeNull();
  expect(store.job(b.id,'p').status).toBe('queued');const events=store.events(a.id,'p');expect(events.map(e=>e.sequence)).toEqual([1,2,3]);expect(()=>store.events(a.id,'q')).toThrow();
  store.close();store=new EngineStore(root);expect(store.tasks('p')).toHaveLength(1);expect(store.events(a.id,'p',2)).toHaveLength(1);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
