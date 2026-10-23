import{Client}from'@modelcontextprotocol/client';
import{StdioClientTransport}from'@modelcontextprotocol/client/stdio';
import{mcpInformation}from'./settings.js';
import{StudioStore}from'./store.js';import{ProjectRegistry}from'./projects.js';
export interface McpStatus{projectId:string;enabled:boolean;status:'stopped'|'starting'|'running'|'failed';pid:number|null;startedAt:number|null;lastCheckedAt:number|null;tools:string[];error:string|null;}
type Instance={state:McpStatus;client:Client|null;transport:StdioClientTransport|null};
export class ManagedMcp{
 private readonly instances=new Map<string,Instance>();private readonly operations=new Map<string,Promise<unknown>>();private closing=false;
 constructor(private readonly store:StudioStore,private readonly registry:ProjectRegistry){}
 private entry(id:string){let value=this.instances.get(id);if(!value){value={state:{projectId:id,enabled:this.store.get('mcp-enabled:'+id)==='true',status:'stopped',pid:null,startedAt:null,lastCheckedAt:null,tools:[],error:null},client:null,transport:null};this.instances.set(id,value);}return value;}
 private serial<T>(id:string,work:()=>Promise<T>):Promise<T>{const previous=this.operations.get(id)??Promise.resolve();const next=previous.catch(()=>{}).then(work);this.operations.set(id,next);void next.finally(()=>{if(this.operations.get(id)===next)this.operations.delete(id);}).catch(()=>{});return next;}
 private async stop(value:Instance){const client=value.client;value.client=null;value.transport=null;value.state.status='stopped';value.state.pid=null;value.state.tools=[];if(client)await client.close();}
 async enable(id:string){this.registry.get(id);return this.serial(id,async()=>{
  if(this.closing)throw new Error('Studio is stopping');const project=this.registry.get(id),info=mcpInformation(project,this.store.home);if(!info.installed||!info.authorizationValid)throw new Error('Build and valid project authorization file required');
  const value=this.entry(id);if(value.state.status==='running')return{...value.state};await this.stop(value);this.store.set('mcp-enabled:'+id,'true');value.state={...value.state,enabled:true,status:'starting',error:null,lastCheckedAt:null,startedAt:null};
  const config=info.configuration.mcpServers.qaspider;const environment=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>typeof entry[1]==='string'));const transport=new StdioClientTransport({command:config.command,args:config.args,env:{...environment,QASPIDER_STUDIO_HOME:this.store.home},stderr:'pipe'});const client=new Client({name:'qaspider-studio-managed',version:'0.0.0'});value.client=client;value.transport=transport;
  client.onclose=()=>{if(value.client===client){value.client=null;value.transport=null;value.state={...value.state,status:'failed',pid:null,error:'Managed MCP process disconnected. Review project authorization and restart it.'};}};
  try{await client.connect(transport,{timeout:10000});transport.stderr?.on('data',()=>{});const tools=await client.listTools(undefined,{timeout:5000});await client.ping({timeout:3000});if(value.client!==client)throw new Error('MCP disconnected');value.state={...value.state,status:'running',pid:transport.pid,startedAt:Date.now(),lastCheckedAt:Date.now(),tools:tools.tools.map(t=>t.name)};}
  catch{await this.stop(value);value.state={...value.state,status:'failed',error:'MCP could not start or complete its health check. Review build and project authorization.'};}
  return{...value.state};
 });}
 async disable(id:string){return this.serial(id,async()=>{const value=this.entry(id);this.store.set('mcp-enabled:'+id,'false');value.state.enabled=false;await this.stop(value);value.state.error=null;return{...value.state};});}
 async status(id:string){this.registry.get(id);return this.serial(id,async()=>{const value=this.entry(id);if(value.state.status==='running'&&value.client){try{await value.client.ping({timeout:3000});value.state.lastCheckedAt=Date.now();}catch{await this.stop(value);value.state={...value.state,status:'failed',error:'MCP health check failed. Restart the managed service.'};}}return{...value.state};});}
 async restore(){for(const project of this.registry.list()){if(this.store.get('mcp-enabled:'+project.id)==='true')try{await this.enable(project.id);}catch{const value=this.entry(project.id);value.state={...value.state,status:'failed',error:'MCP startup blocked by invalid workspace, build or authorization.'};}}}
 async shutdown(){this.closing=true;await Promise.allSettled([...this.operations.values()]);await Promise.allSettled([...this.instances.values()].map(value=>this.stop(value)));}
}
