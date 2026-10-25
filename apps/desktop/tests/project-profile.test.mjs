import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PlanStore } from '../electron/plan-store.mjs';
import { genericProposal } from './fixtures/generic-plan.mjs';
import { approve } from './fixtures/approved-plan.mjs';

const context = { mode: 'selected', url: 'https://example.test/' };
function mutate(store, id, action) {
  return store.conversations.profiles.mutate({ projectId: id, version: store.conversations.profiles.get(id).version, action });
}

describe('VNext project foundation', () => {
  it('creates distinct persistent identities with minimal input and isolates notes across projects', () => {
    const folder = mkdtempSync(join(tmpdir(), 'qaspider-profiles-')), path = join(folder, 'plans.sqlite');
    let store = new PlanStore(path);
    try {
      const a = store.conversations.createProject({ title: 'A' }), b = store.conversations.createProject({ title: 'B' });
      const agentId = store.conversations.profiles.get(a).agentId;
      expect(agentId).not.toBe(store.conversations.profiles.get(b).agentId);
      mutate(store, a, { type: 'note', topic: 'domain', text: 'Scheduling for clinics.' });
      const conversation = store.conversations.create({ projectId: a, title: 'Questions', context });
      store.conversations.message(conversation.id, 'user', 'Original task');
      store.close(); store = new PlanStore(path);
      expect(store.conversations.profiles.get(a).agentId).toBe(agentId);
      expect(store.conversations.profiles.get(a).notes[0]).toMatchObject({ body: 'Scheduling for clinics.', authority: 'USER_STATEMENT' });
      expect(store.conversations.profiles.get(b).notes).toEqual([]);
      expect(store.conversations.get(conversation.id).messages[0].body).toBe('Original task');
      expect(store.projectBackupPath).toBeNull();
    } finally { store.close(); rmSync(folder, { recursive: true, force: true }); }
  });

  it('backs up M8 before additive migration, preserves approvals and backfills stable identities once', () => {
    const folder = mkdtempSync(join(tmpdir(), 'qaspider-profile-migration-')), path = join(folder, 'plans.sqlite');
    let store = new PlanStore(path);
    try {
      const id = store.conversations.createProject({ title: 'Existing M8 project' });
      const approved = approve(store, store.create(genericProposal()));
      for (const table of ['desktop_project_notes', 'desktop_project_profile_history', 'desktop_project_profiles']) store.db.exec(`DROP TABLE ${table}`);
      store.db.prepare('DELETE FROM desktop_additive_migrations WHERE name=?').run('vnext-project-foundation-1');
      store.close(); store = new PlanStore(path);
      expect(store.get(approved.planId)).toEqual(approved);
      expect(store.backupPath).toBeNull(); expect(store.projectBackupPath).toBeTruthy();
      expect(statSync(store.projectBackupPath).mode & 0o777).toBe(0o600);
      expect(statSync(join(folder, 'desktop-backups')).mode & 0o777).toBe(0o700);
      const snapshot = new DatabaseSync(store.projectBackupPath, { readOnly: true });
      try {
        expect(snapshot.prepare('PRAGMA integrity_check').get().integrity_check).toBe('ok');
        expect(snapshot.prepare("SELECT name FROM sqlite_master WHERE name='desktop_project_profiles'").get()).toBeUndefined();
        expect(snapshot.prepare('SELECT hash FROM desktop_plan_approvals').get().hash).toBe(approved.hash);
      } finally { snapshot.close(); }
      const identity = store.conversations.profiles.get(id).agentId;
      store.close(); store = new PlanStore(path);
      expect(store.projectBackupPath).toBeNull(); expect(readdirSync(join(folder, 'desktop-backups'))).toHaveLength(1);
      expect(store.conversations.profiles.get(id).agentId).toBe(identity);
    } finally { store.close(); rmSync(folder, { recursive: true, force: true }); }
  });

  it('fails closed when an M8 backup cannot be created', () => {
    const folder = mkdtempSync(join(tmpdir(), 'qaspider-profile-backup-')), path = join(folder, 'plans.sqlite');
    const store = new PlanStore(path);
    for (const table of ['desktop_project_notes', 'desktop_project_profile_history', 'desktop_project_profiles']) store.db.exec(`DROP TABLE ${table}`);
    store.db.prepare('DELETE FROM desktop_additive_migrations WHERE name=?').run('vnext-project-foundation-1'); store.close();
    writeFileSync(join(folder, 'desktop-backups'), 'This is a file.');
    try {
      expect(() => new PlanStore(path)).toThrow();
      const db = new DatabaseSync(path, { readOnly: true });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='desktop_project_profiles'").get()).toBeUndefined(); db.close();
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });

  it('rejects stale writes atomically and retains initial and subsequent source revisions', () => {
    const store = new PlanStore(':memory:');
    try {
      const id = store.conversations.createProject({ title: 'Original', description: 'Original description' });
      mutate(store, id, { type: 'profile', title: 'Renamed', description: 'Updated description' });
      expect(() => store.conversations.profiles.mutate({ projectId: id, version: 1, action: { type: 'note', topic: 'roles', text: 'Admin' } })).toThrow('Project changed');
      expect(store.conversations.profiles.get(id).notes).toEqual([]);
      const history = store.db.prepare('SELECT action_json FROM desktop_project_profile_history WHERE project_id=? ORDER BY version').all(id).map(row => JSON.parse(row.action_json));
      expect(history).toEqual([{ type: 'created', title: 'Original', description: 'Original description' }, { type: 'profile', title: 'Renamed', description: 'Updated description' }]);
    } finally { store.close(); }
  });

  it('asks progressive optional questions, remembers skips, and accepts later context', () => {
    const store = new PlanStore(':memory:');
    try {
      const id = store.conversations.createProject({ title: 'Clinic' });
      expect(store.conversations.profiles.get(id).nextQuestion.topic).toBe('purpose');
      mutate(store, id, { type: 'note', topic: 'purpose', text: 'Books appointments.' });
      expect(store.conversations.profiles.get(id).nextQuestion.topic).toBe('domain');
      mutate(store, id, { type: 'skip', topic: 'domain' });
      expect(store.conversations.profiles.get(id).nextQuestion.topic).toBe('roles');
      mutate(store, id, { type: 'note', topic: 'domain', text: 'Healthcare' });
      expect(store.conversations.profiles.get(id).skipped).not.toContain('domain');
      for (const topic of ['roles', 'environments', 'sources', 'setup']) mutate(store, id, { type: 'skip', topic });
      expect(store.conversations.profiles.get(id).nextQuestion).toBeNull();
    } finally { store.close(); }
  });

  it('archives reversibly without deleting conversations or treating organization as permission', () => {
    const store = new PlanStore(':memory:');
    try {
      const id = store.conversations.createProject({ title: 'Archive me' });
      const conversation = store.conversations.create({ projectId: id, title: 'Retain', context });
      const agentId = store.conversations.profiles.get(id).agentId;
      mutate(store, id, { type: 'archive', archived: true });
      expect(store.conversations.get(conversation.id).title).toBe('Retain');
      expect(store.conversations.list().find(project => project.id === id).archived).toBe(true);
      expect(() => store.conversations.create({ projectId: id, title: 'New', context })).toThrow('Restore');
      expect(() => mutate(store, id, { type: 'note', topic: 'roles', text: 'Editor' })).toThrow('Restore');
      mutate(store, id, { type: 'archive', archived: false });
      expect(store.conversations.profiles.get(id).agentId).toBe(agentId);
      expect(store.conversations.create({ projectId: id, title: 'New', context }).id).toBeTruthy();
    } finally { store.close(); }
  });

  it('validates bounded inputs and prevents renderer-supplied authority or identity', () => {
    const store = new PlanStore(':memory:');
    try {
      const id = store.conversations.createProject({ title: 'Scoped' });
      expect(() => mutate(store, id, { type: 'note', topic: 'roles', text: 'a'.repeat(4001) })).toThrow();
      expect(() => mutate(store, id, { type: 'note', topic: 'roles', text: 'Admin', authority: 'VERIFIED' })).toThrow();
      expect(() => store.conversations.createProject({ title: 'Forged', agentId: id })).toThrow();
      expect(() => store.conversations.profiles.get(crypto.randomUUID())).toThrow('not found');
      expect(() => mutate(store, 'legacy', { type: 'archive', archived: true })).toThrow();
    } finally { store.close(); }
  });
});
