import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Browser regression runs must never touch the user's saved desktop plans.
process.env.QASPIDER_DESKTOP_DATA_DIR ??= mkdtempSync(join(tmpdir(), 'qaspider-desktop-smoke-'));
// Historical UI suites exercise the migration fallback explicitly. Chat suites override to '0'.
process.env.QASPIDER_DESKTOP_LEGACY_UI ??= '1';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.mjs', workers: 1, retries: 0,
  timeout: 90_000, expect: { timeout: 45_000 },
  outputDir: '../../test-results/desktop', reporter: 'list',
});
