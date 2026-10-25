import { useEffect, useState, type FormEvent } from 'react';
import type { ReviewReply } from './review-types.js';

interface Step { number: number; kind: string; selector?: string; evidenceId?: string; before?: { path: string }; after?: { path: string } }
interface Revision { id: string; number: number; status: string; execution_id: string; scenario_id: string; created_at: string; steps: Step[] }
interface Finding { id: string; revision_id: string; execution_id: string; scenario_id: string; step_number: number; evidence_id: string; reason: string }
interface Verification { id: string; outcome: string; reused_steps: number; metrics: { aiCalls: number; discoveryCalls: number; discoveryMs: number; totalTokens: number | null } }
interface Workflow { id: string; description: string; project: string; environment: string; role: string; application: string; revisions: Revision[]; findings: Finding[]; verifications: Verification[] }
export interface KnowledgeBridge {
  listKnowledge: (query: string) => Promise<ReviewReply<Workflow[]>>;
  knowledgeEvidence: (request: { executionId: string; scenarioId: string; evidenceId: string }) => Promise<ReviewReply<{ screenshot: string; url: string }>>;
}
export function Knowledge() {
  const [query, setQuery] = useState(''), [workflows, setWorkflows] = useState<Workflow[]>([]), [message, setMessage] = useState(''), [evidence, setEvidence] = useState<{ screenshot: string; url: string } | null>(null);
  async function load(event?: FormEvent) {
    event?.preventDefault();
    try { const reply = await window.qaspider.listKnowledge(query); if (reply.status === 'ok') { setWorkflows(reply.value); setMessage(reply.value.length ? '' : 'No workflows found. Complete an approved execution to collect evidence.'); } else setMessage(reply.message); }
    catch { setMessage('Knowledge could not be loaded.'); }
  }
  useEffect(() => { void load(); }, []);
  async function show(executionId: string, scenarioId: string, evidenceId: string) {
    try { const reply = await window.qaspider.knowledgeEvidence({ executionId, scenarioId, evidenceId }); if (reply.status === 'ok') setEvidence(reply.value); else setMessage(reply.message); }
    catch { setMessage('Evidence could not be loaded.'); }
  }
  return <section aria-label="Application knowledge" data-testid="knowledge" className="workspace">
    <div className="intro"><p className="eyebrow">APPLICATION KNOWLEDGE</p><h2>Verified workflows. Visible changes.</h2><p>Operational knowledge comes from execution evidence. Each ticket keeps its own approved expectations.</p></div>
    <form onSubmit={event => void load(event)} className="card"><label htmlFor="knowledge-search">Search workflows</label><div className="input-row"><input id="knowledge-search" value={query} maxLength={500} onChange={event => setQuery(event.target.value)} placeholder="contact, registration, CLICK…"/><button>Refresh knowledge</button></div></form>
    <p role="status">{message}</p>
    {workflows.map(workflow => <article className="card knowledge-workflow" key={workflow.id}>
      <h3>{workflow.description}</h3><strong>{workflow.revisions[0]?.status}{workflow.findings.some(item => item.revision_id === workflow.revisions[0]?.id) ? ' · REUSE SUSPENDED' : ''}</strong>
      <p>{workflow.project} · {workflow.environment} · {workflow.role} · {workflow.application}</p>
      <p>{workflow.verifications.length} verifications · {workflow.verifications.reduce((sum, item) => sum + item.reused_steps, 0)} reused steps · {workflow.verifications.reduce((sum, item) => sum + item.metrics.discoveryCalls, 0)} discovery calls</p>
      {workflow.findings.length > 0 && <div role="note"><h4>Unexpected application changes · human review required</h4>{workflow.findings.map(finding => <p key={finding.id}>Step {finding.step_number}: {finding.reason} <button className="secondary" onClick={() => void show(finding.execution_id, finding.scenario_id, finding.evidence_id)}>View original divergence evidence</button></p>)}</div>}
      <details><summary>Revision history and evidence ({workflow.revisions.length})</summary>{workflow.revisions.map(revision => <div className="action-run" key={revision.id}><h4>Revision {revision.number} · {revision.status}</h4><small>{revision.created_at} · execution {revision.execution_id} · scenario {revision.scenario_id}</small><ol>{revision.steps.map(step => <li key={step.number}>{step.kind} {step.selector} {step.before?.path} → {step.after?.path} {step.evidenceId && <button className="secondary" onClick={() => void show(revision.execution_id, revision.scenario_id, step.evidenceId!)}>View step {step.number} evidence</button>}</li>)}</ol></div>)}</details>
      <details><summary>Verification and reuse statistics</summary>{workflow.verifications.map(item => <p key={item.id}>{item.outcome} · {item.reused_steps} reused · {item.metrics.aiCalls} AI calls · {item.metrics.discoveryMs.toFixed(1)} ms discovery · {item.metrics.totalTokens ?? 'unknown'} tokens</p>)}</details>
    </article>)}
    {evidence && <figure className="card"><button className="secondary" onClick={() => setEvidence(null)}>Close evidence</button><img src={evidence.screenshot} alt="Persisted workflow execution evidence"/><figcaption>{evidence.url}</figcaption></figure>}
  </section>;
}
