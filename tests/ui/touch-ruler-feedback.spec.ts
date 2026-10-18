import { expect, test } from '@playwright/test';
import {
  dispatchLayeredPointer as pointer,
  layeredState,
  openLayeredEditor,
} from './layered-helpers';

test('touch ruler feedback projects live midpoint onto ruler and leaves paper history alone', async ({
  page,
}) => {
  await openLayeredEditor(page);
  await page.getByLabel('尺子', { exact: true }).check();
  const initial = await layeredState(page);
  const center = initial.navigation.ruler.center;
  await pointer(page, 'down', { x: center.x - 60, y: center.y }, { source: 'touch', id: 1 });
  await pointer(page, 'down', { x: center.x + 60, y: center.y }, { source: 'touch', id: 2 });
  await pointer(page, 'move', { x: center.x + 30, y: center.y + 80 }, { source: 'touch', id: 2 });
  await expect(page.getByTestId('ruler-angle-feedback')).toBeVisible();
  const state = await layeredState(page);
  const feedback = state.navigation.rotationFeedback!;
  const ruler = state.navigation.ruler;
  expect(ruler.rotationRad).toBeGreaterThan(0.5);
  expect(
    -(feedback.point.x - ruler.center.x) * Math.sin(ruler.rotationRad) +
      (feedback.point.y - ruler.center.y) * Math.cos(ruler.rotationRad)
  ).toBeCloseTo(0);
  expect(state.document).toEqual(initial.document);
  expect(state.viewport).toEqual(initial.viewport);
  expect(state.history.canUndo).toBe(false);
  await pointer(page, 'up', { x: center.x + 30, y: center.y + 80 }, { source: 'touch', id: 2 });
  await pointer(page, 'up', { x: center.x - 60, y: center.y }, { source: 'touch', id: 1 });
  await expect(page.getByTestId('ruler-angle-feedback')).toHaveCount(0);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
});
