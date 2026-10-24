import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { StudioStore } from '../../packages/studio/src/store.js';
import { ProjectRegistry } from '../../packages/studio/src/projects.js';
import { SqliteStore, ArtifactStore } from '../../packages/storage/src/index.js';
import { NavigationEngine } from '../../packages/navigation/src/engine.js';
import { navigationConfigSchema, type Scope } from '../../packages/core/src/index.js';
import { createEngine } from '../../packages/engine/src/server.js';
import { createStudioClient } from '../../packages/studio/src/client.js';

test.use({ trace: 'off' });

test('V3 Orchestrator-First Studio: chat intake, plan preview, thread switching, ticket queue, and archive persistence', async ({ browser, baseURL }, info) => {
  test.setTimeout(60000);
  const root = info.outputPath('studio-v3-root'), home = join(root, 'engine'), projects = join(root, 'projects');
  mkdirSync(projects, { recursive: true });

  const registryStore = new StudioStore(home);
  const registry = new ProjectRegistry(registryStore, [projects]);
  const project = registry.create({ name: 'V3 Studio Project', origin: baseURL! });
  registryStore.close();

  const dbPath = join(project.path, '.qaspider/memory.db');
  const store = new SqliteStore(dbPath);
  const artifacts = new ArtifactStore(store, join(project.path, '.qaspider/artifacts'));
  const scope: Scope = { applicationId: 'benchmark', environmentId: 'development', roleId: 'guest', build: 'v3-proof', tenant: 'public', featureFlags: {} };
  const mapped = await new NavigationEngine(store, artifacts, browser).map(scope, baseURL + '/', navigationConfigSchema.parse({}), { depth: 0, intervalMs: 0 });
  expect(mapped.status).toBe('complete');
  store.close();

  const token = 'v3-studio-proof-token';
  const authFile = join(root, 'auth.json');
  writeFileSync(authFile, JSON.stringify([{ id: 'tool', kind: 'agent', tokenHash: createHash('sha256').update(token).digest('hex'), projects: [project.id], actions: ['read', 'plan', 'execute', 'review'] }]), { mode: 0o600 });

  const engine = createEngine(home, [projects], authFile, { planningProvider: () => { throw new Error('AI disabled'); } });
  await new Promise<void>(r => engine.server.listen(0, '127.0.0.1', r));
  const address = engine.server.address();
  if (!address || typeof address === 'string') throw new Error('No listener');

  try {
    await engine.auth.setup(engine.auth.open(), 'v3-studio-password-demo');
    engine.registry.select(project.id);
    const session = engine.auth.open(true);

    const web = createStudioClient(`http://127.0.0.1:${address.port}`);
    await new Promise<void>(r => web.listen(0, '127.0.0.1', r));
    const webAddress = web.address();
    if (!webAddress || typeof webAddress === 'string') throw new Error('No web client');

    const page = await browser.newPage();
    try {
      await page.context().addCookies([{ name: `qaspider-studio-${address.port}`, value: session.token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }]);
      const res = await page.goto(`http://127.0.0.1:${webAddress.port}/#v3`);
      expect(res?.ok()).toBe(true);

      // Verify V3 landing page is Orchestrator
      await expect(page.getByRole('heading', { name: 'QA Orchestrator' })).toBeVisible({ timeout: 10000 });
      await expect(page.getByRole('button', { name: 'Orchestrator' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'QA Tickets' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Knowledge' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();

      // Submit chat message with ticket
      const composer = page.getByLabel('Message');
      await composer.fill('# Home Page Smoke\n## Acceptance Criteria\n- AC-1: QASpider benchmark heading is visible.');
      await page.getByRole('button', { name: 'Send message' }).click();

      // Expect thread in sidebar and assistant response
      await expect(page.getByText(/I've queued 1 ticket\(s\)/)).toBeVisible({ timeout: 15000 });
      await expect(page.getByText('Home Page Smoke')).toBeVisible();

      // Start a second conversation (+ New)
      await page.getByRole('button', { name: '+ New' }).click();
      await expect(page.getByRole('heading', { name: 'QA Orchestrator' })).toBeVisible();

      // Switch back to original thread
      await page.getByText('Home Page Smoke').first().click();
      await expect(page.getByText(/I've queued 1 ticket\(s\)/)).toBeVisible();

      // Navigate to QA Tickets
      await page.getByRole('button', { name: 'QA Tickets' }).click();
      await expect(page.getByRole('heading', { name: 'QA Tickets' })).toBeVisible();
      await expect(page.getByText('Home Page Smoke')).toBeVisible();

      // Navigate to Knowledge
      await page.getByRole('button', { name: 'Knowledge' }).click();
      await expect(page.getByRole('heading', { name: 'Knowledge' })).toBeVisible();
      await expect(page.getByText('Scoped Navigation Routes')).toBeVisible();

      // Return to Orchestrator and archive thread
      await page.getByRole('button', { name: 'Orchestrator' }).click();
      const archiveBtn = page.getByRole('button', { name: /Archive/ }).first();
      await archiveBtn.click();

      // Confirm tasks in engine database are preserved even after thread is archived
      const taskInEngine = engine.orchestration.tasks(project.id).find(t => t.title === 'Home Page Smoke');
      expect(taskInEngine).toBeDefined();
    } finally {
      await page.close();
      web.closeAllConnections();
      await new Promise<void>(r => web.close(() => r()));
    }
  } finally {
    await engine.shutdown();
  }
});
