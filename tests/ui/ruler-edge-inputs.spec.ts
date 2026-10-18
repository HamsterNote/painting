import { expect, test } from '@playwright/test';
import { dispatchLayeredPointer, openLayeredEditor } from './layered-helpers';

test.describe('ruler edge browser contract (migrated to raw schema3)', () => {
  for (const source of ['mouse', 'pen', 'touch'] as const) {
    test(`${source} preserves raw samples and renders the chosen physical edge constraint`, async ({
      page,
    }) => {
      await openLayeredEditor(page, source === 'touch' ? '&touchDraw=1' : '');
      await page.getByLabel('尺子', { exact: true }).check();
      await page.getByLabel('压力模式', { exact: true }).selectOption('constant');
      await page.evaluate(() => {
        window.__layeredEditor!.setNavigation({
          ruler: { visible: true, center: { x: 320, y: 200 }, height: 80, rotationRad: 0 },
        });
      });
      const options = { source };
      await dispatchLayeredPointer(page, 'down', { x: 100, y: 136 }, options);
      await dispatchLayeredPointer(page, 'move', { x: 400, y: 190 }, options);
      await dispatchLayeredPointer(page, 'up', { x: 600, y: 190 }, options);
      await expect(page.locator('[data-object-id]')).toHaveCount(1);
      const object = await page.evaluate(
        () => window.__layeredEditor!.getSnapshot('document').objects[0]
      );
      if (object.kind !== 'freehand') throw new Error('Expected a freehand object');
      expect(object.samples.map(({ x, y }) => ({ x, y }))).toEqual([
        { x: 100, y: 136 },
        { x: 400, y: 190 },
        { x: 600, y: 190 },
      ]);
      expect(object.samples.map((sample) => sample.source)).toEqual([source, source, source]);
      expect(object.rulerSnapshot).toEqual({
        center: { x: 320, y: 200 },
        height: 80,
        rotationRad: 0,
      });
      const bounds = await page.locator('[data-object-id] > path').evaluate((path) => {
        const box = (path as SVGGraphicsElement).getBBox();
        return { bottom: box.y + box.height, width: box.width };
      });
      // The physical upper edge is y=160. Raw end samples at y=190 must not move the ink there.
      expect(bounds.bottom).toBeLessThan(170);
      expect(bounds.width).toBeGreaterThan(200);
      await page.getByRole('button', { name: '撤销', exact: true }).click();
      await expect(page.locator('[data-object-id]')).toHaveCount(0);
      await page.getByRole('button', { name: '重做', exact: true }).click();
      expect(
        await page.evaluate(() => window.__layeredEditor!.getSnapshot('document').objects[0])
      ).toEqual(object);
    });
  }
});
