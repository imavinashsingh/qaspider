import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { ApplicationService } from './service.js';
export function createApplicationApi(service:ApplicationService){return{async handle(request:IncomingMessage,response:ServerResponse,url:URL,origin:string){
 if(!url.pathname.startsWith('/api/workspace/'))return false;const send=(value:unknown,status=200)=>{response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(value));};
 try{const operation=url.pathname.slice('/api/workspace/'.length);
  if(request.method==='GET'){if(operation==='configuration')send(service.configuration());else if(operation==='overview')send(service.overview());else if(operation==='job'){const job=service.store.operationJobs.get(url.searchParams.get('id')??'');if(!job)throw new Error('Unknown job');send(job);}else send({error:'Unknown workspace operation'},404);return true;}
  if(request.method!=='POST'||request.headers.origin!==origin||!request.headers['content-type']?.startsWith('application/json'))throw new Error('Same-origin JSON required');
  let size=0;const chunks:Buffer[]=[];for await(const part of request){size+=part.length;if(size>262144)throw new Error('Request too large');chunks.push(Buffer.from(part));}const data:unknown=JSON.parse(Buffer.concat(chunks).toString());
  if(operation==='onboard')send(service.onboard(data as Parameters<ApplicationService['onboard']>[0]));else if(operation==='settings')send(service.settings(data));else if(operation==='map')send(service.startMap(data),202);else if(operation==='explore')send(service.startExplore(data),202);else if(operation==='cancel'){const v=z.object({id:z.string()}).strict().parse(data);service.cancel(v.id);send({status:'cancelling'});}else send({error:'Unknown workspace operation'},404);
 }catch{send({error:'Workspace operation rejected; check configuration, allowed origins and scope'},400);}return true;
}};}
