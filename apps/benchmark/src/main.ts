import { randomBytes } from 'node:crypto';
import { createBenchmark } from './server.js';
const port = Number(process.env.PORT ?? 4317);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid benchmark port');
const server = createBenchmark(process.env.BENCHMARK_FIXTURE_TOKEN ?? randomBytes(32).toString('hex'));
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ event: 'benchmark.ready', origin: `http://127.0.0.1:${port}`, fixtures: Boolean(process.env.BENCHMARK_FIXTURE_TOKEN) })));
server.on('error', (error: NodeJS.ErrnoException) => { console.error(JSON.stringify({ event: 'benchmark.error', code: error.code ?? 'UNKNOWN' })); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { server.close(); server.closeAllConnections(); });
