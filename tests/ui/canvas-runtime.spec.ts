import { expect, test } from '@playwright/test';
import { drawLayeredStroke, layeredState } from './layered-helpers';

for (const blocked of [false, true]) {
  test(`default runtime uses layered ink without CanvasKit (WASM blocked=${blocked})`, async ({
    page,
  }) => {
    const requests: string[] = [];
    const errors: string[] = [];
    page.on('request', (request) => {
      if (/canvaskit|react-native-skia/i.test(request.url())) requests.push(request.url());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    if (blocked) await page.route('**/*.wasm', (route) => route.abort());
    await page.goto('/?diagnostics=1');
    await expect(page.getByTestId('layered-surface')).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(1);
    await drawLayeredStroke(page);
    expect((await layeredState(page)).document.objects).toHaveLength(1);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect((await layeredState(page)).document.objects).toHaveLength(0);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    expect((await layeredState(page)).document.objects).toHaveLength(1);
    await expect(page.getByTestId('layered-display')).toBeVisible();
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
  });
}
