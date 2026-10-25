import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { privateDirectory } from '../../../packages/storage/src/filesystem.ts';
import { validateTarget } from './browser.mjs';
import { ProjectProfiles } from './project-profile.mjs';

export const applicationContext = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('selected'), url: z.string().max(4096).transform(value => validateTarget(value).href) }).strict(),
  z.object({ mode: z.literal('controlled'), url: z.string().regex(/^\/(?!\/)[a-zA-Z0-9/_-]*$/).max(1000) }).strict(),
]);
const id = z.string().uuid();
const title = z.string().trim().min(1).max(200);

/** Online SQLite snapshot, before any consolidation schema change. Never copied through renderer IPC. */
export function backupBeforeConsolidation(db, path) {
  if (path === ':memory:' || !existsSync(path)) return null;
  const migrated = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='desktop_conversations'").get();
  const existing = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='desktop_plans'").get();
  if (migrated || !existing) return null;
  return snapshotDatabase(db, path, 'consolidation');
}

export function backupBeforeProjectFoundation(db, path) {
  if (path === ':memory:' || !existsSync(path)) return null;
  const existing = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='desktop_conversations'").get();
  const ledger = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='desktop_additive_migrations'").get();
  const migrated = ledger && db.prepare('SELECT 1 FROM desktop_additive_migrations WHERE name=?').get('vnext-project-foundation-1');
  if (!existing || migrated) return null;
  return snapshotDatabase(db, path, 'project-foundation');
}

export function snapshotDatabase(db, path, name) {
  const folder = privateDirectory(join(dirname(path), 'desktop-backups'));
  const backup = join(folder, `before-${name}-${randomUUID()}.sqlite`);
  db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
  chmodSync(backup, 0o600);
  const check = new DatabaseSync(backup, { readOnly: true });
  try { if (check.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Backup integrity check failed.'); }
  finally { check.close(); }
  return backup;
}

/** Additive associations only: existing approval, report and knowledge rows remain untouched. */
export class ConversationStore {
  constructor(store) {
    this.store = store; this.db = store.db;
    store.atomic(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS desktop_projects(id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS desktop_conversations(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES desktop_projects(id), title TEXT NOT NULL, context_json TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS desktop_messages(id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES desktop_conversations(id), role TEXT NOT NULL CHECK(role IN ('user','assistant')), body TEXT NOT NULL, plan_id TEXT REFERENCES desktop_plans(id), report_id TEXT REFERENCES desktop_plan_executions(id), created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS desktop_conversation_plans(plan_id TEXT PRIMARY KEY REFERENCES desktop_plans(id), conversation_id TEXT NOT NULL REFERENCES desktop_conversations(id));
        CREATE TABLE IF NOT EXISTS desktop_settings(id INTEGER PRIMARY KEY CHECK(id=1), settings_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS desktop_additive_migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
        INSERT OR IGNORE INTO desktop_additive_migrations VALUES('desktop-consolidation-1',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      `);
      this.db.prepare('INSERT OR IGNORE INTO desktop_projects VALUES(?,?,?)').run('legacy', 'Legacy workspace', new Date().toISOString());
      this.db.prepare('INSERT OR IGNORE INTO desktop_conversations VALUES(?,?,?,?,?,?)').run('legacy', 'legacy', 'Previous plans and reports', JSON.stringify({ mode: 'controlled', url: '/login' }), 1, new Date().toISOString());
      for (const row of this.db.prepare('SELECT id,original_json FROM desktop_plans WHERE id NOT IN (SELECT plan_id FROM desktop_conversation_plans)').all()) {
        this.linkPlan('legacy', row.id, `Previous plan: ${JSON.parse(row.original_json).ticket.title}`);
      }
    });
    this.profiles = new ProjectProfiles(store);
  }
  list() {
    return this.db.prepare('SELECT * FROM desktop_projects ORDER BY created_at,id').all().map(project => ({ ...project, ...this.profiles.get(project.id),
      conversations: this.db.prepare('SELECT id,title FROM desktop_conversations WHERE project_id=? ORDER BY rowid').all(project.id),
    }));
  }
  createProject(input) {
    const request = z.object({ title, description: z.string().trim().max(4000).default('') }).strict().parse(input), projectId = randomUUID();
    this.store.atomic(() => {
      const now = new Date().toISOString();
      this.db.prepare('INSERT INTO desktop_projects VALUES(?,?,?)').run(projectId, request.title, now);
      this.profiles.initialize(projectId, now, request.description);
    });
    return projectId;
  }
  create(input) {
    const request = z.object({ projectId: id, title, context: applicationContext }).strict().parse(input), conversationId = randomUUID();
    if (this.profiles.get(request.projectId).archived) throw new Error('Restore the archived project before adding conversations.');
    this.db.prepare('INSERT INTO desktop_conversations VALUES(?,?,?,?,?,?)').run(conversationId, request.projectId, request.title, JSON.stringify(request.context), 1, new Date().toISOString());
    return this.get(conversationId);
  }
  get(conversationId) {
    z.union([id, z.literal('legacy')]).parse(conversationId);
    const row = this.db.prepare('SELECT * FROM desktop_conversations WHERE id=?').get(conversationId);
    if (!row) throw new Error('Conversation not found.');
    return { id: row.id, projectId: row.project_id, title: row.title, context: applicationContext.parse(JSON.parse(row.context_json)), version: row.version,
      messages: this.db.prepare('SELECT id,role,body,plan_id AS planId,report_id AS reportId,created_at AS createdAt FROM desktop_messages WHERE conversation_id=? ORDER BY rowid').all(conversationId),
    };
  }
  setContext(input) {
    const request = z.object({ conversationId: id, version: z.number().int().positive(), context: applicationContext }).strict().parse(input);
    if (this.db.prepare('UPDATE desktop_conversations SET context_json=?,version=version+1 WHERE id=? AND version=?').run(JSON.stringify(request.context), request.conversationId, request.version).changes !== 1) throw new Error('Context changed; reload the conversation.');
    return this.get(request.conversationId);
  }
  message(conversationId, role, body, planId = null, reportId = null) {
    this.get(conversationId);
    this.db.prepare('INSERT INTO desktop_messages VALUES(?,?,?,?,?,?,?)').run(randomUUID(), conversationId, role, z.string().max(16000).parse(body), planId, reportId, new Date().toISOString());
  }
  linkPlan(conversationId, planId, body) {
    this.db.prepare('INSERT INTO desktop_conversation_plans VALUES(?,?)').run(planId, conversationId);
    this.message(conversationId, 'assistant', body, planId);
  }
  forPlan(planId) {
    const row = this.db.prepare('SELECT conversation_id FROM desktop_conversation_plans WHERE plan_id=?').get(planId);
    return row ? this.get(row.conversation_id) : null;
  }
  linkReport(report) {
    const conversation = this.forPlan(report.planId);
    if (conversation && !this.db.prepare('SELECT 1 FROM desktop_messages WHERE report_id=?').get(report.id)) this.message(conversation.id, 'assistant', `Execution ${report.outcome}. Evidence and assertions are saved with this report.`, report.planId, report.id);
  }
}
