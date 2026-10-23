import Database from 'better-sqlite3';
import { chmodSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { applicationSchema, environmentSchema, roleSchema, settingsSchema, type Application, type Environment, type RoleProfile, type WorkspaceRepository, type WorkspaceSettings, type ArtifactRecord, type ArtifactRepository } from '../../core/src/index.js';
import { assertNoSymlinks, privateDirectory } from './filesystem.js';
import { SqliteNavigationRepository } from './navigation.js';
import { SqliteTestingRepository } from './testing.js';
type Row = Record<string, unknown>;
export class SqliteStore implements WorkspaceRepository, ArtifactRepository {
  private readonly db: Database.Database;
  private closed = false;
  readonly navigation: SqliteNavigationRepository;
  readonly testing: SqliteTestingRepository;
  constructor(path: string) {
    if (path === ':memory:') this.db = new Database(path);
    else {
      const absolute = resolve(path); privateDirectory(dirname(absolute));
      for (const file of [absolute, `${absolute}-wal`, `${absolute}-shm`]) assertNoSymlinks(file);
      this.db = new Database(absolute); chmodSync(absolute, 0o600);
    }
    try {
      this.db.pragma('foreign_keys = ON'); this.db.pragma('busy_timeout = 5000'); this.db.pragma('journal_mode = WAL');
      this.migrate();
      if (path !== ':memory:') for (const suffix of ['-wal', '-shm']) { const sidecar = `${resolve(path)}${suffix}`; if (existsSync(sidecar)) chmodSync(sidecar, 0o600); }
    } catch (error) { this.db.close(); throw error; }
    this.navigation = new SqliteNavigationRepository(this.db, id => this.getEnvironment(id), id => this.getRole(id));
    this.testing = new SqliteTestingRepository(this.db, id => this.getEnvironment(id), id => this.getRole(id));
  }
  migrate(): void {
    const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
    const files = readdirSync(directory).filter(file => /^\d+_[a-z_]+\.sql$/.test(file)).sort();
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT');
    this.transaction(() => {
      const known = new Set(files.map(file => Number(file.split('_')[0])));
      for (const row of this.db.prepare('SELECT version FROM schema_migrations').all() as Row[]) if (!known.has(Number(row.version))) throw new Error('Database schema is newer than this application');
      for (const file of files) {
        const version = Number(file.split('_')[0]); const sql = readFileSync(join(directory, file), 'utf8'); const checksum = createHash('sha256').update(sql).digest('hex');
        const existing = this.db.prepare('SELECT checksum FROM schema_migrations WHERE version = ?').get(version) as Row | undefined;
        if (existing) { if (existing.checksum !== checksum) throw new Error('Migration checksum mismatch'); continue; }
        this.db.exec(sql); this.db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(version, checksum, new Date().toISOString());
      }
    });
  }
  migrationVersions(): number[] { return (this.db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Row[]).map(row => Number(row.version)); }
  transaction<T>(operation: () => T): T {
    return this.db.transaction(() => { const result = operation(); if (result && typeof (result as { then?: unknown }).then === 'function') throw new Error('Transactions must be synchronous'); return result; }).immediate();
  }
  createApplication(input: Application): Application {
    const item = applicationSchema.parse(input); this.db.prepare('INSERT INTO applications(id, name) VALUES (?, ?)').run(item.id, item.name); return item;
  }
  getApplication(id: string): Application | undefined {
    const row = this.db.prepare('SELECT * FROM applications WHERE id = ?').get(id) as Row | undefined;
    return row ? applicationSchema.parse(row) : undefined;
  }
  createEnvironment(input: Environment): Environment {
    const item = environmentSchema.parse(input);
    this.db.prepare('INSERT INTO environments VALUES (?, ?, ?, ?, ?)').run(item.id, item.applicationId, item.name, item.kind, JSON.stringify(item.allowedOrigins)); return item;
  }
  getEnvironment(id: string): Environment | undefined {
    const row = this.db.prepare('SELECT * FROM environments WHERE id = ?').get(id) as Row | undefined;
    return row ? environmentSchema.parse({ id: row.id, applicationId: row.application_id, name: row.name, kind: row.kind, allowedOrigins: JSON.parse(String(row.allowed_origins)) }) : undefined;
  }
  createRole(input: RoleProfile): RoleProfile {
    const item = roleSchema.parse(input); this.db.prepare('INSERT INTO role_profiles VALUES (?, ?, ?, ?)').run(item.id, item.environmentId, item.name, JSON.stringify(item.auth)); return item;
  }
  getRole(id: string): RoleProfile | undefined {
    const row = this.db.prepare('SELECT * FROM role_profiles WHERE id = ?').get(id) as Row | undefined;
    return row ? roleSchema.parse({ id: row.id, environmentId: row.environment_id, name: row.name, auth: JSON.parse(String(row.auth)) }) : undefined;
  }
  getSettings(): WorkspaceSettings {
    const row = this.db.prepare('SELECT * FROM workspace_settings WHERE singleton = 1').get() as Row;
    return settingsSchema.parse({ retentionDays: row.retention_days, globalQuotaBytes: row.global_quota_bytes, perRunQuotaBytes: row.per_run_quota_bytes, captureFullTraces: row.capture_full_traces === 1 });
  }
  setSettings(input: WorkspaceSettings): void {
    const item = settingsSchema.parse(input); this.db.prepare('UPDATE workspace_settings SET retention_days = ?, global_quota_bytes = ?, per_run_quota_bytes = ?, capture_full_traces = ? WHERE singleton = 1').run(item.retentionDays, item.globalQuotaBytes, item.perRunQuotaBytes, Number(item.captureFullTraces));
  }
  private artifact(row: Row): ArtifactRecord {
    return { id: String(row.id), runId: String(row.run_id), kind: row.kind as ArtifactRecord['kind'], sizeBytes: Number(row.size_bytes), createdAt: Number(row.created_at), expiresAt: Number(row.expires_at), active: row.active === 1, status: row.status as ArtifactRecord['status'] };
  }
  getArtifact(id: string): ArtifactRecord | undefined { const row = this.db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as Row | undefined; return row ? this.artifact(row) : undefined; }
  listArtifacts(): ArtifactRecord[] { return (this.db.prepare('SELECT * FROM artifacts ORDER BY created_at, id').all() as Row[]).map(row => this.artifact(row)); }
  insertArtifact(item: ArtifactRecord): void { this.db.prepare('INSERT INTO artifacts VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(item.id, item.runId, item.kind, item.sizeBytes, item.createdAt, item.expiresAt, Number(item.active), item.status); }
  finishArtifactRun(runId: string): void { this.db.prepare('UPDATE artifacts SET active = 0 WHERE run_id = ?').run(runId); }
  setArtifactStatus(id: string, status: 'expired' | 'deleted'): void { this.db.prepare('UPDATE artifacts SET status = ?, active = 0 WHERE id = ?').run(status, id); }
  close(): void { if (!this.closed) { this.db.close(); this.closed = true; } }
}
