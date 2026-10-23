import { mkdtempSync, rmSync, statSync, symlinkSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteStore, ArtifactStore } from '../../packages/storage/src/index.js';
const cleanup: Array<() => void> = [];
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'qaspider-artifacts-')); const db = new SqliteStore(join(root, 'memory.db'));
  db.setSettings({ retentionDays: 1, globalQuotaBytes: 10, perRunQuotaBytes: 6, captureFullTraces: true });
  let now = Date.now(); const artifacts = new ArtifactStore(db, join(root, 'artifacts'), () => now);
  cleanup.push(() => { db.close(); rmSync(root, { force: true, recursive: true }); });
  return { db, root, artifacts, advance: () => { now += 2 * 86400000; } };
}
afterEach(() => cleanup.splice(0).forEach(f => f()));
describe('artifact quota, lifecycle and filesystem boundaries', () => {
  it('enforces per-run and global quotas across service instances', () => {
    const { db, root, artifacts } = setup();
    artifacts.put('run-a', Buffer.from('123456'), 'trace');
    expect(() => artifacts.put('run-a', Buffer.from('7'), 'screenshot')).toThrow(/run quota/i);
    const second = new ArtifactStore(db, join(root, 'artifacts'));
    expect(() => second.put('run-b', Buffer.from('12345'), 'trace')).toThrow(/global quota/i);
    expect(db.listArtifacts()).toHaveLength(1);
  });
  it('prunes expired inactive artifacts before writes and preserves tombstones', () => {
    const { db, artifacts, advance } = setup();
    const expired = artifacts.put('old', Buffer.from('123456'), 'trace');
    artifacts.finishRun('old'); advance();
    artifacts.put('new', Buffer.from('123456'), 'trace');
    expect(db.getArtifact(expired.id)?.status).toBe('expired');
    expect(() => artifacts.read(expired.id)).toThrow(/unavailable/);
    expect(db.listArtifacts()).toHaveLength(2);
  });
  it('does not prune active runs and supports explicit deletion', () => {
    const { artifacts, advance, db } = setup();
    const active = artifacts.put('active', Buffer.from('123456'), 'trace'); advance();
    expect(() => artifacts.put('other', Buffer.from('12345'), 'trace')).toThrow(/global quota/i);
    artifacts.delete(active.id);
    expect(db.getArtifact(active.id)?.status).toBe('deleted');
  });
  it('uses private modes, rejects traversal and symlink roots/files', () => {
    const { db, root, artifacts } = setup();
    expect(() => artifacts.put('../escape', Buffer.from('x'), 'trace')).toThrow();
    const record = artifacts.put('safe', Buffer.from('data'), 'trace');
    const path = join(root, 'artifacts', record.id);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(root, 'artifacts')).mode & 0o777).toBe(0o700);
    expect(artifacts.read(record.id).toString()).toBe('data');
    rmSync(path); symlinkSync(join(root, 'memory.db'), path);
    expect(() => artifacts.read(record.id)).toThrow();
    expect(() => artifacts.delete(record.id)).toThrow();
    expect(existsSync(join(root, 'memory.db'))).toBe(true);
    const link = join(root, 'link'); symlinkSync(join(root, 'artifacts'), link);
    expect(() => new ArtifactStore(db, link)).toThrow();
    expect(readFileSync(join(root, 'memory.db')).length).toBeGreaterThan(0);
  });
});
it('accounts for orphaned physical files and honors disabled trace capture', async () => {
  const { writeFileSync } = await import('node:fs');
  const { db, root, artifacts } = setup();
  writeFileSync(join(root, 'artifacts', 'orphan'), '1234567890');
  expect(() => artifacts.put('new', Buffer.from('x'), 'event-log')).toThrow('Global quota');
  expect(db.listArtifacts()).toHaveLength(0);
  rmSync(join(root, 'artifacts', 'orphan'));
  db.setSettings({ ...db.getSettings(), captureFullTraces: false });
  expect(() => artifacts.put('new', Buffer.from('x'), 'trace')).toThrow('disabled');
  expect(artifacts.put('new', Buffer.from('x'), 'event-log').sizeBytes).toBe(1);
});
it('enforces quotas using a second SQLite connection and persists lifecycle across reopening', () => {
  const { db, root, artifacts } = setup();
  const record = artifacts.put('shared', Buffer.from('123456'), 'trace');
  const second = new SqliteStore(join(root, 'memory.db'));
  try {
    const service = new ArtifactStore(second, join(root, 'artifacts'));
    expect(() => service.put('shared', Buffer.from('x'), 'trace')).toThrow('run quota');
    expect(() => service.put('other', Buffer.from('12345'), 'trace')).toThrow('Global quota');
    service.finishRun('shared'); expect(db.getArtifact(record.id)?.active).toBe(false);
  } finally { second.close(); }
});
