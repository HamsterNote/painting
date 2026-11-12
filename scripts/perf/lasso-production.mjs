import { chromium, webkit } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, cp } from 'node:fs/promises';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import os from 'node:os';
import { lassoFixture, lassoTrajectory } from './lasso-fixture.mjs';

const label = process.argv[2] ?? 'baseline';
const engine = process.env.LASSO_BROWSER ?? 'chromium';
const output = `artifacts/research/lasso/${label}-${engine}`;
await mkdir(output, { recursive: true });
await cp('apps/playground/dist/_expo/static/js/web', `${output}/bundles`, { recursive: true });
const server = spawn(process.execPath, ['scripts/perf/static-spa-server.mjs'], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
let browser;
try {
  const lines = createInterface({ input: server.stdout });
  const [line] = await once(lines, 'line');
  const { port } = JSON.parse(line);
  lines.close();
  browser = await (engine === 'webkit' ? webkit : chromium).launch({
    headless: true,
    args: engine === 'chromium' ? ['--no-sandbox'] : [],
  });
  const abort = () => {
    void browser.close();
  };
  process.once('SIGTERM', abort);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error('PAGE ERROR', error.message));
  const metadata = {
    label,
    engine,
    browser: browser.version(),
    platform: os.platform(),
    release: os.release(),
    cpu: os.cpus()[0].model,
    cores: os.cpus().length,
    node: process.version,
    sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    diff: execFileSync('git', ['diff', '--stat'], { encoding: 'utf8' }),
    command: process.argv.join(' '),
    viewport: { width: 1280, height: 800 },
    dpr: 1,
    seed: 245,
    input:
      'synthetic pen PointerEvent; 600 points / 5s; independent setTimeout; overdue samples coalesced; never rAF-paced',
    physicalPresentation: false,
  };
  await writeFile(`${output}/environment.json`, JSON.stringify(metadata, null, 2));
  const results = [];
  const scenarios = process.env.LASSO_SCENARIOS?.split(',') ?? ['local', 'dense', 'mixed'];
  const counts = process.env.LASSO_COUNTS?.split(',').map(Number) ?? [100, 500, 1000];
  const rounds = Number(process.env.LASSO_ROUNDS ?? 7);
  for (const scenario of scenarios) {
    const populations = scenario === 'mixed' ? [500] : counts;
    for (const count of populations)
      for (let round = 0; round < rounds; round++) {
        // Alternate empty/populated order, keeping every matching empty control.
        for (const n of round % 2 ? [count, 0] : [0, count]) {
          const id = `${scenario}-${n}-pair${count}-r${round}`;
          console.error('Starting', id);
          await page.goto(
            `http://127.0.0.1:${port}/layered-editor?diagnostics=1&fixture=lasso&lassoCount=${n}&lassoScenario=${n ? scenario : 'empty'}`
          );
          await page.waitForFunction(() => Boolean(window.__layeredEditor));
          const fixture = lassoFixture(n, n ? scenario : 'empty');
          await page.evaluate(async (fixture) => {
            const c = window.__layeredEditor;
            c.setTool('lasso');
            await document.fonts.ready;
            await Promise.all(
              fixture.objects
                .filter((o) => o.kind === 'image')
                .map(
                  (o) =>
                    new Promise((resolve, reject) => {
                      const image = new Image();
                      image.onload = resolve;
                      image.onerror = reject;
                      image.src = o.src;
                    })
                )
            );
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve))
            );
            if (document.querySelectorAll('[data-object-id]').length !== fixture.objects.length)
              throw new Error('fixture not mounted');
          }, fixture);
          console.error('Fixture ready', id);
          let cdp;
          const traceEvents = [];
          const profile = engine === 'chromium' && round === rounds - 1;
          if (profile) {
            cdp = await context.newCDPSession(page);
            cdp.on('Tracing.dataCollected', ({ value }) => traceEvents.push(...value));
            await cdp.send('Profiler.enable');
            await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
            await cdp.send('Profiler.start');
            await cdp.send('Tracing.start', {
              categories:
                'devtools.timeline,v8.execute,blink.user_timing,disabled-by-default-devtools.timeline',
              transferMode: 'ReportEvents',
            });
          }
          const raw = await Promise.race([
            page.evaluate(async (points) => {
              const c = window.__layeredEditor;
              const host = document.querySelector('[data-testid="layered-surface"]');
              const rect = host.getBoundingClientRect();
              const frames = [],
                idle = [],
                inputs = [],
                preview = [],
                selection = [],
                methods = [],
                scans = [];
              let running = true,
                current = -1;
              const idleFrame = (t) => {
                idle.push(t);
                if (idle.length < 40) requestAnimationFrame(idleFrame);
              };
              requestAnimationFrame(idleFrame);
              while (idle.length < 40) await new Promise((r) => setTimeout(r, 20));
              const restorers = [];
              for (const name of ['setSelection', 'setPreview']) {
                const original = c[name];
                c[name] = function (...args) {
                  const start = performance.now();
                  const result = original.apply(this, args);
                  methods.push({ name, start, duration: performance.now() - start });
                  return result;
                };
                restorers.push(() => {
                  c[name] = original;
                });
              }
              const originalQuery = Element.prototype.querySelectorAll;
              Element.prototype.querySelectorAll = function (selector) {
                const start = performance.now();
                const result = originalQuery.call(this, selector);
                if (selector === '[data-object-id]')
                  scans.push({ start, duration: performance.now() - start, count: result.length });
                return result;
              };
              const unsubPreview = c.subscribe('preview', () => {
                const p = c.getSnapshot('preview').path;
                if (!p.length) return;
                const last = p[p.length - 1];
                const index = points.findIndex(
                  (point) =>
                    Math.abs(point.x - last.x) < 0.001 && Math.abs(point.y - last.y) < 0.001
                );
                const published = performance.now();
                requestAnimationFrame(() => {
                  const node = document.querySelector('[data-testid="layered-display"] polyline');
                  preview.push({
                    index,
                    published,
                    opportunity: performance.now(),
                    domPoints: node?.getAttribute('points') ?? null,
                  });
                });
              });
              const unsubSelection = c.subscribe('selection', () => {
                const published = performance.now(),
                  index = current;
                requestAnimationFrame(() =>
                  selection.push({
                    index,
                    published,
                    opportunity: performance.now(),
                    ids: [...c.getSnapshot('selection')],
                  })
                );
              });
              const frame = (t) => {
                frames.push(t);
                if (running) requestAnimationFrame(frame);
              };
              const send = (phase, index, first = index) => {
                current = index;
                const start = performance.now();
                const eventAt = (i) =>
                  new PointerEvent(`pointer${phase}`, {
                    bubbles: true,
                    pointerId: 245,
                    pointerType: 'pen',
                    clientX: rect.x + points[i].x,
                    clientY: rect.y + points[i].y,
                    button: 0,
                    buttons: phase === 'up' ? 0 : 1,
                    pressure: phase === 'up' ? 0 : 0.5,
                  });
                const event = eventAt(index);
                if (phase === 'move') {
                  const batch = Array.from({ length: index - first + 1 }, (_, j) =>
                    eventAt(first + j)
                  );
                  Object.defineProperty(event, 'getCoalescedEvents', { value: () => batch });
                }
                host.dispatchEvent(event);
                return { index, phase, start, end: performance.now() };
              };
              const initialDocument = c.getSnapshot('document');
              const renderStart = { ...window.__layeredRenders };
              const down = send('down', 0);
              const start = performance.now();
              requestAnimationFrame(frame);
              // A fixed 120Hz sample clock, independent of rAF. Like a busy browser's
              // coalesced pointer channel, deliver every overdue sample in one batch.
              let next = 1;
              while (next < points.length) {
                const due = start + (next * 5000) / 599;
                await new Promise((resolve) =>
                  setTimeout(resolve, Math.max(0, due - performance.now()))
                );
                const last = Math.min(
                  599,
                  Math.max(next, Math.floor(((performance.now() - start) * 599) / 5000))
                );
                const delivery = send('move', last, next);
                for (let i = next; i <= last; i++)
                  inputs.push({
                    ...delivery,
                    index: i,
                    batchLast: last,
                    due: start + (i * 5000) / 599,
                  });
                next = last + 1;
              }
              const drawingEnd = performance.now();
              running = false;
              const up = send('up', 599);
              await new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve))
              );
              const finalOpportunity = performance.now();
              unsubPreview();
              unsubSelection();
              restorers.forEach((restore) => restore());
              Element.prototype.querySelectorAll = originalQuery;
              return {
                frames,
                idle,
                inputs,
                preview,
                selection,
                methods,
                scans,
                down,
                up,
                start,
                drawingEnd,
                finalOpportunity,
                renders: {
                  display: window.__layeredRenders.display - renderStart.display,
                  objects: window.__layeredRenders.objects - renderStart.objects,
                },
                selected: c.getSnapshot('selection'),
                unchangedDocument: c.getSnapshot('document') === initialDocument,
                objectCount: initialDocument.objects.length,
                sampleCounts: initialDocument.objects
                  .filter((o) => o.kind === 'freehand')
                  .map((o) => o.samples.length),
              };
            }, lassoTrajectory(scenario)),
            new Promise((_, reject) => {
              const timer = setTimeout(
                () => reject(new Error(`Measurement timed out: ${id}`)),
                180000
              );
              timer.unref();
            }),
          ]);
          if (profile) {
            const { profile: cpu } = await cdp.send('Profiler.stop');
            const complete = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
            await cdp.send('Tracing.end');
            await complete;
            await writeFile(`${output}/${id}.cpuprofile`, JSON.stringify(cpu));
            await writeFile(`${output}/${id}.trace.json`, JSON.stringify({ traceEvents }));
            await cdp.detach();
          }
          await writeFile(`${output}/${id}.json`, JSON.stringify(raw));
          const intervals = raw.frames.slice(1).map((t, i) => t - raw.frames[i]);
          const idle = raw.idle
            .slice(1)
            .map((t, i) => t - raw.idle[i])
            .sort((a, b) => a - b);
          const T = idle[Math.floor(idle.length / 2)];
          const duration = intervals.reduce((a, b) => a + b, 0);
          const missing = intervals.reduce((sum, d) => sum + Math.max(0, Math.round(d / T) - 1), 0);
          const percentile = (values) =>
            values.sort((a, b) => a - b)[Math.floor(values.length * 0.95)] ?? null;
          const previewLatencies = raw.inputs.flatMap((input) => {
            const shown = raw.preview.find((p) => p.index >= input.index && p.domPoints);
            return shown ? [shown.opportunity - input.start] : [];
          });
          const summary = {
            id,
            scenario,
            count: n,
            round,
            warmup: round < 2,
            T,
            observed: intervals.length,
            duration,
            missing,
            fps: (intervals.length * 1000) / duration,
            dropRate: missing / (intervals.length + missing),
            previewP95: percentile(previewLatencies),
            previewCovered: previewLatencies.length,
            selectionP95: percentile(
              raw.selection
                .filter((s) => raw.inputs.some((i) => i.index === s.index))
                .map((s) => s.opportunity - raw.inputs.find((i) => i.index === s.index).start)
            ),
            beginMs: raw.down.end - raw.down.start,
            endMs: raw.up.end - raw.up.start,
            finalMs: raw.finalOpportunity - raw.up.start,
            renders: raw.renders,
            scanCount: raw.scans.length,
            unchangedDocument: raw.unchangedDocument,
          };
          results.push(summary);
          await writeFile(`${output}/summary.json`, JSON.stringify({ metadata, results }, null, 2));
          console.log(JSON.stringify(summary));
        }
      }
  }
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await once(server, 'exit');
}
