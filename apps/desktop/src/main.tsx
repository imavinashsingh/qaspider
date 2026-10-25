import { useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { Workspace, type WorkspaceBridge } from './Workspace.js';
import { Scenarios, type ScenarioBridge } from './Scenarios.js';

export interface CaptureResult {
  status: 'success' | 'error';
  message: string;
  visitedUrl?: string;
  httpStatus?: number | null;
  screenshot?: string;
}
declare global {
  interface Window { qaspider: WorkspaceBridge & ScenarioBridge & { openBrowser: (url: string) => Promise<CaptureResult> } }
}

function App() {
  const [url, setUrl] = useState('http://localhost:3000');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CaptureResult | null>(null);

  async function openBrowser(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try { setResult(await window.qaspider.openBrowser(url)); }
    catch { setResult({ status: 'error', message: 'Could not communicate with the desktop browser process. Try again.' }); }
    finally { setBusy(false); }
  }

  return <main>
    <header><span className="brand">Q</span><div><strong>QASpider</strong><small>DESKTOP QA</small></div><span className="badge">Local browser</span></header>
    <section className="intro"><p className="eyebrow">YOUR FIRST QA CHECK</p><h1>Open. Capture. Inspect.</h1><p>Visit your development or QA application and capture its current screen.</p></section>
    <form onSubmit={event => void openBrowser(event)} className="card">
      <label htmlFor="target">Target application URL</label>
      <div className="input-row"><input id="target" type="url" required maxLength={4096} value={url} onChange={event => setUrl(event.target.value)} disabled={busy} spellCheck={false}/><button disabled={busy}>{busy ? 'Capturing…' : 'Open Browser'}</button></div>
      <p className="hint">HTTP(S) only. Capture stays on the entered application origin. The browser closes after capture.</p>
    </form>
    <section className="card result" aria-busy={busy}>
      <div role="status" aria-live="polite"><strong>Execution status: </strong><span data-testid="status">{busy ? 'Running' : result ? result.status === 'success' ? 'Complete' : 'Failed' : 'Ready'}</span></div>
      <p className={result?.status === 'error' ? 'error' : 'hint'} role={result?.status === 'error' ? 'alert' : undefined}>{busy ? 'Starting Chromium, loading the application and taking a screenshot…' : result?.message ?? 'Enter an application URL to begin. No AI provider or API key is required.'}</p>
      {result?.visitedUrl && <p className="visited"><strong>Visited URL</strong><br/><span data-testid="visited-url">{result.visitedUrl}</span>{result.httpStatus != null && <small>HTTP {result.httpStatus}</small>}</p>}
      {result?.screenshot ? <figure><img src={result.screenshot} alt="Captured target application"/><figcaption>1280 × 800 viewport · captured before browser cleanup</figcaption></figure> : <div className="placeholder">Your captured screenshot will appear here.</div>}
    </section>
    <Workspace/>
    <Scenarios/>
    <footer>Stagehand + local Chromium · one browser operation at a time</footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App/>);
