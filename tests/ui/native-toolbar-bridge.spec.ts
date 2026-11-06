import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { openLayeredEditor } from './layered-helpers';

// Browser contract test only: this substitutes the native transport, never HID
// acceptance. Keep the original toolbar specs and Mac observers unchanged.
const require = createRequire(import.meta.url);
const { transformSync } = require('@babel/core');
const appRequire = createRequire(path.resolve('apps/playground/package.json'));
const tabbable = readFileSync(appRequire.resolve('tabbable/dist/index.umd.js'), 'utf8');
const helper = transformSync(
  readFileSync('apps/playground/src/layered-editor/nativeToolbarKeyboard.ts', 'utf8'),
  {
    filename: 'bridge.ts',
    configFile: false,
    babelrc: false,
    presets: ['@babel/preset-typescript'],
  }
)
  .code.replace("import { tabbable } from 'tabbable';", 'const { tabbable } = window.tabbable;')
  .replace('export function', 'function');

async function install(page: Page) {
  await page.addScriptTag({ content: tabbable });
  await page.addScriptTag({
    content: `(() => { ${helper}\n
    window.bridgeScope = ''; window.bridgeSequence = 0; window.bridgeEvents = [];
    installNativeToolbarKeyboard(document, async scope => { window.bridgeScope = scope; });
    document.addEventListener('keydown', e => window.bridgeEvents.push({key:e.key, trusted:e.isTrusted}));
  })();`,
  });
}
async function key(page: Page, key: string, shiftKey = false) {
  return page.evaluate(
    ({ key, shiftKey }) => {
      const w = window as any;
      return w.__paintingToolbarKeyboard.receive({
        scope: w.bridgeScope,
        sequence: ++w.bridgeSequence,
        key,
        shiftKey,
        source: 'ios-key-command',
      });
    },
    { key, shiftKey }
  );
}

for (const trigger of ['工具菜单', '缩放比例', '设置']) {
  test(`bridge contract: ${trigger} Escape restores focus; both Tab directions exit`, async ({
    page,
  }) => {
    await openLayeredEditor(page);
    await install(page);
    const button = page.getByRole('button', { name: trigger, exact: true });
    const panel = page.locator('.hn-painting-panel');
    await button.click();
    await expect(panel).toBeVisible();
    expect(await key(page, 'Escape')).toBe(true);
    await expect(panel).toHaveCount(0);
    await expect(button).toBeFocused();
    for (const shift of [false, true]) {
      await button.click();
      await expect(panel).toBeVisible();
      for (let i = 0; i < 25 && (await panel.count()); i++) {
        expect(await key(page, 'Tab', shift)).toBe(true);
      }
      await expect(panel).toHaveCount(0);
    }
    const events = await page.evaluate(() => (window as any).bridgeEvents);
    expect(events.length).toBeGreaterThan(2);
    expect(events.every((e: { trusted: boolean }) => !e.trusted)).toBe(true);
  });
}

test('color field preserves a single trusted Tab and traverses range/selected radio', async ({
  page,
}) => {
  // Isolated browser contract fixture; this does not run or replace the Mac matrix.
  await page.setContent(`<div class="hn-painting-panel">
    <input type="radio" name="mode" aria-label="Auto">
    <input type="radio" name="mode" aria-label="Finger" checked>
    <input type="text" data-toolbar-color-field="true" aria-label="Color" value="#123456">
    <input type="range" aria-label="Opacity"><input type="checkbox" aria-label="Ruler">
  </div><textarea aria-label="Document text"></textarea>`);
  await install(page);
  const color = page.getByRole('textbox', { name: 'Color', exact: true });
  await color.click();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('slider')).toBeFocused();
  expect(await page.evaluate(() => (window as any).bridgeScope)).not.toBe('');
  await color.click();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('radio', { name: 'Finger' })).toBeFocused();
  expect(await page.evaluate(() => (window as any).bridgeEvents)).toEqual([
    { key: 'Tab', trusted: true },
    { key: 'Shift', trusted: true },
    { key: 'Tab', trusted: true },
  ]);
  await page.getByRole('textbox', { name: 'Document text' }).click();
  await page.keyboard.type('a');
  await expect(page.getByRole('textbox', { name: 'Document text' })).toHaveValue('a');
  expect(await page.evaluate(() => (window as any).bridgeScope)).toBe('');
});

test('touch drag from a focused color editor changes range and hands focus over after release outside', async ({
  page,
}) => {
  await page.setContent(`<style>
    .hn-painting-panel { width: 400px; padding: 30px; }
    input { display:block; margin:20px; }
    input[type=range] { width:300px; height:44px; touch-action:none; }
  </style><div class="hn-painting-panel">
    <input type="text" data-toolbar-color-field="true" aria-label="Color" value="#123456">
    <input type="range" aria-label="Opacity" min="0" max="1" step="0.01" value="0.95">
    <input type="checkbox" aria-label="Ruler">
  </div><textarea aria-label="Document text"></textarea>`);
  await install(page);
  const color = page.getByRole('textbox', { name: 'Color', exact: true });
  const range = page.getByRole('slider');
  await color.click();
  await page.evaluate(() => {
    (window as any).dragEvents = [];
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'input', 'change']) {
      document.addEventListener(type, (event) => {
        (window as any).dragEvents.push({
          type,
          trusted: event.isTrusted,
          active: document.activeElement?.getAttribute('aria-label'),
          value: (event.target as HTMLInputElement).value,
        });
      });
    }
  });
  const box = (await range.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  try {
    const touch = async (type: 'touchStart' | 'touchMove', x: number, y: number) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [{ x, y, id: 1 }] });
    const y = box.y + box.height / 2;
    await touch('touchStart', box.x + 8 + (box.width - 16) * 0.95, y);
    await expect(color).toBeFocused(); // Exercise WebKit's retained editing focus, not BODY.
    for (const value of [0.8, 0.6, 0.45, 0.25, 0.1])
      await touch('touchMove', box.x + 8 + (box.width - 16) * value, y);
    await touch('touchMove', box.x + 8 + (box.width - 16) * 0.1, box.y + box.height + 20);
    await expect(color).toBeFocused();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await cdp.detach();
  }
  await expect(range).toBeFocused();
  await expect(range).toHaveValue('0.1');
  const events = await page.evaluate(() => (window as any).dragEvents);
  expect(events.filter((event: { type: string }) => event.type === 'pointercancel')).toHaveLength(
    0
  );
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: 'pointerdown', active: 'Color', trusted: true }),
      expect.objectContaining({ type: 'pointerup', active: 'Color', trusted: true }),
      expect.objectContaining({ type: 'change', value: '0.1', trusted: true }),
    ])
  );
  expect(
    await page.evaluate(() => (window as any).__paintingToolbarKeyboard.snapshot())
  ).toMatchObject({ tabOnly: false, acknowledgedTabOnly: false });
  expect(await key(page, 'Tab')).toBe(true);
  await expect(page.getByRole('checkbox')).toBeFocused();
});

for (const type of ['radio', 'checkbox'] as const) {
  test(`UIKit compatibility replay: ${type} restores again after pointerup focus is blurred by mousedown`, async ({
    page,
  }) => {
    await page.setContent(`<div class="hn-painting-panel">
      <input type="text" data-toolbar-color-field="true" aria-label="Color" value="#123456">
      <input id="control" type="${type}" aria-label="Control">
      <button>Next</button>
    </div>`);
    await install(page);
    await page.getByRole('textbox').focus();
    const control = page.getByRole(type, { name: 'Control' });
    // Chromium does not implement UIKit's delayed compatibility-mouse blur.
    // Replay that recorded ordering explicitly; only product code restores
    // focus. These fixture events are not native HID acceptance evidence.
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('#control')!;
      (window as any).compatibilityEvents = [];
      for (const type of ['pointerup', 'focusin', 'mousedown', 'focusout', 'click', 'change']) {
        document.addEventListener(type, () => {
          (window as any).compatibilityEvents.push({
            type,
            active: document.activeElement === input ? 'control' : document.activeElement?.tagName,
          });
        });
      }
      for (const type of ['pointerdown', 'pointerup'])
        input.dispatchEvent(
          new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch' })
        );
    });
    await expect(control).toBeFocused(); // The pointerup RAF has already run.
    expect(await page.evaluate(() => (window as any).bridgeScope)).not.toBe('');
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('#control')!;
      input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, detail: 1 }));
      input.blur(); // Replay the observed UIKit default, never supply the correct focus.
    });
    await expect(page.locator('body')).toBeFocused();
    await expect.poll(() => page.evaluate(() => (window as any).bridgeScope)).toBe('');
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('#control')!;
      for (const type of ['mouseup', 'click'])
        input.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, detail: 1 }));
    });
    await expect(control).toBeFocused(); // Requires the post-click restoration too.
    await expect(control).toBeChecked(); // Preserve the click's default value update.
    const state = await page.evaluate(() => (window as any).__paintingToolbarKeyboard.snapshot());
    expect(state.scope).not.toBe('');
    expect(state.acknowledgedScope).toBe(state.scope);
    expect(await page.evaluate(() => (window as any).compatibilityEvents)).toEqual([
      { type: 'pointerup', active: 'INPUT' },
      { type: 'focusout', active: 'BODY' },
      { type: 'focusin', active: 'control' },
      { type: 'mousedown', active: 'control' },
      { type: 'focusout', active: 'BODY' },
      { type: 'click', active: 'BODY' },
      { type: 'change', active: 'BODY' },
      { type: 'focusin', active: 'control' },
    ]);
    expect(await key(page, 'Tab')).toBe(true);
    await expect(page.getByRole('button', { name: 'Next' })).toBeFocused();
  });
}
