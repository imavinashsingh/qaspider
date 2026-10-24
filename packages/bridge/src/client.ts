import {z} from 'zod';
import {privateConnection} from './connection.js';
const connectionSchema=z.object({endpoint:z.string().url(),token:z.string().min(32),projectId:z.string().uuid()}).strict();
export class EngineClient {
 readonly connection:z.infer<typeof connectionSchema>;
 constructor(config:unknown){this.connection=connectionSchema.parse(config);const url=new URL(this.connection.endpoint);if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Engine endpoint must be a plain local HTTP origin');}
 static fromFile(path:string){return new EngineClient(privateConnection(path));}
 async evidence(runId:string,id:string){
  const response=await fetch(`${new URL(this.connection.endpoint).origin}/api/v1/projects/${this.connection.projectId}/evidence?runId=${encodeURIComponent(runId)}&id=${encodeURIComponent(id)}`,{headers:{authorization:`Bearer ${this.connection.token}`,'x-qaspider-api-version':'1'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok||response.headers.get('x-qaspider-api-version')!=='1'||!response.body)throw new Error('Evidence unavailable or unauthorized');
  const mimeType=response.headers.get('content-type');if(!['image/png','application/json'].includes(mimeType??''))throw new Error('Unsupported evidence type');
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>8*1024*1024)throw new Error('Evidence exceeds bridge limit');parts.push(next.value);}}finally{await reader.cancel();}
  return {mimeType:mimeType!,bytes:Buffer.concat(parts)};
 }
 async request(operation:string,data?:unknown){
  if(!/^[a-z-]+(?:\?.*)?$/.test(operation))throw new Error('Invalid engine operation');
  const response=await fetch(`${new URL(this.connection.endpoint).origin}/api/v1/projects/${this.connection.projectId}/${operation}`,{method:data===undefined?'GET':'POST',headers:{authorization:`Bearer ${this.connection.token}`,'x-qaspider-api-version':'1',...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)}),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(response.headers.get('x-qaspider-api-version')!=='1')throw new Error('Incompatible engine API');
  if(!response.ok)throw new Error(`Engine request rejected (${response.status}); check access, input and policy`);
  return response.json() as Promise<unknown>;
 }
}
