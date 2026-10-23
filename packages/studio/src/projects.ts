import {randomUUID} from 'node:crypto';import{homedir}from'node:os';
import{realpathSync,existsSync,mkdirSync,rmSync,statSync}from'node:fs';import{join,resolve,relative,isAbsolute,sep}from'node:path';import{z}from'zod';
import{StudioStore}from'./store.js';import{SqliteStore}from'../../storage/src/index.js';import{assertNoSymlinks}from'../../storage/src/filesystem.js';import{initializeWorkspace,workspaceInput}from'../../application/src/workspace.js';
const nameSchema=z.string().trim().min(1).max(120);const createSchema=workspaceInput.extend({directory:z.string().min(1).max(240).optional()}).strict();
export interface Project{id:string;name:string;path:string;createdAt:number;lastOpenedAt:number|null;archived:boolean;status?:'available'|'unavailable';}
export function studioHome(env:NodeJS.ProcessEnv=process.env){return resolve(env.QASPIDER_STUDIO_HOME??join(env.HOME??homedir(),'.local/share/qaspider/studio'));}
export class ProjectRegistry{
 readonly roots:string[];
 constructor(readonly store:StudioStore,roots:string[]=[]){this.roots=roots.map(p=>{const path=resolve(p);assertNoSymlinks(path);if(!statSync(path).isDirectory())throw new Error('Project root must exist');return realpathSync(path);});}
 private row(row:Record<string,unknown>):Project{let status:'available'|'unavailable'='unavailable';try{assertNoSymlinks(String(row.path));if(existsSync(join(String(row.path),'.qaspider/memory.db')))status='available';}catch{}return{id:String(row.id),name:String(row.name),path:String(row.path),createdAt:Number(row.created_at),lastOpenedAt:row.last_opened_at===null?null:Number(row.last_opened_at),archived:!!row.archived,status};}
 list(includeArchived=false):Project[]{return(this.store.db.prepare(`SELECT * FROM projects ${includeArchived?'':'WHERE archived=0'} ORDER BY last_opened_at DESC,created_at`).all()as Record<string,unknown>[]).map(r=>this.row(r));}
 get(id:string):Project{const item=this.list().find(p=>p.id===id);if(!item)throw new Error('Unknown active project');this.validate(item.path);return item;}
 private validate(path:string){assertNoSymlinks(path);const dbPath=join(path,'.qaspider/memory.db');assertNoSymlinks(dbPath);if(!existsSync(dbPath)||!statSync(dbPath).isFile())throw new Error('Invalid workspace');const db=new SqliteStore(dbPath);try{if(!db.listApplications().length||!db.listEnvironments().length)throw new Error('Workspace is not initialized');}finally{db.close();}}
 register(path:string,name:string):Project{
  nameSchema.parse(name);const absolute=resolve(path);this.validate(absolute);const canonical=realpathSync(absolute);const known=this.list(true).find(p=>p.path===canonical);if(known){this.store.db.prepare('UPDATE projects SET archived=0 WHERE id=?').run(known.id);return this.get(known.id);}
  const id=randomUUID();this.store.db.prepare('INSERT INTO projects(id,name,path,created_at) VALUES(?,?,?,?)').run(id,name,canonical,Date.now());return this.get(id);
 }
 browserPath(input:string,creating=false){if(!input||input.split(/[\\/]/).includes('..')||input.includes('\0'))throw new Error('Invalid project path');const path=isAbsolute(input)?resolve(input):resolve(this.roots[0]??'/invalid-root',input);assertNoSymlinks(path);if(!this.roots.some(root=>{const rel=relative(root,path);return rel!==''&&!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel);}))throw new Error('Project path must be below an approved directory');if(!creating&&!existsSync(path))throw new Error('Missing workspace');return path;}
 importPath(path:string,name:string){return this.register(this.browserPath(path),name);}
 create(value:unknown):Project{const input=createSchema.parse(value),path=this.browserPath(input.directory??((input.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||'project')+'-'+randomUUID().slice(0,8)),true);if(existsSync(path))throw new Error('New workspace directory must not exist');mkdirSync(path,{mode:0o700});try{initializeWorkspace(path,input.name,input.origin,{environmentName:input.environmentName,...(input.references?{references:input.references}:{})});return this.register(path,input.name);}catch(error){rmSync(path,{recursive:true,force:true});throw error;}}
 rename(id:string,name:string){name=nameSchema.parse(name);this.get(id);this.store.db.prepare('UPDATE projects SET name=? WHERE id=?').run(name,id);}
 archive(id:string){if(!this.list().some(p=>p.id===id))throw new Error('Unknown project');this.store.db.prepare('UPDATE projects SET archived=1 WHERE id=?').run(id);if(this.selected()===id)this.store.set('selected-project','');}
 select(id:string){this.get(id);this.store.db.prepare('UPDATE projects SET last_opened_at=? WHERE id=?').run(Date.now(),id);this.store.set('selected-project',id);}
 selected(){const id=this.store.get('selected-project');return this.list().some(p=>p.id===id)?id:null;}
}
