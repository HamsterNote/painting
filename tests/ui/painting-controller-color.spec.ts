import { expect, test } from '@playwright/test';

test.describe('PaintingController stroke color', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('updates shared boards from six fixed colors and a custom color input', async ({ page }) => {
    // Given: 共享底栏以黑色作为当前笔触颜色。
    const colorButton = page.getByTestId('painting-board-stroke-color-btn');
    await expect(colorButton).toBeVisible();
    await expect(colorButton).toHaveAttribute('aria-label', 'Stroke color: #000000');

    // When: 打开颜色菜单并选择蓝色预设。
    await colorButton.click();
    const colorMenu = page.getByTestId('painting-board-stroke-color-menu');
    await expect(colorMenu).toBeVisible();
    await expect(colorMenu.getByRole('menuitem')).toHaveCount(6);
    const presetSwatch = page.getByTestId('painting-board-stroke-color-preset-1-swatch');
    const customSwatch = page.getByTestId('painting-board-stroke-color-custom-swatch');
    const customInput = page.getByTestId('painting-board-stroke-color-custom-input');
    await expect(customInput).toBeVisible();

    // Then: 预设和 Custom 都以菜单左侧的同尺寸圆形色块呈现。
    const presetBox = await presetSwatch.boundingBox();
    const customBox = await customSwatch.boundingBox();
    expect(presetBox).toMatchObject({ width: 20, height: 20 });
    expect(customBox).toMatchObject({ width: 20, height: 20 });
    expect(customBox?.x).toBeCloseTo(presetBox?.x ?? 0, 0);
    await expect(presetSwatch).toHaveCSS('border-radius', '50%');
    await expect(customSwatch).toHaveCSS('border-radius', '50%');
    await expect(customInput).toHaveCSS('opacity', '0');

    // When: 用户选择蓝色预设。
    await page.getByTestId('painting-board-stroke-color-preset-1').click();

    // Then: 共享 data 和真实画板笔触均使用所选颜色。
    await expect(colorMenu).toBeHidden();
    await expect(colorButton).toHaveAttribute('aria-label', 'Stroke color: #2563eb');
    await expect(page.getByTestId('painting-controller-data-preview')).toContainText(
      '"strokeColor": "#2563eb"'
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
    await expect(surface.locator('[stroke="#2563eb"]').first()).toBeVisible();

    // When: 再通过原生颜色输入指定自选颜色。
    await colorButton.click();
    await customInput.fill('#14b8a6');

    // Then: 自选颜色同样写回共享 data。
    await expect(page.getByTestId('painting-controller-data-preview')).toContainText(
      '"strokeColor": "#14b8a6"'
    );
  });

  test('hides the color control while lasso is active', async ({ page }) => {
    // Given / When: 用户切换到套索工具。
    await page.getByTestId('painting-board-toolbar').locator('[data-tool="lasso"]').click();

    // Then: 套索没有笔触颜色入口。
    await expect(page.getByTestId('painting-board-stroke-color-btn')).toHaveCount(0);
  });
});
