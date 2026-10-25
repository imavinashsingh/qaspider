import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PlanStore } from '../electron/plan-store.mjs';
import { DesktopService } from '../electron/desktop-service.mjs';
import { ExecutableDraft, groundingRequest, groundingSchema } from '../electron/executable-draft.mjs';
import { z } from 'zod';
import { ApprovedExecution, requireApproved } from '../electron/approved-execution.mjs';
import { genericProposal } from './fixtures/generic-plan.mjs';
import { approve, executionIdentity } from './fixtures/approved-plan.mjs';

function conversation(store, projectTitle = 'Project A') {
  const projectId = store.conversations.createProject({ title: projectTitle });
  return store.conversations.create({ projectId, title: 'QA conversation', context: { mode: 'selected', url: 'https://example.test/registration' } });
}
function chatPlan(store, convo) {
  const plan = store.create(genericProposal(), { executionRequired: true });
  store.conversations.linkPlan(convo.id, plan.planId, 'Review this proposal.');
  return plan;
}
function binding(saved, convo) {
  return { context: { ...convo.context, projectId: convo.projectId }, note: '', scenarios: saved.content.scenarios.map(scenario => ({
    scenarioId: scenario.id, planJson: JSON.stringify({ id: scenario.id, name: scenario.title, steps: [{ kind: 'NAVIGATE', path: '/registration' }, ...scenario.assertions.map(item => ({ kind: 'assert', assertion: JSON.parse(item.description) }))] }),
    assertionSources: scenario.assertions.map((item, index) => ({ index, description: item.description, assertionJson: item.description })),
    prerequisites: scenario.preconditions.map(description => ({ description, resolution: 'navigation', stepNumbers: [] })), blockers: [],
  })) };
}
function confirm(store, saved) {
  return store.mutate({ planId: saved.planId, revision: saved.revision, version: saved.version, action: { type: 'confirm-execution', note: 'Reviewed each command, original assertion mapping and explicit setup.' } });
}
describe('desktop consolidation persistence and approval boundary', () => {
  it('backs up a pre-consolidation database and preserves old approvals, reports and knowledge tables', () => {
    const folder = mkdtempSync(join(tmpdir(), 'qaspider-m8-backup-')), path = join(folder, 'desktop-plans.sqlite');
    let store = new PlanStore(path);
    const saved = approve(store, store.create(genericProposal()));
    store.saveExecution({ id: 'historical-report', planId: saved.planId, revision: 1, outcome: 'PASS', status: 'COMPLETED', scenarios: [], evidenceMarker: 'original-screenshot' });
    // Opaque historical rows: migration must preserve their bytes and links, not reinterpret them.
    store.db.prepare('INSERT INTO desktop_knowledge_scopes VALUES(?,?,?,?,?)').run('old-scope', 'existing-project', 'owned-qa-fixtures', 'synthetic-tester', 'existing-application');
    store.db.prepare('INSERT INTO desktop_workflows VALUES(?,?,?,?)').run('old-workflow', 'old-scope', 'existing-operation-key', 'Original knowledge');
    store.db.prepare('INSERT INTO desktop_workflow_search(workflow_id,description) VALUES(?,?)').run('old-workflow', 'Original knowledge');
    store.db.prepare('INSERT INTO desktop_knowledge_revisions VALUES(?,?,?,?,?,?,?,?)').run('old-revision', 'old-workflow', 1, 'VERIFIED', JSON.stringify([{ number: 1, kind: 'CLICK', evidenceId: 'original-evidence' }]), 'historical-report', 'S-1', '2026-10-25T00:00:00Z');
    const priorKnowledge = store.knowledge.list();
    for (const table of ['desktop_project_notes','desktop_project_profile_history','desktop_project_profiles','desktop_messages','desktop_conversation_plans','desktop_conversations','desktop_projects','desktop_settings','desktop_additive_migrations']) store.db.exec(`DROP TABLE ${table}`);
    store.close(); store = new PlanStore(path);
    try {
      expect(store.get(saved.planId)).toEqual(saved);
      expect(store.executions(saved.planId, 1)[0].evidenceMarker).toBe('original-screenshot');
      expect(store.knowledge.list()).toEqual(priorKnowledge);
      const backup = store.backupPath; expect(backup).toBeTruthy(); expect(statSync(backup).mode & 0o777).toBe(0o600);
      const snapshot = new DatabaseSync(backup, { readOnly: true });
      expect(snapshot.prepare('SELECT hash FROM desktop_plan_approvals').get().hash).toBe(saved.hash);
      expect(snapshot.prepare("SELECT name FROM sqlite_master WHERE name='desktop_conversations'").get()).toBeUndefined(); snapshot.close();
      expect(store.conversations.get('legacy').messages.some(item => item.reportId === 'historical-report')).toBe(true);
    } finally { store.close(); }
    store = new PlanStore(path); expect(store.backupPath).toBeNull(); expect(readdirSync(join(folder, 'desktop-backups'))).toHaveLength(1); store.close();
  });
  it('persists project context and messages and keeps project conversations separate after restart', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'qaspider-m8-chat-')), 'plans.sqlite');
    let store = new PlanStore(path); const a = conversation(store), b = conversation(store, 'Project B');
    store.conversations.message(a.id, 'user', 'Check the application.'); store.close(); store = new PlanStore(path);
    try { expect(store.conversations.get(a.id).messages).toHaveLength(1); expect(store.conversations.get(b.id).messages).toHaveLength(0); expect(store.conversations.list().find(item => item.id === a.projectId).conversations.map(item => item.id)).toEqual([a.id]); }
    finally { store.close(); }
  });
  it('opens an older linked report directly beyond the recent-report list limit and checks its plan identity', () => {
    const store = new PlanStore(':memory:'), saved = approve(store, store.create(genericProposal())), firstId = crypto.randomUUID();
    try {
      store.saveExecution({ id: firstId, planId: saved.planId, revision: 1, status: 'COMPLETED', outcome: 'PASS', scenarios: [] });
      for (let index = 0; index < 21; index++) store.saveExecution({ id: crypto.randomUUID(), planId: saved.planId, revision: 1, status: 'COMPLETED', outcome: 'PASS', scenarios: [] });
      expect(store.executions(saved.planId, 1).some(item => item.id === firstId)).toBe(false);
      expect(store.executionReport({ planId: saved.planId, reportId: firstId }).id).toBe(firstId);
      expect(() => store.executionReport({ planId: crypto.randomUUID(), reportId: firstId })).toThrow('not found');
    } finally { store.close(); }
  });
  it('rejects stale context writes, non-HTTP targets and forged project associations', () => {
    const store = new PlanStore(':memory:'); const a = conversation(store);
    try {
      store.conversations.setContext({ conversationId: a.id, version: 1, context: { mode: 'selected', url: 'https://other.test/' } });
      expect(() => store.conversations.setContext({ conversationId: a.id, version: 1, context: a.context })).toThrow('Context changed');
      expect(() => store.conversations.setContext({ conversationId: a.id, version: 2, context: { mode: 'selected', url: 'file:///private' } })).toThrow();
      expect(() => store.conversations.create({ projectId: crypto.randomUUID(), title: 'Forged', context: a.context })).toThrow();
    } finally { store.close(); }
  });
  it('requires reviewed executable bindings for chat approval, invalidates them on edits, and never mutates approved originals', () => {
    const store = new PlanStore(':memory:'), convo = conversation(store); let saved = chatPlan(store, convo);
    try {
      expect(saved.issues.join(' ')).toContain('Prepare executable');
      const original = structuredClone(saved.original);
      saved = store.bindExecution(saved.planId, saved.version, binding(saved, convo)); expect(saved.original).toEqual(original);
      expect(saved.issues.join(' ')).toContain('Review executable'); saved = confirm(store, saved);
      const scenario = saved.content.scenarios[0];
      saved = store.mutate({ planId: saved.planId, revision: 1, version: saved.version, action: { type: 'edit-scenario', scenarioId: scenario.id, title: 'Edited', steps: scenario.steps, assertionDescriptions: scenario.assertions.map(item => item.description) } });
      expect(saved.content.execution).toBeUndefined(); expect(saved.content.executionRequired).toBe(true);
      saved = confirm(store, store.bindExecution(saved.planId, saved.version, binding(saved, convo))); saved = approve(store, saved);
      expect(() => store.bindExecution(saved.planId, saved.version, binding(saved, convo))).toThrow('unapproved');
      expect(store.get(saved.planId).original).toEqual(original);
    } finally { store.close(); }
  });
  it('unresolved prerequisites and command blockers prevent approval', () => {
    const store = new PlanStore(':memory:'), convo = conversation(store), saved = chatPlan(store, convo), draft = binding(saved, convo);
    try { draft.scenarios[0].prerequisites[0].resolution = 'unresolved'; draft.scenarios[0].blockers.push('Unsupported file input'); const bound = store.bindExecution(saved.planId, saved.version, draft); expect(bound.issues.join(' ')).toContain('unresolved prerequisite'); expect(bound.issues.join(' ')).toContain('Unsupported file'); }
    finally { store.close(); }
  });
  it('rejects a binding that replaces a required text assertion with a weaker visible assertion', () => {
    const store = new PlanStore(':memory:'), convo = conversation(store), saved = chatPlan(store, convo), draft = binding(saved, convo);
    try {
      const weaker = { kind: 'visible', selector: '#result', expected: true };
      draft.scenarios[0].assertionSources[0].assertionJson = JSON.stringify(weaker);
      const plan = JSON.parse(draft.scenarios[0].planJson); plan.steps.at(-1).assertion = weaker; draft.scenarios[0].planJson = JSON.stringify(plan);
      expect(() => store.bindExecution(saved.planId, saved.version, draft)).toThrow('changed an original assertion');
      expect(store.get(saved.planId).hash).toBe(saved.hash);
    } finally { store.close(); }
  });
  it('context changes invalidate execution even when an old approved hash is exact', async () => {
    const store = new PlanStore(':memory:'), convo = conversation(store); let saved = chatPlan(store, convo);
    try {
      saved = approve(store, confirm(store, store.bindExecution(saved.planId, saved.version, binding(saved, convo))));
      expect(requireApproved(store, executionIdentity(saved)).hash).toBe(saved.hash);
      const service = new ApprovedExecution(store);
      await expect(service.prepare({ ...executionIdentity(saved), url: 'https://other.test/' })).rejects.toThrow('reviewed application context');
      store.conversations.setContext({ conversationId: convo.id, version: 1, context: { mode: 'selected', url: 'https://other.test/' } });
      expect(() => requireApproved(store, executionIdentity(saved))).toThrow('context changed'); expect(store.get(saved.planId).hash).toBe(saved.hash);
    } finally { store.close(); }
  });
  it('persists provider failure as conversation feedback and leaves no invented plan', async () => {
    const store = new PlanStore(':memory:'), convo = conversation(store);
    try {
      const service = new DesktopService(store, { planner: { propose: async () => ({ status: 'unavailable', message: 'Provider unavailable.' }) } });
      const result = await service.send({ conversationId: convo.id, text: 'Required field rejection.' });
      expect(result.messages.map(item => item.role)).toEqual(['user','assistant']); expect(store.list()).toHaveLength(0);
    } finally { store.close(); }
  });
  it('rejects preparation for a stale revision even when its version number matches', async () => {
    const store = new PlanStore(':memory:'), convo = conversation(store); let saved = chatPlan(store, convo);
    try {
      saved = approve(store, confirm(store, store.bindExecution(saved.planId, saved.version, binding(saved, convo))));
      saved = store.mutate({ planId: saved.planId, revision: saved.revision, version: saved.version, action: { type: 'fork' } });
      let discovery = 0;
      const service = new DesktopService(store, { draft: { prepare: async () => { discovery++; } } });
      await expect(service.prepare({ planId: saved.planId, revision: 1, version: saved.version })).rejects.toThrow('current conversation plan');
      expect(discovery).toBe(0);
    } finally { store.close(); }
  });
});

describe('read-only executable grounding', () => {
  it('uses compatible inference schema without weakening discriminated assertion validation', () => {
    const schema = groundingRequest({ original: { ticket: {} }, content: { scenarios: [] } }, [], {}).responseFormat.schema;
    expect(JSON.stringify(schema)).not.toContain('oneOf'); expect(JSON.stringify(schema)).not.toContain('"default"');
    const sample = { scenarios: [{ scenarioId: 'S-1', operations: [], assertions: [{ kind: 'text', selector: '#result', expected: 'Required', present: true }], prerequisites: [], blockers: [] }] };
    expect(groundingSchema.parse(z.fromJSONSchema(schema).parse(sample))).toEqual(sample);
    sample.scenarios[0].assertions[0].expected = true;
    expect(() => z.fromJSONSchema(schema).parse(sample)).toThrow();
    expect(() => groundingSchema.parse(sample)).toThrow();
  });
  function fake({ publicTarget = false, type = 'button', mapping, exactValue = 'Name and email are required', url } = {}) {
    const store = new PlanStore(':memory:'), convo = conversation(store);
    if (!publicTarget) convo.context = { mode: 'controlled', url: '/registration' };
    if (url) convo.context = { mode: 'selected', url };
    const proposal = genericProposal(); proposal.scenarios = [proposal.scenarios[0]]; proposal.ticket.acceptanceCriteria = [proposal.ticket.acceptanceCriteria[0]]; proposal.criteria = [proposal.criteria[0]];
    proposal.scenarios[0].assertions[0] = { kind: 'text', description: 'Required fields are rejected with the stated message.', exactValue, sourceQuote: exactValue ? 'Registration reports Name and email are required' : null };
    const saved = store.create(proposal, { executionRequired: true });
    let closed = 0, acts = 0;
    const locator = { count: async () => 1, isVisible: async () => true, isEnabled: async () => true, evaluateAll: async () => [{ selector: '#result', text: 'Ready' }], evaluate: async () => ({ tag: type === 'file' ? 'INPUT' : 'BUTTON', type, names: ['Create account'], action: type === 'submit' ? 'https://example.test/registration' : '', readOnly: false }) };
    const session = { response: { status: () => 200 }, page: {}, controlledPage: { locator: () => locator }, stagehand: { observe: async () => ({ data: [{ selector: '//button' }] }), act: async () => { acts++; } }, close: async () => { closed++; } };
    const expectation = { kind: 'text', selector: '#result', expected: 'Name and email are required' };
    const response = mapping ?? { scenarios: [{ scenarioId: 'S-1', operations: [{ kind: 'CLICK', controlId: 'control-1', value: null, expected: expectation }], assertions: [expectation], prerequisites: [{ resolution: 'navigation', stepNumbers: [] }], blockers: [] }] };
    const service = new ExecutableDraft({ provider: { prepare: async () => ({}), generate: async () => ({ structuredContent: response }) }, openSession: async () => session, startFixture: async () => ({ origin: 'http://127.0.0.1:1234', paths: ['/registration'], close: async () => {} }) });
    return { store, run: () => service.prepare(saved, convo), counts: () => ({ closed, acts }) };
  }
  it('grounds discovered controls without acting and keeps original assertion mappings', async () => {
    const fixture = fake(); try { const result = await fixture.run(); expect(result.scenarios[0].blockers).toEqual([]); expect(JSON.parse(result.scenarios[0].planJson).steps[2].target.selector).toBe('//button'); expect(fixture.counts()).toEqual({ acts: 0, closed: 1 }); } finally { fixture.store.close(); }
  });
  it('retains public submission as a blocker before final approval', async () => {
    const fixture = fake({ publicTarget: true, type: 'submit' }); try { expect((await fixture.run()).scenarios[0].blockers.join(' ')).toContain('submission'); expect(fixture.counts().acts).toBe(0); } finally { fixture.store.close(); }
  });
  it('rejects invented controls and closes discovery on invalid output', async () => {
    const fixture = fake({ mapping: { scenarios: [{ scenarioId: 'S-1', operations: [{ kind: 'CLICK', controlId: 'invented', value: null, expected: { kind: 'text', selector: '#result', expected: 'Name and email are required' } }], assertions: [{ kind: 'text', selector: '#result', expected: 'Name and email are required' }], prerequisites: [{ resolution: 'navigation', stepNumbers: [] }], blockers: [] }] } });
    try { await expect(fixture.run()).rejects.toThrow('undiscovered'); expect(fixture.counts().closed).toBe(1); } finally { fixture.store.close(); }
  });
  it('does not accept a changed exact business outcome', async () => {
    const mapping = { scenarios: [{ scenarioId: 'S-1', operations: [], assertions: [{ kind: 'text', selector: '#result', expected: 'Ready' }], prerequisites: [{ resolution: 'navigation', stepNumbers: [] }], blockers: [] }] };
    const fixture = fake({ mapping }); try { const result = await fixture.run(); expect(result.scenarios[0].blockers.join(' ')).toContain('conflicts'); expect(result.scenarios[0].blockers.join(' ')).toContain('missing from the stated'); } finally { fixture.store.close(); }
  });
  it('does not silently discard selected URL query or fragment state', async () => {
    for (const url of ['https://example.test/registration?mode=test', 'https://example.test/#registration']) {
      const fixture = fake({ url });
      try { await expect(fixture.run()).rejects.toThrow('do not drop URL state'); expect(fixture.counts()).toEqual({ acts: 0, closed: 0 }); } finally { fixture.store.close(); }
    }
  });
});
