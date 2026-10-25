import { useState } from 'react';

type Verdict = 'PASS' | 'FAIL' | 'BLOCKED' | 'INCONCLUSIVE';
interface Evidence { id: string; stepNumber: number; url: string; screenshot: string }
interface Step { number: number; kind: string; target?: string; outcome: Verdict; message: string; actual?: string | boolean | null; expected?: string | boolean; evidenceId?: string }
interface Report { id: string; name: string; outcome: Verdict; steps: Step[]; evidence: Evidence[]; browserClosed: boolean; assertionsExecuted: number; message?: string }
interface Suite { outcome: Verdict; message: string; reports: Report[]; summary?: { counts: Record<Verdict, number>; total: number } }
export interface ScenarioBridge { runScenarios: (input: { authorized: boolean; scenarioIds: string[] }) => Promise<Suite> }

export function Scenarios() {
  const [authorized, setAuthorized] = useState(false);
  const [includeFailure, setIncludeFailure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Suite | null>(null);
  async function run() {
    setBusy(true); setResult(null);
    try {
      const report = await window.qaspider.runScenarios({ authorized, scenarioIds: ['valid-login', 'invalid-login', ...(includeFailure ? ['deliberate-failure'] : [])] });
      if (!report.outcome || !Array.isArray(report.reports)) throw new Error('Scenario operation was not accepted.');
      setResult(report);
    } catch { setResult({ outcome: 'INCONCLUSIVE', message: 'Could not receive the scenario report from the desktop process.', reports: [] }); }
    finally { setBusy(false); setAuthorized(false); }
  }
  return <section className="card" data-testid="scenario-workspace" aria-busy={busy}>
    <p className="eyebrow">CONTROLLED QA SCENARIOS · MILESTONE 3</p>
    <h2>Verify a complete login scenario.</h2>
    <p>Run valid and invalid login tests against a temporary fixture started by QASpider. Each uses its own browser session. No AI provider is required.</p>
    <p className="hint">Only synthetic credentials are used. Form submission remains blocked for applications in the observation workspace.</p>
    <label className="scenario-option"><input type="checkbox" checked={includeFailure} disabled={busy} onChange={event => { setIncludeFailure(event.target.checked); setAuthorized(false); }}/><span>Include a deliberately wrong dashboard expectation (should report FAIL).</span></label>
    <label className="scenario-option"><input data-testid="authorize-scenarios" type="checkbox" checked={authorized} disabled={busy} onChange={event => setAuthorized(event.target.checked)}/><span>I authorize filling synthetic credentials and submitting the QASpider controlled login fixture for these scenarios.</span></label>
    <button disabled={busy || !authorized} onClick={() => void run()}>{busy ? 'Running isolated scenarios…' : 'Run login scenarios'}</button>
    <div role="status" aria-live="polite" data-testid="scenario-summary">
      {busy ? <p>Starting the fixture, checking permissions and verifying each scenario…</p> : result && <>
        <h3>Overall result: <span className={`outcome-${result.outcome.toLowerCase()}`}>{result.outcome}</span></h3>
        <p>{result.message}</p>
        {result.summary && <p>{result.summary.total} scenarios · {Object.entries(result.summary.counts).map(([key, count]) => `${key}: ${count}`).join(' · ')}</p>}
      </>}
    </div>
    {result?.reports.map(report => <article key={report.id} className="scenario-report" data-testid="scenario-report">
      <h3>{report.name}: <span className={`outcome-${report.outcome.toLowerCase()}`}>{report.outcome}</span></h3>
      <p>{report.assertionsExecuted} assertions executed · Browser {report.browserClosed ? 'closed' : 'not opened or cleanup unconfirmed'}</p>
      {report.message && <p>{report.message}</p>}
      <ol>{report.steps.map(step => <li key={step.number}>
        <strong>{step.kind} {step.target} — {step.outcome}</strong><p>{step.message}</p>
        {step.expected !== undefined && <p>Expected: <code>{String(step.expected)}</code><br/>Actual: <code>{step.actual === undefined ? 'Not verified' : String(step.actual)}</code></p>}
        {step.evidenceId && <a href={`#${step.evidenceId}`}>Screenshot for step {step.number}</a>}
      </li>)}</ol>
      {report.evidence.map(evidence => <details key={evidence.id} id={evidence.id}>
        <summary>Screenshot · step {evidence.stepNumber} · {evidence.url}</summary>
        <img loading="lazy" src={evidence.screenshot} alt={`${report.name}, step ${evidence.stepNumber}; form controls masked`}/>
      </details>)}
    </article>)}
  </section>;
}
