import { useState } from 'react';
import { api } from './api.js';

export interface PlanCardProps {
  projectId: string;
  taskId: string;
  title: string;
  status: string;
  planId?: string | null;
  scenariosCount?: number;
  onUpdated?: () => void;
}

export function PlanCard({ projectId, taskId, title, status, planId, scenariosCount = 0, onUpdated }: PlanCardProps) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [showReplan, setShowReplan] = useState(false);
  const [error, setError] = useState('');
  const base = `/api/v1/projects/${projectId}`;

  async function approve() {
    setBusy(true);
    setError('');
    try {
      const task = await api<{ id: string; planId: string | null; storyId: string | null }>(`${base}/task?id=${taskId}`);
      if (!task.planId) throw new Error('No plan generated yet');
      const plan = await api<{ id: string; hash: string; scenarios: { requirementIds: string[] }[] }>(`${base}/plans`).then(plans => {
        const found = (plans as unknown as { id: string; hash: string; scenarios: { requirementIds: string[] }[] }[]).find(p => p.id === task.planId);
        if (!found) throw new Error('Plan not found');
        return found;
      });
      const key = 'appr-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      const reqIds = [...new Set(plan.scenarios.flatMap(s => s.requirementIds))];
      await api(`${base}/task-approve`, {
        taskId,
        planRevisionId: task.planId,
        planHash: plan.hash,
        requirementIds: reqIds,
        decisions: [],
        commandKey: key
      });
      onUpdated?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function replan() {
    if (!feedback.trim()) return;
    setBusy(true);
    setError('');
    try {
      const key = 'replan-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      await api(`${base}/task-replan`, { taskId, feedback: feedback.trim(), commandKey: key });
      setShowReplan(false);
      setFeedback('');
      onUpdated?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    setBusy(true);
    setError('');
    try {
      const task = await api<{ id: string; planId: string | null }>(`${base}/task?id=${taskId}`);
      if (!task.planId) throw new Error('No approved plan to execute');
      const key = 'exec-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      await api(`${base}/task-execute`, { taskId, planRevisionId: task.planId, commandKey: key });
      onUpdated?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card plan-card" style={{ padding: '16px', margin: '8px 0', border: '1px solid #d5e1eb', borderRadius: '10px', background: '#ffffff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <strong style={{ fontSize: '14px', color: 'var(--ink)' }}>{title}</strong>
        <span className={`ticket-status ${status.toLowerCase().replace(/\s+/g, '-')}`}>{status}</span>
      </div>
      <p style={{ fontSize: '13px', color: 'var(--muted)', margin: '4px 0 12px' }}>
        Task ID: <code style={{ fontSize: '12px' }}>{taskId.slice(0, 8)}</code>
        {planId && <> · Plan: <code style={{ fontSize: '12px' }}>{planId.slice(0, 8)}</code></>}
        {scenariosCount > 0 && <> · {scenariosCount} scenario(s)</>}
      </p>
      {error && <div className="orc-error" style={{ margin: '0 0 10px' }}>{error}</div>}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {status === 'Ready for Review' && (
          <button className="primary" style={{ fontSize: '12px', padding: '6px 12px', minHeight: '32px' }} disabled={busy} onClick={() => void approve()}>
            Approve Plan
          </button>
        )}
        {status === 'Queued' && planId && (
          <button className="primary" style={{ fontSize: '12px', padding: '6px 12px', minHeight: '32px' }} disabled={busy} onClick={() => void execute()}>
            Execute Tests
          </button>
        )}
        {!showReplan ? (
          <button style={{ fontSize: '12px', padding: '6px 12px', minHeight: '32px' }} disabled={busy} onClick={() => setShowReplan(true)}>
            Replan…
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', marginTop: '8px' }}>
            <input
              style={{ fontSize: '13px', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--line)' }}
              placeholder="Enter feedback or guidance for replanning…"
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
            />
            <div style={{ display: 'flex', gap: '6px' }}>
              <button className="primary" style={{ fontSize: '12px', padding: '5px 10px' }} disabled={busy || !feedback.trim()} onClick={() => void replan()}>
                Submit Replan
              </button>
              <button style={{ fontSize: '12px', padding: '5px 10px' }} onClick={() => setShowReplan(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export interface FindingCardProps {
  title: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  requirementRef?: string;
  details: string;
  evidenceId?: string;
  onDecision?: (decision: 'confirm' | 'reject' | 'expected') => void;
}

export function FindingCard({ title, severity, requirementRef, details, evidenceId, onDecision }: FindingCardProps) {
  const [decided, setDecided] = useState<string | null>(null);

  return (
    <div className="card finding-card" style={{ padding: '14px 16px', margin: '8px 0', border: '1px solid #ffd8dc', borderRadius: '8px', background: '#fff9fa' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{title}</strong>
        <span style={{ fontSize: '11px', textTransform: 'uppercase', padding: '2px 6px', borderRadius: '4px', background: severity === 'critical' ? '#ff3b30' : '#ff9500', color: '#fff', fontWeight: 700 }}>
          {severity}
        </span>
      </div>
      {requirementRef && <small style={{ color: 'var(--muted)', display: 'block', margin: '3px 0' }}>Ref: {requirementRef}</small>}
      <p style={{ fontSize: '13px', margin: '6px 0 10px', color: 'var(--ink)' }}>{details}</p>
      {evidenceId && (
        <span style={{ fontSize: '11px', color: 'var(--teal)', display: 'block', marginBottom: '8px' }}>
          Evidence ID: <code>{evidenceId.slice(0, 8)}</code>
        </span>
      )}
      {onDecision && !decided && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button style={{ fontSize: '11px', padding: '4px 8px' }} onClick={() => { setDecided('confirmed'); onDecision('confirm'); }}>Confirm Defect</button>
          <button style={{ fontSize: '11px', padding: '4px 8px' }} onClick={() => { setDecided('rejected'); onDecision('reject'); }}>Reject False Positive</button>
          <button style={{ fontSize: '11px', padding: '4px 8px' }} onClick={() => { setDecided('expected'); onDecision('expected'); }}>Mark Expected</button>
        </div>
      )}
      {decided && <small style={{ color: 'var(--muted)' }}>Decision: <strong>{decided}</strong></small>}
    </div>
  );
}

export interface ActionRequestCardProps {
  projectId: string;
  taskId: string;
  requestId: string;
  kind: string;
  message: string;
  onResolved?: () => void;
}

export function ActionRequestCard({ projectId, taskId, requestId, kind, message, onResolved }: ActionRequestCardProps) {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!answer.trim()) return;
    setBusy(true);
    setError('');
    try {
      const key = 'clarify-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      await api(`/api/v1/projects/${projectId}/task-clarify`, {
        taskId,
        requestId,
        answer: answer.trim(),
        commandKey: key
      });
      onResolved?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card action-request-card" style={{ padding: '14px 16px', margin: '8px 0', border: '1px solid #fed8a6', borderRadius: '8px', background: '#fffcf5' }}>
      <strong style={{ color: '#996200', fontSize: '13px' }}>Action Required: {kind}</strong>
      <p style={{ fontSize: '13px', margin: '6px 0 10px' }}>{message}</p>
      {error && <div className="orc-error">{error}</div>}
      <div style={{ display: 'flex', gap: '6px' }}>
        <input
          style={{ flex: 1, fontSize: '13px', padding: '6px 10px', borderRadius: '6px', border: '1px solid #eed6aa' }}
          placeholder="Provide clarification or required value…"
          value={answer}
          onChange={e => setAnswer(e.target.value)}
        />
        <button className="primary" style={{ fontSize: '12px', padding: '6px 12px' }} disabled={busy || !answer.trim()} onClick={() => void submit()}>
          Submit
        </button>
      </div>
    </div>
  );
}

export interface StatusCardProps {
  taskId: string;
  title: string;
  status: string;
  activeJobsCount: number;
}

export function StatusCard({ taskId, title, status, activeJobsCount }: StatusCardProps) {
  return (
    <div className="card status-card" style={{ padding: '12px 14px', margin: '6px 0', border: '1px solid var(--line)', borderRadius: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{title}</strong>
        <span className={`ticket-status ${status.toLowerCase().replace(/\s+/g, '-')}`}>{status}</span>
      </div>
      <small style={{ color: 'var(--muted)', marginTop: '4px', display: 'block' }}>
        Task: <code>{taskId.slice(0, 8)}</code> · Active jobs: {activeJobsCount}
      </small>
    </div>
  );
}
