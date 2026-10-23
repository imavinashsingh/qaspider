import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { SqliteStore, ArtifactStore } from '../../storage/src/index.js';
import { budgetsSchema, findPath, httpUrlSchema, isSafeNavigation, navigationConfigSchema, normalizeObservation, normalizeUrl, type LocatorSpec, type NavigationAction, type NavigationBudgets, type NavigationConfig, type NavigationRun, type NormalizedObservation, type Observation, type Scope, type Transition, type UIState } from '../../core/src/index.js';
class NavigationError extends Error { constructor(message: string, readonly status: NavigationRun['status']) { super(message); } }
class Budget {
  actions = 0; requests = 0; states = 0; private lastAction = 0;
  constructor(readonly limits: NavigationBudgets, readonly signal: AbortSignal) {}
  check() { if (this.signal.aborted) throw this.signal.reason; }
  async action() {
    this.check(); if (this.actions >= this.limits.maxActions) throw new NavigationError('Action budget exhausted', 'budget-exhausted');
    const wait = this.limits.intervalMs - (Date.now() - this.lastAction); if (wait > 0) await delay(wait, undefined, { signal: this.signal });
    this.check(); this.actions++; this.lastAction = Date.now();
  }
  request() { this.check(); if (this.requests >= this.limits.maxRequests) throw new NavigationError('Request budget exhausted', 'budget-exhausted'); this.requests++; }
}
function locator(page: Page, spec: LocatorSpec): Locator {
  if (spec.kind === 'testId') return page.getByTestId(spec.value);
  if (spec.kind === 'label') return page.getByLabel(spec.value, { exact: true });
  return page.getByRole(spec.role, { name: spec.name, exact: true });
}
async function unique(page: Page, spec: LocatorSpec): Promise<Locator> { const result = locator(page, spec); if (await result.count() !== 1) throw new NavigationError('Locator is missing or ambiguous', 'blocked'); return result; }
async function observe(page: Page, config: NavigationConfig, secrets: string[], origins: string[]): Promise<NormalizedObservation> {
  if (!isSafeNavigation({ kind: 'link', locator: { kind: 'role', role: 'link', name: 'Destination' }, targetUrl: page.url() }, origins, config)) throw new NavigationError('Live destination violates origin/navigation policy', 'blocked');
  // Static read-only snapshot code, never supplied by a page, story or AI provider.
  const snapshot = await page.evaluate(({ volatileSelectors, privateSelectors }) => {
    const excluded = [...volatileSelectors, ...privateSelectors];
    const visible = (element: Element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && !excluded.some(selector => element.matches(selector) || !!element.closest(selector));
    const name = (element: Element) => {
      const labelled = element.getAttribute('aria-labelledby');
      return element.getAttribute('aria-label') || (labelled ? labelled.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ') : '') || ('labels' in element ? Array.from((element as HTMLInputElement).labels ?? []).map(label => label.textContent ?? '').join(' ') : '') || element.textContent || '';
    };
    const controls = Array.from(document.querySelectorAll('a[href],button,input,select,textarea,[role="tab"],[role="button"]')).slice(0, 1000).filter(visible).map(element => {
      const role = element.getAttribute('role') || (element.tagName === 'A' ? 'link' : element.tagName === 'BUTTON' ? 'button' : 'textbox');
      return { role, name: name(element).replace(/\s+/g, ' ').trim().slice(0, 200), testId: element.getAttribute('data-testid'), href: element instanceof HTMLAnchorElement ? element.href : null, expanded: element.hasAttribute('aria-expanded') ? element.getAttribute('aria-expanded') === 'true' : null, selected: element.hasAttribute('aria-selected') ? element.getAttribute('aria-selected') === 'true' : null, disabled: 'disabled' in element && Boolean(element.disabled), checked: 'checked' in element && Boolean(element.checked) };
    });
    return { url: location.href, headings: Array.from(document.querySelectorAll('h1,h2,h3,[role="heading"]')).slice(0, 100).filter(visible).map(element => name(element).trim()), dialogs: Array.from(document.querySelectorAll('dialog[open],[role="dialog"]')).filter(visible).map(element => name(element).trim()), controls };
  }, config) as Observation;
  return normalizeObservation(snapshot, config, secrets);
}
interface Session { context: BrowserContext; page: Page; budget: Budget; secrets: string[]; origins: string[]; }
export class NavigationEngine {
  constructor(private readonly store: SqliteStore, private readonly artifacts: ArtifactStore, private readonly browser?: Browser) {}
  private validate(scope: Scope) {
    const environment = this.store.getEnvironment(scope.environmentId); const role = this.store.getRole(scope.roleId);
    if (!environment || !role || environment.applicationId !== scope.applicationId || role.environmentId !== scope.environmentId) throw new NavigationError('Invalid role/environment scope', 'blocked');
    if (environment.kind === 'production') throw new NavigationError('M1 mapping/replay is limited to development and QA', 'blocked');
    return { environment, role };
  }
  private async session(browser: Browser, scope: Scope, config: NavigationConfig, budget: Budget, env: NodeJS.ProcessEnv): Promise<Session> {
    const { environment, role } = this.validate(scope); const origins = environment.allowedOrigins; const secrets: string[] = [];
    let storageState: Awaited<ReturnType<BrowserContext['storageState']>> | undefined;
    if (role.auth.kind === 'storage-state') {
      const path = env[role.auth.storageStateEnv]; if (!path || !config.auth) throw new NavigationError('Storage-state reference and identity assertion are required', 'blocked');
      try { storageState = JSON.parse(readFileSync(path, 'utf8')) as typeof storageState; } catch { throw new NavigationError('Storage state could not be loaded', 'blocked'); }
      if (!storageState || !Array.isArray(storageState.cookies) || !Array.isArray(storageState.origins)) throw new NavigationError('Invalid storage state', 'blocked');
      if (storageState.origins.some(entry => !origins.includes(entry.origin)) || storageState.cookies.some(cookie => !origins.some(origin => new URL(origin).hostname === cookie.domain.replace(/^\./, '')))) throw new NavigationError('Storage state contains undeclared origins', 'blocked');
      secrets.push(...storageState.cookies.map(cookie => cookie.value), ...storageState.origins.flatMap(origin => origin.localStorage.map(item => item.value)));
    }
    budget.check();
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false, ...(storageState ? { storageState } : {}) });
    const close = () => { void context.close().catch(() => {}); }; budget.signal.addEventListener('abort', close, { once: true });
    context.on('close', () => budget.signal.removeEventListener('abort', close));
    let authWriteOpen = false;
    await context.route('**/*', async route => {
      try {
        budget.request(); const request = route.request(); const url = new URL(request.url());
        if (!origins.includes(url.origin) || url.username || url.password) { await route.abort(); return; }
        if (!['GET', 'HEAD'].includes(request.method()) && !(authWriteOpen && request.method() === 'POST' && config.auth && url.toString() === config.auth.submitUrl)) { await route.abort(); return; }
        if (['GET', 'HEAD'].includes(request.method()) && !isSafeNavigation({ kind: 'link', locator: { kind: 'role', role: 'link', name: 'Resource' }, targetUrl: url.toString() }, origins, config)) { await route.abort(); return; }
        await route.continue();
      } catch (error) { if (error instanceof NavigationError) this.requestFailure = error; await route.abort().catch(() => {}); }
    });
    await context.routeWebSocket('**/*', socket => socket.close());
    const page = await context.newPage(); context.on('page', other => { if (other !== page) void other.close().catch(() => {}); });
    page.on('dialog', dialog => { void dialog.dismiss(); }); page.on('download', download => { void download.cancel(); });
    page.setDefaultTimeout(budget.limits.actionTimeoutMs); page.setDefaultNavigationTimeout(budget.limits.actionTimeoutMs);
    const session: Session = { context, page, budget, secrets, origins };
    try {
      if (role.auth.kind === 'guest') { if (config.auth) throw new NavigationError('Guest scope cannot use authenticated bootstrap', 'blocked'); }
      else {
        if (!config.auth) throw new NavigationError('An explicit authentication workflow and ready assertion are required', 'blocked');
        if (role.auth.kind === 'form') {
          const username = env[role.auth.usernameEnv]; const password = env[role.auth.passwordEnv]; if (!username || !password) throw new NavigationError('Credential environment references are missing', 'blocked');
          secrets.push(username, password); await this.goto(session, config.auth.url);
          await budget.action(); await (await unique(page, config.auth.username)).fill(username);
          await budget.action(); await (await unique(page, config.auth.password)).fill(password);
          authWriteOpen = true;
          try { await budget.action(); await (await unique(page, config.auth.submit)).click(); await locator(page, config.auth.ready).waitFor({ state: 'visible' }); } finally { authWriteOpen = false; }
        } else { await this.goto(session, config.auth.url); await locator(page, config.auth.ready).waitFor({ state: 'visible' }); }
        if (scope.tenant !== 'public') { if (!config.auth.tenantReady) throw new NavigationError('Tenant identity assertion required', 'blocked'); await locator(page, config.auth.tenantReady).waitFor({ state: 'visible' }); }
      }
      budget.check(); return session;
    } catch (error) { await context.close(); throw error; }
  }
  private requestFailure: NavigationError | undefined;
  private async goto(session: Session, url: string) {
    httpUrlSchema.parse(url); if (!session.origins.includes(new URL(url).origin)) throw new NavigationError('Origin is not allowed', 'blocked');
    await session.budget.action(); const response = await session.page.goto(url, { waitUntil: 'load' });
    if (this.requestFailure) throw this.requestFailure;
    if (response && response.status() >= 400) throw new NavigationError('Navigation response was not successful', 'blocked');
    session.budget.check();
  }
  private actions(observation: NormalizedObservation, session: Session, config: NavigationConfig): NavigationAction[] {
    const actions: NavigationAction[] = [];
    for (const control of observation.controls) {
      if (control.disabled) continue;
      const spec: LocatorSpec = control.testId ? { kind: 'testId', value: control.testId } : { kind: 'role', role: control.role as 'link', name: control.name };
      if (control.role === 'link' && control.href) {
        const action: NavigationAction = { kind: 'link', locator: spec, targetUrl: control.href };
        if (isSafeNavigation(action, session.origins, config)) actions.push(action);
      }
    }
    for (const spec of config.safeControls) {
      const action: NavigationAction = { kind: 'control', locator: spec };
      if (isSafeNavigation(action, session.origins, config) && observation.controls.some(control => (spec.kind === 'testId' ? control.testId === spec.value : spec.kind === 'role' && control.role === spec.role && control.name === spec.name))) actions.push(action);
    }
    return actions.filter((item, index) => actions.findIndex(other => JSON.stringify(other) === JSON.stringify(item)) === index);
  }
  private async apply(session: Session, action: NavigationAction, config: NavigationConfig) {
    if (!isSafeNavigation(action, session.origins, config)) throw new NavigationError('Unsafe action rejected', 'blocked');
    const target = await unique(session.page, action.locator);
    const metadata = await target.evaluate(element => ({ tag: element.tagName, role: element.getAttribute('role'), type: element.getAttribute('type'), form: !!element.closest('form'), href: element instanceof HTMLAnchorElement ? element.href : null, download: element.hasAttribute('download'), target: element.getAttribute('target') }));
    if (action.kind === 'link') {
      if (!metadata.href || metadata.tag !== 'A' || metadata.download || (metadata.target && metadata.target !== '_self') || !isSafeNavigation({ ...action, targetUrl: metadata.href }, session.origins, config) || normalizeUrl(metadata.href, config, session.secrets) !== action.targetUrl) throw new NavigationError('Live link no longer satisfies navigation policy', 'blocked');
    } else if (metadata.form || (metadata.tag !== 'BUTTON' && !['button', 'tab'].includes(metadata.role ?? '')) || (metadata.tag === 'BUTTON' && metadata.type !== 'button')) throw new NavigationError('Unknown form or unsafe control rejected', 'blocked');
    await session.budget.action(); await target.click(); await session.page.waitForLoadState('load');
    if (this.requestFailure) throw this.requestFailure;
    session.budget.check();
  }
  private async checked(session: Session, expected: UIState | Transition['precondition'], config: NavigationConfig): Promise<NormalizedObservation> {
    const condition = 'observation' in expected ? expected.observation : expected;
    let actual = await observe(session.page, config, session.secrets, session.origins);
    // Give asynchronous, already-triggered rendering a bounded chance to settle.
    const deadline = Date.now() + Math.min(1000, session.budget.limits.actionTimeoutMs);
    while (actual.fingerprint !== condition.fingerprint && Date.now() < deadline) { await delay(50, undefined, { signal: session.budget.signal }); actual = await observe(session.page, config, session.secrets, session.origins); }
    if (actual.fingerprint !== condition.fingerprint || actual.url !== condition.url || JSON.stringify(actual.headings) !== JSON.stringify(condition.headings)) throw new NavigationError('Live state precondition/postcondition mismatch', 'failed');
    return actual;
  }
  private event(runId: string, value: unknown, evidenceIds: string[]): string { const record = this.artifacts.put(runId, Buffer.from(JSON.stringify(value)), 'event-log'); evidenceIds.push(record.id); return record.id; }
  private async saveState(session: Session, scope: Scope, observation: NormalizedObservation, runId: string, evidenceIds: string[], config: NavigationConfig): Promise<UIState> {
    let screenshotId: string | undefined;
    const masks = [session.page.locator('input,textarea,[data-qaspider-private]'), ...config.privateSelectors.map(selector => session.page.locator(selector))];
    for (const secret of session.secrets.filter(value => value.length > 2)) masks.push(session.page.getByText(new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));
    masks.push(session.page.getByText(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/));
    const screenshot = await session.page.screenshot({ mask: masks, fullPage: false, animations: 'disabled' });
    const image = this.artifacts.put(runId, screenshot, 'screenshot'); screenshotId = image.id; evidenceIds.push(image.id);
    const evidenceId = this.event(runId, { kind: 'state-observation', observation, screenshotId }, evidenceIds);
    return this.store.navigation.saveState(scope, observation, evidenceId);
  }
  async map(scope: Scope, seedUrl: string, configInput: NavigationConfig = navigationConfigSchema.parse({}), limitsInput: Partial<NavigationBudgets> = {}, signal?: AbortSignal, env: NodeJS.ProcessEnv = process.env): Promise<NavigationRun> {
    const config = navigationConfigSchema.parse(configInput); const { role } = this.validate(scope);
    const credentialValues = role.auth.kind === 'form' ? [env[role.auth.usernameEnv], env[role.auth.passwordEnv]].filter((value): value is string => !!value) : [];
    const serialized = JSON.stringify({ seedUrl, config });
    if (credentialValues.some(value => serialized.includes(value))) throw new NavigationError('Configuration must not contain credential values', 'blocked');
    if (/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/.test(serialized)) throw new NavigationError('Configuration must not contain account identifiers', 'blocked');
    this.store.navigation.ensureScope(scope, seedUrl, config);
    return this.execute(scope, 'map', limitsInput, signal, env, async (session, run, evidenceIds) => {
      const visited = new Map<string, UIState>(); await this.goto(session, seedUrl);
      const initial = await observe(session.page, config, session.secrets, session.origins); const first = await this.saveState(session, scope, initial, run.id, evidenceIds, config);
      visited.set(initial.fingerprint, first); session.budget.states = 1;
      const queue: Array<{ state: UIState; path: Transition[]; depth: number }> = [{ state: first, path: [], depth: 0 }];
      const restore = async (path: Transition[], state: UIState) => {
        await this.goto(session, seedUrl); await this.checked(session, first, config);
        for (const step of path) { await this.checked(session, step.precondition, config); await this.apply(session, step.action, config); await this.checked(session, step.postcondition, config); }
        await this.checked(session, state, config);
      };
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const entry = queue[cursor]!; if (entry.depth >= session.budget.limits.depth) continue;
        await restore(entry.path, entry.state);
        const actions = this.actions(await observe(session.page, config, session.secrets, session.origins), session, config);
        for (const action of actions) {
          let edge: Transition | undefined;
          try {
            await restore(entry.path, entry.state); await this.apply(session, action, config);
            const destination = await observe(session.page, config, session.secrets, session.origins);
            let next = visited.get(destination.fingerprint);
            if (!next) {
              if (visited.size >= session.budget.limits.maxStates) throw new NavigationError('State budget exhausted', 'budget-exhausted');
              next = await this.saveState(session, scope, destination, run.id, evidenceIds, config); visited.set(destination.fingerprint, next); session.budget.states = visited.size;
            }
            edge = this.store.navigation.saveTransition(scope, entry.state.id, next.id, action);
            await restore(entry.path, entry.state); const before = await this.checked(session, edge.precondition, config);
            await this.apply(session, action, config); const after = await this.checked(session, edge.postcondition, config);
            const proof = this.event(run.id, { kind: 'transition-replay', transitionId: edge.id, precondition: edge.precondition, postcondition: edge.postcondition, observedBefore: before, observedAfter: after, passed: true }, evidenceIds);
            this.store.navigation.recordVerification(scope, edge.id, run.id, proof, true);
            if (!queue.some(item => item.state.id === next!.id)) queue.push({ state: next, path: [...entry.path, edge], depth: entry.depth + 1 });
          } catch (error) {
            if (session.budget.signal.aborted || this.requestFailure || (error instanceof NavigationError && error.status === 'budget-exhausted')) throw error;
            const proof = this.event(run.id, { kind: 'navigation-attempt', transitionId: edge?.id ?? null, passed: false, reason: error instanceof NavigationError ? error.message : 'Browser action failed; no product defect inferred' }, evidenceIds);
            if (edge) this.store.navigation.recordVerification(scope, edge.id, run.id, proof, false);
          }
        }
      }
    });
  }
  async replay(scope: Scope, from: string, to: string, signal?: AbortSignal, env: NodeJS.ProcessEnv = process.env, limits: Partial<NavigationBudgets> = {}): Promise<NavigationRun> {
    this.validate(scope); const graph = this.store.navigation.snapshot(scope); if (!graph.scope) throw new NavigationError('Unknown navigation scope', 'blocked');
    const config = graph.scope.config; const selected = findPath(graph, from, to);
    return this.execute(scope, 'replay', limits, signal, env, async (session, run, evidenceIds) => {
      await this.goto(session, graph.scope!.seedUrl); const current = await observe(session.page, config, session.secrets, session.origins);
      const initial = graph.states.find(state => state.observation.fingerprint === current.fingerprint); if (!initial) throw new NavigationError('Entry state is unknown or changed', 'failed');
      const path = [...findPath(graph, initial.id, from), ...selected];
      for (const edge of path) {
        try {
          const live = this.store.navigation.snapshot(scope).transitions.find(item => item.id === edge.id);
          if (live?.status !== 'approved') throw new NavigationError('Approval is no longer valid', 'blocked');
          const before = await this.checked(session, edge.precondition, config); await this.apply(session, edge.action, config); const after = await this.checked(session, edge.postcondition, config);
          const proof = this.event(run.id, { kind: 'transition-replay', transitionId: edge.id, precondition: edge.precondition, postcondition: edge.postcondition, observedBefore: before, observedAfter: after, passed: true }, evidenceIds);
          this.store.navigation.recordVerification(scope, edge.id, run.id, proof, true); session.budget.states++;
        } catch (error) {
          if (!session.budget.signal.aborted) { const proof = this.event(run.id, { kind: 'transition-replay', transitionId: edge.id, passed: false, reason: 'Live navigation verification failed' }, evidenceIds); this.store.navigation.recordVerification(scope, edge.id, run.id, proof, false); }
          throw error;
        }
      }
      const destination = graph.states.find(state => state.id === to)!; await this.checked(session, destination, config);
      if (!path.length) this.event(run.id, { kind: 'state-replay', passed: true, postcondition: destination.observation }, evidenceIds);
    });
  }
  private async execute(scope: Scope, kind: 'map' | 'replay', input: Partial<NavigationBudgets>, signal: AbortSignal | undefined, env: NodeJS.ProcessEnv, work: (session: Session, run: NavigationRun, evidenceIds: string[]) => Promise<void>): Promise<NavigationRun> {
    const limits = budgetsSchema.parse(input); const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new NavigationError('Runtime budget exhausted', 'budget-exhausted')), limits.maxMs);
    const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal; const budget = new Budget(limits, combined);
    const run = this.store.navigation.startRun(scope, kind); const evidenceIds: string[] = [];
    let browser: Browser | undefined; let session: Session | undefined; let tracing = false; let status: NavigationRun['status'] = 'complete'; let message = 'Navigation work completed'; this.requestFailure = undefined;
    try {
      budget.check(); browser = this.browser ?? await chromium.launch({ timeout: Math.min(limits.maxMs, limits.actionTimeoutMs) }); budget.check();
      const config = this.store.navigation.snapshot(scope).scope!.config; session = await this.session(browser, scope, config, budget, env);
      if (this.store.getSettings().captureFullTraces) { await session.context.tracing.start({ screenshots: true, snapshots: true, sources: false }); tracing = true; }
      await work(session, run, evidenceIds); budget.check(); if (this.requestFailure) throw this.requestFailure;
    } catch (error) {
      const cause = combined.aborted ? (signal?.aborted ? new NavigationError('Navigation cancelled', 'cancelled') : combined.reason as unknown) : this.requestFailure ?? error;
      status = cause instanceof NavigationError ? cause.status : 'failed'; message = cause instanceof NavigationError ? cause.message : 'Browser or artifact operation failed; review local evidence';
      try { this.event(run.id, { kind: 'run-stop', status, message }, evidenceIds); } catch { /* Quota failures are reported in the durable run instead. */ }
    } finally {
      clearTimeout(timeout);
      if (session && tracing && !combined.aborted) {
        const temp = mkdtempSync(join(tmpdir(), 'qaspider-trace-'));
        try { const path = join(temp, 'trace.zip'); await session.context.tracing.stop({ path }); if (statSync(path).size > this.store.getSettings().perRunQuotaBytes) throw new Error('Trace quota exceeded'); const record = this.artifacts.put(run.id, readFileSync(path), 'trace'); evidenceIds.push(record.id); }
        catch { if (status === 'complete') { status = 'failed'; message = 'Trace evidence could not be retained within artifact policy'; } }
        finally { rmSync(temp, { recursive: true, force: true }); }
      }
      await session?.context.close().catch(() => {}); if (!this.browser) await browser?.close().catch(() => {}); this.artifacts.finishRun(run.id);
    }
    return this.store.navigation.finishRun(run.id, { status, actions: budget.actions, requests: budget.requests, states: budget.states, message, evidenceIds });
  }
}
