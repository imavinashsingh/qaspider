import { test, expect, _electron as electron } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { startControlledFixture } from '../electron/controlled-fixture.mjs';
import { runScenario } from '../electron/scenario-runner.mjs';
import { loginScenarios } from '../electron/scenarios.mjs';
import { openBrowserSession } from '../electron/browser.mjs';
import { testAccount, invalidAccount } from '../demo/credentials.mjs';

let fixture, lastSession;
const options = { headless: true };
const plans = loginScenarios();
async function trackedOpen(...args) { lastSession = await openBrowserSession(...args); return lastSession; }
async function run(plan = plans[0], extra = {}) { return runScenario(plan, { fixture, authorized: true, options, openSession: trackedOpen, assertionTimeoutMs: 300, ...extra }); }
test.beforeAll(async () => { fixture = await startControlledFixture(); });
test.afterEach(async () => { await lastSession?.close(); lastSession = null; });
test.afterAll(async () => { await fixture?.close(); });

test('valid login reaches dashboard, invalid login is isolated, wrong expectation FAILS', async ({}, testInfo) => {
  for (const [index, expected] of [[0, 'PASS'], [1, 'PASS'], [2, 'FAIL']]) {
    const report = await run(plans[index], { openSession: async (...args) => {
      const session = await trackedOpen(...args);
      expect(await session.controlledPage.evaluate(() => localStorage.getItem('scenario-isolation-marker'))).toBeNull();
      await session.controlledPage.evaluate(() => localStorage.setItem('scenario-isolation-marker', 'must-not-reach-next-scenario'));
      return session;
    } });
    expect(report.outcome, JSON.stringify({ steps: report.steps, message: report.message })).toBe(expected);
    expect(report.initialSessionEmpty).toBe(true);
    expect(report.assertionsExecuted).toBeGreaterThan(1);
    expect(report.evidence.length).toBeGreaterThan(2);
    expect(report.browserClosed).toBe(true);
    expect(lastSession.browser.closed).toBe(true);
    if (index === 0) expect(report.steps.find(step => step.kind === 'assert' && step.actual === fixture.origin + '/dashboard')).toBeTruthy();
    if (index === 1) expect(report.steps.find(step => step.actual === 'Invalid username or password.')).toBeTruthy();
    if (index === 2) {
      const failed = report.steps.at(-1);
      expect(failed).toMatchObject({ outcome: 'FAIL', expected: fixture.origin + '/dashboard', actual: fixture.origin + '/login?error=invalid' });
      // Evidence must remain available in the returned report after browser cleanup.
      const evidence = report.evidence.find(item => item.id === failed.evidenceId);
      expect(evidence).toMatchObject({ stepNumber: failed.number, url: failed.actual });
      expect(evidence.screenshot).toMatch(/^data:image\/png;base64,/);
      const path = testInfo.outputPath('failed-assertion.png');
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.from(evidence.screenshot.split(',')[1], 'base64'));
      await testInfo.attach('failed-assertion-evidence', { path, contentType: 'image/png' });
    }
  }
});
test('explicit authorization is enforced before navigation and no browser starts', async () => {
  const result = await run(plans[0], { authorized: false });
  expect(result.outcome).toBe('BLOCKED'); expect(lastSession).toBeFalsy();
});
test('permission is rechecked before submit; unauthorized form is never submitted', async () => {
  let clicks = 0;
  const result = await run(plans[0], { openSession: async (...args) => {
    const session = await trackedOpen(...args);
    const locator = session.page.locator.bind(session.page);
    session.page.locator = selector => {
      const current = locator(selector);
      const fill = current.fill.bind(current);
      current.fill = async (...fillArgs) => {
        await fill(...fillArgs);
        if (selector === '#password') await session.controlledPage.locator('#login-form').evaluate(form => form.action = 'https://production.example/login');
      };
      const click = current.click.bind(current); current.click = (...clickArgs) => { clicks++; return click(...clickArgs); };
      return current;
    };
    return session;
  } });
  expect(result.outcome).toBe('BLOCKED'); expect(clicks).toBe(0); expect(result.browserClosed).toBe(true);
  expect(result.steps.find(step => step.kind === 'click').evidenceId).toBeTruthy();
  expect(result.steps.at(-1).message).toContain('Not executed');
});
test('credentials stay out of results and all screenshot form controls are masked', async () => {
  let maskedCaptures = 0;
  const result = await run(plans[1], { openSession: async (...args) => {
    const session = await trackedOpen(...args);
    const screenshot = session.controlledPage.screenshot.bind(session.controlledPage);
    session.controlledPage.screenshot = async settings => {
      expect(settings.mask).toHaveLength(1);
      expect(await settings.mask[0].count()).toBe(2);
      maskedCaptures++;
      return screenshot(settings);
    };
    return session;
  } });
  expect(result.outcome).toBe('PASS'); expect(maskedCaptures).toBe(result.evidence.length);
  for (const account of [testAccount, invalidAccount]) for (const value of Object.values(account)) expect(JSON.stringify(result)).not.toContain(value);
  expect(result.steps.filter(step => step.kind === 'fill').every(step => step.actual === '[REDACTED]' && !step.evidenceId)).toBe(true);
});
test('browser command errors redact raw exceptions, stop remaining steps and clean up', async () => {
  const result = await run(plans[0], { openSession: async (...args) => {
    const session = await trackedOpen(...args);
    session.page.locator = () => ({ fill: async () => { throw new Error(testAccount.password); } });
    return session;
  } });
  expect(result.outcome).toBe('INCONCLUSIVE'); expect(result.browserClosed).toBe(true);
  expect(result.steps.some(step => step.message.startsWith('Not executed'))).toBe(true);
  expect(JSON.stringify(result)).not.toContain(testAccount.password);
});
test('screenshot failure cannot report PASS and still closes Chromium', async () => {
  const result = await run(plans[0], { openSession: async (...args) => {
    const session = await trackedOpen(...args); session.controlledPage.screenshot = async () => { throw new Error('capture failed'); }; return session;
  } });
  expect(result.outcome).toBe('INCONCLUSIVE'); expect(result.assertionsExecuted).toBe(0); expect(result.browserClosed).toBe(true);
});
test('startup and cleanup failures are INCONCLUSIVE', async () => {
  const startup = await run(plans[0], { openSession: async () => { throw new Error('startup failed'); } });
  expect(startup.outcome).toBe('INCONCLUSIVE'); expect(startup.browserClosed).toBe(false);
  const cleanup = await run(plans[0], { openSession: async (...args) => {
    const session = await trackedOpen(...args); const close = session.close;
    session.close = async () => { await close(); throw new Error('cleanup receipt failed'); }; return session;
  } });
  expect(cleanup.outcome).toBe('INCONCLUSIVE'); expect(lastSession.browser.closed).toBe(true);
  // Restore for the test's final cleanup.
  lastSession.close = async () => {};
});
test('real Electron UI runs both scenarios and displays step results and screenshots', async () => {
  const env = { ...process.env, QASPIDER_DESKTOP_HEADLESS: '1', QASPIDER_DESKTOP_PROVIDER: 'none' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [fileURLToPath(new URL('..', import.meta.url))], env });
  let logs = '';
  const recordLog = bytes => { logs += String(bytes); };
  app.process().stdout?.on('data', recordLog);
  app.process().stderr?.on('data', recordLog);
  try {
    const window = await app.firstWindow();
    window.on('console', message => recordLog(message.text()));
    const section = window.getByTestId('scenario-workspace');
    await expect(section.getByRole('button', { name: 'Run login scenarios' })).toBeDisabled();
    await section.getByTestId('authorize-scenarios').check();
    await section.getByRole('button', { name: 'Run login scenarios' }).click();
    await expect(section.getByTestId('scenario-summary')).toContainText('Overall result: PASS', { timeout: 60_000 });
    await expect(section.getByTestId('scenario-report')).toHaveCount(2);
    await expect(section.getByText('Invalid username or password.', { exact: false }).first()).toBeVisible();
    await section.locator('details').first().locator('summary').click();
    await expect(section.locator('details').first().locator('img')).toBeVisible();
    await section.screenshot({ path: '../../test-results/desktop-m3-workspace.png' });
    const successfulIpcResult = await window.evaluate(() => window.qaspider.runScenarios({ authorized: true, scenarioIds: ['invalid-login'] }));
    expect(successfulIpcResult.outcome).toBe('PASS');
    for (const account of [testAccount, invalidAccount]) for (const value of Object.values(account)) expect(JSON.stringify(successfulIpcResult)).not.toContain(value);
    const ipcResult = await window.evaluate(() => window.qaspider.runScenarios({ authorized: true, scenarioIds: ['valid-login'], url: 'https://production.example' }));
    expect(ipcResult.outcome).toBe('BLOCKED');
    for (const account of [testAccount, invalidAccount]) for (const value of Object.values(account)) expect(JSON.stringify(ipcResult)).not.toContain(value);
    for (const account of [testAccount, invalidAccount]) for (const value of Object.values(account)) expect(logs).not.toContain(value);
  } finally { await app.close(); }
});
