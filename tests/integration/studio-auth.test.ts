import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {StudioStore} from '../../packages/studio/src/store.js';
import {StudioAuth} from '../../packages/studio/src/auth.js';
it('hashes passwords, rotates/revokes sessions, expires sessions, persists rate limits and supports operator recovery',async()=>{
 const root=mkdtempSync(join(tmpdir(),'qaspider-auth-'));let now=100000;const store=new StudioStore(root);const auth=new StudioAuth(store,()=>now);
 try{
  expect(auth.configured()).toBe(false);const anonymous=auth.open();await auth.setup(anonymous,'a strong private password');expect(auth.configured()).toBe(true);
  await expect(auth.setup(auth.open(),'another strong password')).rejects.toThrow();expect(auth.resolve(anonymous.token)?.authenticated).toBe(false);
  const first=await auth.login(auth.open(),'a strong private password');expect(auth.resolve(first.token)?.authenticated).toBe(true);auth.revoke(first.token);expect(auth.resolve(first.token)).toBeNull();
  for(let i=0;i<5;i++)await expect(auth.login(auth.open(),'incorrect password')).rejects.toThrow();await expect(auth.login(auth.open(),'a strong private password')).rejects.toThrow('temporarily');
  now+=16*60000;const next=await auth.login(auth.open(),'a strong private password');now+=9*3600000;expect(auth.resolve(next.token)).toBeNull();
  const active=await auth.login(auth.open(),'a strong private password');await auth.recover('replacement strong password',true);expect(auth.resolve(active.token)).toBeNull();await expect(auth.login(auth.open(),'a strong private password')).rejects.toThrow();expect((await auth.login(auth.open(),'replacement strong password')).authenticated).toBe(true);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
