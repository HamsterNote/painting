import { expect, test, type Page } from '@playwright/test';
import { decodeRgbaPng } from './canvas2d-pen-pixel-helpers';

test.use({ video: 'on' });

async function openEditor(page: Page, query = '') {
  await page.goto(`/layered-editor?diagnostics=1${query}`);
  await expect(page.getByTestId('layered-drawing')).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__layeredEditor));
}

async function pointer(page: Page, phase: string, x: number, y: number, pressure = 0.5) {
  const box = (await page.getByTestId('layered-surface').boundingBox())!;
  await page.getByTestId('layered-surface').dispatchEvent(`pointer${phase}`, {
    pointerId: 41,
    pointerType: 'pen',
    clientX: box.x + x,
    clientY: box.y + y,
    button: 0,
    buttons: phase === 'up' ? 0 : 1,
    pressure,
  });
}

function pixel(png: Awaited<ReturnType<typeof decodeRgbaPng>>, x: number, y: number) {
  const offset = (y * png.width + x) * 4;
  return Array.from(png.pixels.slice(offset, offset + 3));
}

function expectCompositedPixel(actual: number[], expected: number[]) {
  // Canvas and SVG alpha compositing in WebKit can round a channel one unit apart.
  for (let channel = 0; channel < 3; channel++) {
    expect(Math.abs(actual[channel] - expected[channel])).toBeLessThanOrEqual(1);
  }
}

test.describe('rapid stroke evidence matrix', () => {
  test.describe.configure({ mode: 'parallel' });
  for (const length of [0, 8, 160]) {
    for (const hz of [2, 5, 8]) {
      for (const contactMs of [20, 80]) {
        test(`${length}px ${hz}Hz ${contactMs}ms: 100 independent pen strokes`, async ({
          page,
        }, testInfo) => {
          test.setTimeout(120000);
          await page.setViewportSize({ width: 1500, height: 1100 });
          await openEditor(page, '&traceGestures=1');
          await expect(page.getByTestId('layered-surface')).toHaveAttribute(
            'data-input-arbiter',
            'ready'
          );
          await page.waitForFunction(() => Boolean(window.__layeredGestureTrace));
          const evidence = await page.evaluate(
            async ({ length, hz, contactMs }) => {
              const editor = window.__layeredEditor!;
              editor.setNavigation({ paper: false, minimap: false });
              const surface = document.querySelector<HTMLElement>(
                '[data-testid="layered-surface"]'
              )!;
              const bounds = surface.getBoundingClientRect();
              const waitUntil = async (deadline: number) => {
                while (performance.now() < deadline)
                  await new Promise((resolve) => setTimeout(resolve, deadline - performance.now()));
              };
              const attempts = [];
              const batches = [];
              const start = performance.now();
              for (let i = 0; i < 100; i++) {
                await waitUntil(start + (i * 1000) / hz);
                const x = 40 + (i % 5) * 270;
                const y = 30 + Math.floor(i / 5) * 28;
                const pointerId = i < 50 ? 41 : i + 100;
                const send = (phase: 'down' | 'up', px: number) => {
                  const target = document.elementFromPoint(bounds.left + px, bounds.top + y)!;
                  target.dispatchEvent(
                    new PointerEvent(`pointer${phase}`, {
                      bubbles: true,
                      cancelable: true,
                      pointerId,
                      pointerType: 'pen',
                      clientX: bounds.left + px,
                      clientY: bounds.top + y,
                      button: 0,
                      buttons: phase === 'up' ? 0 : 1,
                      pressure: phase === 'up' ? 0 : 0.5,
                    })
                  );
                };
                const down = performance.now();
                send('down', x);
                await waitUntil(down + contactMs);
                send('up', x + length);
                attempts.push({
                  x,
                  y,
                  pointerId,
                  down,
                  up: performance.now(),
                  objects: editor.getSnapshot('document').objects.length,
                });
                if ((i + 1) % 10 === 0) {
                  const trace = window.__layeredGestureTrace!.snapshot();
                  const previous = batches.at(-1)?.total ?? 0;
                  batches.push({
                    total: trace.total,
                    counts: trace.counts,
                    entries: trace.entries.filter((entry) => entry.sequence > previous),
                  });
                }
              }
              return {
                input: 'synthetic PointerEvent, isTrusted=false, actual DOM hit testing',
                length,
                hz,
                contactMs,
                attempts,
                batches,
                environment: window.__layeredGestureTrace!.snapshot().environment,
                objects: editor.getSnapshot('document').objects,
                interaction: editor.getSnapshot('interaction'),
                viewport: editor.getSnapshot('viewport'),
              };
            },
            { length, hz, contactMs }
          );
          await testInfo.attach('input-trace.json', {
            body: JSON.stringify(evidence, null, 2),
            contentType: 'application/json',
          });
          expect(evidence.attempts.map((attempt) => attempt.objects)).toEqual(
            Array.from({ length: 100 }, (_, i) => i + 1)
          );
          const counts = evidence.batches.at(-1)!.counts;
          for (const key of [
            'event:pointerdown:',
            'event:pointerup:',
            'freehand:begin:accepted',
            'freehand:end:accepted',
            'freehand:commit:accepted',
          ])
            expect(counts[key], key).toBe(100);
          expect(evidence.interaction.activeFreehand).toBeUndefined();
          expect(evidence.interaction.pendingCandidates).toHaveLength(0);
          for (const object of evidence.objects) {
            expect(object.kind).toBe('freehand');
            if (object.kind !== 'freehand') continue;
            expect(object.samples).toHaveLength(2);
            expect(object.samples[0].phase).toBe('down');
            expect(object.samples[1]).toMatchObject({ phase: 'up', pressure: 0 });
          }
          const nodes = page.locator('[data-testid="layered-display"] [data-object-id]');
          await expect(nodes).toHaveCount(100);
          await expect
            .poll(() =>
              nodes.evaluateAll((entries) =>
                entries.every((node) => getComputedStyle(node).visibility === 'visible')
              )
            )
            .toBe(true);
          const surfaceImage = await page.getByTestId('layered-surface').screenshot();
          const png = await decodeRgbaPng(surfaceImage);
          const visible = evidence.attempts.filter(({ x, y }) => {
            for (let dy = -4; dy <= 4; dy++)
              for (let dx = -4; dx <= 4; dx++) {
                const [r, g, b] = pixel(png, x + dx, y + dy);
                if (g > r + 20 && g > b + 10) return true;
              }
            return false;
          }).length;
          await testInfo.attach('100-final-strokes.png', {
            body: surfaceImage,
            contentType: 'image/png',
          });
          expect(visible).toBe(100);
          const history = await page.evaluate(() => {
            const editor = window.__layeredEditor!;
            const original = editor.getSnapshot('document').objects;
            const undo = [];
            const redo = [];
            for (let i = 0; i < 100; i++) {
              const result = editor.undo();
              undo.push(result.ok ? result.value.objects.length : result.error.code);
            }
            const baseline = editor.getSnapshot('history');
            for (let i = 0; i < 100; i++) {
              const result = editor.redo();
              redo.push(result.ok ? result.value.objects.length : result.error.code);
            }
            return {
              undo,
              redo,
              baseline,
              original,
              restored: editor.getSnapshot('document').objects,
            };
          });
          expect(history.undo).toEqual(Array.from({ length: 100 }, (_, i) => 99 - i));
          expect(history.baseline.canUndo).toBe(false);
          expect(history.redo).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
          expect(history.restored).toEqual(history.original);
          await pointer(page, 'down', 50, 610);
          await pointer(page, 'up', 58, 610, 0);
          await expect(nodes).toHaveCount(101);
          await testInfo.attach('counts.json', {
            body: JSON.stringify(
              {
                attempts: 100,
                counts,
                objects: evidence.objects.length,
                visible,
                undo: history.undo,
                redo: history.redo,
              },
              null,
              2
            ),
            contentType: 'application/json',
          });
        });
      }
    }
  }
});

for (const diagnostics of [true, false]) {
  for (const length of [8, 160]) {
    test(`browser pen ${length}px at 5Hz, diagnostics=${diagnostics}`, async ({
      page,
      browserName,
    }, testInfo) => {
      test.skip(browserName !== 'chromium', 'CDP pen injection is Chromium-only');
      await page.setViewportSize({ width: 1500, height: 1100 });
      await page.goto(`/layered-editor${diagnostics ? '?diagnostics=1&traceGestures=1' : ''}`);
      const surface = page.getByTestId('layered-surface');
      await expect(surface).toHaveAttribute('data-input-arbiter', 'ready');
      await page.evaluate(() => {
        const events: { phase: string; trusted: boolean; source: string; at: number }[] = [];
        Object.assign(window, { rapidBrowserEvents: events });
        for (const phase of ['pointerdown', 'pointerup'])
          document.querySelector('[data-testid="layered-surface"]')!.addEventListener(
            phase,
            (event) => {
              const pointer = event as PointerEvent;
              events.push({
                phase,
                trusted: pointer.isTrusted,
                source: pointer.pointerType,
                at: performance.now(),
              });
            },
            true
          );
      });
      const cdp = await page.context().newCDPSession(page);
      const bounds = (await surface.boundingBox())!;
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        const remaining = start + i * 200 - performance.now();
        if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
        const x = bounds.x + 40 + (i % 5) * 260;
        const y = bounds.y + 30 + Math.floor(i / 5) * 28;
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x,
          y,
          button: 'left',
          buttons: 1,
          pointerType: 'pen',
          force: 0.5,
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: x + length,
          y,
          button: 'left',
          buttons: 0,
          pointerType: 'pen',
          force: 0,
        });
      }
      await cdp.detach();
      const evidence = await page.evaluate(() => ({
        events: (
          window as unknown as {
            rapidBrowserEvents: { phase: string; trusted: boolean; source: string; at: number }[];
          }
        ).rapidBrowserEvents,
        trace: window.__layeredGestureTrace?.snapshot(),
        objects: window.__layeredEditor?.getSnapshot('document').objects,
      }));
      await testInfo.attach('browser-pen.json', {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json',
      });
      expect(evidence.events).toHaveLength(200);
      expect(evidence.events.every((event) => event.trusted && event.source === 'pen')).toBe(true);
      const nodes = page.locator('[data-testid="layered-display"] [data-object-id]');
      await expect(nodes).toHaveCount(100);
      await expect
        .poll(() =>
          nodes.evaluateAll((entries) =>
            entries.every((node) => getComputedStyle(node).visibility === 'visible')
          )
        )
        .toBe(true);
      const screenshot = await surface.screenshot();
      const png = await decodeRgbaPng(screenshot);
      for (let i = 0; i < 100; i++) {
        const x = 40 + (i % 5) * 260;
        const y = 30 + Math.floor(i / 5) * 28;
        expect(
          Array.from({ length: 9 }, (_, dy) => pixel(png, x + 2, y - 4 + dy)).some(
            ([r, g, b]) => g > r + 20 && g > b + 10
          )
        ).toBe(true);
      }
      await testInfo.attach('browser-100-strokes.png', {
        body: screenshot,
        contentType: 'image/png',
      });
    });
  }
}

for (const firstTool of ['freehand', 'line'] as const) {
  test(`plain Web ${firstTool} first commit allows more ink, undo/redo and tool switching`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(45000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // No diagnostic globals, native connection, fixture or delayed handoff.
    await page.goto('/layered-editor');
    const surface = page.getByTestId('layered-surface');
    await expect(surface).toHaveAttribute('data-input-arbiter', 'ready');
    const select = async (tool: 'freehand' | 'line') =>
      page
        .getByRole('button', { name: tool === 'freehand' ? '自由笔' : '直线', exact: true })
        .click();
    const pen = async (y: number) => {
      await pointer(page, 'down', 80, y);
      await pointer(page, 'move', 220, y + 20);
      await pointer(page, 'up', 280, y + 30, 0);
    };
    const mouse = async (y: number) => {
      const box = (await surface.boundingBox())!;
      await page.mouse.move(box.x + 100, box.y + y);
      await page.mouse.down();
      await page.mouse.move(box.x + 300, box.y + y + 30, { steps: 8 });
      await page.mouse.up();
    };
    const objects = page.locator('[data-object-id]');
    await select(firstTool);
    await pen(80);
    await expect(objects).toHaveCount(1);
    await expect(objects.first()).toHaveCSS('visibility', 'visible');
    const firstPath = await objects.first().locator('path').getAttribute('d');
    expect(firstPath).toBeTruthy();
    await page.getByLabel('颜色', { exact: true }).fill('#df2468');
    await pen(150);
    await expect(objects).toHaveCount(2);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(objects).toHaveCount(1);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    await expect(objects).toHaveCount(2);
    await select(firstTool === 'freehand' ? 'line' : 'freehand');
    await pen(220);
    await expect(objects).toHaveCount(3);
    await select(firstTool);
    await mouse(290);
    await expect(objects).toHaveCount(4);
    for (const node of await objects.all()) await expect(node).toHaveCSS('visibility', 'visible');
    await expect(objects.first().locator('path')).toHaveAttribute('d', firstPath!);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(errors).toEqual([]);
    await testInfo.attach(`plain-web-${firstTool}-continues`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}

test('mixed SVG document order equals actual pixel order', async ({ page }, testInfo) => {
  await openEditor(page, '&fixture=mixed');
  await expect(page.locator('[data-object-id]')).toHaveCount(5);
  expect(
    await page
      .locator('[data-object-id]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-object-id')))
  ).toEqual(['lower-ink', 'middle-text', 'middle-image', 'upper-shape', 'upper-ink']);
  const screenshot = await page.getByTestId('layered-surface').screenshot();
  await testInfo.attach('mixed-order', { body: screenshot, contentType: 'image/png' });
  const png = await decodeRgbaPng(screenshot);
  expect(pixel(png, 50, 160)).toEqual([0, 128, 0]);
  expect(pixel(png, 90, 150)).toEqual([0, 0, 0]);
  expect(pixel(png, 140, 150)).toEqual([0, 0, 255]);
  expect(pixel(png, 200, 230)).toEqual([255, 255, 0]);
  expect(pixel(png, 230, 180)).toEqual([255, 0, 0]);
});

test('new mouse ink covers existing HTML text in active and historical pixels', async ({
  page,
}) => {
  await openEditor(page, '&fixture=mixed');
  await page.getByLabel('笔宽', { exact: true }).fill('40');
  await page.getByLabel('压力模式', { exact: true }).selectOption('constant');
  const surface = page.getByTestId('layered-surface');
  const box = (await surface.boundingBox())!;
  expect(pixel(await decodeRgbaPng(await surface.screenshot()), 90, 150)).toEqual([0, 0, 0]);
  await page.mouse.move(box.x + 90, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 110, box.y + 150);
  await expect
    .poll(async () => pixel(await decodeRgbaPng(await surface.screenshot()), 90, 150))
    .toEqual([20, 125, 100]);
  await page.mouse.up();
  await expect(page.locator('[data-object-id]')).toHaveCount(6);
  await expect(page.locator('[data-object-id]').last()).toHaveCSS('visibility', 'visible');
  expect(pixel(await decodeRgbaPng(await surface.screenshot()), 90, 150)).toEqual([20, 125, 100]);
});

test('default route opens the layered editor and responds over LAN', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByTestId('layered-drawing')).toBeVisible();
  const { networkInterfaces } = await import('node:os');
  const address = Object.values(networkInterfaces())
    .flat()
    .find((entry) => entry && entry.family === 'IPv4' && !entry.internal)?.address;
  expect(address).toBeTruthy();
  const response = await request.get(`http://${address}:5266/`);
  expect(response.ok()).toBe(true);
});

test('dot, pressure width and half-opacity delayed handoff remain visible', async ({
  page,
}, testInfo) => {
  await openEditor(page, '&handoffDelay=500');
  await page.getByLabel('笔宽', { exact: true }).fill('40');
  await page.getByLabel('不透明度', { exact: true }).fill('0.5');
  await page.getByLabel('压力模式', { exact: true }).selectOption('constant');
  const box = (await page.getByTestId('layered-surface').boundingBox())!;
  // Full viewport captures keep the video coordinate system stable during the handoff.
  const surfacePixel = (png: Awaited<ReturnType<typeof decodeRgbaPng>>, x: number, y: number) =>
    pixel(png, Math.round(box.x + x), Math.round(box.y + y));
  await pointer(page, 'down', 100, 100);
  // WebKit screenshots may precede the rAF that draws the accepted input.
  await expect
    .poll(async () => surfacePixel(await decodeRgbaPng(await page.screenshot()), 100, 100))
    .toEqual([137, 190, 177]);
  const active = await decodeRgbaPng(await page.screenshot());
  expect(surfacePixel(active, 100, 100)).toEqual([137, 190, 177]);
  await pointer(page, 'up', 100, 100, 0);
  await expect(page.locator('[data-object-id]')).toHaveCount(1);
  await expect(page.locator('[data-object-id]')).toHaveCSS('visibility', 'hidden');
  const pending = await decodeRgbaPng(await page.screenshot());
  expect(surfacePixel(pending, 100, 100)).toEqual([137, 190, 177]);
  await expect(page.locator('[data-object-id]')).toHaveCSS('visibility', 'visible');
  const final = await page.screenshot();
  await testInfo.attach('dot-final', { body: final, contentType: 'image/png' });
  expectCompositedPixel(
    surfacePixel(await decodeRgbaPng(final), 100, 100),
    surfacePixel(pending, 100, 100)
  );
  await page.getByLabel('压力模式', { exact: true }).selectOption('real');
  await pointer(page, 'down', 160, 140, 0.1);
  await pointer(page, 'move', 240, 140, 0.1);
  await pointer(page, 'up', 260, 140, 0);
  await pointer(page, 'down', 160, 220, 0.9);
  await pointer(page, 'move', 240, 220, 0.9);
  await pointer(page, 'up', 260, 220, 0);
  await expect(page.locator('[data-object-id]')).toHaveCount(3);
  await expect(page.locator('[data-object-id]').last()).toHaveCSS('visibility', 'visible');
  const png = await decodeRgbaPng(await page.screenshot());
  const thickness = (y: number) =>
    Array.from({ length: 70 }, (_, i) => surfacePixel(png, 220, y - 35 + i)).filter(
      ([r, g, b]) => g > r && g > b
    ).length;
  expect(thickness(220)).toBeGreaterThan(thickness(140) + 8);
  await page.getByLabel('压力模式', { exact: true }).selectOption('constant');
  await pointer(page, 'down', 350, 100);
  await pointer(page, 'move', 358, 100);
  await pointer(page, 'up', 360, 100, 0);
  await expect(page.locator('[data-object-id]').last()).toHaveCSS('visibility', 'visible');
  const short = await decodeRgbaPng(await page.screenshot());
  expectCompositedPixel(surfacePixel(short, 355, 100), [137, 190, 177]);
});

test('active samples do not reconcile history; tools preview and IME commit through the controller', async ({
  page,
}) => {
  await openEditor(page, '&fixture=mixed');
  const before = await page.evaluate(() => ({ ...window.__layeredRenders! }));
  await pointer(page, 'down', 350, 300);
  for (let i = 0; i < 20; i++) await pointer(page, 'move', 350 + i * 3, 300);
  expect(await page.evaluate(() => window.__layeredRenders)).toEqual(before);
  await pointer(page, 'up', 420, 300, 0);
  await page.getByRole('button', { name: '矩形', exact: true }).click();
  await pointer(page, 'down', 350, 100);
  await pointer(page, 'move', 450, 200);
  await expect(page.locator('[data-object-id="preview-shape"]')).toBeVisible();
  await pointer(page, 'up', 450, 200);
  await page.getByRole('button', { name: '文字', exact: true }).click();
  await pointer(page, 'down', 350, 350);
  const input = page.getByLabel('文字内容');
  await expect(input).toBeFocused();
  await input.dispatchEvent('compositionstart');
  await input.fill('中文\nLatin');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(input).toBeVisible();
  await input.dispatchEvent('compositionend');
  await expect(input).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__layeredEditor!.getSnapshot('document').objects.at(-1))
  ).toMatchObject({ kind: 'text', content: '中文\nLatin' });
});

test('mobile toolbar fits without horizontal overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openEditor(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await testInfo.attach('mobile', { body: await page.screenshot(), contentType: 'image/png' });
});

test('image file import decodes into ordered SVG pixels and one undo transaction', async ({
  page,
}) => {
  await openEditor(page);
  await page.getByRole('button', { name: '图片', exact: true }).click();
  const chooserPromise = page.waitForEvent('filechooser');
  await pointer(page, 'down', 100, 100);
  const chooser = await chooserPromise;
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 80;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#0000ff';
    context.fillRect(0, 0, 120, 80);
    return canvas.toDataURL().split(',')[1];
  });
  await chooser.setFiles({
    name: 'blue.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  await expect(page.locator('[data-object-id] image')).toHaveCount(1);
  const image = await decodeRgbaPng(await page.getByTestId('layered-surface').screenshot());
  expect(pixel(image, 140, 140)).toEqual([0, 0, 255]);
  const saved = await page.evaluate(() => window.__layeredEditor!.getSnapshot('document').objects);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.locator('[data-object-id] image')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(
    await page.evaluate(() => window.__layeredEditor!.getSnapshot('document').objects)
  ).toEqual(saved);
});

test('real mouse paints over existing SVG ink; keyboard cancellation preserves text', async ({
  page,
}) => {
  await openEditor(page, '&fixture=mixed');
  const box = (await page.getByTestId('layered-surface').boundingBox())!;
  await page.mouse.move(box.x + 230, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 180);
  await page.mouse.up();
  await expect(page.locator('[data-object-id]')).toHaveCount(6);
  await page.getByRole('button', { name: '文字', exact: true }).click();
  await pointer(page, 'down', 350, 300);
  await pointer(page, 'up', 350, 300, 0);
  const input = page.getByLabel('文字内容');
  await expect(input).toBeFocused();
  await input.fill('取消');
  await input.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(page.locator('[data-object-id]')).toHaveCount(6);
  await pointer(page, 'down', 350, 300);
  await pointer(page, 'up', 350, 300, 0);
  await input.fill('键盘提交');
  await input.press('Control+Enter');
  await expect(input).toHaveCount(0);
  await expect(page.locator('[data-object-id]')).toHaveCount(7);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.locator('[data-object-id]')).toHaveCount(6);
});

test('paper, ruler, touch pinch and minimap use the same viewport', async ({ page }) => {
  await openEditor(page, '&fixture=mixed');
  await page.getByLabel('虚拟纸张', { exact: true }).check();
  await page.getByLabel('小地图', { exact: true }).check();
  await page.getByLabel('尺子', { exact: true }).check();
  await expect(page.getByTestId('layered-paper')).toBeVisible();
  await expect(page.getByTestId('layered-ruler')).toBeVisible();
  const surface = page.getByTestId('layered-surface');
  const box = (await surface.boundingBox())!;
  const initial = await page.evaluate(
    () => window.__layeredEditor!.getSnapshot('viewport').viewport
  );
  const touch = async (phase: string, id: number, x: number, y: number) =>
    surface.dispatchEvent(`pointer${phase}`, {
      pointerId: id,
      pointerType: 'touch',
      clientX: box.x + x,
      clientY: box.y + y,
      button: 0,
    });
  await touch('down', 1, 100, 100);
  await touch('down', 2, 200, 100);
  await touch('move', 2, 300, 100);
  await touch('up', 2, 300, 100);
  await touch('up', 1, 100, 100);
  expect(
    await page.evaluate(() => window.__layeredEditor!.getSnapshot('viewport').viewport)
  ).toEqual({ scale: 2, tx: initial.tx * 2 - 100, ty: initial.ty * 2 - 100 });
  await expect(page.getByTestId('layered-display').locator(':scope > g')).toHaveAttribute(
    'transform',
    `matrix(2 0 0 2 ${initial.tx * 2 - 100} ${initial.ty * 2 - 100})`
  );
  await expect(page.getByTestId('layered-paper').locator('g')).toHaveAttribute(
    'transform',
    `matrix(2 0 0 2 ${initial.tx * 2 - 100} ${initial.ty * 2 - 100})`
  );
  const before = await page.evaluate(() => window.__layeredEditor!.getSnapshot('viewport'));
  const map = page.getByTestId('layered-minimap');
  await map.click({ position: { x: 100, y: 70 } });
  const after = await page.evaluate(() => window.__layeredEditor!.getSnapshot('viewport'));
  expect(after.revision).toBeGreaterThan(before.revision);
  expect(after.viewport.scale).toBe(2);
  await expect(page.locator('[data-object-id]')).toHaveCount(5);
});

for (const [tool, kind] of [
  ['直线', 'line'],
  ['矩形', 'rect'],
  ['椭圆', 'ellipse'],
  ['多边形', 'polygon'],
  ['贝塞尔', 'bezier'],
] as const) {
  test(`${kind} has live preview, cancel and one undo transaction`, async ({ page }) => {
    await openEditor(page);
    await page.getByRole('button', { name: tool, exact: true }).click();
    await pointer(page, 'down', 100, 100);
    await pointer(page, 'move', 200, 100);
    await pointer(page, 'move', 200, 200);
    await expect(
      kind === 'polygon'
        ? page.getByTestId('layered-display').locator('polyline')
        : page.locator('[data-object-id="preview-shape"]')
    ).toBeVisible();
    await page
      .getByTestId('layered-surface')
      .dispatchEvent('pointercancel', { pointerId: 41, pointerType: 'pen' });
    await expect(page.locator('[data-object-id]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
    await pointer(page, 'down', 100, 100);
    await pointer(page, 'move', 200, 100);
    await pointer(page, 'move', 200, 200);
    await pointer(page, 'up', 100, 200);
    expect(
      await page.evaluate(() => window.__layeredEditor!.getSnapshot('document').objects)
    ).toHaveLength(kind === 'polygon' || kind === 'bezier' ? 0 : 1);
    if (kind === 'polygon' || kind === 'bezier') {
      for (const [x, y] of [
        [200, 100],
        [200, 200],
      ]) {
        await pointer(page, 'down', x, y);
        await pointer(page, 'up', x, y);
      }
      if (kind === 'polygon') await page.getByTestId('layered-surface').dispatchEvent('dblclick');
    }
    expect(
      await page.evaluate(() => window.__layeredEditor!.getSnapshot('document').objects.at(-1))
    ).toMatchObject({ kind: 'shape', shapeType: kind });
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(page.locator('[data-object-id]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '重做', exact: true }).click();
    await expect(page.locator('[data-object-id]')).toHaveCount(1);
  });
}

test('lasso, move, resize, rotate and fast erase retain raw data and reversible history', async ({
  page,
}) => {
  await openEditor(page, '&fixture=mixed');
  const original = await page.evaluate(
    () => window.__layeredEditor!.getSnapshot('document').objects
  );
  await page.getByRole('button', { name: '套索', exact: true }).click();
  await pointer(page, 'down', 10, 80);
  for (const [x, y] of [
    [300, 80],
    [300, 280],
    [10, 280],
    [10, 80],
  ])
    await pointer(page, 'move', x, y);
  await pointer(page, 'up', 10, 80);
  expect(await page.evaluate(() => window.__layeredEditor!.getSnapshot('selection').length)).toBe(
    5
  );
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await pointer(page, 'down', 230, 180);
  await pointer(page, 'move', 250, 200);
  await pointer(page, 'up', 250, 200);
  const transformed = await page.evaluate(
    () => window.__layeredEditor!.getSnapshot('document').objects
  );
  expect(transformed[0].transform).not.toEqual(original[0].transform);
  expect(transformed.filter((o) => o.kind === 'freehand').map((o) => o.samples)).toEqual(
    original.filter((o) => o.kind === 'freehand').map((o) => o.samples)
  );
  for (const operation of ['resize', 'rotate']) {
    const handle = page.locator(`[data-selection-operation="${operation}"]`);
    const box = (await handle.boundingBox())!;
    const before = await page.evaluate(
      () => window.__layeredEditor!.getSnapshot('document').objects
    );
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 20);
    await page.mouse.up();
    expect(
      await page.evaluate(() => window.__layeredEditor!.getSnapshot('document').objects)
    ).not.toEqual(before);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect(
      await page.evaluate(() => window.__layeredEditor!.getSnapshot('document').objects)
    ).toEqual(before);
  }
  await page.getByRole('button', { name: '橡皮擦', exact: true }).click();
  await pointer(page, 'down', 10, 180);
  await pointer(page, 'move', 500, 180);
  const beforeErase = await page.evaluate(
    () => window.__layeredEditor!.getSnapshot('document').objects
  );
  expect(beforeErase).toHaveLength(5);
  await pointer(page, 'up', 500, 180);
  expect(
    await page.evaluate(() => window.__layeredEditor!.getSnapshot('document').objects.length)
  ).toBeLessThan(5);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(
    await page.evaluate(() => window.__layeredEditor!.getSnapshot('document').objects)
  ).toEqual(beforeErase);
});

test('shape dash and freehand pressure settings are isolated', async ({ page }) => {
  await openEditor(page);
  await page.getByLabel('压力模式', { exact: true }).selectOption('real');
  await page.getByRole('button', { name: '直线', exact: true }).click();
  await page.getByLabel('形状线型', { exact: true }).selectOption('dash');
  await page.getByRole('button', { name: '自由笔', exact: true }).click();
  await expect(page.getByLabel('形状线型', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('压力模式', { exact: true })).toHaveValue('real');
  await pointer(page, 'down', 100, 100);
  await pointer(page, 'move', 200, 100);
  await pointer(page, 'up', 220, 100, 0);
  expect(await page.locator('[data-object-id] path').getAttribute('stroke-dasharray')).toBeNull();
  await page.getByRole('button', { name: '直线', exact: true }).click();
  await expect(page.getByLabel('形状线型', { exact: true })).toHaveValue('dash');
});
