import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';

interface Thread { id: string; title: string; archived: number; created_at: number; }
interface Message { id: string; role: 'user' | 'assistant'; text: string; task_id: string | null; created_at: number; }

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function OrchestratorPage({ projectId }: { projectId: string }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const base = `/api/v1/projects/${projectId}`;

  async function loadThreads() {
    try {
      const data = await api<Thread[]>(base + '/threads');
      setThreads(data.filter(t => !t.archived));
    } catch { /* silent */ }
  }

  async function loadMessages(threadId: string) {
    try {
      const data = await api<Message[]>(base + '/messages?id=' + threadId);
      setMessages(data);
    } catch { /* silent */ }
  }

  useEffect(() => { void loadThreads(); }, [projectId]);
  useEffect(() => { if (activeId) void loadMessages(activeId); else setMessages([]); }, [activeId, projectId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setError('');
    try {
      const key = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      const result = await api<{ threadId: string; messageId?: string }>(
        base + '/messages',
        { threadId: activeId ?? undefined, text, commandKey: key }
      );
      if (!activeId) {
        setActiveId(result.threadId);
        await loadThreads();
      }
      await loadMessages(result.threadId);
      setInput('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function archiveThread(threadId: string) {
    try {
      await api(base + '/thread', { id: threadId, archived: true });
      if (activeId === threadId) setActiveId(null);
      await loadThreads();
    } catch (e) { setError((e as Error).message); }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
  }

  return (
    <div className="orc-layout">
      {/* Thread sidebar */}
      <aside className="orc-threads">
        <div className="orc-threads-head">
          <h2>Conversations</h2>
          <button className="new-chat-btn" onClick={() => { setActiveId(null); setInput(''); setError(''); }}>
            + New
          </button>
        </div>
        <div className="orc-thread-list">
          {threads.length === 0 && (
            <p style={{ padding: '16px', fontSize: 13, color: 'var(--muted)', margin: 0 }}>
              No conversations yet. Start a new chat.
            </p>
          )}
          {threads.map(t => (
            <button
              key={t.id}
              className={`orc-thread-item${activeId === t.id ? ' active' : ''}`}
              onClick={() => setActiveId(t.id)}
            >
              <span className="orc-thread-info">
                <span className="orc-thread-title">{t.title || 'Untitled'}</span>
                <span className="orc-thread-time">{timeAgo(t.created_at)}</span>
              </span>
              <button
                className="orc-archive-btn"
                title="Archive conversation"
                onClick={e => { e.stopPropagation(); void archiveThread(t.id); }}
                aria-label={`Archive ${t.title}`}
              >
                ✕
              </button>
            </button>
          ))}
        </div>
      </aside>

      {/* Message feed */}
      <div className="orc-feed">
        {activeId === null && messages.length === 0 ? (
          <div className="orc-empty">
            <span className="brand-mark" style={{ fontSize: 28 }}>Q</span>
            <h2>QA Orchestrator</h2>
            <p>Start a conversation to assign QA work. Describe tickets, ask for test status, or request findings review.</p>
            <p style={{ fontSize: 12, marginTop: 4 }}>
              Try: <em>&quot;Test the login and registration flows for the dev environment&quot;</em>
            </p>
          </div>
        ) : (
          <div className="orc-messages">
            {messages.map(m => (
              <div key={m.id} className={`orc-msg ${m.role}`}>
                <div className="orc-bubble">{m.text}</div>
                {m.task_id && (
                  <span className="orc-task-badge">🎫 Linked to ticket</span>
                )}
                <span className="orc-msg-time">{timeAgo(m.created_at)}</span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}

        {error && <div className="orc-error">{error}</div>}

        <div className="orc-composer">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKey}
            placeholder="Ask to test a ticket, check status, or review findings…"
            disabled={sending}
            rows={1}
            aria-label="Message"
          />
          <button
            className="orc-send-btn"
            onClick={() => void send()}
            disabled={!input.trim() || sending}
            aria-label="Send message"
          >
            {sending ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
