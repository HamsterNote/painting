import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/toolbar',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5279',
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm build:lib && node scripts/toolbar-fixture.mjs',
    port: 5279,
    timeout: 120000,
  },
});
