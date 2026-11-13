// Real CDP input and UA-generated capture events; no synthetic DOM pointer events.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const [url = 'http://127.0.0.1:6273', output = 'artifacts/research/lasso-capture/browser-before'] =
  process.argv.slice(2);
await mkdir(output, { recursive: true });
const executablePath = resolve(
  process.env.LASSO_CHROMIUM_EXECUTABLE ??
    'artifacts/research/lasso-capture/browser/chrome-linux64/chrome'
);
const xroot = resolve(process.env.LASSO_X11_ROOT ?? 'artifacts/research/lasso-release/x11/root');
const display = process.env.LASSO_X_DISPLAY ?? ':251';
const xvfb = spawn(
  `${xroot}/usr/bin/Xvfb`,
  [display, '-screen', '0', '1400x900x24', '-nolisten', 'tcp', '-ac'],
  {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, LD_LIBRARY_PATH: `${xroot}/usr/lib/x86_64-linux-gnu` },
  }
);
let browser;
const results = [];
try {
  await delay(500);
  if (xvfb.exitCode !== null) throw new Error('Xvfb exited before readiness');
  browser = await chromium.launch({
    executablePath,
    headless: false,
    env: { ...process.env, DISPLAY: display },
    args: ['--no-sandbox'],
  });
  assert.equal(browser.version().split('.')[0], process.env.LASSO_EXPECT_MAJOR ?? '156');
  for (const mode of ['normal', 'explicit-release', 'buttons-zero', 'capture-transfer']) {
    const context = await browser.newContext({ viewport: { width: 1304, height: 703 } });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.__captureEvents = [];
      let originalHost;
      const record = (e) => window.__captureEvents.push({ ...e, at: performance.now() });
      window.__paintingTestLassoPerf = (e) => record({ kind: 'query', ...e });
      for (const name of ['setPointerCapture', 'releasePointerCapture']) {
        const method = Element.prototype[name];
        Element.prototype[name] = function (id) {
          record({
            kind: 'api',
            name,
            id,
            originalHost: this === originalHost,
            connected: this.isConnected,
            stack: new Error().stack,
          });
          return method.call(this, id);
        };
      }
      for (const type of [
        'pointerdown',
        'pointermove',
        'pointerup',
        'pointercancel',
        'gotpointercapture',
        'lostpointercapture',
      ])
        window.addEventListener(
          type,
          (event) => {
            const host = document.querySelector('[data-testid="layered-surface"]');
            if (type === 'pointerdown' && host?.contains(event.target)) originalHost = host;
            if (!originalHost) return;
            record({
              kind: 'pointer',
              type,
              id: event.pointerId,
              source: event.pointerType,
              trusted: event.isTrusted,
              buttons: event.buttons,
              pressure: event.pressure,
              captured: originalHost.hasPointerCapture(event.pointerId),
              sameHost: host === originalHost,
              connected: originalHost.isConnected,
              target: event.target === originalHost ? 'original-host' : event.target?.tagName,
              x: event.clientX,
              y: event.clientY,
            });
          },
          true
        );
    });
    await page.goto(`${url}/layered-editor?fixture=lasso&lassoCount=500&touchDraw=1&lassoPerf=1`);
    await page.waitForFunction(() => Boolean(window.__layeredEditor));
    await page.getByRole('button', { name: '套索', exact: true }).click();
    await page.evaluate(() => {
      window.__captureEvents = [];
    });
    const cdp = await context.newCDPSession(page);
    const points = Array.from({ length: 40 }, (_, i) => ({
      x: 220 + 180 * Math.cos((i * Math.PI * 2) / 39),
      y: 200 + 120 * Math.sin((i * Math.PI * 2) / 39),
    }));
    const send = (type, p, buttons, button = buttons ? 'left' : 'none') =>
      cdp.send('Input.dispatchMouseEvent', {
        type,
        ...p,
        buttons,
        button,
        force: buttons ? 0.5 : 0,
        clickCount: 1,
      });
    await send('mouseMoved', points[0], 0);
    await send('mousePressed', points[0], 1, 'left');
    for (const p of points.slice(1, 20)) await send('mouseMoved', p, 1);
    if (mode === 'explicit-release' || mode === 'capture-transfer') {
      await page.evaluate((mode) => {
        const host = document.querySelector('[data-testid="layered-surface"]');
        const id = window.__captureEvents.find((e) => e.type === 'pointerdown').id;
        if (mode === 'explicit-release') host.releasePointerCapture(id);
        else document.body.setPointerCapture(id);
      }, mode);
    }
    // Continue the second half of the geometry after losing/transferring capture.
    for (const p of points.slice(20)) await send('mouseMoved', p, 1);
    const dragQueries = await page.evaluate(
      () => window.__captureEvents.filter((e) => e.event === 'query-start').length
    );
    const last = points.at(-1);
    if (mode === 'buttons-zero') await send('mouseMoved', last, 0);
    await send('mouseReleased', last, 0, 'left');
    await page.waitForFunction(() =>
      window.__captureEvents.some((e) => e.event === 'selection-submit' || e.event === 'cancel')
    );
    // Permit a duplicate terminal input and post-up capture release to expose double submission.
    await send('mouseReleased', last, 0, 'left');
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    );
    const state = await page.evaluate(() => ({
      selected: [...window.__layeredEditor.getSnapshot('selection')],
      revision: window.__layeredEditor.getSnapshot('document').documentRevision,
      events: window.__captureEvents,
    }));
    const count = (event) => state.events.filter((e) => e.event === event).length;
    const result = {
      mode,
      browser: browser.version(),
      url,
      executablePath,
      headed: true,
      dragQueries,
      starts: count('query-start'),
      completes: count('query-complete'),
      submits: count('selection-submit'),
      cancels: count('cancel'),
      errors,
      ...state,
    };
    results.push(result);
    await writeFile(`${output}/${mode}.json`, JSON.stringify(result, null, 2));
    assert.equal(dragQueries, 0);
    assert.deepEqual(errors, []);
    const lost = state.events.find((e) => e.type === 'lostpointercapture');
    assert(lost?.trusted && lost.sameHost && lost.connected);
    const lossIndex = state.events.indexOf(lost);
    const upIndex = state.events.findIndex((e) => e.type === 'pointerup');
    assert.equal(lossIndex < upIndex, mode !== 'normal');
    if (mode === 'buttons-zero') {
      const beforeLoss = state.events.slice(0, lossIndex);
      assert.equal(beforeLoss.filter((e) => e.name === 'setPointerCapture').length, 1);
      assert.equal(beforeLoss.filter((e) => e.name === 'releasePointerCapture').length, 0);
      assert.equal(lost.buttons, 0);
    }
    if (process.env.LASSO_EXPECT_FIXED === '1' || mode === 'normal') {
      assert.equal(result.submits, 1);
      assert.equal(result.starts, 1);
      assert.equal(result.completes, 1);
      assert.equal(result.cancels, 0);
      assert.equal(result.selected.length, 115);
      await page.getByLabel('缩放选区').waitFor();
    }
    console.log(JSON.stringify({ ...result, events: undefined, selected: result.selected.length }));
    await context.close();
  }
} finally {
  await writeFile(
    `${output}/summary.json`,
    JSON.stringify(
      results.map(({ events, ...r }) => r),
      null,
      2
    )
  );
  await browser?.close();
  if (xvfb.exitCode === null) {
    const exited = once(xvfb, 'exit');
    xvfb.kill('SIGTERM');
    await exited;
  }
}
