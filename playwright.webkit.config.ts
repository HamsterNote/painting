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
    'playground.spec.ts',
    'ruler-test.spec.ts',
    'touch-drawing-arbitration.spec.ts',
    'painting-controller-color.spec.ts',
    'painting-controller-width.spec.ts',
    'interaction-feedback.spec.ts',
    'touch-ruler-feedback.spec.ts',
    'editor-candidate.spec.ts',
    'editor-candidate-canvas2d-pen.spec.ts',
  ],
  projects: [{ name: 'webkit', use: { browserName: 'webkit', launchOptions: { args: [] } } }],
});
