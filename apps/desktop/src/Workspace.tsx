import { useState, type FormEvent } from 'react';

export interface ObservedAction {
  id: string; description: string; selector: string; method?: string; arguments?: string[];
  details?: string; allowed: boolean; requiresAuthorization: boolean; reason: string;
}
export type Assertion = { kind: 'url'; expected: string } | { kind: 'text'; selector: string; expected: string };
export interface Observation {
  status: 'observed' | 'unavailable' | 'error'; message: string; observationId?: string | undefined; actions?: ObservedAction[];
  screenshot?: string; visitedUrl?: string; provider?: { provider: string; model: string; synthetic: boolean };
}
export interface ActionRun {
  id: string; timestamp: string; outcome: 'PASS' | 'FAIL' | 'BLOCKED' | 'INCONCLUSIVE'; message: string;
  screenshot?: string; visitedUrl?: string; action?: unknown; assertion?: unknown; actual?: unknown;
}
export interface WorkspaceBridge {
  observe: (request: { url: string; instruction: string }) => Promise<Observation>;
  execute: (request: { observationId: string; actionId: string; authorized: boolean; expected: Assertion }) => Promise<ActionRun>;
  closeSession: () => Promise<{ status: string }>;
}

export function Workspace() {
  const [url, setUrl] = useState('http://localhost:3000');
  const [instruction, setInstruction] = useState('Find the buttons and navigation links.');
  const [observation, setObservation] = useState<Observation | null>(null);
  const [selected, setSelected] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [kind, setKind] = useState<'text' | 'url'>('text');
  const [selector, setSelector] = useState('#status');
  const [expected, setExpected] = useState('Saved');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [runs, setRuns] = useState<ActionRun[]>([]);
  const chosen = observation?.actions?.find(action => action.id === selected);

  async function observe(event: FormEvent) {
    event.preventDefault(); setBusy(true); setSelected(''); setAuthorized(false); setMessage('Validating Codex CLI and observing the page…'); setObservation(null);
    try { const result = await window.qaspider.observe({ url, instruction }); setObservation(result); setMessage(result.message); }
    catch { setMessage('Observation could not reach the desktop process.'); }
    finally { setBusy(false); }
  }
  async function execute(event: FormEvent) {
    event.preventDefault(); if (!observation?.observationId || !chosen) return;
    setBusy(true); setMessage('Checking permission, executing the selected action and verifying its outcome…');
    try {
      const assertion: Assertion = kind === 'text' ? { kind, selector, expected } : { kind, expected };
      const run = await window.qaspider.execute({ observationId: observation.observationId, actionId: chosen.id, authorized, expected: assertion });
      setRuns(values => [run, ...values].slice(0, 10));
      setMessage(`${run.outcome}: ${run.message} Browser session closed. Observe again for another action.`);
    } catch { setMessage('Execution could not reach the desktop process.'); }
    finally { setBusy(false); setSelected(''); setAuthorized(false); setObservation(value => value ? { ...value, observationId: undefined } : null); }
  }
  async function closeSession() {
    setBusy(true);
    try { await window.qaspider.closeSession(); setObservation(null); setSelected(''); setMessage('Browser session closed.'); }
    catch { setMessage('Browser session could not be closed.'); }
    finally { setBusy(false); }
  }

  return <section className="workspace" aria-label="Browser testing workspace">
    <div className="intro"><p className="eyebrow">BROWSER TESTING WORKSPACE</p><h2>Observe an application. Verify an outcome.</h2><p>Codex CLI supplies reasoning. Page text is sent to the selected provider. QASpider checks permissions and browser evidence.</p></div>
    <form className="card workspace-form" onSubmit={event => void observe(event)}>
      <label htmlFor="observation-url">Observation application URL</label><input id="observation-url" type="url" required value={url} disabled={busy} onChange={event => setUrl(event.target.value)}/>
      <label htmlFor="instruction">Observation instruction</label><textarea id="instruction" required maxLength={4000} rows={3} disabled={busy} value={instruction} onChange={event => setInstruction(event.target.value)}/>
      <div className="input-row"><button disabled={busy}>{busy ? 'Working…' : 'Observe page'}</button><button type="button" className="secondary" disabled={busy || !observation?.observationId} onClick={() => void closeSession()}>Close observation browser</button></div>
      <p className="hint">Start your target application separately before observing it. Observation proposes actions without clicking. Sessions expire after five idle minutes. Plain capture above remains AI-free.</p>
    </form>
    <p role="status" data-testid="workspace-status">{message}</p>
    {observation?.provider && <p className="hint">{observation.provider.provider} · {observation.provider.model}{observation.provider.synthetic ? ' · SYNTHETIC TEST PROVIDER' : ''}</p>}
    {observation?.visitedUrl && <p className="visited">Observed URL: {observation.visitedUrl}</p>}
    {observation?.actions && <section className="card"><h3>Discovered actions</h3>{observation.actions.length === 0 && <p>No matching actions were discovered.</p>}
      {observation.actions.map(action => <label className="action-choice" key={action.id}>
        <input type="radio" name="action" value={action.id} checked={selected === action.id} disabled={busy || !action.allowed || !observation.observationId} onChange={() => { setSelected(action.id); setAuthorized(false); }}/>
        <span><strong>{action.description}</strong><small>{action.method ?? 'Unsupported method'} · {action.selector}</small><small>{action.details}</small><small>{action.allowed ? 'Authorization required' : 'BLOCKED'}: {action.reason}</small></span>
      </label>)}
    </section>}
    {observation?.screenshot && <figure className="card"><img src={observation.screenshot} alt="Observed application"/><figcaption>Observation evidence</figcaption></figure>}
    {chosen && <form className="card workspace-form" onSubmit={event => void execute(event)}>
      <h3>Declare the expected result</h3>
      <label htmlFor="assertion-kind">Assertion type</label><select id="assertion-kind" value={kind} disabled={busy} onChange={event => { setKind(event.target.value as 'text' | 'url'); setAuthorized(false); }}><option value="text">Exact visible text</option><option value="url">Exact URL</option></select>
      {kind === 'text' && <><label htmlFor="assertion-selector">Assertion selector</label><input id="assertion-selector" required value={selector} disabled={busy} onChange={event => { setSelector(event.target.value); setAuthorized(false); }}/></>}
      <label htmlFor="assertion-value">Expected value</label><input id="assertion-value" required value={expected} disabled={busy} onChange={event => { setExpected(event.target.value); setAuthorized(false); }}/>
      <label className="authorization"><input type="checkbox" checked={authorized} disabled={busy} onChange={event => setAuthorized(event.target.checked)}/>I authorize this specific click, including possible application state changes.</label>
      <button disabled={busy || !authorized}>Execute selected action</button>
    </form>}
    {runs.length > 0 && <section className="card"><h3>Action evidence · this app session</h3>{runs.map(run => <article key={run.id} className="action-run"><strong data-testid="action-outcome" data-outcome={run.outcome}>{run.outcome}</strong><p>{run.message}</p><small>{run.timestamp} · {run.visitedUrl}</small><details><summary>Action, assertion and observed value</summary><pre>{JSON.stringify({ action: run.action, assertion: run.assertion, actual: run.actual }, null, 2)}</pre></details>{run.screenshot && <figure><img src={run.screenshot} alt="Action outcome evidence"/></figure>}</article>)}</section>}
  </section>;
}
