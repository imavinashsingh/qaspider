import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
interface Account { email: string; salt: string; hash: Buffer; role: 'admin' | 'user'; fixture: boolean; }
const credentials = z.object({ email: z.string().trim().toLowerCase(), password: z.string() }).strict();
function account(email: string, password: string, role: Account['role'], fixture: boolean): Account {
  const salt = randomBytes(16).toString('hex'); return { email, salt, hash: scryptSync(password, salt, 32), role, fixture };
}
function equal(a: string, b: string): boolean { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
function layout(title: string, content: string, role?: Account['role']): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — QASpider benchmark</title><body><nav><a href="/">Home</a> <a href="/register">Register</a> <a href="/login">Login</a> <a href="/about?timestamp=${Date.now()}" data-testid="about">About</a> ${role ? '<a href="/dashboard">Dashboard</a> <a href="/settings">Settings</a>' : ''} ${role === 'admin' ? '<a href="/users">User management</a>' : ''} <button type="button" data-testid="open-help">Help</button></nav><main><h1>${title}</h1>${content}<div role="dialog" aria-labelledby="help-title" id="help" hidden><h2 id="help-title">Help</h2><p>Safe navigation fixture.</p><button type="button" id="close-help">Close help</button></div><time data-qaspider-volatile>${new Date().toISOString()}</time></main><script src="/navigation.js" defer></script></body></html>`;
}
function form(kind: 'register' | 'login'): string {
  return layout(kind === 'register' ? 'Registration' : 'Sign in', `<form novalidate><p><label>Email <input name="email" type="email" autocomplete="username"></label></p><p><label>Password <input name="password" type="password" autocomplete="${kind === 'register' ? 'new-password' : 'current-password'}"></label></p><button>${kind === 'register' ? 'Create account' : 'Sign in'}</button></form><p role="alert"></p><p role="status"></p><script src="/form-${kind}.js" defer></script>`);
}
async function body(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new Error('Expected JSON');
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of request) { const bytes = Buffer.from(chunk as Uint8Array); size += bytes.length; if (size > 16384) throw new Error('Body too large'); chunks.push(bytes); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
export function createBenchmark(fixtureToken: string) {
  if (fixtureToken.length < 16) throw new Error('Fixture token must contain at least 16 characters');
  const accounts = new Map<string, Account>(); const sessions = new Map<string, string>();
  const stats = { registrations: 0, unsafeVisits: 0 };
  let aboutTitle = 'About the benchmark';
  function reset() { aboutTitle = 'About the benchmark'; stats.registrations = 0; stats.unsafeVisits = 0; accounts.clear(); sessions.clear(); for (const role of ['admin', 'user'] as const) { const email = `${role}@example.test`; accounts.set(email, account(email, 'benchmark-password', role, false)); } }
  reset();
  return createServer((req, res) => { void handle(req, res).catch(() => { if (!res.headersSent) json(res, 400, { error: 'Invalid request' }); else res.end(); }); });
  function json(res: ServerResponse, status: number, data: unknown) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
  function html(res: ServerResponse, content: string) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(content); }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const localPort = req.socket.localPort;
    const allowedHosts = [`127.0.0.1:${localPort}`, `localhost:${localPort}`];
    if (!req.headers.host || !allowedHosts.includes(req.headers.host)) { json(res, 403, { error: 'Invalid host' }); return; }
    const origin = `http://${req.headers.host}`;
    if (req.headers.origin && req.headers.origin !== origin) { json(res, 403, { error: 'Invalid origin' }); return; }
    const url = new URL(req.url ?? '/', origin); const path = url.pathname;
    if (url.origin !== origin) { json(res, 403, { error: 'Invalid origin' }); return; }
    const cookie = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('session='))?.slice(8);
    const email = cookie ? sessions.get(cookie) : undefined; const current = email ? accounts.get(email) : undefined;
    if (req.method === 'GET' && path === '/health') { json(res, 200, { status: 'ok', benchmark: true }); return; }
    if (path.startsWith('/__fixtures/')) {
      if (req.method !== 'POST' || !equal(String(req.headers['x-fixture-token'] ?? ''), fixtureToken)) { json(res, 403, { error: 'Fixture authorization required' }); return; }
      if (path === '/__fixtures/change') { const input = z.object({ aboutTitle: z.string().regex(/^[a-zA-Z ]{1,80}$/) }).strict().parse(await body(req)); aboutTitle = input.aboutTitle; json(res, 200, { changed: true }); return; }
      if (path === '/__fixtures/stats') { json(res, 200, stats); return; }
      if (path === '/__fixtures/reset') { reset(); json(res, 200, { reset: true }); return; }
      if (path === '/__fixtures/setup') {
        const input = z.object({ email: z.email().toLowerCase(), role: z.enum(['admin', 'user']) }).strict().parse(await body(req));
        if (accounts.has(input.email)) { json(res, 409, { error: 'Email already exists' }); return; }
        accounts.set(input.email, account(input.email, 'benchmark-password', input.role, true)); json(res, 201, { email: input.email }); return;
      }
      if (path === '/__fixtures/cleanup') {
        const input = z.object({ email: z.email().toLowerCase() }).strict().parse(await body(req)); const existing = accounts.get(input.email);
        if (existing && !existing.fixture) { json(res, 403, { error: 'Seed account cannot be deleted' }); return; }
        accounts.delete(input.email); for (const [key, value] of sessions) if (value === input.email) sessions.delete(key);
        json(res, 200, { cleaned: true }); return;
      }
      json(res, 404, { error: 'Not found' }); return;
    }
    if (req.method === 'GET' && path === '/navigation.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end("document.querySelector('[data-testid=open-help]').addEventListener('click',()=>{document.getElementById('help').hidden=false});document.getElementById('close-help').addEventListener('click',()=>{document.getElementById('help').hidden=true});"); return;
    }
    if (req.method === 'GET' && path === '/about') { html(res, layout(aboutTitle, '<p>Public navigation fixture.</p><a href="/delete-account">Delete account</a><a href="https://unauthorized.example/">External site</a>', current?.role)); return; }
    if (req.method === 'GET' && path === '/delete-account') { stats.unsafeVisits++; json(res, 403, { error: 'Unsafe fixture must never be visited' }); return; }
    if (req.method === 'GET' && (path === '/users' || path === '/settings')) {
      if (!current) { json(res, 401, { error: 'Authentication required' }); return; }
      if (path === '/users' && current.role !== 'admin') { json(res, 403, { error: 'Admin role required' }); return; }
      html(res, layout(path === '/users' ? 'User management' : 'Account settings', '<p>Role-scoped navigation fixture.</p>', current.role)); return;
    }
    if (req.method === 'GET' && /^\/form-(register|login)\.js$/.test(path)) {
      const kind = path.includes('register') ? 'register' : 'login';
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
      res.end(`document.querySelector('form').addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.target);const response=await fetch('/api/${kind}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(form))});const result=await response.json();document.querySelector('[role=alert]').textContent=result.error||'';document.querySelector('[role=status]').textContent=result.message||'';${kind === 'login' ? "if(response.ok)location.assign('/dashboard');" : ''}});`); return;
    }
    if (req.method === 'GET' && path === '/') { html(res, layout('QASpider benchmark', '<p>Local test fixture application. No external services.</p>', current?.role)); return; }
    if (req.method === 'GET' && (path === '/register' || path === '/login')) { html(res, form(path === '/register' ? 'register' : 'login')); return; }
    if (req.method === 'POST' && (path === '/api/register' || path === '/api/login')) {
      const input = credentials.parse(await body(req));
      if (!z.email().safeParse(input.email).success) { json(res, 400, { error: 'Invalid email' }); return; }
      if (input.password.length < 8 || input.password.length > 256) { json(res, 400, { error: 'Password must contain 8–256 characters' }); return; }
      if (path === '/api/register') {
        stats.registrations++;
        if (accounts.has(input.email)) { json(res, 409, { error: 'Email already exists' }); return; }
        accounts.set(input.email, account(input.email, input.password, 'user', true)); json(res, 201, { message: 'Account created' }); return;
      }
      const found = accounts.get(input.email);
      if (!found || !timingSafeEqual(found.hash, scryptSync(input.password, found.salt, 32))) { json(res, 401, { error: 'Invalid credentials' }); return; }
      const session = randomBytes(32).toString('hex'); sessions.set(session, found.email);
      res.setHeader('Set-Cookie', `session=${session}; HttpOnly; SameSite=Strict; Path=/`); json(res, 200, { message: 'Signed in' }); return;
    }
    if (req.method === 'GET' && (path === '/dashboard' || path === '/api/admin/users')) {
      if (!current) { json(res, 401, { error: 'Authentication required' }); return; }
      if (path === '/api/admin/users') {
        if (current.role !== 'admin') { json(res, 403, { error: 'Admin role required' }); return; }
        json(res, 200, { users: [...accounts.values()].map(value => ({ email: value.email, role: value.role })) }); return;
      }
      html(res, layout(current.role === 'admin' ? 'Admin dashboard' : 'User dashboard', '<p>Authenticated local fixture session.</p>', current.role)); return;
    }
    json(res, 404, { error: 'Not found' });
  }
}
