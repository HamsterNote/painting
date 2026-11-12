import { expect, test } from '@playwright/test';

test('eraser samples and self-crossings have uniform alpha and expire 1s after release', async ({
  page,
}) => {
  await page.goto('/painting.html?legacy');
  await page.getByRole('button', { name: '橡皮擦', exact: true }).click();
  const surface = page.getByTestId('layered-surface');
  const box = (await surface.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  for (const [x, y] of [
    [180, 100],
    [260, 100],
    [180, 180],
    [180, 60],
  ]) {
    await page.mouse.move(box.x + x!, box.y + y!, { steps: 10 });
  }
  const trail = page.locator('[data-eraser-trail]');
  await expect(trail.locator('path')).toHaveCount(1);
  const alpha = await trail.evaluate(async (svg) => {
    const copy = svg.cloneNode(true) as SVGSVGElement;
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copy.setAttribute('width', '400');
    copy.setAttribute('height', '300');
    copy.style.width = '400px';
    copy.style.height = '300px';
    const image = new Image();
    image.src = `data:image/svg+xml;base64,${btoa(new XMLSerializer().serializeToString(copy))}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 300;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    // Between samples, at a sample joint, at a self-crossing, and on a single arm.
    return [
      [140, 100],
      [220, 100],
      [180, 100],
      [180, 140],
    ].map(([x, y]) => ctx.getImageData(x!, y!, 1, 1).data[3]);
  });
  expect(alpha[0]).toBeGreaterThan(110);
  expect(alpha[0]).toBeLessThan(120);
  expect(new Set(alpha).size).toBe(1);
  await page.mouse.up();
  await expect(trail.locator('g')).toHaveCSS('animation-duration', '1s');
  await expect.poll(() => trail.count(), { timeout: 3000, intervals: [50] }).toBe(0);
});

test('public lightweight artifact serves reader/notes contract adapters without drawing runtime', async ({
  page,
  request,
}) => {
  await page.goto('/light.html');
  const modules = (await (await request.get('/light-modules.json')).json()) as string[];
  expect(modules.some((name) => /painting\/lib\/module\/toolbar/.test(name))).toBe(true);
  expect(
    modules.filter((name) =>
      /painting\/lib\/module\/(core|layered|input)|perfect-freehand|react-native/.test(name)
    )
  ).toEqual([]);
  await expect(
    page.getByTestId('legacy').getByRole('button', { name: '文件', exact: true })
  ).toHaveCount(0);
  for (const name of ['reader', 'notes']) {
    const pane = page.getByTestId(name);
    const trigger = pane.getByRole('button', { name: '文件', exact: true });
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    const menu = pane.getByRole('menu');
    await expect(menu.getByRole('menuitemradio')).toHaveCount(4);
    const rect = (await menu.boundingBox())!;
    const bounds = (await pane.boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(bounds.x);
    expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    expect(rect.y).toBeGreaterThanOrEqual(bounds.y);
    expect(rect.y + rect.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    await page.keyboard.press('End');
    await expect(menu.getByRole('menuitemradio').last()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  }
});

test('320px actual board: order, tap targets, async failure, zero inset and edge migration preserve ink', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/painting.html');
  const toolbar = page.getByRole('toolbar');
  await expect(toolbar).toBeVisible();
  const names = await toolbar
    .locator('button')
    .evaluateAll((items) => items.slice(0, 3).map((item) => item.getAttribute('aria-label')));
  expect(names).toEqual(['撤销', '重做', '文件']);
  const trigger = toolbar.getByRole('button', { name: '文件', exact: true });
  const box = (await trigger.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  const surface = page.getByTestId('layered-surface');
  const surfaceBox = (await surface.boundingBox())!;
  await page.mouse.move(70, surfaceBox.y + 70);
  await page.mouse.down();
  await page.mouse.move(140, surfaceBox.y + 90, { steps: 5 });
  await page.mouse.up();
  await expect(toolbar.getByRole('button', { name: '撤销', exact: true })).toBeEnabled();
  const display = page.getByTestId('layered-display');
  const ink = await display.innerHTML();
  expect(await display.locator('[data-object-id]').count()).toBe(1);
  await surface.evaluate((element) => {
    element.setAttribute('data-mount-proof', 'original');
  });
  await page.getByLabel('请求结果').selectOption('failed');
  await trigger.click();
  const menu = page.getByRole('menu', { name: '文件列表' });
  await menu.getByRole('menuitemradio').nth(1).click();
  await expect(menu.getByRole('alert')).toHaveText('保存失败，请重试');
  await expect(menu.getByRole('menuitemradio').first()).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  const shell = page.locator('[data-toolbar-edge]');
  await expect(shell).toHaveCSS('bottom', '42px');
  await page.getByRole('button', { name: '切换零安全区' }).click();
  await expect(shell).toHaveCSS('bottom', '8px');
  await page.getByRole('button', { name: '迁移边缘' }).click();
  await expect(shell).toHaveCSS('top', '60px');
  await expect(toolbar.getByRole('button', { name: '撤销', exact: true })).toBeEnabled();
  expect(await display.innerHTML()).toBe(ink);
  await expect(surface).toHaveAttribute('data-mount-proof', 'original');
  await trigger.click();
  const popup = (await menu.boundingBox())!;
  const triggerBox = (await trigger.boundingBox())!;
  expect(popup.y).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height);
  const canvasBox = (await surface.boundingBox())!;
  const stripBox = (await toolbar.boundingBox())!;
  expect(canvasBox.y).toBeGreaterThanOrEqual(stripBox.y + stripBox.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.screenshot({ path: info.outputPath('top-toolbar-320.png') });
});

test('legacy compiled PaintingBoard retains the bottom default and existing tools', async ({
  page,
}) => {
  await page.goto('/painting.html?legacy');
  const toolbar = page.getByRole('toolbar');
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole('button', { name: '文件', exact: true })).toHaveCount(0);
  await expect(page.locator('[data-toolbar-edge]')).toHaveCSS('bottom', '8px');
  await toolbar.getByRole('button', { name: '工具菜单' }).click();
  await page.getByRole('menuitemradio', { name: '矩形', exact: true }).click();
  await expect(toolbar.getByRole('button', { name: '工具菜单' })).toContainText('矩形');
  await page.getByRole('button', { name: '收起工具栏' }).click();
  await expect(toolbar).toHaveCount(0);
  await page.getByRole('button', { name: '展开工具栏' }).click();
  await expect(toolbar.getByRole('button', { name: '工具菜单' })).toContainText('矩形');
});

test('browser host success and cancellation preserve controlled list ordering', async ({
  page,
}) => {
  await page.goto('/light.html');
  const pane = page.getByTestId('reader');
  const trigger = pane.getByRole('button', { name: '文件', exact: true });
  await page.getByLabel('请求结果').selectOption('cancelled');
  await trigger.click();
  await pane.getByRole('menuitemradio').nth(1).click();
  await expect(pane.getByRole('menuitemradio').first()).toHaveAttribute('aria-checked', 'true');
  await expect(trigger).toBeEnabled();
  await page.keyboard.press('Escape');
  await page.getByLabel('请求结果').selectOption('success');
  await trigger.click();
  await pane.getByRole('menuitemradio').nth(1).click();
  await expect(pane.getByRole('menu')).toHaveCount(0);
  await trigger.click();
  await expect(pane.getByRole('menuitemradio').nth(1)).toHaveAttribute('aria-checked', 'true');
  await expect(pane.getByRole('menuitemradio').first()).toContainText('A.pdf');
  await expect(pane.getByRole('menuitemradio').last()).toContainText('s2');
});

test('shared pane layouts consume 24/34 once in side-by-side and vertical hosts', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/light.html?split');
  for (const name of ['reader', 'notes']) {
    await expect(page.getByTestId(name).locator('[data-toolbar-edge]')).toHaveCSS('bottom', '42px');
  }
  await page.setViewportSize({ width: 800, height: 1200 });
  await page.getByRole('button', { name: '迁移边缘' }).click();
  await expect(page.getByTestId('reader').locator('[data-toolbar-edge]')).toHaveCSS('top', '60px');
  await expect(page.getByTestId('notes').locator('[data-toolbar-edge]')).toHaveCSS(
    'bottom',
    '42px'
  );
  for (const name of ['reader', 'notes']) {
    const pane = page.getByTestId(name);
    const trigger = pane.getByRole('button', { name: '文件', exact: true });
    await trigger.click();
    const menu = pane.getByRole('menu');
    const popup = (await menu.boundingBox())!;
    const parent = (await pane.boundingBox())!;
    const button = (await trigger.boundingBox())!;
    expect(popup.y).toBeGreaterThanOrEqual(parent.y);
    expect(popup.y + popup.height).toBeLessThanOrEqual(parent.y + parent.height);
    expect(
      name === 'reader' ? popup.y >= button.y + button.height : popup.y + popup.height <= button.y
    ).toBe(true);
    await page.keyboard.press('Escape');
  }
  await page.screenshot({ path: info.outputPath('vertical-safe-area.png') });
});

test('320px board: file and tool/settings/zoom panels exclude each other in both directions', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/painting.html');
  const toolbar = page.getByRole('toolbar');
  const files = toolbar.getByRole('button', { name: '文件', exact: true });
  const menu = page.getByRole('menu', { name: '文件列表' });
  for (const name of ['设置', '工具菜单', '缩放比例']) {
    const trigger = toolbar.getByRole('button', { name, exact: true });
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await files.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('menu')).toHaveCount(1);
    await menu.getByRole('menuitemradio').nth(1).click();
    await expect(menu).toHaveCount(0);
    await files.click();
    await trigger.click();
    await expect(menu).toHaveCount(0);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    // Focus + keyboard opening must also close the sibling panel.
    await files.focus();
    await page.keyboard.press('ArrowDown');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
  }
  await files.click();
  await page.screenshot({ path: info.outputPath('exclusive-file-menu-320.png') });
});

for (const remove of [false, true]) {
  test(`320px board: long Chinese names and storage paths stay inside file hit regions (remove=${remove})`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(`/painting.html?long${remove ? '&remove' : ''}`);
    await page.getByRole('button', { name: '文件', exact: true }).click();
    const menu = page.getByRole('menu', { name: '文件列表' });
    const measurements = await menu.getByRole('menuitemradio').evaluateAll((items) =>
      items.map((item) => {
        const button = item.getBoundingClientRect();
        const text = item.querySelector('span')!.getBoundingClientRect();
        const row = item.parentElement!.getBoundingClientRect();
        return {
          height: button.height,
          textHeight: text.height,
          contained:
            text.top >= button.top &&
            text.bottom <= button.bottom &&
            text.left >= button.left &&
            text.right <= button.right,
          inRow: button.top >= row.top && button.bottom <= row.bottom,
        };
      })
    );
    expect(measurements[0].textHeight).toBeGreaterThan(44);
    expect(measurements[1].textHeight).toBeGreaterThan(44);
    for (const measured of measurements) {
      expect(measured.height).toBeGreaterThanOrEqual(44);
      expect(measured.contained).toBe(true);
      expect(measured.inRow).toBe(true);
    }
    if (remove) {
      const targets = menu.getByRole('menuitem', { name: /^移除 / });
      await expect(targets).toHaveCount(4);
      const box = (await targets.first().boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: info.outputPath(`long-file-menu-remove-${remove}.png`) });
    // Scroll to a later row and confirm the preceding long name cannot intercept it.
    await menu.getByRole('menuitemradio').nth(1).click();
    await expect(menu).toHaveCount(0);
  });
}
