import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { testAccount } from './credentials.mjs';

export function createDemoServer() {
  const sessions = new Set();
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const cookie = (request.headers.cookie ?? '').match(/(?:^|;\s*)qa_session=([^;]+)/)?.[1];
    if (request.method === 'POST' && request.url === '/login') {
      // Bounded, synthetic form fixture. Never reflect or log request values.
      let body = ''; let size = 0;
      try {
        for await (const bytes of request) {
          size += bytes.length;
          if (size > 1024) { response.writeHead(413); response.end('Request too large'); return; }
          body += bytes;
        }
      } catch { response.writeHead(400); response.end('Invalid request'); return; }
      const fields = new URLSearchParams(body);
      const valid = fields.get('username') === testAccount.username && fields.get('password') === testAccount.password;
      if (cookie) sessions.delete(cookie);
      const token = valid ? randomUUID() : '';
      if (valid) sessions.add(token);
      response.setHeader('Set-Cookie', `qa_session=${token}; HttpOnly; SameSite=Strict; Path=/`);
      response.writeHead(303, { Location: valid ? '/dashboard' : '/login?error=invalid' }); response.end(); return;
    }
    if (!['GET', 'HEAD'].includes(request.method ?? '')) {
      response.writeHead(405, { Allow: 'GET, HEAD' }); response.end('Demo form submissions are disabled.'); return;
    }
    if (request.url === '/dashboard') {
      if (!cookie || !sessions.has(cookie)) { response.writeHead(303, { Location: '/login' }); response.end(); return; }
      response.end('<!doctype html><title>Demo dashboard</title><h1 id="dashboard">Demo dashboard</h1><p id="login-status">Signed in successfully</p>'); return;
    }
    if (request.url === '/login' || request.url === '/login?error=invalid') {
      response.end(`<!doctype html><html lang="en"><head><title>Controlled login page</title></head>
        <body style="font:18px system-ui;padding:40px;background:#f5f7fb"><h1>Controlled login page</h1>
        <p>Synthetic login fixture. Only the dedicated scenario runner may authorize submission; M2 observation remains read-only.</p>
        ${request.url.includes('?') ? '<p id="login-error" role="alert">Invalid username or password.</p>' : ''}
        <form id="login-form" method="post" action="/login" autocomplete="off">
        <p><label for="username">Username</label><br><input id="username" name="username" autocomplete="off"></p>
        <p><label for="password">Password</label><br><input id="password" name="password" type="password" autocomplete="off"></p>
        <button id="sign-in" type="submit">Sign in</button></form>
        <p><a href="/">Back to controlled demo</a></p></body></html>`); return;
    }
    if (request.url === '/next') { response.end('<!doctype html><title>Demo destination</title><h1>Demo destination</h1>'); return; }
    response.end(`<!doctype html><html lang="en"><head><title>QASpider controlled demo</title></head>
      <body style="font:18px system-ui;padding:40px;background:#f5f7fb"><h1>QASpider controlled demo</h1>
      <p>This page changes only its own temporary DOM. It sends no mutations to a backend.</p>
      <p id="status" role="status">Ready</p>
      <button id="save" type="button" onclick="document.getElementById('status').textContent='Saved'">Save demo</button>
      <button id="noop" type="button">Do nothing</button>
      <a id="next" href="/next">Continue to demo destination</a>
      <a href="/login">Inspect controlled login page</a>
      <a href="https://example.org/">Leave application</a>
      <form><button type="submit">Submit form (blocked)</button></form>
      </body></html>`);
  });
  server.on('close', () => sessions.clear());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createDemoServer();
  server.listen(Number(process.env.QASPIDER_DEMO_PORT ?? 4319), '127.0.0.1', () => console.log('Controlled demo: http://127.0.0.1:' + server.address().port));
}
