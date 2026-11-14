import { defineConfig } from '@playwright/test';
import config from './playwright.config';

// Focused cross-engine visual evidence; this is not an Expo DOM device test.
export default defineConfig({
  ...config,
  testMatch: 'painting-toolbar.spec.ts',
  grep: /stroke smoke/,
  outputDir: 'test-results/stroke-webkit',
  reporter: [['list']],
  projects: [{ name: 'webkit', use: { browserName: 'webkit', launchOptions: { args: [] } } }],
});
