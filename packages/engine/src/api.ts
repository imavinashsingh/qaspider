import type {IncomingMessage,ServerResponse} from 'node:http';
import {z} from 'zod';
import type {EngineContext} from '../../studio/src/server.js';
import {scopeSchema,storyContextSchema} from '../../core/src/index.js';
import {authorize,engineAuth} from './auth.js';
export async function jsonBody(request:IncomingMessage):Promise<unknown>{
 if(!request.headers['content-type']?.startsWith('application/json'))throw new Error('JSON required');
 const chunks:Buffer[]=[];let size=0;
 for await(const part of request){size+=part.length;if(size>262144)throw new Error('Request too large');chunks.push(Buffer.from(part));}
 return JSON.parse(Buffer.concat(chunks).toString()) as unknown;
}
export function send(response:ServerResponse,value:unknown,status=200){response.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-qaspider-api-version':'1'});response.end(JSON.stringify(value));}
export function createEngineApi(authFile:string){
 const authenticate=engineAuth(authFile);
 return async(request:IncomingMessage,response:ServerResponse,context:EngineContext)=>{
  const url=new URL(request.url??'/','http://engine');if(!url.pathname.startsWith('/api/v'))return false;
  try{
   const principal=authenticate(request.headers.authorization);
   if(!url.pathname.startsWith('/api/v1/')){send(response,{error:'Unsupported API version',supportedVersions:[1]},426);return true;}
   if(request.headers['x-qaspider-api-version']&&request.headers['x-qaspider-api-version']!=='1'){send(response,{error:'Unsupported API version',supportedVersions:[1]},426);return true;}
   if(request.method==='GET'&&url.pathname==='/api/v1/health'){send(response,{status:'ok',apiVersion:1});return true;}
   if(request.method==='GET'&&url.pathname==='/api/v1/projects'){send(response,context.registry.list().filter(p=>principal.projects.includes(p.id)).map(p=>({id:p.id,name:p.name})));return true;}
   const match=/^\/api\/v1\/projects\/([a-f0-9-]{36})\/([a-z-]+)$/.exec(url.pathname);
   if(!match){send(response,{error:'Unknown engine resource'},404);return true;}
   const projectId=z.string().uuid().parse(match[1]),operation=match[2]!;
   const action=request.method==='GET'?'read':operation==='plan'?'plan':operation==='execute'||operation==='cancel'?'execute':'manage';
   authorize(principal,projectId,action);
   const {viewer,database:store}=await context.project(projectId);const service=viewer.application;
   const id=url.searchParams.get('id')??'';
   if(request.method==='GET'){
    if(operation==='configuration')send(response,service.configuration());
    else if(operation==='overview')send(response,service.overview());
    else if(operation==='stories')send(response,store.testing.listStories());
    else if(operation==='plans')send(response,store.testing.listPlans());
    else if(operation==='runs')send(response,store.testing.listRuns());
    else if(operation==='jobs')send(response,store.testing.listJobs());
    else if(operation==='job'){const job=store.testing.getJob(id);if(!job)throw new Error('Unknown job');send(response,job);}
    else if(operation==='report'){const report=store.testing.report(id);if(!report)throw new Error('Unknown run');send(response,report);}
    else if(operation==='evidence'){
     const report=store.testing.report(url.searchParams.get('runId')??'');
     if(!report)throw new Error('Unknown run');
     const ids=new Set(report.results.flatMap(r=>r.attempts.flatMap(a=>a.evidenceIds)));
     const artifact=store.getArtifact(id);
     if(!ids.has(id)||!artifact||artifact.status!=='available'||artifact.kind==='trace')throw new Error('Evidence unavailable or restricted');
     response.writeHead(200,{'content-type':artifact.kind==='screenshot'?'image/png':'application/json','cache-control':'no-store','x-qaspider-api-version':'1'});response.end(service.artifacts.read(id));
    }
    else if(operation==='context'){const scope=scopeSchema.parse(JSON.parse(url.searchParams.get('scope')??'null'));send(response,store.navigation.snapshot(scope));}
    else send(response,{error:'Unknown engine resource'},404);
   }else if(request.method==='POST'){
    const data=await jsonBody(request);
    if(operation==='stories'){const v=z.object({markdown:z.string().min(1).max(32000),sourceRef:z.string().min(1).max(1000),context:storyContextSchema}).strict().parse(data);send(response,store.testing.importStory(v.markdown,v.sourceRef,v.context),201);}
    else if(operation==='plan'){const v=z.object({storyRevisionId:z.string()}).strict().parse(data);send(response,service.qa.startPlanning(v.storyRevisionId),202);}
    else if(operation==='execute'){const v=z.object({planRevisionId:z.string(),selected:z.array(z.string()).optional()}).strict().parse(data);send(response,service.qa.startExecution(v.planRevisionId,v.selected),202);}
    else if(operation==='cancel'){const v=z.object({jobId:z.string()}).strict().parse(data);service.cancel(v.jobId);send(response,{status:'cancelling'});}
    else send(response,{error:'Unknown engine resource'},404);
   }else send(response,{error:'Method not allowed'},405);
  }catch{send(response,{error:'Engine operation rejected; check authentication, project access, input and policy'},403);}
  return true;
 };
}
