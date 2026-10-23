import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/smoke', fullyParallel: false, workers: 1, retries: 0,
  outputDir: 'test-results', reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4317', browserName: 'chromium', trace: 'on' },
  webServer: { command: 'node dist/apps/benchmark/src/main.js', url: 'http://127.0.0.1:4317/health', reuseExistingServer: false, timeout: 15000, env: { PORT: '4317', BENCHMARK_FIXTURE_TOKEN: 'smoke-fixture-token' } }
});
