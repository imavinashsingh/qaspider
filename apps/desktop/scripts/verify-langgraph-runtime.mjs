/** Isolated dependency probe. Does not install dependencies or touch user/application stores.
 * npm install --prefix /tmp/<probe> --save-exact @langchain/langgraph@1.5.2 @langchain/core@1.3.0 @langchain/langgraph-checkpoint-sqlite@1.1.0
 * node apps/desktop/scripts/verify-langgraph-runtime.mjs /tmp/<probe>
 * ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron apps/desktop/scripts/verify-langgraph-runtime.mjs /tmp/<probe>
 */
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { openAgentCheckpoints } from '../electron/agent-checkpoints.mjs';

if (!process.argv[2]) throw new Error('Supply an isolated npm module root; this probe never installs packages.');
const builtin = process.argv[2] === '--builtin';
const load = builtin ? createRequire(import.meta.url) : createRequire(join(resolve(process.argv[2]), 'package.json'));
const folder = mkdtempSync(join(tmpdir(), 'qaspider-graph-runtime-'));
let saver;
try {
  const { Annotation, StateGraph, START, END } = load('@langchain/langgraph');
  const { SqliteSaver } = load('@langchain/langgraph-checkpoint-sqlite');
  const state = Annotation.Root({ count: Annotation({ reducer: (a, b) => a + b, default: () => 0 }) });
  const graph = checkpointer => new StateGraph(state).addNode('increment', () => ({ count: 1 }))
    .addEdge(START, 'increment').addEdge('increment', END).compile({ checkpointer });
  const path = join(folder, 'checkpoints.sqlite');
  const open = () => builtin ? openAgentCheckpoints(path) : SqliteSaver.fromConnString(path);
  saver = open();
  await graph(saver).invoke({}, { configurable: { thread_id: 'project-a' } });
  saver.db.close(); saver = open();
  const resumed = await graph(saver).invoke({}, { configurable: { thread_id: 'project-a' } });
  const isolated = await graph(saver).invoke({}, { configurable: { thread_id: 'project-b' } });
  if (resumed.count !== 2 || isolated.count !== 1) throw new Error('Checkpoint persistence or thread isolation failed.');
  console.log(JSON.stringify({ status: 'PASS', node: process.versions.node, electron: process.versions.electron ?? null,
    abi: process.versions.modules, resumedCount: resumed.count, separateThreadCount: isolated.count }));
} catch (error) {
  console.log(JSON.stringify({ status: 'FAIL', node: process.versions.node, electron: process.versions.electron ?? null,
    abi: process.versions.modules, message: error.message })); process.exitCode = 1;
} finally { saver?.db.close(); rmSync(folder, { recursive: true, force: true }); }
