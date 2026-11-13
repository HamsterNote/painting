// Production UI trace through Chromium's trusted mouse input channel, including paint.
// Run under DISPLAY (headed); CPU throttle is deliberate, not a device equivalence claim.
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { mkdir, writeFile, cp } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';
import { lassoTrajectory } from './lasso-fixture.mjs';

const label = process.argv[2] ?? 'baseline';
const output = process.env.LASSO_OUTPUT ?? `artifacts/research/lasso-release/${label}`;
const root = process.env.LASSO_EXPORT_ROOT ?? 'apps/playground/dist';
const rate = Number(process.env.LASSO_CPU_RATE ?? 6);
await mkdir(output, { recursive: true });
await cp(root, `${output}/site`, { recursive: true });
const server = spawn(process.execPath, ['scripts/perf/static-spa-server.mjs', '--root', root], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
let browser;
try {
  const lines = createInterface({ input: server.stdout });
  const [line] = await once(lines, 'line');
  lines.close();
  const { port } = JSON.parse(line);
  browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__paintingTestLassoPerf = (detail) =>
      (window.__lassoMarks ??= []).push({ time: performance.now(), ...detail });
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  await writeFile(
    `${output}/environment.json`,
    JSON.stringify(
      {
        label,
        rate,
        browser: browser.version(),
        headless: false,
        display: process.env.DISPLAY,
        cpu: os.cpus()[0].model,
        platform: os.release(),
        node: process.version,
        sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        diff: execFileSync('git', ['diff'], { encoding: 'utf8' }),
        input:
          'CDP mouse, 600 samples/5s, host clock independent of page/rAF; trusted browser events',
        physicalHumanInput: false,
        physicalPresentation: false,
      },
      null,
      2
    )
  );
  for (const scenario of (process.env.LASSO_SCENARIOS ?? 'local,dense').split(',')) {
    for (const count of [0, 500]) {
      await page.goto(
        `http://127.0.0.1:${port}/layered-editor?diagnostics=1&fixture=lasso&lassoCount=${count}&lassoScenario=${scenario}`
      );
      await page.waitForFunction(() => Boolean(window.__layeredEditor));
      for (let round = 0; round < Number(process.env.LASSO_ROUNDS ?? 2); round++) {
        const id = `${scenario}-${count}-r${round}`;
        await page.evaluate(async () => {
          const c = window.__layeredEditor;
          c.setTool('lasso');
          c.setSelection([]);
          await document.fonts.ready;
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          );
          performance.clearMarks();
          window.__lassoMarks = [];
          const host = document.querySelector('[data-testid="layered-surface"]');
          const record = (window.__pointerTrace = {
            events: [],
            frames: [],
            previews: [],
            renders: { ...window.__layeredRenders },
            selectedBeforeUp: [],
            initialDocument: c.getSnapshot('document'),
          });
          const listener = (e) => {
            if (e.type === 'pointerup') record.selectedBeforeUp = [...c.getSnapshot('selection')];
            record.events.push({
              type: e.type,
              time: performance.now(),
              stamp: e.timeStamp,
              trusted: e.isTrusted,
              x: e.clientX,
              y: e.clientY,
            });
            if (e.type !== 'pointermove') performance.mark(`pointer:${e.type}`);
          };
          for (const type of ['pointerdown', 'pointermove', 'pointerup'])
            host.addEventListener(type, listener, true);
          let raf;
          const frame = (t) => {
            record.frames.push(t);
            raf = requestAnimationFrame(frame);
          };
          raf = requestAnimationFrame(frame);
          const observer = new MutationObserver(() => {
            const points = host.querySelector('polyline')?.getAttribute('points');
            record.previews.push({ time: performance.now(), points });
          });
          observer.observe(host, { subtree: true, attributes: true, attributeFilter: ['points'] });
          record.stop = () => {
            cancelAnimationFrame(raf);
            observer.disconnect();
            for (const type of ['pointerdown', 'pointermove', 'pointerup'])
              host.removeEventListener(type, listener, true);
          };
        });
        const rect = await page.getByTestId('layered-surface').boundingBox();
        const points = lassoTrajectory(scenario).map((p) => ({ x: p.x + rect.x, y: p.y + rect.y }));
        await page.bringToFront();
        await page.mouse.move(points[0].x, points[0].y);
        await delay(250);
        const traceEvents = [];
        const collect = ({ value }) => traceEvents.push(...value);
        cdp.on('Tracing.dataCollected', collect);
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
        await cdp.send('Profiler.start');
        await cdp.send('Tracing.start', {
          categories:
            'devtools.timeline,v8.execute,blink.user_timing,cc,benchmark,disabled-by-default-devtools.timeline',
          transferMode: 'ReportEvents',
        });
        const pending = [];
        const sent = [];
        const start = performance.now();
        const send = (type, point, index) => {
          sent.push({ type, index, time: performance.now() - start });
          return cdp.send('Input.dispatchMouseEvent', {
            type,
            ...point,
            button: type === 'mouseMoved' ? 'none' : 'left',
            buttons: type === 'mouseReleased' ? 0 : 1,
            clickCount: type === 'mouseMoved' ? 0 : 1,
          });
        };
        await send('mousePressed', points[0], 0);
        const drawingStart = performance.now();
        for (let i = 1; i < points.length; i++) {
          await delay(Math.max(0, drawingStart + (i * 5000) / 599 - performance.now()));
          pending.push(send('mouseMoved', points[i], i));
        }
        await Promise.all(pending);
        await send('mouseReleased', points.at(-1), 599);
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        );
        const { profile } = await cdp.send('Profiler.stop');
        const completed = once(cdp, 'Tracing.tracingComplete');
        await cdp.send('Tracing.end');
        await completed;
        cdp.off('Tracing.dataCollected', collect);
        const raw = await page.evaluate(() => {
          const r = window.__pointerTrace,
            c = window.__layeredEditor;
          r.stop();
          return {
            events: r.events,
            frames: r.frames,
            previews: r.previews,
            selectedBeforeUp: r.selectedBeforeUp,
            selected: c.getSnapshot('selection'),
            unchangedDocument: r.initialDocument === c.getSnapshot('document'),
            objectCount: c.getSnapshot('document').objects.length,
            renders: {
              display: window.__layeredRenders.display - r.renders.display,
              objects: window.__layeredRenders.objects - r.renders.objects,
            },
            marks: window.__lassoMarks,
          };
        });
        await writeFile(`${output}/${id}.json`, JSON.stringify({ ...raw, sent, errors }));
        await writeFile(`${output}/${id}.trace.json`, JSON.stringify({ traceEvents }));
        await writeFile(`${output}/${id}.cpuprofile`, JSON.stringify(profile));
        await page.screenshot({ path: `${output}/${id}.png` });
        console.log(
          JSON.stringify({
            id,
            events: raw.events.length,
            queries: raw.marks.filter((m) => m.event === 'query-start').length,
            selected: raw.selected.length,
            renders: raw.renders,
            errors,
          })
        );
      }
    }
  }
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await once(server, 'exit');
}
