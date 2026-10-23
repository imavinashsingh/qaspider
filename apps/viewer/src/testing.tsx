import { useEffect, useState } from 'react';
import type { NavigationScope, StoryRevision, PlanRevision, TestRun, TestReport, QaJob, Requirement } from '../../../packages/core/src/index.js';
import { api } from './api.js';
type ScopeView = Omit<NavigationScope, 'config'>;
type Artifact = {
    id: string;
    kind: string;
    status: string;
    sizeBytes: number;
};
export function Testing({ view }: {
    view: 'studio' | 'runs';
}) {
    const [scopes, setScopes] = useState<ScopeView[]>([]), [scopeId, setScopeId] = useState(''), [roles, setRoles] = useState<string[]>([]);
    const [stories, setStories] = useState<StoryRevision[]>([]), [storyId, setStoryId] = useState(''), [markdown, setMarkdown] = useState('# Registration\n\n## Acceptance Criteria\n- AC-1: A valid unique email displays Account created in the status role.\n- AC-2: An invalid email displays Invalid email in the alert role.\n- AC-3: A duplicate email displays Email already exists in the alert role.'), [source, setSource] = useState('registration.md');
    const [plans, setPlans] = useState<PlanRevision[]>([]), [planId, setPlanId] = useState(''), [proposal, setProposal] = useState(''), [policy, setPolicy] = useState('{"actionGrants":[],"readGrants":[],"fixtures":null,"discovery":false}');
    const [reviewer, setReviewer] = useState('local-owner'), [approvedRequirements, setApprovedRequirements] = useState<string[]>([]);
    const [runs, setRuns] = useState<TestRun[]>([]), [runId, setRunId] = useState(''), [report, setReport] = useState<TestReport | null>(null), [artifacts, setArtifacts] = useState<Artifact[]>([]), [evidence, setEvidence] = useState(''), [image, setImage] = useState('');
    const [job, setJob] = useState<QaJob | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
    const plan = plans.find(p => p.id === planId), story = stories.find(s => s.id === (plan?.storyRevisionId ?? storyId)), scope = scopes.find(s => s.id === scopeId);
    async function refresh() { const [s, p, r] = await Promise.all([api<StoryRevision[]>('/api/qa/stories'), api<PlanRevision[]>('/api/qa/plans'), api<TestRun[]>('/api/qa/runs')]); setStories(s); setPlans(p); setRuns(r); return { s, p, r }; }
    async function action(work: () => Promise<void>) {
        setBusy(true);
        setError('');
        setNotice('');
        try {
            await work();
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }
    useEffect(() => {
        void action(async () => {
            await refresh();
            const s = await api<ScopeView[]>('/api/scopes');
            setScopes(s);
            if (s[0]) {
                setScopeId(s[0].id);
                setRoles([s[0].scope.roleId]);
            }
        });
    }, []);
    useEffect(() => { setProposal(plan ? JSON.stringify(plan.proposal, null, 2) : ''); setApprovedRequirements([]); }, [planId]);
    useEffect(() => {
        if (!runId) {
            setReport(null);
            setArtifacts([]);
            return;
        }
        let active = true;
        const load = async () => {
            const [r, a] = await Promise.all([api<TestReport>(`/api/qa/report?id=${runId}`), api<Artifact[]>(`/api/qa/artifacts?run=${runId}`)]);
            if (active) {
                setReport(r);
                setArtifacts(a);
            }
        };
        void load().catch(e => setError((e as Error).message));
        const timer = setInterval(() => { void load().catch(() => { }); }, 1500);
        return () => { active = false; clearInterval(timer); };
    }, [runId]);
    useEffect(() => {
        if (!job || job.status !== 'running')
            return;
        const timer = setInterval(() => {
            void api<QaJob>(`/api/qa/job?id=${job.id}`).then(async (value) => {
                setJob(value);
                if (value.kind === 'execute' && value.resultId)
                    setRunId(value.resultId);
                if (value.status !== 'running') {
                    await refresh();
                    if (value.kind === 'plan' && value.resultId)
                        setPlanId(value.resultId);
                    if (value.status === 'failed')
                        setError(value.message);
                }
            }).catch(e => setError((e as Error).message));
        }, 700);
        return () => clearInterval(timer);
    }, [job?.id, job?.status]);
    useEffect(() => () => {
        if (image)
            URL.revokeObjectURL(image);
    }, [image]);
    function benchmarkPolicy() {
        if (!scope)
            return;
        const origin = new URL(scope.seedUrl).origin;
        setPolicy(JSON.stringify({ actionGrants: roles.map(roleId => ({ roleId, url: `${origin}/api/register`, method: 'POST' })), readGrants: roles.map(roleId => ({ roleId, url: `${origin}/api/admin/users` })), fixtures: { setupUrl: `${origin}/__fixtures/setup`, cleanupUrl: `${origin}/__fixtures/cleanup`, tokenEnv: 'BENCHMARK_FIXTURE_TOKEN', emailDomain: 'example.test' }, discovery: false }, null, 2));
    }
    async function showEvidence(artifact: Artifact) {
        setEvidence('');
        setImage('');
        const response = await fetch(`/api/qa/evidence?run=${runId}&id=${artifact.id}`, { headers: { 'x-qaspider-token': sessionStorage.getItem('qaspider-token') ?? '' } });
        if (!response.ok)
            throw new Error('Evidence unavailable or restricted');
        if (artifact.kind === 'screenshot')
            setImage(URL.createObjectURL(await response.blob()));
        else
            setEvidence(JSON.stringify(await response.json(), null, 2));
    }
    const availableRoles = scopes.filter(s => scope && JSON.stringify({ ...s.scope, roleId: '' }) === JSON.stringify({ ...scope.scope, roleId: '' })).map(s => s.scope.roleId);
    const requirement = (req: Requirement) => <label key={req.id} className="criterion"><input type="checkbox" checked={approvedRequirements.includes(req.id)} onChange={e => setApprovedRequirements(ids => e.target.checked ? [...ids, req.id] : ids.filter(id => id !== req.id))}/><span><strong>{req.key} · {req.origin} · {req.approved ? 'previously approved' : 'requires approval'}</strong><br />{req.text}<small>{req.sourceRef}</small></span></label>;
    return <><div className="headline"><div><div className="eyebrow">STORIES / EXECUTION</div><h1>{view === 'studio' ? 'Test Studio' : 'Test Runs'}</h1><p>{view === 'studio' ? 'Review exact plan revisions before deterministic execution.' : 'Persisted assertion results and local evidence.'}</p></div><span className="tag">M2 · Local first</span></div>
 {error && <div role="alert" className="alert error">{error}</div>}{notice && <div role="status" className="alert">{notice}</div>}
 {job && <section className="card qa-section" aria-label="Job progress"><strong>{job.kind} · {job.status}</strong><p role="status">{job.message}</p><small className="mono">{job.id}{job.resultId && ` · ${job.resultId}`}</small>{job.status === 'running' && <button onClick={() => void action(async () => { await api('/api/qa/cancel', { jobId: job.id }); })}>Cancel job</button>}</section>}
 {view === 'studio' && <><section className="card qa-section"><h2>1. Story and scoped roles</h2><label>Navigation context<select value={scopeId} onChange={e => { setScopeId(e.target.value); const s = scopes.find(s => s.id === e.target.value); setRoles(s ? [s.scope.roleId] : []); }}>{scopes.map(s => <option value={s.id} key={s.id}>{s.scope.applicationId} / {s.scope.environmentId} / {s.scope.build} / {s.scope.tenant} / {s.scope.roleId}</option>)}</select></label><div className="qa-roles">{availableRoles.map(role => <label key={role}><input type="checkbox" checked={roles.includes(role)} onChange={e => setRoles(ids => e.target.checked ? [...ids, role] : ids.filter(id => id !== role))}/>{role}</label>)}</div>
 <label>Source reference<input value={source} onChange={e => setSource(e.target.value)}/></label><label>Markdown story<textarea aria-label="Markdown story" rows={10} value={markdown} onChange={e => setMarkdown(e.target.value)}/></label><button className="primary" disabled={busy || !scope || !roles.length} onClick={() => void action(async () => { const { roleId: _, ...context } = scope!.scope; const s = await api<StoryRevision>('/api/qa/stories', { markdown, sourceRef: source, context: { ...context, roleIds: roles }, ...(storyId ? { storyId: stories.find(s => s.id === storyId)?.storyId } : {}) }); await refresh(); setStoryId(s.id); setPlanId(''); setNotice(`Saved story revision ${s.revision}.`); })}>Save story revision</button>
 <label>Stored story revision<select aria-label="Stored story" value={storyId} onChange={e => {
                setStoryId(e.target.value);
                setPlanId('');
                const s = stories.find(s => s.id === e.target.value);
                if (s) {
                    setMarkdown(s.markdown);
                    setSource(s.sourceRef);
                }
            }}><option value="">New story</option>{stories.map(s => <option key={s.id} value={s.id}>{s.title} · revision {s.revision} · {s.id.slice(0, 8)}</option>)}</select></label></section>
 <section className="card qa-section"><h2>2. Planning permissions</h2><p>Only declared endpoints and owned fixtures can be used. Review these permissions with the plan. Credentials are environment references.</p>{scope?.scope.applicationId === 'benchmark' && <button onClick={benchmarkPolicy}>Use local benchmark permissions</button>}<label>Execution policy JSON<textarea rows={8} value={policy} onChange={e => setPolicy(e.target.value)}/></label><button className="primary" disabled={busy || !storyId || job?.status === 'running'} onClick={() => void action(async () => setJob(await api<QaJob>('/api/qa/plan', { storyRevisionId: storyId, policy: JSON.parse(policy) })))}>Generate plan with Codex</button><p className="muted">Synthetic isolation validation runs before application context is shared. Newly discovered navigation requires separate navigation approval.</p></section>
 <section className="card qa-section"><h2>3. Review and approve exact plan</h2><label>Plan revision<select aria-label="Plan revision" value={planId} onChange={e => setPlanId(e.target.value)}><option value="">Select plan</option>{plans.map(p => <option key={p.id} value={p.id}>{p.proposal.title} · revision {p.revision} · {p.status}</option>)}</select></label>{plan && <><p><span className={`status ${plan.status}`}>{plan.status}</span> Provider: {plan.provider.id} {plan.provider.synthetic ? '· SYNTHETIC FIXTURE' : '· real provider'}</p><small className="mono">Approved content hash: {plan.hash}</small><details><summary>Exact execution policy</summary><pre>{JSON.stringify(plan.policy, null, 2)}</pre></details><div aria-label="Scenario review">{plan.proposal.scenarios.map(s => <article className="qa-result" key={s.id}><h3>{s.title}</h3><p>Role: {s.roleId} · Severity: {s.severity} · Approved retries: {s.retries}</p><small className="mono">Starting UI state: {s.targetStateId}</small>{s.assertions.map(a => <p key={a.id}><strong>{a.kind === 'http-status' ? 'HTTP status' : a.kind === 'visible' ? 'Visibility' : 'Text'}: {JSON.stringify(a.expected)}</strong><br /><small>Source: {story?.requirements.find(r => r.id === a.requirementId)?.key} · {a.requirementId}</small></p>)}<small>{s.allowedActions.length ? s.allowedActions.map(g => `${g.method} ${g.url}`).join(' · ') : 'No application write grants'} · Cleanup: owned fixtures</small></article>)}</div><label>Scenario proposal JSON<textarea aria-label="Scenario proposal" rows={18} value={proposal} onChange={e => setProposal(e.target.value)}/></label><button disabled={busy} onClick={() => void action(async () => { const p = await api<PlanRevision>('/api/qa/edit', { planRevisionId: plan.id, proposal: JSON.parse(proposal) }); await refresh(); setPlanId(p.id); setNotice('Saved a new immutable plan revision; previous revision retained.'); })}>Save edited revision</button><h3>Explicit requirement approval</h3>{story?.requirements.map(requirement)}<label>Reviewer<input value={reviewer} onChange={e => setReviewer(e.target.value)}/></label><button className="primary" disabled={busy || !reviewer.trim() || plan.status === 'approved' || !approvedRequirements.length || proposal !== JSON.stringify(plan.proposal, null, 2)} onClick={() => void action(async () => { await api('/api/qa/approve', { planRevisionId: plan.id, reviewer, requirementIds: approvedRequirements }); await refresh(); setNotice('Exact plan revision and selected requirements approved.'); })}>Approve displayed plan and selected requirements</button><p>Approval preserves this revision, its requirements, assertions and endpoint permissions.</p><button className="primary" disabled={busy || plan.status !== 'approved' || job?.status === 'running'} onClick={() => void action(async () => setJob(await api<QaJob>('/api/qa/execute', { planRevisionId: plan.id })))}>Execute approved plan without AI</button></>}</section></>}
 {(view === 'runs' || runId) && <section className="card qa-section"><h2>Persisted test runs</h2><button onClick={() => void action(async () => { await refresh(); })}>Refresh runs</button><label>Run<select aria-label="Test run" value={runId} onChange={e => { setRunId(e.target.value); setImage(''); setEvidence(''); }}><option value="">Select run</option>{runs.map(r => <option key={r.id} value={r.id}>{new Date(r.startedAt).toLocaleString()} · {r.status} · {r.id.slice(0, 8)}</option>)}</select></label>{!runs.length && <p>No test runs persisted. Approve and execute a plan in Test Studio.</p>}
 {report && <div data-testid="test-report"><h2>{report.plan.proposal.title}</h2><p>{report.run.status} · plan revision {report.plan.revision} · {report.plan.provider.synthetic ? 'SYNTHETIC PLANNING FIXTURE' : report.plan.provider.id}</p><small className="mono">{report.run.id} · {report.plan.hash}</small><div className="qa-summary">{Object.entries(report.summary).map(([status, count]) => <span key={status} className="tag">{status}: {count}</span>)}</div>{report.results.map(r => <article className="qa-result" key={r.scenarioId} data-testid="scenario-result"><h3>{report.plan.proposal.scenarios.find(s => s.id === r.scenarioId)?.title} <span className={`status ${r.status.toLowerCase()}`}>{r.status}</span></h3><p>Role: {r.roleId}</p>{r.attempts.map((a, index) => <div key={index}><p>Attempt {index + 1}: {a.reason}</p><small className="mono">Navigation replay: {a.navigationRunId ?? 'not started'}</small>{a.assertions.map(assertion => <div className="qa-assertion" key={assertion.id}><strong>{assertion.id} · {assertion.status}</strong><p>Expected: {JSON.stringify(assertion.expected)}<br />Actual: {JSON.stringify(assertion.actual)}</p><small>Requirement: {assertion.requirementId}</small></div>)}</div>)}</article>)}<h3>Fixture lifecycle</h3>{report.fixtures.length ? report.fixtures.map(f => <p key={f.id}>{f.scenarioId} · {f.kind} · {f.status} {f.message}</p>) : <p>No owned fixtures used.</p>}<h3>Local evidence</h3><p>Full traces may contain session data and remain restricted to the local artifact store.</p><div className="qa-artifacts">{artifacts.map(a => <button key={a.id} disabled={a.kind === 'trace' || a.status !== 'available'} onClick={() => void action(() => showEvidence(a))}>{a.kind} · {a.status} · {a.id.slice(0, 8)}</button>)}</div>{image && <img className="qa-screenshot" alt="Recorded assertion evidence" src={image}/>} {evidence && <pre>{evidence}</pre>}<button disabled={busy || report.run.status === 'running'} onClick={() => void action(async () => setJob(await api<QaJob>('/api/qa/execute', { planRevisionId: report.plan.id, selected: report.run.selectedScenarioIds })))}>Replay selected scenarios without AI</button></div>}</section>}
 </>;
}
