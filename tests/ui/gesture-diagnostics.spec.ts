import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, query = '') {
  await page.goto(`/layered-editor?diagnostics=1&traceGestures=1${query}`);
  await expect(page.getByTestId('layered-drawing')).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__layeredGestureTrace));
  return (await page.getByTestId('layered-surface').boundingBox())!;
}

test('capture release preserves the owner through outside move/up, even when the target stops bubbling', async ({
  page,
}, info) => {
  const box = await open(page);
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 240, box.y + 140);
  await page.evaluate(() => {
    const active = window.__layeredEditor!.getSnapshot('interaction').activeFreehand!;
    if (active.status !== 'collecting') throw new Error('missing owner');
    const surface = document.querySelector<HTMLElement>('[data-testid="layered-surface"]')!;
    if (!surface.hasPointerCapture(Number(active.pointerId)))
      throw new Error('capture did not activate');
    surface.releasePointerCapture(Number(active.pointerId));
    // Release outside the surface, over a control that stops bubbling.
    document
      .querySelector('[data-testid="gesture-trace-panel"]')!
      .addEventListener('pointermove', (event) => event.stopPropagation());
    document
      .querySelector('[data-testid="gesture-trace-panel"]')!
      .addEventListener('pointerup', (event) => event.stopPropagation());
  });
  const panel = (await page.getByTestId('gesture-trace-panel').boundingBox())!;
  await page.mouse.move(panel.x + 200, panel.y + 8);
  await page.mouse.up();
  const trace = await page.evaluate(() => window.__layeredGestureTrace!.snapshot());
  await info.attach('capture-release-trace', {
    body: JSON.stringify(trace, null, 2),
    contentType: 'application/json',
  });
  expect(
    trace.entries.some((entry) => entry.action === 'lostpointercapture' && entry.trusted)
  ).toBe(true);
  expect(trace.state.objectCount).toBe(1);
  expect(trace.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        scope: 'freehand',
        action: 'pointerup',
        ownerPointerId: trace.entries.find(
          (entry) => entry.scope === 'event' && entry.action === 'pointerdown'
        )!.pointerId,
        operating: false,
        destroyed: false,
        destroyRequested: false,
        pendingCount: 0,
        sampleCount: 3,
        lastSample: expect.objectContaining({ phase: 'move' }),
      }),
    ])
  );
  expect(
    trace.entries.some(
      (entry) => entry.scope === 'freehand' && entry.action === 'commit' && entry.ok
    )
  ).toBe(true);
  const samples = await page.evaluate(() => {
    const object = window.__layeredEditor!.getSnapshot('document').objects[0];
    if (object.kind !== 'freehand') throw new Error('missing ink');
    return object.samples;
  });
  expect(samples.map((sample) => sample.phase)).toEqual(['down', 'move', 'move', 'up']);
  await expect(page.getByTestId('layered-display').locator('[data-object-id]')).toHaveCSS(
    'visibility',
    'visible'
  );
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(
    await page.evaluate(() => window.__layeredEditor!.getSnapshot('document').objects.length)
  ).toBe(0);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(
    await page.evaluate(() => window.__layeredEditor!.getSnapshot('document').objects.length)
  ).toBe(1);
});

test('trace exports bounded ordered records, cancellation reason and coalesced acceptance without contents', async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    const host = document.querySelector('[data-testid="layered-surface"]')!;
    const rect = host.getBoundingClientRect();
    const make = (type: string, x: number, id = 41) =>
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerType: 'pen',
        pointerId: id,
        clientX: rect.x + x,
        clientY: rect.y + 100,
        buttons: type === 'pointerup' ? 0 : 1,
        pressure: type === 'pointerup' ? 0 : 0.5,
      });
    host.dispatchEvent(make('pointerdown', 100));
    for (let i = 0; i < 550; i++) host.dispatchEvent(make('pointermove', 100 + i / 10));
    const coalesced = make('pointermove', 200);
    Object.defineProperty(coalesced, 'getCoalescedEvents', {
      value: () => [make('pointermove', 180), make('pointermove', 200)],
    });
    host.dispatchEvent(coalesced);
    const invalid = make('pointermove', 210);
    Object.defineProperty(invalid, 'getCoalescedEvents', {
      value: () => [make('pointermove', 210, 99)],
    });
    host.dispatchEvent(invalid);
    host.dispatchEvent(make('pointercancel', 200));
    host.dispatchEvent(make('pointerup', 200));
    host.dispatchEvent(make('pointerdown', 110, 42));
    host.dispatchEvent(make('pointerrawupdate', 180, 42));
    host.dispatchEvent(make('pointerup', 210, 42));
  });
  await expect(page.getByTestId('layered-display').locator('[data-object-id]')).toHaveCSS(
    'visibility',
    'visible'
  );
  await page.getByText('手势诊断（记录中）', { exact: true }).click();
  await page.getByRole('button', { name: '查看记录', exact: true }).click();
  const trace = JSON.parse(await page.getByLabel('手势记录', { exact: true }).inputValue());
  expect(trace.entries).toHaveLength(trace.limit);
  expect(trace.dropped).toBeGreaterThan(0);
  expect(trace.entries.at(-1).sequence - trace.entries[0].sequence).toBe(trace.limit - 1);
  expect(trace.state.objectCount).toBe(1);
  expect(trace.counts['freehand:cancel-request:pointercancel']).toBe(1);
  expect(trace.counts['freehand:commit:accepted']).toBe(1);
  expect(trace.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        scope: 'freehand',
        action: 'batch',
        sampleCount: 2,
        ownerPointerId: 41,
      }),
      expect.objectContaining({ scope: 'presentation', action: 'visible' }),
      expect.objectContaining({ scope: 'event', action: 'pointerrawupdate', pointerId: 42 }),
      expect.objectContaining({
        scope: 'freehand',
        action: 'reject',
        reason: 'coalesced-identity-mismatch',
        samplePointerId: 99,
      }),
      expect.objectContaining({
        scope: 'freehand',
        action: 'pointerup',
        pointerId: 42,
        sampleCount: 1,
      }),
    ])
  );
  expect(trace.state).not.toHaveProperty('document');
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
  );
  await page.getByRole('button', { name: '复制记录', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('长按全选');
  expect(
    JSON.parse(await page.getByLabel('手势记录', { exact: true }).inputValue()).state.objectCount
  ).toBe(1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载记录', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('painting-gesture-trace.json');
});

for (const touchAction of ['none', 'auto']) {
  test(`browser touch pan arbitration with touch-action ${touchAction}`, async ({
    browser,
    browserName,
  }, info) => {
    test.skip(
      browserName !== 'chromium',
      'CDP touch injection is Chromium-only; not hardware evidence.'
    );
    const context = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    try {
      const box = await open(page, '&touchDraw=1');
      await page.evaluate((action) => {
        document.querySelector<HTMLElement>('[data-testid="layered-surface"]')!.style.touchAction =
          action;
        document.body.style.minHeight = '2000px';
      }, touchAction);
      const cdp = await context.newCDPSession(page);
      const x = box.x + 180;
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y: box.y + 250, id: 7 }],
      });
      for (const y of [220, 160, 100])
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x, y: box.y + y, id: 7 }],
        });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const trace = await page.evaluate(() => window.__layeredGestureTrace!.snapshot());
      await info.attach(`touch-${touchAction}-trace`, {
        body: JSON.stringify(trace, null, 2),
        contentType: 'application/json',
      });
      expect(
        trace.entries.some(
          (entry) => entry.scope === 'event' && entry.trusted && entry.source === 'touch'
        )
      ).toBe(true);
      expect(trace.state.objectCount).toBe(touchAction === 'none' ? 1 : 0);
      expect(
        trace.entries.some((entry) => entry.scope === 'event' && entry.action === 'pointercancel')
      ).toBe(touchAction === 'auto');
    } finally {
      await context.close();
    }
  });
}

test('gesture diagnostics stay absent unless both query flags are enabled', async ({ page }) => {
  await page.goto('/layered-editor?traceGestures=1');
  await expect(page.getByTestId('layered-drawing')).toBeVisible();
  await expect(page.getByTestId('gesture-trace-panel')).toHaveCount(0);
  expect(await page.evaluate(() => window.__layeredGestureTrace)).toBeUndefined();
});
