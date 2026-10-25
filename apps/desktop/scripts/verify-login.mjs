import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';
import { createDemoServer } from '../demo/server.mjs';

// Live inference is explicitly scoped to empty synthetic login fields.
const server = createDemoServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const instruction = 'Find the Username and Password input fields and the Sign in button on this login page. Propose fill for both input fields using synthetic demo values, and click for Sign in. Do not execute any action.';
const env = { ...process.env, QASPIDER_DESKTOP_PROVIDER: 'codex', QASPIDER_DESKTOP_HEADLESS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ args: [fileURLToPath(new URL('..', import.meta.url))], env, timeout: 25_000 });
  const page = await app.firstWindow();
  await page.getByLabel('Observation application URL').fill(origin + '/login');
  await page.getByLabel('Observation instruction').fill(instruction);
  await page.getByRole('button', { name: 'Observe page', exact: true }).click();
  await expect(page.getByTestId('workspace-status')).toContainText('Discovered', { timeout: 110_000 });
  const rows = await page.locator('.action-choice').allTextContents();
  for (const label of ['Username', 'Password', 'Sign in']) assert(rows.some(row => row.toLowerCase().includes(label.toLowerCase())), 'Missing live observation: ' + label);
  assert.equal(await page.locator('.action-choice input:not(:disabled)').count(), 0, 'Unvalidated form actions must remain blocked');
  await expect(page.getByAltText('Observed application')).toBeVisible();
  const directory = fileURLToPath(new URL('../../../test-results/desktop-live/', import.meta.url));
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: directory + '/m2-login.png', fullPage: true });
  await page.getByRole('button', { name: 'Close observation browser', exact: true }).click();
  await expect(page.getByTestId('workspace-status')).toHaveText('Browser session closed.');
  const receipt = {
    verifiedAt: new Date().toISOString(), provider: 'codex-cli', liveInference: true, controlledLoginOnly: true,
    instruction, discoveredRows: rows, displayedInDesktop: true, formActionsBlocked: true,
    credentialsEntered: false, loginExecuted: false, browserSessionClosed: true,
    screenshot: 'test-results/desktop-live/m2-login.png',
  };
  writeFileSync(fileURLToPath(new URL('../../../validation/desktop-m2-login.json', import.meta.url)), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
} finally { await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
