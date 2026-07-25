import { expect, test } from '@playwright/test';

test.describe('PaintingController stroke width', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('updates the shared boards from a five-option width menu', async ({ page }) => {
    const widthButton = page.getByTestId('painting-board-stroke-width-btn');
    await expect(widthButton).toBeVisible();
    await expect(widthButton).toHaveText('2 px');

    await widthButton.click();
    const widthMenu = page.getByTestId('painting-board-stroke-width-menu');
    await expect(widthMenu).toBeVisible();
    await expect(widthMenu.getByRole('menuitem')).toHaveCount(5);

    await page.getByTestId('painting-board-stroke-width-8').click();
    await expect(widthMenu).toBeHidden();
    await expect(widthButton).toHaveText('8 px');
    await expect(page.getByTestId('painting-controller-data-preview')).toContainText(
      '"strokeWidth": 8',
    );

    const surface = page.getByTestId('painting-board-demo-a');
    await surface.scrollIntoViewIfNeeded();
    const box = await surface.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.mouse.move(box.x + 50, box.y + 50);
    await page.mouse.down();
    await page.mouse.move(box.x + 150, box.y + 120);
    await page.mouse.up();

    await expect(surface.locator('[stroke-width="8"]').first()).toBeVisible();
  });

  test('hides the width control while lasso is active', async ({ page }) => {
    await page.getByTestId('painting-board-toolbar').locator('[data-tool="lasso"]').click();
    await expect(page.getByTestId('painting-board-stroke-width-btn')).toHaveCount(0);
  });
});
