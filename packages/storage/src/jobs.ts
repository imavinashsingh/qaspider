import {trackRuntime} from './runtime.js';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { scopeSchema, type Scope, type OperationJob } from '../../core/src/index.js';
type Row={id:string;scope_json:string;kind:OperationJob['kind'];status:OperationJob['status'];created_at:number;updated_at:number;result_json:string|null};
export class SqliteOperationJobs {
 constructor(private readonly db:Database.Database){}
 private record(row:Row):OperationJob{return{id:row.id,scope:scopeSchema.parse(JSON.parse(row.scope_json)),kind:row.kind,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at,result:row.result_json?JSON.parse(row.result_json) as unknown:null};}
 create(scope:Scope,kind:OperationJob['kind']){return this.db.transaction(()=>{const id=randomUUID(),now=Date.now();this.db.prepare("INSERT INTO operation_jobs VALUES(?,?,?,'running',?,?,NULL)").run(id,JSON.stringify(scopeSchema.parse(scope)),kind,now,now);trackRuntime(this.db,'operation',id);return this.get(id)!;}).immediate();}
 get(id:string){const row=this.db.prepare('SELECT * FROM operation_jobs WHERE id=?').get(id) as Row|undefined;return row?this.record(row):undefined;}
 list(){return (this.db.prepare('SELECT * FROM operation_jobs ORDER BY created_at DESC').all() as Row[]).map(r=>this.record(r));}
 finish(id:string,status:OperationJob['status'],result:unknown){this.db.prepare("UPDATE operation_jobs SET status=?,updated_at=?,result_json=? WHERE id=? AND status='running'").run(status,Date.now(),JSON.stringify(result),id);return this.get(id)!;}
}
