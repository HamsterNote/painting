import { expect, test } from '@playwright/test';
import {
  dispatchLayeredPointer as pointer,
  drawLayeredStroke,
  layeredState,
  openLayeredEditor,
  selectToolbarTool,
} from './layered-helpers';

for (const width of [1280, 390, 320]) {
  test(`zoom readout never shifts capsule or groups at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openLayeredEditor(page);
    const strip = page.getByRole('toolbar');
    await page.getByRole('button', { name: '缩放比例', exact: true }).click();
    const zoom = page.getByRole('slider', { name: '缩放', exact: true });
    const measure = () =>
      strip.evaluate((el) => ({
        width: el.getBoundingClientRect().width,
        scroll: el.scrollWidth,
        zoom: el.querySelector('[aria-label="缩放比例"]')!.getBoundingClientRect().width,
        groups: Array.from(el.children).map(
          (child) =>
            child.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft
        ),
      }));
    let baseline: Awaited<ReturnType<typeof measure>> | undefined;
    for (const percent of [100, 125, 200, 25, 800]) {
      await zoom.press('Home');
      for (let i = 25; i < percent; i += 25) await zoom.press('ArrowRight');
      await expect(page.getByRole('button', { name: '缩放比例', exact: true })).toHaveText(
        `${percent}%`
      );
      const dimensions = await measure();
      expect(dimensions.zoom).toBe(72);
      baseline ??= dimensions;
      expect(dimensions).toEqual(baseline);
    }
  });
}

test('primary width reaches new brush snapshots and restores each tool family', async ({
  page,
}) => {
  await openLayeredEditor(page);
  const width = page.getByRole('toolbar').getByLabel('笔宽', { exact: true });
  await width.fill('4');
  await drawLayeredStroke(page, 100);
  await width.fill('16');
  await drawLayeredStroke(page, 160);
  await selectToolbarTool(page, '矩形');
  await width.fill('3');
  await pointer(page, 'down', { x: 300, y: 100 });
  await pointer(page, 'up', { x: 400, y: 180 });
  const before = (await layeredState(page)).document.objects;
  expect(
    before.map((o) =>
      o.kind === 'freehand'
        ? o.brushSnapshot.nominalSize
        : o.kind === 'shape'
          ? o.style.width
          : null
    )
  ).toEqual([4, 16, 3]);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect((await layeredState(page)).document.objects).toEqual(before);
  await selectToolbarTool(page, '画笔');
  await expect(width).toHaveValue('16');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('笔宽', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await selectToolbarTool(page, '橡皮擦');
  await expect(width).toBeDisabled();
  await selectToolbarTool(page, '矩形');
  await expect(width).toHaveValue('3');
});

test('eraser trail has an intermediate fading frame, expires, and adds no history', async ({
  page,
}, info) => {
  await openLayeredEditor(page);
  await drawLayeredStroke(page);
  await selectToolbarTool(page, '橡皮擦');
  await pointer(page, 'down', { x: 80, y: 120 });
  await pointer(page, 'move', { x: 250, y: 120 });
  await pointer(page, 'up', { x: 260, y: 120 });
  const trail = page.locator('[data-eraser-trail]');
  await expect(trail).toHaveCount(1);
  await expect(trail).toHaveCSS('pointer-events', 'none');
  const saved = await layeredState(page);
  expect(saved.document.objects).toHaveLength(0);
  await page.waitForTimeout(700);
  const opacity = await trail
    .locator('g')
    .first()
    .evaluate((path) => Number(getComputedStyle(path).opacity));
  expect(opacity).toBeGreaterThan(0);
  expect(opacity).toBeLessThan(1);
  await info.attach('eraser-trail-intermediate', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await expect.poll(() => trail.count(), { timeout: 3000, intervals: [50] }).toBe(0);
  const faded = await layeredState(page);
  expect(faded.document).toEqual(saved.document);
  expect(faded.history).toEqual(saved.history);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await layeredState(page)).document.objects).toHaveLength(1);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await layeredState(page)).document.objects).toHaveLength(0);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
});

test('eraser feedback clears immediately on tool change, undo, clear and page exit', async ({
  page,
}) => {
  for (const reason of ['tool', 'undo', 'clear', 'pagehide']) {
    await openLayeredEditor(page);
    await drawLayeredStroke(page);
    await selectToolbarTool(page, '橡皮擦');
    // Miss the saved stroke so clear remains enabled and undo can remove the original stroke.
    await pointer(page, 'down', { x: 300, y: 200 });
    await pointer(page, 'up', { x: 420, y: 200 });
    await expect(page.locator('[data-eraser-trail]')).toHaveCount(1);
    if (reason === 'tool') await selectToolbarTool(page, '选择');
    else if (reason === 'pagehide') await page.evaluate(() => dispatchEvent(new Event('pagehide')));
    else
      await page
        .getByRole('button', { name: reason === 'undo' ? '撤销' : '清空画布', exact: true })
        .click();
    await expect(page.locator('[data-eraser-trail]')).toHaveCount(0);
    expect((await layeredState(page)).preview).toEqual({ objects: [], hiddenIds: [], path: [] });
  }
});
