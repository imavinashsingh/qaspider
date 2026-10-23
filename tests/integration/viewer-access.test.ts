import {request} from 'node:http';
import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SqliteStore,ArtifactStore} from '../../packages/storage/src/index.js';
import {createGraphServer} from '../../packages/navigation/src/viewer.js';
it('rotates viewer bearer access on restart and rejects old tokens, foreign hosts and origins',async()=>{
 const root=mkdtempSync(join(tmpdir(),'qaspider-viewer-access-'));const store=new SqliteStore(join(root,'memory.db'));const artifacts=new ArtifactStore(store,join(root,'artifacts'));
 const start=async()=>{const viewer=createGraphServer(store,artifacts);await new Promise<void>(resolve=>viewer.server.listen(0,'127.0.0.1',resolve));const address=viewer.server.address();if(!address||typeof address==='string')throw new Error('No address');return {...viewer,origin:`http://127.0.0.1:${address.port}`};};
 const close=async(viewer:Awaited<ReturnType<typeof start>>)=>{await viewer.shutdown();viewer.server.closeAllConnections();await new Promise<void>(resolve=>viewer.server.close(()=>resolve()));};
 let previous='';
 try{
  const first=await start();try{previous=first.token;expect((await fetch(`${first.origin}/api/scopes`,{headers:{'x-qaspider-token':previous}})).status).toBe(200);}finally{await close(first);}
  const second=await start();try{
   expect(second.token).not.toBe(previous);
   expect((await fetch(`${second.origin}/api/scopes`,{headers:{'x-qaspider-token':previous}})).status).toBe(401);
   expect((await fetch(`${second.origin}/api/scopes`,{headers:{'x-qaspider-token':second.token}})).status).toBe(200);
   expect((await fetch(`${second.origin}/api/scopes`,{headers:{'x-qaspider-token':second.token,origin:'https://outside.invalid'}})).status).toBe(403);
   const foreignHost=await new Promise<number|undefined>((resolve,reject)=>{const outgoing=request(`${second.origin}/api/scopes`,{headers:{'x-qaspider-token':second.token,host:'outside.invalid'}},response=>{response.resume();resolve(response.statusCode);});outgoing.on('error',reject);outgoing.end();});expect(foreignHost).toBe(403);
  }finally{await close(second);}
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
