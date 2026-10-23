import {it,expect} from 'vitest';
import {RunArtifactBudget} from '../../packages/qa/src/artifacts.js';
import type {ArtifactStorage,ArtifactRecord} from '../../packages/core/src/index.js';
it('charges every scenario navigation trace and assertion against one logical test-run budget',()=>{
 const writes:string[]=[];const delegate:ArtifactStorage={put(runId,data,kind){writes.push(runId);return{id:`artifact-${writes.length}`,runId,kind,sizeBytes:data.byteLength,createdAt:0,expiresAt:100,active:true,status:'available'} satisfies ArtifactRecord;},read(){return Buffer.alloc(0);},finishRun(){},delete(){},prune(){return 0;}};
 const budget=new RunArtifactBudget(delegate,()=>6);budget.put('navigation-child-a',Buffer.from('1234'),'trace');expect(()=>budget.put('navigation-child-b',Buffer.from('567'),'trace')).toThrow('Test-run quota');budget.put('test-parent',Buffer.from('56'),'event-log');expect(writes).toEqual(['navigation-child-a','test-parent']);
});
