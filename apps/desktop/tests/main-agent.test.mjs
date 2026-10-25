import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Annotation, StateGraph, START, END, interrupt, Command } from '@langchain/langgraph';
import { PlanStore } from '../electron/plan-store.mjs';
import { ProjectMainAgent } from '../electron/main-agent.mjs';
import { AgentReadTools, safeAgentText } from '../electron/agent-context.mjs';
import { openAgentCheckpoints } from '../electron/agent-checkpoints.mjs';
import { genericProposal } from './fixtures/generic-plan.mjs';
import { approve } from './fixtures/approved-plan.mjs';

const uuid = () => crypto.randomUUID();
function project(store, title) {
  const projectId = store.conversations.createProject({ title, description: `${title} software description` });
  const conversation = store.conversations.create({ projectId, title: 'Main chat', context: { mode: 'controlled', url: '/registration' } });
  return { projectId, conversationId: conversation.id };
}
function provider(respond) {
  return { prepare: async () => ({ provider: 'synthetic-unit', synthetic: true }), generate: async (request, signal) => ({ structuredContent: await respond(JSON.parse(request.messages[0].content[0].text), request, signal), usage: { totalTokens: 7 } }) };
}
function decision(reply, sourceIds = [], calls = []) { return { reply, sourceIds, calls }; }
async function send(agent, scope, text = 'Describe this project.', requestId = uuid()) {
  agent.send({ ...scope, text, requestId }); await agent.running; return agent.history(scope).turns.at(-1);
}

describe('official LangGraph SQLite saver with built-in SQLite driver', () => {
  it('persists interrupt/resume, pending writes and thread isolation across close/reopen', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'qaspider-agent-checkpoints-')), path = join(folder, 'checkpoints.sqlite');
    const state = Annotation.Root({ count: Annotation({ reducer: (a, b) => a + b, default: () => 0 }) });
    const graph = saver => new StateGraph(state).addNode('human', () => { interrupt('Continue?'); return { count: 1 }; }).addEdge(START, 'human').addEdge('human', END).compile({ checkpointer: saver });
    let saver = openAgentCheckpoints(path);
    try {
      const config = { configurable: { thread_id: 'a' } };
      const waiting = await graph(saver).invoke({}, config);
      expect(waiting.__interrupt__).toHaveLength(1);
      const tuple = await saver.getTuple(config); expect(tuple.pendingWrites.length).toBeGreaterThan(0);
      saver.db.close(); saver = openAgentCheckpoints(path);
      const resumed = await graph(saver).invoke(new Command({ resume: true }), config);
      expect(resumed.count).toBe(1); expect(await saver.getTuple({ configurable: { thread_id: 'b' } })).toBeUndefined();
      const history = []; for await (const item of saver.list(config, { limit: 20 })) history.push(item);
      expect(history.length).toBeGreaterThan(1); expect(history[0].checkpoint.channel_values.count).toBe(1);
      expect(statSync(path).mode & 0o777).toBe(0o600);
      await saver.deleteThread('a'); expect(await saver.getTuple(config)).toBeUndefined();
    } finally { saver.db.close(); rmSync(folder, { recursive: true, force: true }); }
  });
});

describe('read-only project Main Agent', () => {
  it('fails closed before inference when ambient external tracing is enabled', async () => {
    const before = process.env.LANGSMITH_TRACING; process.env.LANGSMITH_TRACING = 'true';
    const store = new PlanStore(':memory:'), scope = project(store, 'Local project');
    let checked = false;
    const fake = provider(input => { checked = true; return decision('Local reply.', input.project.sources.map(item => item.id)); });
    const agent = new ProjectMainAgent(store, { provider: () => fake });
    try { const turn = await send(agent, scope); expect(turn.status).toBe('UNAVAILABLE'); expect(turn.reply).toContain('external LangChain/LangSmith tracing'); expect(checked).toBe(false); }
    finally { await agent.close(); store.close(); if (before === undefined) delete process.env.LANGSMITH_TRACING; else process.env.LANGSMITH_TRACING = before; }
  });
  it('retrieves relevant project context, bounds history and persists only references in graph checkpoints', async () => {
    const store = new PlanStore(':memory:'), scope = project(store, 'Clinic A');
    store.conversations.profiles.mutate({ projectId: scope.projectId, version: 1, action: { type: 'note', topic: 'roles', text: 'Receptionists arrange visits. password: PRIVATE_CANARY' } });
    const prompts = [];
    const fake = provider((input, request) => {
      prompts.push(JSON.stringify(input)); expect(request.tools).toEqual([]);
      return decision('Clinic A supports visit scheduling, with receptionists according to your context.', input.project.sources.map(item => item.id));
    });
    const agent = new ProjectMainAgent(store, { provider: () => fake });
    try {
      for (let index = 0; index < 8; index++) expect((await send(agent, scope)).status).toBe('COMPLETED');
      expect(prompts.at(-1)).toContain('Receptionists arrange visits'); expect(prompts.join()).not.toContain('PRIVATE_CANARY');
      expect(JSON.parse(prompts.at(-1)).recentConversation).toHaveLength(6);
      const thread = agent.history(scope).threadId;
      const checkpoint = await agent.checkpoints.getTuple({ configurable: { thread_id: thread } });
      expect(Object.keys(checkpoint.checkpoint.channel_values)).toEqual(expect.arrayContaining(['turnId','phase']));
      expect(JSON.stringify(checkpoint)).not.toContain('Receptionists');
      expect(agent.history(scope).turns.at(-1).metrics).toMatchObject({ modelCalls: 1, totalTokens: 7 });
    } finally { await agent.close(); store.close(); }
  });

  it('validates conversation ownership and never retrieves another project context or report', async () => {
    const store = new PlanStore(':memory:'), a = project(store, 'A'), b = project(store, 'PRIVATE_B_CANARY');
    const saved = store.create(genericProposal()); store.conversations.linkPlan(b.conversationId, saved.planId, 'B plan');
    const reportId = uuid(); store.saveExecution({ id: reportId, planId: saved.planId, revision: 1, status: 'COMPLETED', outcome: 'PASS', scenarios: [] });
    const agent = new ProjectMainAgent(store, { provider: () => provider(input => decision(input.project.data, input.project.sources.map(item => item.id))) });
    try {
      expect(() => agent.start({ projectId: a.projectId, conversationId: b.conversationId })).toThrow('does not belong');
      expect(() => agent.status({ projectId: a.projectId, conversationId: b.conversationId })).toThrow('does not belong');
      expect(agent.tools.dispatch(a.projectId, a.conversationId, { kind: 'read_report', planId: saved.planId, reportId, query: null }).data).not.toContain('PASS');
      expect((await send(agent, a)).reply).not.toContain('PRIVATE_B_CANARY');
      expect(JSON.parse(agent.tools.listQA(a.projectId).data).qaPlans).toEqual([]);
    } finally { await agent.close(); store.close(); }
  });

  it('dispatches real stored QA/report/FTS data read-only and rejects forged source IDs', async () => {
    const store = new PlanStore(':memory:'), a = project(store, 'A'), b = project(store, 'B');
    const saved = approve(store, store.create(genericProposal())); store.conversations.linkPlan(a.conversationId, saved.planId, 'Original approved plan');
    const reportId = uuid(); store.saveExecution({ id: reportId, planId: saved.planId, revision: 1, status: 'COMPLETED', outcome: 'FAIL', scenarios: [{ scenarioId: 'S-1', outcome: 'FAIL', status: 'COMPLETED', result: { assertionsExecuted: 1, evidence: [{ id: 'evidence-ref' }] } }] });
    // Explicit synthetic repository rows; no claim these rows came from browser execution.
    for (const [scope, description] of [[a, 'registration workflow'], [b, 'PRIVATE_B_CANARY workflow']]) {
      const scopeId = uuid(), workflowId = uuid();
      store.db.prepare('INSERT INTO desktop_knowledge_scopes VALUES(?,?,?,?,?)').run(scopeId, scope.projectId, 'owned-qa-fixtures', 'tester', 'app');
      store.db.prepare('INSERT INTO desktop_workflows VALUES(?,?,?,?)').run(workflowId, scopeId, uuid(), description);
      store.db.prepare('INSERT INTO desktop_workflow_search VALUES(?,?)').run(workflowId, description);
      store.db.prepare('INSERT INTO desktop_knowledge_revisions VALUES(?,?,?,?,?,?,?,?)').run(uuid(), workflowId, 1, 'VERIFIED', '[]', reportId, 'S-1', new Date().toISOString());
    }
    let observed;
    const calls = [{ kind: 'list_qa', planId: null, reportId: null, query: null }, { kind: 'read_report', planId: saved.planId, reportId, query: null }, { kind: 'search_knowledge', planId: null, reportId: null, query: 'registration' }];
    const fake = provider(input => {
      if (!input.toolResults) return decision('Read records first.', [], calls);
      observed = input.toolResults; return { reply: 'The saved report failed one executed assertion. A registration workflow is stored.', sourceIds: [`report:${reportId}`, input.toolResults[2].result.sources[0].id] };
    });
    const agent = new ProjectMainAgent(store, { provider: () => fake });
    try {
      const before = store.get(saved.planId), result = await send(agent, a, 'Inspect QA reports and known registration workflows.');
      expect(result.status).toBe('COMPLETED'); expect(result.metrics.modelCalls).toBe(2);
      expect(JSON.parse(observed[1].result.data)).toMatchObject({ outcome: 'FAIL', scenarios: [{ assertionsExecuted: 1, evidenceCount: 1 }] });
      expect(JSON.stringify(observed)).not.toContain('PRIVATE_B_CANARY'); expect(store.get(saved.planId)).toEqual(before);
      fake.generate = provider(() => decision('Invented report.', [`report:${uuid()}`])).generate;
      expect((await send(agent, a)).status).toBe('ERROR');
    } finally { await agent.close(); store.close(); }
  });

  it('fails closed on unsupported tools, scope injection and missing provider, without false success', async () => {
    const store = new PlanStore(':memory:'), scope = project(store, 'A');
    const tools = new AgentReadTools(store);
    expect(() => tools.dispatch(scope.projectId, scope.conversationId, { kind: 'execute_browser', planId: null, reportId: null, query: null })).toThrow();
    expect(() => tools.dispatch(scope.projectId, scope.conversationId, { kind: 'list_qa', planId: null, reportId: null, query: null, projectId: uuid() })).toThrow();
    const agent = new ProjectMainAgent(store);
    try {
      const result = await send(agent, scope); expect(result.status).toBe('UNAVAILABLE'); expect(result.reply).toContain('no compatible provider');
      expect(result.metrics.modelCalls).toBe(0);
      const count = agent.history(scope).turns.length;
      expect(() => agent.send({ ...scope, requestId: uuid(), text: 'password: LEAK_CANARY' })).toThrow('credentials');
      expect(agent.history(scope).turns).toHaveLength(count);
    } finally { await agent.close(); store.close(); }
  });

  it('keeps status readable during inference, deduplicates requests, bounds concurrent sends and interrupts cleanly', async () => {
    const store = new PlanStore(':memory:'), scope = project(store, 'A');
    let entered; const ready = new Promise(resolve => { entered = resolve; });
    const fake = provider((input, request, signal) => new Promise((resolve, reject) => { entered(); signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }); }));
    const agent = new ProjectMainAgent(store, { provider: () => fake });
    const request = { ...scope, text: 'Pending', requestId: uuid() };
    agent.send(request); await ready;
    expect(agent.status(scope)).toMatchObject({ busy: true, phase: 'thinking' });
    expect(agent.send(request).turns).toHaveLength(1);
    expect(() => agent.send({ ...request, requestId: uuid() })).toThrow('replying');
    await agent.close();
    expect(agent.history(scope).turns[0].status).toBe('INTERRUPTED'); store.close();
  });

  it('restores history/thread identities and reconciles incomplete turns after restart without inference', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'qaspider-agent-restart-')), path = join(folder, 'plans.sqlite');
    let store = new PlanStore(path), scope = project(store, 'A');
    let agent = new ProjectMainAgent(store, { provider: () => provider(input => decision('Saved answer.', input.project.sources.map(item => item.id))) });
    try {
      await send(agent, scope); const threadId = agent.history(scope).threadId;
      agent.store.begin({ ...scope, requestId: uuid(), text: 'Simulate a crash before response.' });
      await agent.close(); store.close(); store = new PlanStore(path); agent = new ProjectMainAgent(store);
      const history = agent.history(scope);
      expect(history.threadId).toBe(threadId); expect(history.turns.map(turn => turn.status)).toEqual(['COMPLETED','INTERRUPTED']);
      expect(history.turns[0].reply).toBe('Saved answer.'); expect(agent.busy).toBe(false);
      expect(agent.store.backupPath).toBeUndefined();
    } finally { await agent.close(); store.close(); rmSync(folder, { recursive: true, force: true }); }
  });

  it('redacts retrieved credential shapes and URL credentials/state before inference', () => {
    const safe = safeAgentText('password: CANARY api_key=sk-abcdefghijklmno Bearer ACCESS_CANARY https://user:URL_CANARY@example.test/path?token=QUERY_CANARY#FRAGMENT_CANARY');
    for (const secret of ['CANARY','abcdefghijklmno']) expect(safe).not.toContain(secret);
    expect(safe).toContain('https://example.test/path');
  });
});
