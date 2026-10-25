import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.mjs', workers: 1, retries: 0,
  timeout: 90_000, expect: { timeout: 45_000 },
  outputDir: '../../test-results/desktop', reporter: 'list',
});
