import { test, expect, _electron as electron } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { startControlledFixture } from '../electron/controlled-fixture.mjs';
import { runGenericScenario } from '../electron/generic-execution.mjs';
import { openBrowserSession } from '../electron/browser.mjs';
import { PlanStore } from '../electron/plan-store.mjs';
import { ApprovedExecution } from '../electron/approved-execution.mjs';
import { genericProposal, plan, navigate, fill, click, check } from './fixtures/generic-plan.mjs';
import { approve, executionIdentity, executionRequest } from './fixtures/approved-plan.mjs';

let fixture;
const reports = [];
const folder = fileURLToPath(new URL('../../../test-results/desktop-live/m5/', import.meta.url));
test.beforeAll(async () => { fixture = await startControlledFixture(); mkdirSync(folder, { recursive: true }); });
test.afterAll(async () => {
  await fixture.close();
  writeFileSync(folder + 'browser-reports.json', JSON.stringify(reports, null, 2));
  writeFileSync(fileURLToPath(new URL('../../../validation/desktop-m5-browser.json', import.meta.url)), JSON.stringify({ verifiedAt: new Date().toISOString(), liveModelInference: false, observationMode: 'synthetic proposals for adaptation and budget cases; deterministic locators otherwise', realStagehandBrowser: true, reports: reports.map(({ evidence, ...report }) => ({ ...report, evidence: evidence.map(item => ({ ...item, screenshot: '[PNG persisted in ignored test-results]' })) })) }, null, 2));
});
async function run(steps, expected, extra = {}) {
  const report = await runGenericScenario(plan(steps), { fixture, authorized: true, options: { headless: true }, assertionTimeoutMs: 150, ...extra });
  expect(report.outcome, JSON.stringify({ steps: report.steps, message: report.message })).toBe(expected);
  reports.push(report);
  for (const item of report.evidence) writeFileSync(folder + item.id + '.png', Buffer.from(item.screenshot.split(',')[1], 'base64'));
  return report;
}
test('registration: required, duplicate and successful synthetic registration', async () => {
  await run([navigate('/registration'), click('Create account'), check('Name and email are required')], 'PASS');
  await run([navigate('/registration'), fill('Your name', 'Synthetic Tester'), fill('Email address', 'duplicate@example.test'), click('Create account'), check('Email already registered')], 'PASS');
  const report = await run([navigate('/registration'), fill('Your name', 'Synthetic Tester'), fill('Email address', 'new@example.test'), { kind: 'SELECT', target: { label: 'Account type' }, value: 'test' }, click('Create account'), check('Registration complete'), { kind: 'ASSERT_ENABLED', selector: 'button', expected: true }, { kind: 'ASSERT_VISIBLE', selector: '#result', expected: true }, { kind: 'ASSERT_TEXT', selector: '#result', expected: 'Error', present: false }], 'PASS');
  expect(JSON.stringify(report)).not.toContain('new@example.test'); expect(report.browserClosed).toBe(true);
});
test('contact: required, invalid email, successful submission and deliberately wrong business outcome', async () => {
  await run([navigate('/contact'), click('Submit'), check('Name and email are required')], 'PASS');
  await run([navigate('/contact'), fill('Name', 'Synthetic Tester'), fill('Email', 'invalid'), click('Submit'), check('Enter a valid email')], 'PASS');
  await run([navigate('/contact'), fill('Name', 'Synthetic Tester'), fill('Email', 'contact@example.test'), click('Submit'), check('Message received')], 'PASS');
  await run([navigate('/contact'), click('Submit'), check('Message received')], 'FAIL');
});
test('changed structure and label: real browser with a synthetic Stagehand observation proposal', async () => {
  let observations = 0;
  const report = await run([navigate('/contact-changed'), fill('Name', 'Synthetic Tester'), fill('Email', 'variant@example.test'), click('Submit', ['Send Message']), check('Message received')], 'PASS', {
    options: { headless: true, model: { generate: async () => { throw new Error('Synthetic observer should replace observation'); } } },
    openSession: async (...args) => {
      const session = await openBrowserSession(...args);
      session.stagehand.observe = async () => { observations++; return { data: [{ selector: 'button', method: 'click', arguments: [] }] }; };
      return session;
    },
  });
  expect(observations).toBe(1); expect(report.adaptations).toHaveLength(1); expect(report.adaptations[0].evidenceId).toBeTruthy();
});
test('ambiguous, unsupported, unauthorized, missing provider, sensitive paths and navigation failures', async () => {
  await run([navigate('/ambiguous'), click('Submit'), check('Ready')], 'BLOCKED');
  await run([navigate('/contact'), { kind: 'EVALUATE', script: 'alert(1)' }, check('Ready')], 'BLOCKED');
  await run([navigate('/contact'), click('Submit'), check('Ready')], 'BLOCKED', { authorized: false });
  await run([navigate('/contact-changed'), click('Submit', ['Send Message']), check('Ready')], 'BLOCKED');
  await run([navigate('/sensitive-link'), { kind: 'CLICK', target: { label: 'Read configuration', role: 'link' } }, check('Ready')], 'BLOCKED');
  await run([navigate('/escape'), check('Ready')], 'INCONCLUSIVE');
  await run([navigate('/contact'), check('Ready')], 'INCONCLUSIVE', { openSession: async () => { throw new Error('Browser unavailable'); } });
});
test('assertion FAIL survives screenshot and cleanup failures', async () => {
  await run([navigate('/contact'), check('Impossible')], 'FAIL', { openSession: async (...args) => {
    const session = await openBrowserSession(...args), capture = session.controlledPage.screenshot.bind(session.controlledPage), close = session.close;
    let count = 0;
    session.controlledPage.screenshot = async options => { if (++count > 1) throw new Error('Evidence unavailable'); return capture(options); };
    session.close = async () => { await close(); throw new Error('Cleanup unavailable'); };
    return session;
  } });
});
test('generic approved plans retain criterion, revision and SQLite evidence', async () => {
  const store = new PlanStore(':memory:'), saved = approve(store, store.create(genericProposal()));
  const service = new ApprovedExecution(store, { options: { headless: true } });
  try {
    const prep = await service.prepare(executionIdentity(saved));
    const report = await service.execute(executionRequest(saved, prep));
    expect(report.outcome, JSON.stringify(report.gaps)).toBe('PASS'); expect(report.hash).toBe(saved.hash);
    expect(report.coverage.every(item => item.verified)).toBe(true);
    expect(store.executions(saved.planId, saved.revision)[0]).toEqual(report);
    expect(JSON.stringify(report)).not.toContain('qa@example.test');
  } finally { await service.close(); store.close(); }
});
test('Electron ticket workspace prepares, executes and reloads generic reports and screenshots', async () => {
  test.setTimeout(120_000);
  const data = fileURLToPath(new URL(`../../../.qaspider/desktop-m5/${randomUUID()}/`, import.meta.url)); mkdirSync(data, { recursive: true });
  const store = new PlanStore(data + 'desktop-plans.sqlite'); const saved = approve(store, store.create(genericProposal())); store.close();
  const env = { ...process.env, QASPIDER_DESKTOP_DATA_DIR: data, QASPIDER_DESKTOP_PROVIDER: 'none', QASPIDER_DESKTOP_HEADLESS: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  let app = await electron.launch({ args: [fileURLToPath(new URL('..', import.meta.url))], env });
  try {
    let window = await app.firstWindow(), section = window.getByTestId('approved-execution');
    await section.getByRole('button', { name: 'Prepare approved execution', exact: true }).click();
    await expect(section.getByText('S-1: EXECUTABLE', { exact: true })).toBeVisible();
    await window.screenshot({ path: folder + 'desktop-preflight.png' });
    await section.getByRole('checkbox').check(); await section.getByRole('button', { name: 'Execute Approved Plan', exact: true }).click();
    await expect(section.getByTestId('ticket-execution-report')).toContainText('Ticket report: PASS · COMPLETED', { timeout: 90_000 });
    await window.screenshot({ path: folder + 'desktop-report.png' });
    const reply = await window.evaluate(input => window.qaspider.planReports(input), { planId: saved.planId, revision: saved.revision }); expect(reply.value[0].outcome).toBe('PASS');
    await app.close(); app = await electron.launch({ args: [fileURLToPath(new URL('..', import.meta.url))], env });
    window = await app.firstWindow(); section = window.getByTestId('approved-execution');
    await expect(section.getByTestId('ticket-execution-report')).toContainText('Ticket report: PASS · COMPLETED');
    await section.getByTestId('ticket-execution-report').locator('details').first().locator('summary').click(); await expect(section.locator('img').first()).toBeVisible();
  } finally { await app.close(); }
});

test('adaptation rejects changed meaning and forbidden proposal methods', async () => {
  for (const proposals of [
    [{ selector: 'button', method: 'evaluate', arguments: ['alert(1)'] }],
    [{ selector: 'button', method: 'click', arguments: [] }],
  ]) {
    await run([navigate('/contact-changed'), click('Submit', ['Save record']), check('Ready')], 'BLOCKED', {
      options: { headless: true, model: { generate: async () => { throw new Error('test-only observer'); } } },
      openSession: async (...args) => { const session = await openBrowserSession(...args); session.stagehand.observe = async () => ({ data: proposals }); return session; },
    });
  }
});

test('enabled=false and visibility=false measure real state; unknown options and deadlines stop safely', async () => {
  await run([navigate('/contact'), { kind: 'ASSERT_ENABLED', selector: 'button', expected: false }, { kind: 'ASSERT_VISIBLE', selector: '#missing', expected: false }], 'PASS', {
    openSession: async (...args) => {
      const session = await openBrowserSession(...args);
      await session.controlledPage.locator('button').evaluate(node => { node.disabled = true; });
      return session;
    },
  });
  await run([navigate('/registration'), { kind: 'SELECT', target: { label: 'Account type' }, value: 'nonexistent' }, check('Ready')], 'BLOCKED');
  await run([navigate('/contact'), check('Ready')], 'INCONCLUSIVE', { maxDurationMs: 1 });
});

test('synthetic observer budget is enforced and screenshot controls are always masked', async () => {
  let observations = 0, screenshots = 0;
  await run([navigate('/contact'), ...Array.from({ length: 3 }, () => ({ kind: 'OBSERVE', instruction: 'Find the Submit button' })), check('Ready')], 'BLOCKED', {
    options: { headless: true, model: { generate: async () => { throw new Error('test-only observer'); } } },
    openSession: async (...args) => {
      const session = await openBrowserSession(...args), capture = session.controlledPage.screenshot.bind(session.controlledPage);
      session.stagehand.observe = async () => { observations++; return { data: [{ selector: 'button', method: 'click', arguments: [] }] }; };
      session.controlledPage.screenshot = async settings => { expect(settings.mask).toHaveLength(1); screenshots++; return capture(settings); };
      return session;
    },
  });
  expect(observations).toBe(2); expect(screenshots).toBeGreaterThan(1);
});

test('a deliberate product defect preserves approved expectations and persists FAIL with evidence', async () => {
  const data = fileURLToPath(new URL(`../../../.qaspider/desktop-m5-audit/${randomUUID()}/`, import.meta.url)); mkdirSync(data, { recursive: true });
  const database = data + 'plans.sqlite';
  let store = new PlanStore(database);
  const saved = approve(store, store.create(genericProposal())), before = structuredClone(saved);
  const service = new ApprovedExecution(store, { runner: (input, settings) => runGenericScenario(input, { ...settings, options: { headless: true }, assertionTimeoutMs: 150, openSession: async (...args) => {
    const session = await openBrowserSession(...args);
    if (input.id === 'S-2') {
      // Test-only product regression: valid contact submissions display the wrong
      // confirmation. The approved command and expected result stay untouched.
      await session.controlledPage.locator('form').evaluate(form => form.addEventListener('submit', () => {
        document.getElementById('result').textContent = 'Delivery failed';
      }));
    }
    return session;
  } }) });
  try {
    const prep = await service.prepare(executionIdentity(saved)), report = await service.execute(executionRequest(saved, prep));
    expect(report.outcome).toBe('FAIL'); expect(report.scenarios.map(item => item.outcome)).toEqual(['PASS', 'FAIL']);
    const scenario = report.scenarios[1], failure = scenario.result.steps.find(step => step.outcome === 'FAIL');
    expect(failure.expected).toBe('Message received'); expect(failure.actual).toBe('Delivery failed');
    const evidence = scenario.result.evidence.find(item => item.id === failure.evidenceId);
    expect(evidence.screenshot).toMatch(/^data:image\/png;base64,/);
    writeFileSync(folder + 'product-defect.png', Buffer.from(evidence.screenshot.split(',')[1], 'base64'));
    expect(store.get(saved.planId)).toEqual(before);
    store.close(); store = new PlanStore(database);
    expect(store.executions(saved.planId, saved.revision)[0]).toEqual(report);
    expect(store.get(saved.planId)).toEqual(before);
    writeFileSync(folder + 'product-defect-report.json', JSON.stringify(report, (key, value) => key === 'screenshot' ? '[Persisted in SQLite; product-defect.png exported]' : value, 2));
  } finally { await service.close(); store.close(); }
});

test('adaptation history, approved identity, screenshots and consolidated report survive SQLite restart', async () => {
  const proposal = genericProposal();
  proposal.scenarios[1].steps[0] = { instruction: JSON.stringify(navigate('/contact-changed')), expectedOutcome: JSON.stringify({ kind: 'url', expected: '/contact-changed' }) };
  proposal.scenarios[1].steps.at(-1).instruction = JSON.stringify(click('Submit', ['Send Message']));
  const data = fileURLToPath(new URL(`../../../.qaspider/desktop-m5-audit/${randomUUID()}/`, import.meta.url)); mkdirSync(data, { recursive: true });
  const database = data + 'plans.sqlite';
  let store = new PlanStore(database);
  const saved = approve(store, store.create(proposal)), before = structuredClone(saved);
  const service = new ApprovedExecution(store, { runner: (input, settings) => runGenericScenario(input, { ...settings, options: { headless: true, model: { generate: async () => { throw new Error('Synthetic observer only'); } } }, openSession: async (...args) => {
    const session = await openBrowserSession(...args);
    session.stagehand.observe = async () => ({ data: [{ selector: 'button', method: 'click', arguments: [] }] });
    return session;
  } }) });
  try {
    const prep = await service.prepare(executionIdentity(saved)), report = await service.execute(executionRequest(saved, prep));
    expect(report.outcome).toBe('PASS'); expect(report.hash).toBe(saved.hash);
    const result = report.scenarios[1].result;
    expect(result.adaptations).toHaveLength(1); expect(result.adaptations[0].actualNames).toContain('Send Message');
    expect(result.evidence.some(item => item.id === result.adaptations[0].evidenceId)).toBe(true);
    expect(store.get(saved.planId)).toEqual(before);
    store.close(); store = new PlanStore(database);
    const restored = store.executions(saved.planId, saved.revision)[0];
    expect(restored).toEqual(report); expect(store.get(saved.planId)).toEqual(before);
    writeFileSync(folder + 'adaptation-persistence-report.json', JSON.stringify(restored, (key, value) => key === 'screenshot' ? '[PNG persisted in SQLite]' : value, 2));
  } finally { await service.close(); store.close(); }
});
