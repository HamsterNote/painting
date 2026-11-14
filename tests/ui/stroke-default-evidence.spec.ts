import { expect, test } from '@playwright/test';
import {
  openLayeredEditor,
  layeredState,
  drawLayeredStroke,
  selectToolbarTool,
  dispatchLayeredPointer,
} from './layered-helpers';

test('S1 actual new editor entry and first object snapshots', async ({ page }, info) => {
  await openLayeredEditor(page);
  const initial = await layeredState(page);
  expect(initial.tools.settings.freehand.color).toBe('#2D2D2D');
  expect(initial.tools.settings.shape.color).toBe('#2D2D2D');
  await drawLayeredStroke(page);
  await selectToolbarTool(page, '矩形');
  await dispatchLayeredPointer(page, 'down', { x: 300, y: 200 });
  await dispatchLayeredPointer(page, 'move', { x: 400, y: 300 });
  await dispatchLayeredPointer(page, 'up', { x: 400, y: 300 });
  const state = await layeredState(page);
  expect(state.document.objects).toHaveLength(2);
  expect(state.document.objects[0]).toMatchObject({
    kind: 'freehand',
    brushSnapshot: { color: '#2D2D2D' },
  });
  expect(state.document.objects[1]).toMatchObject({ kind: 'shape', style: { color: '#2D2D2D' } });
  await info.attach('S1-entry-first-objects.json', {
    body: JSON.stringify(
      { entry: page.url(), initial: initial.tools, objects: state.document.objects },
      null,
      2
    ),
    contentType: 'application/json',
  });
});
