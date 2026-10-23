import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { SqliteStore, ArtifactStore } from '../../storage/src/index.js';
import { navigationConfigSchema, scopeSchema, findPath } from '../../core/src/index.js';
import { NavigationEngine } from '../../navigation/src/engine.js';
import { createGraphServer } from '../../navigation/src/viewer.js';
export async function runNavigationCli(args: string[], output: (line: string) => void = console.log, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  let store: SqliteStore | undefined; const controller = new AbortController(); const cancel = () => controller.abort();
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  try {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
      workspace: { type: 'string' }, role: { type: 'string' }, environment: { type: 'string' }, build: { type: 'string' }, tenant: { type: 'string' }, flags: { type: 'string' },
      config: { type: 'string' }, depth: { type: 'string' }, states: { type: 'string' }, actions: { type: 'string' }, requests: { type: 'string' }, timeout: { type: 'string' }, interval: { type: 'string' }, 'action-timeout': { type: 'string' },
      from: { type: 'string' }, to: { type: 'string' }, transitions: { type: 'string' }, reviewer: { type: 'string' }, port: { type: 'string' }, 'no-ai': { type: 'boolean' }
    } });
    const [command, seed, ...extra] = positionals;
    if (!command || !['map', 'graph', 'path', 'approve', 'replay', 'view'].includes(command) || extra.length || (command !== 'map' && seed)) throw new Error('Invalid command');
    const directory = join(resolve(values.workspace ?? '.'), '.qaspider'); const path = join(directory, 'memory.db'); if (!existsSync(path)) throw new Error('Workspace not initialized');
    store = new SqliteStore(path); const artifacts = new ArtifactStore(store, join(directory, 'artifacts')); const db = store;
    if (command === 'view') {
      const port = Number(values.port ?? 4318); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid viewer port');
      const viewer = createGraphServer(db, artifacts);
      await new Promise<void>((resolve, reject) => { viewer.server.once('error', reject); viewer.server.listen(port, '127.0.0.1', resolve); });
      output(JSON.stringify({ status: 'viewer-ready', url: `http://127.0.0.1:${port}/#token=${viewer.token}` }));
      await new Promise<void>(resolve => { const stop = () => { viewer.server.close(() => resolve()); viewer.server.closeAllConnections(); }; controller.signal.addEventListener('abort', stop, { once: true }); if (controller.signal.aborted) stop(); }); return 0;
    }
    if (command === 'graph' && !values.role) { output(JSON.stringify({ scopes: db.navigation.listScopes().map(({ id, scope, seedUrl }) => ({ id, scope, seedUrl })) })); return 0; }
    const environment = db.getEnvironment(values.environment ?? 'development'); if (!environment) throw new Error('Unknown environment');
    const scope = scopeSchema.parse({ applicationId: environment.applicationId, environmentId: environment.id, roleId: values.role, build: values.build ?? 'development', tenant: values.tenant ?? 'public', featureFlags: JSON.parse(values.flags ?? '{}') });
    if (command === 'graph') { const graph = db.navigation.snapshot(scope); output(JSON.stringify({ ...graph, scope: graph.scope ? { id: graph.scope.id, scope, seedUrl: graph.scope.seedUrl } : null })); return 0; }
    if (command === 'approve') {
      if (!values.transitions || !values.reviewer) throw new Error('Explicit transition IDs and reviewer are required');
      output(JSON.stringify(db.navigation.approveBatch(scope, values.transitions.split(','), values.reviewer))); return 0;
    }
    if (command === 'path') { if (!values.from || !values.to) throw new Error('Path endpoints required'); output(JSON.stringify({ path: findPath(db.navigation.snapshot(scope), values.from, values.to) })); return 0; }
    const engine = new NavigationEngine(db, artifacts);
    const limits = Object.fromEntries(([['depth', 'depth'], ['states', 'maxStates'], ['actions', 'maxActions'], ['requests', 'maxRequests'], ['timeout', 'maxMs'], ['interval', 'intervalMs'], ['action-timeout', 'actionTimeoutMs']] as const).flatMap(([flag, key]) => values[flag] !== undefined ? [[key, Number(values[flag])]] : []));
    if (command === 'map') {
      if (!seed) throw new Error('Seed URL required');
      const config = navigationConfigSchema.parse(values.config ? JSON.parse(readFileSync(resolve(values.config), 'utf8')) : {});
      const run = await engine.map(scope, seed, config, limits, controller.signal, env); output(JSON.stringify({ ...run, providerUsed: false })); return run.status === 'complete' ? 0 : 1;
    }
    if (!values.from || !values.to) throw new Error('Replay endpoints required');
    const run = await engine.replay(scope, values.from, values.to, controller.signal, env, limits); output(JSON.stringify({ ...run, providerUsed: false })); return run.status === 'complete' ? 0 : 1;
  } catch { output(JSON.stringify({ status: 'error', message: 'Navigation command rejected; check scope, origins, authentication configuration, approved endpoints and budgets' })); return 1; }
  finally { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); store?.close(); }
}
