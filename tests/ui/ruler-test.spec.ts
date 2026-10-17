import { expect, test } from '@playwright/test';
import {
  dispatchLayeredPointer as pointer,
  layeredState,
  openLayeredEditor,
} from './layered-helpers';

test.beforeEach(async ({ page }) => {
  await openLayeredEditor(page);
  await page.getByLabel('尺子', { exact: true }).check();
});

test('infinite ruler has physical ticks and is clipped by the surface', async ({ page }) => {
  const surface = page.getByTestId('layered-surface');
  const ruler = page.getByTestId('layered-ruler');
  await expect(ruler).toBeVisible();
  await expect(surface).toHaveCSS('overflow', 'hidden');
  const box = (await surface.boundingBox())!;
  expect(Number(await ruler.locator('rect').getAttribute('width'))).toBeGreaterThan(
    Math.hypot(box.width, box.height) * 2
  );
  expect(await ruler.locator('line').count()).toBeGreaterThan(100);
  await expect(ruler.locator('circle')).toHaveCount(0);
});

test('paper zoom leaves screen-space ruler pose unchanged', async ({ page }) => {
  const ruler = page.getByTestId('layered-ruler').locator(':scope > g');
  const before = await ruler.getAttribute('transform');
  await page.getByLabel('缩放', { exact: true }).fill('200');
  await expect(ruler).toHaveAttribute('transform', before!);
  expect((await layeredState(page)).viewport.viewport.scale).toBe(2);
  expect((await layeredState(page)).document.objects).toHaveLength(0);
});

test('plain mouse on ruler draws while Alt drag rotates only the ruler', async ({ page }) => {
  const initial = await layeredState(page);
  const center = initial.navigation.ruler.center;
  await pointer(page, 'down', center, { source: 'mouse' });
  await pointer(page, 'move', { x: center.x + 70, y: center.y + 10 }, { source: 'mouse' });
  await pointer(page, 'up', { x: center.x + 100, y: center.y + 10 }, { source: 'mouse' });
  const drawn = await layeredState(page);
  expect(drawn.document.objects).toHaveLength(1);
  expect(drawn.navigation.ruler).toEqual(initial.navigation.ruler);
  const box = (await page.getByTestId('layered-surface').boundingBox())!;
  const pivot = { x: box.width / 2, y: center.y };
  await pointer(page, 'down', { x: pivot.x + 100, y: pivot.y }, { source: 'mouse', altKey: true });
  await pointer(
    page,
    'move',
    { x: pivot.x + 70, y: pivot.y + 70 },
    { source: 'mouse', altKey: true }
  );
  await expect(page.getByTestId('ruler-angle-feedback')).toBeVisible();
  await pointer(
    page,
    'up',
    { x: pivot.x + 70, y: pivot.y + 70 },
    { source: 'mouse', altKey: true }
  );
  await expect(page.getByTestId('ruler-angle-feedback')).toHaveCount(0);
  const rotated = await layeredState(page);
  expect(rotated.navigation.ruler.rotationRad).not.toBe(0);
  expect(rotated.viewport).toEqual(drawn.viewport);
  expect(rotated.document).toEqual(drawn.document);
  expect(rotated.history).toEqual(drawn.history);
});
