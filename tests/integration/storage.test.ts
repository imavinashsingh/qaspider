import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteStore } from '../../packages/storage/src/index.js';
const roots: string[] = [];
const stores: SqliteStore[] = [];
function setup() { const root = mkdtempSync(join(tmpdir(), 'qaspider-db-')); roots.push(root); const path = join(root, 'memory.db'); const store = new SqliteStore(path); stores.push(store); return { store, path }; }
afterEach(() => { stores.splice(0).forEach(s => s.close()); roots.splice(0).forEach(r => rmSync(r, { recursive: true, force: true })); });
describe('SQLite repositories and migrations', () => {
  it('migrates fresh storage, is repeatable, persists all M0 entities on reopen', () => {
    const { store, path } = setup();
    expect(store.migrationVersions()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    store.migrate(); expect(store.migrationVersions()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    store.createApplication({ id: 'app', name: 'Portal' });
    store.createEnvironment({ id: 'qa', applicationId: 'app', name: 'QA', kind: 'qa', allowedOrigins: ['http://127.0.0.1:3000'] });
    store.createRole({ id: 'admin', environmentId: 'qa', name: 'Admin', auth: { kind: 'form', usernameEnv: 'QA_USER', passwordEnv: 'QA_PASSWORD' } });
    store.setSettings({ retentionDays: 7, globalQuotaBytes: 1000, perRunQuotaBytes: 100, captureFullTraces: true });
    store.close();
    const reopened = new SqliteStore(path); stores.push(reopened);
    expect(reopened.getApplication('app')?.name).toBe('Portal');
    expect(reopened.getEnvironment('qa')?.allowedOrigins).toEqual(['http://127.0.0.1:3000']);
    expect(reopened.getRole('admin')?.auth).toMatchObject({ passwordEnv: 'QA_PASSWORD' });
    expect(reopened.getSettings().retentionDays).toBe(7);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
  it('enforces foreign keys, uniqueness and transaction rollback', () => {
    const { store } = setup();
    expect(() => store.createEnvironment({ id: 'qa', applicationId: 'missing', name: 'QA', kind: 'qa', allowedOrigins: ['http://localhost:3000'] })).toThrow();
    store.createApplication({ id: 'app', name: 'Portal' });
    expect(() => store.createApplication({ id: 'app2', name: 'Portal' })).toThrow();
    expect(() => store.transaction(() => { store.createApplication({ id: 'rollback', name: 'Rollback' }); throw new Error('rollback'); })).toThrow('rollback');
    expect(store.getApplication('rollback')).toBeUndefined();
  });
  it('rejects inline secrets, invalid origins/settings and exposes safe defaults', () => {
    const { store } = setup();
    expect(store.getSettings()).toEqual({ retentionDays: 14, globalQuotaBytes: 10 * 1024 ** 3, perRunQuotaBytes: 1024 ** 3, captureFullTraces: true });
    expect(() => store.createRole({ id: 'r', environmentId: 'qa', name: 'Role', auth: { kind: 'form', username: 'secret', password: 'secret' } } as never)).toThrow();
    expect(() => store.setSettings({ ...store.getSettings(), retentionDays: 0 })).toThrow();
    expect(() => store.createEnvironment({ id: 'qa', applicationId: 'app', name: 'QA', kind: 'qa', allowedOrigins: ['https://site.test/path'] })).toThrow();
  });
});
it('refuses migration drift and databases newer than the installed application', async () => {
  const { default: Database } = await import('better-sqlite3');
  const { store, path } = setup(); store.close();
  const raw = new Database(path); raw.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 1').run('tampered'); raw.close();
  expect(() => new SqliteStore(path)).toThrow('checksum');
  const { store: other, path: otherPath } = setup(); other.close();
  const future = new Database(otherPath); future.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(999, 'future', 'today'); future.close();
  expect(() => new SqliteStore(otherPath)).toThrow('newer');
});
