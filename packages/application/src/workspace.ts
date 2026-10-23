import {join,resolve} from 'node:path';
import {z} from 'zod';
import {originSchema} from '../../core/src/index.js';
import {SqliteStore,ArtifactStore} from '../../storage/src/index.js';
const reference=z.string().regex(/^[A-Z][A-Z0-9_]{1,99}$/);
export const workspaceInput=z.object({name:z.string().trim().min(1).max(120),origin:originSchema,environmentName:z.string().trim().min(1).max(100).default('Development'),references:z.object({adminEmail:reference,adminPassword:reference,userEmail:reference,userPassword:reference}).strict().optional()}).strict();
export function initializeWorkspace(workspace:string,name:string,origin:string,options:{environmentName?:string;references?:{adminEmail:string;adminPassword:string;userEmail:string;userPassword:string}}={}){
 const input=workspaceInput.parse({name,origin,...options});const directory=join(resolve(workspace),'.qaspider');const db=new SqliteStore(join(directory,'memory.db'));
 try{
  const existing=db.getEnvironment('development');if(existing&&(existing.allowedOrigins[0]!==input.origin||db.getApplication('benchmark')?.name!==input.name))throw new Error('Workspace already initialized with different configuration');
  db.transaction(()=>{
   if(!db.getApplication('benchmark'))db.createApplication({id:'benchmark',name:input.name});
   if(!existing)db.createEnvironment({id:'development',applicationId:'benchmark',name:input.environmentName,kind:'development',allowedOrigins:[input.origin]});
   for(const role of ['guest','admin','user'] as const)if(!db.getRole(role))db.createRole({id:role,environmentId:'development',name:role,auth:role==='guest'?{kind:'guest'}:{kind:'form',usernameEnv:input.references?.[role==='admin'?'adminEmail':'userEmail']??`QASPIDER_${role.toUpperCase()}_EMAIL`,passwordEnv:input.references?.[role==='admin'?'adminPassword':'userPassword']??`QASPIDER_${role.toUpperCase()}_PASSWORD`}});
  });new ArtifactStore(db,join(directory,'artifacts'));return{workspace:resolve(workspace),database:join(directory,'memory.db'),settings:db.getSettings()};
 }finally{db.close();}
}
