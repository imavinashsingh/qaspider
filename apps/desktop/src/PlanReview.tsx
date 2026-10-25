import { useState } from 'react';
import { ApprovedExecution } from './ApprovedExecution.js';
import type { TicketPlan } from './TicketPlanning.js';
import type { ReviewAction, ReviewSnapshot } from './review-types.js';

type Scenario = TicketPlan['scenarios'][number];
type Mutate = (action: ReviewAction) => Promise<boolean>;

function ScenarioEditor({ scenario, save, cancel }: { scenario: Scenario; save: Mutate; cancel: () => void }) {
  const [title, setTitle] = useState(scenario.title);
  const [steps, setSteps] = useState(structuredClone(scenario.steps));
  const [assertions, setAssertions] = useState(scenario.assertions.map(item => item.description));
  const [saving, setSaving] = useState(false);
  return <div className="workspace-form" data-testid="scenario-editor">
    <p>Human edits are saved together. Original requirements and literal ticket quotes remain unchanged.</p>
    <label>Scenario title<input value={title} maxLength={200} onChange={event => setTitle(event.target.value)} disabled={saving}/></label>
    {steps.map((step, index) => <div key={index}>
      <label>Step {index + 1}<textarea aria-label={`Step ${index + 1}`} value={step.instruction} maxLength={1000} onChange={event => setSteps(steps.map((item, itemIndex) => itemIndex === index ? { ...item, instruction: event.target.value } : item))} disabled={saving}/></label>
      <label>Expected outcome {index + 1}<textarea aria-label={`Expected outcome ${index + 1}`} value={step.expectedOutcome} maxLength={1000} onChange={event => setSteps(steps.map((item, itemIndex) => itemIndex === index ? { ...item, expectedOutcome: event.target.value } : item))} disabled={saving}/></label>
      <button className="secondary" disabled={saving || steps.length === 1} onClick={() => setSteps(steps.filter((_, itemIndex) => itemIndex !== index))}>Remove step {index + 1}</button>
    </div>)}
    <button className="secondary" disabled={saving || steps.length >= 12} onClick={() => setSteps([...steps, { instruction: '', expectedOutcome: '' }])}>Add step</button>
    {assertions.map((description, index) => <label key={index}>Assertion expectation {index + 1}<textarea aria-label={`Assertion expectation ${index + 1}`} value={description} maxLength={1000} onChange={event => setAssertions(assertions.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} disabled={saving}/></label>)}
    <div className="review-actions"><button disabled={saving} onClick={() => { setSaving(true); void save({ type: 'edit-scenario', scenarioId: scenario.id, title, steps, assertionDescriptions: assertions }).then(ok => { if (ok) cancel(); }).finally(() => setSaving(false)); }}>Save scenario changes</button><button className="secondary" disabled={saving} onClick={cancel}>Cancel edits</button></div>
  </div>;
}

function AssumptionDecision({ id, description, decision, note, disabled, mutate }: { id: string; description: string; decision: 'unresolved' | 'confirmed' | 'rejected'; note: string; disabled: boolean; mutate: Mutate }) {
  const [value, setValue] = useState(decision), [reason, setReason] = useState(note);
  return <article className="ticket-criterion" data-testid="review-assumption">
    <strong>{id}: {description}</strong><p>AI-generated assumption · Saved decision: {decision}</p>
    <label>Decision for {id}<select aria-label={`Decision for ${id}`} value={value} disabled={disabled} onChange={event => setValue(event.target.value as typeof value)}><option value="unresolved">Unresolved</option><option value="confirmed">Confirmed by human</option><option value="rejected">Rejected by human</option></select></label>
    <label>Review note for {id}<textarea aria-label={`Review note for ${id}`} value={reason} maxLength={4000} disabled={disabled} onChange={event => setReason(event.target.value)}/></label>
    <button disabled={disabled || (value !== 'unresolved' && !reason.trim())} onClick={() => void mutate({ type: 'assumption', id, decision: value, note: reason })}>Save decision for {id}</button>
  </article>;
}

function CriterionDecision({ id, note, confirmed, disabled, mutate }: { id: string; note: string; confirmed: boolean; disabled: boolean; mutate: Mutate }) {
  const [reason, setReason] = useState(note);
  return <div data-testid="criterion-decision">
    <label>Coverage review note for {id}<textarea aria-label={`Coverage review note for ${id}`} value={reason} maxLength={4000} disabled={disabled} onChange={event => setReason(event.target.value)}/></label>
    <button disabled={disabled || !reason.trim()} onClick={() => void mutate({ type: 'criterion', criterionId: id, confirmed: !confirmed, note: reason })}>{confirmed ? 'Clear coverage confirmation' : 'Confirm planned coverage'} for {id}</button>
  </div>;
}

export function PlanReview({ snapshot, onChange, openRevision, presentation = 'legacy', onExecutionComplete }: { snapshot: ReviewSnapshot; onChange: (value: ReviewSnapshot) => void; openRevision: (revision: number) => void; presentation?: 'legacy' | 'chat'; onExecutionComplete?: () => void }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [editing, setEditing] = useState<string | null>(null);
  const latest = snapshot.revisions.at(-1)?.number === snapshot.revision;
  const frozen = snapshot.status === 'APPROVED' || !latest;
  const blocked = frozen || busy || editing !== null;
  async function mutate(action: ReviewAction) {
    setBusy(true); setMessage('');
    try {
      const response = await window.qaspider.reviewPlan({ planId: snapshot.planId, revision: snapshot.revision, version: snapshot.version, action });
      if (response.status !== 'ok') { setMessage(response.message); return false; }
      onChange(response.value); setMessage('Saved locally.'); return true;
    } catch { setMessage('Could not save the review. Reopen the latest saved revision before retrying.'); return false; }
    finally { setBusy(false); }
  }
  const original = snapshot.original;
  return <div className="plan-review workspace-form" data-testid="ticket-plan">
    <h3>{original.ticket.title}</h3>
    <p data-testid="revision-status"><strong>Revision {snapshot.revision} · {snapshot.status}</strong>{!latest ? ' · Historical revision, read-only' : ''}</p>
    <p>Saved locally · Approval is plan review only · Browser authorization is required separately.</p>
    <p>Criteria with proposals: {snapshot.coverage.filter(item => item.scenarioIds.length > 0).length}/{snapshot.coverage.length} · Reviewed planned coverage: {snapshot.coverage.filter(item => item.planned === 'reviewed').length}/{snapshot.coverage.length}. Execution coverage appears in the revision’s ticket reports below.</p>
    {presentation === 'legacy' && <small>Validated revision hash: <code>{snapshot.hash}</code></small>}
    {snapshot.content.executionRequired && !frozen && <button disabled={busy || editing !== null} onClick={() => {
      setBusy(true); setMessage('Discovering controls and preparing an executable draft. No business actions will run…');
      void window.qaspider.prepareDraft({ planId: snapshot.planId, revision: snapshot.revision, version: snapshot.version }).then(response => {
        if (response.status === 'ok') { onChange(response.value); setMessage('Executable bindings prepared. Review the mappings and prerequisites below.'); } else setMessage(response.message);
      }).catch(() => setMessage('Preparation unavailable.')).finally(() => setBusy(false));
    }}>Prepare executable draft</button>}
    {snapshot.content.execution && <section className="binding-card" aria-label="Executable bindings">
      <h3>Executable bindings and prerequisites</h3>
      <p>These commands are part of this revision. Compare each measured assertion with the original business expectation. Preparation does not authorize actions.</p>
      <p>Application: {snapshot.content.execution.context.mode === 'controlled' ? `Controlled QA application ${snapshot.content.execution.context.url}` : snapshot.content.execution.context.url}</p>
      {snapshot.content.execution.initialState?.map((item, index) => <p key={index}>Measured initial control: {item.name || item.selector} · {item.empty ? 'empty' : 'nonempty'} · {item.enabled ? 'enabled' : 'disabled'}. Rechecked when each scenario starts.</p>)}
      {snapshot.content.execution.scenarios.map(binding => <article key={binding.scenarioId}>
        <h4>{binding.scenarioId}: prepared operations</h4>
        <ol>{(JSON.parse(binding.planJson) as { steps: Record<string, unknown>[] }).steps.map((step, index) => <li key={index}>{commandDescription(step)}</li>)}</ol>
        {binding.assertionSources.map(item => <p key={item.index}>Original expectation: {item.description}<br/>Measured assertion: {commandDescription({ kind: 'assert', assertion: JSON.parse(item.assertionJson) })}</p>)}
        {binding.prerequisites.map((item, index) => <p key={index}>Prerequisite: {item.description} · {item.resolution} · Setup operations: {item.stepNumbers.join(', ') || 'Initial navigation only'}</p>)}
        {binding.blockers.map((item, index) => <p className="error" key={index}>{item}</p>)}
      </article>)}
      <p>Binding review: {snapshot.content.execution.note || 'Pending'}. Editing scenarios or assumptions clears these bindings and requires preparation again.</p>
      {!frozen && <BindingConfirmation busy={blocked} confirm={note => mutate({ type: 'confirm-execution', note })}/>}
    </section>}
    <div className="review-actions">
      {latest && snapshot.status === 'DRAFT' && <button disabled={busy || editing !== null} onClick={() => void mutate({ type: 'start-review' })}>Start review</button>}
      {latest && snapshot.status === 'IN_REVIEW' && <button disabled={busy || editing !== null || snapshot.issues.length > 0} onClick={() => void mutate({ type: 'approve', hash: snapshot.hash })}>Approve Plan</button>}
      {latest && snapshot.status === 'APPROVED' && <button disabled={busy} onClick={() => void mutate({ type: 'fork' })}>Create new DRAFT revision</button>}
      <label>Saved revision<select aria-label="Saved revision" value={snapshot.revision} disabled={busy || editing !== null} onChange={event => openRevision(Number(event.target.value))}>{snapshot.revisions.map(item => <option key={item.number} value={item.number}>Revision {item.number} · {item.status}</option>)}</select></label>
    </div>
    <p role="status" data-testid="review-status">{message}</p>
    {editing !== null && <p>Save or cancel the scenario edit before changing review decisions.</p>}
    {snapshot.status !== 'APPROVED' && <details open><summary>Approval blockers ({snapshot.issues.length})</summary><ul>{snapshot.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>{!snapshot.issues.length && <p>Planned coverage and assumptions are ready for review approval.</p>}</details>}
    <h3>Original acceptance criteria and planned coverage</h3>
    <p>{original.ticket.description}</p>
    {snapshot.coverage.map(item => <article key={item.criterionId} id={`ticket-${item.criterionId}`} className="ticket-criterion" data-testid="planned-coverage">
      <strong>{item.criterionId}: {item.text}</strong>
      <p>Planned coverage: <strong>{item.planned === 'gap' ? 'Gap' : item.planned === 'reviewed' ? 'Reviewed planned coverage' : 'Proposed only'}</strong> · Scenarios: {item.scenarioIds.join(', ') || 'None'}</p>
      <p>Review approval supplies planned coverage. See ticket reports below for executed coverage.</p>
      {item.blockingAssumptionIds.length > 0 && <p>Blocking assumptions: {item.blockingAssumptionIds.join(', ')}</p>}
      {(() => {
        const decision = snapshot.content.criteria.find(entry => entry.criterionId === item.criterionId)!;
        return <CriterionDecision key={`${item.criterionId}-${decision.confirmed}-${decision.note}`} id={item.criterionId} note={decision.note} confirmed={decision.confirmed} disabled={blocked || snapshot.status !== 'IN_REVIEW' || !item.scenarioIds.length || item.blockingAssumptionIds.length > 0} mutate={mutate}/>;
      })()}
    </article>)}
    <h3>AI-generated assumptions and human decisions</h3>
    <p>All assumptions used by retained scenarios block approval until confirmed with a review note. Rejected assumptions remain blockers.</p>
    {snapshot.content.assumptions.map(item => <AssumptionDecision key={`${item.id}-${item.decision}-${item.note}`} id={item.id} description={original.assumptions.find(source => source.id === item.id)!.description} decision={item.decision} note={item.note} disabled={blocked} mutate={mutate}/>)}
    {!snapshot.content.assumptions.length && <p>No AI assumptions declared.</p>}
    <h3>Scenario review</h3>
    {snapshot.content.scenarios.map(scenario => {
      const source = original.scenarios.find(item => item.id === scenario.id)!;
      const human = (value: unknown, initial: unknown) => JSON.stringify(value) === JSON.stringify(initial) ? 'AI-generated' : 'Human-edited';
      return <article className="scenario-report" data-testid="ticket-scenario" key={scenario.id}>
        <h4>{scenario.id}: {scenario.title} · {scenario.category}</h4>
        <p>Title: {human(scenario.title, source.title)} · Original criterion: <a href={`#ticket-${scenario.criterionId}`}>{scenario.criterionId}</a></p>
        <blockquote>{original.ticket.acceptanceCriteria.find(item => item.id === scenario.criterionId)!.text}</blockquote>
        <p>Assumption dependencies: {scenario.assumptionIds.join(', ') || 'None'}</p>
        <ul>{scenario.preconditions.map((item, index) => <li key={index}>{item}</li>)}</ul>
        {editing === scenario.id ? <ScenarioEditor scenario={scenario} save={mutate} cancel={() => setEditing(null)}/> : <>
          <ol>{scenario.steps.map((step, index) => <li key={index}>{step.instruction} <small>{human(step.instruction, source.steps[index]?.instruction)}</small><p>Expected: {step.expectedOutcome} <small>{human(step.expectedOutcome, source.steps[index]?.expectedOutcome)}</small></p></li>)}</ol>
          <ul>{scenario.assertions.map((assertion, index) => <li key={index}>{assertion.description} <small>{human(assertion.description, source.assertions[index]?.description)}</small><p>Exact value/message: {assertion.exactValue ?? <strong>Unspecified in ticket</strong>}</p>{assertion.sourceQuote && <q>{assertion.sourceQuote}</q>}</li>)}</ul>
          <div className="review-actions"><button disabled={blocked} onClick={() => setEditing(scenario.id)}>Edit {scenario.id}</button><button className="secondary" disabled={blocked} onClick={() => void mutate({ type: 'remove-scenario', scenarioId: scenario.id })}>Remove {scenario.id}</button></div>
        </>}
      </article>;
    })}
    <p>Removed scenarios: {original.scenarios.filter(item => !snapshot.content.scenarios.some(scenario => scenario.id === item.id)).map(item => item.id).join(', ') || 'None'}</p>
    <h3>Approval history</h3>
    <ApprovedExecution snapshot={snapshot} presentation={presentation} onExecutionComplete={onExecutionComplete}/>
    {!snapshot.approvals.length && <p>No approved revisions.</p>}
    {snapshot.approvals.map(item => <p key={item.id}>Revision {item.revision} approved at {item.approvedAt} by {item.reviewer}<br/><code>{item.hash}</code></p>)}
    {presentation === 'legacy' && <><details><summary>Review audit history</summary><pre>{JSON.stringify(snapshot.events, null, 2)}</pre></details>
    <details><summary>Original AI proposal (unchanged)</summary><pre>{JSON.stringify(original, null, 2)}</pre></details>
    <details><summary>Inspect scenario proposal JSON (not an approval record)</summary><pre data-testid="ticket-plan-json">{JSON.stringify({ ...original, scenarios: snapshot.content.scenarios }, null, 2)}</pre></details>
    <details><summary>Inspect validated revision and approval data</summary><pre>{JSON.stringify(snapshot, null, 2)}</pre></details></>}
  </div>;
}

function BindingConfirmation({ busy, confirm }: { busy: boolean; confirm: (note: string) => Promise<boolean> }) {
  const [note, setNote] = useState('');
  return <div><label>Executable binding review note<textarea value={note} onChange={event => setNote(event.target.value)} disabled={busy} maxLength={4000}/></label><button disabled={busy || !note.trim()} onClick={() => void confirm(note)}>Confirm executable bindings and setup</button></div>;
}

function commandDescription(step: Record<string, unknown>): string {
  const target = step.target as { label?: string; selector?: string } | undefined;
  if (step.kind === 'NAVIGATE') return `Open ${String(step.path)}`;
  if (step.kind === 'assert') {
    const assertion = step.assertion as { kind: string; selector?: string; expected: unknown; present?: boolean };
    if (assertion.kind === 'url') return `Verify the URL is ${String(assertion.expected)}`;
    if (assertion.kind === 'text') return `Verify ${assertion.selector} ${assertion.present === false ? 'does not contain' : 'shows'} “${String(assertion.expected)}”`;
    return `Verify ${assertion.selector} is ${assertion.expected ? '' : 'not '}${assertion.kind}`;
  }
  if (step.kind === 'FILL') return `Enter the stated test value into ${target?.label ?? target?.selector}`;
  if (step.kind === 'SELECT') return `Select ${String(step.value)} in ${target?.label ?? target?.selector}`;
  return `Click ${target?.label ?? target?.selector ?? 'the approved control'}`;
}
