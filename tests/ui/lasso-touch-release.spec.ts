import { test, expect, type Page } from '@playwright/test';
import { layeredState, openLayeredEditor } from './layered-helpers';

type LifecycleEvent = {
  type: string;
  event?: string;
  pointerType?: string;
  trusted?: boolean;
};
declare global {
  interface Window {
    __lassoLifecycle: LifecycleEvent[];
  }
}

test.describe('browser touch lasso lifecycle', () => {
  test.use({ hasTouch: true, viewport: { width: 1024, height: 900 } });
  test.beforeEach(async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Uses trusted CDP touch input, not synthetic DOM events');
    await page.addInitScript(() => {
      window.__lassoLifecycle = [];
      Object.assign(window, {
        __paintingTestLassoPerf: (event: LifecycleEvent) =>
          window.__lassoLifecycle.push({ ...event, type: 'query' }),
      });
      for (const type of [
        'pointerdown',
        'pointerup',
        'pointercancel',
        'lostpointercapture',
        'touchend',
        'touchcancel',
      ])
        window.addEventListener(
          type,
          (event) => {
            window.__lassoLifecycle.push({
              type,
              pointerType: (event as PointerEvent).pointerType,
              trusted: event.isTrusted,
            });
          },
          true
        );
    });
    await openLayeredEditor(page, '&fixture=lasso&lassoCount=500&touchDraw=1');
    await page.getByRole('button', { name: '套索', exact: true }).tap();
    await page.evaluate(() => {
      window.__lassoLifecycle = [];
    });
  });
  test.afterEach(async ({ page }, info) => {
    if (!page.isClosed())
      await info.attach('lasso-lifecycle.json', {
        body: JSON.stringify(await page.evaluate(() => window.__lassoLifecycle ?? []), null, 2),
        contentType: 'application/json',
      });
  });

  async function trajectory(page: Page) {
    const rect = (await page.getByTestId('layered-surface').boundingBox())!;
    const v = await page.evaluate(() => window.__layeredEditor!.getSnapshot('viewport').viewport);
    return Array.from({ length: 40 }, (_, i) => ({
      x: rect.x + (220 + 180 * Math.cos((i * Math.PI * 2) / 39)) * v.scale + v.tx,
      y: rect.y + (200 + 120 * Math.sin((i * Math.PI * 2) / 39)) * v.scale + v.ty,
    }));
  }
  async function count(page: Page, event: string) {
    return page.evaluate(
      (name) => window.__lassoLifecycle.filter((e) => e.event === name).length,
      event
    );
  }

  for (const input of ['mouse', 'touch'] as const) {
    test(`${input} release computes once and commits the selection after capture is released`, async ({
      page,
    }) => {
      const before = await layeredState(page);
      const points = await trajectory(page);
      const cdp = await page.context().newCDPSession(page);
      if (input === 'mouse') {
        await page.mouse.move(points[0].x, points[0].y);
        await page.mouse.down();
        for (const p of points.slice(1)) await page.mouse.move(p.x, p.y);
      } else {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ ...points[0], id: 1 }],
        });
        for (const p of points.slice(1))
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ ...p, id: 1 }],
          });
      }
      expect(await count(page, 'query-start')).toBe(0);
      expect((await layeredState(page)).selection).toEqual(before.selection);
      if (input === 'mouse') await page.mouse.up();
      else await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(async () => (await layeredState(page)).selection.length).toBe(115);
      await expect(page.getByLabel('缩放选区')).toBeVisible();
      for (const name of ['query-start', 'query-complete', 'selection-submit'])
        expect(await count(page, name)).toBe(1);
      expect(await count(page, 'cancel')).toBe(0);
      const events = await page.evaluate(() => window.__lassoLifecycle);
      expect(
        events.some((e) => e.type === 'pointerup' && e.pointerType === input && e.trusted)
      ).toBe(true);
      if (input === 'touch')
        expect(events.some((e) => e.type === 'touchend' && e.trusted)).toBe(true);
      const after = await layeredState(page);
      expect(after.document).toEqual(before.document);
      expect(after.history).toEqual(before.history);
    });
  }

  for (const interruption of ['cancel', 'pinch', 'tool'] as const) {
    test(`touch ${interruption} cancels selection, preserves the document and permits the next gesture`, async ({
      page,
    }) => {
      await page.evaluate(() => window.__layeredEditor!.setSelection(['ink-0']));
      const before = await layeredState(page);
      const points = await trajectory(page);
      const cdp = await page.context().newCDPSession(page);
      const send = (
        type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
        touchPoints: { x: number; y: number; id: number }[]
      ) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
      await send('touchStart', [{ ...points[0], id: 1 }]);
      for (const p of points.slice(1)) await send('touchMove', [{ ...p, id: 1 }]);
      await expect(page.locator('[data-testid="layered-display"] polyline')).toBeVisible();
      if (interruption === 'cancel') await send('touchCancel', []);
      else if (interruption === 'tool') {
        await page.getByRole('button', { name: '移动', exact: true }).click();
        await send('touchEnd', []);
      } else {
        const last = points.at(-1)!;
        await send('touchStart', [
          { ...last, id: 1 },
          { x: last.x + 120, y: last.y + 60, id: 2 },
        ]);
        await send('touchMove', [
          { ...last, id: 1 },
          { x: last.x + 180, y: last.y + 100, id: 2 },
        ]);
        await send('touchEnd', []);
        expect((await layeredState(page)).viewport.viewport.scale).toBeGreaterThan(
          before.viewport.viewport.scale
        );
      }
      await expect.poll(async () => (await layeredState(page)).preview.path.length).toBe(0);
      expect(await count(page, 'query-start')).toBe(0);
      const after = await layeredState(page);
      expect(after.selection).toEqual(['ink-0']);
      expect(after.document).toEqual(before.document);
      expect(after.history).toEqual(before.history);
      await page.getByRole('button', { name: '套索', exact: true }).tap();
      const next = await trajectory(page);
      await send('touchStart', [{ ...next[0], id: 3 }]);
      for (const p of next.slice(1)) await send('touchMove', [{ ...p, id: 3 }]);
      await send('touchEnd', []);
      await expect.poll(async () => (await layeredState(page)).selection.length).toBe(115);
      expect(await count(page, 'selection-submit')).toBe(1);
    });
  }
});
