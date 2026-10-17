import { defineConfig } from '@playwright/test';
import config from './playwright.config';

export default defineConfig({
  ...config,
  outputDir: 'test-results/webkit',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/webkit' }]],
  testMatch: [
    'layered-editor.spec.ts',
    'resource-editing-fixture.spec.ts',
    'ruler-edge-inputs.spec.ts',
  ],
  projects: [{ name: 'webkit', use: { browserName: 'webkit', launchOptions: { args: [] } } }],
});
