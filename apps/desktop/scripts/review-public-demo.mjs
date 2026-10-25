import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { openBrowserSession } from '../electron/browser.mjs';
import { inspectAction } from '../electron/action-policy.mjs';

// Complete the review of the actual proposals; never manufacture executable plans.
const root = fileURLToPath(new URL('../../..', import.meta.url));
const path = root + '/validation/desktop-m7.1-public.json';
const receipt = JSON.parse(readFileSync(path, 'utf8'));
const origin = receipt.origin, directory = root + '/test-results/desktop-live/m7.1';
const env = { ...process.env, QASPIDER_DESKTOP_PROVIDER: 'none', QASPIDER_DESKTOP_HEADLESS: '1', QASPIDER_DESKTOP_DATA_DIR: root + '/.qaspider/desktop-m7.1' }; delete env.ELECTRON_RUN_AS_NODE;
let app;
const started = performance.now();
try {
  // One evidence-only retry corrects the harness's overly strict accessible name.
  for (const route of ['/login', '/upload']) {
    if (receipt.captures.some(item => item.path === route && item.purpose === 'Evidence retry; no control activated' && item.httpStatus === 200)) continue;
    const start = performance.now();
    const session = await openBrowserSession(origin + route, { headless: true, requestPolicy: url => new URL(url).origin === origin });
    try {
      const page = session.controlledPage;
      const mask = [page.locator('input:not([type="submit"]),textarea')];
      if (route === '/login') {
        mask.push(page.getByRole('heading', { level: 4 }));
        const selector = await page.getByRole('button', { name: /Login/ }).evaluate(node => node.id ? '#' + CSS.escape(node.id) : node.tagName.toLowerCase());
        receipt.loginPolicy = (await inspectAction(session, { selector, method: 'click', arguments: [] })).policy;
      }
      const screenshot = `test-results/desktop-live/m7.1/${route === '/login' ? 'login-masked' : 'upload-preflight'}.png`;
      await page.screenshot({ path: root + '/' + screenshot, mask, maskColor: '#18283b' });
      receipt.captures.push({ path: route, httpStatus: session.response?.status(), screenshot, durationMs: performance.now() - start, purpose: 'Evidence retry; no control activated',
        ...(route === '/upload' ? { fileControlVisible: await page.locator('input[type="file"]').first().isVisible(), uploadActionVisible: await page.locator('input[type="submit"]').isVisible() } : {}) });
    } finally { await session.close(); }
  }
  app = await electron.launch({ args: [root + '/apps/desktop'], env });
  let window = await app.firstWindow();
  const invoke = (method, input) => window.evaluate(({ method, input }) => window.qaspider[method](input), { method, input });
  for (const ticket of receipt.tickets) {
    if (!ticket.review) continue;
    let saved = (await invoke('getPlan', { planId: ticket.review.planId })).value;
    async function mutate(action) {
      const response = await invoke('reviewPlan', { planId: saved.planId, revision: saved.revision, version: saved.version, action });
      assert.equal(response.status, 'ok'); saved = response.value;
    }
    if (ticket.title.includes('B —')) {
      if (saved.status === 'DRAFT') await mutate({ type: 'start-review' });
      ticket.reviewOutcome = 'BLOCKED';
      ticket.reviewReason = 'Initial controls were discovered, but scenario-specific initial states and complete polling/input-entry setup remain unverified. Do not confirm unresolved assumptions merely to approve.';
      ticket.review = saved;
      continue;
    }
    if (saved.status !== 'APPROVED') {
    for (const assumption of saved.original.assumptions) if (saved.content.assumptions.find(item => item.id === assumption.id)?.decision !== 'confirmed') await mutate({ type: 'assumption', id: assumption.id, decision: 'confirmed', note: ticket.title.includes('A —')
      ? 'Reviewed test setup: public demo credentials are documented without copying them; success means visibly reaching the secure area; each future run requires a fresh unauthenticated profile. Submission remains blocked by policy and no runtime behavior is claimed.'
      : 'Confirmed the supplied public upload URL loads and exposes file-selection and upload controls. Only inspection is authorized; no file selection or submission.' });
    if (saved.status === 'DRAFT') await mutate({ type: 'start-review' });
    for (const criterion of saved.coverage) await mutate({ type: 'criterion', criterionId: criterion.criterionId, confirmed: true, note: 'Reviewed the linked conceptual expectations against the supplied criterion. Coverage approval does not claim execution or override compatibility and safety checks.' });
    await mutate({ type: 'approve', hash: saved.hash });
    }
    ticket.review = saved;
    const identity = { planId: saved.planId, revision: saved.revision, version: saved.version, hash: saved.hash };
    const preparation = await invoke('preparePlan', { ...identity, url: origin });
    assert.equal(preparation.status, 'ok'); assert.equal(preparation.value.origin, origin);
    ticket.preparation = preparation.value;
    const start = performance.now();
    const result = await invoke('executePlan', { ...identity, preparationId: preparation.value.preparationId, environment: preparation.value.environment, origin, authorized: true });
    assert.equal(result.status, 'ok'); assert.equal(result.value.outcome, 'BLOCKED');
    assert(result.value.scenarios.every(scenario => !scenario.result));
    ticket.execution = result.value; ticket.executionDurationMs = performance.now() - start;
  }
  const knowledgeBefore = await invoke('listKnowledge', '');
  const plansBefore = await invoke('listPlans');
  await app.close(); app = await electron.launch({ args: [root + '/apps/desktop'], env }); window = await app.firstWindow();
  const knowledgeAfter = await invoke('listKnowledge', '');
  assert.deepEqual(knowledgeAfter, knowledgeBefore); assert.deepEqual(await invoke('listPlans'), plansBefore);
  receipt.reviewRestart = { actualElectronRestart: true, approvedPlansPersisted: true, knowledgeBefore, knowledgeAfter, reuseMeasurement: null, reason: 'No completed passing approved public workflow exists to verify or reuse.' };
  await window.screenshot({ path: directory + '/desktop-reviewed.png' });
} finally {
  await app?.close(); receipt.reviewDurationMs = performance.now() - started; writeFileSync(path, JSON.stringify(receipt, null, 2) + '\n');
}
console.log(JSON.stringify({ reviewed: true, receipt: 'validation/desktop-m7.1-public.json', durationMs: receipt.reviewDurationMs }));
