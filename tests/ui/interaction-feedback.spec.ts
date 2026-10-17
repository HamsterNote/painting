import { expect, test } from '@playwright/test';
import {
  dispatchLayeredPointer as pointer,
  layeredState,
  openLayeredEditor,
} from './layered-helpers';

test('wheel feedback shows actual zoom above the pointer, clears, and never writes history', async ({
  page,
}) => {
  await openLayeredEditor(page);
  const surface = page.getByTestId('layered-surface');
  const box = (await surface.boundingBox())!;
  await surface.dispatchEvent('wheel', {
    clientX: box.x + 200,
    clientY: box.y + 200,
    deltaY: -240,
    ctrlKey: true,
  });
  const feedback = page.getByTestId('drawing-zoom-feedback');
  const state = await layeredState(page);
  await expect(feedback).toHaveText(Math.round(state.viewport.viewport.scale * 100) + '%');
  expect((await feedback.boundingBox())!.y).toBeLessThan(box.y + 200);
  expect(state.history.canUndo).toBe(false);
  await expect(feedback).toHaveCount(0);
});

test('touch zoom feedback follows the live midpoint inside the host', async ({ page }) => {
  await openLayeredEditor(page);
  await pointer(page, 'down', { x: 80, y: 150 }, { source: 'touch', id: 1 });
  await pointer(page, 'down', { x: 200, y: 150 }, { source: 'touch', id: 2 });
  await pointer(page, 'move', { x: 320, y: 150 }, { source: 'touch', id: 2 });
  const feedback = page.getByTestId('drawing-zoom-feedback');
  await expect(feedback).toHaveText('200%');
  const host = (await page.getByTestId('layered-surface').boundingBox())!;
  const bounds = (await feedback.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(host.x);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(host.x + host.width);
  expect(bounds.y + bounds.height).toBeLessThan(host.y + 150);
  await pointer(page, 'up', { x: 320, y: 150 }, { source: 'touch', id: 2 });
  await pointer(page, 'up', { x: 80, y: 150 }, { source: 'touch', id: 1 });
  await expect(feedback).toHaveCount(0);
  expect((await layeredState(page)).history.canUndo).toBe(false);
});

test('text permits native selection and replacement while the drawing host owns gestures', async ({
  page,
}) => {
  await openLayeredEditor(page);
  await page.getByRole('button', { name: '文字', exact: true }).click();
  await pointer(page, 'down', { x: 100, y: 100 });
  const input = page.getByLabel('文字内容');
  await input.fill('original 中文');
  await input.selectText();
  await input.press('Backspace');
  await input.pressSequentially('replacement');
  await expect(input).toHaveValue('replacement');
  await input.press('Control+Enter');
  expect((await layeredState(page)).document.objects[0]).toMatchObject({
    kind: 'text',
    content: 'replacement',
  });
});
