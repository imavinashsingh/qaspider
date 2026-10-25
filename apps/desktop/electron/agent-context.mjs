import { z } from 'zod';

/** Bounded plain text, never a credential transport. Projections below exclude raw inputs/evidence. */
export function safeAgentText(value, limit = 4000) {
  return String(value ?? '')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[redacted private key]')
    .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[a-zA-Z0-9_-]{12,}/g, '[redacted key]')
    .replace(/\b(password|passwd|passphrase|secret|api[ _-]?key|access[ _-]?token|authorization|cookie|session[ _-]?token)\b\s*(?:is|=|:)\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1: [redacted]')
    .replace(/https?:\/\/[^\s<>"']+/gi, text => {
      try { const url = new URL(text); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href; }
      catch { return '[invalid URL]'; }
    }).slice(0, limit);
}

export const agentToolCall = z.object({
  kind: z.enum(['list_qa', 'read_report', 'search_knowledge']),
  planId: z.string().uuid().nullable(), reportId: z.string().uuid().nullable(), query: z.string().max(500).nullable(),
}).strict().superRefine((value, context) => {
  const valid = value.kind === 'read_report' ? value.planId && value.reportId && value.query === null
    : value.kind === 'search_knowledge' ? value.planId === null && value.reportId === null && value.query !== null
    : value.planId === null && value.reportId === null && value.query === null;
  if (!valid) context.addIssue({ code: 'custom', message: 'Invalid read-only tool arguments.' });
});
const source = z.object({ id: z.string().max(200), kind: z.enum(['project', 'note', 'plan', 'report', 'workflow']), label: z.string().max(300) }).strict();
export const toolResult = z.object({ sources: z.array(source).max(30), data: z.string().max(14000) }).strict();
const terms = query => [...new Set((query.match(/[a-zA-Z0-9_-]+/g) ?? []).slice(0, 15))].map(word => `"${word}"`).join(' OR ');

/** All scope comes from a validated conversation. Model output cannot select another project. */
export class AgentReadTools {
  constructor(store) { this.store = store; this.db = store.db; }
  scope(projectId, conversationId) {
    z.string().uuid().parse(projectId); z.string().uuid().parse(conversationId);
    const conversation = this.store.conversations.get(conversationId);
    if (conversation.projectId !== projectId) throw new Error('Conversation does not belong to this project.');
    return { conversation, profile: this.store.conversations.profiles.get(projectId) };
  }
  context(projectId, conversationId) {
    const { profile, conversation } = this.scope(projectId, conversationId);
    const sources = [{ id: `project:${profile.id}`, kind: 'project', label: `Project: ${safeAgentText(profile.title, 200)} (profile revision ${profile.version})` }];
    const notes = profile.notes.slice(-10).map(note => {
      sources.push({ id: `note:${note.id}`, kind: 'note', label: `User context: ${note.topic}` });
      return { sourceId: `note:${note.id}`, topic: note.topic, text: safeAgentText(note.body, 500), authority: 'USER_STATEMENT' };
    });
    return toolResult.parse({ sources, data: JSON.stringify({ project: { sourceId: `project:${profile.id}`, title: safeAgentText(profile.title, 200), description: safeAgentText(profile.description, 1500), authority: 'USER_STATEMENT', nextQuestion: profile.nextQuestion }, application: safeAgentText(conversation.context.url, 1000), notes }) });
  }
  dispatch(projectId, conversationId, input) {
    this.scope(projectId, conversationId);
    const call = agentToolCall.parse(input);
    if (call.kind === 'list_qa') return this.listQA(projectId);
    if (call.kind === 'read_report') return this.report(projectId, call.planId, call.reportId);
    return this.knowledge(projectId, safeAgentText(call.query, 500));
  }
  listQA(projectId) {
    const rows = this.db.prepare(`SELECT p.id,p.original_json,c.conversation_id FROM desktop_plans p
      JOIN desktop_conversation_plans c ON c.plan_id=p.id JOIN desktop_conversations d ON d.id=c.conversation_id
      WHERE d.project_id=? ORDER BY p.rowid DESC LIMIT 10`).all(projectId);
    const sources = [], data = rows.map(row => {
      const plan = this.store.get(row.id), title = safeAgentText(JSON.parse(row.original_json).ticket.title, 180);
      sources.push({ id: `plan:${row.id}`, kind: 'plan', label: `QA plan: ${title}` });
      const reports = this.db.prepare("SELECT id,json_extract(report_json,'$.outcome') AS outcome,json_extract(report_json,'$.status') AS status FROM desktop_plan_executions WHERE plan_id=? ORDER BY rowid DESC LIMIT 2").all(row.id).map(item => {
        const report = item;
        sources.push({ id: `report:${item.id}`, kind: 'report', label: `Report: ${title} — ${safeAgentText(report.outcome, 30)}` });
        return { reportId: item.id, outcome: report.outcome, status: report.status };
      });
      return { planId: row.id, title, revision: plan.revision, reviewStatus: plan.status, scenarioCount: plan.content.scenarios.length, reports };
    });
    // Keep references/results independently bounded even for 10 plans with multiple reports.
    return toolResult.parse({ sources, data: JSON.stringify({ qaPlans: data, note: 'These are existing QA plans and execution reports. Testing Agents and a task queue are not implemented.' }) });
  }
  report(projectId, planId, reportId) {
    const row = this.db.prepare(`SELECT json_extract(e.report_json,'$.revision') AS revision,
      json_extract(e.report_json,'$.status') AS status,json_extract(e.report_json,'$.outcome') AS outcome,
      json_extract(e.report_json,'$.startedAt') AS startedAt,json_extract(e.report_json,'$.completedAt') AS completedAt,
      (SELECT json_group_array(json_object('id',json_extract(value,'$.scenarioId'),'status',json_extract(value,'$.status'),
        'outcome',json_extract(value,'$.outcome'),'assertionsExecuted',coalesce(json_extract(value,'$.result.assertionsExecuted'),0),
        'evidenceCount',coalesce(json_array_length(value,'$.result.evidence'),0)))
        FROM (SELECT value FROM json_each(e.report_json,'$.scenarios') LIMIT 20)) AS scenarios_json
      FROM desktop_plan_executions e
      JOIN desktop_conversation_plans p ON p.plan_id=e.plan_id JOIN desktop_conversations c ON c.id=p.conversation_id
      WHERE c.project_id=? AND e.plan_id=? AND e.id=?`).get(projectId, planId, reportId);
    if (!row) return toolResult.parse({ sources: [], data: JSON.stringify({ unavailable: 'No report with these references is available in this project.' }) });
    const report = row;
    const data = { planId, reportId, revision: report.revision, status: report.status, outcome: report.outcome,
      startedAt: report.startedAt, completedAt: report.completedAt,
      scenarios: JSON.parse(row.scenarios_json),
      note: 'Counts and verdicts are saved runner data. Raw input values, screenshots and page text are excluded.' };
    return toolResult.parse({ sources: [{ id: `report:${reportId}`, kind: 'report', label: `Saved QA report: ${safeAgentText(report.outcome, 30)}` }], data: JSON.stringify(data) });
  }
  knowledge(projectId, query) {
    const search = terms(query);
    const rows = this.db.prepare(`SELECT w.id,w.description,s.environment,s.role,s.application,r.id AS revision_id,r.number,r.status,r.execution_id,r.scenario_id,
      EXISTS(SELECT 1 FROM desktop_knowledge_findings f WHERE f.revision_id=r.id) AS disputed
      FROM desktop_workflows w JOIN desktop_knowledge_scopes s ON s.id=w.scope_id
      JOIN desktop_knowledge_revisions r ON r.workflow_id=w.id
      ${search ? 'JOIN desktop_workflow_search fts ON fts.workflow_id=w.id' : ''}
      WHERE s.project=? ${search ? 'AND desktop_workflow_search MATCH ?' : ''}
      AND r.number=(SELECT MAX(number) FROM desktop_knowledge_revisions WHERE workflow_id=w.id)
      ORDER BY w.rowid DESC LIMIT 8`).all(...(search ? [projectId, search] : [projectId]));
    return toolResult.parse({ sources: rows.map(row => ({ id: `workflow:${row.revision_id}`, kind: 'workflow', label: `${safeAgentText(row.description, 160)} — ${row.status}${row.disputed ? ' (divergence recorded)' : ''}` })),
      data: JSON.stringify({ workflows: rows.map(({ description, ...row }) => ({ ...row, description: safeAgentText(description, 300) })), note: 'Scoped operational observations only; not business requirements or execution authorization. Environment and role must still match before any future reuse.' }) });
  }
}
