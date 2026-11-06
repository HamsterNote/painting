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
