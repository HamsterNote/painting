import { openToolbarSettings, openToolbarStroke, selectToolbarTool } from './layered-helpers';
import { expect, test } from '@playwright/test';
import { drawLayeredStroke, layeredState, openLayeredEditor } from './layered-helpers';

test('six colors and a custom color reach filled paths through the toolbar', async ({ page }) => {
  await openLayeredEditor(page);
  for (const [index, color] of [
    '#000000',
    '#ef4444',
    '#f97316',
    '#22c55e',
    '#3b82f6',
    '#a855f7',
    '#123456',
  ].entries()) {
    await openToolbarStroke(page);
    await page.getByLabel('自由取色', { exact: true }).evaluate((input, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, color);
    await drawLayeredStroke(page, 100 + index * 40);
    await expect(
      page.getByTestId('layered-display').locator('[data-object-id] path').last()
    ).toHaveAttribute('fill', color);
  }
  expect((await layeredState(page)).document.objects).toHaveLength(7);
  await selectToolbarTool(page, '套索');
  await openToolbarSettings(page);
  await expect(page.getByLabel('自由取色', { exact: true })).toHaveCount(0);
});
