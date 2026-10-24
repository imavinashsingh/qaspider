import type Database from 'better-sqlite3';
import {readFileSync} from 'node:fs';
type Kind='qa'|'test'|'navigation'|'operation';
function startMarker(pid:number):string {try{return readFileSync(`/proc/${pid}/stat`,'utf8').split(') ').slice(1).join(') ').split(' ')[19]??'unknown';}catch{return 'unknown';}}
const ownMarker=startMarker(process.pid);
export function trackRuntime(db:Database.Database,kind:Kind,id:string){db.prepare('INSERT INTO runtime_ownership VALUES(?,?,?,?,?)').run(kind,id,process.pid,ownMarker,Date.now());}
function ended(pid:number,marker:string){try{process.kill(pid,0);}catch(error){return (error as NodeJS.ErrnoException).code==='ESRCH';}const current=startMarker(pid);return current!=='unknown'&&marker!=='unknown'&&current!==marker;}
/** Never retries writes, prunes evidence or assumes a live process is abandoned. */
export function reconcileRuntime(db:Database.Database){return db.transaction(()=>{
 const recovered:string[]=[];
 const owners=db.prepare('SELECT * FROM runtime_ownership').all() as {kind:Kind;work_id:string;owner_pid:number;owner_start:string}[];
 for(const owner of owners){if(!ended(owner.owner_pid,owner.owner_start))continue;const id=owner.work_id,now=Date.now();let changed=0;
  if(owner.kind==='qa')changed=db.prepare("UPDATE qa_jobs SET status='interrupted',message='Owner process ended; review interrupted work and uncertain side effects before retrying',updated_at=? WHERE id=? AND status='running'").run(now,id).changes;
  if(owner.kind==='operation')changed=db.prepare("UPDATE operation_jobs SET status='interrupted',updated_at=?,result_json=? WHERE id=? AND status='running'").run(now,JSON.stringify({error:'Owner process ended; inspect retained evidence before retrying'}),id).changes;
  if(owner.kind==='navigation')changed=db.prepare("UPDATE navigation_runs SET status='blocked',finished_at=?,message='Owner process ended; navigation interrupted; historical evidence retained' WHERE id=? AND status='running'").run(now,id).changes;
  if(owner.kind==='test'){
   const run=db.prepare("SELECT selected_json FROM test_runs WHERE id=? AND status='running'").get(id) as {selected_json:string}|undefined;
   if(run){changed=db.prepare("UPDATE test_runs SET status='interrupted',finished_at=? WHERE id=? AND status='running'").run(now,id).changes;
    for(const scenario of JSON.parse(run.selected_json) as string[])db.prepare("UPDATE test_scenario_results SET status='INCONCLUSIVE' WHERE run_id=? AND scenario_id=? AND status='NOT RUN'").run(id,scenario);
    db.prepare("UPDATE fixture_reservations SET status='orphan',message='Interrupted owner; uncertain side effects require explicit operator reconciliation' WHERE run_id=? AND status IN ('reserved','created')").run(id);
   }
  }
  if(changed)recovered.push(id);
 }
 return recovered;
}).immediate();}
