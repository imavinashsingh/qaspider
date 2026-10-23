import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { SqliteStore, ArtifactStore } from '../../storage/src/index.js';
import type { NavigationGraph } from '../../core/src/index.js';
export function createGraphServer(store: SqliteStore, artifacts: ArtifactStore) {
  const token = randomBytes(32).toString('hex');
  const compiled = fileURLToPath(new URL('../../../apps/viewer/public/', import.meta.url));
  const source = fileURLToPath(new URL('../../../dist/apps/viewer/public/', import.meta.url));
  const assets = existsSync(compiled) ? compiled : source;
  const server = createServer((request, response) => { void handle(request, response).catch(() => { if (!response.headersSent) json(response, 400, { error: 'Request rejected; check scope, approval eligibility and evidence availability' }); else response.end(); }); });
  function json(response: ServerResponse, status: number, value: unknown) { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); }
  async function handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Referrer-Policy', 'no-referrer');
    const host = request.headers.host; const port = request.socket.localPort;
    if (!host || ![`127.0.0.1:${port}`, `localhost:${port}`].includes(host)) { json(response, 403, { error: 'Invalid host' }); return; }
    const origin = `http://${host}`;
    if (request.headers.origin && request.headers.origin !== origin) { json(response, 403, { error: 'Invalid origin' }); return; }
    const url = new URL(request.url ?? '/', origin);
    if (url.origin !== origin) { json(response, 403, { error: 'Invalid origin' }); return; }
    if (url.pathname.startsWith('/api/')) {
      const received = Buffer.from(String(request.headers['x-qaspider-token'] ?? '')); const expected = Buffer.from(token);
      if (received.length !== expected.length || !timingSafeEqual(received, expected)) { json(response, 401, { error: 'Open the local viewer URL printed by qaspider view' }); return; }
      if (request.method === 'GET' && url.pathname === '/api/scopes') { json(response, 200, store.navigation.listScopes().map(({ id, scope, seedUrl }) => ({ id, scope, seedUrl }))); return; }
      let selected = url.searchParams.get('scope');
      if (request.method === 'POST' && url.pathname === '/api/approve') {
        if (request.headers.origin !== origin || !request.headers['content-type']?.startsWith('application/json')) { json(response, 403, { error: 'Same-origin JSON required' }); return; }
        let size = 0; const chunks: Buffer[] = [];
        for await (const part of request) { const chunk = Buffer.from(part as Uint8Array); size += chunk.length; if (size > 65536) throw new Error('Request too large'); chunks.push(chunk); }
        const data = z.object({ scopeId: z.string(), transitionIds: z.array(z.string()).min(1).max(1000), approvedBy: z.string().trim().min(1).max(200) }).strict().parse(JSON.parse(Buffer.concat(chunks).toString()));
        selected = data.scopeId; const record = store.navigation.listScopes().find(scope => scope.id === selected); if (!record) { json(response, 404, { error: 'Unknown scope' }); return; }
        json(response, 200, store.navigation.approveBatch(record.scope, data.transitionIds, data.approvedBy)); return;
      }
      const record = store.navigation.listScopes().find(scope => scope.id === selected); if (!record) { json(response, 404, { error: 'Unknown scope' }); return; }
      const graph = store.navigation.snapshot(record.scope);
      if (request.method === 'GET' && url.pathname === '/api/graph') {
        const safeGraph = { ...graph, scope: { id: record.id, scope: record.scope, seedUrl: record.seedUrl } }; json(response, 200, safeGraph); return;
      }
      if (request.method === 'GET' && url.pathname.startsWith('/api/evidence/')) {
        const id = url.pathname.slice('/api/evidence/'.length); const allowed = evidenceIds(graph); const artifact = store.getArtifact(id);
        if (!allowed.has(id) || !artifact || artifact.status !== 'available' || artifact.kind === 'trace') { json(response, 403, { error: 'Evidence unavailable or restricted' }); return; }
        const bytes = artifacts.read(id); response.writeHead(200, { 'Content-Type': artifact.kind === 'screenshot' ? 'image/png' : 'application/json', 'Cache-Control': 'no-store' }); response.end(bytes); return;
      }
      json(response, 404, { error: 'Unknown API operation' }); return;
    }
    if (request.method !== 'GET') { json(response, 405, { error: 'Method not allowed' }); return; }
    const path = resolve(assets, url.pathname === '/' ? 'index.html' : `.${decodeURIComponent(url.pathname)}`);
    if (!path.startsWith(resolve(assets) + sep) || !existsSync(path) || !statSync(path).isFile()) { json(response, 404, { error: 'Viewer asset not found; run npm run build' }); return; }
    const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(readFileSync(path));
  }
  return { server, token };
}
function evidenceIds(graph: NavigationGraph): Set<string> {
  return new Set([...graph.states.map(state => state.evidenceId), ...graph.transitions.flatMap(edge => edge.evidenceId ? [edge.evidenceId] : []), ...graph.runs.flatMap(run => run.evidenceIds)]);
}
