import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { defaultSettings, originSchema } from '../../core/src/index.js';
import { ArtifactStore, SqliteStore } from '../../storage/src/index.js';
export function runCli(args: string[], output: (line: string) => void = console.log, env: NodeJS.ProcessEnv = process.env): number {
  let store: SqliteStore | undefined;
  try {
    const parsed = parseArgs({ args, options: { workspace: { type: 'string' }, name: { type: 'string' }, origin: { type: 'string' } }, allowPositionals: true, strict: true });
    const [command, ...extra] = parsed.positionals;
    if (!['init', 'doctor'].includes(command ?? '') || extra.length) throw new Error('Usage: qaspider <init|doctor|map|graph|path|approve|replay|view> [--workspace path] [--name name] [--origin origin]');
    const workspace = resolve(parsed.values.workspace ?? '.'); const directory = join(workspace, '.qaspider'); const database = join(directory, 'memory.db');
    if (command === 'doctor' && !existsSync(database)) throw new Error('Workspace is not initialized; run qaspider init');
    store = new SqliteStore(database);
    if (command === 'init') {
      const origin = originSchema.parse(parsed.values.origin ?? 'http://127.0.0.1:4317');
      const existing = store.getEnvironment('development');
      if (existing && (existing.allowedOrigins[0] !== origin || (parsed.values.name && store.getApplication('benchmark')?.name !== parsed.values.name))) throw new Error('Workspace already initialized with different configuration');
      const db = store;
      db.transaction(() => {
        if (!db.getApplication('benchmark')) db.createApplication({ id: 'benchmark', name: parsed.values.name ?? 'QASpider benchmark' });
        if (!existing) db.createEnvironment({ id: 'development', applicationId: 'benchmark', name: 'Development', kind: 'development', allowedOrigins: [origin] });
        for (const role of ['guest', 'admin', 'user'] as const) if (!db.getRole(role)) db.createRole({ id: role, environmentId: 'development', name: role, auth: role === 'guest' ? { kind: 'guest' } : { kind: 'form', usernameEnv: `QASPIDER_${role.toUpperCase()}_EMAIL`, passwordEnv: `QASPIDER_${role.toUpperCase()}_PASSWORD` } });
      });
      new ArtifactStore(db, join(directory, 'artifacts'));
      output(JSON.stringify({ status: 'initialized', workspace, database, provider: 'not-configured', settings: db.getSettings() })); return 0;
    }
    const warnings: string[] = []; const missing: string[] = [];
    for (const id of ['admin', 'user']) { const role = store.getRole(id); if (role?.auth.kind === 'form') for (const key of [role.auth.usernameEnv, role.auth.passwordEnv]) if (!env[key]) missing.push(key); }
    if (missing.length) warnings.push(`Missing credential references: ${missing.join(', ')}`);
    const settings = store.getSettings(); const artifacts = store.listArtifacts();
    const usageBytes = artifacts.filter(item => item.status === 'available').reduce((sum, item) => sum + item.sizeBytes, 0);
    if (usageBytes > settings.globalQuotaBytes) warnings.push('Artifact usage exceeds configured quota');
    output(JSON.stringify({ status: 'ok', workspace, node: process.versions.node, schemaVersions: store.migrationVersions(), provider: 'not-configured', productionWrites: false, settings, artifactUsageBytes: usageBytes, warnings })); return 0;
  } catch (error) {
    // Never echo arguments, environment values, SQL parameters, or arbitrary error details.
    const message = error instanceof Error && (error.message.startsWith('Usage:') || error.message.startsWith('Workspace ')) ? error.message : 'Invalid configuration or workspace operation failed';
    output(JSON.stringify({ status: 'error', message, defaults: defaultSettings })); return 1;
  } finally { store?.close(); }
}
