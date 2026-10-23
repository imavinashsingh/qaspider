import {parseArgs}from'node:util';import{realpathSync}from'node:fs';import{join,resolve}from'node:path';
import{createInterface}from'node:readline/promises';
import{StudioStore}from'../../studio/src/store.js';import{StudioAuth}from'../../studio/src/auth.js';import{ProjectRegistry,studioHome}from'../../studio/src/projects.js';import{createStudioServer}from'../../studio/src/server.js';
export async function runStudioCli(args:string[],output:(line:string)=>void=console.log){try{
 const{values,positionals}=parseArgs({args,allowPositionals:true,options:{workspace:{type:'string'},port:{type:'string'},home:{type:'string'},'projects-root':{type:'string'},'confirm-local-recovery':{type:'boolean'},name:{type:'string'},id:{type:'string'}}});const[command,operation,...extra]=positionals;if(extra.length)throw new Error('Unexpected arguments');const home=resolve(values.home??studioHome());
 if(command==='projects'||operation==='recover'){
  const store=new StudioStore(home);try{const registry=new ProjectRegistry(store);if(command==='projects'){
   if(operation==='list')output(JSON.stringify(registry.list(true)));else if(operation==='register'&&values.workspace)output(JSON.stringify(registry.register(realpathSync(values.workspace),values.name??'Imported project')));else if(operation==='rename'&&values.id&&values.name)registry.rename(values.id,values.name);else if(operation==='archive'&&values.id)registry.archive(values.id);else throw new Error('Use projects list/register/rename/archive');
  }else{if(!values['confirm-local-recovery'])throw new Error('Recovery needs explicit local authorization');if(process.stdin.isTTY)throw new Error('Pipe a new password through stdin from a private local input source; it must not appear in command arguments');const input=createInterface({input:process.stdin});let password='';for await(const line of input){password=line;break;}input.close();await new StudioAuth(store).recover(password,true);output(JSON.stringify({status:'recovered',sessionsRevoked:true}));}return 0;}finally{store.close();}
 }
 if(!['studio','view'].includes(command??'')||operation)throw new Error('Use studio, view or projects');
 const roots=values['projects-root']?[realpathSync(values['projects-root'])]:[];const app=createStudioServer(home,roots);
 if(values.workspace){const workspace=realpathSync(values.workspace);const record=app.registry.register(workspace,values.name??'Local project');app.registry.select(record.id);}
 const port=Number(values.port??4318);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid Studio port');
 try{await new Promise<void>((resolve,reject)=>{app.server.once('error',reject);app.server.listen(port,'127.0.0.1',resolve);});output(JSON.stringify({status:'studio-ready',url:`http://127.0.0.1:${port}/`,projectRoot:roots[0]??null,registry:join(home,'studio.db')}));await new Promise<void>(resolve=>{const stop=()=>resolve();process.once('SIGINT',stop);process.once('SIGTERM',stop);});}finally{await app.shutdown();}return 0;
 }catch{output(JSON.stringify({status:'error',message:'Studio command rejected; check local paths, free port and explicit recovery authorization'}));return 1;}}
