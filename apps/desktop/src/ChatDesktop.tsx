import { useEffect, useState, type ReactNode } from 'react';
import type { ApplicationContext, Conversation, DesktopSettings, Project } from './chat-types.js';
import type { ReviewReply, ReviewSnapshot } from './review-types.js';
import type { TicketReport } from './execution-types.js';
import { PlanReview } from './PlanReview.js';
import { ReportCard } from './ApprovedExecution.js';
import { Knowledge } from './Knowledge.js';

function value<T>(reply: ReviewReply<T>): T {
  if (reply.status !== 'ok') throw new Error(reply.message);
  return reply.value;
}

export function ChatDesktop({ legacy }: { legacy: ReactNode }) {
  const [view, setView] = useState<'chat' | 'knowledge' | 'settings' | 'legacy'>(new URLSearchParams(location.search).get('legacy') === '1' ? 'legacy' : 'chat');
  const [projects, setProjects] = useState<Project[]>([]), [projectId, setProjectId] = useState('');
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [projectName, setProjectName] = useState(''), [text, setText] = useState(''), [message, setMessage] = useState('');
  const [localBusy, setLocalBusy] = useState(false), [operation, setOperation] = useState<{ busy: boolean; channel?: string }>({ busy: false });
  const [refresh, setRefresh] = useState(0);
  const [synthetic, setSynthetic] = useState(false);
  const busy = localBusy || operation.busy;
  async function loadProjects() { const result = value(await window.qaspider.projects()); setProjects(result); return result; }
  async function open(id: string) { const result = value(await window.qaspider.conversation(id)); setConversation(result); setProjectId(result.projectId); setRefresh(count => count + 1); }
  useEffect(() => {
    let alive = true;
    void window.qaspider.settings().then(reply => { if (alive) setSynthetic(reply.synthetic === true); }).catch(() => {});
    void window.qaspider.projects().then(reply => {
      if (!alive) return;
      const result = value(reply); setProjects(result);
      const project = result.at(-1); setProjectId(project?.id ?? '');
      if (project?.conversations.at(-1)) void open(project.conversations.at(-1)!.id).catch(error => setMessage(error.message));
    }).catch(() => setMessage('Could not load projects. The legacy workspace remains available in Settings.'));
    const timer = setInterval(() => { void window.qaspider.operationStatus().then(reply => { if (alive && reply.status === 'ok') setOperation(reply.value); }).catch(() => {}); }, 400);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  async function work(operation: () => Promise<void>) {
    setLocalBusy(true); setMessage('');
    try { await operation(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Desktop operation unavailable.'); }
    finally { setLocalBusy(false); }
  }
  const activeProject = projects.find(item => item.id === projectId);
  const reload = () => { if (conversation) void open(conversation.id).catch(error => setMessage(error.message)); };
  if (view === 'legacy') return <><nav className="legacy-banner"><strong>Legacy workspace · developer workflows</strong><button onClick={() => setView('chat')}>Return to chat</button></nav>{legacy}</>;
  return <div className="desktop-shell">
    <aside className="sidebar">
      <div className="desktop-brand"><span className="brand">Q</span><strong>QASpider<small>Your QA teammate</small></strong></div>
      <nav aria-label="Desktop views"><button aria-current={view === 'chat' ? 'page' : undefined} disabled={busy} onClick={() => setView('chat')}>Conversations</button><button aria-current={view === 'knowledge' ? 'page' : undefined} disabled={busy} onClick={() => setView('knowledge')}>Knowledge</button><button aria-current={view === 'settings' ? 'page' : undefined} disabled={busy} onClick={() => setView('settings')}>Settings</button></nav>
      <label>Project<select aria-label="Project" value={projectId} disabled={busy} onChange={event => { const project = projects.find(item => item.id === event.target.value); setProjectId(event.target.value); setConversation(null); if (project?.conversations[0]) void work(() => open(project.conversations[0]!.id)); }}>
        {projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}
      </select></label>
      <form onSubmit={event => { event.preventDefault(); void work(async () => { const id = value(await window.qaspider.createProject({ title: projectName })); await loadProjects(); setProjectId(id); setConversation(null); setProjectName(''); }); }}>
        <label>New project name<input value={projectName} onChange={event => setProjectName(event.target.value)} disabled={busy} required maxLength={200}/></label><button disabled={busy || !projectName.trim()}>Create project</button>
      </form>
      <div className="conversation-list" aria-label="Project conversations">{activeProject?.conversations.map(item => <button className={conversation?.id === item.id ? 'selected' : ''} key={item.id} disabled={busy} onClick={() => void work(() => open(item.id))}>{item.title}</button>)}</div>
      {projectId !== 'legacy' && <button className="secondary" disabled={busy || !projectId} onClick={() => void work(async () => {
        const result = value(await window.qaspider.createConversation({ projectId, title: `QA conversation ${(activeProject?.conversations.length ?? 0) + 1}`, context: { mode: 'selected', url: 'https://example.com/' } }));
        setConversation(result); await loadProjects(); setView('chat');
      })}>New conversation</button>}
      <p className="hint sidebar-note">Plans need review. Browser actions need separate authorization.</p>
    </aside>
    <main className="conversation-main">
      <header className="conversation-header"><div><strong>{activeProject?.title ?? 'QASpider Desktop'}</strong><small>{view === 'chat' ? conversation?.title ?? 'Conversations' : view === 'knowledge' ? 'Application knowledge' : 'Settings'}</small></div><span className="badge" role="status" data-testid="shared-operation-status">{busy ? operationLabel(operation.channel) : 'Ready'}</span></header>
      {synthetic && <p role="note" className="hint">Synthetic inference enabled by the regression environment. Browser interactions are real.</p>}
      {message && <p role="alert" className="error">{message}</p>}
      {view === 'settings' && <Settings busy={busy} work={work} legacy={() => setView('legacy')}/>}
      {view === 'knowledge' && <Knowledge key={projectId} projectId={projectId}/>}
      {view === 'chat' && <>
        {!conversation ? <section className="chat-welcome"><p className="eyebrow">QA, TOGETHER</p><h1>What should we verify?</h1><p>Create a project and conversation. Add your application URL, then describe the behavior you expect.</p></section> : <>
          {conversation.id !== 'legacy' && <ApplicationContextForm key={`${conversation.id}-${conversation.version}`} conversation={conversation} busy={busy} save={context => work(async () => { setConversation(value(await window.qaspider.setContext({ conversationId: conversation.id, version: conversation.version, context }))); })}/>}
          <section className="chat-timeline" aria-label="Conversation messages" aria-live="polite">
            {conversation.messages.length === 0 && <div className="chat-welcome"><h1>What should we verify?</h1><p>Describe a QA task and its expected results. I’ll prepare a proposal, then help you review executable steps before anything runs.</p></div>}
            {conversation.messages.map(item => <article className={`chat-message ${item.role}`} key={item.id}>
              <small>{item.role === 'user' ? 'You' : 'QASpider'} · {new Date(item.createdAt).toLocaleTimeString()}</small><p className="message-body">{item.body}</p>
              {item.planId && !item.reportId && <fieldset className="artifact-card" disabled={busy}><PlanArtifact planId={item.planId} refresh={refresh} completed={reload}/></fieldset>}
              {item.planId && item.reportId && <ReportArtifact planId={item.planId} reportId={item.reportId}/>}
            </article>)}
          </section>
          {conversation.id !== 'legacy' && <form className="chat-composer" onSubmit={event => { event.preventDefault(); void work(async () => { const result = value(await window.qaspider.sendMessage({ conversationId: conversation.id, text })); setConversation(result); setText(''); setRefresh(count => count + 1); }); }}>
            <label htmlFor="qa-request">QA request and expected results</label><textarea id="qa-request" rows={3} value={text} onChange={event => setText(event.target.value)} disabled={busy} required maxLength={12000} placeholder="Describe the check. Put each acceptance criterion on its own line."/>
            <div className="composer-footer"><small>Saved locally. Requests and discovered page text go to your configured AI provider. Leave passwords and private data out.</small><button disabled={busy || !text.trim()}>{busy ? 'Working…' : 'Prepare test plan'}</button></div>
          </form>}
        </>}
      </>}
    </main>
  </div>;
}

function operationLabel(channel?: string) {
  if (channel === 'desktop:send-message') return 'Preparing plan…';
  if (channel === 'desktop:prepare-draft') return 'Discovering controls…';
  if (channel === 'desktop:execute-plan') return 'Executing approved plan…';
  return 'Working…';
}

function ApplicationContextForm({ conversation, busy, save }: { conversation: Conversation; busy: boolean; save: (context: ApplicationContext) => Promise<void> }) {
  const [context, setContext] = useState(conversation.context);
  const changed = JSON.stringify(context) !== JSON.stringify(conversation.context);
  return <form className="application-context" onSubmit={event => { event.preventDefault(); void save(context); }}>
    <label>Application<select aria-label="Application" value={context.mode} disabled={busy} onChange={event => setContext({ mode: event.target.value as ApplicationContext['mode'], url: event.target.value === 'controlled' ? '/registration' : 'https://example.com/' })}><option value="selected">My website</option><option value="controlled">Owned controlled QA application</option></select></label>
    <label>{context.mode === 'selected' ? 'Website URL' : 'Controlled application path'}<input type={context.mode === 'selected' ? 'url' : 'text'} value={context.url} disabled={busy} onChange={event => setContext({ ...context, url: event.target.value })} required maxLength={4096}/></label>
    <button disabled={busy || !changed}>Save application context</button><small>Current: {conversation.context.url}. Context changes require a new executable plan and renewed approval.</small>
  </form>;
}

function PlanArtifact({ planId, refresh, completed }: { planId: string; refresh: number; completed: () => void }) {
  const [snapshot, setSnapshot] = useState<ReviewSnapshot | null>(null), [message, setMessage] = useState('');
  async function load(revision?: number) {
    try { setSnapshot(value(await window.qaspider.getPlan({ planId, ...(revision ? { revision } : {}) }))); } catch { setMessage('Could not load the linked plan.'); }
  }
  useEffect(() => { void load(); }, [planId, refresh]);
  return snapshot ? <PlanReview snapshot={snapshot} onChange={setSnapshot} openRevision={revision => void load(revision)} presentation="chat" onExecutionComplete={completed}/> : <p>{message || 'Loading linked plan…'}</p>;
}

function ReportArtifact({ planId, reportId }: { planId: string; reportId: string }) {
  const [report, setReport] = useState<TicketReport | null>(null), [message, setMessage] = useState('');
  useEffect(() => { void window.qaspider.report({ planId, reportId }).then(reply => setReport(value(reply))).catch(() => setMessage('Could not load the saved report.')); }, [planId, reportId]);
  return report ? <ReportCard report={report}/> : <p>{message || 'Loading saved report…'}</p>;
}

function Settings({ busy, work, legacy }: { busy: boolean; work: (operation: () => Promise<void>) => Promise<void>; legacy: () => void }) {
  const [settings, setSettings] = useState<DesktopSettings | null>(null), [message, setMessage] = useState('');
  useEffect(() => { void window.qaspider.settings().then(reply => setSettings(value(reply))).catch(() => setMessage('Settings unavailable.')); }, []);
  return <section className="settings-panel"><h1>Settings</h1><p>Configure the existing local provider and browser. Safety checks remain enforced by the desktop process.</p>
    {settings && <form className="workspace-form card" onSubmit={event => { event.preventDefault(); void work(async () => { setSettings(value(await window.qaspider.saveSettings(settings))); setMessage('Settings saved. Pending browser preparation was cleared.'); }); }}>
      <label>AI provider<select aria-label="AI provider" value={settings.provider} disabled={busy} onChange={event => setSettings({ ...settings, provider: event.target.value as DesktopSettings['provider'] })}><option value="codex">Codex CLI</option><option value="none">Disabled</option></select></label>
      <label>Model<input value={settings.model} disabled={busy} onChange={event => setSettings({ ...settings, model: event.target.value })} required maxLength={100}/></label>
      <label>Browser executable path<input value={settings.chromePath} disabled={busy} onChange={event => setSettings({ ...settings, chromePath: event.target.value })} placeholder="Automatic discovery"/></label>
      <label><input type="checkbox" checked={settings.headless} disabled={busy} onChange={event => setSettings({ ...settings, headless: event.target.checked })}/>Run test browser headlessly</label><button disabled={busy}>Save settings</button>
    </form>}
    <p role="status">{message}</p><h2>Safety</h2><ul><li>HTTP(S) targets, exact prepared origin and isolated scenario sessions.</li><li>Review approval never grants browser authorization.</li><li>Selected-website form submissions and file uploads remain unsupported.</li><li>Provider isolation and bounded discovery remain enabled.</li></ul><p className="hint">Environment configuration can override saved settings at startup. Provider sign-in stays in the existing CLI; credentials are never entered here.</p>
    <details><summary>Developer tools and migration fallback</summary><p>Legacy capture, one-action observation, synthetic scenarios and raw diagnostics remain available for development.</p><button disabled={busy} onClick={legacy}>Open legacy workspace</button></details>
  </section>;
}
