import { test, expect } from '@playwright/test';

test('smoke: Expo Web app loads and shows Playground Ready', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('Playground Ready')).toBeVisible({ timeout: 30000 });

  await expect(page.getByTestId('drawing-surface-smoke')).toBeVisible({ timeout: 30000 });
});
