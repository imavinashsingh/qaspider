import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { openBrowserSession, validateTarget } from './browser.mjs';
import { inspectAction, readAssertion, validateAssertion } from './action-policy.mjs';

const observeInput = z.object({ url: z.string().max(4096), instruction: z.string().trim().min(1).max(4000) }).strict();
const executeInput = z.object({ observationId: z.string().uuid(), actionId: z.string().uuid(), authorized: z.boolean(), expected: z.unknown() }).strict();
const fingerprint = element => createHash('sha256').update(JSON.stringify(element)).digest('hex');

/** One browser and one set of proposals, not a workflow/orchestration engine. */
export class TestingWorkspace {
  constructor({ provider, options = {}, openSession = openBrowserSession, idleMs = 300_000 } = {}) {
    this.provider = provider; this.options = options; this.openSession = openSession; this.idleMs = idleMs;
    this.session = null; this.records = new Map(); this.idleTimer = null; this.observationId = null;
  }
  get hasSession() { return Boolean(this.session); }
  async close() {
    clearTimeout(this.idleTimer); this.records.clear(); this.observationId = null;
    this.inferenceAbort?.abort();
    await this.inference?.catch(() => {});
    const session = this.session; this.session = null;
    await session?.close();
  }
  async evidence() {
    if (!this.session) return {};
    return { visitedUrl: await this.session.page.url(), screenshot: await this.session.screenshot() };
  }
  async observe(input) {
    await this.close();
    let session;
    let phase = 'validation';
    try {
      const request = observeInput.parse(input); validateTarget(request.url);
      phase = 'provider';
      if (!this.provider) throw new Error('AI observation unavailable: no compatible model is configured.');
      const provider = await this.provider.prepare();
      this.inferenceAbort = new AbortController();
      phase = 'navigation';
      session = await this.openSession(request.url, { ...this.options, model: { generate: request => {
        const pending = this.provider.generate(request, this.inferenceAbort.signal);
        this.inference = pending;
        return pending.finally(() => { if (this.inference === pending) this.inference = null; });
      } } });
      this.session = session;
      if (session.response && session.response.status() >= 400) throw new Error('Application returned HTTP ' + session.response.status());
      phase = 'observation';
      const result = await session.stagehand.observe(request.instruction, { page: session.page, cache: false, timeout: 100_000 });
      if (!Array.isArray(result.data) || result.data.length > 50) throw new Error('Stagehand returned an invalid or oversized action list.');
      this.observationId = randomUUID();
      const observedUrl = await session.page.url();
      if (new URL(observedUrl).origin !== session.target.origin) throw new Error('Observation left the allowed origin.');
      this.observedUrl = observedUrl;
      this.navigationVersion = 0;
      session.controlledPage.on('framenavigated', frame => { if (frame === session.controlledPage.mainFrame()) this.navigationVersion++; });
      const actions = [];
      for (const action of result.data) {
        const id = randomUUID();
        try {
          const inspected = await inspectAction(session, action);
          this.records.set(id, { action, ...inspected, fingerprint: fingerprint(inspected.element) });
          actions.push({ id, ...action, details: inspected.element.text, allowed: inspected.policy.allowed, requiresAuthorization: inspected.policy.requiresAuthorization ?? false, reason: inspected.policy.reason });
        } catch {
          actions.push({ id, ...action, allowed: false, requiresAuthorization: false, reason: 'Element could not be uniquely validated in the current main page.' });
        }
      }
      const evidence = await this.evidence();
      this.idleTimer = setTimeout(() => { void this.close().catch(() => {}); }, this.idleMs); this.idleTimer.unref?.();
      return { status: 'observed', message: `Discovered ${actions.length} action(s). Select one and declare an expected result.`, observationId: this.observationId, actions, provider, ...evidence };
    } catch (error) {
      let evidence = {}; try { evidence = await this.evidence(); } catch {}
      let cleanup = ''; try { await this.close(); } catch { cleanup = ' Browser cleanup failed.'; }
      const prefix = phase === 'navigation' || phase === 'validation' ? 'Observation could not start: ' : 'AI observation unavailable: ';
      const detail = String(error.message);
      return { status: phase === 'navigation' || phase === 'validation' ? 'error' : 'unavailable', outcome: 'INCONCLUSIVE', message: `${detail.startsWith(prefix) ? '' : prefix}${detail}${cleanup}`, ...evidence };
    }
  }
  async execute(input) {
    const run = { id: randomUUID(), timestamp: new Date().toISOString(), outcome: 'BLOCKED', message: 'Action rejected.', action: null, assertion: null };
    clearTimeout(this.idleTimer);
    try {
      const request = executeInput.parse(input);
      if (!this.session || request.observationId !== this.observationId) throw new Error('Observation expired. Observe the page again.');
      const session = this.session, record = this.records.get(request.actionId);
      if (!record || !record.policy.allowed) throw new Error('Action is not in the validated observation.');
      run.action = record.action;
      run.assertion = validateAssertion(request.expected, session.target.origin);
      const url = await session.page.url();
      if (new URL(url).origin !== session.target.origin || url !== this.observedUrl || this.navigationVersion !== 0) throw new Error('Page navigated since observation. Observe again.');
      const current = await inspectAction(session, record.action);
      if (!current.policy.allowed || fingerprint(current.element) !== record.fingerprint || !await current.locator.evaluate((node, original) => node === original, record.handle)) throw new Error('Action element changed since observation. Observe again.');
      if (current.policy.requiresAuthorization && !request.authorized) throw new Error('Explicit authorization is required for this potentially state-changing click.');
      run.outcome = 'INCONCLUSIVE';
      const before = await readAssertion(session, run.assertion);
      run.before = before;
      if (before.matched) {
        run.outcome = 'INCONCLUSIVE'; run.message = 'Expected result already holds. No action was executed; this cannot establish an action outcome.';
      } else {
        // No natural-language act, no self-healing, no model-selected replacement.
        run.outcome = 'INCONCLUSIVE';
        const result = await session.stagehand.act(record.action, { page: session.page, timeout: 15_000 });
        run.execution = result;
        if (new URL(await session.page.url()).origin !== session.target.origin) throw new Error('Action left the allowed application origin.');
        const deadline = Date.now() + 4000;
        let assertion;
        do { assertion = await readAssertion(session, run.assertion); if (assertion.matched) break; await delay(100); } while (Date.now() < deadline);
        run.actual = assertion.actual;
        run.outcome = result.data?.success !== true ? 'INCONCLUSIVE' : assertion.matched ? 'PASS' : 'FAIL';
        run.message = result.data?.success !== true ? 'Stagehand did not confirm action execution.' : assertion.matched ? 'Declared expectation was verified after the action.' : 'Declared expectation was not met before the assertion deadline.';
      }
    } catch (error) { run.message = error.message; }
    finally {
      try { Object.assign(run, await this.evidence()); }
      catch { run.outcome = 'INCONCLUSIVE'; run.message += ' Final screenshot evidence could not be captured.'; }
      try { await this.close(); }
      catch { run.outcome = 'INCONCLUSIVE'; run.message += ' Browser cleanup failed.'; }
    }
    return run;
  }
}
