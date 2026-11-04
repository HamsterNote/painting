import { expect, test } from '@playwright/test';
import {
  dispatchLayeredPointer,
  layeredState,
  openLayeredEditor,
  openToolbarSettings,
  selectToolbarTool,
} from './layered-helpers';

for (const width of [320, 390, 768, 1024, 1280, 1440]) {
  test(`toolbar layout and keyboard reach at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await openLayeredEditor(page);
    const strip = page.getByRole('toolbar', { name: '绘图工具' });
    const box = (await strip.boundingBox())!;
    expect(box.height).toBe(60);
    expect(box.x).toBeGreaterThanOrEqual(16);
    expect(box.x + box.width).toBeLessThanOrEqual(width - 16);
    await expect(strip).toHaveCSS('border-radius', '30px');
    await expect(strip).toHaveCSS('background-color', 'rgb(245, 246, 248)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    if (width >= 1280)
      expect(await strip.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    const targets = await strip.getByRole('button').evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          compact: button.classList.contains('hn-painting-color'),
        };
      })
    );
    for (const target of targets) {
      expect(target.width).toBeGreaterThanOrEqual(target.compact ? 30 : 44);
      expect(target.height).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole('button', { name: '缩放比例' }).focus();
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      const result = await strip.evaluate((el) => {
        const active = document.activeElement;
        if (!active || !el.contains(active)) return true;
        const a = active.getBoundingClientRect(),
          b = el.getBoundingClientRect();
        return a.left >= b.left && a.right <= b.right;
      });
      expect(result).toBe(true);
    }
    await openToolbarSettings(page);
    const panel = page.getByRole('dialog', { name: '绘图设置' });
    const panelBox = (await panel.boundingBox())!;
    expect(panelBox.x).toBeGreaterThanOrEqual(0);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(width);
    expect(panelBox.y).toBeGreaterThanOrEqual(0);
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(900);
    await page.screenshot({ path: info.outputPath(`toolbar-${width}-settings.png`) });
    await info.attach('settings', { body: await page.screenshot(), contentType: 'image/png' });
    await page.keyboard.press('Escape');
    await selectToolbarTool(page, '文字');
    await page.mouse.move(1, 1);
    await expect(page.getByRole('button', { name: '工具菜单', exact: true })).toHaveCSS(
      'background-color',
      'rgb(113, 99, 217)'
    );
    await expect(page.getByRole('button', { name: 'OCR', exact: true })).toHaveCount(0);
    const collapse = (await page.getByRole('button', { name: '收起工具栏' }).boundingBox())!;
    expect(collapse.y + collapse.height).toBeLessThanOrEqual(box.y - 8);
    const colors = page.locator('.hn-painting-color span');
    const firstColor = (await colors.nth(0).boundingBox())!,
      secondColor = (await colors.nth(1).boundingBox())!;
    expect(secondColor.x - firstColor.x - firstColor.width).toBeCloseTo(20 / 3, 1);
    await expect(page.getByLabel('自由取色', { exact: true })).toBeDisabled();
    await page.screenshot({ path: info.outputPath(`toolbar-${width}.png`) });
    await page.getByRole('button', { name: '收起工具栏' }).click();
    await expect(strip).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`toolbar-${width}-collapsed.png`) });
    await page.getByRole('button', { name: '展开工具栏' }).click();
    await expect(page.getByRole('button', { name: '收起工具栏' })).toBeFocused();
  });
}

test('keyboard menu selection, editable numbers, dismissal and the next canvas down', async ({
  page,
}) => {
  await openLayeredEditor(page);
  const trigger = page.getByRole('button', { name: '工具菜单' });
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: '直线', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  expect((await layeredState(page)).tools.activeTool).toBe('rect');
  await expect(trigger).toBeFocused();
  await openToolbarSettings(page);
  const width = page.getByLabel('笔宽', { exact: true });
  await width.fill('12');
  await width.selectText();
  await page.keyboard.type('16');
  expect((await layeredState(page)).tools.settings.shape.width).toBe(16);
  await width.fill('0.5');
  expect((await layeredState(page)).tools.settings.shape.width).toBe(0.5);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '缩放比例' }).click();
  const zoom = page.getByLabel('缩放', { exact: true });
  await zoom.press('Home');
  for (let i = 0; i < 4; i++) await zoom.press('ArrowRight');
  expect((await layeredState(page)).viewport.viewport.scale).toBe(1.25);
  await expect(zoom).toHaveAttribute('type', 'range');
  await page.keyboard.press('Escape');
  await selectToolbarTool(page, '自由笔');
  await openToolbarSettings(page);
  const surface = (await page.getByTestId('layered-surface').boundingBox())!;
  // Real mouse input dismisses the panel and starts one stroke in the same down.
  await page.mouse.move(surface.x + 30, surface.y + 40);
  await page.mouse.down();
  await page.mouse.move(surface.x + 140, surface.y + 40);
  await page.mouse.up();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await layeredState(page)).document.objects).toHaveLength(1);
});

test('thirty short pen strokes and a crossing do not activate the toolbar or swallow its next click', async ({
  page,
}) => {
  await openLayeredEditor(page);
  for (let i = 0; i < 30; i++) {
    await dispatchLayeredPointer(page, 'down', { x: 50 + i * 4, y: 30 });
    await dispatchLayeredPointer(page, 'up', { x: 52 + i * 4, y: 32 });
  }
  expect((await layeredState(page)).document.objects).toHaveLength(30);
  const surface = (await page.getByTestId('layered-surface').boundingBox())!;
  const target = (await page.getByRole('button', { name: '工具菜单', exact: true }).boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  for (const [type, x, y, buttons] of [
    ['mousePressed', surface.x + 80, surface.y + 80, 1],
    ['mouseMoved', target.x + 20, target.y + 20, 1],
    ['mouseReleased', target.x + 20, target.y + 20, 0],
  ] as const) {
    await cdp.send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      buttons,
      button: 'left',
      pointerType: 'pen',
      clickCount: 1,
    });
  }
  expect((await layeredState(page)).tools.activeTool).toBe('freehand');
  expect((await layeredState(page)).document.objects).toHaveLength(31);
  await selectToolbarTool(page, '文字');
  expect((await layeredState(page)).tools.activeTool).toBe('text');
  expect(await page.evaluate(() => getSelection()?.toString())).toBe('');
});

test('200% browser page scale and visual viewport resize keep settings reachable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 780, height: 844 });
  await openLayeredEditor(page);
  const cdp = await page.context().newCDPSession(page);
  await openToolbarSettings(page);
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  await page.getByLabel('笔宽', { exact: true }).focus();
  const check = async () =>
    page.getByRole('dialog', { name: '绘图设置' }).evaluate((el) => {
      const rect = el.getBoundingClientRect(),
        view = visualViewport!;
      return (
        rect.left >= view.offsetLeft &&
        rect.right <= view.offsetLeft + view.width &&
        rect.top >= view.offsetTop &&
        rect.bottom <= view.offsetTop + view.height
      );
    });
  await expect.poll(check).toBe(true);
  // Desktop automation cannot open a physical IME keyboard; shrink its visible viewport.
  await page.setViewportSize({ width: 780, height: 440 });
  await expect.poll(check).toBe(true);
  await page.getByLabel('笔宽', { exact: true }).fill('20');
  expect((await layeredState(page)).tools.settings.freehand.nominalSize).toBe(20);
});

test('custom color and clear canvas preserve independent styles and reversible history', async ({
  page,
}) => {
  await openLayeredEditor(page);
  const ring = page.getByLabel('自由取色', { exact: true });
  await expect(ring).toHaveValue('#2d2d2d');
  await ring.evaluate((node: HTMLInputElement) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      node,
      '#123456'
    );
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect((await layeredState(page)).tools.settings.freehand.color).toBe('#123456');
  await expect(page.locator('.hn-painting-custom-color span')).toHaveCSS(
    'outline-color',
    'rgb(18, 52, 86)'
  );
  await selectToolbarTool(page, '矩形');
  await expect(ring).toHaveValue('#2d2d2d');
  await selectToolbarTool(page, '自由笔');
  await dispatchLayeredPointer(page, 'down', { x: 50, y: 50 });
  await dispatchLayeredPointer(page, 'up', { x: 150, y: 50 });
  await dispatchLayeredPointer(page, 'down', { x: 50, y: 90 });
  await dispatchLayeredPointer(page, 'up', { x: 150, y: 90 });
  const before = await layeredState(page);
  await page.getByRole('button', { name: '清空画布', exact: true }).click();
  expect((await layeredState(page)).document.objects).toHaveLength(0);
  await expect(page.getByRole('button', { name: '清空画布', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await layeredState(page)).document.objects).toEqual(before.document.objects);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect((await layeredState(page)).document.objects).toHaveLength(0);
});
