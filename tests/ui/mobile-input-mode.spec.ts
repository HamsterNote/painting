import { expect, test, type Page } from '@playwright/test';
import {
  dispatchLayeredPointer as pointer,
  layeredState,
  openLayeredEditor,
} from './layered-helpers';
const key = 'hamster-note.painting.input-mode.v1';

for (const mode of ['auto', 'finger', 'pen']) {
  test(`signed-pointer-identity: ${mode} accepts iPad pen and touch IDs without changing ownership`, async ({
    page,
  }) => {
    await openLayeredEditor(page);
    await page.getByLabel('输入模式').selectOption(mode);
    const initial = await layeredState(page);
    // Exact signed IDs observed in the iPadOS 18 / Edge device trace.
    await stroke(page, 'touch', -765894343);
    const touched = await layeredState(page);
    expect(touched.document.objects).toHaveLength(mode === 'pen' ? 0 : 1);
    if (mode === 'pen') expect(touched.viewport).not.toEqual(initial.viewport);
    else expect(touched.viewport).toEqual(initial.viewport);
    await pointer(page, 'down', { x: 100, y: 120 }, { source: 'touch', id: -765894342 });
    await pointer(page, 'move', { x: 180, y: 140 }, { source: 'touch', id: -765894342 });
    if (mode !== 'pen') await expect.poll(() => activePixels(page)).toBeGreaterThan(0);
    await pointer(page, 'down', { x: 280, y: 140 }, { source: 'touch', id: -765894341 });
    await expect.poll(() => activePixels(page)).toBe(0);
    const pairStart = await layeredState(page);
    await pointer(page, 'move', { x: 380, y: 180 }, { source: 'touch', id: -765894341 });
    await pointer(page, 'up', { x: 180, y: 140 }, { source: 'touch', id: -765894342 });
    await pointer(page, 'up', { x: 380, y: 180 }, { source: 'touch', id: -765894341 });
    const paired = await layeredState(page);
    expect(paired.viewport.viewport.scale).toBeGreaterThan(pairStart.viewport.viewport.scale);
    expect(paired.document).toEqual(touched.document);
    expect(paired.history).toEqual(touched.history);
    await stroke(page, 'pen', -765894345, 180);
    const penned = await layeredState(page);
    expect(penned.document.objects).toHaveLength(touched.document.objects.length + 1);
    expect(penned.input.penSeen).toBe(true);
    expect(penned.viewport).toEqual(paired.viewport);
    await stroke(page, 'touch', -765894340);
    const after = await layeredState(page);
    expect(after.document.objects).toHaveLength(
      penned.document.objects.length + (mode === 'finger' ? 1 : 0)
    );
    if (mode === 'finger') expect(after.viewport).toEqual(penned.viewport);
    else expect(after.viewport).not.toEqual(penned.viewport);
    await page.getByRole('button', { name: '矩形', exact: true }).click();
    await stroke(page, 'pen', -765894344);
    expect((await layeredState(page)).document.objects).toHaveLength(
      after.document.objects.length + 1
    );
    expect((await layeredState(page)).document.objects.at(-1)?.kind).toBe('shape');
  });
}

declare global {
  interface Window {
    __inputFirstFrame?: { surface: string | null; menu: string };
  }
}

// Playwright gives each test a new browser context and isolated local storage.
async function stroke(page: Page, source: 'touch' | 'pen' | 'mouse' = 'touch', id = 1, y = 120) {
  await pointer(page, 'down', { x: 100, y }, { source, id });
  await pointer(page, 'move', { x: 180, y: y + 20 }, { source, id });
  await pointer(page, 'up', { x: 240, y }, { source, id });
}

async function activePixels(page: Page) {
  return page.getByTestId('layered-drawing').evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) count++;
    return count;
  });
}

test('auto-default-touch: visible ink, one undo transaction and a stationary viewport', async ({
  page,
}) => {
  await openLayeredEditor(page);
  await expect(page.getByLabel('输入模式')).toHaveValue('auto');
  const before = await layeredState(page);
  await pointer(page, 'down', { x: 100, y: 120 }, { source: 'touch', id: 1 });
  await pointer(page, 'move', { x: 180, y: 140 }, { source: 'touch', id: 1 });
  await expect.poll(() => activePixels(page)).toBeGreaterThan(0);
  await pointer(page, 'up', { x: 240, y: 120 }, { source: 'touch', id: 1 });
  const after = await layeredState(page);
  expect(after.document.objects).toHaveLength(1);
  expect(after.document.objects[0]).toMatchObject({
    kind: 'freehand',
    resolvedPressureMode: 'simulated',
  });
  expect(after.viewport).toEqual(before.viewport);
  await expect(page.locator('[data-object-id] path').first()).toBeVisible();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await layeredState(page)).document.objects).toHaveLength(0);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect((await layeredState(page)).document.objects).toHaveLength(1);
  await expect(page.getByRole('button', { name: '重做', exact: true })).toBeDisabled();
});

for (const mode of ['auto', 'finger']) {
  test(`second-finger-cancels: ${mode} cancels visible preview before pan and zoom`, async ({
    page,
  }) => {
    await openLayeredEditor(page);
    await page.getByLabel('输入模式').selectOption(mode);
    const before = await layeredState(page);
    await pointer(page, 'down', { x: 100, y: 120 }, { source: 'touch', id: 1 });
    await pointer(page, 'move', { x: 180, y: 140 }, { source: 'touch', id: 1 });
    await expect.poll(() => activePixels(page)).toBeGreaterThan(0);
    await pointer(page, 'down', { x: 280, y: 140 }, { source: 'touch', id: 2 });
    await expect.poll(() => activePixels(page)).toBe(0);
    await pointer(page, 'move', { x: 140, y: 170 }, { source: 'touch', id: 1 });
    await pointer(page, 'move', { x: 380, y: 190 }, { source: 'touch', id: 2 });
    const pair = await layeredState(page);
    expect(pair.viewport.viewport.scale).toBeGreaterThan(before.viewport.viewport.scale);
    expect(pair.viewport.viewport.tx).not.toBe(before.viewport.viewport.tx);
    expect(pair.viewport.viewport.ty).not.toBe(before.viewport.viewport.ty);
    await pointer(page, 'up', { x: 140, y: 170 }, { source: 'touch', id: 1 });
    await pointer(page, 'move', { x: 480, y: 220 }, { source: 'touch', id: 2 });
    await pointer(page, 'up', { x: 480, y: 220 }, { source: 'touch', id: 2 });
    const after = await layeredState(page);
    expect(after.document).toEqual(before.document);
    expect(after.history).toEqual(before.history);
    expect(after.viewport).toEqual(pair.viewport);
    await expect.poll(() => activePixels(page)).toBe(0);
  });
}

test('auto-pen-latch: valid first down survives detection and only a new controller resets it', async ({
  page,
}) => {
  await openLayeredEditor(page);
  await pointer(page, 'move', { x: 70, y: 70 }, { source: 'pen', id: 8 });
  await page
    .getByRole('button', { name: '自由笔', exact: true })
    .dispatchEvent('pointerdown', { pointerType: 'pen', pointerId: 9, button: 0 });
  expect((await layeredState(page)).input.penSeen).toBe(false);
  await stroke(page, 'touch');
  const before = await layeredState(page);
  await stroke(page, 'pen', 10, 180);
  const detected = await layeredState(page);
  expect(detected.document.objects).toHaveLength(before.document.objects.length + 1);
  expect(detected.input).toEqual({ mode: 'auto', penSeen: true, effectiveTouch: 'pan' });
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBeNull();
  await page.clock.install();
  await page.clock.fastForward('01:00:00');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.getByRole('button', { name: '矩形', exact: true }).click();
  await page.getByRole('button', { name: '自由笔', exact: true }).click();
  await stroke(page, 'touch', 11);
  const after = await layeredState(page);
  expect(after.input).toEqual(detected.input);
  expect(after.document).toEqual(detected.document);
  expect(after.history).toEqual(detected.history);
  expect(after.viewport).not.toEqual(detected.viewport);
  await page.clock.resume();
  await openLayeredEditor(page);
  expect((await layeredState(page)).input).toEqual({
    mode: 'auto',
    penSeen: false,
    effectiveTouch: 'draw',
  });
  await stroke(page, 'touch');
  expect((await layeredState(page)).document.objects).toHaveLength(1);
});

test('forced-finger-override: takes effect immediately and auto retains the original latch', async ({
  page,
}) => {
  await openLayeredEditor(page);
  await stroke(page, 'pen');
  await page.getByLabel('输入模式').selectOption('finger');
  await stroke(page, 'touch', 2, 180);
  await stroke(page, 'pen', 3, 220);
  await stroke(page, 'touch', 4, 260);
  const finger = await layeredState(page);
  expect(finger.document.objects).toHaveLength(4);
  expect(finger.input).toEqual({ mode: 'finger', penSeen: true, effectiveTouch: 'draw' });
  await page.getByLabel('输入模式').selectOption('auto');
  await stroke(page, 'touch', 5);
  expect((await layeredState(page)).document).toEqual(finger.document);
  expect((await layeredState(page)).input.effectiveTouch).toBe('pan');
  await page.getByLabel('输入模式').selectOption('finger');
  await pointer(page, 'down', { x: 100, y: 180 }, { source: 'touch', id: 6 });
  await pointer(page, 'move', { x: 180, y: 200 }, { source: 'touch', id: 6 });
  await expect.poll(() => activePixels(page)).toBeGreaterThan(0);
  await page.getByLabel('输入模式').selectOption('pen');
  await expect.poll(() => activePixels(page)).toBe(0);
  await pointer(page, 'move', { x: 240, y: 220 }, { source: 'touch', id: 6 });
  await page.getByLabel('输入模式').selectOption('finger');
  // A fresh contact works even while the cancelled contact has not lifted yet.
  await stroke(page, 'touch', 7, 320);
  await pointer(page, 'up', { x: 260, y: 240 }, { source: 'touch', id: 6 });
  const after = await layeredState(page);
  expect(after.document.objects).toHaveLength(5);
  expect(after.document.objects.slice(0, 4)).toEqual(finger.document.objects);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await layeredState(page)).document.objects).toEqual(finger.document.objects);
});

async function pair(page: Page, id = 20) {
  await pointer(page, 'down', { x: 100, y: 100 }, { source: 'touch', id });
  await pointer(page, 'down', { x: 200, y: 100 }, { source: 'touch', id: id + 1 });
  await pointer(page, 'move', { x: 300, y: 140 }, { source: 'touch', id: id + 1 });
  await pointer(page, 'up', { x: 100, y: 100 }, { source: 'touch', id });
  await pointer(page, 'up', { x: 300, y: 140 }, { source: 'touch', id: id + 1 });
}

test('forced-pen: single touch pans and palms never move the viewport during or after writing', async ({
  page,
}) => {
  await openLayeredEditor(page);
  await page.getByLabel('输入模式').selectOption('pen');
  const initial = await layeredState(page);
  expect(initial.input.penSeen).toBe(false);
  await stroke(page, 'touch');
  let state = await layeredState(page);
  expect(state.document).toEqual(initial.document);
  expect(state.history).toEqual(initial.history);
  expect(state.viewport).not.toEqual(initial.viewport);
  await pair(page);
  const idle = await layeredState(page);
  expect(idle.viewport.viewport.scale).toBeGreaterThan(state.viewport.viewport.scale);
  await pointer(page, 'down', { x: 100, y: 180 }, { source: 'pen', id: 9 });
  await pointer(page, 'move', { x: 180, y: 200 }, { source: 'pen', id: 9 });
  await pointer(page, 'down', { x: 100, y: 100 }, { source: 'touch', id: 1 });
  await pointer(page, 'down', { x: 200, y: 100 }, { source: 'touch', id: 2 });
  await pointer(page, 'move', { x: 400, y: 220 }, { source: 'touch', id: 2 });
  expect((await layeredState(page)).viewport).toEqual(idle.viewport);
  await pointer(page, 'up', { x: 220, y: 180 }, { source: 'pen', id: 9 });
  await pointer(page, 'move', { x: 40, y: 40 }, { source: 'touch', id: 1 });
  state = await layeredState(page);
  expect(state.document.objects).toHaveLength(1);
  expect(state.viewport).toEqual(idle.viewport);
  await pointer(page, 'up', { x: 40, y: 40 }, { source: 'touch', id: 1 });
  await pointer(page, 'up', { x: 400, y: 220 }, { source: 'touch', id: 2 });
  await pair(page, 30);
  const drained = await layeredState(page);
  expect(drained.viewport.viewport.scale).toBeGreaterThan(idle.viewport.viewport.scale);
  expect(drained.document).toEqual(state.document);
});

for (const operation of ['getItem', 'setItem'] as const) {
  test(`storage-unavailable: ${operation} exception keeps a usable editor`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript((method) => {
      Object.defineProperty(Storage.prototype, method, {
        configurable: true,
        value() {
          throw new DOMException('storage denied', 'SecurityError');
        },
      });
    }, operation);
    await openLayeredEditor(page);
    await expect(page.getByLabel('输入模式')).toHaveValue('auto');
    await page.getByLabel('输入模式').selectOption('finger');
    await stroke(page);
    const state = await layeredState(page);
    expect(state.input.mode).toBe('finger');
    expect(state.document.objects).toHaveLength(1);
    expect(errors).toEqual([]);
  });
}

test('preference-first-frame: restores before input and never restores penSeen', async ({
  page,
}) => {
  await page.addInitScript((storageKey) => {
    if (!sessionStorage.getItem('input-preference-seeded')) {
      localStorage.setItem(storageKey, JSON.stringify('pen'));
      sessionStorage.setItem('input-preference-seeded', '1');
    }
    const observer = new MutationObserver(() => {
      const surface = document.querySelector('[data-input-ready="true"]');
      const menu = document.querySelector<HTMLSelectElement>('[aria-label="输入模式"]');
      if (surface && menu && !window.__inputFirstFrame) {
        window.__inputFirstFrame = {
          surface: surface.getAttribute('data-input-mode'),
          menu: menu.value,
        };
        observer.disconnect();
      }
    });
    observer.observe(document, { childList: true, subtree: true, attributes: true });
  }, key);
  await openLayeredEditor(page);
  expect(await page.evaluate(() => window.__inputFirstFrame)).toEqual({
    surface: 'pen',
    menu: 'pen',
  });
  const before = await layeredState(page);
  await stroke(page);
  const firstTouch = await layeredState(page);
  expect(firstTouch.document).toEqual(before.document);
  expect(firstTouch.viewport).not.toEqual(before.viewport);
  await stroke(page, 'pen', 2);
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBe('"pen"');
  await page.getByLabel('输入模式').selectOption('finger');
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__layeredEditor && window.__inputFirstFrame));
  expect(await page.evaluate(() => window.__inputFirstFrame)).toEqual({
    surface: 'finger',
    menu: 'finger',
  });
  await stroke(page);
  expect((await layeredState(page)).document.objects).toHaveLength(1);
  await page.getByLabel('输入模式').selectOption('auto');
  await stroke(page, 'pen', 3);
  expect((await layeredState(page)).input.penSeen).toBe(true);
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBe('"auto"');
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__layeredEditor));
  expect((await layeredState(page)).input).toEqual({
    mode: 'auto',
    penSeen: false,
    effectiveTouch: 'draw',
  });
  await stroke(page);
  expect((await layeredState(page)).document.objects).toHaveLength(1);
  await page.evaluate((k) => localStorage.setItem(k, '"invalid"'), key);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__layeredEditor && window.__inputFirstFrame));
  expect(await page.evaluate(() => window.__inputFirstFrame)).toEqual({
    surface: 'auto',
    menu: 'auto',
  });
});

for (const mode of ['auto', 'finger', 'pen']) {
  test(`adapter-matrix: ${mode} mouse tools and fixed pair reject pen and third-finger takeover`, async ({
    page,
  }) => {
    await openLayeredEditor(page);
    await page.getByLabel('输入模式').selectOption(mode);
    const initial = await layeredState(page);
    await stroke(page, 'mouse');
    expect((await layeredState(page)).viewport).toEqual(initial.viewport);
    expect((await layeredState(page)).document.objects).toHaveLength(1);
    await page.getByRole('button', { name: '平移', exact: true }).click();
    await stroke(page, 'mouse', 2);
    const panned = await layeredState(page);
    expect(panned.viewport).not.toEqual(initial.viewport);
    expect(panned.document.objects).toHaveLength(1);
    await page.getByRole('button', { name: '自由笔', exact: true }).click();
    await pointer(page, 'down', { x: 100, y: 100 }, { source: 'touch', id: 3 });
    await pointer(page, 'down', { x: 200, y: 100 }, { source: 'touch', id: 4 });
    await pointer(page, 'down', { x: 400, y: 180 }, { source: 'touch', id: 5 });
    await pointer(page, 'down', { x: 100, y: 260 }, { source: 'pen', id: 6 });
    await pointer(page, 'move', { x: 300, y: 140 }, { source: 'touch', id: 4 });
    const paired = await layeredState(page);
    expect(paired.input.penSeen).toBe(true);
    expect(paired.viewport.viewport.scale).toBeGreaterThan(panned.viewport.viewport.scale);
    expect(paired.document).toEqual(panned.document);
    await pointer(page, 'up', { x: 100, y: 100 }, { source: 'touch', id: 3 });
    await pointer(page, 'move', { x: 500, y: 180 }, { source: 'touch', id: 5 });
    await pointer(page, 'move', { x: 340, y: 180 }, { source: 'touch', id: 4 });
    await pointer(page, 'up', { x: 140, y: 260 }, { source: 'pen', id: 6 });
    expect((await layeredState(page)).viewport).toEqual(paired.viewport);
    expect((await layeredState(page)).document).toEqual(panned.document);
    await pointer(page, 'up', { x: 340, y: 180 }, { source: 'touch', id: 4 });
    await pointer(page, 'up', { x: 500, y: 180 }, { source: 'touch', id: 5 });
    await stroke(page, 'pen', 7, 280);
    expect((await layeredState(page)).document.objects).toHaveLength(2);
  });

  test(`adapter-matrix: ${mode} controls and ruler contacts never become a paper second finger`, async ({
    page,
  }) => {
    await openLayeredEditor(page);
    await page.getByLabel('输入模式').selectOption(mode);
    await page.getByLabel('尺子', { exact: true }).check();
    const initial = await layeredState(page);
    await pointer(page, 'down', { x: 100, y: 80 }, { source: 'touch', id: 1 });
    await pointer(page, 'move', { x: 180, y: 80 }, { source: 'touch', id: 1 });
    const beforeOtherOwner = await layeredState(page);
    await page.getByTestId('layered-surface').evaluate((host) => {
      const button = document.createElement('button');
      button.dataset.testid = 'in-surface-control';
      host.append(button);
    });
    await page.getByTestId('in-surface-control').dispatchEvent('pointerdown', {
      pointerId: 2,
      pointerType: 'touch',
      clientX: 400,
      clientY: 400,
      button: 0,
    });
    const center = initial.navigation.ruler.center;
    await pointer(page, 'down', { x: center.x - 50, y: center.y }, { source: 'touch', id: 3 });
    await pointer(page, 'move', { x: center.x + 50, y: center.y + 10 }, { source: 'touch', id: 3 });
    const withRuler = await layeredState(page);
    expect(withRuler.viewport).toEqual(beforeOtherOwner.viewport);
    if (mode !== 'pen') await expect.poll(() => activePixels(page)).toBeGreaterThan(0);
    await pointer(page, 'up', { x: center.x + 50, y: center.y + 10 }, { source: 'touch', id: 3 });
    await pointer(page, 'up', { x: 180, y: 80 }, { source: 'touch', id: 1 });
    expect((await layeredState(page)).document.objects).toHaveLength(mode === 'pen' ? 0 : 1);
  });
}

for (const mode of ['auto', 'finger']) {
  test(`adapter-matrix: ${mode} pen safely preempts a touch stroke`, async ({ page }) => {
    await openLayeredEditor(page);
    await page.getByLabel('输入模式').selectOption(mode);
    const initial = await layeredState(page);
    await pointer(page, 'down', { x: 100, y: 100 }, { source: 'touch', id: 1 });
    await pointer(page, 'move', { x: 180, y: 120 }, { source: 'touch', id: 1 });
    await expect.poll(() => activePixels(page)).toBeGreaterThan(0);
    await stroke(page, 'pen', 2, 200);
    await pointer(page, 'up', { x: 240, y: 120 }, { source: 'touch', id: 1 });
    const state = await layeredState(page);
    expect(state.document.objects).toHaveLength(1);
    const object = state.document.objects[0];
    if (object.kind !== 'freehand') throw new Error('Expected freehand');
    expect(object.samples.every((sample) => sample.source === 'pen')).toBe(true);
    expect(state.viewport).toEqual(initial.viewport);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect((await layeredState(page)).document.objects).toHaveLength(0);
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  });

  for (const [label, tool] of [
    ['矩形', 'rect'],
    ['套索', 'lasso'],
    ['橡皮擦', 'eraser'],
    ['选择', 'selection'],
    ['贝塞尔', 'bezier'],
    ['多边形', 'polygon'],
  ] as const) {
    test(`adapter-matrix: ${mode} ${tool} touch preview cancels before pair navigation`, async ({
      page,
    }) => {
      await openLayeredEditor(page, '&fixture=mixed');
      await page.getByLabel('输入模式').selectOption(mode);
      await page.getByRole('button', { name: label, exact: true }).click();
      const initial = await layeredState(page);
      await pointer(page, 'down', { x: 100, y: 160 }, { source: 'touch', id: 1 });
      await pointer(page, 'move', { x: 220, y: 200 }, { source: 'touch', id: 1 });
      const preview = (await layeredState(page)).preview;
      expect(
        preview.objects.length + preview.path.length + preview.hiddenIds.length
      ).toBeGreaterThan(0);
      await pointer(page, 'down', { x: 320, y: 200 }, { source: 'touch', id: 2 });
      expect((await layeredState(page)).preview).toEqual({ objects: [], hiddenIds: [], path: [] });
      await pointer(page, 'move', { x: 440, y: 240 }, { source: 'touch', id: 2 });
      await pointer(page, 'up', { x: 220, y: 200 }, { source: 'touch', id: 1 });
      await pointer(page, 'up', { x: 440, y: 240 }, { source: 'touch', id: 2 });
      const after = await layeredState(page);
      expect(after.document).toEqual(initial.document);
      expect(after.history).toEqual(initial.history);
      expect(after.viewport.viewport.scale).toBeGreaterThan(initial.viewport.viewport.scale);
    });
  }
}

for (const mode of ['auto', 'finger']) {
  test(`down-role-ownership: ${mode} captured resize handle excludes a paper second finger`, async ({
    page,
  }) => {
    await openLayeredEditor(page);
    await page.getByLabel('输入模式').selectOption(mode);
    await page.getByRole('button', { name: '矩形', exact: true }).click();
    await pointer(page, 'down', { x: 100, y: 100 }, { source: 'mouse', id: 1 });
    await pointer(page, 'move', { x: 200, y: 200 }, { source: 'mouse', id: 1 });
    await pointer(page, 'up', { x: 200, y: 200 }, { source: 'mouse', id: 1 });
    await page.getByRole('button', { name: '选择', exact: true }).click();
    await page.evaluate(() => {
      const editor = window.__layeredEditor!;
      editor.setSelection([editor.getSnapshot('document').objects[0].objectId]);
    });
    const initial = await layeredState(page);
    const handle = page.locator('[data-selection-operation="resize"]');
    await expect(handle).toBeVisible();
    const box = (await handle.boundingBox())!;
    const surface = (await page.getByTestId('layered-surface').boundingBox())!;
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const moved = { x: start.x - surface.x + 50, y: start.y - surface.y + 50 };
    // Hit the real handle on down, then deliver captured events to its host.
    await handle.dispatchEvent('pointerdown', {
      pointerId: -101,
      pointerType: 'touch',
      clientX: start.x,
      clientY: start.y,
      button: 0,
      buttons: 1,
      pressure: 0.5,
    });
    await pointer(page, 'move', moved, { source: 'touch', id: -101 });
    const preview = (await layeredState(page)).preview;
    expect(preview.objects).toHaveLength(1);
    expect(preview.objects[0].transform).not.toEqual(initial.document.objects[0].transform);
    await pointer(page, 'down', { x: 360, y: 240 }, { source: 'touch', id: -102 });
    await pointer(page, 'move', { x: 460, y: 300 }, { source: 'touch', id: -102 });
    const during = await layeredState(page);
    expect(during.preview).toEqual(preview);
    expect(during.document).toEqual(initial.document);
    expect(during.history).toEqual(initial.history);
    expect(during.viewport).toEqual(initial.viewport);
    await pointer(page, 'up', moved, { source: 'touch', id: -101 });
    const committed = await layeredState(page);
    expect(committed.document.objects).toEqual(preview.objects);
    expect(committed.document.documentRevision).toBe(initial.document.documentRevision + 1);
    await pointer(page, 'up', { x: 460, y: 300 }, { source: 'touch', id: -102 });
    const after = await layeredState(page);
    expect(after.document).toEqual(committed.document);
    expect(after.history).toEqual(committed.history);
    expect(after.selection).toEqual(initial.selection);
    expect(after.viewport).toEqual(initial.viewport);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect((await layeredState(page)).document.objects).toEqual(initial.document.objects);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    expect((await layeredState(page)).document.objects).toEqual(committed.document.objects);
    await expect(page.getByRole('button', { name: '重做', exact: true })).toBeDisabled();
  });
}

for (const interruption of ['mode', 'blur', 'hidden'] as const) {
  for (const [label, tool] of [
    ['贝塞尔', 'bezier'],
    ['多边形', 'polygon'],
  ] as const) {
    test(`staged-lifecycle: ${tool} ${interruption} cancels between releases without late commit`, async ({
      page,
    }) => {
      await openLayeredEditor(page);
      await page.getByRole('button', { name: label, exact: true }).click();
      const click = async (x: number, y: number) => {
        await pointer(page, 'down', { x, y }, { source: 'mouse', id: 1 });
        await pointer(page, 'up', { x, y }, { source: 'mouse', id: 1 });
      };
      await pointer(page, 'down', { x: 80, y: 100 }, { source: 'mouse', id: 1 });
      await pointer(page, 'move', { x: 320, y: 100 }, { source: 'mouse', id: 1 });
      await pointer(page, 'up', { x: 320, y: 100 }, { source: 'mouse', id: 1 });
      if (tool === 'polygon') {
        await click(320, 100);
        await click(320, 240);
      }
      const preview = (await layeredState(page)).preview;
      expect(preview.objects.length + preview.path.length).toBeGreaterThan(0);
      if (interruption === 'mode') await page.getByLabel('输入模式').selectOption('finger');
      else
        await page.evaluate((kind) => {
          if (kind === 'blur') window.dispatchEvent(new Event('blur'));
          else {
            Object.defineProperty(document, 'visibilityState', {
              configurable: true,
              value: 'hidden',
            });
            document.dispatchEvent(new Event('visibilitychange'));
            delete (document as unknown as Record<string, unknown>).visibilityState;
            document.dispatchEvent(new Event('visibilitychange'));
          }
        }, interruption);
      expect((await layeredState(page)).preview).toEqual({ objects: [], hiddenIds: [], path: [] });
      await pointer(page, 'up', { x: 320, y: 240 }, { source: 'mouse', id: 1 });
      await page.getByTestId('layered-surface').dispatchEvent('dblclick', { detail: 2 });
      expect((await layeredState(page)).document.objects).toHaveLength(0);
      await click(120, 160);
      await click(240, 180);
      expect((await layeredState(page)).document.objects).toHaveLength(0);
      expect((await layeredState(page)).history.canUndo).toBe(false);
      await click(280, 260);
      if (tool === 'polygon')
        await page.getByTestId('layered-surface').dispatchEvent('dblclick', { detail: 1 });
      const objects = (await layeredState(page)).document.objects;
      expect(objects).toHaveLength(1);
      expect(objects[0]).toMatchObject({ kind: 'shape', shapeType: tool });
      if (objects[0].kind !== 'shape') throw new Error('missing shape');
      expect(objects[0].points[0]).toEqual({ x: 120, y: 160 });
    });
  }

  test(`ruler-lifecycle: ${interruption} isolates old contacts and accepts a fresh pair`, async ({
    page,
  }) => {
    await openLayeredEditor(page);
    await page.evaluate(() =>
      window.__layeredEditor!.setNavigation({
        ruler: { visible: true, center: { x: 200, y: 200 }, rotationRad: 0, height: 80 },
      })
    );
    const initial = await layeredState(page);
    await pointer(page, 'down', { x: 150, y: 200 }, { source: 'touch', id: -201 });
    await pointer(page, 'down', { x: 250, y: 200 }, { source: 'touch', id: -202 });
    if (interruption === 'mode') await page.getByLabel('输入模式').selectOption('finger');
    else
      await page.evaluate((kind) => {
        if (kind === 'blur') window.dispatchEvent(new Event('blur'));
        else {
          Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'hidden',
          });
          document.dispatchEvent(new Event('visibilitychange'));
          delete (document as unknown as Record<string, unknown>).visibilityState;
          document.dispatchEvent(new Event('visibilitychange'));
        }
      }, interruption);
    await pointer(page, 'move', { x: 150, y: 280 }, { source: 'touch', id: -201 });
    await pointer(page, 'move', { x: 250, y: 280 }, { source: 'touch', id: -202 });
    expect((await layeredState(page)).navigation.ruler.center).toEqual({ x: 200, y: 200 });
    await pointer(page, 'down', { x: 150, y: 200 }, { source: 'touch', id: -203 });
    await pointer(page, 'down', { x: 250, y: 200 }, { source: 'touch', id: -204 });
    await pointer(page, 'move', { x: 150, y: 240 }, { source: 'touch', id: -203 });
    await pointer(page, 'move', { x: 250, y: 240 }, { source: 'touch', id: -204 });
    expect((await layeredState(page)).navigation.ruler.center).toEqual({ x: 200, y: 240 });
    await pointer(page, 'up', { x: 150, y: 240 }, { source: 'touch', id: -203 });
    await pointer(page, 'up', { x: 250, y: 240 }, { source: 'touch', id: -204 });
    const after = await layeredState(page);
    expect(after.viewport).toEqual(initial.viewport);
    expect(after.document).toEqual(initial.document);
    expect(after.history).toEqual(initial.history);
  });
}

for (const width of [1366, 390]) {
  test(`adapter-matrix: input menu fits at ${width}px with visible ink`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await openLayeredEditor(page);
    await stroke(page);
    await expect(page.locator('[data-object-id] path').first()).toBeVisible();
    const fits = await page.evaluate(() => {
      const menu = document.querySelector('[aria-label="输入模式"]')!.getBoundingClientRect();
      const surface = document
        .querySelector('[data-testid="layered-surface"]')!
        .getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        menuFits: menu.left >= 0 && menu.right <= innerWidth && menu.bottom <= surface.top,
      };
    });
    expect(fits).toEqual({ overflow: false, menuFits: true });
    await page.screenshot({ path: testInfo.outputPath(`input-mode-${width}.png`) });
  });
}
