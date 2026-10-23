import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { SqliteStore, ArtifactStore } from '../../packages/storage/src/index.js';
import { runCli } from '../../packages/cli/src/cli.js';
import { NavigationEngine } from '../../packages/navigation/src/engine.js';
import { createGraphServer } from '../../packages/navigation/src/viewer.js';
import { navigationConfigSchema, type Scope } from '../../packages/core/src/index.js';
// NavigationEngine owns and persists traces for its contexts; do not double-instrument them.
test.use({ trace: 'off' });
const env = { QASPIDER_ADMIN_EMAIL: 'admin@example.test', QASPIDER_ADMIN_PASSWORD: 'benchmark-password', QASPIDER_USER_EMAIL: 'user@example.test', QASPIDER_USER_PASSWORD: 'benchmark-password' };
const auth = (base: string, role: string) => ({ url: `${base}/login`, submitUrl: `${base}/api/login`, username: { kind: 'label' as const, value: 'Email' }, password: { kind: 'label' as const, value: 'Password' }, submit: { kind: 'role' as const, role: 'button' as const, name: 'Sign in' }, ready: { kind: 'role' as const, role: 'heading' as const, name: role === 'admin' ? 'Admin dashboard' : 'User dashboard' } });
test('maps isolated roles, persists across restart, batch approves, replays without AI and renders actual SQLite records', async ({ browser, baseURL, request }, info) => {
  test.setTimeout(180000);
  expect((await request.post('/__fixtures/reset', { headers: { 'x-fixture-token': 'smoke-fixture-token' } })).ok()).toBe(true);
  const workspace = info.outputPath('workspace'); mkdirSync(workspace, { recursive: true });
  expect(runCli(['init', '--workspace', workspace, '--origin', baseURL!], () => {}, {})).toBe(0);
  const database = join(workspace, '.qaspider/memory.db'); let store = new SqliteStore(database);
  const scopes = ['guest', 'admin', 'user'].map(roleId => ({ applicationId: 'benchmark', environmentId: 'development', roleId, build: 'm1-smoke', tenant: 'public', featureFlags: {} } satisfies Scope));
  const results: unknown[] = [];
  try {
    for (const scope of scopes) {
      const artifacts = new ArtifactStore(store, join(workspace, '.qaspider/artifacts'));
      const engine = new NavigationEngine(store, artifacts, browser);
      const config = navigationConfigSchema.parse({ safeControls: [{ kind: 'testId', value: 'open-help' }, { kind: 'role', role: 'button', name: 'Close help' }], ...(scope.roleId === 'guest' ? {} : { auth: auth(baseURL!, scope.roleId) }) });
      const run = await engine.map(scope, `${baseURL}/`, config, { depth: scope.roleId === 'admin' ? 2 : 1, maxStates: 20, maxActions: 800, maxRequests: 5000, maxMs: 90000, intervalMs: 0 }, undefined, env);
      expect(run.status, run.message).toBe('complete');
      const graph = store.navigation.snapshot(scope);
      expect(graph.states.length).toBeGreaterThan(3); expect(graph.transitions.some(edge => edge.status === 'verified')).toBe(true);
      expect(JSON.stringify(graph)).not.toContain('benchmark-password'); expect(JSON.stringify(graph)).not.toContain('@example.test');
      const headings = graph.states.flatMap(state => state.observation.headings);
      if (scope.roleId === 'guest') { expect(headings).not.toContain('Admin dashboard'); expect(headings).not.toContain('User dashboard'); }
      if (scope.roleId === 'user') { expect(headings).toContain('User dashboard'); expect(headings).not.toContain('User management'); }
      if (scope.roleId === 'admin') expect(headings).toContain('User management');
      expect(graph.states.some(state => state.observation.dialogs.includes('Help'))).toBe(true);
      const verified = graph.transitions.filter(edge => edge.status === 'verified');
      const userManagement = graph.states.find(state => state.observation.headings.includes('User management') && !state.observation.dialogs.length);
      const held = scope.roleId === 'admin' ? verified.filter(edge => edge.fromStateId === userManagement?.id).slice(0, 2).map(edge => edge.id) : [];
      store.navigation.approveBatch(scope, verified.filter(edge => !held.includes(edge.id)).map(edge => edge.id), 'smoke-owner');
      const from = graph.states.find(state => state.observation.url === `${baseURL}/` && !state.observation.dialogs.length)!;
      expect(graph.states.filter(state => state.observation.url === `${baseURL}/about` && !state.observation.dialogs.length)).toHaveLength(1);
      const to = graph.states.find(state => state.observation.url === `${baseURL}/about` && !state.observation.dialogs.length)!;
      const beforeIds = graph.states.map(state => state.id);
      store.close();
      const restarted = JSON.parse(execFileSync(process.execPath, ['dist/packages/cli/src/main.js', 'graph', '--workspace', workspace, '--role', scope.roleId, '--build', scope.build], { encoding: 'utf8' }));
      expect(restarted.states.map((state: { id: string }) => state.id)).toEqual(beforeIds);
      if (scope.roleId === 'guest') {
        const separateProcess = JSON.parse(execFileSync(process.execPath, ['dist/packages/cli/src/main.js', 'replay', '--workspace', workspace, '--role', scope.roleId, '--build', scope.build, '--from', from.id, '--to', to.id, '--no-ai', '--interval', '0'], { encoding: 'utf8' }));
        expect(separateProcess).toMatchObject({ status: 'complete', providerUsed: false });
        results.push({ separateProcessReplay: separateProcess });
      }
      store = new SqliteStore(database);
      expect(store.navigation.snapshot(scope).states.map(state => state.id)).toEqual(beforeIds);
      const replay = await new NavigationEngine(store, new ArtifactStore(store, join(workspace, '.qaspider/artifacts')), browser).replay(scope, from.id, to.id, undefined, env);
      expect(replay.status, replay.message).toBe('complete'); expect(replay.evidenceIds.length).toBeGreaterThan(0);
      const proof = JSON.parse(new ArtifactStore(store, join(workspace, '.qaspider/artifacts')).read(replay.evidenceIds[0]!).toString());
      expect(proof).toMatchObject({ passed: true, precondition: { fingerprint: from.observation.fingerprint }, postcondition: { fingerprint: to.observation.fingerprint } });
      results.push({ role: scope.roleId, mapRun: run, replayRun: replay, statesBeforeAndAfterRestart: beforeIds, from: from.id, to: to.id, providerUsed: false });
    }
    const tenantScope = { ...scopes[1]!, tenant: 'other-tenant' };
    await expect(new NavigationEngine(store, new ArtifactStore(store, join(workspace, '.qaspider/artifacts')), browser).map(tenantScope, `${baseURL}/`, navigationConfigSchema.parse({ auth: auth(baseURL!, 'admin') }), { intervalMs: 0 }, undefined, env)).rejects.toThrow('tenant');
    const artifacts = new ArtifactStore(store, join(workspace, '.qaspider/artifacts'));
    const viewer = createGraphServer(store, artifacts); await new Promise<void>(resolve => viewer.server.listen(0, '127.0.0.1', resolve));
    try {
      const address = viewer.server.address(); if (!address || typeof address === 'string') throw new Error('No viewer address');
      const origin = `http://127.0.0.1:${address.port}`;
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); await page.goto(`${origin}/#token=${viewer.token}`);
      await expect(page.getByRole('heading', { name: 'Navigation Graph', exact: true })).toBeVisible();
      await page.getByLabel('Role').selectOption('admin');
      const adminGraph = store.navigation.snapshot(scopes[1]!);
      await expect(page.getByTestId('state-card')).toHaveCount(adminGraph.states.length);
      await page.getByRole('button', { name: 'Inspect User management', exact: true }).first().click();
      await expect(page.getByTestId('state-details')).toContainText('User management');
      await expect(page.getByTestId('transition-row').first()).toBeVisible();
      const pending = adminGraph.transitions.filter(edge => edge.status === 'verified'); expect(pending).toHaveLength(2);
      for (const edge of pending) await page.getByLabel(`Select transition ${edge.id}`, { exact: true }).check();
      await page.getByRole('button', { name: 'Approve 2 verified transitions', exact: true }).click();
      await expect(page.getByRole('status')).toContainText('Selected navigation transitions approved');
      expect(store.navigation.snapshot(scopes[1]!).transitions.filter(edge => edge.status === 'verified')).toHaveLength(0);
      await expect(page.getByTestId('transition-row').first()).toContainText('approved');
      await page.getByRole('button', { name: 'Inspect User management', exact: true }).first().click();
      await page.getByRole('button', { name: 'View state evidence' }).click(); await expect(page.getByTestId('evidence')).toContainText('fingerprint');
      expect((await request.get(`${origin}/api/scopes`)).status()).toBe(401);
      expect((await request.post(`${origin}/api/approve`, { headers: { 'x-qaspider-token': viewer.token, origin: 'https://evil.test' }, data: {} })).status()).toBe(403);
      const trace = adminGraph.runs.flatMap(run => run.evidenceIds).map(id => store.getArtifact(id)).find(item => item?.kind === 'trace');
      if (trace) expect((await request.get(`${origin}/api/evidence/${trace.id}?scope=${adminGraph.scope!.id}`, { headers: { 'x-qaspider-token': viewer.token } })).status()).toBe(403);
      await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: info.outputPath('graph-ui.png'), fullPage: false }); await page.close();
    } finally { await new Promise<void>(resolve => viewer.server.close(() => resolve())); }
    const stats = await request.post('/__fixtures/stats', { headers: { 'x-fixture-token': 'smoke-fixture-token' } });
    expect(await stats.json()).toMatchObject({ registrations: 0, unsafeVisits: 0 });
    const guestGraph = store.navigation.snapshot(scopes[0]!);
    const rootState = guestGraph.states.find(state => state.observation.url === `${baseURL}/` && !state.observation.dialogs.length)!;
    const aboutState = guestGraph.states.find(state => state.observation.url === `${baseURL}/about` && !state.observation.dialogs.length)!;
    expect((await request.post('/__fixtures/change', { headers: { 'x-fixture-token': 'smoke-fixture-token' }, data: { aboutTitle: 'Changed destination' } })).ok()).toBe(true);
    const changed = await new NavigationEngine(store, artifacts, browser).replay(scopes[0]!, rootState.id, aboutState.id, undefined, env, { intervalMs: 0 });
    expect(changed.status).toBe('failed');
    expect(store.navigation.snapshot(scopes[0]!).transitions.some(edge => edge.toStateId === aboutState.id && edge.status === 'suspect')).toBe(true);
    results.push({ changedDestinationRejected: changed });
    await request.post('/__fixtures/change', { headers: { 'x-fixture-token': 'smoke-fixture-token' }, data: { aboutTitle: 'About the benchmark' } });
    writeFileSync(info.outputPath('persistent-replay.json'), JSON.stringify({ database, results }, null, 2));
    expect(readFileSync(database).length).toBeGreaterThan(0);
  } finally { store.close(); }
});
test('enforces budgets, cancellation, missing credentials and unauthorized origins', async ({ browser, baseURL }, info) => {
  test.setTimeout(30000); const workspace = info.outputPath('workspace'); mkdirSync(workspace, { recursive: true });
  runCli(['init', '--workspace', workspace, '--origin', baseURL!], () => {}, {});
  const store = new SqliteStore(join(workspace, '.qaspider/memory.db')); const artifacts = new ArtifactStore(store, join(workspace, '.qaspider/artifacts'));
  const scope: Scope = { applicationId: 'benchmark', environmentId: 'development', roleId: 'guest', build: 'limits', tenant: 'public', featureFlags: {} };
  const engine = new NavigationEngine(store, artifacts, browser);
  try {
    await expect(engine.map(scope, 'https://unauthorized.example/', navigationConfigSchema.parse({}), { intervalMs: 0 })).rejects.toThrow('seed');
    const limited = await engine.map(scope, `${baseURL}/`, navigationConfigSchema.parse({}), { maxActions: 1, intervalMs: 0 }); expect(limited.status).toBe('budget-exhausted'); expect(limited.actions).toBeLessThanOrEqual(1);
    const controller = new AbortController(); const pending = engine.map({ ...scope, build: 'cancel' }, `${baseURL}/`, navigationConfigSchema.parse({}), { intervalMs: 1000 }, controller.signal); setTimeout(() => controller.abort(), 100);
    expect((await pending).status).toBe('cancelled');
    const missing = await engine.map({ ...scope, roleId: 'admin', build: 'no-credentials' }, `${baseURL}/`, navigationConfigSchema.parse({ auth: auth(baseURL!, 'admin') }), { intervalMs: 0 }, undefined, {});
    expect(missing.status).toBe('blocked'); expect(JSON.stringify(missing)).not.toContain('password=');
  } finally { store.close(); }
});
test('imports storage state without persisting session secrets in graph data', async ({ browser, baseURL }, info) => {
  test.setTimeout(30000); const workspace = info.outputPath('workspace'); mkdirSync(workspace, { recursive: true });
  const bootstrap = await browser.newContext();
  try {
    const page = await bootstrap.newPage(); await page.goto(`${baseURL}/login`); await page.getByLabel('Email').fill('user@example.test'); await page.getByLabel('Password').fill('benchmark-password'); await page.getByRole('button', { name: 'Sign in' }).click(); await expect(page.getByRole('heading', { name: 'User dashboard' })).toBeVisible();
    const statePath = join(workspace, 'private-auth.json'); const state = await bootstrap.storageState({ path: statePath });
    runCli(['init', '--workspace', workspace, '--origin', baseURL!], () => {}, {});
    const store = new SqliteStore(join(workspace, '.qaspider/memory.db'));
    try {
      store.createRole({ id: 'reused-user', environmentId: 'development', name: 'Reused user', auth: { kind: 'storage-state', storageStateEnv: 'STORAGE_STATE_FILE' } });
      const scope: Scope = { applicationId: 'benchmark', environmentId: 'development', roleId: 'reused-user', build: 'state-fixture', tenant: 'public', featureFlags: {} };
      const run = await new NavigationEngine(store, new ArtifactStore(store, join(workspace, '.qaspider/artifacts')), browser).map(scope, `${baseURL}/`, navigationConfigSchema.parse({ auth: { ...auth(baseURL!, 'user'), url: `${baseURL}/dashboard` } }), { depth: 1, intervalMs: 0 }, undefined, { STORAGE_STATE_FILE: statePath });
      expect(run.status, run.message).toBe('complete'); const graph = store.navigation.snapshot(scope); expect(graph.states.some(state => state.observation.headings.includes('User dashboard'))).toBe(true);
      for (const cookie of state.cookies) expect(JSON.stringify(graph)).not.toContain(cookie.value);
      expect(JSON.stringify(graph)).not.toContain(statePath);
    } finally { store.close(); }
  } finally { await bootstrap.close(); }
});
