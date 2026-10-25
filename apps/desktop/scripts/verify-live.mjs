import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';
import { createDemoServer } from '../demo/server.mjs';

// Explicit opt-in live inference, using only the controlled synthetic demo page.
const server = createDemoServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const env = { ...process.env, QASPIDER_DESKTOP_PROVIDER: 'codex', QASPIDER_DESKTOP_HEADLESS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ args: [fileURLToPath(new URL('..', import.meta.url))], env, timeout: 25_000 });
  const page = await app.firstWindow();
  await page.getByLabel('Observation application URL').fill(origin);
  await page.getByLabel('Observation instruction').fill('Find the Save demo button. Return only its click action.');
  await page.getByRole('button', { name: 'Observe page', exact: true }).click();
  await expect(page.getByTestId('workspace-status')).toContainText('Discovered', { timeout: 110_000 });
  await page.locator('.action-choice').filter({ hasText: 'Save demo' }).getByRole('radio').first().check();
  await page.getByLabel('Assertion selector', { exact: true }).fill('#status');
  await page.getByLabel('Expected value', { exact: true }).fill('Saved');
  await page.getByRole('checkbox', { name: 'I authorize this specific click', exact: false }).check();
  await page.getByRole('button', { name: 'Execute selected action', exact: true }).click();
  await expect(page.getByTestId('action-outcome').first()).toHaveText('PASS', { timeout: 30_000 });
  const evidence = JSON.parse(await page.locator('.action-run pre').first().textContent());
  assert.equal(evidence.actual, 'Saved');
  const directory = fileURLToPath(new URL('../../../test-results/desktop-live/', import.meta.url));
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: directory + '/m2-workspace.png', fullPage: true });
  const receipt = { verifiedAt: new Date().toISOString(), provider: 'codex-cli', liveInference: true, controlledDemoOnly: true, instruction: 'Find the Save demo button. Return only its click action.', ...evidence, outcome: 'PASS', screenshot: 'test-results/desktop-live/m2-workspace.png' };
  const validation = fileURLToPath(new URL('../../../validation/desktop-m2-live.json', import.meta.url));
  writeFileSync(validation, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
} finally {
  await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
