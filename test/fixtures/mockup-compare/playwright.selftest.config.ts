// selftest 専用の Playwright 設定。サンドボックスへコピーして使う
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /selftest\.spec\.ts$/,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/selftest-results.json' }]],
  use: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
});
