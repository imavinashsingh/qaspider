import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const projectId = z.union([z.string().uuid(), z.literal('legacy')]);
const topic = z.enum(['purpose', 'domain', 'roles', 'environments', 'sources', 'setup']);
const prompts = {
  purpose: 'What does the application do?', domain: 'Which business domain does it belong to?',
  roles: 'Which roles use the application?', environments: 'Which development or QA environment may be tested?',
  sources: 'Do you have documentation or existing test cases?', setup: 'Are there known login or setup requirements? Use references only; leave credentials out.',
};
const action = z.discriminatedUnion('type', [
  z.object({ type: z.literal('profile'), title: z.string().trim().min(1).max(200), description: z.string().trim().max(4000) }).strict(),
  z.object({ type: z.literal('archive'), archived: z.boolean() }).strict(),
  z.object({ type: z.literal('note'), topic, text: z.string().trim().min(1).max(4000) }).strict(),
  z.object({ type: z.literal('skip'), topic }).strict(),
]);
export const projectMutation = z.object({ projectId: z.string().uuid(), version: z.number().int().positive(), action }).strict();

/** User-sourced profile context only. No model, browser permission or verified-memory authority. */
export class ProjectProfiles {
  constructor(store) {
    this.store = store; this.db = store.db;
    store.atomic(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS desktop_project_profiles(
          project_id TEXT PRIMARY KEY REFERENCES desktop_projects(id), agent_id TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL, archived INTEGER NOT NULL CHECK(archived IN (0,1)), version INTEGER NOT NULL,
          skipped_json TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS desktop_project_notes(
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES desktop_projects(id), topic TEXT NOT NULL,
          body TEXT NOT NULL, authority TEXT NOT NULL CHECK(authority='USER_STATEMENT'), created_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS desktop_project_notes_scope ON desktop_project_notes(project_id,created_at);
        CREATE TABLE IF NOT EXISTS desktop_project_profile_history(
          project_id TEXT NOT NULL REFERENCES desktop_projects(id), version INTEGER NOT NULL,
          action_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(project_id,version));
      `);
      for (const row of this.db.prepare('SELECT id,created_at FROM desktop_projects').all()) this.initialize(row.id, row.created_at);
      this.db.prepare('INSERT OR IGNORE INTO desktop_additive_migrations VALUES(?,?)').run('vnext-project-foundation-1', new Date().toISOString());
    });
  }
  initialize(id, now, description = '') {
    const result = this.db.prepare('INSERT OR IGNORE INTO desktop_project_profiles VALUES(?,?,?,?,?,?,?)').run(id, randomUUID(), description, 0, 1, '[]', now);
    if (result.changes) this.db.prepare('INSERT INTO desktop_project_profile_history VALUES(?,?,?,?)').run(id, 1,
      JSON.stringify({ type: 'created', title: this.db.prepare('SELECT title FROM desktop_projects WHERE id=?').get(id).title, description }), now);
  }
  get(input) {
    const id = projectId.parse(input);
    const row = this.db.prepare(`SELECT p.id,p.title,p.created_at AS createdAt,f.agent_id AS agentId,f.description,
      f.archived,f.version,f.skipped_json,f.updated_at AS updatedAt FROM desktop_projects p
      JOIN desktop_project_profiles f ON f.project_id=p.id WHERE p.id=?`).get(id);
    if (!row) throw new Error('Project not found.');
    const notes = this.db.prepare('SELECT id,topic,body,authority,created_at AS createdAt FROM desktop_project_notes WHERE project_id=? ORDER BY rowid DESC LIMIT 100').all(id).reverse();
    const skipped = JSON.parse(row.skipped_json);
    const answered = new Set(this.db.prepare('SELECT DISTINCT topic FROM desktop_project_notes WHERE project_id=?').all(id).map(item => item.topic));
    if (row.description) answered.add('purpose');
    const next = Object.keys(prompts).find(key => !answered.has(key) && !skipped.includes(key));
    const { skipped_json, ...profile } = row;
    return { ...profile, archived: Boolean(row.archived), skipped, notes, nextQuestion: next ? { topic: next, text: prompts[next] } : null };
  }
  mutate(input) {
    const request = projectMutation.parse(input);
    return this.store.atomic(() => {
      const current = this.get(request.projectId), now = new Date().toISOString(), change = request.action;
      if (current.version !== request.version) throw new Error('Project changed; reload before saving.');
      if (current.archived && change.type !== 'archive') throw new Error('Restore the archived project before editing.');
      let description = current.description, skipped = current.skipped, archived = current.archived;
      if (change.type === 'profile') {
        description = change.description;
        this.db.prepare('UPDATE desktop_projects SET title=? WHERE id=?').run(change.title, current.id);
      } else if (change.type === 'archive') archived = change.archived;
      else if (change.type === 'skip') skipped = [...new Set([...skipped, change.topic])];
      else {
        this.db.prepare('INSERT INTO desktop_project_notes VALUES(?,?,?,?,?,?)').run(randomUUID(), current.id, change.topic, change.text, 'USER_STATEMENT', now);
        skipped = skipped.filter(key => key !== change.topic);
      }
      this.db.prepare('UPDATE desktop_project_profiles SET description=?,archived=?,version=version+1,skipped_json=?,updated_at=? WHERE project_id=? AND version=?')
        .run(description, Number(archived), JSON.stringify(skipped), now, current.id, request.version);
      this.db.prepare('INSERT INTO desktop_project_profile_history VALUES(?,?,?,?)').run(current.id, current.version + 1, JSON.stringify(change), now);
      return this.get(current.id);
    });
  }
}
