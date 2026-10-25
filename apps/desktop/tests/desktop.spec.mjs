import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { captureTarget } from '../electron/browser.mjs';
import { localBrowser, Stagehand } from '@browserbasehq/stagehand';
import { chromium } from 'playwright';

const appPath = fileURLToPath(new URL('..', import.meta.url));
let server;
let forbidden;
let origin;
let forbiddenOrigin;
let forbiddenHits = 0;
let slowResponse;

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

async function launch(overrides = {}) {
  const env = { ...process.env, QASPIDER_DESKTOP_HEADLESS: '1', ...overrides };
  delete env.ELECTRON_RUN_AS_NODE;
  for (const key of Object.keys(env)) if (/API_KEY|ANTHROPIC|OPENAI/.test(key)) delete env[key];
  return electron.launch({ args: [appPath], env, timeout: 25_000 });
}

test.beforeAll(async () => {
  forbidden = createServer((_request, response) => { forbiddenHits++; response.end('Must not be visited'); });
  forbiddenOrigin = await listen(forbidden);
  server = createServer((request, response) => {
    if (request.url === '/slow') { slowResponse = response; return; }
    if (request.url === '/redirect') { response.writeHead(302, { Location: `${forbiddenOrigin}/` }); response.end(); return; }
    if (request.url === '/missing') response.statusCode = 404;
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html><head><title>QA fixture</title></head><body style="background:#e7f7f0;padding:48px"><h1>QASpider local fixture</h1><p>No inference provider needed.</p></body></html>');
  });
  origin = await listen(server);
});
test.afterAll(async () => {
  await Promise.all([server, forbidden].map(server => new Promise(resolve => server.close(resolve))));
});

test('real Electron → preload → Stagehand → Chromium → screenshot, then retry and HTTP error', async () => {
  const app = await launch();
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: 'Open. Capture. Inspect.' })).toBeVisible();
    expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
    expect(await app.evaluate(({ BrowserWindow }) => {
      const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return { sandbox: preferences.sandbox, nodeIntegration: preferences.nodeIntegration, contextIsolation: preferences.contextIsolation };
    })).toEqual({ sandbox: true, nodeIntegration: false, contextIsolation: true });
    for (const path of ['/first', '/again', '/missing']) {
      await page.getByLabel('Target application URL').fill(origin + path);
      await page.getByRole('button', { name: 'Open Browser' }).click();
      await expect(page.getByTestId('status')).toHaveText(path === '/missing' ? 'Failed' : 'Complete');
      await expect(page.getByTestId('visited-url')).toHaveText(origin + path);
      await expect(page.getByAltText('Captured target application')).toBeVisible();
      expect(await page.getByAltText('Captured target application').evaluate(img => img.naturalWidth)).toBe(1280);
      if (path === '/first') await page.screenshot({ path: '../../test-results/desktop/window.png', fullPage: true });
    }
  } finally { await app.close(); }
});

test('blocked redirect never reaches the other origin and UI can recover', async () => {
  const app = await launch();
  try {
    const page = await app.firstWindow();
    const hitsBefore = forbiddenHits;
    await page.getByLabel('Target application URL').fill(origin + '/redirect');
    await page.getByRole('button', { name: 'Open Browser' }).click();
    await expect(page.getByTestId('status')).toHaveText('Failed');
    await expect(page.getByRole('alert')).toContainText(`Navigation to ${forbiddenOrigin} was blocked`);
    expect(forbiddenHits).toBe(hitsBefore);
    await page.getByLabel('Target application URL').fill(origin);
    await page.getByRole('button', { name: 'Open Browser' }).click();
    await expect(page.getByTestId('status')).toHaveText('Complete');
  } finally { await app.close(); }
});

test('default visible Chromium captures successfully on the desktop', async () => {
  const app = await launch({ QASPIDER_DESKTOP_HEADLESS: '0' });
  try {
    const page = await app.firstWindow();
    await page.getByLabel('Target application URL').fill(origin + '/visible');
    await page.getByRole('button', { name: 'Open Browser' }).click();
    await expect(page.getByTestId('status')).toHaveText('Complete');
    await expect(page.getByTestId('visited-url')).toHaveText(origin + '/visible');
    await expect(page.getByAltText('Captured target application')).toBeVisible();
    expect(await page.getByAltText('Captured target application').evaluate(img => img.naturalWidth)).toBe(1280);
  } finally { await app.close(); }
});

test('startup failure is displayed and the button is enabled for retry', async () => {
  const app = await launch({ CHROME_PATH: '/missing-qaspider-browser' });
  try {
    const page = await app.firstWindow();
    await page.getByLabel('Target application URL').fill(origin);
    await page.getByRole('button', { name: 'Open Browser' }).click();
    await expect(page.getByTestId('status')).toHaveText('Failed');
    await expect(page.getByRole('alert')).toContainText('browser startup');
    await expect(page.getByRole('button', { name: 'Open Browser' })).toBeEnabled();
  } finally { await app.close(); }
});

test('real Stagehand browser is closed after success and navigation failure', async () => {
  let browser;
  const dependencies = {
    localBrowser: { launch: async options => { browser = await localBrowser.launch(options); return browser; } },
    Stagehand, chromium,
  };
  const success = await captureTarget(origin, { headless: true }, dependencies);
  expect(success.status, success.message).toBe('success');
  expect(browser.closed).toBe(true);
  const failed = await captureTarget('http://127.0.0.1:1', { headless: true }, dependencies);
  expect(failed.status).toBe('error');
  expect(failed.message).toContain('navigation');
  expect(browser.closed).toBe(true);
});

test('quit waits for capture cleanup and concurrent requests are rejected', async () => {
  const app = await launch();
  const desktopProcess = app.process();
  try {
    const page = await app.firstWindow();
    slowResponse = undefined;
    await page.getByLabel('Target application URL').fill(origin + '/slow');
    await page.getByRole('button', { name: 'Open Browser' }).click();
    await expect.poll(() => Boolean(slowResponse)).toBe(true);
    expect(await page.evaluate(url => window.qaspider.openBrowser(url), origin)).toMatchObject({
      status: 'error', message: 'A browser capture is already running.',
    });
    await app.evaluate(({ app }) => app.quit());
    // The quit request must leave the app alive while the page is loading.
    expect(desktopProcess.exitCode).toBe(null);
    const closed = app.waitForEvent('close');
    slowResponse.end('<!doctype html><h1>Finished capture before exit</h1>');
    await closed;
    expect(desktopProcess.exitCode).toBe(0);
  } finally {
    slowResponse?.end();
    if (desktopProcess.exitCode === null) await app.close();
  }
});
