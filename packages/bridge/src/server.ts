import {McpServer} from '@modelcontextprotocol/server';
import {z} from 'zod';
import {EngineClient} from './client.js';
export function createBridge(client:EngineClient){
 const server=new McpServer({name:'qaspider-engine',version:'0.0.0'});
 const wrap=(work:()=>Promise<unknown>)=>work().then(value=>({content:[{type:'text' as const,text:JSON.stringify(value)}]})).catch(()=>({isError:true,content:[{type:'text' as const,text:'Engine operation rejected; inspect connection, authorization, input and policy.'}]}));
 for(const operation of ['configuration','overview','stories','plans','runs','jobs'])server.registerTool(`list_${operation}`,{description:`Read persistent project ${operation} from the engine.`,inputSchema:z.object({}).strict()},()=>wrap(()=>client.request(operation)));
 server.registerTool('plan_tests',{description:'Generate a typed plan for a saved story. Execution requires separate approval.',inputSchema:z.object({storyRevisionId:z.string()}).strict()},v=>wrap(()=>client.request('plan',v)));
 server.registerTool('run_tests',{description:'Submit an approved plan for AI-free execution. The engine owns the job after disconnect.',inputSchema:z.object({planRevisionId:z.string(),selected:z.array(z.string()).optional()}).strict()},v=>wrap(()=>client.request('execute',v)));
 for(const [name,resource]of [['get_job','job'],['get_report','report']] as const)server.registerTool(name,{description:`Read persisted ${resource}.`,inputSchema:z.object({id:z.string()}).strict()},v=>wrap(()=>client.request(`${resource}?id=${encodeURIComponent(v.id)}`)));
 server.registerTool('cancel_job',{description:'Cancel an authorized active engine job.',inputSchema:z.object({jobId:z.string()}).strict()},v=>wrap(()=>client.request('cancel',v)));
 return server;
}
