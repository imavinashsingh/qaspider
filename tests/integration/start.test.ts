import{it,expect}from'vitest';
import{spawn}from'node:child_process';import{createServer}from'node:net';import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{setTimeout as delay}from'node:timers/promises';
async function reserve(){const server=createServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('No port');return{server,port:address.port,close:()=>new Promise<void>(resolve=>server.close(()=>resolve()))};}
it('starts Studio and benchmark together and shuts down both on termination',async()=>{
 const root=mkdtempSync(join(tmpdir(),'qaspider-start-')),studio=await reserve(),benchmark=await reserve();await studio.close();await benchmark.close();
 const child=spawn(process.execPath,['scripts/start.mjs','--benchmark'],{env:{...process.env,QASPIDER_STUDIO_HOME:join(root,'registry'),QASPIDER_PROJECTS_ROOT:join(root,'projects'),QASPIDER_STUDIO_PORT:String(studio.port),QASPIDER_BENCHMARK_PORT:String(benchmark.port)},stdio:'ignore'});const exit=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 try{
  await expect.poll(async()=>{try{return(await fetch(`http://127.0.0.1:${studio.port}/api/studio/auth`)).status;}catch{return 0;}},{timeout:10000}).toBe(200);
  expect((await fetch(`http://127.0.0.1:${benchmark.port}/health`)).status).toBe(200);child.kill('SIGTERM');expect(await exit).toBe(0);
  await expect(fetch(`http://127.0.0.1:${studio.port}/api/studio/auth`)).rejects.toThrow();await expect(fetch(`http://127.0.0.1:${benchmark.port}/health`)).rejects.toThrow();
 }finally{child.kill('SIGTERM');await exit;rmSync(root,{recursive:true,force:true});}
},15000);
it('stops its sibling service when the benchmark port is already occupied',async()=>{
 const root=mkdtempSync(join(tmpdir(),'qaspider-start-conflict-')),studio=await reserve(),blocker=await reserve();await studio.close();
 const child=spawn(process.execPath,['scripts/start.mjs','--benchmark'],{env:{...process.env,QASPIDER_STUDIO_HOME:join(root,'registry'),QASPIDER_PROJECTS_ROOT:join(root,'projects'),QASPIDER_STUDIO_PORT:String(studio.port),QASPIDER_BENCHMARK_PORT:String(blocker.port)},stdio:'ignore'});const exit=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 try{expect(await exit).toBe(1);await delay(20);await expect(fetch(`http://127.0.0.1:${studio.port}/api/studio/auth`)).rejects.toThrow();}finally{child.kill('SIGTERM');await exit;await blocker.close();rmSync(root,{recursive:true,force:true});}
},15000);
it('exposes the npm MCP command as a clean stdio protocol with explicit authorization',async()=>{
 const {Client}=await import('@modelcontextprotocol/client');const{StdioClientTransport}=await import('@modelcontextprotocol/client/stdio');const{runCli}=await import('../../packages/cli/src/cli.js');const{writeFileSync}=await import('node:fs');
 const root=mkdtempSync(join(tmpdir(),'qaspider-npm-mcp-'));expect(runCli(['init','--workspace',root],()=>{},{})).toBe(0);const authorization=join(root,'authorization.json');writeFileSync(authorization,JSON.stringify({grants:[]}),{mode:0o600});const client=new Client({name:'qaspider-npm-start-test',version:'1'});const transport=new StdioClientTransport({command:'npm',args:['run','--silent','start:mcp','--','--workspace',root,'--authorization',authorization],stderr:'pipe'});
 try{await client.connect(transport);expect((await client.listTools()).tools.map(tool=>tool.name)).toContain('get_app_context');}finally{await client.close();rmSync(root,{recursive:true,force:true});}
},15000);
it('starts Studio without the development benchmark by default',async()=>{
 const root=mkdtempSync(join(tmpdir(),'qaspider-start-default-')),studio=await reserve(),benchmark=await reserve();await studio.close();
 const child=spawn(process.execPath,['scripts/start.mjs'],{env:{...process.env,QASPIDER_STUDIO_HOME:join(root,'registry'),QASPIDER_PROJECTS_ROOT:join(root,'projects'),QASPIDER_STUDIO_PORT:String(studio.port),QASPIDER_BENCHMARK_PORT:String(benchmark.port)},stdio:'ignore'});const exit=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 try{await expect.poll(async()=>{try{return(await fetch(`http://127.0.0.1:${studio.port}/api/studio/auth`)).status;}catch{return 0;}},{timeout:10000}).toBe(200);expect(benchmark.server.listening).toBe(true);child.kill('SIGTERM');expect(await exit).toBe(0);}finally{child.kill('SIGTERM');await exit;await benchmark.close();rmSync(root,{recursive:true,force:true});}
},15000);
