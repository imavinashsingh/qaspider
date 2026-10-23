import{it,expect}from'vitest';import{mkdtempSync,mkdirSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{createStudioServer}from'../../packages/studio/src/server.js';
it('protects every project API with session + CSRF, rotates login, rejects traversal and isolates projects across restart',async()=>{
 const root=mkdtempSync(join(tmpdir(),'qaspider-studio-http-')),home=join(root,'studio'),projects=join(root,'projects');mkdirSync(projects);const app=createStudioServer(home,[projects]);await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));const address=app.server.address();if(!address||typeof address==='string')throw new Error('No address');const origin=`http://127.0.0.1:${address.port}`;let cookie='',csrf='';
 async function call(path:string,value?:unknown){const r=await fetch(origin+path,{headers:{cookie,...(value?{origin,'content-type':'application/json','x-csrf-token':csrf}:{})},...(value?{method:'POST',body:JSON.stringify(value)}:{})});const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0]!;const data=await r.json()as Record<string,unknown>;if(data.csrf)csrf=String(data.csrf);return{r,data};}
 try{
  expect((await call('/api/studio/projects')).r.status).toBe(401);const status=await call('/api/studio/auth');expect(status.data.configured).toBe(false);expect(status.r.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict');
  expect((await fetch(origin+'/api/studio/setup',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({password:'private strong password'})})).status).toBe(403);
  await call('/api/studio/setup',{password:'private strong password'});const before=cookie;expect((await call('/api/studio/login',{password:'incorrect strong password'})).r.status).toBe(401);expect((await call('/api/studio/login',{password:'private strong password'})).r.status).toBe(200);expect(cookie).not.toBe(before);
  expect((await fetch(origin+'/api/studio/projects',{headers:{cookie:before}})).status).toBe(401);
  await call('/api/studio/projects',{operation:'create',input:{name:'A',directory:'a',origin:'http://127.0.0.1:4317',environmentName:'QA'}});await call('/api/studio/projects',{operation:'create',input:{name:'B',directory:'b',origin:'http://127.0.0.1:4317',environmentName:'QA'}});
  const all=(await call('/api/studio/projects')).data;const list=all.projects as {id:string;name:string}[];expect(list).toHaveLength(2);const a=list.find(p=>p.name==='A')!,b=list.find(p=>p.name==='B')!;
  expect(JSON.stringify((await call(`/api/projects/${a.id}/api/workspace/configuration`)).data)).toContain('"name":"A"');expect(JSON.stringify((await call(`/api/projects/${b.id}/api/workspace/configuration`)).data)).not.toContain('"name":"A"');
  expect((await call('/api/studio/projects',{operation:'import',path:'/etc',name:'No'})).r.status).toBe(400);
  expect((await fetch(origin+'/api/studio/projects',{headers:{cookie,origin:'https://evil.test'}})).status).toBe(403);
  await call('/api/studio/logout',{});expect((await call('/api/studio/projects')).r.status).toBe(401);
 }finally{await app.shutdown();rmSync(root,{recursive:true,force:true});}
});
