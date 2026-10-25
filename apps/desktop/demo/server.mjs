import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export function createDemoServer() {
  return createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(request.method ?? '')) {
      response.writeHead(405, { Allow: 'GET, HEAD' }); response.end('Demo form submissions are disabled.'); return;
    }
    if (request.url === '/login') {
      response.end(`<!doctype html><html lang="en"><head><title>Controlled login page</title></head>
        <body style="font:18px system-ui;padding:40px;background:#f5f7fb"><h1>Controlled login page</h1>
        <p>Observation fixture only. Leave fields empty. Form execution and real authentication are outside this demo.</p>
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createDemoServer();
  server.listen(Number(process.env.QASPIDER_DEMO_PORT ?? 4319), '127.0.0.1', () => console.log('Controlled demo: http://127.0.0.1:' + server.address().port));
}
