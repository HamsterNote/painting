import { expect, test, type Page } from '@playwright/test';

async function openEditor(page: Page, fixture = '') {
  await page.goto(`/layered-editor?diagnostics=1${fixture}`);
  await expect(page.getByTestId('layered-drawing')).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__layeredEditor));
}

async function history(page: Page) {
  return page.evaluate(() => window.__layeredEditor!.getSnapshot('document').objects);
}

for (const speed of ['fast', 'slow'] as const) {
  test(`${speed} pen release survives capture handoff and reaches visible history`, async ({
    page,
  }) => {
    await openEditor(page, '&fixture=mixed');
    const before = await history(page);
    const viewport = await page.evaluate(() => window.__layeredEditor!.getSnapshot('viewport'));
    await page.evaluate(async (speed) => {
      const surface = document.querySelector('[data-testid="layered-surface"]')!;
      const box = surface.getBoundingClientRect();
      const ink = document.querySelector('[data-object-id="upper-ink"] path')!;
      const send = (target: Element, type: string, x: number, y: number) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 71,
            pointerType: 'pen',
            button: 0,
            buttons: type === 'pointerup' ? 0 : 1,
            pressure: type === 'pointerup' ? 0 : 0.6,
            clientX: box.x + x,
            clientY: box.y + y,
          })
        );
      send(ink, 'pointerdown', 230, 180);
      // Direct-manipulation pen can transfer implicit child capture to the surface.
      if (speed === 'fast') send(ink, 'lostpointercapture', 230, 180);
      const steps = speed === 'fast' ? 1 : 12;
      for (let step = 1; step <= steps; step++) {
        send(surface, 'pointermove', 230 + (240 * step) / steps, 180 + (60 * step) / steps);
        if (speed === 'slow') await new Promise((resolve) => setTimeout(resolve, 16));
      }
      send(surface, 'pointerup', 470, 240);
    }, speed);
    await expect(page.getByTestId('layered-display').locator('[data-object-id]')).toHaveCount(6);
    const added = (await history(page)).at(-1)!;
    expect(added).toMatchObject({ kind: 'freehand', samples: expect.any(Array) });
    if (added.kind !== 'freehand') throw new Error('expected freehand');
    expect(added.samples.at(-1)).toMatchObject({ phase: 'up', pressure: 0 });
    const node = page.getByTestId('layered-display').locator('[data-object-id]').last();
    await expect(node).toHaveCSS('visibility', 'visible');
    await expect(node.locator('path')).toHaveAttribute('d', /\S+/);
    expect(await page.evaluate(() => window.__layeredEditor!.getSnapshot('viewport'))).toEqual(
      viewport
    );
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect(await history(page)).toEqual(before);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    expect((await history(page)).at(-1)).toEqual(added);
  });
}

test('bezier is a dragged line followed by two clicked control points and one transaction', async ({
  page,
}) => {
  await openEditor(page);
  await page.getByRole('button', { name: '贝塞尔', exact: true }).click();
  const box = (await page.getByTestId('layered-surface').boundingBox())!;
  const click = (x: number, y: number) => page.mouse.click(box.x + x, box.y + y);
  await page.mouse.move(box.x + 80, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 320, box.y + 100, { steps: 4 });
  await page.mouse.up();
  expect(await history(page)).toHaveLength(0);
  await expect(page.locator('[data-object-id="preview-shape"] path')).toHaveAttribute(
    'd',
    /^M 80 100 L 320 100$/
  );
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await click(100, 220);
  expect(await history(page)).toHaveLength(0);
  await click(280, 220);
  expect((await history(page))[0]).toMatchObject({
    kind: 'shape',
    shapeType: 'bezier',
    points: [
      { x: 80, y: 100 },
      { x: 100, y: 220 },
      { x: 280, y: 220 },
      { x: 320, y: 100 },
    ],
  });
  await expect(page.getByTestId('layered-display').locator('[data-object-id]')).toHaveCount(1);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await history(page)).toHaveLength(0);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(await history(page)).toHaveLength(1);
});

test('polygon accepts click vertices, ignores drag samples and double click closes once', async ({
  page,
}) => {
  await openEditor(page);
  await page.getByRole('button', { name: '多边形', exact: true }).click();
  const box = (await page.getByTestId('layered-surface').boundingBox())!;
  await page.mouse.move(box.x + 80, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + 150, { steps: 5 });
  await page.mouse.up();
  await page.mouse.click(box.x + 300, box.y + 100);
  await page.mouse.click(box.x + 300, box.y + 260);
  await page.mouse.move(box.x + 190, box.y + 280);
  expect(await history(page)).toHaveLength(0);
  await expect(page.getByTestId('layered-display').locator('polyline')).toBeVisible();
  await page.mouse.click(box.x + 80, box.y + 260);
  await page.mouse.move(box.x + 81, box.y + 261);
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.up({ clickCount: 2 });
  const objects = await history(page);
  expect(objects).toHaveLength(1);
  expect(objects[0]).toMatchObject({
    kind: 'shape',
    shapeType: 'polygon',
    points: [
      { x: 80, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 260 },
      { x: 80, y: 260 },
    ],
  });
  await expect(
    page.getByTestId('layered-display').locator('[data-object-id] path')
  ).toHaveAttribute('d', /Z$/);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await history(page)).toHaveLength(0);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(await history(page)).toEqual(objects);
});

for (const name of ['贝塞尔', '多边形']) {
  test(`${name} pending stages cancel with Escape or a tool switch without history`, async ({
    page,
  }) => {
    await openEditor(page);
    const box = (await page.getByTestId('layered-surface').boundingBox())!;
    const start = async () => {
      await page.getByRole('button', { name, exact: true }).click();
      await page.mouse.move(box.x + 80, box.y + 100);
      await page.mouse.down();
      await page.mouse.move(box.x + 300, box.y + 100);
      await page.mouse.up();
      await page.mouse.click(box.x + 160, box.y + 220);
    };
    await start();
    expect(await history(page)).toHaveLength(0);
    await page.keyboard.press('Escape');
    await expect(
      page.getByTestId('layered-display').locator('[data-object-id],polyline')
    ).toHaveCount(0);
    await start();
    await page.getByRole('button', { name: '自由笔', exact: true }).click();
    await expect(
      page.getByTestId('layered-display').locator('[data-object-id],polyline')
    ).toHaveCount(0);
    expect(await history(page)).toHaveLength(0);
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  });
}

test('minimap paper is absent and background is white when the toolbar paper toggle is off', async ({
  page,
}) => {
  await openEditor(page);
  const map = page.getByTestId('layered-minimap');
  await page.getByLabel('小地图', { exact: true }).check();
  const paper = page.getByLabel('虚拟纸张', { exact: true });
  await paper.check();
  await expect(page.getByTestId('layered-paper')).toBeVisible();
  await expect(map.locator('[data-minimap-paper]')).toHaveCount(1);
  await paper.uncheck();
  await expect(page.getByTestId('layered-paper')).toHaveCount(0);
  await expect(map.locator('[data-minimap-paper]')).toHaveCount(0);
  await expect(map).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  expect(await history(page)).toHaveLength(0);
});

for (const width of [1280, 390]) {
  for (const zoom of [false, true]) {
    test(`paper starts horizontally centered at width ${width}, zoom changed ${zoom}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await openEditor(page);
      const surface = page.getByTestId('layered-surface');
      const box = (await surface.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + 120);
      if (zoom) {
        await page.keyboard.down('Control');
        await page.mouse.wheel(0, -200);
        await page.keyboard.up('Control');
        await page.waitForFunction(
          () => window.__layeredEditor!.getSnapshot('viewport').viewport.scale > 1
        );
      }
      const before = await page.evaluate(
        () => window.__layeredEditor!.getSnapshot('viewport').viewport
      );
      await page.getByLabel('虚拟纸张', { exact: true }).check();
      await page.getByLabel('小地图', { exact: true }).check();
      const paper = page.getByTestId('layered-paper');
      const paperWidth = Number(await paper.locator('rect').getAttribute('width'));
      const tx = (box.width - paperWidth * before.scale) / 2;
      const matrix = `matrix(${before.scale} 0 0 ${before.scale} ${tx} ${before.ty})`;
      await expect(paper.locator('g')).toHaveAttribute('transform', matrix);
      await expect(page.getByTestId('layered-display').locator(':scope > g')).toHaveAttribute(
        'transform',
        matrix
      );
      const rect = (await paper.locator('rect').boundingBox())!;
      expect(rect.x + rect.width / 2).toBeCloseTo(box.x + box.width / 2, 1);
      expect(Number(await page.getByTestId('minimap-viewport').getAttribute('x'))).toBeCloseTo(
        -tx / before.scale
      );
      const viewport = await page.evaluate(() => window.__layeredEditor!.getSnapshot('viewport'));
      expect(viewport.viewport).toEqual({ ...before, tx });
      // Verify input uses this same transform; CSS-only centering would fail.
      await surface.evaluate((host: HTMLElement) => {
        host.addEventListener(
          'pointerdown',
          (event) => {
            const rect = host.getBoundingClientRect();
            host.dataset.testDown = JSON.stringify({
              x: event.clientX,
              y: event.clientY,
              left: rect.left,
              top: rect.top,
              clientLeft: host.clientLeft,
              clientTop: host.clientTop,
            });
          },
          { once: true, capture: true }
        );
      });
      await page.mouse.move(box.x + box.width / 2, box.y + 180);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 40, box.y + 200);
      await page.mouse.up();
      const object = (await history(page))[0];
      if (object.kind !== 'freehand') throw new Error('missing ink');
      const received: {
        x: number;
        y: number;
        left: number;
        top: number;
        clientLeft: number;
        clientTop: number;
      } = JSON.parse((await surface.getAttribute('data-test-down'))!);
      expect(object.samples[0].x).toBeCloseTo(
        (received.x - received.left - received.clientLeft - tx) / before.scale
      );
      expect(object.samples[0].y).toBeCloseTo(
        (received.y - received.top - received.clientTop - before.ty) / before.scale
      );
      await expect(page.getByTestId('layered-display').locator('[data-object-id]')).toHaveCSS(
        'visibility',
        'visible'
      );
      await page.mouse.wheel(40, 30);
      await page.waitForFunction(
        (revision) => window.__layeredEditor!.getSnapshot('viewport').revision > revision,
        viewport.revision
      );
      const navigated = await page.evaluate(() => window.__layeredEditor!.getSnapshot('viewport'));
      await page.getByLabel('虚拟纸张', { exact: true }).uncheck();
      await page.getByLabel('虚拟纸张', { exact: true }).check();
      await page.setViewportSize({ width: width + 80, height: 900 });
      await expect(surface).toHaveCSS('width', `${width + 80}px`);
      expect(await page.evaluate(() => window.__layeredEditor!.getSnapshot('viewport'))).toEqual(
        navigated
      );
    });
  }
}

test('synthetic fractional coordinates retain the exact content-box to world transform', async ({
  page,
}) => {
  await openEditor(page);
  await page.evaluate(() => {
    const editor = window.__layeredEditor!;
    editor.updateViewport({
      type: 'replace',
      expectedRevision: editor.getSnapshot('viewport').revision,
      viewport: { scale: 2, tx: 10.25, ty: -5.75 },
    });
    const host = document.querySelector<HTMLElement>('[data-testid="layered-surface"]')!;
    host.style.transform = 'translate(0.5px, 0.5px)';
    host.style.border = '1px solid transparent';
    const rect = host.getBoundingClientRect();
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
      host.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: -765894345,
          pointerType: 'pen',
          clientX: rect.left + host.clientLeft + 37.125,
          clientY: rect.top + host.clientTop + 42.875,
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          pressure: type === 'pointerup' ? 0 : 0.5,
        })
      );
    }
  });
  const objects = await history(page);
  expect(objects).toHaveLength(1);
  const ink = objects[0];
  if (ink.kind !== 'freehand') throw new Error('missing ink');
  expect(ink.samples[0].x).toBe((37.125 - 10.25) / 2);
  expect(ink.samples[0].y).toBe((42.875 + 5.75) / 2);
});
