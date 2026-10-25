import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { openBrowserSession } from '../electron/browser.mjs';
import { inspectAction } from '../electron/action-policy.mjs';

// Opt-in, serial validation through existing desktop IPC. No submit/file actions.
const origin = 'https://the-internet.herokuapp.com';
const root = fileURLToPath(new URL('../../..', import.meta.url));
const directory = root + '/test-results/desktop-live/m7.1';
const data = root + '/.qaspider/desktop-m7.1';
mkdirSync(directory, { recursive: true }); mkdirSync(data, { recursive: true });
const receipt = { measuredAt: new Date().toISOString(), origin, safetyEnabled: true, submissions: 0, fileSelections: 0, observations: [], captures: [], tickets: [], restart: null };
const started = performance.now();
const env = { ...process.env, QASPIDER_DESKTOP_PROVIDER: 'codex', QASPIDER_DESKTOP_HEADLESS: '1', QASPIDER_DESKTOP_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE;
let app, window;
const invoke = (method, input) => window.evaluate(({ method, input }) => window.qaspider[method](input), { method, input });
async function launch() { app = await electron.launch({ args: [root + '/apps/desktop'], env, timeout: 25_000 }); window = await app.firstWindow(); }
function save() { writeFileSync(root + '/validation/desktop-m7.1-public.json', JSON.stringify(receipt, null, 2) + '\n'); }
async function capture(path, name) {
  const start = performance.now(); let session;
  try {
    session = await openBrowserSession(origin + path, { headless: true, requestPolicy: url => new URL(url).origin === origin });
    const page = session.controlledPage;
    const controls = await page.locator('input, button, a').evaluateAll(nodes => nodes.filter(node => ['INPUT', 'BUTTON'].includes(node.tagName)).map(node => ({ tag: node.tagName, type: node.type, text: node.tagName === 'BUTTON' ? node.textContent.trim() : '', enabled: !node.disabled })));
    const masks = [page.locator('input:not([type="submit"]), textarea')];
    if (path === '/login') {
      // The page publishes its password in prose. Mask the entire instruction,
      // without reading that password into a log, plan, provider or evidence.
      masks.push(page.getByRole('heading', { level: 4 }));
      receipt.demoCredentialsDocumented = await page.getByRole('heading', { level: 4 }).evaluate(node => /username/i.test(node.textContent) && /password/i.test(node.textContent));
      const login = page.getByRole('button', { name: /Login/ });
      const selector = await login.evaluate(node => node.id ? '#' + CSS.escape(node.id) : node.tagName.toLowerCase());
      const inspected = await inspectAction(session, { selector, method: 'click', arguments: [] });
      receipt.loginPolicy = inspected.policy;
    }
    const filename = name + '.png';
    await page.screenshot({ path: directory + '/' + filename, mask: masks, maskColor: '#18283b' });
    const record = { path, httpStatus: session.response?.status(), visitedUrl: await session.page.url(), controls, screenshot: 'test-results/desktop-live/m7.1/' + filename, durationMs: performance.now() - start };
    receipt.captures.push(record);
  } catch (error) { receipt.captures.push({ path, outcome: 'INCONCLUSIVE', message: error.message, durationMs: performance.now() - start }); }
  finally { await session?.close(); save(); }
}
try {
  await launch();
  await window.screenshot({ path: directory + '/desktop-before.png' });
  await capture('/', 'home');
  await capture('/login', 'login-masked');
  await capture('/dynamic_controls', 'dynamic-controls');
  await capture('/upload', 'upload-preflight');
  const tickets = [
    { title: 'M7.1 A — Public demo login', description: 'Validate the documented public demo login. Documented credentials exist on the page; never reproduce their literal values. Use only the documented valid account and one invalid synthetic account. The execution precondition is User-authorized application origin. Form submission may be blocked by current safety policy; do not bypass it.', acceptanceCriteria: ['Valid documented demo credentials allow access to the secure area.', 'Invalid credentials are rejected.', 'Incorrect login shows a visible error.'] },
    { title: 'M7.1 B — Dynamic controls', description: 'Validate the public dynamic controls page with sequential low-volume operations. Discover controls with Stagehand. Assert actual visibility and enabled state with bounded polling, never fixed sleeps. The execution precondition is User-authorized application origin.', acceptanceCriteria: ['Removing the checkbox makes it unavailable.', 'Adding the checkbox restores it.', 'Enabling the input allows entry.', 'Disabling the input prevents entry.'] },
    { title: 'M7.1 C — Upload preflight', description: 'Inspect the public upload page without selecting or submitting any file. The execution precondition is User-authorized application origin.', acceptanceCriteria: ['The page exposes a file selection control.', 'The page exposes an upload action.'] },
  ];
  for (const ticket of tickets) {
    const start = performance.now();
    const result = await invoke('proposeTicketPlan', ticket);
    const record = { title: ticket.title, durationMs: performance.now() - start, status: result.status, message: result.message, review: result.review };
    receipt.tickets.push(record); save();
    console.log(JSON.stringify({ title: ticket.title, status: result.status, durationMs: record.durationMs }));
  }
  const start = performance.now();
  const observation = await invoke('observe', { url: origin + '/dynamic_controls', instruction: 'Discover the existing Remove checkbox button and Enable input button. Return only their click actions. Do not act.' });
  if (observation.screenshot) writeFileSync(directory + '/stagehand-dynamic.png', Buffer.from(observation.screenshot.split(',')[1], 'base64'));
  const { screenshot, ...details } = observation;
  receipt.observations.push({ ...details, screenshot: screenshot ? 'test-results/desktop-live/m7.1/stagehand-dynamic.png' : null, durationMs: performance.now() - start });
  await invoke('closeSession'); save();
  const before = await invoke('listKnowledge', '');
  const plansBefore = await invoke('listPlans');
  await app.close(); app = null;
  await launch();
  const after = await invoke('listKnowledge', '');
  const plansAfter = await invoke('listPlans');
  assert.deepEqual(before, after); assert.deepEqual(plansBefore, plansAfter);
  receipt.restart = { actualElectronRestart: true, plansPersisted: true, knowledgeBefore: before, knowledgeAfter: after, reuseMeasurement: null, reason: 'Observation alone does not create verified operational knowledge.' };
  await window.screenshot({ path: directory + '/desktop-after-restart.png' });
} catch (error) { receipt.interruption = error.message; }
finally { await app?.close(); receipt.durationMs = performance.now() - started; save(); }
console.log(JSON.stringify({ receipt: 'validation/desktop-m7.1-public.json', durationMs: receipt.durationMs, interruption: receipt.interruption }));
