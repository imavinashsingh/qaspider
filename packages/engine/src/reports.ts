import {randomUUID} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {z} from 'zod';
import {classifyAttempts,type Outcome} from '../../core/src/index.js';
import type {EngineContext} from '../../studio/src/server.js';
import type {QaService} from '../../qa/src/service.js';
import {authorize,type Principal} from './auth.js';
import {jsonBody,send} from './api.js';
import {EngineStore,contentHash,safeText} from './store.js';
import {Coordinator} from './coordinator.js';
type Row=Record<string,unknown>;
const note=z.string().trim().min(3).max(4000).refine(v=>safeText(v)===v,'Use nonsecret rationale');
const commandKey=z.string().min(8).max(200);
const escape=(s:unknown)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function combine(statuses:Outcome[]):Outcome {if(!statuses.length)return 'NOT RUN';for(const state of ['FAIL','BLOCKED','INCONCLUSIVE','FLAKY','NOT RUN'] as const)if(statuses.includes(state))return state;return 'PASS';}
export class Reports {
 constructor(readonly store:EngineStore,readonly coordinator:Coordinator){}
 report(projectId:string,taskId:string,qa:QaService){
  const task=this.store.task(taskId,projectId),jobs=this.store.jobs(projectId).filter(j=>j.taskId===taskId);
  const latest=jobs.filter(j=>typeof j.result?.runId==='string').at(-1),runId=typeof latest?.result?.runId==='string'?latest.result.runId:null;
  const execution=runId?qa.store.testing.report(runId):undefined,requestedStory=task.storyId?qa.store.testing.getStory(task.storyId):undefined;
  const reviews=this.store.db.prepare('SELECT * FROM engine_review_decisions WHERE task_id=? ORDER BY created_at,rowid').all(taskId) as Row[];
  const review=(kind:string,id:string)=>reviews.filter(r=>r.subject_kind===kind&&r.subject_id===id).at(-1)??null;
  const investigations=this.store.db.prepare('SELECT * FROM engine_investigations WHERE task_id=? ORDER BY created_at,rowid').all(taskId) as Row[];
  const findings=investigations.map(row=>({id:String(row.id),runId:String(row.run_id),scenarioId:String(row.scenario_id),classification:String(row.classification),confidence:String(row.confidence),rationale:String(row.rationale),evidenceIds:JSON.parse(String(row.evidence_json)) as string[],investigationRunId:row.investigation_run_id?String(row.investigation_run_id):null,review:review('finding',String(row.id))}));
  for(const result of execution?.results.filter(r=>r.status!=='PASS')??[]){if(findings.some(f=>f.runId===execution!.run.id&&f.scenarioId===result.scenarioId))continue;const id='unclassified:'+execution!.run.id+':'+result.scenarioId;findings.push({id,runId:execution!.run.id,scenarioId:result.scenarioId,classification:'inconclusive',confidence:'low',rationale:result.attempts.map(a=>a.reason).join(' ')||'Not executed; no passing evidence',evidenceIds:result.attempts.flatMap(a=>a.evidenceIds),investigationRunId:null,review:review('finding',id)});}
  const changes=(this.store.db.prepare('SELECT * FROM engine_observed_changes WHERE task_id=? ORDER BY created_at,rowid').all(taskId) as Row[]).map(row=>({...row,id:String(row.id),kind:String(row.kind),previous:JSON.parse(String(row.previous_json)) as unknown,current:JSON.parse(String(row.current_json)) as unknown,evidenceIds:JSON.parse(String(row.evidence_json)) as string[],review:review('change',String(row.id))}));
  const equivalence=this.store.db.prepare('SELECT * FROM engine_regression_links WHERE task_id=? AND requested_story_id=?').get(taskId,task.storyId) as Row|undefined;
  const compatibleSource=!!execution&&(task.planId===null||task.planId===execution.plan.id)&&(execution.story.id===task.storyId||!!requestedStory&&equivalence?.reused_plan_id===execution.plan.id&&equivalence.equivalence_hash===contentHash({context:requestedStory.context,requirements:requestedStory.requirements.filter(r=>r.origin==='specified').map(r=>r.text).sort()}));
  const assumptions=(requestedStory?.requirements??[]).filter(r=>r.origin==='ai-inferred'&&!r.approved);
  const coverage=(requestedStory?.requirements??[]).filter(r=>r.origin==='specified'||r.approved).map(req=>{
   const source=compatibleSource?execution?.story.requirements.find(old=>old.text===req.text&&old.origin===req.origin):undefined;
   const cases=source?execution!.plan.proposal.scenarios.filter(s=>s.requirementIds.includes(source.id)):[];
   const statuses=cases.map(s=>{const result=execution!.results.find(r=>r.scenarioId===s.id);if(!result)return 'NOT RUN' as Outcome;
    return classifyAttempts(result.attempts.map(attempt=>{const assertions=attempt.assertions.filter(a=>a.requirementId===source!.id);return assertions.length?assertions.some(a=>a.status==='FAIL')?'FAIL':assertions.some(a=>a.status==='INCONCLUSIVE')?'INCONCLUSIVE':'PASS':attempt.status==='PASS'?'INCONCLUSIVE':attempt.status;}));
   });return {id:req.id,key:req.key,text:req.text,sourceRef:req.sourceRef,origin:req.origin,scenarioIds:cases.map(s=>s.id),outcome:combine(statuses)};
  });
  const requestHistory=this.store.requests(taskId,projectId) as Row[];const pendingRequests=requestHistory.filter(r=>r.status==='pending'&&!(r.kind==='plan-review'&&task.planId&&qa.store.testing.getPlan(task.planId)?.status==='approved'));
  const history=jobs.filter(j=>typeof j.result?.runId==='string').map(j=>({jobId:j.id,runId:String(j.result!.runId),status:j.status}));
  const retests=this.store.db.prepare('SELECT * FROM engine_retests WHERE task_id=? ORDER BY created_at,rowid').all(taskId) as Row[];
  const expectationRevisions=this.store.db.prepare('SELECT * FROM engine_expectation_revisions WHERE task_id=? ORDER BY created_at,rowid').all(taskId) as Row[];
  const evidenceIds=[...new Set([...(execution?.results.flatMap(r=>r.attempts.flatMap(a=>a.evidenceIds))??[]),...findings.flatMap(f=>f.evidenceIds),...changes.flatMap(c=>c.evidenceIds)])];
  const evidence=evidenceIds.map(id=>{const artifact=qa.store.getArtifact(id);return{id,kind:artifact?.kind??'unknown',status:artifact?.status??'unavailable',sizeBytes:artifact?.sizeBytes??0,url:artifact?.kind==='trace'||artifact?.status!=='available'?null:`/api/v1/projects/${projectId}/evidence?runId=${encodeURIComponent(artifact.runId)}&id=${encodeURIComponent(id)}`};});
  const version=contentHash({evidence:evidence.map(e=>({id:e.id,status:e.status})),jobIds:jobs.map(j=>j.id),taskPlanId:task.planId,taskId,storyId:task.storyId,runId,planHash:execution?.plan.hash,results:execution?.results,coverage,findings:findings.map(f=>({id:f.id,reviewId:f.review?.id})),changes:changes.map(c=>({id:c.id,reviewId:c.review?.id})),expectationRevisionIds:expectationRevisions.map(r=>r.id)});
  const signoffs=this.store.db.prepare('SELECT * FROM engine_signoffs WHERE task_id=? ORDER BY created_at,rowid').all(taskId) as Row[],last=signoffs.at(-1);
  const reviewState=last?last.report_hash!==version?'stale':last.decision==='approve'?'QA Approved':'QA Withheld':'Awaiting Human Review';
  const gaps=coverage.filter(c=>c.outcome!=='PASS');const unresolvedFindings=findings.filter(f=>!['rejected-defect','resolved-after-retest'].includes(String(f.review?.decision)));
  const unresolvedChanges=changes.filter(c=>!['expected-change','unexpected-change'].includes(String(c.review?.decision)));
  const canApprove=!jobs.some(j=>j.status==='queued'||j.status==='running')&&compatibleSource&&!!execution&&execution.run.status==='complete'&&coverage.length>0&&!gaps.length&&Object.entries(execution.summary).every(([key,value])=>key==='PASS'||value===0)&&!unresolvedFindings.length&&!unresolvedChanges.length&&evidence.every(e=>e.status==='available');
  const approvalBlockers=[...(!compatibleSource?['No execution for the current approved source/plan']:[]),...(jobs.some(j=>j.status==='queued'||j.status==='running')?['Ticket work is still active']:[]),...(gaps.length?[`${gaps.length} criteria have incomplete or non-passing coverage`]:[]),...(unresolvedFindings.length?[`${unresolvedFindings.length} findings need resolution`]:[]),...(unresolvedChanges.length?[`${unresolvedChanges.length} workflow changes need classification`]:[]),...(evidence.some(e=>e.status!=='available')?['Supporting evidence is unavailable']:[])];
  return {schemaVersion:1,projectId,task,reportHash:version,agentWorkState:task.status,humanReviewState:reviewState,canApprove,approvalBlockers,assumptions,executionSourceCompatible:compatibleSource,summary:compatibleSource&&execution?execution.summary:{'PASS':0,'FAIL':0,'BLOCKED':0,'INCONCLUSIVE':0,'FLAKY':0,'NOT RUN':coverage.length},coverage,coverageGaps:gaps,findings,incidentalChanges:changes,requests:pendingRequests,requestHistory,execution:execution??null,investigations,evidence,history,retests,reviews,signoffs,expectationRevisions,jobs,recommendation:canApprove?'Evidence is ready for an authorized human signoff.':'Review findings, changes and gaps; agent completion does not imply QA approval.'};
 }
 export(report:ReturnType<Reports['report']>,format:'json'|'markdown'|'html'|'junit',layer:'summary'|'investigation'|'technical'){
  const summary={taskId:report.task.id,title:report.task.title,agentWorkState:report.agentWorkState,humanReviewState:report.humanReviewState,summary:report.summary,canApprove:report.canApprove,approvalBlockers:report.approvalBlockers,assumptions:report.assumptions,coverage:report.coverage,findings:report.findings,incidentalChanges:report.incidentalChanges,coverageGaps:report.coverageGaps,requests:report.requests,recommendation:report.recommendation,reportHash:report.reportHash};
  const data=layer==='technical'?report:layer==='investigation'?{...summary,execution:report.execution,investigations:report.investigations,reviews:report.reviews,history:report.history,retests:report.retests}:summary;
  if(format==='json')return {mimeType:'application/json',content:JSON.stringify(data,null,2)};
  if(format==='junit'){
   const results=report.execution?.results??[];const cases=results.map(r=>{const scenario=report.execution!.plan.proposal.scenarios.find(s=>s.id===r.scenarioId)!;const result=r.status==='PASS'?'':r.status==='FAIL'?`<failure message="${escape(r.attempts.at(-1)?.reason??'Assertion failed')}">${escape(JSON.stringify(r.attempts))}</failure>`:`<skipped message="${escape(r.status)}"/>`;return `<testcase classname="${escape(report.task.id)}" name="${escape(scenario.title)}">${result}<system-out>${escape(JSON.stringify({status:r.status,evidenceIds:r.attempts.flatMap(a=>a.evidenceIds)}))}</system-out></testcase>`;});
   if(!results.length)cases.push('<testcase name="No completed execution"><skipped message="NOT RUN"/></testcase>');
   return {mimeType:'application/xml',content:`<?xml version="1.0" encoding="UTF-8"?><testsuite name="${escape(report.task.title)}" tests="${cases.length}" failures="${report.summary.FAIL}" skipped="${results.length?results.filter(r=>!['PASS','FAIL'].includes(r.status)).length:1}"><properties><property name="qaspider.humanReviewState" value="${escape(report.humanReviewState)}"/><property name="qaspider.reportHash" value="${escape(report.reportHash)}"/></properties>${cases.join('')}</testsuite>`};
  }
  if(format==='html')return {mimeType:'text/html; charset=utf-8',content:`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(report.task.title)} QA report</title><body><h1>${escape(report.task.title)}</h1><p>Agent: ${escape(report.agentWorkState)}. Human review: ${escape(report.humanReviewState)}.</p><p>${escape(report.recommendation)}</p><pre>${escape(JSON.stringify(data,null,2))}</pre></body></html>`};
  return {mimeType:'text/markdown; charset=utf-8',content:`# ${report.task.title.replace(/[<>\r\n]/g,' ')}\n\nAgent work: ${report.agentWorkState}\n\nHuman review: ${report.humanReviewState}\n\n${report.recommendation}\n\n\`\`\`json\n${JSON.stringify(data,null,2).replace(/`/g,'\\u0060')}\n\`\`\`\n`};
 }
 async handle(request:IncomingMessage,response:ServerResponse,context:EngineContext,principal:Principal){
  const url=new URL(request.url??'/','http://engine'),match=/^\/api\/v1\/projects\/([a-f0-9-]{36})\/(ticket-report|report-export|review-finding|qa-signoff|task-retest|revise-expectation|rollback-expectation|handoff)$/.exec(url.pathname);if(!match)return false;
  const projectId=z.string().uuid().parse(match[1]),operation=match[2]!;authorize(principal,projectId,request.method==='GET'?'read':operation==='task-retest'?'execute':'review');
  const backend=await context.project(projectId),qa=backend.viewer.application.qa;
  if(request.method==='GET'){
   if(operation==='handoff'){send(response,this.store.tasks(projectId).map(task=>{const report=this.report(projectId,task.id,qa);return{taskId:task.id,title:task.title,status:task.status,summary:report.summary,humanReviewState:report.humanReviewState,findings:report.findings,incidentalChanges:report.incidentalChanges,requests:report.requests,coverageGaps:report.coverageGaps,knowledgeGained:report.incidentalChanges.filter(c=>c.kind==='workflow-changed').map(c=>c.current)};}));return true;}
   const report=this.report(projectId,url.searchParams.get('id')??'',qa);
   if(operation==='ticket-report')send(response,report);
   else if(operation==='report-export'){const format=z.enum(['json','markdown','html','junit']).parse(url.searchParams.get('format')??'json'),layer=z.enum(['summary','investigation','technical']).parse(url.searchParams.get('layer')??'summary');send(response,{format,layer,...this.export(report,format,layer)});}
   else send(response,{error:'Method not allowed'},405);return true;
  }
  if(request.method!=='POST'){send(response,{error:'Method not allowed'},405);return true;}
  const data=await jsonBody(request);
  if(operation==='review-finding'){
   const v=z.object({taskId:z.string().uuid(),reportHash:z.string(),subjectKind:z.enum(['finding','change']),subjectId:z.string(),decision:z.enum(['confirmed-defect','rejected-defect','inconclusive','resolved-after-retest','expected-change','unexpected-change','unknown']),reason:note,authoritySource:note.optional(),commandKey}).strict().parse(data);
   const cached=this.store.cached(projectId,v.commandKey,v);if(cached!==undefined){send(response,cached);return true;}
   const report=this.report(projectId,v.taskId,qa);if(report.reportHash!==v.reportHash)throw new Error('Report changed; inspect current evidence');
   const subject=v.subjectKind==='finding'?report.findings.find(f=>f.id===v.subjectId):report.incidentalChanges.find(c=>c.id===v.subjectId);if(!subject)throw new Error('Unknown scoped finding');
   if(v.subjectKind==='finding'&&!['confirmed-defect','rejected-defect','inconclusive','resolved-after-retest'].includes(v.decision)||v.subjectKind==='change'&&!['expected-change','unexpected-change','unknown','inconclusive'].includes(v.decision))throw new Error('Decision does not match subject');
   if(v.decision==='expected-change'&&!v.authoritySource)throw new Error('Expected changes need an authoritative source');
   if(v.decision==='resolved-after-retest'){const finding=report.findings.find(f=>f.id===v.subjectId)!;if(!report.execution||report.execution.run.id===finding.runId||report.execution.results.find(r=>r.scenarioId===finding.scenarioId)?.status!=='PASS')throw new Error('A linked fresh passing retest is required');}
   send(response,this.store.command(projectId,v.commandKey,v,()=>{const id=randomUUID(),previous=report.reviews.filter(r=>r.subject_kind===v.subjectKind&&r.subject_id===v.subjectId).at(-1);this.store.db.prepare('INSERT INTO engine_review_decisions VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,v.taskId,v.subjectKind,v.subjectId,v.decision,principal.id,v.reason,v.authoritySource??null,previous?.id??null,Date.now());this.store.updateTask(v.taskId,{status:'Ready for Review'});return{id};}));
  }else if(operation==='qa-signoff'){
   const v=z.object({taskId:z.string().uuid(),reportHash:z.string(),decision:z.enum(['approve','withhold']),reason:note,commandKey}).strict().parse(data);const cached=this.store.cached(projectId,v.commandKey,v);if(cached!==undefined){send(response,cached);return true;}const report=this.report(projectId,v.taskId,qa);if(report.reportHash!==v.reportHash||!report.execution)throw new Error('Current execution/report required');if(v.decision==='approve'&&!report.canApprove)throw new Error('Incomplete coverage, evidence or unresolved findings prohibit approval');
   send(response,this.store.command(projectId,v.commandKey,v,()=>{const id=randomUUID(),prior=report.signoffs.at(-1);this.store.db.prepare('INSERT INTO engine_signoffs VALUES(?,?,?,?,?,?,?,?,?)').run(id,v.taskId,report.execution!.run.id,report.reportHash,v.decision,principal.id,v.reason,prior?.id??null,Date.now());this.store.updateTask(v.taskId,{status:v.decision==='approve'?'Reviewed':'Ready for Review'});return{id,decision:v.decision};}));
  }else if(operation==='task-retest'){
   const v=z.object({taskId:z.string().uuid(),originalRunId:z.string(),reason:note,commandKey}).strict().parse(data);const cached=this.store.cached(projectId,v.commandKey,v);if(cached!==undefined){send(response,cached);return true;}const task=this.store.task(v.taskId,projectId),original=qa.store.testing.report(v.originalRunId);
   if(!original||!this.store.jobs(projectId).some(j=>j.taskId===task.id&&j.result?.runId===v.originalRunId)||original.plan.storyRevisionId!==task.storyId&&!this.coordinator.knowledge.canReuse(task,original.plan.id,qa))throw new Error('Retest needs a linked compatible approved task plan');
   send(response,this.store.command(projectId,v.commandKey,v,()=>{if(this.store.jobs(projectId).some(j=>j.taskId===task.id&&['running','queued'].includes(j.status)))throw new Error('Ticket already active');const job=this.store.enqueue(task,'execute',{planId:original.plan.id,originalRunId:v.originalRunId});this.store.db.prepare('INSERT INTO engine_retests VALUES(?,?,?,?,?,?,?)').run(randomUUID(),task.id,v.originalRunId,job.id,principal.id,v.reason,Date.now());this.store.updateTask(task.id,{status:'Queued'});return job;}),202);this.coordinator.tick();
  }else if(operation==='revise-expectation'||operation==='rollback-expectation'){
   const v=z.object({taskId:z.string().uuid(),expectedStoryId:z.string(),requirementKey:z.string().regex(/^AC-[\w-]+$/),newText:note.refine(t=>!/[\r\n]/.test(t)),authoritySource:note,authorityConfirmed:z.literal(true),reason:note,parentRevisionId:z.string().uuid().optional(),commandKey}).strict().parse(data);const cached=this.store.cached(projectId,v.commandKey,v);if(cached!==undefined){send(response,cached);return true;}const task=this.store.task(v.taskId,projectId),story=task.storyId?qa.store.testing.getStory(task.storyId):null;if(!story||story.id!==v.expectedStoryId)throw new Error('Current source revision required');const req=story.requirements.find(r=>r.key===v.requirementKey&&r.origin==='specified');if(!req)throw new Error('Unknown authoritative requirement');
   if(operation==='rollback-expectation'){const prior=this.store.db.prepare('SELECT * FROM engine_expectation_revisions WHERE id=? AND task_id=?').get(v.parentRevisionId??'',task.id) as Row|undefined;if(!prior||prior.new_story_id!==story.id||prior.requirement_key!==req.key||prior.previous_text!==v.newText)throw new Error('Rollback must restore the immediately linked prior expectation');}
   const line=Number(/#L(\d+)$/.exec(req.sourceRef)?.[1])-1,lines=story.markdown.split(/\r?\n/);if(!Number.isInteger(line)||line<0||line>=lines.length)throw new Error('Source location unavailable');lines[line]=`- ${req.key}: ${v.newText}`;
   send(response,this.store.command(projectId,v.commandKey,v,()=>{if(this.store.jobs(projectId).some(j=>j.taskId===task.id&&['queued','running'].includes(j.status)))throw new Error('Pause and reconcile active work before changing authoritative expectations');const next=qa.store.testing.importStory(lines.join('\n'),v.authoritySource,story.context,story.storyId),id=randomUUID();this.store.db.prepare('INSERT INTO engine_expectation_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,task.id,req.key,story.id,next.id,req.text,v.newText,v.authoritySource,principal.id,v.reason,v.parentRevisionId??null,Date.now());this.store.updateTask(task.id,{storyId:next.id,markdown:next.markdown,status:'Needs Permission'});return {id,storyId:next.id,status:'New source revision requires a new reviewed plan and execution'};}));
  }else send(response,{error:'Unknown review operation'},404);
  return true;
 }
}
