import { expect, test } from '@playwright/test';
import { decodeRgbaPng } from './canvas2d-pen-pixel-helpers';
import {
  dispatchLayeredPointer as pointer,
  layeredState,
  openLayeredEditor,
} from './layered-helpers';

for (const dpr of [1, 2]) {
  test.describe('layered Canvas/SVG at DPR ' + dpr, () => {
    test.use({ deviceScaleFactor: dpr });
    test('long accepted input keeps history inert and final pixels survive handoff; cancellation is empty', async ({
      page,
    }, testInfo) => {
      await openLayeredEditor(page, '&handoffDelay=300');
      await page.getByLabel('压力模式', { exact: true }).selectOption('constant');
      const baseline = await page.evaluate(() => ({ ...window.__layeredRenders! }));
      await pointer(page, 'down', { x: 100, y: 120 });
      const measurement = await page.getByTestId('layered-surface').evaluate(async (host) => {
        const box = host.getBoundingClientRect();
        const frameTimes: number[] = [];
        for (let batch = 0; batch < 10; batch++) {
          const started = performance.now();
          for (let point = 0; point < 100; point++) {
            host.dispatchEvent(
              new PointerEvent('pointermove', {
                bubbles: true,
                pointerId: 41,
                pointerType: 'pen',
                button: 0,
                buttons: 1,
                pressure: 0.5,
                clientX: box.x + 100 + (batch * 100 + point) / 5,
                clientY: box.y + 120,
              })
            );
          }
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          frameTimes.push(performance.now() - started);
        }
        return { samples: 1000, frameTimes, dpr: devicePixelRatio, userAgent: navigator.userAgent };
      });
      expect(await page.evaluate(() => window.__layeredRenders)).toEqual(baseline);
      expect(measurement.dpr).toBe(dpr);
      await pointer(page, 'up', { x: 300, y: 120 }, { pressure: 0 });
      const objects = (await layeredState(page)).document.objects;
      expect(objects).toHaveLength(1);
      if (objects[0].kind !== 'freehand') throw new Error('Expected freehand');
      expect(objects[0].samples).toHaveLength(1002);
      await expect(page.locator('[data-object-id]')).toHaveCSS('visibility', 'visible');
      const screenshot = await page.getByTestId('layered-surface').screenshot();
      const png = await decodeRgbaPng(screenshot);
      const offset = (120 * dpr * png.width + 200 * dpr) * 4;
      expect(Array.from(png.pixels.slice(offset, offset + 3))).toEqual([20, 125, 100]);
      await testInfo.attach('long-input-pixels', { body: screenshot, contentType: 'image/png' });
      await testInfo.attach('host-frame-observations-not-device-budget', {
        body: Buffer.from(JSON.stringify(measurement, null, 2)),
        contentType: 'application/json',
      });
      await pointer(page, 'down', { x: 100, y: 220 });
      await pointer(page, 'move', { x: 300, y: 220 });
      await pointer(page, 'cancel', { x: 300, y: 220 });
      expect((await layeredState(page)).document.objects).toEqual(objects);
      await page.getByRole('button', { name: '撤销', exact: true }).click();
      expect((await layeredState(page)).document.objects).toHaveLength(0);
      await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
    });
  });
}
