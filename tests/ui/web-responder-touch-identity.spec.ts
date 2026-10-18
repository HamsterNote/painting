import { devices, expect, test, type Page } from '@playwright/test';
import { layeredState } from './layered-helpers';

type Contact = { id: number; x: number; y: number };
type Evidence = {
  logs: { level: string; args: string[]; stack?: string }[];
  events: {
    type: string;
    trusted: boolean;
    ids?: number[];
    changed?: number[];
    pointerId?: number;
  }[];
};

declare global {
  interface Window {
    __ham50: Evidence;
  }
}

test.use({ ...devices['iPad (gen 7)'] });

test.afterEach(async ({ page }, info) => {
  const evidence = await page.evaluate(() => window.__ham50);
  await info.attach('session-evidence', {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });
  await info.attach('session-screen', { body: await page.screenshot(), contentType: 'image/png' });
  expect(
    evidence.logs.filter((log) =>
      /Cannot find single active touch|Cannot record touch/.test(log.args.join(' '))
    )
  ).toEqual([]);
});

async function open(page: Page, diagnostics: boolean, mode: string, query = '') {
  await page.addInitScript(() => {
    window.__ham50 = { logs: [], events: [] };
    for (const level of ['warn', 'error'] as const) {
      const original = console[level];
      console[level] = function (...args) {
        window.__ham50.logs.push({ level, args: args.map(String), stack: new Error().stack });
        return original.apply(this, args);
      };
    }
    for (const type of [
      'touchstart',
      'touchmove',
      'touchend',
      'touchcancel',
      'pointerdown',
      'pointerup',
    ]) {
      window.addEventListener(
        type,
        (event) => {
          const touch = event as TouchEvent;
          window.__ham50.events.push({
            type,
            trusted: event.isTrusted,
            ids: touch.touches && Array.from(touch.touches, (t) => t.identifier),
            changed: touch.changedTouches && Array.from(touch.changedTouches, (t) => t.identifier),
            pointerId: (event as PointerEvent).pointerId,
          });
        },
        true
      );
    }
  });
  await page.goto(`/layered-editor${diagnostics ? '?diagnostics=1&traceGestures=1' : '?'}${query}`);
  const surface = page.getByTestId('layered-surface');
  await expect(surface).toHaveAttribute('data-input-arbiter', 'ready');
  await page.getByLabel('输入模式').selectOption(mode);
  const box = (await surface.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  let activePoints: Contact[] = [];
  const send = async (
    type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
    points: Contact[]
  ) => {
    // Chromium accepts selected *ending* contacts on touchEnd. Verify the
    // resulting DOM touches below, including which original finger survives.
    const changed =
      type === 'touchEnd' && points.length
        ? activePoints.filter((active) => !points.some((point) => point.id === active.id))
        : points;
    await cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: changed.map((p) => ({ ...p, x: box.x + p.x, y: box.y + p.y })),
    });
    activePoints = points;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    if (type === 'touchEnd') {
      const active = await page.evaluate(
        () => window.__ham50.events.filter((e) => e.type === 'touchend').at(-1)?.ids
      );
      expect(active?.slice().sort((a, b) => a - b)).toEqual(
        points.map((p) => p.id).sort((a, b) => a - b)
      );
    }
  };
  return { send, cdp, box };
}

async function visibleState(page: Page) {
  return page.evaluate(() => ({
    viewport: document
      .querySelector('[data-testid="layered-display"] > g')
      ?.getAttribute('transform'),
    objects: document.querySelectorAll('[data-testid="layered-display"] [data-object-id]').length,
    undo: !(document.querySelector('[aria-label="撤销"]') as HTMLButtonElement).disabled,
    redo: !(document.querySelector('[aria-label="重做"]') as HTMLButtonElement).disabled,
  }));
}

for (const mode of ['auto', 'finger', 'pen']) {
  for (const diagnostics of [false, true]) {
    for (const ids of [
      [1, 2],
      [1, 21],
      [21, 41],
      [-1, -2],
    ]) {
      test(`identity regression: ${mode} diagnostics=${diagnostics} ids=${ids}`, async ({
        page,
      }) => {
        const { send } = await open(page, diagnostics, mode);
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const initial = await visibleState(page);
        expect(initial.viewport).toBeTruthy();
        for (const reverse of [false, true]) {
          for (const staggered of [false, true]) {
            const a = { id: ids[0], x: 100, y: 100 };
            const b = { id: ids[1], x: 260, y: 110 };
            if (staggered) {
              await send('touchStart', [a]);
              await send('touchMove', [{ ...a, x: 140 }]);
            }
            await send('touchStart', [a, b]);
            const expanded = [a, { ...b, x: 360 }];
            await send('touchMove', expanded);
            const paired = await visibleState(page);
            expect(paired.viewport).not.toEqual(initial.viewport);
            expect(paired).toMatchObject({ objects: 0, undo: false, redo: false });
            if (diagnostics) {
              const state = await layeredState(page);
              expect(state.preview).toEqual({ objects: [], hiddenIds: [], path: [] });
              expect(state.viewport.viewport.scale).toBeGreaterThan(1);
            }
            const survivor = expanded[reverse ? 0 : 1];
            await send('touchEnd', [survivor]);
            await send('touchMove', [{ ...survivor, x: survivor.x + 40 }]);
            expect(await visibleState(page)).toEqual(paired);
            await send('touchEnd', []);
          }
        }
        // Third contact never replaces the original pair; cancellation drains the session.
        const a = { id: ids[0], x: 100, y: 160 };
        const b = { id: ids[1], x: 260, y: 160 };
        const c = { id: 1000001, x: 420, y: 180 };
        await send('touchStart', [a, b]);
        await send('touchStart', [a, b, c]);
        const beforeThird = await visibleState(page);
        await send('touchEnd', [a, c]);
        await send('touchMove', [a, { ...c, x: 500 }]);
        expect(await visibleState(page)).toEqual(beforeThird);
        await send('touchCancel', []);
        // Fresh single input still works, with one history transaction or a pan in pen mode.
        const beforeFresh = await visibleState(page);
        await send('touchStart', [a]);
        await send('touchMove', [{ ...a, x: 180 }]);
        await send('touchMove', [{ ...a, x: 240 }]);
        await send('touchEnd', []);
        await expect
          .poll(async () => (await visibleState(page)).objects)
          .toBe(mode === 'pen' ? 0 : 1);
        if (mode === 'pen') {
          expect((await visibleState(page)).viewport).not.toEqual(beforeFresh.viewport);
          expect((await visibleState(page)).undo).toBe(false);
        } else {
          expect((await visibleState(page)).viewport).toEqual(beforeFresh.viewport);
          await page.getByRole('button', { name: '撤销', exact: true }).click();
          expect(await visibleState(page)).toMatchObject({ objects: 0, undo: false, redo: true });
          await page.getByRole('button', { name: '重做', exact: true }).click();
          expect(await visibleState(page)).toMatchObject({ objects: 1, undo: true, redo: false });
        }
        const evidence = await page.evaluate(() => window.__ham50);
        const touchEvents = evidence.events.filter((e) => e.type.startsWith('touch'));
        expect(touchEvents.length).toBeGreaterThan(20);
        expect(touchEvents.every((e) => e.trusted)).toBe(true);
        expect(touchEvents.some((e) => e.ids?.includes(ids[0]) && e.ids?.includes(ids[1]))).toBe(
          true
        );
        expect(errors).toEqual([]);
      });
    }
  }
}

for (const mode of ['auto', 'finger']) {
  for (const tool of ['矩形', '套索', '橡皮擦', '选择', '贝塞尔', '多边形']) {
    test(`identity preview: ${mode} ${tool} cancels without history`, async ({ page }) => {
      const { send } = await open(page, true, mode, '&fixture=mixed');
      await page.getByRole('button', { name: tool, exact: true }).click();
      const before = await layeredState(page);
      const a = { id: -1, x: 100, y: 160 };
      const b = { id: -2, x: 320, y: 200 };
      await send('touchStart', [a]);
      await send('touchMove', [{ ...a, x: 220, y: 200 }]);
      const preview = (await layeredState(page)).preview;
      expect(
        preview.objects.length + preview.path.length + preview.hiddenIds.length
      ).toBeGreaterThan(0);
      await send('touchStart', [{ ...a, x: 220, y: 200 }, b]);
      expect((await layeredState(page)).preview).toEqual({ objects: [], hiddenIds: [], path: [] });
      await send('touchMove', [a, { ...b, x: 440 }]);
      await send('touchEnd', [a]);
      await send('touchEnd', []);
      const after = await layeredState(page);
      expect(after.document).toEqual(before.document);
      expect(after.history).toEqual(before.history);
      expect(after.viewport).not.toEqual(before.viewport);
    });
  }
}

for (const mode of ['auto', 'finger', 'pen']) {
  test(`identity writing: ${mode} pen freezes colliding touches until drained`, async ({
    page,
  }) => {
    const { send, cdp, box } = await open(page, true, mode);
    const pen = async (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', x: number) => {
      await cdp.send('Input.dispatchMouseEvent', {
        type,
        x: box.x + x,
        y: box.y + 240,
        button: 'left',
        buttons: type === 'mouseReleased' ? 0 : 1,
        pointerType: 'pen',
        force: type === 'mouseReleased' ? 0 : 0.6,
      });
    };
    const before = await layeredState(page);
    await pen('mousePressed', 100);
    await pen('mouseMoved', 180);
    const a = { id: 1, x: 100, y: 100 };
    const b = { id: 21, x: 260, y: 100 };
    await send('touchStart', [a, b]);
    await send('touchMove', [a, { ...b, x: 360 }]);
    await pen('mouseReleased', 240);
    await send('touchMove', [a, { ...b, x: 400 }]);
    await send('touchEnd', [a]);
    await send('touchMove', [{ ...a, x: 180 }]);
    await send('touchEnd', []);
    const after = await layeredState(page);
    expect(after.document.objects).toHaveLength(1);
    expect(after.document.objects[0]).toMatchObject({ kind: 'freehand' });
    expect(after.input.penSeen).toBe(true);
    expect(after.viewport).toEqual(before.viewport);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect((await layeredState(page)).document.objects).toHaveLength(0);
    expect((await layeredState(page)).history.canUndo).toBe(false);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    expect((await layeredState(page)).document.objects).toEqual(after.document.objects);
    await send('touchStart', [a, b]);
    await send('touchMove', [a, { ...b, x: 360 }]);
    await send('touchEnd', []);
    expect((await layeredState(page)).viewport).not.toEqual(after.viewport);
  });

  test(`identity ownership: ${mode} control down stays excluded after moving onto paper`, async ({
    page,
  }) => {
    const { send } = await open(page, true, mode);
    await page.getByTestId('layered-surface').evaluate((host) => {
      const button = document.createElement('button');
      button.style.cssText =
        'position:absolute;left:400px;top:200px;width:80px;height:40px;z-index:100';
      button.textContent = 'test control';
      host.append(button);
    });
    const control = { id: -1, x: 430, y: 220 };
    const paper = { id: -2, x: 100, y: 100 };
    await send('touchStart', [control]);
    await send('touchMove', [{ ...control, x: 320 }]);
    const movedControl = { ...control, x: 320 };
    const before = await layeredState(page);
    await send('touchStart', [movedControl, paper]);
    await send('touchMove', [movedControl, { ...paper, x: 180 }]);
    const during = await layeredState(page);
    if (mode === 'pen') expect(during.viewport).not.toEqual(before.viewport);
    else expect(during.viewport).toEqual(before.viewport);
    await send('touchEnd', [movedControl]);
    await send('touchMove', [{ ...movedControl, x: 250 }]);
    expect((await layeredState(page)).viewport).toEqual(during.viewport);
    await send('touchEnd', []);
    expect((await layeredState(page)).document.objects).toHaveLength(mode === 'pen' ? 0 : 1);
  });
}

test('identity endurance: 50 trusted sessions recover after end and cancel', async ({ page }) => {
  const { send } = await open(page, true, 'finger');
  const before = await layeredState(page);
  for (let round = 0; round < 50; round++) {
    const a = { id: round * 20 + 1, x: 100, y: 160 };
    const b = { id: round * 20 + 21, x: 260, y: 160 };
    await send('touchStart', [a]);
    await send('touchMove', [{ ...a, x: 140 }]);
    await send('touchStart', [a, b]);
    await send('touchMove', [a, { ...b, x: 360 }]);
    await send('touchEnd', [round % 2 ? a : { ...b, x: 360 }]);
    const viewport = (await layeredState(page)).viewport;
    expect(viewport.viewport.scale).toBeGreaterThan(1);
    await send(round % 2 ? 'touchEnd' : 'touchCancel', []);
    const after = await layeredState(page);
    expect(after.document).toEqual(before.document);
    expect(after.history).toEqual(before.history);
    expect(after.preview).toEqual({ objects: [], hiddenIds: [], path: [] });
    expect(after.viewport).toEqual(viewport);
    // Prevent saturation of zoom from concealing subsequent pair navigation.
    await page.evaluate(() => {
      const editor = window.__layeredEditor!;
      editor.updateViewport({
        type: 'replace',
        expectedRevision: editor.getSnapshot('viewport').revision,
        viewport: { scale: 1, tx: 0, ty: 0 },
      });
    });
  }
  const events = await page.evaluate(() => window.__ham50.events);
  expect(events.filter((event) => event.type === 'touchstart').length).toBe(100);
  expect(events.every((event) => event.trusted)).toBe(true);
});

test('unrelated console errors still reach Expo development LogBox', async ({ page }) => {
  await open(page, false, 'auto');
  const marker = 'HAM50 unrelated error';
  await page.evaluate((message) => console.error(message), marker);
  await expect(page.getByText(marker, { exact: false }).first()).toBeVisible();
  expect(
    (await page.evaluate(() => window.__ham50.logs)).some((log) => log.args.includes(marker))
  ).toBe(true);
});
