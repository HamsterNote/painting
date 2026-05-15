import { expect, test } from '@playwright/test';

test('smoke: Expo Web app loads and shows Playground Ready', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Playground Ready')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('drawing-surface-smoke')).toBeVisible({ timeout: 30000 });
});

test('drag paints stroke', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('hamster-painting-stroke-count')).toHaveText('Stroke Count: 0');
  await expect(page.getByTestId('hamster-painting-status')).toHaveText('Idle');

  const surface = page.getByTestId('drawing-surface-smoke');
  await expect(surface).toBeVisible();
  const box = await surface.boundingBox();
  if (!box) throw new Error('Surface bounding box not found');

  const startX = box.x + box.width * 0.25;
  const startY = box.y + box.height * 0.25;
  const endX = box.x + box.width * 0.75;
  const endY = box.y + box.height * 0.75;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();

  await expect(page.getByTestId('hamster-painting-stroke-count')).toHaveText(
    /Stroke Count: [1-9]\d*/
  );
  await expect(page.getByTestId('hamster-painting-status')).toHaveText('Drawn');
});

test('tap does not paint', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('hamster-painting-stroke-count')).toHaveText('Stroke Count: 0');

  const surface = page.getByTestId('drawing-surface-smoke');
  await expect(surface).toBeVisible();
  const box = await surface.boundingBox();
  if (!box) throw new Error('Surface bounding box not found');

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await expect(page.getByTestId('hamster-painting-stroke-count')).toHaveText('Stroke Count: 0');
});
