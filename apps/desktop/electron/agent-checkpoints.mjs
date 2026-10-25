import { DatabaseSync } from 'node:sqlite';
import { chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { assertNoSymlinks, privateDirectory } from '../../../packages/storage/src/filesystem.ts';

/** Driver glue only: checkpoint semantics/SQL/serialization remain in the official SqliteSaver.
 * No better-sqlite3 constructor is invoked, so Electron needs no native-addon rebuild.
 */
export function checkpointDriver(path) {
  if (path !== ':memory:') {
    path = resolve(path); privateDirectory(dirname(path));
    for (const suffix of ['', '-journal', '-wal', '-shm']) assertNoSymlinks(path + suffix);
  }
  const db = new DatabaseSync(path);
  try {
    if (path !== ':memory:') chmodSync(path, 0o600);
    db.exec('PRAGMA busy_timeout=5000;');
    return {
      native: db,
      exec: sql => db.exec(sql),
      pragma: sql => db.exec(`PRAGMA ${sql}`),
      prepare(sql) {
        const statement = db.prepare(sql), args = values => values.map(value => value === undefined ? null : value);
        return { run: (...values) => statement.run(...args(values)), get: (...values) => statement.get(...args(values)), all: (...values) => statement.all(...args(values)) };
      },
      transaction(operation) {
        return (...values) => {
          db.exec('BEGIN IMMEDIATE');
          try { const result = operation(...values); db.exec('COMMIT'); return result; }
          catch (error) { db.exec('ROLLBACK'); throw error; }
        };
      },
      close: () => db.close(),
    };
  } catch (error) { db.close(); throw error; }
}
export function openAgentCheckpoints(path) { return new SqliteSaver(checkpointDriver(path)); }
