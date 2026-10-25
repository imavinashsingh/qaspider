import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createDemoServer } from '../demo/server.mjs';
import { CodexProvider, sendSyntheticResponse } from '../electron/codex-provider.mjs';
import { TestingWorkspace } from '../electron/workspace.mjs';
import { openBrowserSession } from '../electron/browser.mjs';

let demo, endpoint, origin, provider, workspace, lastSession;
let inferenceRequests = 0;
function listen(server) { return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))); }
function texts(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(texts).join('\n');
  if (value && typeof value === 'object') return Object.values(value).map(texts).join('\n');
  return '';
}
test.beforeAll(async () => {
  demo = createDemoServer(); origin = await listen(demo);
  endpoint = createServer(async (request, response) => {
    let body = ''; for await (const bytes of request) body += bytes;
    const input = JSON.parse(body);
    inferenceRequests++;
    if ((input.tools ?? []).length) { response.writeHead(400); response.end(); return; }
    // Test-only synthetic inference. Read the actual Stagehand accessibility IDs.
    const prompt = texts(input.input).replaceAll('\\n', '\n').replaceAll('\\"', '"');
    const elements = [];
    for (const [label, method, args] of [['Save demo', 'click', []], ['Do nothing', 'click', []], ['Continue to demo destination', 'click', []], ['Username', 'fill', ['demo-user']], ['Password', 'fill', ['synthetic-only']], ['Sign in', 'click', []]]) {
      const line = prompt.split('\n').find(line => line.includes(label) && /^\s*[-*]?\s*\[\d+-\d+\].*(?:button|link|textbox)/.test(line));
      if (line) elements.push({ elementId: line.match(/\[(\d+-\d+)\]/)[1], description: label, method, arguments: args });
    }
    sendSyntheticResponse(response, { elements });
  });
  const base = await listen(endpoint);
  provider = new CodexProvider({ testEndpoint: base + '/v1' });
  await provider.prepare();
  workspace = new TestingWorkspace({ provider, options: { headless: true }, openSession: async (...args) => { lastSession = await openBrowserSession(...args); return lastSession; } });
});
test.afterEach(async () => { await workspace?.close(); });
test.afterAll(async () => { endpoint?.closeAllConnections(); await Promise.all([demo, endpoint].map(server => new Promise(resolve => server.close(resolve)))); });

async function observe(label = 'Save demo') {
  const result = await workspace.observe({ url: origin, instruction: 'Find the Save demo, Do nothing and Continue buttons or links.' });
  expect(result.status, result.message).toBe('observed');
  expect(result.provider.synthetic).toBe(true);
  expect(result.screenshot).toMatch(/^data:image\/png;base64,/);
  const action = result.actions.find(action => action.description === label);
  expect(action, JSON.stringify(result.actions)).toBeTruthy();
  return { observationId: result.observationId, actionId: action.id, authorized: true, expected: { kind: 'text', selector: '#status', expected: 'Saved' } };
}

test('real Codex CLI + Stagehand observation, authorized click and verified PASS', async () => {
  const request = await observe();
  const requestsBeforeClick = inferenceRequests;
  const result = await workspace.execute(request);
  expect(result.outcome, result.message).toBe('PASS');
  expect(result.before).toMatchObject({ matched: false, actual: 'Ready' });
  expect(result.actual).toBe('Saved');
  expect(result.screenshot).toMatch(/^data:image\/png;base64,/);
  expect(lastSession.browser.closed).toBe(true);
  expect(inferenceRequests).toBe(requestsBeforeClick);
});
test('Stagehand inspects the controlled login page and form actions remain blocked', async () => {
  const result = await workspace.observe({ url: origin + '/login', instruction: 'Find the Username and Password fields and the Sign in button.' });
  expect(result.status, result.message).toBe('observed');
  const signIn = result.actions.find(action => action.description === 'Sign in');
  expect(signIn).toBeTruthy();
  expect(signIn.allowed).toBe(false);
  expect(signIn.reason).toContain('form');
  expect(await lastSession.controlledPage.getByLabel('Username', { exact: true }).inputValue()).toBe('');
  expect(await lastSession.controlledPage.getByLabel('Password', { exact: true }).inputValue()).toBe('');
  expect((await workspace.execute({ observationId: result.observationId, actionId: signIn.id, authorized: true, expected: { kind: 'text', selector: 'h1', expected: 'Logged in' } })).outcome).toBe('BLOCKED');
  expect(lastSession.browser.closed).toBe(true);
});
test('unauthorized action is BLOCKED and does not change the DOM', async () => {
  const request = await observe();
  const act = lastSession.stagehand.act.bind(lastSession.stagehand); let clicks = 0;
  lastSession.stagehand.act = (...args) => { clicks++; return act(...args); };
  const result = await workspace.execute({ ...request, authorized: false });
  expect(result.outcome).toBe('BLOCKED'); expect(clicks).toBe(0); expect(lastSession.browser.closed).toBe(true);
});
test('successful click with an unmet assertion is FAIL', async () => {
  const request = await observe('Do nothing');
  const result = await workspace.execute(request);
  expect(result.outcome, result.message).toBe('FAIL'); expect(result.actual).toBe('Ready');
});
test('expectation already true is INCONCLUSIVE without a click', async () => {
  const request = await observe();
  const result = await workspace.execute({ ...request, expected: { kind: 'text', selector: '#status', expected: 'Ready' } });
  expect(result.outcome).toBe('INCONCLUSIVE'); expect(result.message).toContain('No action was executed');
});
test('stale or replaced elements are BLOCKED', async () => {
  const request = await observe();
  await lastSession.controlledPage.locator('#save').evaluate(element => element.replaceWith(element.cloneNode(true)));
  expect((await workspace.execute(request)).outcome).toBe('BLOCKED');
});
test('same-origin navigation verifies the final URL', async () => {
  const request = await observe('Continue to demo destination');
  const result = await workspace.execute({ ...request, expected: { kind: 'url', expected: origin + '/next' } });
  expect(result.outcome, result.message).toBe('PASS'); expect(result.actual).toBe(origin + '/next');
});
test('ambiguous assertion is INCONCLUSIVE and does not execute a click', async () => {
  const request = await observe();
  let clicks = 0; lastSession.stagehand.act = async () => { clicks++; throw new Error('Must not execute'); };
  const result = await workspace.execute({ ...request, expected: { kind: 'text', selector: 'button', expected: 'Saved' } });
  expect(result.outcome).toBe('INCONCLUSIVE'); expect(clicks).toBe(0); expect(lastSession.browser.closed).toBe(true);
});
test('model error is unavailable and closes the real browser', async () => {
  let session;
  const failed = new TestingWorkspace({
    provider: { prepare: () => provider.prepare(), generate: async () => { throw new Error('Controlled provider failure'); } },
    options: { headless: true }, openSession: async (...args) => { session = await openBrowserSession(...args); return session; },
  });
  const result = await failed.observe({ url: origin, instruction: 'Find buttons' });
  expect(result.status).toBe('unavailable'); expect(result.message).toContain('Controlled provider failure');
  expect(session.browser.closed).toBe(true);
});
test('a stopped local application reports connection failure without invoking inference', async () => {
  const unused = createServer();
  const stoppedOrigin = await listen(unused);
  await new Promise(resolve => unused.close(resolve));
  const before = inferenceRequests;
  const result = await workspace.observe({ url: stoppedOrigin, instruction: 'Find buttons' });
  expect(result.status).toBe('error');
  expect(result.message).toContain('ERR_CONNECTION_REFUSED');
  expect(result.message).toContain('Start the development application');
  expect(result.message).not.toContain('AI observation unavailable');
  expect(inferenceRequests).toBe(before);
  expect(workspace.hasSession).toBe(false);
});
test('missing provider is explicitly unavailable in real Electron UI', async () => {
  const env = { ...process.env, QASPIDER_DESKTOP_PROVIDER: 'none' }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [fileURLToPath(new URL('..', import.meta.url))], env, timeout: 25_000 });
  try {
    const page = await app.firstWindow();
    await page.getByLabel('Observation application URL').fill(origin);
    await page.getByRole('button', { name: 'Observe page', exact: true }).click();
    await expect(page.getByTestId('workspace-status')).toContainText('AI observation unavailable');
    await expect(page.getByTestId('workspace-status')).toContainText('no compatible model');
    await expect(page.getByRole('heading', { name: 'Discovered actions' })).toHaveCount(0);
  } finally { await app.close(); }
});
