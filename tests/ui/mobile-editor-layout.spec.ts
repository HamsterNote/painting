import { expect, test } from '@playwright/test';
import {
  dispatchLayeredPointer,
  layeredState,
  openLayeredEditor,
  selectToolbarTool,
} from './layered-helpers';

for (const width of [320, 402]) {
  test(`right-edge text stays reachable through keyboard viewport changes at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await openLayeredEditor(page);
    await selectToolbarTool(page, '文字');
    await page.getByRole('button', { name: '收起工具栏' }).click();
    const surface = (await page.getByTestId('layered-surface').boundingBox())!;
    const point = { x: surface.width - 12, y: surface.height - 180 };
    const before = await layeredState(page);
    await dispatchLayeredPointer(page, 'down', point);
    await dispatchLayeredPointer(page, 'up', point);
    const input = page.getByLabel('文字内容');
    await expect(input).toBeFocused();
    await input.fill('右侧输入\n中文 IME draft');
    // Model WKWebView's keyboard resize and later visual viewport pan. This is
    // browser layout evidence, not an assertion that a system keyboard opened.
    await page.evaluate(() => {
      const viewport = visualViewport!;
      for (const [key, value] of Object.entries({
        offsetLeft: 0,
        offsetTop: 0,
        width: innerWidth,
        height: 300,
      })) {
        Object.defineProperty(viewport, key, { configurable: true, writable: true, value });
      }
      viewport.dispatchEvent(new Event('resize'));
    });
    const editor = page.locator('[data-text-editor]');
    const check = async () =>
      editor.evaluate((node) => {
        const box = node.getBoundingClientRect(),
          view = visualViewport!;
        const button = [...node.querySelectorAll('button')]
          .find((item) => item.textContent === '完成')!
          .getBoundingClientRect();
        return (
          box.left >= view.offsetLeft &&
          box.right <= view.offsetLeft + view.width &&
          box.top >= view.offsetTop &&
          box.bottom <= view.offsetTop + view.height &&
          button.left >= box.left &&
          button.right <= box.right &&
          button.bottom <= box.bottom
        );
      });
    await expect.poll(check).toBe(true);
    await expect(input).toBeFocused();
    await page.evaluate(() => {
      Object.assign(visualViewport!, { offsetTop: 80, height: 240 });
      visualViewport!.dispatchEvent(new Event('scroll'));
    });
    await expect.poll(check).toBe(true);
    await expect(input).toHaveValue('右侧输入\n中文 IME draft');
    expect((await layeredState(page)).document).toEqual(before.document);
    expect((await layeredState(page)).viewport).toEqual(before.viewport);
    await info.attach('text-visible-viewport', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await page.getByRole('button', { name: '完成', exact: true }).click();
    const after = await layeredState(page);
    expect(after.document.objects).toHaveLength(1);
    expect(after.document.objects[0]).toMatchObject({
      kind: 'text',
      content: '右侧输入\n中文 IME draft',
      localBounds: { minX: point.x, minY: point.y },
    });
    expect(after.viewport).toEqual(before.viewport);
    await page.evaluate(() => window.__layeredEditor!.undo());
    expect((await layeredState(page)).document.objects).toEqual(before.document.objects);
  });
}

test('capsule acquires full narrow-host width as soon as its host is laid out', async ({
  page,
}) => {
  await page.setViewportSize({ width: 402, height: 844 });
  await openLayeredEditor(page);
  const strip = page.getByRole('toolbar', { name: '绘图工具' });
  const width = await page
    .locator('[data-painting-board]')
    .evaluate(async (element: HTMLElement) => {
      element.style.width = '0px';
      await new Promise(requestAnimationFrame);
      element.style.width = '402px';
      return new Promise<number>((resolve) =>
        requestAnimationFrame(() =>
          resolve(element.querySelector('[role="toolbar"]')!.getBoundingClientRect().width)
        )
      );
    });
  expect(width).toBe(370);
  expect(await strip.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  await strip.evaluate((node) => {
    node.scrollLeft = node.scrollWidth;
  });
  await expect(page.getByLabel('自由取色', { exact: true })).toBeInViewport();
});

test('editing transformed content keeps controls upright and cancel preserves the original object', async ({
  page,
}) => {
  await page.setViewportSize({ width: 780, height: 700 });
  await openLayeredEditor(page, '&fixture=mixed');
  await selectToolbarTool(page, '文字');
  const before = await layeredState(page);
  await dispatchLayeredPointer(page, 'down', { x: 90, y: 100 });
  await dispatchLayeredPointer(page, 'up', { x: 90, y: 100 });
  const input = page.getByLabel('文字内容');
  await expect(input).toHaveValue('██');
  await input.fill('discard this draft');
  await page.locator('[data-painting-board]').evaluate((node: HTMLElement) => {
    Object.assign(node.style, {
      width: '600px',
      height: '460px',
      transformOrigin: '0 0',
      transform: 'translate(50px, 40px) rotate(5deg) scale(0.8)',
    });
    window.dispatchEvent(new Event('resize'));
  });
  const panel = page.locator('[data-text-editor]');
  await expect(panel).toHaveCSS('transform', 'none');
  await expect
    .poll(() =>
      panel.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const surface = document.querySelector('[data-drawing-viewport]')!.getBoundingClientRect();
        return (
          box.left >= Math.max(0, surface.left) &&
          box.right <= Math.min(innerWidth, surface.right) &&
          box.top >= Math.max(0, surface.top) &&
          box.bottom <= Math.min(innerHeight, surface.bottom)
        );
      })
    )
    .toBe(true);
  await expect(input).toBeFocused();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(panel).toHaveCount(0);
  const after = await layeredState(page);
  expect(after.document).toEqual(before.document);
  expect(after.history).toEqual(before.history);
  expect(after.viewport).toEqual(before.viewport);
});
