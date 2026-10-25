import { test, expect, _electron as electron } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PlanStore } from '../electron/plan-store.mjs';
import { ApprovedExecution } from '../electron/approved-execution.mjs';
import { executableProposal, approve, executionIdentity, executionRequest } from './fixtures/approved-plan.mjs';
import { runScenario } from '../electron/scenario-runner.mjs';
import { openBrowserSession } from '../electron/browser.mjs';
import { testAccount, invalidAccount } from '../demo/credentials.mjs';

const root = fileURLToPath(new URL('../../..', import.meta.url));
test('approved ticket uses isolated M3 sessions and retains evidence after browser cleanup', async () => {
  const store = new PlanStore(':memory:'); const saved = approve(store, store.create(executableProposal()));
  const sessions = [];
  const service = new ApprovedExecution(store, { runner: (plan, options) => runScenario(plan, { ...options, options: { headless: true }, openSession: async (...args) => {
    const session = await openBrowserSession(...args); sessions.push(session);
    expect(await session.controlledPage.evaluate(() => localStorage.getItem('m43-marker'))).toBeNull();
    await session.controlledPage.evaluate(() => localStorage.setItem('m43-marker', 'previous-scenario'));
    const screenshot = session.controlledPage.screenshot.bind(session.controlledPage);
    session.controlledPage.screenshot = async settings => { expect(settings.mask).toHaveLength(1); return screenshot(settings); };
    return session;
  } }) });
  try {
    const preparation = await service.prepare(executionIdentity(saved)); const report = await service.execute(executionRequest(saved, preparation));
    expect(report.outcome).toBe('PASS'); expect(sessions).toHaveLength(2);
    expect(sessions.every(session => session.browser.closed)).toBe(true);
    const persisted = store.executions(saved.planId, saved.revision)[0];
    expect(persisted.scenarios.every(item => item.result.initialSessionEmpty && item.result.browserClosed && item.result.evidence.length > 2)).toBe(true);
    for (const account of [testAccount, invalidAccount]) for (const value of Object.values(account)) expect(JSON.stringify(persisted)).not.toContain(value);
  } finally { await service.close(); store.close(); }
});

test('failed assertions survive screenshot and browser cleanup errors', async () => {
  const store = new PlanStore(':memory:'); const saved = approve(store, store.create(executableProposal({ failing: true })));
  const service = new ApprovedExecution(store, { runner: (plan, options) => runScenario(plan, { ...options, options: { headless: true }, assertionTimeoutMs: 100, openSession: async (...args) => {
    const session = await openBrowserSession(...args);
    const capture = session.controlledPage.screenshot.bind(session.controlledPage);
    let captures = 0;
    session.controlledPage.screenshot = async settings => {
      captures++;
      if (plan.id === 'S-3' && captures === 5) throw new Error('Evidence unavailable');
      return capture(settings);
    };
    const close = session.close;
    session.close = async () => { await close(); if (plan.id === 'S-3') throw new Error('Cleanup receipt unavailable'); };
    return session;
  } }) });
  try {
    const prep = await service.prepare(executionIdentity(saved)); const report = await service.execute(executionRequest(saved, prep));
    expect(report.outcome).toBe('FAIL'); expect(report.scenarios[2].result.steps.some(item => item.outcome === 'FAIL')).toBe(true);
  } finally { await service.close(); store.close(); }
});

test('real desktop executes exact approved revision and persists one evidence-backed ticket report', async () => {
  test.setTimeout(120_000);
  const folder = join(root, '.qaspider/desktop-m43-live', randomUUID()); mkdirSync(folder, { recursive: true });
  const database = join(folder, 'desktop-plans.sqlite'); const store = new PlanStore(database);
  const saved = approve(store, store.create(executableProposal({ failing: true }))); store.close();
  const env = { ...process.env, QASPIDER_DESKTOP_PROVIDER: 'none', QASPIDER_DESKTOP_HEADLESS: '1', QASPIDER_DESKTOP_DATA_DIR: folder }; delete env.ELECTRON_RUN_AS_NODE;
  let app = await electron.launch({ args: [fileURLToPath(new URL('..', import.meta.url))], env });
  const evidenceFolder = join(root, 'test-results/desktop-live/m4.3'); mkdirSync(evidenceFolder, { recursive: true });
  try {
    let window = await app.firstWindow(); let section = window.getByTestId('approved-execution');
    await expect(window.getByTestId('revision-status')).toContainText('APPROVED');
    await expect(section.getByRole('button', { name: 'Execute Approved Plan', exact: true })).toBeDisabled();
    await section.getByRole('button', { name: 'Prepare approved execution', exact: true }).click();
    await expect(section.getByText('S-1: EXECUTABLE', { exact: true })).toBeVisible();
    await section.screenshot({ path: join(evidenceFolder, 'prepared.png') });
    await section.getByRole('checkbox').check();
    await section.getByRole('button', { name: 'Execute Approved Plan', exact: true }).click();
    await expect(section.getByTestId('ticket-execution-report')).toContainText('RUNNING');
    await expect(section.getByTestId('ticket-execution-report')).toContainText('Ticket report: FAIL · COMPLETED', { timeout: 90_000 });
    let response = await window.evaluate(input => window.qaspider.planReports(input), { planId: saved.planId, revision: saved.revision });
    expect(response.status).toBe('ok'); expect(response.value).toHaveLength(1); const report = response.value[0];
    expect(report.hash).toBe(saved.hash); expect(report.revision).toBe(saved.revision);
    expect(report.scenarios.map(item => item.outcome)).toEqual(['PASS', 'PASS', 'FAIL']);
    expect(report.coverage.map(item => item.verified)).toEqual([true, true, false]);
    const exported = structuredClone(report);
    for (const scenario of exported.scenarios) for (const evidence of scenario.result.evidence) {
      const name = `${scenario.scenarioId}-step-${evidence.stepNumber}.png`;
      writeFileSync(join(evidenceFolder, name), Buffer.from(evidence.screenshot.split(',')[1], 'base64'));
      evidence.screenshot = `test-results/desktop-live/m4.3/${name}`;
    }
    await section.getByTestId('ticket-execution-report').getByRole('heading', { name: /Ticket report:/ }).scrollIntoViewIfNeeded();
    await window.screenshot({ path: join(evidenceFolder, 'ticket-report.png') });
    const failure = report.scenarios[2].result.steps.find(item => item.outcome === 'FAIL');
    expect(failure.expected).toBe(report.origin + '/dashboard'); expect(failure.actual).toBe(report.origin + '/login?error=invalid');
    writeFileSync(join(root, 'validation/desktop-m4.3-execution.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), synthetic: true, inferenceInvoked: false, privateDatabase: database, ...exported }, null, 2) + '\n');
    await app.close(); app = await electron.launch({ args: [fileURLToPath(new URL('..', import.meta.url))], env });
    window = await app.firstWindow(); section = window.getByTestId('approved-execution');
    await expect(section.getByTestId('ticket-execution-report')).toContainText('Ticket report: FAIL · COMPLETED');
    await section.getByTestId('ticket-execution-report').locator('details').first().locator('summary').click();
    await expect(section.locator('img').first()).toBeVisible();
    response = await window.evaluate(input => window.qaspider.planReports(input), { planId: saved.planId, revision: saved.revision });
    expect(response.value[0]).toEqual(report);
  } finally { await app.close(); }
});
