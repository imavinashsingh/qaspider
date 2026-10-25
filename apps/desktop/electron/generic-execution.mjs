import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { openBrowserSession } from './browser.mjs';
import { isOwnedFixture } from './controlled-fixture.mjs';
import { isExecutionTarget } from './execution-target.mjs';
import { redact } from './scenario-runner.mjs';
import { testAccount, invalidAccount } from '../demo/credentials.mjs';

const text = z.string().trim().min(1).max(1000);
const path = text.refine(value => /^\/(?!\/)/.test(value) && !/[?#\\]/.test(value), 'Use an explicit local path without query or fragment.');
const target = z.object({ selector: text.optional(), label: text.optional(), role: z.enum(['button', 'link', 'textbox', 'combobox']).optional(), alternatives: z.array(text).max(5).default([]) }).strict().refine(value => value.selector || value.label, 'Declare a selector or label.');
export const genericAssertionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('url'), expected: text }).strict(),
  z.object({ kind: z.literal('visible'), selector: text, expected: z.boolean() }).strict(),
  z.object({ kind: z.literal('enabled'), selector: text, expected: z.boolean() }).strict(),
  z.object({ kind: z.literal('text'), selector: text, expected: text, present: z.boolean().default(true) }).strict(),
]);
export const genericStepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('NAVIGATE'), path }).strict(),
  z.object({ kind: z.literal('OBSERVE'), instruction: text }).strict(),
  z.object({ kind: z.literal('FILL'), target, value: z.string().max(1000) }).strict(),
  z.object({ kind: z.literal('CLICK'), target }).strict(),
  z.object({ kind: z.literal('SELECT'), target, value: text }).strict(),
  z.object({ kind: z.literal('ASSERT_VISIBLE'), selector: text, expected: z.boolean() }).strict(),
  z.object({ kind: z.literal('ASSERT_TEXT'), selector: text, expected: text, present: z.boolean().default(true) }).strict(),
  z.object({ kind: z.literal('ASSERT_URL'), expected: text }).strict(),
  z.object({ kind: z.literal('ASSERT_ENABLED'), selector: text, expected: z.boolean() }).strict(),
  z.object({ kind: z.literal('CAPTURE_EVIDENCE') }).strict(),
  z.object({ kind: z.literal('assert'), assertion: genericAssertionSchema }).strict(),
]);
export const genericPlanSchema = z.object({ id: text, name: text, steps: z.array(genericStepSchema).min(2).max(40) }).strict();
export class SafetyError extends Error {}
const deny = message => { throw new SafetyError(message); };
const assertionOf = step => step.kind === 'assert' ? step.assertion : step.kind.startsWith('ASSERT_') ? genericAssertionSchema.parse({ kind: step.kind.slice(7).toLowerCase().replace('visible', 'visible'), ...Object.fromEntries(Object.entries(step).filter(([key]) => key !== 'kind')) }) : null;

// Legacy data is explicit synthetic account binding, never inferred credentials.
export function normalizePlan(input) {
  return genericPlanSchema.parse({ ...input, steps: input.steps.map(step => {
    if (step.kind === 'navigate') return { kind: 'NAVIGATE', path: step.path };
    if (step.kind === 'click') return { kind: 'CLICK', target: { selector: step.selector } };
    if (step.kind === 'fill') {
      const account = { valid: testAccount, invalid: invalidAccount }[step.account];
      if (!account || !['username', 'password'].includes(step.field)) deny('Unknown synthetic credential binding.');
      return { kind: 'FILL', target: { selector: step.selector }, value: account[step.field] };
    }
    return step;
  }) });
}
export function permittedUrl(value, fixture) {
  const url = new URL(value, fixture.origin);
  if (url.origin !== fixture.origin || url.username || url.password || (fixture.paths && !fixture.paths.includes(url.pathname))) deny('URL is outside the selected application scope.');
  return url;
}
const directLocator = (page, spec) => spec.selector ? page.locator(spec.selector) : spec.role ? page.getByRole(spec.role, { name: spec.label, exact: true }) : page.getByLabel(spec.label, { exact: true });
const names = async locator => locator.evaluate(node => [node.getAttribute('aria-label'), node.textContent?.trim(), ...Array.from(node.labels ?? [], label => label.textContent?.trim())].filter(Boolean));
async function unique(locator) {
  const count = await locator.count();
  if (count > 1) deny('Target is ambiguous; no adaptation is permitted.');
  return count === 1 && await locator.isVisible();
}

/** Observation is a proposal, never a capability to execute an arbitrary method. */
export async function resolveTarget(session, step, { modelAvailable, adaptations, budget }) {
  let locator = directLocator(session.controlledPage, step.target);
  if (await unique(locator)) {
    if (step.target.label && !(await names(locator)).includes(step.target.label)) deny('Selector and approved label disagree.');
    return { locator, selector: step.target.selector ?? step.target.label };
  }
  if (!step.target.label || !step.target.alternatives.length) deny('Missing target; approved alternative meanings are required for adaptation.');
  if (!modelAvailable) deny('AI provider unavailable; missing target cannot be adapted.');
  if (++budget.observations > 2) deny('Observation budget exhausted.');
  const method = { CLICK: 'click', FILL: 'fill', SELECT: 'selectOption' }[step.kind];
  const instruction = `Find the ${step.target.role ?? 'control'} for ${step.target.label}. Approved equivalent names: ${step.target.alternatives.join(', ')}. Propose only ${method}; do not act.`;
  const result = await (budget.observe ? budget.observe(session, instruction) : session.stagehand.observe(instruction, { page: session.page, cache: false, timeout: 15_000 }));
  if (!Array.isArray(result.data) || result.data.length > 20) deny('Invalid observation.');
  const candidates = [];
  for (const proposal of result.data) {
    if (proposal.method !== method || typeof proposal.selector !== 'string' || proposal.selector.length > 1000 || !Array.isArray(proposal.arguments) || (method === 'click' && proposal.arguments.length)) continue;
    const candidate = session.controlledPage.locator(proposal.selector);
    if (!await unique(candidate)) continue;
    const actualNames = await names(candidate);
    if (actualNames.some(name => [step.target.label, ...step.target.alternatives].includes(name))) {
      const handle = await candidate.elementHandle();
      if (!(await Promise.all(candidates.map(item => item.locator.evaluate((node, other) => node === other, handle)))).some(Boolean)) candidates.push({ locator: candidate, selector: proposal.selector });
      await handle?.dispose();
    }
  }
  if (candidates.length !== 1) deny('Observation did not establish one compatible approved target.');
  const selected = candidates[0];
  adaptations.push({ requested: step.target.label, permittedNames: step.target.alternatives, resolvedSelector: selected.selector, actualNames: await names(selected.locator), method, observedAt: new Date().toISOString(), reason: 'Unique observed control has an explicitly approved equivalent name.' });
  return selected;
}

async function gate(session, fixture, authorized, step, locator) {
  if (!isExecutionTarget(fixture) || !authorized) deny('Explicit approval of the selected application origin is required.');
  permittedUrl(await session.page.url(), fixture);
  if (!await unique(locator) || !await locator.isEnabled()) deny('Target is missing, hidden, ambiguous or disabled.');
  const handle = await locator.elementHandle({ timeout: 2000 });
  if (!handle || !await handle.isVisible() || !await handle.isEnabled()) deny('Target disappeared before execution.');
  const element = await handle.evaluate(node => ({ names: [node.getAttribute('aria-label'), node.textContent?.trim(), ...Array.from(node.labels ?? [], label => label.textContent?.trim())].filter(Boolean), tag: node.tagName, type: node.type, readOnly: node.readOnly,
    href: node.getAttribute('href'), target: node.getAttribute('target') ?? node.form?.target ?? '',
    download: node.hasAttribute('download'), override: node.hasAttribute('formaction') || node.hasAttribute('formmethod'),
    action: node.form?.action, base: Boolean(node.ownerDocument.querySelector('base')), editable: node.isContentEditable }));
  if (step.target.label && !element.names.some(name => [step.target.label, ...step.target.alternatives].includes(name))) deny('Target meaning changed before execution.');
  if (element.base || element.override || element.download || (element.target && element.target !== '_self') || element.editable) deny('Unsupported control destination or behavior.');
  if (element.action) permittedUrl(element.action, fixture);
  if (step.kind === 'FILL' && (!['INPUT', 'TEXTAREA'].includes(element.tag) || element.readOnly || ['file', 'hidden', 'submit', 'button', 'checkbox', 'radio'].includes(element.type))) deny('Unsupported fill control.');
  if (step.kind === 'SELECT' && element.tag !== 'SELECT') deny('Only native select controls are supported.');
  if (step.kind === 'CLICK') {
    if (!['BUTTON', 'A'].includes(element.tag)) deny('Only links and buttons can be clicked.');
    if (!isOwnedFixture(fixture) && element.tag === 'BUTTON' && element.action && element.type === 'submit') deny('Form submission on user-selected applications is not supported by the current action policy.');
    if (element.tag === 'A') { if (!element.href) deny('Link has no approved destination.'); permittedUrl(element.href, fixture); }
  }
  return handle;
}
export async function measureAssertion(session, fixture, assertion, timeoutMs = 1500) {
  const expected = assertion.kind === 'url' ? permittedUrl(assertion.expected, fixture).href : assertion.expected;
  const deadline = Date.now() + timeoutMs;
  let actual, matched = false;
  do {
    permittedUrl(await session.page.url(), fixture);
    if (assertion.kind === 'url') actual = await session.page.url();
    else {
      const locator = session.controlledPage.locator(assertion.selector), count = await locator.count();
      if (count > 1) deny('Assertion selector is ambiguous.');
      const visible = count === 1 && await locator.isVisible();
      actual = assertion.kind === 'visible' ? visible : assertion.kind === 'enabled' ? count === 1 ? await locator.isEnabled() : null : visible ? (await locator.innerText({ timeout: 1000 })).trim() : null;
    }
    matched = assertion.kind === 'text' && assertion.present === false ? actual === null || !actual.includes(expected) : actual === expected;
    if (matched) break;
    await delay(75);
  } while (Date.now() < deadline);
  return { expected, actual, matched };
}

/** Fresh browser per scenario. Never retries business actions or rewrites expectations. */
export async function runGenericScenario(input, { fixture, authorized, options = {}, openSession = openBrowserSession, checkpoint = async () => {}, assertionTimeoutMs = 1500, maxDurationMs = 90_000, memory = null } = {}) {
  const report = { id: randomUUID(), scenarioId: input?.id, name: input?.name, outcome: 'INCONCLUSIVE', steps: [], adaptations: [], evidence: [], assertionsExecuted: 0, browserClosed: false, startedAt: new Date().toISOString() };
  const secrets = [testAccount, invalidAccount].flatMap(Object.values);
  for (const step of input?.steps ?? []) if (step.kind === 'FILL' && typeof step.value === 'string' && step.value) secrets.push(step.value);
  const sanitize = value => {
    if (typeof value === 'string') { if (value.startsWith('data:image/png;base64,')) return value; for (const secret of secrets) value = value.replaceAll(secret, '[REDACTED]'); return value; }
    if (Array.isArray(value)) return value.map(sanitize);
    return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, ['outcome', 'status', 'kind', 'method', 'classification'].includes(key) ? item : sanitize(item)])) : value;
  };
  let session, timer, plan, expired = false;
  const knowledge = report.knowledge = { revisionId: memory?.id ?? null, steps: [], findings: [], metrics: { reusedSteps: 0, discoveryCalls: 0, aiCalls: 0, totalTokens: 0, tokenUsageComplete: true, discoveryMs: 0, durationMs: 0 } };
  const started = performance.now();
  const model = options.model;
  if (model) options = { ...options, model: { ...model, generate: async (...args) => {
    knowledge.metrics.aiCalls++;
    try {
      const response = await model.generate(...args);
      if (Number.isFinite(response.usage?.totalTokens)) knowledge.metrics.totalTokens += response.usage.totalTokens;
      else knowledge.metrics.tokenUsageComplete = false;
      return response;
    } catch (error) { knowledge.metrics.tokenUsageComplete = false; throw error; }
  } } };
  const budget = { observations: 0, observe: async (current, instruction) => {
    const start = performance.now(), callsBefore = knowledge.metrics.aiCalls; knowledge.metrics.discoveryCalls++;
    try {
      const result = await current.stagehand.observe(instruction, { page: current.page, cache: false, timeout: 15_000 });
      const usage = result.metadata?.usage;
      if (knowledge.metrics.aiCalls === callsBefore) {
        if (Number.isFinite(usage?.inputTokens) && Number.isFinite(usage?.outputTokens) && usage.inputTokens + usage.outputTokens > 0) knowledge.metrics.totalTokens += usage.inputTokens + usage.outputTokens;
        else knowledge.metrics.tokenUsageComplete = false;
      }
      return result;
    } catch (error) { knowledge.metrics.tokenUsageComplete = false; throw error; }
    finally { knowledge.metrics.discoveryMs += performance.now() - start; }
  } };
  const route = async () => { const url = permittedUrl(await session.page.url(), fixture); return url.pathname; };
  const fingerprint = async locator => createHash('sha256').update(JSON.stringify(await locator.evaluate(node => ({ tag: node.tagName, type: node.type ?? '', disabled: Boolean(node.disabled), readOnly: Boolean(node.readOnly), href: node.getAttribute('href'), action: node.form?.getAttribute('action'), target: node.getAttribute('target'), override: node.getAttribute('formaction'), names: [node.getAttribute('aria-label'), ...Array.from(node.labels ?? [], label => label.textContent?.trim()), ...(['BUTTON','A'].includes(node.tagName) ? [node.textContent?.trim()] : [])].filter(Boolean) })))).digest('hex');
  async function capture(record) {
    permittedUrl(await session.page.url(), fixture);
    const bytes = await session.controlledPage.screenshot({ type: 'png', timeout: 5000, mask: [session.controlledPage.locator('input, textarea, select')], maskColor: '#18283b' });
    const id = `${report.id}-${record.number}`;
    report.evidence.push({ id, stepNumber: record.number, url: await session.page.url(), screenshot: 'data:image/png;base64,' + Buffer.from(bytes).toString('base64') });
    record.evidenceId = id;
    const adaptation = report.adaptations.at(-1); if (adaptation && !adaptation.evidenceId) adaptation.evidenceId = id;
  }
  try {
    plan = normalizePlan(input);
    if (!isExecutionTarget(fixture) || !authorized) deny('Explicit selected application-origin authorization is required.');
    if (plan.steps[0].kind !== 'NAVIGATE' || plan.steps.filter(step => step.kind === 'NAVIGATE').length !== 1 || !assertionOf(plan.steps.at(-1))) deny('Start with one navigation and finish with an explicit assertion.');
    // Validate ALL URLs and assertions before opening the browser.
    for (const step of plan.steps) { if (step.kind === 'NAVIGATE') permittedUrl(step.path, fixture); const assertion = assertionOf(step); if (assertion?.kind === 'url') permittedUrl(assertion.expected, fixture); }
    timer = setTimeout(() => { expired = true; void session?.close().catch(() => {}); }, maxDurationMs); timer.unref?.();
    for (const [index, step] of plan.steps.entries()) {
      const assertion = assertionOf(step);
      const record = { number: index + 1, kind: step.kind, target: step.target?.label ?? step.target?.selector ?? step.path ?? step.selector, expected: step.kind === 'FILL' ? '[REDACTED]' : assertion?.expected, outcome: 'INCONCLUSIVE', message: '' };
      report.steps.push(record);
      const learned = { number: index + 1, kind: step.kind };
      knowledge.steps.push(learned);
      try {
        if (expired) throw new Error('Scenario deadline exceeded.');
        if (step.kind === 'NAVIGATE') {
          session = await openSession(permittedUrl(step.path, fixture).href, { ...options, requestPolicy: url => {
            try { permittedUrl(url, fixture); return true; } catch { return false; }
          } });
          if (expired) { await session.close(); throw new Error('Scenario deadline exceeded during startup.'); }
          if (session.response?.status() >= 400) throw new Error('Navigation failed.');
          if ((await session.context.cookies()).length) deny('Browser session was not empty.');
          report.initialSessionEmpty = true;
        } else if (assertion) {
          const measured = await measureAssertion(session, fixture, assertion, assertionTimeoutMs);
          report.assertionsExecuted++;
          Object.assign(record, measured); record.outcome = measured.matched ? 'PASS' : 'FAIL';
        } else if (step.kind === 'OBSERVE') {
          if (!options.model) deny('AI provider unavailable.');
          if (++budget.observations > 2) deny('Observation budget exhausted.');
          const result = await budget.observe(session, step.instruction);
          if (!Array.isArray(result.data) || result.data.length > 20) deny('Invalid observation.');
          record.actual = `Observed ${result.data.length} proposals; no action authorized by observation.`;
        } else if (step.target) {
          let resolved;
          const previous = memory?.steps.find(item => item.number === record.number);
          if (previous?.selector && knowledge.findings.length === 0) {
            const locator = session.controlledPage.locator(previous.selector);
            let valid = false;
            try { valid = previous.kind === step.kind && previous.before?.path === await route() && await unique(locator) && previous.before?.fingerprint === await fingerprint(locator); } catch {}
            if (valid) { resolved = { locator, selector: previous.selector }; record.knowledgeReused = true; }
            else {
              // Capture before any observation or replacement operation. This evidence never gets overwritten.
              await capture({ number: `${record.number}-divergence` });
              knowledge.findings.push({ revisionId: memory.id, stepNumber: record.number, evidenceId: report.evidence.at(-1).id, reason: 'Verified target or prerequisite diverged before action; human review required.' });
              await checkpoint(sanitize(report));
              if (!step.target.label) deny('Changed selector-only operation has no approved meaning for adaptation; revise the plan before execution.');
            }
          }
          resolved ??= await resolveTarget(session, step, { modelAvailable: Boolean(options.model), adaptations: report.adaptations, budget });
          // Revalidate after model response and immediately before deterministic execution.
          const handle = await gate(session, fixture, authorized, step, resolved.locator);
          learned.selector = resolved.selector;
          // Accessible labels are represented as deterministic selectors for later replay.
          if (!step.target.selector && !report.adaptations.some(item => item.resolvedSelector === resolved.selector) && !record.knowledgeReused) {
            learned.selector = await handle.evaluate(node => {
              if (node.id) return '#' + CSS.escape(node.id);
              const parts = []; let current = node;
              while (current && current.tagName !== 'HTML') { const tag = current.tagName.toLowerCase(); const siblings = [...current.parentElement.children].filter(item => item.tagName === current.tagName); parts.unshift(tag + ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')'); current = current.parentElement; }
              return 'html > ' + parts.join(' > ');
            });
          }
          learned.before = { path: await route(), fingerprint: await fingerprint(resolved.locator) };
          record.resolvedTarget = resolved.selector;
          if (step.kind === 'FILL') await handle.fill(step.value, { timeout: 4000 });
          else if (step.kind === 'SELECT') {
            const count = await resolved.locator.locator('option').evaluateAll((nodes, value) => nodes.filter(node => node.value === value).length, step.value);
            if (count !== 1) deny('Approved option value is missing or ambiguous.');
            await handle.selectOption(step.value, { timeout: 4000 });
          } else await handle.click({ timeout: 4000 });
          await handle.dispose();
          if (record.knowledgeReused) knowledge.metrics.reusedSteps++;
          record.actual = step.kind === 'FILL' ? '[REDACTED]' : 'Approved operation completed';
        }
        permittedUrl(await session.page.url(), fixture);
        learned.after = { path: await route() };
        const previous = memory?.steps.find(item => item.number === record.number);
        if (record.knowledgeReused && previous?.after?.path !== learned.after.path) {
          await capture({ number: `${record.number}-divergence` });
          knowledge.findings.push({ revisionId: memory.id, stepNumber: record.number, evidenceId: report.evidence.at(-1).id, reason: 'Post-action route diverged; stopped without retry. Human review required.' });
          deny('Verified post-action route changed; no action retry is permitted.');
        }
        if (session.policyViolations?.length) deny('Browser attempted a resource outside the permitted test paths.');
        if (expired) throw new Error('Scenario deadline exceeded.');
        if (record.outcome !== 'FAIL') record.outcome = 'PASS';
        record.message = record.outcome === 'FAIL' ? 'Approved expectation was not observed.' : 'Operation or assertion verified.';
        await capture(record);
        learned.evidenceId = record.evidenceId;
        if (record.outcome === 'FAIL' && memory && !knowledge.findings.some(item => item.stepNumber === record.number)) knowledge.findings.push({ revisionId: memory.id, stepNumber: record.number, evidenceId: record.evidenceId, reason: 'Original approved assertion failed against remembered workflow. Human review required.' });
      } catch (error) {
        if (record.outcome !== 'FAIL') record.outcome = error instanceof SafetyError ? 'BLOCKED' : 'INCONCLUSIVE';
        record.message = error instanceof SafetyError ? error.message : 'Browser, observation, timeout or evidence failure.';
        if (session && !record.evidenceId) try { await capture(record); } catch {}
        learned.evidenceId = record.evidenceId;
        if (memory && record.evidenceId && !knowledge.findings.some(item => item.stepNumber === record.number)) knowledge.findings.push({ revisionId: memory.id, stepNumber: record.number, evidenceId: record.evidenceId, reason: 'Remembered workflow could not complete verification. Stopped without retry; human review required.' });
      }
      if (record.outcome === 'FAIL') report.outcome = 'FAIL';
      await checkpoint(sanitize(report));
      if (record.outcome !== 'PASS') break;
    }
    report.outcome = report.steps.some(step => step.outcome === 'FAIL') ? 'FAIL' : report.steps.some(step => step.outcome === 'BLOCKED') ? 'BLOCKED' : report.steps.length === plan.steps.length && report.assertionsExecuted > 0 && report.steps.every(step => step.outcome === 'PASS') && report.evidence.length > 0 ? 'PASS' : 'INCONCLUSIVE';
  } catch (error) {
    if (report.outcome !== 'FAIL') report.outcome = error instanceof SafetyError || error instanceof z.ZodError ? 'BLOCKED' : 'INCONCLUSIVE';
    report.message = error instanceof SafetyError ? error.message : 'Scenario validation or persistence failed.';
  } finally {
    clearTimeout(timer);
    if (plan) for (let index = report.steps.length; index < plan.steps.length; index++) report.steps.push({ number: index + 1, kind: plan.steps[index].kind, outcome: 'NOT RUN', message: 'An earlier operation stopped execution.' });
    try { if (session) { await session.close(); report.browserClosed = true; } }
    catch { if (report.outcome !== 'FAIL') report.outcome = 'INCONCLUSIVE'; }
    report.completedAt = new Date().toISOString();
    knowledge.metrics.durationMs = performance.now() - started;
    if (!knowledge.metrics.tokenUsageComplete) knowledge.metrics.totalTokens = null;
  }
  return redact(sanitize(report));
}
