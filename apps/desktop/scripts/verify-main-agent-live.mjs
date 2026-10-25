import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';
import { seedMainAgentData } from '../tests/fixtures/main-agent-data.mjs';

// Explicit live demonstration: real existing signed-in CLI; project data are owned synthetic examples.
const root = fileURLToPath(new URL('../../..', import.meta.url));
const data = join(root, '.qaspider/main-agent-live', randomUUID());
const folder = join(root, 'test-results/desktop-live/main-agent-real');
mkdirSync(data, { recursive: true, mode: 0o700 }); mkdirSync(folder, { recursive: true });
const seeded = await seedMainAgentData(join(data, 'desktop-plans.sqlite'));
const env = { ...process.env, QASPIDER_DESKTOP_LEGACY_UI: '0', QASPIDER_DESKTOP_PROVIDER: 'codex', QASPIDER_DESKTOP_HEADLESS: '1', QASPIDER_DESKTOP_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE; delete env.QASPIDER_DESKTOP_TEST_ENDPOINT;
let app = await electron.launch({ args: [join(root, 'apps/desktop')], env });
const started = performance.now();
try {
  let page = await app.firstWindow();
  const open = async scope => {
    await page.getByLabel('Project', { exact: true }).selectOption(scope.projectId);
    await page.getByRole('button', { name: 'Main Agent', exact: true }).click();
    await expect(page.getByTestId('main-agent-chat')).toBeVisible();
    await expect(page.getByLabel('Message Main Agent')).toBeEnabled({ timeout: 150000 });
  };
  const history = async scope => (await page.evaluate(value => window.qaspider.agentHistory(value), scope)).value;
  const send = async (scope, text) => {
    const count = (await history(scope)).turns.length;
    await page.getByLabel('Message Main Agent').fill(text);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect.poll(async () => (await history(scope)).turns.length, { timeout: 150000 }).toBe(count + 1);
    // Read actual IPC status while inference is pending; no long synchronous model call owns IPC.
    const statusStart = performance.now();
    const status = await page.evaluate(value => window.qaspider.agentStatus(value), scope);
    const statusReadMs = performance.now() - statusStart;
    assert.equal(status.status, 'ok'); assert(statusReadMs < 2000, 'Agent status was not responsive.');
    await expect.poll(async () => (await history(scope)).turns.at(-1).status, { timeout: 150000, intervals: [300, 600, 1000] }).not.toBe('RUNNING');
    const turn = (await history(scope)).turns.at(-1);
    assert.equal(turn.status, 'COMPLETED', turn.reply); assert(turn.metrics.provider?.synthetic === false, 'Live run must not use synthetic inference.');
    await expect(page.getByTestId('agent-turn').last()).toContainText(turn.reply, { timeout: 10000 });
    console.log(JSON.stringify({ checkpoint: 'live-reply', modelCalls: turn.metrics.modelCalls, totalTokens: turn.metrics.totalTokens, durationMs: turn.metrics.durationMs }));
    return { ...turn, statusReadMs };
  };
  await open(seeded.projectA);
  const a = await send(seeded.projectA, 'Briefly summarize this project, its saved project code, and its known user roles. Cite the saved project context.');
  assert(a.reply.includes('AMBER-482')); assert(!a.reply.includes('COBALT-713')); assert(a.sources.some(source => source.kind === 'project'));
  await open(seeded.projectB);
  const b = await send(seeded.projectB, 'What project am I working on, what is its saved project code, and are clinician roles recorded for this project? Use only this project context.');
  assert(b.reply.includes('COBALT-713')); assert(!b.reply.includes('AMBER-482')); assert(!b.sources.some(source => source.id === `project:${seeded.projectA.projectId}`));
  await page.screenshot({ path: join(folder, 'live-project-b-isolation.png') });
  await open(seeded.projectA);
  const qa = await send(seeded.projectA, 'List this project\'s saved QA plans and their actual latest report IDs and verdicts. Read the saved records; do not run anything.');
  assert(qa.sources.some(source => source.id === `report:${seeded.reportId}` || source.id === `plan:${seeded.planId}`));
  const report = await send(seeded.projectA, `Read saved report ${seeded.reportId} for plan ${seeded.planId}, and search operational knowledge for registration. Explain measured results and cite the actual report and workflow sources. Do not execute any test.`);
  assert(report.sources.some(source => source.id === `report:${seeded.reportId}`));
  assert(report.sources.some(source => source.id === `workflow:${seeded.workflowRevisionId}`));
  await page.getByTestId('agent-turn').last().locator('summary').click();
  await page.getByTestId('agent-turn').last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(folder, 'live-stored-report-and-knowledge.png') });
  const before = await history(seeded.projectA);
  await app.close(); app = await electron.launch({ args: [join(root, 'apps/desktop')], env }); page = await app.firstWindow();
  await open(seeded.projectA);
  const after = await history(seeded.projectA);
  assert.equal(after.threadId, before.threadId); assert.deepEqual(after.turns, before.turns);
  const resumed = await send(seeded.projectA, 'What is this project\'s saved code after restart? Cite the saved project context.');
  assert(resumed.reply.includes('AMBER-482'));
  await page.getByTestId('agent-turn').last().scrollIntoViewIfNeeded(); await page.screenshot({ path: join(folder, 'live-after-restart.png') });
  const wrongScope = await page.evaluate(scope => window.qaspider.agentHistory(scope), { projectId: seeded.projectB.projectId, conversationId: seeded.projectA.conversationId }); assert.equal(wrongScope.status, 'error');
  const approved = await page.evaluate(planId => window.qaspider.getPlan({ planId }), seeded.planId); assert.equal(approved.value.hash, seeded.approvalHash);
  const summarize = turn => ({ id: turn.id, status: turn.status, reply: turn.reply, sources: turn.sources, metrics: turn.metrics });
  writeFileSync(join(folder, 'receipt.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), liveInference: true, mode: 'Real signed-in Codex CLI + LangGraph + Electron + SQLite; owned synthetic project data. Browser report produced by existing runner from explicit fixture-reviewed expectations, not AI planning or agent execution.', seeded,
    durationMs: performance.now() - started, projectA: summarize(a), projectB: summarize(b), qa: summarize(qa), report: summarize(report), resumed: summarize(resumed),
    threadId: before.threadId, historyPreservedExactly: true, crossProjectRequestRejected: true, originalApprovalUnchanged: true,
    screenshots: ['live-project-b-isolation.png','live-stored-report-and-knowledge.png','live-after-restart.png'] }, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'passed', liveInference: true, receipt: 'test-results/desktop-live/main-agent-real/receipt.json' }));
} finally { await app.close(); }
