import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { openBrowserSession } from './browser.mjs';
import { isOwnedFixture, startControlledFixture } from './controlled-fixture.mjs';
import { loginScenarios } from './scenarios.mjs';
import { testAccount, invalidAccount } from '../demo/credentials.mjs';
import { maskedExecutionScreenshot } from './evidence.mjs';

class PermissionError extends Error {}
const accounts = { valid: testAccount, invalid: invalidAccount };
const requestSchema = z.object({ authorized: z.boolean(), scenarioIds: z.array(z.enum(['valid-login', 'invalid-login', 'deliberate-failure'])).min(1).max(3).refine(ids => new Set(ids).size === ids.length) }).strict();
export const assertionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('url'), expected: z.string().startsWith('/').max(100) }).strict(),
  z.object({ kind: z.literal('visible'), selector: z.string().max(100), expected: z.boolean() }).strict(),
  z.object({ kind: z.literal('text'), selector: z.string().max(100), expected: z.string().max(500) }).strict(),
]);
export const stepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('navigate'), path: z.literal('/login') }).strict(),
  z.object({ kind: z.literal('fill'), selector: z.enum(['#username', '#password']), account: z.enum(['valid', 'invalid']), field: z.enum(['username', 'password']) }).strict(),
  z.object({ kind: z.literal('click'), selector: z.literal('#sign-in') }).strict(),
  z.object({ kind: z.literal('assert'), assertion: assertionSchema }).strict(),
]);
export const planSchema = z.object({ id: z.string().max(100), name: z.string().max(200), steps: z.array(stepSchema).min(2).max(40) }).strict();
const assertionSelectors = new Set(['#dashboard', '#login-status', '#login-error']);

export function summarize(results) {
  const counts = Object.fromEntries(['PASS', 'FAIL', 'BLOCKED', 'INCONCLUSIVE'].map(key => [key, results.filter(run => run.outcome === key).length]));
  const outcome = !results.length ? 'INCONCLUSIVE' : counts.FAIL ? 'FAIL' : counts.BLOCKED ? 'BLOCKED' : counts.INCONCLUSIVE ? 'INCONCLUSIVE' : 'PASS';
  return { outcome, counts, total: results.length };
}

export function redact(value) {
  if (typeof value === 'string') {
    if (value.startsWith('data:image/png;base64,')) return value;
    for (const account of Object.values(accounts)) for (const secret of Object.values(account)) value = value.replaceAll(secret, '[REDACTED]');
    return value;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]));
  return value;
}

/** Enforced immediately before navigation/fill/click, independent of the UI. */
export async function checkPermission({ fixture, authorized, session, step }) {
  if (!isOwnedFixture(fixture) || !authorized) throw new PermissionError('Explicit authorization of the owned controlled fixture is required.');
  if (step.kind === 'navigate') {
    if (session || step.path !== '/login') throw new PermissionError('Only initial navigation to the controlled login page is approved.');
    return;
  }
  if (!session || await session.page.url() !== fixture.origin + '/login' || session.target.origin !== fixture.origin) throw new PermissionError('Action is outside the approved login page.');
  const locator = session.controlledPage.locator(step.selector);
  if (await locator.count() !== 1 || !await locator.isVisible() || !await locator.isEnabled()) throw new PermissionError('Approved element is missing, ambiguous, hidden or disabled.');
  const element = await locator.evaluate(node => ({
    tag: node.tagName, type: node.type, readOnly: Boolean(node.readOnly), name: node.name,
    formId: node.form?.id, method: node.form?.method, action: node.form?.action,
    target: node.getAttribute('formtarget') ?? node.form?.target ?? '',
    override: node.hasAttribute('formaction') || node.hasAttribute('formmethod'),
    baseTarget: node.ownerDocument.querySelector('base')?.target ?? '',
  }));
  if (element.formId !== 'login-form' || element.method !== 'post' || element.action !== fixture.origin + '/login' || element.override || element.baseTarget || (element.target && element.target !== '_self')) throw new PermissionError('Form destination or submission attributes are not approved.');
  if (step.kind === 'fill') {
    if (!accounts[step.account] || step.selector !== '#' + step.field || element.tag !== 'INPUT' || element.name !== step.field || element.type !== (step.field === 'password' ? 'password' : 'text') || element.readOnly) throw new PermissionError('Input is not an approved synthetic credential field.');
  } else if (step.kind !== 'click' || step.selector !== '#sign-in' || element.tag !== 'BUTTON' || element.type !== 'submit') throw new PermissionError('Button is not the approved fixture submit button.');
}

async function checkOrigin(session, fixture) {
  if (!isOwnedFixture(fixture) || session.target.origin !== fixture.origin || new URL(await session.page.url()).origin !== fixture.origin) throw new PermissionError('Browser left the authorized fixture origin.');
}

export async function evaluateAssertion(session, fixture, assertion, timeoutMs = 2000) {
  const expected = assertion.kind === 'url' ? new URL(assertion.expected, fixture.origin).href : assertion.expected;
  if (assertion.kind === 'url' && new URL(expected).origin !== fixture.origin) throw new PermissionError('Assertion URL leaves the approved origin.');
  if (assertion.kind !== 'url' && !assertionSelectors.has(assertion.selector)) throw new PermissionError('Assertion selector is not approved.');
  const deadline = Date.now() + timeoutMs;
  let actual;
  do {
    await checkOrigin(session, fixture);
    if (assertion.kind === 'url') actual = await session.page.url();
    else {
      const locator = session.controlledPage.locator(assertion.selector);
      const count = await locator.count();
      if (count > 1) throw new Error('Ambiguous assertion');
      const visible = count === 1 && await locator.isVisible();
      actual = assertion.kind === 'visible' ? visible : visible ? (await locator.innerText({ timeout: 1000 })).trim() : null;
    }
    if (actual === expected) return { matched: true, expected, actual };
    await delay(100);
  } while (Date.now() < deadline);
  return { matched: false, expected, actual };
}

async function captureEvidence(session, fixture, report, stepNumber) {
  await checkOrigin(session, fixture);
  // Mask all form controls even after partial fills or a failed submission.
  // No raw DOM, input values, cookies or Stagehand envelopes enter reports.
  const screenshot = await maskedExecutionScreenshot(session, 10_000);
  const id = `${report.id}-evidence-${report.evidence.length + 1}`;
  report.evidence.push({ id, stepNumber, url: await session.page.url(), screenshot });
  return id;
}

/** One bounded, sequential plan; every call gets a new browser process/profile. */
export async function runScenario(input, { fixture, authorized, options = {}, openSession = openBrowserSession, assertionTimeoutMs = 2000, checkpoint = async () => {} } = {}) {
  const report = { id: randomUUID(), scenarioId: '', name: 'Scenario', outcome: 'INCONCLUSIVE', startedAt: new Date().toISOString(), steps: [], evidence: [], browserClosed: false, assertionsExecuted: 0 };
  let session, plan;
  try {
    plan = planSchema.parse(input);
    report.scenarioId = plan.id; report.name = plan.name;
    if (plan.steps[0].kind !== 'navigate' || !plan.steps.some(step => step.kind === 'assert') || plan.steps.at(-1).kind !== 'assert') throw new PermissionError('Scenario must start with approved navigation and finish with a required assertion.');
    for (const [index, step] of plan.steps.entries()) {
      const record = { number: index + 1, kind: step.kind, target: step.selector ?? step.path ?? step.assertion?.selector ?? 'URL', outcome: 'INCONCLUSIVE', message: '', expected: step.kind === 'fill' ? '[REDACTED]' : step.kind === 'assert' ? step.assertion.expected : step.kind === 'click' ? 'Approved button clicked' : fixture?.origin + step.path };
      report.steps.push(record);
      let captureAttempted = false;
      try {
        if (step.kind === 'assert') {
          const result = await evaluateAssertion(session, fixture, step.assertion, assertionTimeoutMs);
          report.assertionsExecuted++;
          Object.assign(record, result, { outcome: result.matched ? 'PASS' : 'FAIL', message: result.matched ? 'Expected result verified.' : 'Expected result was not observed before the deadline.' });
        } else {
          await checkPermission({ fixture, authorized, session, step });
          if (step.kind === 'navigate') {
            session = await openSession(fixture.origin + step.path, options);
            await checkOrigin(session, fixture);
            if (session.response && session.response.status() >= 400) throw new Error('Fixture navigation returned an HTTP error');
            // This is a verification, not a reset: a reused profile fails closed.
            if ((await session.context.cookies()).length) throw new PermissionError('Scenario did not start with an empty browser session.');
            report.initialSessionEmpty = true;
            record.actual = await session.page.url();
          } else if (step.kind === 'fill') {
            await session.page.locator(step.selector).fill(accounts[step.account][step.field], { timeout: 5000 });
            record.actual = '[REDACTED]';
          } else {
            await session.page.locator(step.selector).click({ timeout: 5000 });
            // Stagehand click may complete before the form's navigation does.
            await session.controlledPage.waitForURL(url => url.href !== fixture.origin + '/login', { timeout: 5000 });
            record.actual = 'Approved button clicked';
          }
          record.outcome = 'PASS'; record.message = 'Approved browser operation completed.';
        }
        // Evidence on navigation, submission and every assertion, never on fills.
        if (step.kind !== 'fill') {
          captureAttempted = true;
          record.evidenceId = await captureEvidence(session, fixture, report, index + 1);
        }
      } catch (error) {
        // Evidence failure must never erase an already observed assertion failure.
        if (record.outcome !== 'FAIL') record.outcome = error instanceof PermissionError ? 'BLOCKED' : 'INCONCLUSIVE';
        record.message = error instanceof PermissionError ? error.message : 'Browser operation, assertion, or screenshot could not be verified.';
        if (session && !captureAttempted) {
          try { record.evidenceId = await captureEvidence(session, fixture, report, index + 1); }
          catch { record.message += ' Failure screenshot unavailable.'; }
        }
      }
      if (record.outcome === 'FAIL') report.outcome = 'FAIL';
      await checkpoint(redact(report));
      if (record.outcome !== 'PASS') break;
    }
    const executed = report.steps.length === plan.steps.length;
    report.outcome = report.steps.some(step => step.outcome === 'FAIL') ? 'FAIL' : report.steps.some(step => step.outcome === 'BLOCKED') ? 'BLOCKED' : executed && report.assertionsExecuted > 0 && report.steps.every(step => step.outcome === 'PASS') ? 'PASS' : 'INCONCLUSIVE';
    for (let index = report.steps.length; index < plan.steps.length; index++) report.steps.push({ number: index + 1, kind: plan.steps[index].kind, outcome: 'NOT RUN', message: 'Not executed because an earlier step stopped the scenario.' });
  } catch (error) {
    if (report.outcome !== 'FAIL') report.outcome = error instanceof PermissionError || error instanceof z.ZodError ? 'BLOCKED' : 'INCONCLUSIVE';
    report.message = error instanceof PermissionError ? error.message : 'Scenario could not be validated or started.';
  } finally {
    try { if (session) { await session.close(); report.browserClosed = true; } }
    catch { if (report.outcome !== 'FAIL') report.outcome = 'INCONCLUSIVE'; report.message = 'Browser cleanup failed.'; }
    report.completedAt = new Date().toISOString();
  }
  return redact(report);
}

export async function runScenarioSuite(input, options = {}) {
  let fixture;
  let result;
  const reports = [];
  try {
    const request = requestSchema.parse(input);
    if (!request.authorized) return { outcome: 'BLOCKED', message: 'Authorize controlled fixture submissions before running scenarios.', reports, summary: { ...summarize(reports), outcome: 'BLOCKED' } };
    fixture = await startControlledFixture();
    const plans = loginScenarios();
    for (const id of request.scenarioIds) reports.push(await runScenario(plans.find(plan => plan.id === id), { fixture, authorized: true, options }));
    const summary = summarize(reports);
    result = { outcome: summary.outcome, message: 'Controlled scenarios finished. Deliberate failure is expected to report FAIL.', reports, summary };
  } catch {
    const outcome = !requestSchema.safeParse(input).success ? 'BLOCKED' : 'INCONCLUSIVE';
    result = { outcome, message: 'Scenario request was invalid or the controlled fixture could not start.', reports, summary: { ...summarize(reports), outcome } };
  } finally {
    try { await fixture?.close(); }
    catch { result = { outcome: 'INCONCLUSIVE', message: 'Controlled fixture cleanup failed.', reports, summary: { ...summarize(reports), outcome: 'INCONCLUSIVE' } }; }
  }
  return result;
}
