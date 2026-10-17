import { expect, test, type Page } from '@playwright/test';
import { decodeRgbaPng } from './canvas2d-pen-pixel-helpers';

test.use({ video: 'on' });

async function openEditor(page: Page, query = '') {
  await page.goto(`/layered-editor?diagnostics=1${query}`);
  await expect(page.getByTestId('layered-drawing')).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__layeredEditor));
}

async function pointer(page: Page, phase: string, x: number, y: number, pressure = 0.5) {
  const box = (await page.getByTestId('layered-surface').boundingBox())!;
  await page.getByTestId('layered-surface').dispatchEvent(`pointer${phase}`, {
    pointerId: 41,
    pointerType: 'pen',
    clientX: box.x + x,
    clientY: box.y + y,
    button: 0,
    buttons: phase === 'up' ? 0 : 1,
    pressure,
  });
}

function pixel(png: Awaited<ReturnType<typeof decodeRgbaPng>>, x: number, y: number) {
  const offset = (y * png.width + x) * 4;
  return Array.from(png.pixels.slice(offset, offset + 3));
}

test('mixed SVG document order equals actual pixel order', async ({ page }, testInfo) => {
  await openEditor(page, '&fixture=mixed');
  await expect(page.locator('[data-object-id]')).toHaveCount(5);
  expect(
    await page
      .locator('[data-object-id]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-object-id')))
  ).toEqual(['lower-ink', 'middle-text', 'middle-image', 'upper-shape', 'upper-ink']);
  const screenshot = await page.getByTestId('layered-surface').screenshot();
  await testInfo.attach('mixed-order', { body: screenshot, contentType: 'image/png' });
  const png = await decodeRgbaPng(screenshot);
  expect(pixel(png, 50, 160)).toEqual([0, 128, 0]);
  expect(pixel(png, 90, 150)).toEqual([0, 0, 0]);
  expect(pixel(png, 140, 150)).toEqual([0, 0, 255]);
  expect(pixel(png, 200, 230)).toEqual([255, 255, 0]);
  expect(pixel(png, 230, 180)).toEqual([255, 0, 0]);
});

test('dot, pressure width and half-opacity delayed handoff remain visible', async ({
  page,
}, testInfo) => {
  await openEditor(page, '&handoffDelay=500');
  await page.getByLabel('笔宽', { exact: true }).fill('40');
  await page.getByLabel('不透明度', { exact: true }).fill('0.5');
  await page.getByLabel('压力模式', { exact: true }).selectOption('constant');
  const box = (await page.getByTestId('layered-surface').boundingBox())!;
  // Full viewport captures keep the video coordinate system stable during the handoff.
  const surfacePixel = (png: Awaited<ReturnType<typeof decodeRgbaPng>>, x: number, y: number) =>
    pixel(png, Math.round(box.x + x), Math.round(box.y + y));
  await pointer(page, 'down', 100, 100);
  const active = await decodeRgbaPng(await page.screenshot());
  expect(surfacePixel(active, 100, 100)).toEqual([137, 190, 177]);
  await pointer(page, 'up', 100, 100, 0);
  await expect(page.locator('[data-object-id]')).toHaveCount(1);
  await expect(page.locator('[data-object-id]')).toHaveCSS('visibility', 'hidden');
  const pending = await decodeRgbaPng(await page.screenshot());
  expect(surfacePixel(pending, 100, 100)).toEqual([137, 190, 177]);
  await expect(page.locator('[data-object-id]')).toHaveCSS('visibility', 'visible');
  const final = await page.screenshot();
  await testInfo.attach('dot-final', { body: final, contentType: 'image/png' });
  expect(surfacePixel(await decodeRgbaPng(final), 100, 100)).toEqual(
    surfacePixel(pending, 100, 100)
  );
  await page.getByLabel('压力模式', { exact: true }).selectOption('real');
  await pointer(page, 'down', 160, 140, 0.1);
  await pointer(page, 'move', 240, 140, 0.1);
  await pointer(page, 'up', 260, 140, 0);
  await pointer(page, 'down', 160, 220, 0.9);
  await pointer(page, 'move', 240, 220, 0.9);
  await pointer(page, 'up', 260, 220, 0);
  await expect(page.locator('[data-object-id]')).toHaveCount(3);
  await expect(page.locator('[data-object-id]').last()).toHaveCSS('visibility', 'visible');
  const png = await decodeRgbaPng(await page.screenshot());
  const thickness = (y: number) =>
    Array.from({ length: 70 }, (_, i) => surfacePixel(png, 220, y - 35 + i)).filter(
      ([r, g, b]) => g > r && g > b
    ).length;
  expect(thickness(220)).toBeGreaterThan(thickness(140) + 8);
  await page.getByLabel('压力模式', { exact: true }).selectOption('constant');
  await pointer(page, 'down', 350, 100);
  await pointer(page, 'move', 358, 100);
  await pointer(page, 'up', 360, 100, 0);
  await expect(page.locator('[data-object-id]').last()).toHaveCSS('visibility', 'visible');
  const short = await decodeRgbaPng(await page.screenshot());
  expect(surfacePixel(short, 355, 100)).toEqual([137, 190, 177]);
});

test('active samples do not reconcile history; tools preview and IME commit through the controller', async ({
  page,
}) => {
  await openEditor(page, '&fixture=mixed');
  const before = await page.evaluate(() => ({ ...window.__layeredRenders! }));
  await pointer(page, 'down', 350, 300);
  for (let i = 0; i < 20; i++) await pointer(page, 'move', 350 + i * 3, 300);
  expect(await page.evaluate(() => window.__layeredRenders)).toEqual(before);
  await pointer(page, 'up', 420, 300, 0);
  await page.getByRole('button', { name: '矩形', exact: true }).click();
  await pointer(page, 'down', 350, 100);
  await pointer(page, 'move', 450, 200);
  await expect(page.locator('[data-object-id="preview-shape"]')).toBeVisible();
  await pointer(page, 'up', 450, 200);
  await page.getByRole('button', { name: '文字', exact: true }).click();
  await pointer(page, 'down', 350, 350);
  const input = page.getByLabel('文字内容');
  await expect(input).toBeFocused();
  await input.dispatchEvent('compositionstart');
  await input.fill('中文\nLatin');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(input).toBeVisible();
  await input.dispatchEvent('compositionend');
  await expect(input).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__layeredEditor!.getSnapshot('document').objects.at(-1))
  ).toMatchObject({ kind: 'text', content: '中文\nLatin' });
});

test('mobile toolbar fits without horizontal overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openEditor(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await testInfo.attach('mobile', { body: await page.screenshot(), contentType: 'image/png' });
});

test('image file import decodes into ordered SVG pixels and one undo transaction', async ({
  page,
}) => {
  await openEditor(page);
  await page.getByRole('button', { name: '图片', exact: true }).click();
  const chooserPromise = page.waitForEvent('filechooser');
  await pointer(page, 'down', 100, 100);
  const chooser = await chooserPromise;
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 80;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#0000ff';
    context.fillRect(0, 0, 120, 80);
    return canvas.toDataURL().split(',')[1];
  });
  await chooser.setFiles({
    name: 'blue.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  await expect(page.locator('[data-object-id] image')).toHaveCount(1);
  const image = await decodeRgbaPng(await page.getByTestId('layered-surface').screenshot());
  expect(pixel(image, 140, 140)).toEqual([0, 0, 255]);
  const saved = await page.evaluate(() => window.__layeredEditor!.getSnapshot('document').objects);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.locator('[data-object-id] image')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(
    await page.evaluate(() => window.__layeredEditor!.getSnapshot('document').objects)
  ).toEqual(saved);
});
