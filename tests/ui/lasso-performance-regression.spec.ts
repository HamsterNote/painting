import { test, expect } from '@playwright/test';
import { dispatchLayeredPointer, layeredState, openLayeredEditor } from './layered-helpers';

for (const source of ['mouse', 'pen'] as const) {
  test(`lasso ${source} previews without selection or history traversal and selects only on release`, async ({
    page,
  }) => {
    await openLayeredEditor(page, '&fixture=mixed');
    const before = await layeredState(page);
    await page.evaluate(() => window.__layeredEditor!.setTool('lasso'));
    const renders = await page.evaluate(() => ({ ...window.__layeredRenders! }));
    await dispatchLayeredPointer(page, 'down', { x: 10, y: 70 }, { source });
    for (const point of [
      { x: 320, y: 70 },
      { x: 320, y: 300 },
      { x: 10, y: 300 },
    ])
      await dispatchLayeredPointer(page, 'move', point, { source });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
    expect((await layeredState(page)).selection).toEqual(before.selection);
    await expect(page.locator('[data-testid="layered-display"] polyline')).toBeVisible();
    expect(await page.evaluate(() => window.__layeredRenders)).toEqual(renders);
    // The final batch and up share a single JS task, leaving no intervening rAF.
    await page.evaluate((source) => {
      const host = document.querySelector('[data-testid="layered-surface"]')!;
      const rect = host.getBoundingClientRect();
      for (const phase of ['move', 'up'])
        host.dispatchEvent(
          new PointerEvent(`pointer${phase}`, {
            bubbles: true,
            pointerId: 41,
            pointerType: source,
            button: 0,
            buttons: phase === 'up' ? 0 : 1,
            clientX: rect.x + 10,
            clientY: rect.y + 70,
            pressure: 0.5,
          })
        );
    }, source);
    await expect(page.getByLabel('缩放选区')).toBeVisible();
    await expect(page.getByLabel('旋转选区')).toBeVisible();
    const after = await layeredState(page);
    expect(after.selection).toEqual(before.document.objects.map((object) => object.objectId));
    expect(after.document).toEqual(before.document);
    expect(after.history).toEqual(before.history);
    expect(after.preview.path).toEqual([]);
  });
}

for (const reason of ['Escape', 'pointercancel', 'blur'] as const) {
  test(`lasso ${reason} restores selection and ignores queued feedback`, async ({ page }) => {
    await openLayeredEditor(page, '&fixture=mixed');
    await page.evaluate(() => {
      window.__layeredEditor!.setTool('lasso');
      window.__layeredEditor!.setSelection(['lower-ink']);
    });
    await dispatchLayeredPointer(page, 'down', { x: 10, y: 70 });
    for (const point of [
      { x: 320, y: 70 },
      { x: 320, y: 300 },
      { x: 10, y: 300 },
    ])
      await dispatchLayeredPointer(page, 'move', point);
    await expect(page.locator('[data-testid="layered-display"] polyline')).toBeVisible();
    expect((await layeredState(page)).selection).toEqual(['lower-ink']);
    if (reason === 'Escape') await page.keyboard.press('Escape');
    else if (reason === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    else
      await page
        .getByTestId('layered-surface')
        .dispatchEvent(reason, { pointerId: 41, pointerType: 'pen', bubbles: true });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
    const state = await layeredState(page);
    expect(state.selection).toEqual(['lower-ink']);
    expect(state.preview.path).toEqual([]);
    expect(state.history.canUndo).toBe(false);
  });
}

test('lasso capture loss keeps its trajectory until up and commits the complete ordered selection', async ({
  page,
}) => {
  await openLayeredEditor(page, '&fixture=mixed');
  const before = await layeredState(page);
  await page.evaluate(() => window.__layeredEditor!.setTool('lasso'));
  await dispatchLayeredPointer(page, 'down', { x: 10, y: 70 });
  for (const point of [
    { x: 320, y: 70 },
    { x: 320, y: 300 },
    { x: 10, y: 300 },
  ])
    await dispatchLayeredPointer(page, 'move', point);
  const trajectory = page.locator('[data-testid="layered-display"] polyline');
  await expect(trajectory).toBeVisible();
  await page.getByTestId('layered-surface').dispatchEvent('lostpointercapture', {
    pointerId: 41,
    pointerType: 'pen',
    bubbles: true,
  });
  await expect(trajectory).toBeVisible();
  expect((await layeredState(page)).selection).toEqual(before.selection);
  await dispatchLayeredPointer(page, 'up', { x: 10, y: 70 });
  await expect(page.getByLabel('缩放选区')).toBeVisible();
  const after = await layeredState(page);
  expect(after.selection).toEqual(before.document.objects.map((object) => object.objectId));
  expect(after.document).toEqual(before.document);
  expect(after.history).toEqual(before.history);
  expect(after.preview.path).toEqual([]);
});
