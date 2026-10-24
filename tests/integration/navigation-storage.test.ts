import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { SqliteStore, ArtifactStore } from '../../packages/storage/src/index.js';
import { navigationConfigSchema, normalizeObservation } from '../../packages/core/src/navigation.js';
import type { Scope } from '../../packages/core/src/index.js';
const resources: Array<() => void> = [];
afterEach(() => resources.splice(0).forEach(fn => fn()));
const scope: Scope = { applicationId: 'app', environmentId: 'qa', roleId: 'guest', tenant: 'public', build: 'b1', featureFlags: {} };
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'qaspider-nav-db-')); const path = join(root, 'memory.db'); const store = new SqliteStore(path);
  store.createApplication({ id: 'app', name: 'App' }); store.createEnvironment({ id: 'qa', applicationId: 'app', name: 'QA', kind: 'qa', allowedOrigins: ['http://localhost:3000'] });
  for (const id of ['guest', 'admin']) store.createRole({ id, environmentId: 'qa', name: id, auth: { kind: 'guest' } });
  resources.push(() => { store.close(); rmSync(root, { force: true, recursive: true }); });
  const artifacts = new ArtifactStore(store, join(root, 'artifacts')); const config = navigationConfigSchema.parse({});
  store.navigation.ensureScope(scope, 'http://localhost:3000', config);
  const run = store.navigation.startRun(scope, 'map');
  const evidence = artifacts.put(run.id, Buffer.from('{"checked":true}'), 'event-log');
  const first = store.navigation.saveState(scope, normalizeObservation({ url: 'http://localhost:3000/', headings: ['Home'], controls: [], dialogs: [] }, config), evidence.id);
  const second = store.navigation.saveState(scope, normalizeObservation({ url: 'http://localhost:3000/settings', headings: ['Settings'], controls: [], dialogs: [] }, config), evidence.id);
  const edge = store.navigation.saveTransition(scope, first.id, second.id, { kind: 'link', locator: { kind: 'role', role: 'link', name: 'Settings' }, targetUrl: 'http://localhost:3000/settings' });
  return { store, path, root, first, second, edge, evidence, run };
}
it('deduplicates states, preserves scopes and persists approved paths after reopen', () => {
  const { store, path, first, edge, evidence, run } = setup(); const repo = store.navigation;
  const before = repo.snapshot(scope); repo.saveState(scope, first.observation, evidence.id); expect(repo.snapshot(scope).states).toHaveLength(before.states.length);
  repo.recordVerification(scope, edge.id, run.id, evidence.id, true);
  const approval = repo.approveBatch(scope, [edge.id], 'qa-owner'); expect(approval.transitionIds).toEqual([edge.id]);
  store.close(); const reopened = new SqliteStore(path);
  try { expect(reopened.navigation.snapshot(scope).transitions[0]?.status).toBe('approved'); expect(reopened.navigation.snapshot(scope).approvals).toHaveLength(1); expect(reopened.navigation.snapshot({ ...scope, roleId: 'admin' }).states).toHaveLength(0); } finally { reopened.close(); }
});
it('approves batches atomically only when every scoped edge has passing replay evidence', () => {
  const { store, edge, evidence, run, first, second } = setup();
  expect(() => store.navigation.approveBatch(scope, [edge.id], 'owner')).toThrow();
  store.navigation.recordVerification(scope, edge.id, run.id, evidence.id, true);
  expect(() => store.navigation.approveBatch({ ...scope, tenant: 'other' }, [edge.id], 'owner')).toThrow();
  expect(() => store.navigation.approveBatch(scope, [edge.id, 'missing'], 'owner')).toThrow();
  expect(store.navigation.snapshot(scope).transitions[0]?.status).toBe('verified');
  expect(() => store.navigation.saveTransition(scope, first.id, second.id, { kind: 'link', locator: { kind: 'role', role: 'link', name: 'Delete' }, targetUrl: 'http://localhost:3000/delete' })).toThrow();
  store.navigation.recordVerification(scope, edge.id, run.id, evidence.id, false);
  expect(store.navigation.snapshot(scope).transitions[0]?.status).toBe('suspect'); expect(() => store.navigation.approveBatch(scope, [edge.id], 'owner')).toThrow();
});
it('upgrades an actual M0 database without modifying the original migration or losing roles/settings', () => {
  const root = mkdtempSync(join(tmpdir(), 'qaspider-upgrade-')); const path = join(root, 'memory.db'); resources.push(() => rmSync(root, { force: true, recursive: true }));
  const db = new Database(path); db.exec(readFileSync('packages/storage/migrations/001_foundation.sql', 'utf8')); db.exec("INSERT INTO applications VALUES ('old', 'Existing M0')"); db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT'); db.prepare('INSERT INTO schema_migrations VALUES (1, ?, ?)').run(createHash('sha256').update(readFileSync('packages/storage/migrations/001_foundation.sql')).digest('hex'), 'm0'); db.close();
  const upgraded = new SqliteStore(path); try { expect(upgraded.migrationVersions()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); expect(upgraded.getApplication('old')?.name).toBe('Existing M0'); } finally { upgraded.close(); }
});
it('rejects states and evidence from another role, tenant, environment or build', () => {
  const { store, first, second, evidence, edge, run } = setup();
  const config = navigationConfigSchema.parse({});
  expect(() => store.navigation.saveState(scope, normalizeObservation({ url: 'https://unauthorized.example/', headings: ['External'], controls: [], dialogs: [] }, config), evidence.id)).toThrow('origin');
  const admin = { ...scope, roleId: 'admin' }; store.navigation.ensureScope(admin, 'http://localhost:3000', config);
  expect(() => store.navigation.saveTransition(admin, first.id, second.id, edge.action)).toThrow('Cross-scope');
  expect(() => store.navigation.saveState(admin, first.observation, evidence.id)).toThrow('cross-scope');
  expect(() => store.navigation.recordVerification(admin, edge.id, run.id, evidence.id, true)).toThrow();
  for (const other of [{ ...scope, tenant: 'other' }, { ...scope, build: 'other' }]) expect(() => store.navigation.approveBatch(other, [edge.id], 'owner')).toThrow();
  store.createEnvironment({ id: 'qa2', applicationId: 'app', name: 'QA2', kind: 'qa', allowedOrigins: ['http://localhost:3000'] });
  store.createRole({ id: 'guest2', environmentId: 'qa2', name: 'Guest2', auth: { kind: 'guest' } });
  const environmentScope = { ...scope, environmentId: 'qa2', roleId: 'guest2' };
  store.navigation.ensureScope(environmentScope, 'http://localhost:3000', config);
  expect(() => store.navigation.saveTransition(environmentScope, first.id, second.id, edge.action)).toThrow('Cross-scope');
});
