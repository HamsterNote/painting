import { defineConfig } from '@playwright/test';

const isCI = Boolean(process.env.CI || process.env.GITHUB_ACTIONS);

export default defineConfig({
  testDir: 'tests/ui',
  timeout: 120000,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5266',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    launchOptions: {
      args: ['--no-sandbox', '--disabled-setuid-sandbox'],
    },
  },
  webServer: {
    command: 'yarn dev',
    port: 5266,
    reuseExistingServer: !isCI,
    timeout: isCI ? 60000 : 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
      },
    },
  ],
});
