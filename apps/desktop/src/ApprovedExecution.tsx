import { useEffect, useState } from 'react';
import type { ReviewSnapshot } from './review-types.js';
import type { Preparation, TicketReport } from './execution-types.js';

export function ApprovedExecution({ snapshot }: { snapshot: ReviewSnapshot }) {
  const [preparation, setPreparation] = useState<Preparation | null>(null);
  const [authorized, setAuthorized] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [reports, setReports] = useState<TicketReport[]>([]);
  const identity = { planId: snapshot.planId, revision: snapshot.revision, version: snapshot.version, hash: snapshot.hash };
  useEffect(() => {
    let alive = true;
    const refresh = () => { void window.qaspider.planReports({ planId: snapshot.planId, revision: snapshot.revision }).then(reply => { if (alive && reply.status === 'ok') setReports(reply.value); }).catch(() => {}); };
    refresh(); const timer = busy ? setInterval(refresh, 1000) : undefined;
    return () => { alive = false; if (timer !== undefined) clearInterval(timer); };
  }, [snapshot.planId, snapshot.revision, busy]);
  useEffect(() => { setPreparation(null); setAuthorized(false); }, [snapshot.hash]);
  async function prepare() {
    setBusy(true); setAuthorized(false); setPreparation(null); setMessage('Checking approved revision and fixture configuration…');
    try {
      const response = await window.qaspider.preparePlan(identity);
      if (response.status === 'ok') { setPreparation(response.value); setMessage('Review compatibility and authorize the displayed fixture origin.'); }
      else setMessage(response.message);
    } catch { setMessage('Preparation unavailable.'); }
    finally { setBusy(false); }
  }
  async function execute() {
    if (!preparation || !authorized) return;
    setBusy(true); setMessage('Executing approved scenarios; progress is saved locally…');
    try {
      const response = await window.qaspider.executePlan({ ...identity, preparationId: preparation.preparationId, environment: preparation.environment, origin: preparation.origin, authorized: true });
      if (response.status === 'ok') { setReports(current => [response.value, ...current.filter(item => item.id !== response.value.id)]); setMessage(`Execution completed: ${response.value.outcome}`); }
      else setMessage(response.message);
    } catch { setMessage('Execution interrupted. Reload saved reports to inspect the durable results.'); }
    finally { setBusy(false); setPreparation(null); setAuthorized(false); }
  }
  return <section data-testid="approved-execution">
    <h3>Approved plan execution</h3>
    <p>Owned synthetic applications: login, registration and contact. Each scenario uses an isolated browser session. Authorize the prepared origin separately from plan review.</p>
    <details><summary>Explicit execution format and compatibility</summary>
      <p>Ordinary prose is unsupported. In a DRAFT revision, supply each instruction as a JSON browser command. Navigation and click expected outcomes must be JSON assertions; fill expected outcomes must be exactly [REDACTED]. Final assertion descriptions must be JSON assertions with the matching assertion kind. Review and approve these explicit expectations before execution.</p>
      <pre>{`Instruction: {"kind":"navigate","path":"/login"}
Expected outcome: {"kind":"url","expected":"/login"}
Instruction: {"kind":"fill","selector":"#username","account":"valid","field":"username"}
Expected outcome: [REDACTED]
Instruction: {"kind":"fill","selector":"#password","account":"valid","field":"password"}
Expected outcome: [REDACTED]
Instruction: {"kind":"click","selector":"#sign-in"}
Expected outcome: {"kind":"url","expected":"/dashboard"}
Final assertion (url): {"kind":"url","expected":"/dashboard"}`}</pre>
      <p>Generic commands: NAVIGATE, OBSERVE, FILL, CLICK, SELECT and CAPTURE_EVIDENCE. Targets declare a selector or exact label and optional role. Explicit alternatives allow bounded Stagehand discovery. Assertions: url, text (present true/false), visible and enabled. Generic fills declare value; values are redacted from execution reports. Login account commands remain supported. Preconditions must be “Owned controlled login fixture” or “Synthetic valid and invalid accounts”; or “Owned synthetic QA applications”; others require configuration and block execution. No selectors, data or behavior are inferred.</p>
      <pre>{`Generic registration example:
Instruction: {"kind":"NAVIGATE","path":"/registration"}
Expected outcome: {"kind":"url","expected":"/registration"}
Instruction: {"kind":"FILL","target":{"label":"Your name"},"value":"Synthetic Tester"}
Expected outcome: [REDACTED]
Instruction: {"kind":"CLICK","target":{"label":"Create account","role":"button"}}
Expected outcome: {"kind":"text","selector":"#result","expected":"Name and email are required"}
Adaptable contact target: {"label":"Submit","role":"button","alternatives":["Send Message"]}`}</pre>
    </details>
    <button disabled={busy || snapshot.status !== 'APPROVED' || snapshot.revisions.at(-1)?.number !== snapshot.revision} onClick={() => void prepare()}>Prepare approved execution</button>
    {preparation && <>
      <p>Environment: {preparation.environment} · Permitted origin: <code>{preparation.origin}</code> · Preparation expires: {preparation.expiresAt}</p>
      <p>Required fixture and synthetic credentials: {preparation.fixturesReady ? 'Available' : 'Missing — blocked'}</p>
      {preparation.compatibility.map(item => <article key={item.scenarioId}><strong>{item.scenarioId}: {item.classification}</strong><ul>{item.checks.map((check, index) => <li key={index}>{check.source}: {check.classification} — {check.reason}</li>)}</ul></article>)}
      <label><input type="checkbox" checked={authorized} disabled={busy} onChange={event => setAuthorized(event.target.checked)}/>I authorize synthetic input fills, selections and submissions only in the owned test applications at {preparation.origin}.</label>
    </>}
    <button disabled={busy || !authorized || !preparation?.fixturesReady} onClick={() => void execute()}>Execute Approved Plan</button>
    <p role="status">{message}</p>
    {reports.map(report => <article key={report.id} data-testid="ticket-execution-report" className="scenario-report">
      <h3>Ticket report: {report.outcome} · {report.status}</h3>
      <p>{report.title} · Ticket identifier: {report.planId}</p>
      <p>Approved revision {report.revision} · <code>{report.hash}</code></p>
      <p>{report.environment} · {report.origin} · Started {report.startedAt} · Completed {report.completedAt ?? 'Pending'}</p>
      <p>Scenarios completed: {report.scenarios.filter(item => item.status === 'COMPLETED').length}/{report.scenarios.length}</p>
      {report.coverage.map(item => <p key={item.criterionId}>{item.criterionId}: {item.text} · Planned: {item.planned} · Executed: {item.executed}</p>)}
      {report.scenarios.map(scenario => <article key={scenario.scenarioId}>
        <h4>{scenario.scenarioId}: {scenario.title} · {scenario.outcome} · {scenario.status}</h4>
        <p>{scenario.startedAt} — {scenario.completedAt ?? 'Not completed'} {scenario.message}</p>
        {scenario.result && <>{scenario.result.adaptations?.map((item, index) => <p key={index}>Adaptation: {item.requested} → {item.actualNames.join(', ')} · {item.resolvedSelector} · Evidence: {item.evidenceId ?? 'Unavailable'}</p>)}<p>Assertions executed: {scenario.result.assertionsExecuted} · Browser closed: {String(scenario.result.browserClosed)}</p>
          <ol>{scenario.result.steps.map(step => <li key={step.number}>{step.kind}: {step.outcome} · Resolved: {step.resolvedTarget ?? '—'} · {step.message}<p>Expected: {JSON.stringify(step.expected)} · Observed: {JSON.stringify(step.actual)} · Evidence: {step.evidenceId ?? 'None'}</p></li>)}</ol>
          {scenario.result.evidence.map(item => <details key={item.id}><summary>Screenshot {item.id} · Step {item.stepNumber}</summary><p>{item.url}</p><img style={{ maxWidth: '100%' }} src={item.screenshot} alt={`Evidence for ${scenario.scenarioId} step ${item.stepNumber}`}/></details>)}
        </>}
      </article>)}
      <ul>{report.gaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul>
      <details><summary>Inspect consolidated report JSON</summary><pre>{JSON.stringify(report, (key, value: unknown) => key === 'screenshot' ? '[Screenshot shown above; persisted in SQLite]' : value, 2)}</pre></details>
    </article>)}
  </section>;
}
