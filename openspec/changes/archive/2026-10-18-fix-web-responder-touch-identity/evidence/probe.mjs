import { chromium, devices } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const results = [];
const baseline = process.argv.includes('--baseline');
const noDiagnostics = process.argv.includes('--no-diagnostics');
try {
  for (const ids of baseline ? [[1, 2]] : [[1, 21], [21, 41], [-1, -2]]) {
    const diagnostics = !noDiagnostics;
    const context = await browser.newContext({ ...devices['iPad (gen 7)'] });
    await context.addInitScript(() => {
      window.__ham50 = { logs: [], events: [] };
      for (const level of ['warn', 'error']) {
        const original = console[level];
        console[level] = function (...args) {
          window.__ham50.logs.push({ level, args: args.map(String), stack: new Error().stack, time: performance.now() });
          return original.apply(this, args);
        };
      }
      for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'pointerdown', 'pointerup', 'pointercancel']) {
        window.addEventListener(type, (e) => window.__ham50.events.push({ type, time: performance.now(), trusted: e.isTrusted, pointerId: e.pointerId, pointerType: e.pointerType, touches: e.touches && Array.from(e.touches, t => ({ id: t.identifier, x: t.clientX, y: t.clientY })), changed: e.changedTouches && Array.from(e.changedTouches, t => t.identifier) }), true);
      }
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.stack));
    await page.goto(`http://127.0.0.1:5266/layered-editor${diagnostics ? '?diagnostics=1&traceGestures=1' : ''}`, { timeout: 120000 });
    const surface = page.getByTestId('layered-surface');
    await surface.waitFor({ timeout: 120000 });
    await page.waitForFunction(() => document.querySelector('[data-testid="layered-surface"]')?.dataset.inputArbiter === 'ready');
    const box = await surface.boundingBox();
    const cdp = await context.newCDPSession(page);
    const a = { x: box.x + 120, y: box.y + 120, id: ids[0] };
    const b = { x: box.x + 260, y: box.y + 130, id: ids[1] };
    const c = { x: box.x + 360, y: box.y + 180, id: 3 };
    const send = async (type, touchPoints) => { await cdp.send('Input.dispatchTouchEvent', { type, touchPoints }); };
    const scenarios = [];
    for (const mode of ['auto', 'finger', 'pen']) {
      await page.getByLabel('输入模式').selectOption(mode);
      for (let iteration = 0; iteration < (baseline ? 5 : 1); iteration++) {
        for (const reverse of [false, true]) {
          scenarios.push({ mode, iteration, reverse, start: await page.evaluate(() => performance.now()) });
          await send('touchStart', [a]);
          await send('touchMove', [{ ...a, x: a.x + 30 }]);
          await send('touchStart', [a, b]);
          await send('touchMove', [{ ...a, x: a.x - 20 }, { ...b, x: b.x + 50 }]);
          await send('touchEnd', [reverse ? a : b]);
          await send('touchMove', [{ ...(reverse ? a : b), y: a.y + 60 }]);
          await send('touchEnd', []);
          await send('touchStart', [a, b]);
          await send('touchStart', [a, b, c]);
          await send('touchMove', [a, { ...b, x: b.x + 40 }, c]);
          await send('touchEnd', [b, c]);
          await send('touchEnd', [c]);
          await send('touchEnd', []);
          await send('touchStart', [a, b]);
          await send('touchCancel', []);
        }
      }
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, pointerType: 'pen', force: 0.6 });
      await send('touchStart', [a, b]);
      await send('touchMove', [{ ...a, x: a.x + 25 }, { ...b, x: b.x + 50 }]);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: a.x + 50, y: a.y, button: 'left', buttons: 0, pointerType: 'pen' });
      await send('touchEnd', [b]);
      await send('touchEnd', []);
    }
    await page.screenshot({ path: `ham50-ids-${ids.join('_')}.png`, fullPage: true });
    results.push({ ids, diagnostics, box, scenarios, pageErrors, capture: await page.evaluate(() => window.__ham50), text: await page.locator('body').innerText(), trace: await page.evaluate(() => window.__layeredGestureTrace?.snapshot()) });
    console.log(JSON.stringify({ ids, errorCount: results.at(-1).capture.logs.length, firstError: results.at(-1).capture.logs[0], eventCount: results.at(-1).capture.events.length, pageErrors }));
    await context.close();
  }
} finally {
  await writeFile(noDiagnostics ? 'ham50-no-diagnostics-evidence.json' : baseline ? 'ham50-baseline-rerun.json' : 'ham50-identifier-evidence.json', JSON.stringify(results, null, 2));
  await browser.close();
}
