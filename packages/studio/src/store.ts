import Database from 'better-sqlite3';
import {readFileSync,chmodSync,existsSync} from 'node:fs';import {join} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {privateDirectory,assertNoSymlinks} from '../../storage/src/filesystem.js';
export class StudioStore {
 readonly db:Database.Database;
 constructor(readonly home:string){
  privateDirectory(home);const path=join(home,'studio.db');for(const suffix of ['', '-wal','-shm'])assertNoSymlinks(path+suffix);
  this.db=new Database(path);chmodSync(path,0o600);this.db.pragma('foreign_keys=ON');this.db.pragma('busy_timeout=5000');this.db.pragma('journal_mode=WAL');
  const sql=readFileSync(fileURLToPath(new URL('../migrations/001_studio.sql',import.meta.url)),'utf8');const checksum=createHash('sha256').update(sql).digest('hex');
  this.db.exec('CREATE TABLE IF NOT EXISTS studio_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL) STRICT');
  this.db.transaction(()=>{const row=this.db.prepare('SELECT checksum FROM studio_migrations WHERE version=1').get() as {checksum:string}|undefined;if(row){if(row.checksum!==checksum)throw new Error('Studio schema mismatch');}else{this.db.exec(sql);this.db.prepare('INSERT INTO studio_migrations VALUES(1,?)').run(checksum);}}).immediate();
  for(const suffix of ['-wal','-shm'])if(existsSync(path+suffix))chmodSync(path+suffix,0o600);
 }
 get(key:string):string|null{return (this.db.prepare('SELECT value FROM studio_values WHERE key=?').get(key) as {value:string}|undefined)?.value??null;}
 set(key:string,value:string){this.db.prepare('INSERT INTO studio_values VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);}
 close(){this.db.close();}
}
