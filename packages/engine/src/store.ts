import Database from 'better-sqlite3';
import {readFileSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {privateDirectory,assertNoSymlinks} from '../../storage/src/filesystem.js';
import type {StoryContext} from '../../core/src/index.js';
export type JobStatus='queued'|'running'|'complete'|'blocked'|'paused'|'cancelled'|'failed';
export interface EngineTask {id:string;projectId:string;title:string;context:StoryContext;markdown:string;sourceRef:string;storyId:string|null;planId:string|null;status:string;strategy:'intelligent'|'deep';}
export interface EngineJob {id:string;taskId:string;projectId:string;kind:'plan'|'execute';status:JobStatus;payload:Record<string,unknown>;result:Record<string,unknown>|null;owner:string|null;fence:number;leaseUntil:number|null;}
type Row=Record<string,unknown>;
export function contentHash(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
export function safeText(value:string){let result=value.replace(/\b(?:sk-[a-zA-Z0-9_-]+|Bearer\s+\S+)\b/g,'[redacted]').replace(/\b(password|otp|one.time.code|token|secret)\s*[:=]\s*\S+/gi,'$1=[redacted]');for(const [name,secret]of Object.entries(process.env))if(/(?:PASSWORD|TOKEN|SECRET|API_KEY)$/.test(name)&&secret&&secret.length>=8)result=result.split(secret).join('[redacted]');return result;}
export class EngineStore {
 readonly db:Database.Database;
 constructor(home:string){privateDirectory(home);const path=join(home,'engine.db');for(const s of ['','-wal','-shm'])assertNoSymlinks(path+s);this.db=new Database(path);chmodSync(path,0o600);this.db.pragma('journal_mode=WAL');this.db.pragma('foreign_keys=ON');this.db.pragma('busy_timeout=5000');
  this.db.exec('CREATE TABLE IF NOT EXISTS engine_schema(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL) STRICT');
  const sql=readFileSync(fileURLToPath(new URL('../migrations/001_orchestration.sql',import.meta.url)),'utf8'),checksum=contentHash(sql);
  this.atomic(()=>{const old=this.db.prepare('SELECT checksum FROM engine_schema WHERE version=1').get() as {checksum:string}|undefined;if(old){if(old.checksum!==checksum)throw new Error('Engine migration checksum mismatch');}else{this.db.exec(sql);this.db.prepare('INSERT INTO engine_schema VALUES(1,?)').run(checksum);}});
 }
 atomic<T>(work:()=>T):T{return this.db.transaction(work).immediate();}
 command<T>(projectId:string,key:string,payload:unknown,work:()=>T):T{return this.atomic(()=>{const old=this.db.prepare('SELECT * FROM engine_commands WHERE project_id=? AND command_key=?').get(projectId,key) as Row|undefined;const hash=contentHash(payload);if(old){if(old.content_hash!==hash)throw new Error('Idempotency key reused for a different command');return JSON.parse(String(old.result_json)) as T;}const result=work();this.db.prepare('INSERT INTO engine_commands VALUES(?,?,?,?)').run(projectId,key,hash,JSON.stringify(result));return result;});}
 private taskRow(row:Row):EngineTask{return{id:String(row.id),projectId:String(row.project_id),title:String(row.title),context:JSON.parse(String(row.context_json)) as StoryContext,markdown:String(row.markdown),sourceRef:String(row.source_ref),storyId:row.story_id?String(row.story_id):null,planId:row.plan_id?String(row.plan_id):null,status:String(row.status),strategy:row.strategy as EngineTask['strategy']};}
 task(id:string,projectId:string){const row=this.db.prepare('SELECT * FROM engine_tasks WHERE id=? AND project_id=?').get(id,projectId) as Row|undefined;if(!row)throw new Error('Unknown project task');return this.taskRow(row);}
 tasks(projectId:string){return(this.db.prepare('SELECT * FROM engine_tasks WHERE project_id=? ORDER BY created_at,rowid').all(projectId) as Row[]).map(r=>this.taskRow(r));}
 createTask(input:Omit<EngineTask,'id'|'planId'>){const id=randomUUID(),now=Date.now();this.db.prepare('INSERT INTO engine_tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,input.projectId,input.title,JSON.stringify(input.context),input.markdown,input.sourceRef,input.storyId,null,input.status,input.strategy,now,now);return this.task(id,input.projectId);}
 updateTask(id:string,patch:{status?:string;storyId?:string;planId?:string;markdown?:string}){this.db.prepare('UPDATE engine_tasks SET status=coalesce(?,status),story_id=coalesce(?,story_id),plan_id=coalesce(?,plan_id),markdown=coalesce(?,markdown),updated_at=? WHERE id=?').run(patch.status??null,patch.storyId??null,patch.planId??null,patch.markdown??null,Date.now(),id);}
 private jobRow(row:Row):EngineJob{return{id:String(row.id),taskId:String(row.task_id),projectId:String(row.project_id),kind:row.kind as EngineJob['kind'],status:row.status as JobStatus,payload:JSON.parse(String(row.payload_json)) as Record<string,unknown>,result:row.result_json?JSON.parse(String(row.result_json)) as Record<string,unknown>:null,owner:row.owner?String(row.owner):null,fence:Number(row.fence),leaseUntil:row.lease_until===null?null:Number(row.lease_until)};}
 job(id:string,projectId:string){const row=this.db.prepare('SELECT * FROM engine_jobs WHERE id=? AND project_id=?').get(id,projectId) as Row|undefined;if(!row)throw new Error('Unknown project job');return this.jobRow(row);}
 jobs(projectId?:string){return(this.db.prepare(`SELECT * FROM engine_jobs ${projectId?'WHERE project_id=?':''} ORDER BY created_at,rowid`).all(...(projectId?[projectId]:[])) as Row[]).map(r=>this.jobRow(r));}
 enqueue(task:EngineTask,kind:EngineJob['kind'],payload:Record<string,unknown>){return this.atomic(()=>{const id=randomUUID(),now=Date.now();this.db.prepare('INSERT INTO engine_jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,task.id,task.projectId,kind,'queued',JSON.stringify(payload),null,null,0,null,now,now);this.event(id,'JOB_QUEUED',{kind});return this.job(id,task.projectId);});}
 event(jobId:string,type:string,data:unknown){const row=this.db.prepare('SELECT project_id FROM engine_jobs WHERE id=?').get(jobId) as {project_id:string};const seq=this.db.prepare('SELECT coalesce(max(sequence),0)+1 AS n FROM engine_events WHERE job_id=?').get(jobId) as {n:number};this.db.prepare('INSERT INTO engine_events VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),jobId,row.project_id,seq.n,1,type,JSON.stringify(data),Date.now());}
 events(jobId:string,projectId:string,after=0){this.job(jobId,projectId);return(this.db.prepare('SELECT * FROM engine_events WHERE job_id=? AND project_id=? AND sequence>? ORDER BY sequence LIMIT 1000').all(jobId,projectId,after) as Row[]).map(r=>({id:r.id,jobId:r.job_id,projectId:r.project_id,sequence:r.sequence,version:r.version,type:r.type,data:JSON.parse(String(r.data_json)),createdAt:r.created_at}));}
 claim(owner:string,globalLimit:number,projectLimit:number,leaseMs:number){return this.atomic(()=>{
  const active=this.jobs().filter(j=>j.status==='running');if(active.length>=globalLimit)return null;
  for(const job of this.jobs().filter(j=>j.status==='queued')){
   if(active.filter(j=>j.projectId===job.projectId).length>=projectLimit)continue;
   if(this.db.prepare("SELECT 1 FROM engine_dependencies d JOIN engine_tasks t ON t.id=d.prerequisite_id WHERE d.task_id=? AND t.status<>'Reviewed' LIMIT 1").get(job.taskId))continue;
   const task=this.task(job.taskId,job.projectId);const resource=job.kind==='execute'?contentHash({projectId:job.projectId,environmentId:task.context.environmentId,tenant:task.context.tenant}):null;
   if(resource&&this.db.prepare('SELECT 1 FROM engine_locks WHERE resource=?').get(resource))continue;
   if(resource)this.db.prepare('INSERT INTO engine_locks VALUES(?,?)').run(resource,job.id);
   this.db.prepare("UPDATE engine_jobs SET status='running',owner=?,fence=fence+1,lease_until=?,updated_at=? WHERE id=? AND status='queued'").run(owner,Date.now()+leaseMs,Date.now(),job.id);this.event(job.id,'WORKER_CLAIMED',{});return this.job(job.id,job.projectId);
  }return null;
 });}
 valid(job:EngineJob){const current=this.job(job.id,job.projectId);return current.status==='running'&&current.owner===job.owner&&current.fence===job.fence&&(current.leaseUntil??0)>Date.now();}
 heartbeat(job:EngineJob,leaseMs:number){if(!this.valid(job))return false;return this.db.prepare("UPDATE engine_jobs SET lease_until=? WHERE id=? AND owner=? AND fence=? AND status='running'").run(Date.now()+leaseMs,job.id,job.owner,job.fence).changes===1;}
 finish(job:EngineJob,status:JobStatus,result:Record<string,unknown>,taskPatch:{status:string;planId?:string}){return this.atomic(()=>{if(!this.valid(job))return false;this.db.prepare('UPDATE engine_jobs SET status=?,result_json=?,lease_until=NULL,updated_at=? WHERE id=?').run(status,JSON.stringify(result),Date.now(),job.id);this.updateTask(job.taskId,taskPatch);if(status!=='blocked'||!this.db.prepare("SELECT 1 FROM engine_operations WHERE job_id=? AND state<>'checkpointed'").get(job.id))this.db.prepare('DELETE FROM engine_locks WHERE job_id=?').run(job.id);this.event(job.id,'JOB_'+status.toUpperCase(),result);return true;});}
 recover(){return this.atomic(()=>{for(const job of this.jobs().filter(j=>j.status==='running'&&(j.leaseUntil??0)<=Date.now())){this.db.prepare("UPDATE engine_jobs SET status='blocked',owner=NULL,fence=fence+1,lease_until=NULL WHERE id=?").run(job.id);this.updateTask(job.taskId,{status:'Blocked'});this.event(job.id,'RECOVERY_REQUIRED',{reason:'Expired worker lease; inspect checkpoint and uncertain external effects before resuming.'});/* Locks deliberately retained for uncertain external operations. */}});}
 request(taskId:string,kind:string,reason:string){const id=randomUUID();this.db.prepare("INSERT INTO engine_requests VALUES(?,?,?,?,'pending',NULL,?)").run(id,taskId,kind,safeText(reason),Date.now());return id;}
 requests(taskId:string,projectId:string){this.task(taskId,projectId);return this.db.prepare('SELECT * FROM engine_requests WHERE task_id=? ORDER BY created_at').all(taskId);}
 close(){this.db.close();}
}
