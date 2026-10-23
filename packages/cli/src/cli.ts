import {initializeWorkspace} from '../../application/src/workspace.js';
import {StudioStore} from '../../studio/src/store.js';
import {ProjectRegistry,studioHome} from '../../studio/src/projects.js';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { defaultSettings, originSchema } from '../../core/src/index.js';
import { SqliteStore } from '../../storage/src/index.js';
export function runCli(args: string[], output: (line: string) => void = console.log, env: NodeJS.ProcessEnv = process.env): number {
  let store: SqliteStore | undefined;
  try {
    const parsed = parseArgs({ args, options: { workspace: { type: 'string' }, name: { type: 'string' }, origin: { type: 'string' } }, allowPositionals: true, strict: true });
    const [command, ...extra] = parsed.positionals;
    if (!['init', 'doctor'].includes(command ?? '') || extra.length) throw new Error('Usage: qaspider <init|doctor|map|graph|path|approve|replay|view> [--workspace path] [--name name] [--origin origin]');
    const workspace = resolve(parsed.values.workspace ?? '.'); const directory = join(workspace, '.qaspider'); const database = join(directory, 'memory.db');
    if (command === 'doctor' && !existsSync(database)) throw new Error('Workspace is not initialized; run qaspider init');
    if (command === 'init') {
      const existingStore=existsSync(database)?new SqliteStore(database):null;
      const name=parsed.values.name??existingStore?.getApplication('benchmark')?.name??'QASpider benchmark';existingStore?.close();
      const result=initializeWorkspace(workspace,name,originSchema.parse(parsed.values.origin??'http://127.0.0.1:4317'));
      // Embedders can supply an empty environment to disable global user state; normal CLI always registers.
      if(env.HOME||env.QASPIDER_STUDIO_HOME){const global=new StudioStore(studioHome(env));try{new ProjectRegistry(global).register(workspace,name);}finally{global.close();}}
      output(JSON.stringify({status:'initialized',...result,provider:'not-configured'}));return 0;
    }
    store = new SqliteStore(database);
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
