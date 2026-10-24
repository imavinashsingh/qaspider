import {z} from 'zod';
import {privateConnection} from './connection.js';
const connectionSchema=z.object({endpoint:z.string().url(),token:z.string().min(32),projectId:z.string().uuid()}).strict();
export class EngineClient {
 readonly connection:z.infer<typeof connectionSchema>;
 constructor(config:unknown){this.connection=connectionSchema.parse(config);const url=new URL(this.connection.endpoint);if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Engine endpoint must be a plain local HTTP origin');}
 static fromFile(path:string){return new EngineClient(privateConnection(path));}
 async request(operation:string,data?:unknown){
  if(!/^[a-z-]+(?:\?.*)?$/.test(operation))throw new Error('Invalid engine operation');
  const response=await fetch(`${new URL(this.connection.endpoint).origin}/api/v1/projects/${this.connection.projectId}/${operation}`,{method:data===undefined?'GET':'POST',headers:{authorization:`Bearer ${this.connection.token}`,'x-qaspider-api-version':'1',...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)}),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(response.headers.get('x-qaspider-api-version')!=='1')throw new Error('Incompatible engine API');
  if(!response.ok)throw new Error(`Engine request rejected (${response.status}); check access, input and policy`);
  return response.json() as Promise<unknown>;
 }
}
