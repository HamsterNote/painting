import { devices, expect, test } from '@playwright/test';
import { layeredState, openLayeredEditor } from './layered-helpers';
import type { Locator } from '@playwright/test';

// This file belongs to the Chromium project: CDP sends browser input, not DOM dispatchEvent.
test.use({ ...devices['iPad (gen 7)'] });

for (const source of ['pen', 'touch'] as const) {
  test(`browser ${source}: toolbar first actions after a short pen stroke preserve controls`, async ({
    page,
  }) => {
    await openLayeredEditor(page);
    const cdp = await page.context().newCDPSession(page);
    const tap = async (control: Locator, fraction = 0.5) => {
      const bounds = (await control.boundingBox())!;
      const x = bounds.x + bounds.width * fraction;
      const y = bounds.y + bounds.height / 2;
      if (source === 'touch') {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x, y, id: 1 }],
        });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        for (const type of ['mousePressed', 'mouseReleased'] as const) {
          await cdp.send('Input.dispatchMouseEvent', {
            type,
            x,
            y,
            pointerType: 'pen',
            button: 'left',
            buttons: type === 'mousePressed' ? 1 : 0,
            clickCount: 1,
          });
        }
      }
    };
    const surface = (await page.getByTestId('layered-surface').boundingBox())!;
    for (const type of ['mousePressed', 'mouseReleased'] as const) {
      await cdp.send('Input.dispatchMouseEvent', {
        type,
        x: surface.x + 80,
        y: surface.y + 8,
        pointerType: 'pen',
        button: 'left',
        buttons: type === 'mousePressed' ? 1 : 0,
        clickCount: 1,
      });
    }
    expect((await layeredState(page)).document.objects).toHaveLength(1);
    const target = (await page.getByRole('button', { name: '矩形', exact: true }).boundingBox())!;
    for (const [type, x, y, buttons] of [
      ['mousePressed', surface.x + 80, surface.y + 8, 1],
      ['mouseMoved', target.x + 15, target.y + 15, 1],
      ['mouseReleased', target.x + 15, target.y + 15, 0],
    ] as const) {
      await cdp.send('Input.dispatchMouseEvent', {
        type,
        x,
        y,
        pointerType: 'pen',
        button: 'left',
        buttons,
        clickCount: 1,
      });
    }
    expect((await layeredState(page)).tools.activeTool).toBe('freehand');
    expect((await layeredState(page)).document.objects).toHaveLength(2);
    await tap(page.getByRole('button', { name: '矩形', exact: true }));
    expect((await layeredState(page)).tools.activeTool).toBe('rect');
    await tap(page.getByRole('button', { name: '自由笔', exact: true }));
    const width = page.getByLabel('笔宽', { exact: true });
    await tap(width);
    await expect(width).toBeFocused();
    await width.press('ControlOrMeta+A');
    await width.press('1');
    await width.press('6');
    const opacity = page.getByLabel('不透明度');
    await tap(opacity, 0.75);
    if (source === 'pen') await expect(opacity).toBeFocused();
    const pressure = page.getByLabel('压力模式');
    await tap(pressure);
    await page.keyboard.press('Escape');
    await expect(pressure).toBeFocused();
    await pressure.selectOption('constant');
    const mode = page.getByLabel('输入模式');
    await tap(mode);
    await page.keyboard.press('Escape');
    await expect(mode).toBeFocused();
    await mode.selectOption('pen');
    const changed = await layeredState(page);
    expect(changed.tools.settings.freehand.nominalSize).toBe(16);
    expect(changed.tools.settings.freehand.opacity).toBeGreaterThan(0.5);
    expect(changed.tools.settings.freehand.pressureMode).toBe('constant');
    expect(changed.input.mode).toBe('pen');
    expect(changed.document.objects).toHaveLength(2);
    await tap(page.getByRole('button', { name: '撤销', exact: true }));
    expect((await layeredState(page)).document.objects).toHaveLength(1);
    await tap(page.getByRole('button', { name: '重做', exact: true }));
    expect((await layeredState(page)).document.objects).toEqual(changed.document.objects);
  });
}

for (const mode of ['auto', 'finger', 'pen']) {
  test(`browser input: ${mode} touch, pen, latch and two-finger navigation`, async ({
    page,
  }, info) => {
    await openLayeredEditor(page, '&traceGestures=1');
    const surface = page.getByTestId('layered-surface');
    await expect(surface).toHaveAttribute('data-input-ready', 'true');
    await expect(surface).toHaveAttribute('data-input-arbiter', 'ready');
    await expect(surface).toHaveCSS('pointer-events', 'auto');
    await page.getByLabel('输入模式').selectOption(mode);
    const box = (await surface.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const touchStroke = async (id: number) => {
      for (const [type, x] of [
        ['touchStart', 100],
        ['touchMove', 150],
        ['touchMove', 240],
      ] as const) {
        await cdp.send('Input.dispatchTouchEvent', {
          type,
          touchPoints: [{ x: box.x + x, y: box.y + 120, id }],
        });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const initial = await layeredState(page);
    await touchStroke(1);
    const touched = await layeredState(page);
    expect(touched.document.objects).toHaveLength(mode === 'pen' ? 0 : 1);
    if (mode === 'pen') expect(touched.viewport).not.toEqual(initial.viewport);
    else expect(touched.viewport).toEqual(initial.viewport);
    for (const [type, x, buttons] of [
      ['mousePressed', 100, 1],
      ['mouseMoved', 160, 1],
      ['mouseMoved', 220, 1],
      ['mouseReleased', 250, 0],
    ] as const) {
      await cdp.send('Input.dispatchMouseEvent', {
        type,
        x: box.x + x,
        y: box.y + 200,
        button: 'left',
        buttons,
        pointerType: 'pen',
        force: buttons ? 0.6 : 0,
      });
    }
    const penned = await layeredState(page);
    expect(penned.document.objects).toHaveLength(touched.document.objects.length + 1);
    expect(penned.input.penSeen).toBe(true);
    expect(penned.viewport).toEqual(touched.viewport);
    await touchStroke(2);
    const afterPen = await layeredState(page);
    expect(afterPen.document.objects).toHaveLength(
      penned.document.objects.length + (mode === 'finger' ? 1 : 0)
    );
    if (mode === 'finger') expect(afterPen.viewport).toEqual(penned.viewport);
    else expect(afterPen.viewport).not.toEqual(penned.viewport);
    const contacts = [
      { x: box.x + 120, y: box.y + 280, id: 3 },
      { x: box.x + 250, y: box.y + 280, id: 4 },
    ];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: contacts });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [contacts[0], { ...contacts[1], x: box.x + 370 }],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const paired = await layeredState(page);
    expect(paired.viewport.viewport.scale).toBeGreaterThan(afterPen.viewport.viewport.scale);
    expect(paired.document).toEqual(afterPen.document);
    const trace = await page.evaluate(() => window.__layeredGestureTrace!.snapshot());
    for (const source of ['touch', 'pen']) {
      expect(trace.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ scope: 'event', action: 'pointerdown', source, trusted: true }),
          expect.objectContaining({ scope: 'event', action: 'pointermove', source, trusted: true }),
          expect.objectContaining({ scope: 'event', action: 'pointerup', source, trusted: true }),
        ])
      );
    }
    expect(trace.entries.some((e) => e.scope === 'event' && e.action === 'pointercancel')).toBe(
      false
    );
    await info.attach('browser-input-trace', {
      body: JSON.stringify(trace, null, 2),
      contentType: 'application/json',
    });
  });
}
