import { useEffect, useState } from 'react';
import type { AgentHistory, AgentScope, AgentStatus } from './chat-types.js';
import type { ReviewReply } from './review-types.js';
const value = <T,>(reply: ReviewReply<T>): T => { if (reply.status !== 'ok') throw new Error(reply.message); return reply.value; };
const phaseLabel: Record<string, string> = { checking_provider: 'Checking provider…', retrieving_context: 'Reading project context…', thinking: 'Thinking…', reading_records: 'Reading saved QA records…', responding: 'Writing reply…', idle: 'Ready' };

export function AgentChat(scope: AgentScope) {
  const [history, setHistory] = useState<AgentHistory | null>(null), [status, setStatus] = useState<AgentStatus | null>(null);
  const [text, setText] = useState(''), [error, setError] = useState(''), [sending, setSending] = useState(false);
  useEffect(() => {
    let alive = true, reading = false;
    const update = async () => {
      if (reading) return; reading = true;
      try {
        const [records, progress] = await Promise.all([window.qaspider.agentHistory(scope), window.qaspider.agentStatus(scope)]);
        if (alive) { setHistory(value(records)); setStatus(value(progress)); }
      } catch (failure) { if (alive) setError(failure instanceof Error ? failure.message : 'Main Agent unavailable.'); }
      finally { reading = false; }
    };
    void window.qaspider.agentStart(scope).then(reply => { if (alive) { setHistory(value(reply)); void update(); } }).catch(failure => { if (alive) setError(failure.message); });
    const timer = setInterval(() => { void update(); }, 600);
    return () => { alive = false; clearInterval(timer); };
  }, [scope.projectId, scope.conversationId]);
  async function send() {
    setSending(true); setError('');
    try { setHistory(value(await window.qaspider.agentSend({ ...scope, requestId: crypto.randomUUID(), text }))); setText(''); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Message could not be sent.'); }
    finally { setSending(false); }
  }
  const busy = sending || status?.laneBusy || history?.turns.some(turn => turn.status === 'RUNNING');
  return <section className="agent-chat" data-testid="main-agent-chat">
    <p>Discuss this project and inspect saved QA results. The Main Agent can read project context and operational knowledge. Use Conversations to prepare and review a test plan.</p>
    <p className="hint">Your message and relevant project context go to the configured provider. Leave passwords and private credentials out. Chat cannot run browser actions or change approved plans.</p>
    <p role="status" data-testid="agent-status">{status?.busy ? phaseLabel[status.phase] ?? 'Working…' : status?.laneBusy ? 'The Main Agent is replying in another conversation.' : 'Ready'}</p>
    {(error || status?.error) && <p role="alert" className="error">{error || status?.error}</p>}
    {!history && !error && <p>Loading conversation…</p>}
    <div aria-label="Main Agent messages" aria-live="polite">
      {history?.turns.map(turn => <article className="agent-turn" key={turn.id} data-testid="agent-turn">
        <div className="chat-message user"><small>You</small><p className="message-body">{turn.userText}</p></div>
        <div className="chat-message assistant"><small>Main Agent · {turn.status === 'COMPLETED' ? 'Reply' : turn.status.toLowerCase()}</small><p className="message-body">{turn.reply ?? 'Preparing a reply…'}</p>
          {turn.sources.length > 0 && <details><summary>Sources ({turn.sources.length})</summary><ul>{turn.sources.map(source => <li key={source.id}>{source.label}<small>{source.id}</small></li>)}</ul></details>}
        </div>
      </article>)}
    </div>
    <form className="chat-composer" onSubmit={event => { event.preventDefault(); void send(); }}>
      <label htmlFor="main-agent-message">Message Main Agent</label><textarea id="main-agent-message" value={text} onChange={event => setText(event.target.value)} maxLength={6000} required disabled={Boolean(busy)} rows={3} placeholder="What do we know about this project? How did the last QA run finish?"/>
      <button disabled={Boolean(busy) || !text.trim()}>{busy ? 'Reply in progress…' : 'Send message'}</button>
    </form>
    {status && <details><summary>Saved QA status ({status.qa.length})</summary><p>Existing plans and saved reports. There is no Testing Agent or task queue in this checkpoint.</p><ul>{status.qa.map(plan => <li key={plan.planId}>{plan.title} · {plan.reviewStatus} · {plan.scenarioCount} scenarios{plan.reports.map(report => <small key={report.reportId}>Saved execution: {report.status} · {report.outcome}</small>)}</li>)}</ul></details>}
  </section>;
}
