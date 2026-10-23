import { it,expect } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore,ArtifactStore } from '../../packages/storage/src/index.js';
import { navigationConfigSchema, normalizeObservation, scopeId, type Scope } from '../../packages/core/src/index.js';
it('uses actual MCP v2 protocol and rejects ungranted scopes, execution and arbitrary artifact paths',async()=>{
 const root=mkdtempSync(join(tmpdir(),'qaspider-mcp-'));const store=new SqliteStore(join(root,'.qaspider','memory.db'));const artifacts=new ArtifactStore(store,join(root,'artifacts'));
 const scope:Scope={applicationId:'a',environmentId:'qa',roleId:'guest',build:'b',tenant:'public',featureFlags:{}};
 store.createApplication({id:'a',name:'A'});store.createEnvironment({id:'qa',applicationId:'a',name:'QA',kind:'qa',allowedOrigins:['http://127.0.0.1:3000']});store.createRole({id:'guest',environmentId:'qa',name:'Guest',auth:{kind:'guest'}});store.navigation.ensureScope(scope,'http://127.0.0.1:3000/',navigationConfigSchema.parse({}));const run=store.navigation.startRun(scope,'map');const proof=artifacts.put(run.id,Buffer.from('{}'),'event-log');store.navigation.saveState(scope,normalizeObservation({url:'http://127.0.0.1:3000/',headings:['Home'],controls:[],dialogs:[]},navigationConfigSchema.parse({})),proof.id);
 const authFile=join(root,'authorization.json');writeFileSync(authFile,JSON.stringify({grants:[{scope,actions:['read']}]}));const client=new Client({name:'test-client',version:'1.0.0'});const clientTransport=new StdioClientTransport({command:process.execPath,args:['dist/packages/cli/src/main.js','serve','--mcp','--workspace',root,'--authorization',authFile],stderr:'pipe'});
 let diagnostic='';clientTransport.stderr?.on('data',chunk=>{diagnostic+=String(chunk);});
 try{try{await client.connect(clientTransport);}catch(error){throw new Error(diagnostic,{cause:error});}const list=await client.listTools();expect(list.tools.map(t=>t.name)).toContain('get_app_context');expect(list.tools.map(t=>t.name)).not.toContain('approve_memory');
 const context=await client.callTool({name:'get_app_context',arguments:{scope}});expect(context.isError).not.toBe(true);expect(JSON.stringify(context)).toContain('Home');expect(JSON.stringify(context)).not.toContain('auth');
 expect((await client.callTool({name:'get_app_context',arguments:{scope:{...scope,tenant:'other'}}})).isError).toBe(true);
 expect((await client.callTool({name:'get_app_context',arguments:{scope,path:'/etc/passwd'}})).isError).toBe(true);
 expect((await client.callTool({name:'run_tests',arguments:{planRevisionId:'unknown'}})).isError).toBe(true);
 expect((await client.callTool({name:'propose_memory_update',arguments:{scope,transitionIds:['unknown'],source:'test'}})).isError).toBe(true);
 const crossBuild=store.operationJobs.create(scope,'explore');store.operationJobs.finish(crossBuild.id,'complete',{change:{base:{...scope,build:'ungranted-base'}}});expect((await client.callTool({name:'get_job',arguments:{jobId:crossBuild.id}})).isError).toBe(true);
 expect(scopeId(scope)).toBeDefined();
 }finally{await client.close();store.close();rmSync(root,{recursive:true,force:true});}
});
