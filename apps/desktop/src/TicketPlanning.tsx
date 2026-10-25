import { useEffect, useState, type FormEvent } from 'react';
import { PlanReview } from './PlanReview.js';
import type { ReviewBridge, ReviewSnapshot, SavedPlan } from './review-types.js';
export interface TicketInput { title: string; description: string; acceptanceCriteria: string[] }
interface Coverage { applicability: 'included' | 'not_applicable' | 'unspecified'; reason: string }
export interface TicketPlan {
  version: 1; status: 'draft'; proposalSource: 'ai';
  ticket: Omit<TicketInput, 'acceptanceCriteria'> & { acceptanceCriteria: { id: string; text: string }[] };
  assumptions: { id: string; description: string }[];
  criteria: { criterionId: string; interpretation: 'testable' | 'ambiguous' | 'unsupported'; explanation: string; negativeTests: Coverage; boundaryTests: Coverage }[];
  scenarios: {
    id: string; criterionId: string; category: 'positive' | 'negative' | 'boundary'; title: string;
    assumptionIds: string[]; preconditions: string[]; steps: { instruction: string; expectedOutcome: string }[];
    assertions: { kind: 'behavior' | 'text' | 'url' | 'visibility'; description: string; exactValue: string | null; sourceQuote: string | null }[];
  }[];
}
export interface TicketPlanResult {
  status: 'proposed' | 'invalid-ticket' | 'unavailable' | 'invalid-output'; message: string; plan?: TicketPlan;
  provider?: { provider: string; model: string; synthetic: boolean };
  review?: ReviewSnapshot;
}
export interface TicketBridge extends ReviewBridge { proposeTicketPlan: (ticket: TicketInput) => Promise<TicketPlanResult> }

export function TicketPlanning() {
  const [title, setTitle] = useState('Validate registration form');
  const [description, setDescription] = useState('Check registration using an email address.');
  const [criteria, setCriteria] = useState('Email is required.\nDuplicate email addresses must be rejected.\nValid registration should succeed.');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TicketPlanResult | null>(null);
  const [saved, setSaved] = useState<ReviewSnapshot | null>(null);
  const [plans, setPlans] = useState<SavedPlan[]>([]);
  const [storageMessage, setStorageMessage] = useState('');
  const plan = result?.plan;
  async function refreshPlans() {
    const response = await window.qaspider.listPlans();
    if (response.status === 'ok') setPlans(response.value);
    else setStorageMessage(response.message);
  }
  async function openPlan(planId: string, revision?: number) {
    setBusy(true); setStorageMessage('');
    try {
      const response = await window.qaspider.getPlan(revision === undefined ? { planId } : { planId, revision });
      if (response.status !== 'ok') { setStorageMessage(response.message); return; }
      setSaved(response.value); setResult(null);
      setTitle(response.value.original.ticket.title); setDescription(response.value.original.ticket.description);
      setCriteria(response.value.original.ticket.acceptanceCriteria.map(item => item.text).join('\n'));
    } catch { setStorageMessage('Saved plans could not be loaded.'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    let mounted = true;
    void window.qaspider.listPlans().then(async response => {
      if (!mounted) return;
      if (response.status !== 'ok') { setStorageMessage(response.message); return; }
      setPlans(response.value);
      if (response.value[0]) await openPlan(response.value[0].id);
    }).catch(() => { if (mounted) setStorageMessage('Saved plans could not be loaded.'); });
    return () => { mounted = false; };
  }, []);
  async function propose(event: FormEvent) {
    event.preventDefault(); setBusy(true); setResult(null); setSaved(null);
    try {
      const response = await window.qaspider.proposeTicketPlan({ title, description, acceptanceCriteria: criteria.split('\n').map(line => line.trim()).filter(Boolean) });
      if (!response.status || !response.message) throw new Error('IPC response unavailable');
      setResult(response);
      setSaved(response.review ?? null);
      await refreshPlans();
    } catch { setResult({ status: 'unavailable', message: 'Could not receive a ticket plan. Another desktop operation may be running; retry when it finishes.' }); }
    finally { setBusy(false); }
  }
  return <section className="card ticket-planning" data-testid="ticket-planning" aria-busy={busy}>
    <p className="eyebrow">TICKET PLAN REVIEW · MILESTONE 4.2</p>
    <h2>Turn acceptance criteria into a test proposal.</h2>
    <p>Generate, edit and approve a versioned test plan. Plan approval does not authorize browser actions. No ticket tests execute here.</p>
    <form className="workspace-form" onSubmit={event => void propose(event)}>
      <label htmlFor="ticket-title">Ticket title</label>
      <input id="ticket-title" required maxLength={200} disabled={busy} value={title} onChange={event => { setTitle(event.target.value); setResult(null); setSaved(null); }}/>
      <label htmlFor="ticket-description">Ticket description</label>
      <textarea id="ticket-description" required maxLength={12000} rows={3} disabled={busy} value={description} onChange={event => { setDescription(event.target.value); setResult(null); setSaved(null); }}/>
      <label htmlFor="ticket-criteria">Acceptance criteria (one per line, up to 20)</label>
      <textarea id="ticket-criteria" required maxLength={40000} rows={5} disabled={busy} value={criteria} onChange={event => { setCriteria(event.target.value); setResult(null); setSaved(null); }}/>
      <p className="hint">Ticket text is sent to the configured Codex provider. Plans, revisions and review records are saved locally. Use synthetic examples and leave credentials out of tickets. Editing these ticket fields starts a separate proposal; it never rewrites a saved ticket.</p>
      <button disabled={busy}>{busy ? 'Proposing scenarios…' : 'Propose test plan'}</button>
    </form>
    <div role="status" aria-live="polite" data-testid="ticket-plan-status"><p>{busy ? 'Validating the provider, proposing scenarios and checking traceability…' : result?.message}</p></div>
    <label>Saved plans<select aria-label="Saved plans" disabled={busy} value={saved?.planId ?? ''} onChange={event => { if (event.target.value) void openPlan(event.target.value); }}><option value="">Choose a saved plan</option>{plans.map(item => <option key={item.id} value={item.id}>{item.title} · Revision {item.revision} · {item.status}</option>)}</select></label>
    <p role="status">{storageMessage}</p>
    {saved && <PlanReview key={`${saved.planId}-${saved.revision}`} snapshot={saved} onChange={value => { setSaved(value); setResult(null); void refreshPlans(); }} openRevision={revision => void openPlan(saved.planId, revision)}/>}
    {!saved && plan && <div data-testid="ticket-plan">
      <h3>Draft proposal: {plan.ticket.title}</h3>
      <p>AI-generated interpretation · {plan.scenarios.length} proposed scenarios · No execution results</p>
      {result?.provider && <p className="hint">{result.provider.provider} · {result.provider.model}{result.provider.synthetic ? ' · synthetic test inference' : ''}</p>}
      <h3>Stated requirements — original ticket</h3>
      <p>{plan.ticket.description}</p>
      {plan.ticket.acceptanceCriteria.map(criterion => {
        const assessment = plan.criteria.find(item => item.criterionId === criterion.id)!;
        return <article key={criterion.id} id={`ticket-${criterion.id}`} className="ticket-criterion">
          <strong>{criterion.id}: {criterion.text}</strong>
          <p>AI assessment: {assessment.interpretation} — {assessment.explanation}</p>
          <p>Negative tests: {assessment.negativeTests.applicability} — {assessment.negativeTests.reason}</p>
          <p>Boundary tests: {assessment.boundaryTests.applicability} — {assessment.boundaryTests.reason}</p>
        </article>;
      })}
      <h3>AI-generated assumptions — require human review</h3>
      {plan.assumptions.length ? <ul>{plan.assumptions.map(assumption => <li key={assumption.id} id={`ticket-${assumption.id}`}><strong>{assumption.id}</strong>: {assumption.description}</li>)}</ul> : <p>No assumptions declared by the model. Review the proposals against the ticket.</p>}
      <h3>Proposed scenarios</h3>
      {!plan.scenarios.length && <p>No scenarios could be proposed from these criteria. Review the gaps above.</p>}
      {plan.scenarios.map(scenario => <article key={scenario.id} className="scenario-report" data-testid="ticket-scenario">
        <h4>{scenario.id}: {scenario.title} · {scenario.category}</h4>
        <p>Original criterion: <a href={`#ticket-${scenario.criterionId}`}>{scenario.criterionId}</a></p>
        <p>AI assumptions: {scenario.assumptionIds.length ? scenario.assumptionIds.join(', ') : 'None declared'}</p>
        {scenario.preconditions.length > 0 && <><strong>Proposed preconditions</strong><ul>{scenario.preconditions.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
        <strong>Proposed steps and expected outcomes</strong>
        <ol>{scenario.steps.map((step, index) => <li key={index}>{step.instruction}<p>Expected: {step.expectedOutcome}</p></li>)}</ol>
        <strong>Proposed assertions</strong>
        <ul>{scenario.assertions.map((assertion, index) => <li key={index}>
          {assertion.description} ({assertion.kind})
          <p>Exact value/message: {assertion.exactValue === null ? <strong>Unspecified in ticket</strong> : <q>{assertion.exactValue}</q>}</p>
          {assertion.sourceQuote !== null && <p>Ticket quote: <q>{assertion.sourceQuote}</q></p>}
        </li>)}</ul>
      </article>)}
      <details><summary>Inspect structured draft JSON</summary><pre data-testid="ticket-plan-json">{JSON.stringify(plan, null, 2)}</pre></details>
    </div>}
  </section>;
}
