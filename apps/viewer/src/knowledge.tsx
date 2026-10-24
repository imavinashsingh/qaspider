import { useEffect, useState } from 'react';
import { api } from './api.js';

interface Scope {
  applicationId: string;
  environmentId: string;
  build: string;
  tenant: string;
  roleId: string;
}

interface RouteSummary {
  scope: Scope;
  statesCount: number;
  transitionsCount: number;
  approvedTransitionsCount: number;
  verifiedTransitionsCount: number;
  lastObserved: number;
}

interface KnowledgeItem {
  id: string;
  kind: 'observation' | 'workflow' | 'requirement' | 'guidance';
  status: string;
  text: string;
  sourceRef: string;
  evidenceIds: string[];
  verifiedAt: number;
  expiresAt: number;
  stale: boolean;
}

interface Schedule {
  id: string;
  task_id: string;
  enabled: number;
  interval_ms: number;
  next_at: number;
}

interface KnowledgeResponse {
  items: KnowledgeItem[];
  routes: RouteSummary[];
  schedules: Schedule[];
}

export function KnowledgePage({ projectId }: { projectId: string }) {
  const [data, setData] = useState<KnowledgeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'observation' | 'workflow' | 'requirement' | 'guidance'>('all');
  const [search, setSearch] = useState('');

  const base = `/api/v1/projects/${projectId}`;

  async function loadKnowledge() {
    try {
      const res = await api<KnowledgeResponse>(`${base}/knowledge`);
      setData(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadKnowledge();
  }, [projectId]);

  const items = (data?.items ?? []).filter(item => {
    if (filter !== 'all' && item.kind !== filter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return item.text.toLowerCase().includes(q) || item.sourceRef.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div style={{ padding: '24px 32px' }} data-project={projectId}>
      <div className="headline" style={{ marginBottom: '20px' }}>
        <div>
          <div className="eyebrow">PERSISTENT QA MEMORY</div>
          <h1>Knowledge</h1>
          <p>Verified navigation routes, approved workflows, learned expectations, and staleness.</p>
        </div>
        <button onClick={() => void loadKnowledge()} disabled={loading} style={{ fontSize: '13px', padding: '8px 14px' }}>
          Refresh Knowledge
        </button>
      </div>

      {error && <div className="alert error" role="alert" style={{ marginBottom: '16px' }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '14px', marginBottom: '24px' }}>
        <div className="card" style={{ padding: '16px' }}>
          <small style={{ color: 'var(--muted)', fontSize: '12px' }}>Navigable Routes</small>
          <strong style={{ fontSize: '26px', display: 'block', marginTop: '4px' }}>{data?.routes.length ?? 0}</strong>
        </div>
        <div className="card" style={{ padding: '16px' }}>
          <small style={{ color: 'var(--muted)', fontSize: '12px' }}>Knowledge Entries</small>
          <strong style={{ fontSize: '26px', display: 'block', marginTop: '4px', color: '#0060a0' }}>{data?.items.length ?? 0}</strong>
        </div>
        <div className="card" style={{ padding: '16px' }}>
          <small style={{ color: 'var(--muted)', fontSize: '12px' }}>Active Schedules</small>
          <strong style={{ fontSize: '26px', display: 'block', marginTop: '4px', color: '#176547' }}>
            {data?.schedules.filter(s => s.enabled === 1).length ?? 0}
          </strong>
        </div>
        <div className="card" style={{ padding: '16px' }}>
          <small style={{ color: 'var(--muted)', fontSize: '12px' }}>Stale Entries</small>
          <strong style={{ fontSize: '26px', display: 'block', marginTop: '4px', color: '#a04020' }}>
            {data?.items.filter(i => i.stale).length ?? 0}
          </strong>
        </div>
      </div>

      <section className="card" style={{ padding: '20px', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '16px', margin: '0 0 14px', color: 'var(--ink)' }}>Scoped Navigation Routes</h2>
        {(!data?.routes || data.routes.length === 0) ? (
          <p style={{ color: 'var(--muted)', fontSize: '13px', margin: 0 }}>No navigation routes mapped for this project yet.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
            {data.routes.map((r, i) => (
              <div key={i} style={{ padding: '14px', borderRadius: '8px', border: '1px solid var(--line)', background: '#fafbfc' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <strong style={{ fontSize: '13px' }}>{r.scope.roleId}</strong>
                  <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Build: {r.scope.build}</span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span>App: <code>{r.scope.applicationId}</code> · Env: <code>{r.scope.environmentId}</code></span>
                  <span>States observed: <strong>{r.statesCount}</strong></span>
                  <span>Transitions: <strong>{r.transitionsCount}</strong> ({r.approvedTransitionsCount} approved, {r.verifiedTransitionsCount} verified)</span>
                  {r.lastObserved > 0 && <span>Last active: {new Date(r.lastObserved).toLocaleString()}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card" style={{ padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
          <h2 style={{ fontSize: '16px', margin: 0, color: 'var(--ink)' }}>Learned Knowledge & Expectations</h2>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              style={{ fontSize: '13px', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--line)' }}
              placeholder="Filter knowledge…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              aria-label="Filter knowledge"
            />
            <select
              value={filter}
              onChange={e => setFilter(e.target.value as typeof filter)}
              style={{ fontSize: '13px', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: '#fff' }}
              aria-label="Filter by kind"
            >
              <option value="all">All Kinds</option>
              <option value="observation">Observations</option>
              <option value="workflow">Workflows</option>
              <option value="requirement">Requirements</option>
              <option value="guidance">Guidance</option>
            </select>
          </div>
        </div>

        {loading ? (
          <p style={{ color: 'var(--muted)', fontSize: '13px' }}>Loading knowledge entries…</p>
        ) : items.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: '13px' }}>No knowledge entries found matching the filter.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {items.map(item => (
              <div key={item.id} style={{ padding: '12px 14px', borderRadius: '8px', border: '1px solid var(--line)', background: item.stale ? '#fffbf5' : '#ffffff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', textTransform: 'uppercase', padding: '2px 7px', borderRadius: '4px', background: '#eef3ff', color: '#3751a0', fontWeight: 650 }}>
                      {item.kind}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Ref: <code>{item.sourceRef.slice(0, 24)}</code></span>
                  </div>
                  <span style={{ fontSize: '11px', color: item.stale ? '#a04020' : 'var(--muted)', fontWeight: item.stale ? 650 : 400 }}>
                    {item.stale ? '⚠️ Stale' : 'Verified'} · {new Date(item.verifiedAt).toLocaleDateString()}
                  </span>
                </div>
                <p style={{ fontSize: '13px', margin: '4px 0 0', color: 'var(--ink)', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
