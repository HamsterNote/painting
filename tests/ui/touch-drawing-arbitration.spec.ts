import { expect, test } from '@playwright/test';
import {
  dispatchLayeredPointer as pointer,
  drawLayeredStroke,
  layeredState,
  openLayeredEditor,
} from './layered-helpers';

test('default touch navigates with fixed pair, rejected third contact cannot take over', async ({
  page,
}) => {
  await openLayeredEditor(page);
  await pointer(page, 'down', { x: 100, y: 100 }, { source: 'touch', id: 1 });
  await pointer(page, 'down', { x: 200, y: 100 }, { source: 'touch', id: 2 });
  await pointer(page, 'move', { x: 300, y: 100 }, { source: 'touch', id: 2 });
  const paired = await layeredState(page);
  expect(paired.viewport.viewport.scale).toBe(2);
  await pointer(page, 'down', { x: 400, y: 100 }, { source: 'touch', id: 3 });
  await pointer(page, 'up', { x: 300, y: 100 }, { source: 'touch', id: 2 });
  await pointer(page, 'move', { x: 500, y: 100 }, { source: 'touch', id: 3 });
  await pointer(page, 'move', { x: 150, y: 100 }, { source: 'touch', id: 1 });
  expect((await layeredState(page)).viewport).toEqual(paired.viewport);
  await pointer(page, 'up', { x: 500, y: 100 }, { source: 'touch', id: 3 });
  await pointer(page, 'up', { x: 150, y: 100 }, { source: 'touch', id: 1 });
  expect((await layeredState(page)).history.canUndo).toBe(false);
  await drawLayeredStroke(page);
  expect((await layeredState(page)).document.objects).toHaveLength(1);
});

test('touch drawing policy commits a stroke, rejecting late second contact without a viewport jump', async ({
  page,
}) => {
  await openLayeredEditor(page, '&touchDraw=1');
  const before = await layeredState(page);
  await pointer(page, 'down', { x: 100, y: 100 }, { source: 'touch', id: 1 });
  await pointer(page, 'move', { x: 180, y: 100 }, { source: 'touch', id: 1 });
  await pointer(page, 'down', { x: 300, y: 300 }, { source: 'touch', id: 2 });
  await pointer(page, 'move', { x: 400, y: 300 }, { source: 'touch', id: 2 });
  await pointer(page, 'up', { x: 400, y: 300 }, { source: 'touch', id: 2 });
  await pointer(page, 'up', { x: 220, y: 100 }, { source: 'touch', id: 1 });
  const after = await layeredState(page);
  expect(after.viewport).toEqual(before.viewport);
  expect(after.document.objects).toHaveLength(1);
  expect(after.document.objects[0]).toMatchObject({
    kind: 'freehand',
    resolvedPressureMode: 'simulated',
  });
});

test('touch cancellation and page blur recover input without committing partial ink', async ({
  page,
}) => {
  await openLayeredEditor(page, '&touchDraw=1');
  await pointer(page, 'down', { x: 100, y: 100 }, { source: 'touch' });
  await pointer(page, 'move', { x: 200, y: 100 }, { source: 'touch' });
  await pointer(page, 'cancel', { x: 200, y: 100 }, { source: 'touch' });
  expect((await layeredState(page)).history.canUndo).toBe(false);
  await pointer(page, 'down', { x: 100, y: 100 });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await pointer(page, 'up', { x: 200, y: 100 });
  expect((await layeredState(page)).document.objects).toHaveLength(0);
  await drawLayeredStroke(page);
  expect((await layeredState(page)).document.objects).toHaveLength(1);
});
