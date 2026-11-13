import { defineConfig } from '@playwright/test';
import config from './playwright.config';

// Explicit production-only verification, with no implicit rebuild or dev server.
export default defineConfig({
  ...config,
  workers: 1,
  use: { ...config.use, baseURL: 'http://127.0.0.1:5281' },
  webServer: {
    command: `node scripts/perf/static-spa-server.mjs --port 5281 --root ${process.env.LASSO_EXPORT_ROOT ?? 'apps/playground/dist'}`,
    port: 5281,
    reuseExistingServer: false,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          ...config.use?.launchOptions,
          ...(process.env.LASSO_CHROMIUM_EXECUTABLE
            ? { executablePath: process.env.LASSO_CHROMIUM_EXECUTABLE }
            : {}),
        },
      },
    },
    { name: 'webkit', use: { browserName: 'webkit', launchOptions: { args: [] } } },
  ],
});
