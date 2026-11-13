// Trusted Chrome 156 input. Drop one real terminal event at the window boundary
// to reproduce a lost terminal; all geometry and the next gesture remain CDP input.
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const [url = 'http://127.0.0.1:6276', output = 'artifacts/research/lasso-owner/recovery156'] =
  process.argv.slice(2);
await mkdir(output, { recursive: true });
const oracle = await build({
  entryPoints: ['scripts/perf/lasso-recording-oracle.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: '__recordingOracle',
  platform: 'browser',
});
const browser = await chromium.launch({
  executablePath: resolve(
    process.env.LASSO_CHROMIUM_EXECUTABLE ??
      'artifacts/research/lasso-capture/browser/chrome-linux64/chrome'
  ),
  headless: true,
  args: ['--no-sandbox'],
});
try {
  assert.equal(browser.version(), '156.0.8078.80');
  for (const source of ['mouse', 'pen', 'touch']) {
    const context = await browser.newContext({
      viewport: { width: 1304, height: 703 },
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__ownerEvents = [];
      window.__dropOwnerUp = false;
      window.__paintingTestLassoPerf = (e) => window.__ownerEvents.push({ kind: 'query', ...e });
      for (const type of [
        'pointerdown',
        'pointermove',
        'pointerup',
        'pointercancel',
        'lostpointercapture',
      ]) {
        window.addEventListener(
          type,
          (e) => {
            const host = document.querySelector('[data-testid="layered-surface"]');
            if (!host) return;
            const rect = host.getBoundingClientRect();
            window.__ownerEvents.push({
              kind: 'pointer',
              type,
              id: e.pointerId,
              source: e.pointerType,
              primary: e.isPrimary,
              trusted: e.isTrusted,
              x: e.clientX - rect.left,
              y: e.clientY - rect.top,
              dropped: type === 'pointerup' && window.__dropOwnerUp,
            });
            if (type === 'pointerup' && window.__dropOwnerUp) {
              window.__dropOwnerUp = false;
              e.stopImmediatePropagation();
            }
          },
          true
        );
      }
    });
    await page.goto(`${url}/layered-editor?fixture=lasso&lassoCount=500&touchDraw=1&lassoPerf=1`);
    await page.waitForFunction(() => Boolean(window.__layeredEditor));
    await page.getByRole('button', { name: '套索', exact: true }).click();
    await page.addScriptTag({ content: oracle.outputFiles[0].text });
    await page.evaluate(() => {
      window.__ownerEvents = [];
    });
    const cdp = await context.newCDPSession(page);
    const points = Array.from({ length: 40 }, (_, i) => ({
      x: Math.round(220 + 180 * Math.cos((i * Math.PI * 2) / 39)),
      y: Math.round(200 + 120 * Math.sin((i * Math.PI * 2) / 39)),
    }));
    const send = async (phase, point) => {
      if (source === 'touch')
        await cdp.send('Input.dispatchTouchEvent', {
          type: { down: 'touchStart', move: 'touchMove', up: 'touchEnd' }[phase],
          touchPoints: phase === 'up' ? [] : [{ ...point, id: 1 }],
        });
      else
        await cdp.send('Input.dispatchMouseEvent', {
          type: { down: 'mousePressed', move: 'mouseMoved', up: 'mouseReleased' }[phase],
          ...point,
          pointerType: source,
          buttons: phase === 'up' ? 0 : 1,
          button: phase === 'move' ? 'none' : 'left',
          clickCount: 1,
          force: phase === 'up' ? 0 : 0.5,
        });
    };
    await send('down', points[0]);
    await send('move', points[1]);
    await page.evaluate(() => {
      const id = window.__ownerEvents.find((e) => e.type === 'pointerdown').id;
      document.querySelector('[data-testid="layered-surface"]').releasePointerCapture(id);
      window.__dropOwnerUp = true;
    });
    await send('move', points[2]);
    await send('up', points[2]);
    assert.equal(
      await page.evaluate(() => window.__ownerEvents.filter((e) => e.event === 'cancel').length),
      0
    );
    assert.equal(
      await page.evaluate(
        () => window.__ownerEvents.filter((e) => e.event === 'query-start').length
      ),
      0
    );
    await send('down', points[0]);
    for (const point of points.slice(1)) await send('move', point);
    await send('up', points.at(-1));
    await page.waitForFunction(() =>
      window.__ownerEvents.some((e) => e.event === 'selection-submit')
    );
    const result = await page.evaluate(() => {
      const events = window.__ownerEvents;
      const downs = events.filter((e) => e.type === 'pointerdown');
      const second = events.indexOf(downs[1]);
      const viewport = window.__layeredEditor.getSnapshot('viewport').viewport;
      const path = events
        .slice(second)
        .filter((e) => ['pointerdown', 'pointermove', 'pointerup'].includes(e.type))
        .map((e) => ({
          x: (e.x - viewport.tx) / viewport.scale,
          y: (e.y - viewport.ty) / viewport.scale,
        }));
      return {
        events,
        downs,
        selected: [...window.__layeredEditor.getSnapshot('selection')],
        oracle: window.__recordingOracle.query(
          window.__layeredEditor.getSnapshot('document'),
          path
        ),
      };
    });
    const count = (name) => result.events.filter((e) => e.event === name).length;
    assert.equal(result.downs.length, 2);
    assert(result.downs.every((e) => e.trusted && e.primary && e.source === source));
    assert(result.events.some((e) => e.type === 'lostpointercapture' && e.trusted));
    assert.equal(result.events.filter((e) => e.dropped).length, 1);
    assert.equal(count('cancel'), 1);
    for (const name of ['query-start', 'query-complete', 'selection-submit'])
      assert.equal(count(name), 1);
    assert(result.selected.length > 0);
    assert.deepEqual(result.selected, result.oracle);
    await writeFile(
      `${output}/${source}.json`,
      JSON.stringify({ browser: browser.version(), ...result }, null, 2)
    );
    console.log(
      JSON.stringify({
        source,
        browser: browser.version(),
        downs: result.downs.length,
        cancels: count('cancel'),
        starts: count('query-start'),
        completes: count('query-complete'),
        submits: count('selection-submit'),
        selected: result.selected.length,
        oracleEqual: true,
      })
    );
    await context.close();
  }
} finally {
  await browser.close();
}
