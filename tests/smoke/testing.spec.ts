import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SqliteStore, ArtifactStore } from '../../packages/storage/src/index.js';
import { runCli } from '../../packages/cli/src/cli.js';
import { NavigationEngine } from '../../packages/navigation/src/engine.js';
import { navigationConfigSchema, type Scope, type PlanProposal, type TestPolicy, type ProviderContext, FakeProvider } from '../../packages/core/src/index.js';
import { QaService } from '../../packages/qa/src/service.js';
import { createGraphServer } from '../../packages/navigation/src/viewer.js';
import { TestExecutor } from '../../packages/qa/src/execution.js';
test.use({ trace: 'off' });
test('approved registration cases detect duplicate defect, keep expectations, retain evidence and replay after restart without AI', async ({ browser, baseURL, request }, info) => {
    test.setTimeout(90000);
    const token = 'smoke-fixture-token';
    const headers = { 'x-fixture-token': token };
    await request.post('/__fixtures/reset', { headers });
    const workspace = info.outputPath('workspace');
    mkdirSync(workspace, { recursive: true });
    runCli(['init', '--workspace', workspace, '--origin', baseURL!], () => { }, {});
    const db = join(workspace, '.qaspider/memory.db');
    let store = new SqliteStore(db);
    const directory = join(workspace, '.qaspider/artifacts');
    const scope: Scope = { applicationId: 'benchmark', environmentId: 'development', roleId: 'guest', build: 'm2-smoke', tenant: 'public', featureFlags: {} };
    try {
        const nav = new NavigationEngine(store, new ArtifactStore(store, directory), browser);
        const mapped = await nav.map(scope, `${baseURL}/`, navigationConfigSchema.parse({}), { depth: 1, intervalMs: 0 });
        expect(mapped.status).toBe('complete');
        const graph = store.navigation.snapshot(scope);
        store.navigation.approveBatch(scope, graph.transitions.filter(t => t.status === 'verified').map(t => t.id), 'test-reviewer');
        const target = graph.states.find(s => s.observation.headings.includes('Registration'))!;
        const story = store.testing.importStory('# Registration\n## Acceptance Criteria\n- AC-1: Valid unique email shows Account created in status.\n- AC-2: Invalid email shows Invalid email in alert.\n- AC-3: Duplicate email shows Email already exists in alert.', 'registration.md', { applicationId: scope.applicationId, environmentId: scope.environmentId, build: scope.build, tenant: scope.tenant, featureFlags: scope.featureFlags, roleIds: ['guest'] });
        const policy: TestPolicy = { actionGrants: [{ roleId: 'guest', url: `${baseURL}/api/register`, method: 'POST' }], readGrants: [], fixtures: { setupUrl: `${baseURL}/__fixtures/setup`, cleanupUrl: `${baseURL}/__fixtures/cleanup`, tokenEnv: 'BENCHMARK_FIXTURE_TOKEN', emailDomain: 'example.test' }, discovery: false };
        const proposal: PlanProposal = { title: 'Synthetic test fixture plan', feature: 'Registration', inferredRequirements: [], scenarios: ['unique-email', 'literal', 'duplicate-email'].map((kind, i) => ({ id: `case-${i}`, title: ['Valid', 'Invalid', 'Duplicate'][i]!, roleId: 'guest', requirementIds: [story.requirements[i]!.id], targetStateId: target.id, data: [{ key: 'email', type: 'email', source: kind === 'literal' ? { kind: 'literal', value: 'invalid-email' } : { kind: kind as 'unique-email' | 'duplicate-email' } }, { key: 'password', type: 'password', source: { kind: 'generated-password' } }], steps: [{ kind: 'fill', locator: { kind: 'label', value: 'Email' }, valueKey: 'email' }, { kind: 'fill', locator: { kind: 'label', value: 'Password' }, valueKey: 'password' }, { kind: 'click', locator: { kind: 'role', role: 'button', name: 'Create account' }, submitUrl: `${baseURL}/api/register` }], assertions: [{ id: 'message', requirementId: story.requirements[i]!.id, kind: 'text', locator: { kind: 'role', role: i === 0 ? 'status' : 'alert', name: '' }, expected: ['Account created', 'Invalid email', 'Email already exists'][i]!, comparison: 'equals' }], allowedActions: policy.actionGrants, cleanup: 'owned-fixtures', severity: 'high', retries: 0 })) };
        const plan = store.testing.savePlan(story.id, proposal, policy, { id: 'test-fixture', synthetic: true, validationId: null });
        await expect(new TestExecutor(store, new ArtifactStore(store, directory), browser).execute(plan.id)).rejects.toThrow('approved');
        store.testing.approvePlan(plan.id, 'explicit-test-reviewer', story.requirements.map(r => r.id));
        await request.post('/__fixtures/change', { headers, data: { duplicateEmailDefect: true } });
        const report = await new TestExecutor(store, new ArtifactStore(store, directory), browser, { BENCHMARK_FIXTURE_TOKEN: token }).execute(plan.id);
        expect(report.results.map(r => r.status)).toEqual(['PASS', 'PASS', 'FAIL']);
        expect(report.fixtures.every(f => f.status === 'cleaned')).toBe(true);
        expect(report.results.every(r => r.attempts[0]!.navigationRunId)).toBe(true);
        expect(report.results.every(r => r.attempts[0]!.evidenceIds.length >= 3)).toBe(true);
        expect(store.testing.getStory(story.id)?.markdown).toBe(story.markdown);
        expect(store.testing.getPlan(plan.id)?.hash).toBe(plan.hash);
        const firstRun = report.run.id;
        store.close();
        store = new SqliteStore(db);
        expect(store.testing.report(firstRun)?.summary.FAIL).toBe(1);
        const replay = await new TestExecutor(store, new ArtifactStore(store, directory), browser, { BENCHMARK_FIXTURE_TOKEN: token }).execute(plan.id, ['case-0']);
        expect(replay.summary.PASS).toBe(1);
        expect(replay.summary['NOT RUN']).toBe(2);
        class FixturePlanner extends FakeProvider {
            override async plan(context: ProviderContext) {
                const data = JSON.parse(context.summary) as {
                    story: {
                        requirements: Array<{
                            id: string;
                        }>;
                    };
                };
                return { ...proposal, scenarios: proposal.scenarios.map((s, i) => ({ ...s, requirementIds: [data.story.requirements[i]!.id], assertions: s.assertions.map(a => ({ ...a, requirementId: data.story.requirements[i]!.id })) })) };
            }
        }
        const qa = new QaService(store, new ArtifactStore(store, directory), new FixturePlanner(), browser, { BENCHMARK_FIXTURE_TOKEN: token });
        const viewer = createGraphServer(store, new ArtifactStore(store, directory), qa);
        await new Promise<void>(resolve => viewer.server.listen(0, '127.0.0.1', resolve));
        try {
            const address = viewer.server.address();
            if (!address || typeof address === 'string')
                throw new Error('Missing viewer address');
            const origin = `http://127.0.0.1:${address.port}`;
            const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
            await page.goto(`${origin}/#token=${viewer.token}`);
            await page.getByRole('button', { name: 'Test Studio', exact: true }).click();
            await expect(page.getByRole('heading', { name: 'Test Studio', exact: true })).toBeVisible();
            await page.getByRole('button', { name: 'Save story revision', exact: true }).click();
            await expect(page.getByRole('status')).toContainText('Saved story revision');
            await page.getByRole('button', { name: 'Use local benchmark permissions' }).click();
            await page.getByRole('button', { name: 'Generate plan with Codex' }).click();
            await expect(page.getByLabel('Scenario proposal')).toContainText('Synthetic test fixture plan');
            await expect(page.getByText('· SYNTHETIC FIXTURE', { exact: false })).toBeVisible();
            const edited = { ...JSON.parse(await page.getByLabel('Scenario proposal').inputValue()) as PlanProposal, title: 'Reviewed synthetic fixture plan' };
            await page.getByLabel('Scenario proposal').fill(JSON.stringify(edited, null, 2));
            await page.getByRole('button', { name: 'Save edited revision' }).click();
            await expect(page.getByLabel('Scenario proposal')).toContainText('Reviewed synthetic fixture plan');
            for (const checkbox of await page.locator('.criterion input').all())
                await checkbox.check();
            await page.getByRole('button', { name: 'Approve displayed plan and selected requirements' }).click();
            await expect(page.getByRole('button', { name: 'Execute approved plan without AI' })).toBeEnabled();
            await page.getByRole('button', { name: 'Execute approved plan without AI' }).click();
            await expect(page.getByTestId('test-report')).toContainText('FAIL: 1', { timeout: 20000 });
            await expect(page.getByTestId('scenario-result')).toHaveCount(3);
            await page.getByRole('button', { name: /^screenshot · available/ }).first().click();
            await expect(page.getByAltText('Recorded assertion evidence')).toBeVisible();
            await page.screenshot({ path: info.outputPath('test-studio.png'), fullPage: true });
            await page.getByRole('button', { name: 'Test Runs', exact: true }).click();
            await page.getByLabel('Test run', { exact: true }).selectOption({ index: 1 });
            await expect(page.getByTestId('test-report')).toContainText('Reviewed synthetic fixture plan');
            await page.screenshot({ path: info.outputPath('test-runs.png'), fullPage: true });
            expect((await request.get(`${origin}/api/qa/runs`)).status()).toBe(401);
            expect((await request.post(`${origin}/api/qa/execute`, { headers: { 'x-qaspider-token': viewer.token, origin: 'https://evil.test' }, data: { planRevisionId: plan.id } })).status()).toBe(403);
            const trace = report.results.flatMap(r => r.attempts.flatMap(a => a.evidenceIds)).find(id => store.getArtifact(id)?.kind === 'trace');
            expect(trace).toBeTruthy();
            expect((await request.get(`${origin}/api/qa/evidence?run=${report.run.id}&id=${trace}`, { headers: { 'x-qaspider-token': viewer.token } })).status()).toBe(400);
            await page.close();
        }
        finally {
            await viewer.shutdown();
            viewer.server.closeAllConnections();
            await new Promise<void>(resolve => viewer.server.close(() => resolve()));
        }
        writeFileSync(info.outputPath('m2-report.json'), JSON.stringify({ report, replay }, null, 2));
    }
    finally {
        await request.post('/__fixtures/change', { headers, data: { duplicateEmailDefect: false } });
        store.close();
    }
});
test('executes guest/admin/user in isolated sessions and blocks unsafe steps, unapproved paths and cross-scope targets', async ({ browser, baseURL, request }, info) => {
    test.setTimeout(90000);
    await request.post('/__fixtures/reset', { headers: { 'x-fixture-token': 'smoke-fixture-token' } });
    const workspace = info.outputPath('workspace');
    mkdirSync(workspace, { recursive: true });
    runCli(['init', '--workspace', workspace, '--origin', baseURL!], () => { }, {});
    const store = new SqliteStore(join(workspace, '.qaspider/memory.db'));
    const artifacts = new ArtifactStore(store, join(workspace, '.qaspider/artifacts'));
    const env = { QASPIDER_ADMIN_EMAIL: 'admin@example.test', QASPIDER_ADMIN_PASSWORD: 'benchmark-password', QASPIDER_USER_EMAIL: 'user@example.test', QASPIDER_USER_PASSWORD: 'benchmark-password' };
    const roots = new Map<string, string>();
    const scopes: Scope[] = [];
    try {
        for (const roleId of ['guest', 'admin', 'user']) {
            const scope: Scope = { applicationId: 'benchmark', environmentId: 'development', roleId, build: 'roles-m2', tenant: 'public', featureFlags: {} };
            scopes.push(scope);
            const config = navigationConfigSchema.parse(roleId === 'guest' ? {} : { auth: { url: `${baseURL}/login`, submitUrl: `${baseURL}/api/login`, username: { kind: 'label', value: 'Email' }, password: { kind: 'label', value: 'Password' }, submit: { kind: 'role', role: 'button', name: 'Sign in' }, ready: { kind: 'role', role: 'heading', name: roleId === 'admin' ? 'Admin dashboard' : 'User dashboard' } } });
            const run = await new NavigationEngine(store, artifacts, browser).map(scope, `${baseURL}/`, config, { depth: 1, intervalMs: 0 }, undefined, env);
            expect(run.status, run.message).toBe('complete');
            const graph = store.navigation.snapshot(scope);
            roots.set(roleId, graph.states.find(s => s.observation.url === `${baseURL}/`)!.id);
        }
        const story = store.testing.importStory('# Access control\n## Acceptance Criteria\n- AC-1: Guest receives 401.\n- AC-2: Admin receives 200.\n- AC-3: Standard user receives 403.', 'roles.md', { applicationId: 'benchmark', environmentId: 'development', roleIds: ['guest', 'admin', 'user'], build: 'roles-m2', tenant: 'public', featureFlags: {} });
        const policy: TestPolicy = { actionGrants: [], readGrants: scopes.map(s => ({ roleId: s.roleId, url: `${baseURL}/api/admin/users` })), fixtures: null, discovery: false };
        const proposal: PlanProposal = { title: 'Synthetic role matrix', feature: 'Access', inferredRequirements: [], scenarios: scopes.map((s, i) => ({ id: `role-${s.roleId}`, title: `${s.roleId} access`, roleId: s.roleId, requirementIds: [story.requirements[i]!.id], targetStateId: roots.get(s.roleId)!, data: [], steps: [], assertions: [{ id: 'access', requirementId: story.requirements[i]!.id, kind: 'http-status', url: `${baseURL}/api/admin/users`, expected: [401, 200, 403][i]! }], allowedActions: [], cleanup: 'owned-fixtures', severity: 'critical', retries: 0 })) };
        const approve = (proposal: PlanProposal) => { const p = store.testing.savePlan(story.id, proposal, policy, { id: 'test-fixture', synthetic: true, validationId: null }); return store.testing.approvePlan(p.id, 'role-reviewer', story.requirements.map(r => r.id)); };
        const plan = approve(proposal);
        const executor = new TestExecutor(store, artifacts, browser, env);
        const report = await executor.execute(plan.id);
        expect(report.summary.PASS).toBe(3);
        expect(report.results.flatMap(r => r.attempts.flatMap(a => a.assertions.map(a => a.actual)))).toEqual([401, 200, 403]);
        const guest = proposal.scenarios[0]!;
        const foreign = approve({ ...proposal, scenarios: [{ ...guest, targetStateId: roots.get('admin')! }] });
        expect((await executor.execute(foreign.id)).summary.BLOCKED).toBe(1);
        const guestGraph = store.navigation.snapshot(scopes[0]!);
        const login = guestGraph.states.find(s => s.observation.headings.includes('Sign in'))!;
        const unapproved = approve({ ...proposal, scenarios: [{ ...guest, targetStateId: login.id }] });
        expect((await executor.execute(unapproved.id)).summary.BLOCKED).toBe(1);
        store.navigation.approveBatch(scopes[0]!, guestGraph.transitions.filter(t => t.status === 'verified').map(t => t.id), 'role-reviewer');
        const unsafe = approve({ ...proposal, scenarios: [{ ...guest, targetStateId: login.id, steps: [{ kind: 'click', locator: { kind: 'role', role: 'button', name: 'Sign in' }, submitUrl: null }] }] });
        expect((await executor.execute(unsafe.id)).summary.BLOCKED).toBe(1);
        const cancelled = new AbortController();
        cancelled.abort();
        const cancelReport = await executor.execute(plan.id, undefined, cancelled.signal);
        expect(cancelReport.run.status).toBe('cancelled');
        expect(cancelReport.summary['NOT RUN']).toBe(3);
        expect(JSON.stringify(store.navigation.snapshot(scopes[1]!))).not.toContain('benchmark-password');
        writeFileSync(info.outputPath('role-report.json'), JSON.stringify(report, null, 2));
    }
    finally {
        store.close();
    }
});
test('discovers only an unknown story-relevant safe feature and requires separate navigation approval', async ({ browser, baseURL, request }, info) => {
    test.setTimeout(60000);
    await request.post('/__fixtures/reset', { headers: { 'x-fixture-token': 'smoke-fixture-token' } });
    const workspace = info.outputPath('workspace');
    mkdirSync(workspace, { recursive: true });
    runCli(['init', '--workspace', workspace, '--origin', baseURL!], () => { }, {});
    const store = new SqliteStore(join(workspace, '.qaspider/memory.db'));
    const artifacts = new ArtifactStore(store, join(workspace, '.qaspider/artifacts'));
    try {
        const scope: Scope = { applicationId: 'benchmark', environmentId: 'development', roleId: 'guest', build: 'targeted-m2', tenant: 'public', featureFlags: {} };
        const config = navigationConfigSchema.parse({ safeControls: [{ kind: 'testId', value: 'open-help' }, { kind: 'role', role: 'button', name: 'Close help' }] });
        expect((await new NavigationEngine(store, artifacts, browser).map(scope, `${baseURL}/`, config, { depth: 0, intervalMs: 0 })).status).toBe('complete');
        const story = store.testing.importStory('# Help\n## Acceptance Criteria\n- AC-1: The Help dialog is visible.', 'help.md', { applicationId: 'benchmark', environmentId: 'development', roleIds: ['guest'], build: 'targeted-m2', tenant: 'public', featureFlags: {} });
        class Planner extends FakeProvider {
            override async plan(context: ProviderContext) {
                const data = JSON.parse(context.summary) as {
                    navigation: Array<{
                        states: Array<{
                            id: string;
                            dialogs: string[];
                        }>;
                    }>;
                };
                const target = data.navigation[0]!.states.find(s => s.dialogs.includes('Help'));
                expect(target).toBeTruthy();
                return { title: 'Synthetic help plan', feature: 'Help', inferredRequirements: [], scenarios: [{ id: 'help', title: 'Help is visible', roleId: 'guest', requirementIds: [story.requirements[0]!.id], targetStateId: target!.id, data: [], steps: [], assertions: [{ id: 'visible', requirementId: story.requirements[0]!.id, kind: 'visible', locator: { kind: 'role', role: 'dialog', name: 'Help' }, expected: true }], allowedActions: [], cleanup: 'owned-fixtures', severity: 'low', retries: 0 }] };
            }
        }
        const plan = await new QaService(store, artifacts, new Planner(), browser).plan(story.id, { actionGrants: [], readGrants: [], fixtures: null, discovery: true });
        const graph = store.navigation.snapshot(scope);
        expect(graph.states.length).toBe(2);
        expect(graph.states.every(s => new URL(s.observation.url).pathname === '/')).toBe(true);
        expect(graph.transitions.some(e => e.status === 'verified')).toBe(true);
        expect(graph.transitions.some(e => e.status === 'approved')).toBe(false);
        store.testing.approvePlan(plan.id, 'help-reviewer', story.requirements.map(r => r.id));
        const executor = new TestExecutor(store, artifacts, browser);
        expect((await executor.execute(plan.id)).summary.BLOCKED).toBe(1);
        store.navigation.approveBatch(scope, graph.transitions.filter(e => e.status === 'verified').map(e => e.id), 'navigation-reviewer');
        expect((await executor.execute(plan.id)).summary.PASS).toBe(1);
        expect(await (await request.post('/__fixtures/stats', { headers: { 'x-fixture-token': 'smoke-fixture-token' } })).json()).toMatchObject({ registrations: 0, unsafeVisits: 0 });
    }
    finally {
        store.close();
    }
});
