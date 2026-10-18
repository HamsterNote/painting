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
