import {configuredProviderFactory} from '../../studio/src/settings.js';
import {QaService} from '../../qa/src/service.js';
import { parseArgs } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { SqliteStore, ArtifactStore } from '../../storage/src/index.js';
import { ApplicationService } from '../../application/src/service.js';
import { createMcpServer, mcpAuthorizationSchema } from '../../mcp/src/server.js';
export async function runApplicationCli(args:string[],output:(line:string)=>void=console.log){let store:SqliteStore|undefined;let service:ApplicationService|undefined;try{
 const{values,positionals}=parseArgs({args,allowPositionals:true,options:{workspace:{type:'string'},file:{type:'string'},mcp:{type:'boolean'},authorization:{type:'string'}}});const[command,...extra]=positionals;if(extra.length)throw new Error('Unexpected arguments');const root=join(resolve(values.workspace??'.'),'.qaspider');if(!existsSync(join(root,'memory.db')))throw new Error('Workspace not initialized');store=new SqliteStore(join(root,'memory.db'));const artifacts=new ArtifactStore(store,join(root,'artifacts'));service=new ApplicationService(store,artifacts,undefined,process.env,new QaService(store,artifacts,configuredProviderFactory(resolve(values.workspace??'.'))));
 if(command==='serve'&&values.mcp){if(!values.authorization)throw new Error('Explicit MCP authorization file required');const auth=mcpAuthorizationSchema.parse(JSON.parse(readFileSync(values.authorization,'utf8')));const server=createMcpServer(service,auth);const transport=new StdioServerTransport();await server.connect(transport);await new Promise<void>(resolve=>{const previous=transport.onclose;transport.onclose=()=>{previous?.();resolve();};process.stdin.once('end',()=>resolve());});await server.close();}
 else if(command==='onboard'){if(!values.file)throw new Error('Onboarding file required');output(JSON.stringify(service.onboard(JSON.parse(readFileSync(values.file,'utf8')))));}
 else if(command==='configuration')output(JSON.stringify(service.configuration()));
 else if(command==='settings'){if(!values.file)throw new Error('Settings file required');output(JSON.stringify(service.settings(JSON.parse(readFileSync(values.file,'utf8')))));}
 else if(command==='overview')output(JSON.stringify(service.overview()));else throw new Error('Unknown application command');return 0;
 }catch{if(args[0]!=='serve')output(JSON.stringify({status:'error',message:'Application operation rejected; check configuration and explicit authorization'}));else process.stderr.write('QASpider MCP startup rejected; check workspace and authorization.\n');return 1;}finally{await service?.shutdown();store?.close();}}
