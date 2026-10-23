import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { scopeSchema, reviewerSchema } from '../../core/src/index.js';
import { explorationRequestSchema, LearningService } from './service.js';
const reviewSchema=z.object({scope:scopeSchema,ids:z.array(z.string()).min(1).max(1000),decision:z.enum(['approve','reject']),reviewer:reviewerSchema,reason:z.string().trim().min(1).max(2000)}).strict();
export function createLearningApi(service:LearningService){
 const pending=new Map<string,AbortController>();const tasks=new Set<Promise<void>>();let sequence=0;
 return {async shutdown(){for(const controller of pending.values())controller.abort();await Promise.allSettled(tasks);},async handle(request:IncomingMessage,response:ServerResponse,url:URL,origin:string){
  if(!url.pathname.startsWith('/api/memory/'))return false;
  const send=(value:unknown,status=200)=>{response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(value));};
  try{
   const operation=url.pathname.slice('/api/memory/'.length);
   if(request.method==='GET'&&operation==='overview'){
    const record=service.store.navigation.listScopes().find(s=>s.id===url.searchParams.get('scope'));if(!record)throw new Error('Unknown scope');
    send({candidates:service.store.learning.listCandidates(record.scope),revisions:service.store.learning.listRevisions(record.scope),changes:service.store.learning.listChanges(record.scope)});return true;
   }
   if(request.method!=='POST'||request.headers.origin!==origin||!request.headers['content-type']?.startsWith('application/json'))throw new Error('Same-origin JSON required');
   let size=0;const chunks:Buffer[]=[];for await(const chunk of request){size+=chunk.length;if(size>262144)throw new Error('Request too large');chunks.push(Buffer.from(chunk));}const data:unknown=JSON.parse(Buffer.concat(chunks).toString());
   if(operation==='compare'){const v=z.object({base:scopeSchema,head:scopeSchema,reviewer:reviewerSchema}).strict().parse(data);send(service.store.learning.compare(v.base,v.head,v.reviewer));}
   else if(operation==='review'){const v=reviewSchema.parse(data);send(service.store.learning.decide(v.scope,v.ids,v.decision,v.reviewer,v.reason));}
   else if(operation==='expectation'){const v=z.object({scope:scopeSchema,id:z.string(),reviewer:reviewerSchema,source:z.string().trim().min(1).max(2000)}).strict().parse(data);send(service.store.learning.approveExpectation(v.scope,v.id,v.reviewer,v.source));}
   else if(operation==='propose-expectation'){const v=z.object({scope:scopeSchema,kind:z.enum(['business-rule','security']),expectation:z.string(),source:z.string(),reviewer:reviewerSchema}).strict().parse(data);send(service.store.learning.proposeExpectation(v.scope,v.kind,v.expectation,v.source,v.reviewer));}
   else if(operation==='propose'){const v=z.object({scope:scopeSchema,transitionIds:z.array(z.string()),changeSetId:z.string().nullable(),source:z.string()}).strict().parse(data);send(service.store.learning.proposeNavigation(v.scope,v.transitionIds,v.changeSetId,v.source));}
   else if(operation==='rollback'){const v=z.object({scope:scopeSchema,revisionId:z.string(),reviewer:reviewerSchema,reason:z.string()}).strict().parse(data);send(service.store.learning.rollback(v.scope,v.revisionId,v.reviewer,v.reason));}
   else if(operation==='explore'){const v=explorationRequestSchema.parse(data);const id=String(++sequence);const controller=new AbortController();pending.set(id,controller);response.setHeader('x-qaspider-exploration',id);const task=service.explore(v.base,v.head,v.terms,v.config,v.limits,v.reviewer,controller.signal).then(value=>send(value)).catch(()=>send({error:'Exploration failed; inspect local run evidence'},400)).finally(()=>{pending.delete(id);tasks.delete(task);});tasks.add(task);await task;}
   else if(operation==='cancel'){const v=z.object({id:z.string()}).strict().parse(data);const controller=pending.get(v.id);if(!controller)throw new Error('Unknown exploration');controller.abort();send({status:'cancelling'});}
   else send({error:'Unknown memory operation'},404);
  }catch{send({error:'Memory operation rejected; check scope, evidence, review and revision history'},400);}return true;
 }};
}
