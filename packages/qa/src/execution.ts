import { RunArtifactBudget } from './artifacts.js';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Browser } from 'playwright';
import { SqliteStore, ArtifactStore } from '../../storage/src/index.js';
import { NavigationEngine, NavigationError } from '../../navigation/src/engine.js';
import { resolveLocator, scenarioScope, redact, isSafeNavigation, type ArtifactStorage, type Scenario, type PlanRevision, type AttemptResult, type AssertionResult, type FixtureReservation, type TestReport, type TestRun } from '../../core/src/index.js';
class Blocked extends NavigationError {
    constructor(message: string) { super(message, 'blocked'); }
}
export class TestExecutor {
    constructor(private readonly store: SqliteStore, private readonly artifacts: ArtifactStore, private readonly browser?: Browser, private readonly env: NodeJS.ProcessEnv = process.env) { }
    async execute(planId: string, selected?: string[], signal?: AbortSignal, onProgress?: (run: TestRun, message: string) => void): Promise<TestReport> {
        const plan = this.store.testing.getPlan(planId);
        if (plan?.status !== 'approved')
            throw new Error('Execution requires an approved exact plan revision');
        const run = this.store.testing.startRun(planId, selected);
        const evidenceStore = new RunArtifactBudget(this.artifacts, () => this.store.getSettings().perRunQuotaBytes);
        onProgress?.(run, 'Starting approved scenarios');
        try {
            for (const scenario of plan.proposal.scenarios) {
                if (signal?.aborted)
                    break;
                if (!run.selectedScenarioIds.includes(scenario.id))
                    continue;
                onProgress?.(run, `Executing ${scenario.title}`);
                for (let attempt = 1; attempt <= scenario.retries + 1; attempt++) {
                    if (signal?.aborted)
                        break;
                    const result = await this.attempt(run.id, plan, scenario, attempt, evidenceStore, signal);
                    this.store.testing.recordAttempt(run.id, scenario.id, attempt, result);
                    if (result.status === 'PASS' || result.status === 'BLOCKED')
                        break;
                }
            }
            this.store.testing.finishRun(run.id, signal?.aborted ? 'cancelled' : 'complete');
        }
        catch {
            this.store.testing.finishRun(run.id, 'interrupted');
            throw new Error(`Execution interrupted; inspect persisted run ${run.id}`);
        }
        finally {
            this.artifacts.finishRun(run.id);
        }
        return this.store.testing.report(run.id)!;
    }
    private async fixtureRequest(url: string, email: string, policy: NonNullable<PlanRevision['policy']['fixtures']>, setup: boolean, signal?: AbortSignal) {
        const token = this.env[policy.tokenEnv];
        if (!token)
            throw new Blocked('Fixture credential reference is missing');
        const response = await fetch(url, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', 'x-fixture-token': token }, body: JSON.stringify({ email, ...(setup ? { role: 'user' } : {}) }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000) });
        if (!response.ok)
            throw new Blocked(setup ? 'Owned fixture setup failed' : 'Owned fixture cleanup failed');
        await response.body?.cancel();
    }
    private async attempt(runId: string, plan: PlanRevision, scenario: Scenario, attempt: number, artifacts: ArtifactStorage, signal?: AbortSignal): Promise<AttemptResult> {
        const story = this.store.testing.getStory(plan.storyRevisionId)!;
        const scope = scenarioScope(story.context, scenario);
        const environment = this.store.getEnvironment(scope.environmentId);
        const result: AttemptResult = { status: 'BLOCKED', reason: 'Scenario did not start', assertions: [], evidenceIds: [], navigationRunId: null };
        const owned: Array<{
            reservation: FixtureReservation;
            email: string;
        }> = [];
        const values = new Map<string, string>();
        const secrets: string[] = [];
        try {
            if (!environment || environment.kind === 'production')
                throw new Blocked('Execution is limited to development and QA');
            if (scenario.allowedActions.some(g => g.roleId !== scope.roleId || !environment.allowedOrigins.includes(new URL(g.url).origin) || !plan.policy.actionGrants.some(p => JSON.stringify(p) === JSON.stringify(g))))
                throw new Blocked('Write grants outside approved scope');
            const graph = this.store.navigation.snapshot(scope);
            if (!graph.scope || !graph.states.some(s => s.id === scenario.targetStateId))
                throw new Blocked('Target state is unknown in this exact role/environment/tenant/build');
            // Reserve ownership durably before any setup or application write. No account identifiers are saved in graph memory.
            for (const input of scenario.data) {
                let value: string;
                if (input.source.kind === 'literal')
                    value = input.source.value;
                else if (input.source.kind === 'generated-password')
                    value = randomBytes(24).toString('base64url');
                else {
                    const policy = plan.policy.fixtures;
                    if (!policy || !this.env[policy.tokenEnv])
                        throw new Blocked('Approved fixture lifecycle configuration is required');
                    if (![policy.setupUrl, policy.cleanupUrl].every(url => environment.allowedOrigins.includes(new URL(url).origin)))
                        throw new Blocked('Fixture endpoint outside scope');
                    const reservation = this.store.testing.reserveFixture(runId, scenario.id, attempt, input.source.kind);
                    value = `qa-${reservation.id.replaceAll('-', '')}@${policy.emailDomain}`;
                    owned.push({ reservation, email: value });
                    if (input.source.kind === 'duplicate-email') {
                        await this.fixtureRequest(policy.setupUrl, value, policy, true, signal);
                        this.store.testing.updateFixture(reservation.id, 'created');
                    }
                }
                values.set(input.key, value);
                if (input.source.kind !== 'literal')
                    secrets.push(value);
            }
            const navigation = await new NavigationEngine(this.store, artifacts, this.browser).runApprovedWorkflow(scope, scenario.targetStateId, scenario.allowedActions.map(g => g.url), async (session) => {
                session.secrets.push(...secrets);
                for (const step of scenario.steps) {
                    session.budget.check();
                    await session.budget.action();
                    const target = resolveLocator(session.page, step.locator);
                    if (await target.count() !== 1)
                        throw new Blocked('Missing or ambiguous approved locator');
                    if (step.kind === 'fill') {
                        const input = scenario.data.find(i => i.key === step.valueKey)!;
                        const type = await target.getAttribute('type');
                        if (type === 'password' && input.source.kind !== 'generated-password')
                            throw new Blocked('Password fields require generated data');
                        await target.fill(values.get(step.valueKey)!);
                    }
                    else if (step.submitUrl) {
                        const url = step.submitUrl;
                        if (!scenario.allowedActions.some(g => g.url === url))
                            throw new Blocked('Submission lacks an approved write grant');
                        // Exactly one bounded POST endpoint is open only while this approved interaction is in flight.
                        await session.permitWrite(url, async () => { const pending = session.page.waitForResponse(r => r.url() === url && r.request().method() === 'POST'); await target.click(); const response = await pending; await response.finished(); });
                    }
                    else {
                        const safe = await target.evaluate(el => ({ tag: el.tagName, type: el.getAttribute('type'), form: !!el.closest('form') }));
                        if (safe.tag !== 'BUTTON' || safe.type !== 'button' || safe.form || !isSafeNavigation({ kind: 'control', locator: step.locator }, session.origins, graph.scope!.config))
                            throw new Blocked('Unknown form or navigation click is not permitted');
                        await target.click();
                    }
                }
                for (const assertion of scenario.assertions) {
                    session.budget.check();
                    let actual: unknown;
                    let passed = false;
                    if (assertion.kind === 'http-status') {
                        if (!plan.policy.readGrants.some(g => g.roleId === scope.roleId && g.url === assertion.url) || !isSafeNavigation({ kind: 'link', locator: { kind: 'role', role: 'link', name: 'Read assertion' }, targetUrl: assertion.url }, environment.allowedOrigins, graph.scope!.config))
                            throw new Blocked('Read assertion lacks an approved scoped endpoint');
                        session.budget.request();
                        const response = await session.context.request.get(assertion.url, { maxRedirects: 0, timeout: 5000 });
                        actual = response.status();
                        await response.dispose();
                        passed = actual === assertion.expected;
                    }
                    else {
                        const target = resolveLocator(session.page, assertion.locator);
                        const count = await target.count();
                        if (count > 1)
                            throw new Blocked('Ambiguous assertion locator');
                        if (assertion.kind === 'visible') {
                            actual = count === 1 && await target.isVisible();
                            passed = actual === assertion.expected;
                        }
                        else {
                            if (count !== 1)
                                throw new Blocked('Assertion target is missing');
                            const deadline = Date.now() + 1000;
                            do {
                                actual = (await target.textContent())?.replace(/\s+/g, ' ').trim() ?? '';
                                passed = assertion.comparison === 'equals' ? actual === assertion.expected : String(actual).includes(assertion.expected);
                                if (passed)
                                    break;
                                await delay(40, undefined, { signal: session.budget.signal });
                            } while (Date.now() < deadline);
                        }
                    }
                    const safeActual = typeof actual === 'string' ? redact(actual, secrets) : actual;
                    const screenshot = await session.page.screenshot({ mask: [session.page.locator('input,textarea,[data-qaspider-private]'), session.page.getByText(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/)], animations: 'disabled' });
                    const image = artifacts.put(runId, screenshot, 'screenshot');
                    result.evidenceIds.push(image.id);
                    const evidence = artifacts.put(runId, Buffer.from(JSON.stringify({ kind: 'assertion', scenarioId: scenario.id, assertionId: assertion.id, requirementId: assertion.requirementId, expected: assertion.expected, actual: safeActual, passed, screenshotId: image.id })), 'event-log');
                    result.evidenceIds.push(evidence.id);
                    const recorded: AssertionResult = { id: assertion.id, requirementId: assertion.requirementId, status: passed ? 'PASS' : 'FAIL', expected: assertion.expected, actual: safeActual, evidenceId: evidence.id };
                    result.assertions.push(recorded);
                }
                result.status = result.assertions.every(a => a.status === 'PASS') ? 'PASS' : 'FAIL';
                result.reason = result.status === 'PASS' ? 'Every approved assertion passed' : 'Observed behavior differs from an approved requirement';
            }, signal, this.env, { intervalMs: 0, maxMs: 60000, maxActions: 100, maxRequests: 400 });
            result.navigationRunId = navigation.id;
            result.evidenceIds.push(...navigation.evidenceIds);
            if (navigation.status !== 'complete') {
                result.status = navigation.status === 'failed' ? 'INCONCLUSIVE' : 'BLOCKED';
                result.reason = `Navigation/workflow ${navigation.status}: ${navigation.message}`;
            }
        }
        catch (error) {
            result.status = error instanceof Blocked ? 'BLOCKED' : 'INCONCLUSIVE';
            result.reason = error instanceof Blocked ? error.message : 'Execution or evidence operation failed; inspect local evidence';
        }
        finally {
            for (const item of owned) {
                try {
                    await this.fixtureRequest(plan.policy.fixtures!.cleanupUrl, item.email, plan.policy.fixtures!, false);
                    this.store.testing.updateFixture(item.reservation.id, 'cleaned');
                }
                catch {
                    this.store.testing.updateFixture(item.reservation.id, 'orphan', 'Cleanup failed; operator reconciliation required');
                    result.status = 'BLOCKED';
                    result.reason = 'Owned fixture cleanup failed; manual reconciliation required';
                }
            }
        }
        return result;
    }
}
