import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';

// Explicit opt-in: real configured Codex CLI, only the existing owned synthetic application.
const root = fileURLToPath(new URL('../../..', import.meta.url));
const data = join(root, '.qaspider/desktop-consolidation-live', randomUUID());
const folder = join(root, 'test-results/desktop-live/consolidation-real');
mkdirSync(data, { recursive: true }); mkdirSync(folder, { recursive: true });
const env = { ...process.env, QASPIDER_DESKTOP_LEGACY_UI: '0', QASPIDER_DESKTOP_PROVIDER: 'codex', QASPIDER_DESKTOP_HEADLESS: '1', QASPIDER_DESKTOP_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE; delete env.QASPIDER_DESKTOP_TEST_ENDPOINT;
const task = 'On /registration, leave the Your name and Email address inputs empty and keep Account type at its initial default. Click Create account and verify the exact visible status text "Name and email are required" (no trailing period). Scope is this required-fields message check only; successful registration and other data combinations are out of scope.';
let app = await electron.launch({ args: [join(root, 'apps/desktop')], env, timeout: 30_000 });
const started = performance.now();
try {
  let page = await app.firstWindow();
  await page.getByLabel('New project name').fill('Live desktop consolidation'); await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await page.getByLabel('Application', { exact: true }).selectOption('controlled'); await page.getByRole('button', { name: 'Save application context', exact: true }).click();
  await expect(page.getByText('Current: /registration.', { exact: false })).toBeVisible();
  await page.getByLabel('QA request and expected results').fill(task); await page.getByRole('button', { name: 'Prepare test plan', exact: true }).click();
  await expect(page.getByTestId('revision-status')).toContainText('DRAFT', { timeout: 150_000 });
  const projects = (await page.evaluate(() => window.qaspider.projects())).value;
  const project = projects.find(item => item.title === 'Live desktop consolidation'), conversationId = project.conversations[0].id;
  const conversation = (await page.evaluate(id => window.qaspider.conversation(id), conversationId)).value;
  const planId = conversation.messages.find(item => item.planId).planId;
  const getPlan = async () => (await page.evaluate(id => window.qaspider.getPlan({ planId: id }), planId)).value;
  let plan = await getPlan(); console.log(JSON.stringify({ checkpoint: 'conceptual-plan', scenarios: plan.content.scenarios.length }));
  writeFileSync(join(data, 'original-plan.json'), JSON.stringify(plan, null, 2), { mode: 0o600 });
  // Review only setup facts established by the owned application's source and initial page.
  for (const assumption of plan.original.assumptions) {
    assert(!/password|credentials|account exists|logged.in|authenticated|backend storage|persistence/i.test(assumption.description), 'Unverified setup assumption needs review.');
    await page.getByLabel(`Decision for ${assumption.id}`, { exact: true }).selectOption('confirmed');
    await page.getByLabel(`Review note for ${assumption.id}`, { exact: true }).fill('Reviewed against the existing owned registration application: a fresh page has empty fields, a Create account button, and the explicitly requested required-fields status behavior. This confirms setup only, not a passing test.');
    await page.getByRole('button', { name: `Save decision for ${assumption.id}`, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Prepare executable draft', exact: true }).click(); console.log(JSON.stringify({ checkpoint: 'discovery-requested' }));
  await expect(page.getByRole('heading', { name: 'Executable bindings and prerequisites' })).toBeVisible({ timeout: 150_000 });
  plan = await getPlan(); writeFileSync(join(data, 'prepared-plan.json'), JSON.stringify(plan, null, 2), { mode: 0o600 });
  assert(plan.content.execution.scenarios.every(item => !item.blockers.length && item.prerequisites.every(condition => condition.resolution !== 'unresolved')), 'Grounding has unresolved blockers; do not bypass them.');
  for (const binding of plan.content.execution.scenarios) {
    const operations = JSON.parse(binding.planJson).steps;
    assert(operations.filter(item => item.kind === 'CLICK').length === 1 && !operations.some(item => ['FILL','SELECT'].includes(item.kind)), 'Only the requested empty-form interaction is permitted.');
    assert(operations.some(item => item.kind === 'assert' && item.assertion.kind === 'text' && item.assertion.expected === 'Name and email are required'), 'Original message expectation must remain exact.');
  }
  await page.getByLabel('Executable binding review note').fill('Reviewed the actual discovered Create account control, initial empty fields, explicit single click, and exact required-fields status assertion. The original task and expected message are unchanged.');
  await page.getByRole('button', { name: 'Confirm executable bindings and setup', exact: true }).click();
  await page.getByRole('button', { name: 'Start review', exact: true }).click();
  for (const criterion of plan.original.ticket.acceptanceCriteria) {
    await page.getByLabel(`Coverage review note for ${criterion.id}`, { exact: true }).fill('The explicit click and exact message assertion cover the original empty-form acceptance criterion. Execution is still pending.');
    await page.getByRole('button', { name: `Confirm planned coverage for ${criterion.id}`, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Approve Plan', exact: true }).click();
  await expect(page.getByTestId('revision-status')).toContainText('APPROVED');
  const approved = await getPlan();
  await page.getByTestId('revision-status').scrollIntoViewIfNeeded(); await page.screenshot({ path: join(folder, 'live-reviewed-plan.png') });
  async function execute() {
    await page.getByRole('button', { name: 'Prepare approved execution', exact: true }).click();
    await page.getByTestId('approved-execution').getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Execute Approved Plan', exact: true }).click();
    await expect(page.getByTestId('approved-execution').getByRole('status')).toContainText('Execution completed: PASS', { timeout: 120_000 });
    const reports = (await page.evaluate(id => window.qaspider.planReports({ planId: id, revision: 1 }), planId)).value;
    assert.equal(reports[0].outcome, 'PASS'); return reports[0];
  }
  const first = await execute();
  await expect(page.getByTestId('ticket-execution-report').last()).toContainText('Ticket report: PASS · COMPLETED');
  await page.getByTestId('ticket-execution-report').last().getByRole('heading', { name: /Ticket report:/ }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(folder, 'live-first-report.png') });
  const firstEvidence = first.scenarios[0].result.evidence.at(-1);
  writeFileSync(join(folder, 'live-browser-evidence.png'), Buffer.from(firstEvidence.screenshot.split(',')[1], 'base64'));
  await app.close(); app = await electron.launch({ args: [join(root, 'apps/desktop')], env, timeout: 30_000 }); page = await app.firstWindow();
  await expect(page.getByTestId('ticket-execution-report').last()).toContainText('Ticket report: PASS · COMPLETED');
  assert.equal((await getPlan()).hash, approved.hash);
  const second = await execute(); assert(second.scenarios.every(item => item.result.knowledge.metrics.reusedSteps === 1), 'Expected verified click reuse after restart.');
  await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
  await expect(page.getByTestId('knowledge')).toContainText('VERIFIED'); await page.screenshot({ path: join(folder, 'live-knowledge.png') });
  const summarize = report => ({ id: report.id, hash: report.hash, outcome: report.outcome, origin: report.origin, scope: report.knowledgeScope, startedAt: report.startedAt, completedAt: report.completedAt, scenarios: report.scenarios.map(item => ({ id: item.scenarioId, outcome: item.outcome, metrics: item.result.knowledge.metrics, assertions: item.result.assertionsExecuted, evidenceIds: item.result.evidence.map(evidence => evidence.id) })) });
  const receipt = { verifiedAt: new Date().toISOString(), liveInference: true, provider: 'codex-cli', controlledApplicationOnly: true, publicLoginExecuted: false, task, projectId: project.id, conversationId, planId, durationMs: performance.now() - started, first: summarize(first), reusedAfterRestart: summarize(second), originalPlanUnchanged: JSON.stringify(approved.original) === JSON.stringify(plan.original), screenshotFiles: ['live-reviewed-plan.png','live-first-report.png','live-browser-evidence.png','live-knowledge.png'] };
  writeFileSync(join(folder, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'passed', liveInference: true, publicLoginExecuted: false, scenarios: first.scenarios.length, receipt: 'test-results/desktop-live/consolidation-real/receipt.json' }));
} catch (error) {
  console.error(error.message);
  try { await (await app.firstWindow()).screenshot({ path: join(folder, 'live-incomplete.png') }); } catch {}
  throw error;
} finally { await app.close(); }
