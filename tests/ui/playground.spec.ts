import { expect, test } from '@playwright/test';
import {
  dispatchLayeredPointer as pointer,
  drawLayeredStroke,
  layeredState,
  openLayeredEditor,
} from './layered-helpers';

test.beforeEach(async ({ page }) => openLayeredEditor(page));

test('drawing persists accepted raw samples; undo and redo restore the identical object', async ({
  page,
}) => {
  await drawLayeredStroke(page);
  const saved = (await layeredState(page)).document.objects;
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ kind: 'freehand', resolvedPressureMode: 'real' });
  if (saved[0].kind !== 'freehand') throw new Error('Expected freehand');
  expect(saved[0].samples.map((p) => [p.x, p.y])).toEqual([
    [100, 120],
    [180, 120],
    [220, 120],
  ]);
  expect(saved[0].samples.at(-1)?.pressure).toBe(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await layeredState(page)).document.objects).toHaveLength(0);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect((await layeredState(page)).document.objects).toEqual(saved);
});

test('tap is a filled dot; cancelling or changing tools never writes a partial stroke', async ({
  page,
}) => {
  await pointer(page, 'down', { x: 100, y: 100 });
  await pointer(page, 'up', { x: 100, y: 100 });
  await expect(page.locator('[data-object-id] path')).toHaveAttribute('fill', '#147d64');
  const saved = (await layeredState(page)).document.objects;
  await pointer(page, 'down', { x: 200, y: 100 });
  await pointer(page, 'move', { x: 250, y: 100 });
  await pointer(page, 'cancel', { x: 250, y: 100 });
  expect((await layeredState(page)).document.objects).toEqual(saved);
  await pointer(page, 'down', { x: 200, y: 100 });
  await page.getByRole('button', { name: '矩形', exact: true }).click();
  await pointer(page, 'up', { x: 260, y: 100 });
  expect((await layeredState(page)).document.objects).toEqual(saved);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await layeredState(page)).document.objects).toHaveLength(0);
});

test('second source cannot steal a stroke or its frozen viewport', async ({ page }) => {
  const before = await layeredState(page);
  await pointer(page, 'down', { x: 100, y: 100 });
  await pointer(page, 'down', { x: 400, y: 400 }, { source: 'touch', id: 99 });
  await pointer(page, 'move', { x: 450, y: 450 }, { source: 'touch', id: 99 });
  await pointer(page, 'up', { x: 450, y: 450 }, { source: 'touch', id: 99 });
  await pointer(page, 'move', { x: 200, y: 100 });
  await pointer(page, 'up', { x: 220, y: 100 });
  const after = await layeredState(page);
  expect(after.viewport).toEqual(before.viewport);
  expect(after.document.objects).toHaveLength(1);
  const object = after.document.objects[0];
  if (object.kind !== 'freehand') throw new Error('Expected freehand');
  expect(object.samples.every((p) => p.y === 100)).toBe(true);
});

test('all retained tool modes route to the one controller', async ({ page }) => {
  for (const [name, tool] of [
    ['自由笔', 'freehand'],
    ['直线', 'line'],
    ['矩形', 'rect'],
    ['椭圆', 'ellipse'],
    ['多边形', 'polygon'],
    ['贝塞尔', 'bezier'],
    ['文字', 'text'],
    ['图片', 'image'],
    ['选择', 'selection'],
    ['套索', 'lasso'],
    ['橡皮擦', 'eraser'],
    ['平移', 'pan'],
  ]) {
    const button = page.getByRole('button', { name, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    expect((await layeredState(page)).tools.activeTool).toBe(tool);
  }
  expect((await layeredState(page)).document.objects).toHaveLength(0);
});

test('eraser misses and cancelled sweeps add no history; a fast crossing is reversible', async ({
  page,
}) => {
  await drawLayeredStroke(page);
  const saved = (await layeredState(page)).document.objects;
  await page.getByRole('button', { name: '橡皮擦', exact: true }).click();
  await pointer(page, 'down', { x: 400, y: 400 });
  await pointer(page, 'up', { x: 450, y: 400 });
  expect((await layeredState(page)).document.objects).toEqual(saved);
  await pointer(page, 'down', { x: 160, y: 50 });
  await pointer(page, 'move', { x: 160, y: 200 });
  await pointer(page, 'cancel', { x: 160, y: 200 });
  expect((await layeredState(page)).document.objects).toEqual(saved);
  await pointer(page, 'down', { x: 160, y: 50 });
  await pointer(page, 'move', { x: 160, y: 200 });
  await pointer(page, 'up', { x: 160, y: 200 });
  expect((await layeredState(page)).document.objects).toHaveLength(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await layeredState(page)).document.objects).toEqual(saved);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await layeredState(page)).document.objects).toHaveLength(0);
});
