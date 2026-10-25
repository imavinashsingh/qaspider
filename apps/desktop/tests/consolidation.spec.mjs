import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendSyntheticResponse } from '../electron/codex-provider.mjs';
import { startControlledFixture } from '../electron/controlled-fixture.mjs';
import { runGenericScenario } from '../electron/generic-execution.mjs';
import { PlanStore } from '../electron/plan-store.mjs';
import { genericProposal } from './fixtures/generic-plan.mjs';
import { approve } from './fixtures/approved-plan.mjs';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const folder = join(root, 'test-results/desktop-live/consolidation');
const task = 'On /registration, click Create account with empty fields; the visible status must be exactly Name and email are required.';
const expected = { kind: 'text', selector: '#result', expected: 'Name and email are required', present: true };
function strings(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(strings).join('\n');
  return value && typeof value === 'object' ? Object.values(value).map(strings).join('\n') : '';
}
function proposal() {
  return { assumptions: [], criteria: [{ criterionId: 'AC-1', interpretation: 'testable', explanation: 'The requirement provides a specific visible message.', negativeTests: { applicability: 'unspecified', reason: 'Only empty-field rejection requested.' }, boundaryTests: { applicability: 'unspecified', reason: 'No other boundary requested.' } }], scenarios: [{ id: 'S-1', criterionId: 'AC-1', category: 'positive', title: 'Reject empty registration', assumptionIds: [], preconditions: ['The registration page starts with empty fields.'], steps: [{ instruction: 'Open the registration page.', expectedOutcome: 'The form is available.' }, { instruction: 'Click Create account without entering data.', expectedOutcome: 'The required-fields message is visible.' }], assertions: [{ kind: 'text', description: 'The visible status is Name and email are required.', exactValue: 'Name and email are required', sourceQuote: task }] }] };
}

test('reviewed initial input state is rechecked before any business action', async () => {
  const fixture = await startControlledFixture();
  try {
    const result = await runGenericScenario({ id: 'S-1', name: 'Prerequisite mismatch', steps: [{ kind: 'NAVIGATE', path: '/registration' }, { kind: 'CLICK', target: { label: 'Create account', role: 'button' } }, { kind: 'assert', assertion: expected }] }, {
      fixture, authorized: true, options: { headless: true }, initialState: [{ selector: '[name="name"]', name: 'Your name', empty: false, enabled: true }],
    });
    expect(result.outcome).toBe('BLOCKED'); expect(result.steps[0].message).toContain('initial control state changed');
    expect(result.steps.find(item => item.kind === 'CLICK').outcome).toBe('NOT RUN'); expect(result.browserClosed).toBe(true); expect(result.assertionsExecuted).toBe(0);
  } finally { await fixture.close(); }
});

test('a mounted review card prepares its selected URL after executable bindings are added', async () => {
  const data = mkdtempSync(join(tmpdir(), 'qaspider-bound-url-')), database = join(data, 'desktop-plans.sqlite');
  let store = new PlanStore(database);
  const projectId = store.conversations.createProject({ title: 'Selected application' });
  const conversation = store.conversations.create({ projectId, title: 'URL binding regression', context: { mode: 'selected', url: 'https://selected.example/registration' } });
  const proposal = genericProposal(); proposal.ticket.acceptanceCriteria = [proposal.ticket.acceptanceCriteria[0]]; proposal.criteria = [proposal.criteria[0]]; proposal.scenarios = [proposal.scenarios[0]];
  let saved = store.create(proposal, { executionRequired: true }); store.conversations.linkPlan(conversation.id, saved.planId, 'Review the selected application.'); store.close();
  const env = { ...process.env, QASPIDER_DESKTOP_LEGACY_UI: '0', QASPIDER_DESKTOP_PROVIDER: 'none', QASPIDER_DESKTOP_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [join(root, 'apps/desktop')], env });
  try {
    const page = await app.firstWindow(); await expect(page.getByTestId('revision-status')).toContainText('DRAFT');
    store = new PlanStore(database);
    const assertion = { kind: 'text', selector: '#result', expected: 'Name and email are required', present: true };
    saved = store.bindExecution(saved.planId, saved.version, { context: { ...conversation.context, projectId }, note: '', scenarios: [{ scenarioId: 'S-1', planJson: JSON.stringify({ id: 'S-1', name: 'Selected application', steps: [{ kind: 'NAVIGATE', path: '/registration' }, { kind: 'assert', assertion }] }), assertionSources: [{ index: 0, description: saved.content.scenarios[0].assertions[0].description, assertionJson: JSON.stringify(assertion) }], prerequisites: [{ description: saved.content.scenarios[0].preconditions[0], resolution: 'navigation', stepNumbers: [] }], blockers: [] }] });
    saved = store.mutate({ planId: saved.planId, revision: saved.revision, version: saved.version, action: { type: 'confirm-execution', note: 'Review fixture: assertion and navigation setup checked.' } });
    saved = approve(store, saved); store.close();
    await page.getByRole('button', { name: 'URL binding regression', exact: true }).click();
    await expect(page.getByTestId('revision-status')).toContainText('APPROVED');
    await page.getByRole('button', { name: 'Prepare approved execution', exact: true }).click();
    await expect(page.getByText('S-1: EXECUTABLE', { exact: true })).toBeVisible();
    await expect(page.getByTestId('approved-execution')).toContainText('https://selected.example');
    await expect(page.getByRole('button', { name: 'Execute Approved Plan', exact: true })).toBeDisabled();
    // Preparation validates configuration only: no target browser or website request is made.
  } finally { await app.close(); }
});

test('chat request → grounded review → separate authorization → execution → restart and project-scoped reuse', async () => {
  test.setTimeout(180_000);
  mkdirSync(folder, { recursive: true });
  let inferenceRequests = 0;
  const endpoint = createServer(async (request, response) => {
    try {
      let body = ''; for await (const bytes of request) body += bytes;
      const input = JSON.parse(body), prompt = strings(input.input).replaceAll('\\n', '\n').replaceAll('\\"', '"');
      expect(input.tools ?? []).toEqual([]); inferenceRequests++;
      if (prompt.includes('Prepare explicit executable bindings')) {
        sendSyntheticResponse(response, { scenarios: [{ scenarioId: 'S-1', operations: [{ kind: 'CLICK', controlId: 'control-1', value: null, expected }], assertions: [expected], prerequisites: [{ resolution: 'navigation', stepNumbers: [] }], blockers: [] }] });
      } else if (prompt.includes('Propose a reviewable QA test plan')) sendSyntheticResponse(response, proposal());
      else {
        const line = prompt.split('\n').find(line => line.includes('Create account') && /\[\d+-\d+\].*button/.test(line));
        if (!line) throw new Error('The real browser did not expose the expected synthetic control.');
        sendSyntheticResponse(response, { elements: [{ elementId: line.match(/\[(\d+-\d+)\]/)[1], description: 'Create account', method: 'click', arguments: [] }] });
      }
    } catch { response.writeHead(400); response.end('Synthetic test request failed'); }
  });
  await new Promise(resolve => endpoint.listen(0, '127.0.0.1', resolve));
  const data = mkdtempSync(join(tmpdir(), 'qaspider-chat-electron-'));
  const env = { ...process.env, QASPIDER_DESKTOP_LEGACY_UI: '0', QASPIDER_DESKTOP_PROVIDER: 'codex', QASPIDER_DESKTOP_HEADLESS: '1', QASPIDER_DESKTOP_DATA_DIR: data, QASPIDER_DESKTOP_TEST_ENDPOINT: `http://127.0.0.1:${endpoint.address().port}/v1` };
  delete env.ELECTRON_RUN_AS_NODE;
  let app = await electron.launch({ args: [join(root, 'apps/desktop')], env });
  const started = performance.now();
  let originalHash, firstReport, secondReport, planId, projectId, conversationId;
  try {
    let page = await app.firstWindow();
    await expect(page.getByLabel('QA request and expected results')).toHaveCount(0);
    await page.getByLabel('New project name').fill('Consolidation verification');
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await page.getByRole('button', { name: 'New conversation', exact: true }).click();
    await page.getByLabel('Application', { exact: true }).selectOption('controlled');
    await page.getByRole('button', { name: 'Save application context', exact: true }).click();
    await expect(page.getByText('Current: /registration.', { exact: false })).toBeVisible();
    await page.screenshot({ path: join(folder, 'chat-start.png') });
    await page.getByLabel('QA request and expected results').fill(task);
    await page.getByRole('button', { name: 'Prepare test plan', exact: true }).click();
    await expect(page.getByTestId('revision-status')).toContainText('DRAFT');
    await expect(page.getByText('Prepare executable commands and prerequisites before approval.', { exact: true })).toBeVisible();
    const projects = await page.evaluate(() => window.qaspider.projects());
    const project = projects.value.find(item => item.title === 'Consolidation verification'); projectId = project.id; conversationId = project.conversations[0].id;
    const conversation = await page.evaluate(id => window.qaspider.conversation(id), conversationId);
    planId = conversation.value.messages.find(item => item.planId).planId;
    const initial = await page.evaluate(id => window.qaspider.getPlan({ planId: id }), planId);
    expect(initial.value.original.scenarios[0].steps[0].instruction).toBe('Open the registration page.');
    const attempt = await page.evaluate(plan => window.qaspider.preparePlan({ planId: plan.planId, revision: plan.revision, version: plan.version, hash: plan.hash }), initial.value);
    expect(attempt.status).toBe('error');
    await page.getByRole('button', { name: 'Prepare executable draft', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Executable bindings and prerequisites' })).toBeVisible();
    await expect(page.getByText('Original expectation: The visible status is Name and email are required.', { exact: false })).toBeVisible();
    await page.getByLabel('Executable binding review note').fill('The initial page has empty fields. I reviewed the discovered button, explicit click, original message expectation and navigation prerequisite.');
    await page.getByRole('button', { name: 'Confirm executable bindings and setup', exact: true }).click();
    await page.getByRole('button', { name: 'Start review', exact: true }).click();
    await page.getByLabel('Coverage review note for AC-1').fill('The original empty-field rejection criterion is covered by the explicit click and exact visible-message assertion.');
    await page.getByRole('button', { name: 'Confirm planned coverage for AC-1', exact: true }).click();
    await page.getByRole('button', { name: 'Approve Plan', exact: true }).click();
    await expect(page.getByTestId('revision-status')).toContainText('APPROVED');
    const approved = await page.evaluate(id => window.qaspider.getPlan({ planId: id }), planId); originalHash = approved.value.hash;
    expect(approved.value.original).toEqual(initial.value.original);
    await page.getByTestId('revision-status').scrollIntoViewIfNeeded(); await page.screenshot({ path: join(folder, 'reviewed-plan.png') });
    await expect(page.getByRole('button', { name: 'Execute Approved Plan', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Prepare approved execution', exact: true }).click();
    await expect(page.getByText('S-1: EXECUTABLE', { exact: true })).toBeVisible();
    const preparedUI = page.getByTestId('approved-execution');
    await preparedUI.scrollIntoViewIfNeeded(); await page.screenshot({ path: join(folder, 'separate-authorization.png') });
    await preparedUI.getByRole('checkbox').check();
    await preparedUI.getByRole('button', { name: 'Execute Approved Plan', exact: true }).click();
    await expect(page.getByTestId('ticket-execution-report')).toContainText('Ticket report: PASS · COMPLETED', { timeout: 90_000 });
    firstReport = (await page.evaluate(id => window.qaspider.planReports({ planId: id, revision: 1 }), planId)).value[0];
    expect(firstReport.hash).toBe(originalHash); expect(firstReport.knowledgeScope.project).toBe(projectId);
    expect(firstReport.scenarios[0].result.knowledge.metrics.reusedSteps).toBe(0);
    expect(firstReport.scenarios[0].result.initialSessionEmpty).toBe(true);
    expect(firstReport.scenarios[0].result.browserClosed).toBe(true);
    await page.getByTestId('ticket-execution-report').scrollIntoViewIfNeeded(); await page.screenshot({ path: join(folder, 'first-report.png') });
    await app.close(); app = await electron.launch({ args: [join(root, 'apps/desktop')], env }); page = await app.firstWindow();
    await expect(page.getByTestId('ticket-execution-report')).toContainText('Ticket report: PASS · COMPLETED');
    const persisted = await page.evaluate(id => window.qaspider.conversation(id), conversationId);
    expect(persisted.value.messages.some(item => item.reportId === firstReport.id)).toBe(true);
    expect((await page.evaluate(id => window.qaspider.getPlan({ planId: id }), planId)).value.hash).toBe(originalHash);
    await page.getByRole('button', { name: 'Prepare approved execution', exact: true }).click();
    await page.getByTestId('approved-execution').getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Execute Approved Plan', exact: true }).click();
    await expect(page.getByTestId('ticket-execution-report')).toHaveCount(2);
    await expect(page.getByTestId('ticket-execution-report').last()).toContainText('Ticket report: PASS · COMPLETED');
    secondReport = (await page.evaluate(id => window.qaspider.planReports({ planId: id, revision: 1 }), planId)).value[0];
    expect(secondReport.id).not.toBe(firstReport.id); expect(secondReport.scenarios[0].result.knowledge.metrics.reusedSteps).toBe(1);
    expect(secondReport.scenarios[0].result.knowledge.metrics.discoveryCalls).toBe(0);
    expect(secondReport.hash).toBe(originalHash);
    await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
    await expect(page.getByTestId('knowledge')).toContainText('1 reused steps');
    await page.getByText('Revision history and evidence (1)', { exact: true }).click();
    await page.getByRole('button', { name: 'View step 3 evidence', exact: true }).click();
    await expect(page.getByAltText('Persisted workflow execution evidence')).toBeVisible();
    await page.screenshot({ path: join(folder, 'knowledge-evidence.png') });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByLabel('Model', { exact: true })).toBeVisible();
    await expect(page.getByText('Selected-website form submissions and file uploads remain unsupported.', { exact: true })).toBeVisible();
    await page.screenshot({ path: join(folder, 'settings.png') });
    await page.getByText('Developer tools and migration fallback', { exact: true }).click();
    await page.getByRole('button', { name: 'Open legacy workspace', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Open. Capture. Inspect.' })).toBeVisible();
    await page.screenshot({ path: join(folder, 'legacy-fallback.png') });
    await page.getByRole('button', { name: 'Return to chat', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Conversations', exact: true })).toBeVisible();
    const summarize = report => ({ id: report.id, outcome: report.outcome, hash: report.hash, origin: report.origin, startedAt: report.startedAt, completedAt: report.completedAt, scope: report.knowledgeScope, metrics: report.scenarios[0].result.knowledge.metrics, assertions: report.scenarios[0].result.assertionsExecuted, evidenceIds: report.scenarios[0].result.evidence.map(item => item.id) });
    writeFileSync(join(folder, 'receipt.json'), JSON.stringify({ mode: 'Real Electron, Chromium, Stagehand and Codex CLI transport; explicitly synthetic model responses', publicLoginExecuted: false, task, projectId, conversationId, planId, durationMs: performance.now() - started, inferenceRequests, first: summarize(firstReport), reusedAfterRestart: summarize(secondReport), screenshots: ['chat-start.png','reviewed-plan.png','separate-authorization.png','first-report.png','knowledge-evidence.png','settings.png','legacy-fallback.png'] }, null, 2) + '\n');
  } finally { await app.close(); endpoint.closeAllConnections(); await new Promise(resolve => endpoint.close(resolve)); }
});
