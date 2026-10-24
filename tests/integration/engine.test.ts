import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {createEngine} from '../../packages/engine/src/server.js';
import {createStudioClient} from '../../packages/studio/src/client.js';
import {StudioStore} from '../../packages/studio/src/store.js';
import {ProjectRegistry} from '../../packages/studio/src/projects.js';
import {SqliteStore} from '../../packages/storage/src/index.js';
import {FakeProvider} from '../../packages/core/src/index.js';
it('shares persistent engine jobs through real MCP and optional Studio without client-owned execution',async()=>{
 const root=mkdtempSync(join(tmpdir(),'qaspider-engine-')),home=join(root,'engine'),projects=join(root,'projects');mkdirSync(projects);
 const registryStore=new StudioStore(home),registry=new ProjectRegistry(registryStore,[projects]);const project=registry.create({name:'Engine project',origin:'http://127.0.0.1:3000'});registryStore.set('mcp-enabled:'+project.id,'true');registryStore.close();
 const token='engine-test-token-with-at-least-32-characters',authFile=join(root,'auth.json');
 writeFileSync(authFile,JSON.stringify([{id:'agent',kind:'agent',tokenHash:createHash('sha256').update(token).digest('hex'),projects:[project.id],actions:['read','plan','execute']}]),{mode:0o600});
 const store=new SqliteStore(join(project.path,'.qaspider/memory.db'));const story=store.testing.importStory('# Heading\n## Acceptance Criteria\n- AC-1: Heading is visible.','fixture',{applicationId:'benchmark',environmentId:'development',build:'b',roleIds:['guest'],tenant:'public',featureFlags:{}});store.close();
 let engine=createEngine(home,[projects],authFile,{planningProvider:()=>new FakeProvider({}, {delayMs:300})});
 await new Promise<void>(r=>engine.server.listen(0,'127.0.0.1',r));let address=engine.server.address();if(!address||typeof address==='string')throw new Error('No listener');let endpoint=`http://127.0.0.1:${address.port}`;
 const connection=join(root,'connection.json');writeFileSync(connection,JSON.stringify({endpoint,token,projectId:project.id}),{mode:0o600});
 const bridge=new Client({name:'engine-test',version:'1'});const transport=new StdioClientTransport({command:process.execPath,args:[process.env.QASPIDER_TEST_BRIDGE_BIN??'dist/packages/bridge/src/main.js'],env:{...Object.fromEntries(Object.entries(process.env).filter((x):x is [string,string]=>x[1]!==undefined)),QASPIDER_ENGINE_CONNECTION_FILE:connection},stderr:'pipe'});
 const studio=createStudioClient(endpoint);await new Promise<void>(r=>studio.listen(0,'127.0.0.1',r));
 try{
  expect((await fetch(endpoint+'/api/v1/projects')).status).toBe(403);
  expect((await fetch(endpoint+'/api/v2/projects',{headers:{authorization:`Bearer ${token}`}})).status).toBe(426);
  expect((await fetch(endpoint+`/api/v1/projects/00000000-0000-4000-8000-000000000000/stories`,{headers:{authorization:`Bearer ${token}`}})).status).toBe(403);
  const studioAddress=studio.address();if(!studioAddress||typeof studioAddress==='string')throw new Error('No Studio listener');
  const session=engine.auth.open(true);const enginePort=new URL(endpoint).port;
  const visible=await fetch(`http://127.0.0.1:${studioAddress.port}/api/studio/projects`,{headers:{cookie:`qaspider-studio-${enginePort}=${session.token}`}});
  expect(visible.ok).toBe(true);expect(JSON.stringify(await visible.json())).toContain(project.id);
  const mcpInfoResponse=await fetch(`http://127.0.0.1:${studioAddress.port}/api/studio/mcp?project=${project.id}`,{headers:{cookie:`qaspider-studio-${enginePort}=${session.token}`}});const mcpInfo=await mcpInfoResponse.json() as {engineMode:boolean;managed:{enabled:boolean;pid:number|null};configuration:unknown};expect(mcpInfo.engineMode).toBe(true);expect(mcpInfo.managed.enabled).toBe(false);expect(mcpInfo.managed.pid).toBeNull();expect(JSON.stringify(mcpInfo.configuration)).toContain('QASPIDER_ENGINE_CONNECTION_FILE');expect(JSON.stringify(mcpInfo.configuration)).not.toContain('--workspace');
  const forbiddenLegacy=await fetch(`http://127.0.0.1:${studioAddress.port}/api/studio/mcp`,{method:'POST',headers:{cookie:`qaspider-studio-${enginePort}=${session.token}`,origin:`http://127.0.0.1:${studioAddress.port}`,'x-csrf-token':session.csrf,'content-type':'application/json'},body:JSON.stringify({projectId:project.id,operation:'enable'})});expect(forbiddenLegacy.status).toBe(400);

  await bridge.connect(transport);const list=await bridge.callTool({name:'list_stories',arguments:{}});expect(JSON.stringify(list)).toContain(story.id);
  const result=await bridge.callTool({name:'plan_tests',arguments:{storyRevisionId:story.id}});const blocks=result.content as {type:string;text?:string}[];const job=JSON.parse(blocks[0]!.text!) as {id:string};
  await bridge.close();studio.closeAllConnections();await new Promise<void>(r=>studio.close(()=>r()));
  const get=async()=>{const r=await fetch(endpoint+`/api/v1/projects/${project.id}/job?id=${job.id}`,{headers:{authorization:`Bearer ${token}`}});return r.json() as Promise<{status:string}>;};
  await expect.poll(async()=>(await get()).status).not.toBe('running');
  expect((await get()).status).toBe('failed'); // Synthetic invalid proposal, job still completes after both clients leave.
  await engine.shutdown();engine=createEngine(home,[projects],authFile);await new Promise<void>(r=>engine.server.listen(0,'127.0.0.1',r));address=engine.server.address();if(!address||typeof address==='string')throw new Error('No listener');endpoint=`http://127.0.0.1:${address.port}`;
  expect((await get()).status).toBe('failed');
  const restored=await fetch(endpoint+`/api/v1/projects/${project.id}/stories`,{headers:{authorization:`Bearer ${token}`}});expect(JSON.stringify(await restored.json())).toContain(story.id);
 }finally{await bridge.close();if(studio.listening){studio.closeAllConnections();await new Promise<void>(r=>studio.close(()=>r()));}await engine.shutdown();rmSync(root,{recursive:true,force:true});}
});
