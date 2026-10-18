import { devices, expect, test } from '@playwright/test';
import { layeredState, openLayeredEditor } from './layered-helpers';

// This file belongs to the Chromium project: CDP sends browser input, not DOM dispatchEvent.
test.use({ ...devices['iPad (gen 7)'] });

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
