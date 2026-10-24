import { useEffect, useState } from 'react';
import { api } from './api.js';

interface StoryContext {
  applicationId: string;
  environmentId: string;
  build: string;
  tenant: string;
  featureFlags: Record<string, boolean>;
}

interface EngineJob {
  id: string;
  taskId: string;
  projectId: string;
  kind: 'plan' | 'execute';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'blocked' | 'paused' | 'cancelled';
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  owner: string | null;
  fence: number;
  leaseUntil: number | null;
}

interface EngineRequest {
  id: string;
  task_id: string;
  kind: string;
  message: string;
  status: 'pending' | 'answered' | 'resolved';
  answer?: string;
}

interface TaskItem {
  id: string;
  projectId: string;
  title: string;
  context: StoryContext;
  markdown: string;
  sourceRef: string;
  storyId: string | null;
  planId: string | null;
  status: string;
  strategy: 'intelligent' | 'deep';
  jobs?: EngineJob[];
  requests?: EngineRequest[];
}

export function TicketsPage({ projectId }: { projectId: string }) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailTask, setDetailTask] = useState<TaskItem | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const base = `/api/v1/projects/${projectId}`;

  async function loadTasks() {
    try {
      const data = await api<TaskItem[]>(`${base}/tasks`);
      setTasks(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(id: string) {
    try {
      const data = await api<TaskItem>(`${base}/task?id=${id}`);
      setDetailTask(data);
    } catch { /* silent */ }
  }

  useEffect(() => {
    void loadTasks();
    const interval = setInterval(() => { void loadTasks(); }, 5000);
    return () => clearInterval(interval);
  }, [projectId]);

  useEffect(() => {
    if (expandedId) void loadDetail(expandedId);
    else setDetailTask(null);
  }, [expandedId]);

  async function controlTask(taskId: string, action: 'pause' | 'resume' | 'cancel') {
    setBusyAction(`${taskId}-${action}`);
    setError('');
    try {
      const key = `${action}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await api(`${base}/task-control`, { taskId, action, commandKey: key });
      await loadTasks();
      if (expandedId === taskId) await loadDetail(taskId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyAction(null);
    }
  }

  async function retestTask(taskId: string) {
    setBusyAction(`${taskId}-retest`);
    setError('');
    try {
      const key = `retest-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await api(`${base}/revalidate`, { taskId, commandKey: key });
      await loadTasks();
      if (expandedId === taskId) await loadDetail(taskId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyAction(null);
    }
  }

  const filtered = tasks.filter(t => {
    if (filter !== 'all' && t.status.toLowerCase().replace(/\s+/g, '-') !== filter) return false;
    if (query.trim()) {
      const q = query.toLowerCase();
      return t.title.toLowerCase().includes(q) || t.sourceRef.toLowerCase().includes(q) || t.id.toLowerCase().includes(q);
    }
    return true;
  });

  const counts = {
    total: tasks.length,
    active: tasks.filter(t => ['planning', 'testing', 'queued'].includes(t.status.toLowerCase())).length,
    review: tasks.filter(t => t.status.toLowerCase().includes('review') || t.status.toLowerCase().includes('permission')).length,
    done: tasks.filter(t => ['reviewed', 'completed'].includes(t.status.toLowerCase())).length,
  };

  return (
    <div style={{ padding: '24px 32px' }} data-project={projectId}>
      <div className="headline" style={{ marginBottom: '20px' }}>
        <div>
          <div className="eyebrow">OPERATIONAL QUEUE</div>
          <h1>QA Tickets</h1>
          <p>Track test plans, autonomous executions, findings, and evidence across tickets.</p>
        </div>
        <button onClick={() => void loadTasks()} disabled={loading} style={{ fontSize: '13px', padding: '8px 14px' }}>
          Refresh Queue
        </button>
      </div>

      {error && <div className="alert error" role="alert" style={{ marginBottom: '16px' }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '14px', marginBottom: '24px' }}>
        <div className="card" style={{ padding: '16px' }}>
          <small style={{ color: 'var(--muted)', fontSize: '12px' }}>Total Tickets</small>
          <strong style={{ fontSize: '26px', display: 'block', marginTop: '4px' }}>{counts.total}</strong>
        </div>
        <div className="card" style={{ padding: '16px' }}>
          <small style={{ color: 'var(--muted)', fontSize: '12px' }}>In Progress</small>
          <strong style={{ fontSize: '26px', display: 'block', marginTop: '4px', color: '#0060a0' }}>{counts.active}</strong>
        </div>
        <div className="card" style={{ padding: '16px' }}>
          <small style={{ color: 'var(--muted)', fontSize: '12px' }}>Action Required</small>
          <strong style={{ fontSize: '26px', display: 'block', marginTop: '4px', color: '#a04020' }}>{counts.review}</strong>
        </div>
        <div className="card" style={{ padding: '16px' }}>
          <small style={{ color: 'var(--muted)', fontSize: '12px' }}>Completed / Reviewed</small>
          <strong style={{ fontSize: '26px', display: 'block', marginTop: '4px', color: '#176547' }}>{counts.done}</strong>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input
          style={{ flex: 1, minWidth: '220px', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--line)', fontSize: '13px' }}
          placeholder="Filter tickets by title, reference, or ID…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          aria-label="Search tickets"
        />
        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--line)', fontSize: '13px', background: '#fff' }}
          aria-label="Filter by status"
        >
          <option value="all">All Statuses</option>
          <option value="queued">Queued</option>
          <option value="planning">Planning</option>
          <option value="testing">Testing</option>
          <option value="needs-permission">Needs Permission</option>
          <option value="ready-for-review">Ready for Review</option>
          <option value="reviewed">Reviewed</option>
          <option value="paused">Paused</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {loading && tasks.length === 0 ? (
        <div className="card empty" style={{ padding: '40px', textAlign: 'center' }}>
          <p>Loading QA ticket queue…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card empty" style={{ padding: '40px', textAlign: 'center' }}>
          <h2>No matching tickets</h2>
          <p style={{ color: 'var(--muted)', margin: '8px 0' }}>
            {tasks.length === 0 ? 'No tickets queued yet. Head to Orchestrator to test your first ticket!' : 'No tickets match the selected filters.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.map(task => {
            const isExpanded = expandedId === task.id;
            const currentDetail = isExpanded ? (detailTask ?? task) : task;
            const statusKey = task.status.toLowerCase().replace(/\s+/g, '-');
            return (
              <div
                key={task.id}
                className="card"
                style={{
                  padding: '16px 20px',
                  borderRadius: '10px',
                  border: isExpanded ? '1px solid var(--teal)' : '1px solid var(--line)',
                  background: '#ffffff',
                  transition: 'border-color .15s'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '240px', cursor: 'pointer' }} onClick={() => setExpandedId(isExpanded ? null : task.id)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <strong style={{ fontSize: '15px', color: 'var(--ink)' }}>{task.title}</strong>
                      <span className={`ticket-status ${statusKey}`}>{task.status}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '14px', marginTop: '6px', fontSize: '12px', color: 'var(--muted)' }}>
                      <span>Ref: <code>{task.sourceRef}</code></span>
                      <span>ID: <code>{task.id.slice(0, 8)}</code></span>
                      <span>Strategy: {task.strategy}</span>
                      {task.jobs && <span>Jobs: {task.jobs.length}</span>}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {task.status === 'Paused' && (
                      <button
                        style={{ fontSize: '12px', padding: '6px 10px', minHeight: '30px' }}
                        disabled={busyAction === `${task.id}-resume`}
                        onClick={() => void controlTask(task.id, 'resume')}
                      >
                        Resume
                      </button>
                    )}
                    {['Queued', 'Planning', 'Testing'].includes(task.status) && (
                      <button
                        style={{ fontSize: '12px', padding: '6px 10px', minHeight: '30px' }}
                        disabled={busyAction === `${task.id}-pause`}
                        onClick={() => void controlTask(task.id, 'pause')}
                      >
                        Pause
                      </button>
                    )}
                    {!['Cancelled', 'Reviewed'].includes(task.status) && (
                      <button
                        style={{ fontSize: '12px', padding: '6px 10px', minHeight: '30px', color: '#a8414b' }}
                        disabled={busyAction === `${task.id}-cancel`}
                        onClick={() => void controlTask(task.id, 'cancel')}
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      style={{ fontSize: '12px', padding: '6px 10px', minHeight: '30px' }}
                      disabled={busyAction === `${task.id}-retest`}
                      onClick={() => void retestTask(task.id)}
                    >
                      Retest
                    </button>
                    <button
                      style={{ fontSize: '12px', padding: '6px 10px', minHeight: '30px' }}
                      onClick={() => setExpandedId(isExpanded ? null : task.id)}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? '▲ Less' : '▼ Details'}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ marginTop: '18px', paddingTop: '16px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div>
                      <h4 style={{ fontSize: '13px', margin: '0 0 6px', color: 'var(--muted)', textTransform: 'uppercase' }}>Acceptance Criteria & Markdown</h4>
                      <pre style={{ background: '#fafbfc', padding: '12px', borderRadius: '6px', fontSize: '12px', whiteSpace: 'pre-wrap', maxHeight: '180px', overflowY: 'auto' }}>
                        {currentDetail.markdown}
                      </pre>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '12px' }}>
                      <div style={{ background: '#f5f8fa', padding: '10px 12px', borderRadius: '6px' }}>
                        <small style={{ color: 'var(--muted)', display: 'block' }}>Environment</small>
                        <strong style={{ fontSize: '13px' }}>{currentDetail.context.environmentId}</strong>
                      </div>
                      <div style={{ background: '#f5f8fa', padding: '10px 12px', borderRadius: '6px' }}>
                        <small style={{ color: 'var(--muted)', display: 'block' }}>Application</small>
                        <strong style={{ fontSize: '13px' }}>{currentDetail.context.applicationId}</strong>
                      </div>
                      <div style={{ background: '#f5f8fa', padding: '10px 12px', borderRadius: '6px' }}>
                        <small style={{ color: 'var(--muted)', display: 'block' }}>Build / Tenant</small>
                        <strong style={{ fontSize: '13px' }}>{currentDetail.context.build} / {currentDetail.context.tenant}</strong>
                      </div>
                    </div>

                    {currentDetail.requests && currentDetail.requests.length > 0 && (
                      <div>
                        <h4 style={{ fontSize: '13px', margin: '0 0 8px', color: '#996200', textTransform: 'uppercase' }}>Active Requests ({currentDetail.requests.length})</h4>
                        {currentDetail.requests.map(req => (
                          <div key={req.id} style={{ padding: '10px 12px', background: '#fffcf0', border: '1px solid #fed8a6', borderRadius: '6px', marginBottom: '6px', fontSize: '13px' }}>
                            <strong>{req.kind}</strong> · <span style={{ textTransform: 'uppercase', fontSize: '11px', color: 'var(--muted)' }}>{req.status}</span>
                            <p style={{ margin: '4px 0 0' }}>{req.message}</p>
                            {req.answer && <small style={{ color: 'var(--teal)', display: 'block', marginTop: '4px' }}>Answer: {req.answer}</small>}
                          </div>
                        ))}
                      </div>
                    )}

                    {currentDetail.jobs && currentDetail.jobs.length > 0 && (
                      <div>
                        <h4 style={{ fontSize: '13px', margin: '0 0 8px', color: 'var(--muted)', textTransform: 'uppercase' }}>Jobs Activity ({currentDetail.jobs.length})</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {currentDetail.jobs.map(j => (
                            <div key={j.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#f9fbfc', border: '1px solid var(--line)', borderRadius: '6px', fontSize: '12px' }}>
                              <span>
                                <strong>{j.kind.toUpperCase()}</strong> · Job <code>{j.id.slice(0, 8)}</code>
                              </span>
                              <span className={`ticket-status ${j.status}`}>
                                {j.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
