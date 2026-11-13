// Complete production gesture, headed Chromium. Gate uses first Paint after selection DOM commit.
// This is a presentation proxy under Xvfb, not physical display/hand timing.
// Secondary acceptance evidence only. Do not compare independent invocations;
// use lasso-clean-pair.mjs for adjacent AB/BA kernel CPU and operation counts.
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { mkdir, writeFile, cp } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';
import { lassoTrajectory } from './lasso-fixture.mjs';
import { sampleHost } from './lasso-host-gate.mjs';
const output = process.argv[2] ?? 'artifacts/research/lasso-final-query/ui';
const root = process.env.LASSO_EXPORT_ROOT ?? 'apps/playground/dist';
await mkdir(output, { recursive: true });
const preflight = await sampleHost();
await writeFile(`${output}/host-preflight.json`, JSON.stringify(preflight, null, 2));
if (!preflight.valid) throw new Error('Invalid host: no UI timing run; retry after load drops');
await cp(root, `${output}/site`, { recursive: true });
const xroot = 'artifacts/research/lasso-release/x11/root';
const display = process.env.DISPLAY ?? process.env.LASSO_X_DISPLAY ?? ':248';
const xserver = process.env.DISPLAY
  ? null
  : spawn(
      `${xroot}/usr/bin/Xvfb`,
      [display, '-screen', '0', '1280x1024x24', '-nolisten', 'tcp', '-ac'],
      {
        env: {
          ...process.env,
          LD_LIBRARY_PATH: `${process.cwd()}/${xroot}/usr/lib/x86_64-linux-gnu`,
        },
        stdio: ['ignore', 'pipe', 'inherit'],
      }
    );
const server = spawn(process.execPath, ['scripts/perf/static-spa-server.mjs', '--root', root], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
let browser;
try {
  const readLine = async (stream) => {
    const lines = createInterface({ input: stream });
    const [line] = await once(lines, 'line');
    lines.close();
    return line;
  };
  const line = await readLine(server.stdout);
  if (xserver) {
    await delay(500);
    if (xserver.exitCode !== null) throw new Error(`Xvfb exited: ${xserver.exitCode}`);
  }
  const port = JSON.parse(line).port;
  browser = await chromium.launch({
    headless: false,
    env: { ...process.env, DISPLAY: display },
    args: ['--no-sandbox'],
  });
  await writeFile(
    `${output}/environment.json`,
    JSON.stringify(
      {
        browser: browser.version(),
        headless: false,
        rate: 6,
        cpu: os.cpus()[0].model,
        load: os.loadavg(),
        sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        diff: execFileSync('git', ['diff'], { encoding: 'utf8' }),
        physicalHumanInput: false,
        physicalDisplay: false,
        diagnosticsFooter: false,
        skipWarmup: process.env.LASSO_SKIP_WARMUP === '1',
      },
      null,
      2
    )
  );
  const rows = [];
  for (let repeat = 0; repeat < Number(process.env.LASSO_REPEATS ?? 1); repeat++)
    for (const scenario of (process.env.LASSO_SCENARIOS ?? 'local,dense').split(','))
      for (const count of (process.env.LASSO_COUNTS ?? '500,1000').split(',').map(Number)) {
        // Sample before navigation: waiting here must not give the first gesture
        // an extra 500ms of application idle warmup.
        const pageHostBefore = await sampleHost();
        if (!pageHostBefore.valid) {
          await writeFile(
            `${output}/${scenario}-${count}-p${repeat}.invalid-host.json`,
            JSON.stringify(pageHostBefore, null, 2)
          );
          throw new Error('Invalid host: cold page rejected before navigation');
        }
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.addInitScript((skipWarmup) => {
          if (skipWarmup) window.__paintingTestLassoWarmup = false;
          window.__paintingTestLassoPerf = (e) => {
            const time = performance.now();
            (window.__lassoMarks ??= []).push({ time, ...e });
            if (e.event === 'warmup') {
              (window.__warmupMarks ??= []).push({ time, ...e });
              performance.mark('warmup:start', { startTime: Math.max(0, time - e.durationMs) });
              performance.mark('warmup:end');
            }
          };
        }, process.env.LASSO_SKIP_WARMUP === '1');
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
        const startupEvents = [];
        const startupCollect = ({ value }) => startupEvents.push(...value);
        cdp.on('Tracing.dataCollected', startupCollect);
        await cdp.send('Tracing.start', {
          categories:
            'devtools.timeline,blink.user_timing,v8,disabled-by-default-v8.gc,disabled-by-default-devtools.timeline',
          transferMode: 'ReportEvents',
        });
        await page.goto(
          `http://127.0.0.1:${port}/layered-editor?lassoPerf=1&fixture=lasso&lassoCount=${count}&lassoScenario=${scenario}`
        );
        await page.waitForFunction(() => Boolean(window.__layeredEditor));
        for (let round = 0; round < Number(process.env.LASSO_ROUNDS ?? 3); round++) {
          const id = `${scenario}-${count}-p${repeat}-r${round}`;
          await page.bringToFront();
          const hostBefore = round === 0 ? pageHostBefore : await sampleHost();
          if (!hostBefore.valid) {
            await writeFile(
              `${output}/${id}.invalid-host.json`,
              JSON.stringify(hostBefore, null, 2)
            );
            throw new Error('Invalid host: round rejected before input; retry in a fresh page');
          }
          // Focus before arming the session; the first focus transition can cancel gestures.
          await page.evaluate(() => window.__layeredEditor.setTool('pan'));
          await page.getByTestId('layered-surface').click({ position: { x: 5, y: 5 } });
          await page.evaluate(async () => {
            const c = window.__layeredEditor;
            c.setTool('lasso');
            c.setSelection([]);
            await document.fonts.ready;
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            performance.clearMarks();
            window.__lassoMarks = [];
            const record = (window.__finalRecord = {
              events: [],
              frames: [],
              selectionDOM: null,
              pendingDOM: null,
              initialDocument: c.getSnapshot('document'),
            });
            const host = document.querySelector('[data-testid="layered-surface"]');
            const listener = (e) => {
              record.events.push({
                type: e.type,
                stamp: e.timeStamp,
                time: performance.now(),
                trusted: e.isTrusted,
              });
              if (e.type !== 'pointermove') performance.mark(`input:${e.type}`);
            };
            for (const type of ['pointerdown', 'pointermove', 'pointerup'])
              window.addEventListener(type, listener, true);
            let raf;
            const frame = (t) => {
              record.frames.push(t);
              raf = requestAnimationFrame(frame);
            };
            raf = requestAnimationFrame(frame);
            const observer = new MutationObserver(() => {
              if (!record.pendingDOM && host.querySelector('[aria-busy="true"]')) {
                record.pendingDOM = performance.now();
                performance.mark('pending:dom');
              }
              if (
                !record.selectionDOM &&
                host.querySelector('[data-selection-operation="resize"]')
              ) {
                record.selectionDOM = performance.now();
                performance.mark('selection:dom');
              }
            });
            observer.observe(host, {
              childList: true,
              subtree: true,
              attributes: true,
              attributeFilter: ['aria-busy'],
            });
            record.stop = () => {
              cancelAnimationFrame(raf);
              observer.disconnect();
              for (const type of ['pointerdown', 'pointermove', 'pointerup'])
                window.removeEventListener(type, listener, true);
            };
          });
          const rect = await page.getByTestId('layered-surface').boundingBox();
          // Convert world fixture coordinates using actual viewport (initial paper placement may pan).
          const viewport = await page.evaluate(
            () => window.__layeredEditor.getSnapshot('viewport').viewport
          );
          const points = lassoTrajectory(scenario).map((p) => ({
            x: rect.x + p.x * viewport.scale + viewport.tx,
            y: rect.y + p.y * viewport.scale + viewport.ty,
          }));
          await page.mouse.move(points[0].x, points[0].y);
          const events = round === 0 ? startupEvents : [];
          const collect = round === 0 ? startupCollect : ({ value }) => events.push(...value);
          if (round > 0) {
            cdp.on('Tracing.dataCollected', collect);
            await cdp.send('Tracing.start', {
              categories:
                'devtools.timeline,blink.user_timing,v8,disabled-by-default-v8.gc,disabled-by-default-devtools.timeline',
              transferMode: 'ReportEvents',
            });
          }
          const send = (type, p) =>
            cdp.send('Input.dispatchMouseEvent', {
              type,
              ...p,
              button: type === 'mouseMoved' ? 'none' : 'left',
              buttons: type === 'mouseReleased' ? 0 : 1,
              clickCount: type === 'mouseMoved' ? 0 : 1,
            });
          await send('mousePressed', points[0]);
          const began = performance.now(),
            pending = [];
          for (let i = 1; i < points.length; i++) {
            await delay(Math.max(0, began + (i * 5000) / 599 - performance.now()));
            pending.push(send('mouseMoved', points[i]));
          }
          await Promise.all(pending);
          await send('mouseReleased', points.at(-1));
          let timeout = false;
          try {
            await page.waitForFunction(
              () => window.__finalRecord.selectionDOM !== null,
              {},
              { timeout: 15000 }
            );
          } catch {
            timeout = true;
          }
          await page.evaluate(
            () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
          );
          const completed = once(cdp, 'Tracing.tracingComplete');
          await cdp.send('Tracing.end');
          await completed;
          cdp.off('Tracing.dataCollected', collect);
          const raw = await page.evaluate(() => {
            const r = window.__finalRecord;
            r.stop();
            return {
              events: r.events,
              frames: r.frames,
              selectionDOM: r.selectionDOM,
              pendingDOM: r.pendingDOM,
              selected: window.__layeredEditor.getSnapshot('selection'),
              unchangedDocument:
                r.initialDocument === window.__layeredEditor.getSnapshot('document'),
              objectCount: window.__layeredEditor.getSnapshot('document').objects.length,
              marks: window.__lassoMarks,
              warmup: window.__warmupMarks ?? [],
            };
          });
          const hostAfter = await sampleHost();
          await writeFile(
            `${output}/${id}.json`,
            JSON.stringify({ ...raw, errors, timeout, hostBefore, hostAfter })
          );
          await writeFile(`${output}/${id}.trace.json`, JSON.stringify({ traceEvents: events }));
          await page.screenshot({ path: `${output}/${id}.png` });
          const down = events.find((e) => e.name === 'input:pointerdown'),
            dom = events.find((e) => e.name === 'selection:dom');
          const origin = down.ts - down.args.data.startTime * 1000;
          const release = raw.events.find((e) => e.type === 'pointerup').stamp;
          const start = origin + raw.events.find((e) => e.type === 'pointerdown').stamp * 1000;
          const paint =
            dom &&
            events.find(
              (e) =>
                e.name === 'Paint' &&
                e.ph === 'X' &&
                e.pid === dom.pid &&
                e.tid === dom.tid &&
                e.ts >= dom.ts
            );
          const end = paint ? paint.ts + paint.dur : events.at(-1).ts;
          const tasks = events.filter(
            (e) =>
              e.ph === 'X' &&
              e.name === 'RunTask' &&
              e.pid === down.pid &&
              e.tid === down.tid &&
              e.ts < end &&
              e.ts + e.dur > start
          );
          const long = tasks
            .filter((e) => e.dur > 200000)
            .map((e) => ({ startMs: (e.ts - origin) / 1000, durationMs: e.dur / 1000 }));
          const phases = {};
          for (const m of raw.marks.filter((m) => m.event === 'phase')) {
            phases[m.phase] ??= { ms: 0, count: 0 };
            phases[m.phase].ms += m.durationMs;
            phases[m.phase].count += m.count ?? 0;
          }
          const qs = raw.marks.find((m) => m.event === 'query-start');
          const qe = raw.marks.find((m) => m.event === 'query-complete');
          let queryTaskWallMs = null;
          if (qs && qe) {
            const queryStart = origin + qs.time * 1000;
            const queryEnd = origin + qe.time * 1000;
            const spans = tasks
              .filter((e) => e.ts < queryEnd && e.ts + e.dur > queryStart)
              .map((e) => [Math.max(queryStart, e.ts), Math.min(queryEnd, e.ts + e.dur)])
              .sort((a, b) => a[0] - b[0]);
            let cursor = queryStart;
            queryTaskWallMs = 0;
            for (const [from, to] of spans) {
              queryTaskWallMs += Math.max(0, to - Math.max(from, cursor)) / 1000;
              cursor = Math.max(cursor, to);
            }
          }
          const gc = events
            .filter(
              (e) =>
                e.ph === 'X' &&
                ['MinorGC', 'MajorGC'].includes(e.name) &&
                e.pid === down.pid &&
                e.tid === down.tid &&
                qs &&
                qe &&
                e.ts < origin + qe.time * 1000 &&
                e.ts + e.dur > origin + qs.time * 1000
            )
            .reduce(
              (s, e) =>
                s +
                Math.max(
                  0,
                  Math.min(e.ts + e.dur, origin + qe.time * 1000) -
                    Math.max(e.ts, origin + qs.time * 1000)
                ) /
                  1000,
              0
            );
          const latency = paint ? (paint.ts + paint.dur - origin) / 1000 - release : null;
          const warm = raw.warmup.filter((m) => m.time <= release);
          const warmTasks = events.filter(
            (e) =>
              e.ph === 'X' &&
              e.name === 'RunTask' &&
              e.pid === down.pid &&
              e.tid === down.tid &&
              warm.some(
                (m) =>
                  e.ts < origin + m.time * 1000 &&
                  e.ts + e.dur > origin + (m.time - m.durationMs) * 1000
              )
          );
          const warmCpu = warm.reduce((sum, m) => sum + m.durationMs, 0);
          const downEvent = raw.events.find((e) => e.type === 'pointerdown');
          const samplingStart = raw.marks.find((m) => m.event === 'input')?.time ?? downEvent.time;
          const warmupDuringDrag = warm.filter(
            (m) => m.time - m.durationMs >= samplingStart
          ).length;
          const loadTasks = events.filter(
            (e) =>
              e.ph === 'X' &&
              e.name === 'RunTask' &&
              e.pid === down.pid &&
              e.tid === down.tid &&
              e.ts < start
          );
          const row = {
            id,
            // Legacy field: summed elapsed time inside warmup calls, not OS CPU.
            warmupCpuMs: warmCpu,
            warmupThreadCpuMs: warmTasks.every((e) => Number.isFinite(e.tdur))
              ? warmTasks.reduce((sum, e) => sum + e.tdur / 1000, 0)
              : null,
            warmupWallMs: warm.length ? warm.at(-1).time - (warm[0].time - warm[0].durationMs) : 0,
            warmupMaxTaskMs: Math.max(0, ...warmTasks.map((e) => e.dur / 1000)),
            warmupOver200: warmTasks.filter((e) => e.dur > 200000).length,
            warmupCompleteBeforeDown: warm.some(
              (m) =>
                m.phase === 'warmup-index' &&
                m.complete &&
                m.time <= raw.events.find((e) => e.type === 'pointerdown').stamp
            ),
            warmupDuringDrag,
            // An idle task can already be running when input is queued. Count
            // this separately from starting work after sampling actually begins.
            warmupInputOverlap: warm.filter((m) => m.time >= downEvent.stamp).length,
            loadMaxTaskMs: Math.max(0, ...loadTasks.map((e) => e.dur / 1000)),
            loadOver200: loadTasks.filter((e) => e.dur > 200000).length,
            cold: round === 0,
            valid:
              hostBefore.valid &&
              hostAfter.valid &&
              !!paint &&
              !timeout &&
              !errors.length &&
              !raw.marks.some((m) => m.event === 'cancel'),
            objectCount: raw.objectCount,
            selected: raw.selected.length,
            releaseToPaintMs: latency,
            releaseToDOMMs: raw.selectionDOM === null ? null : raw.selectionDOM - release,
            releaseToPendingDOMMs: raw.pendingDOM === null ? null : raw.pendingDOM - release,
            queryMs: qe && qs ? qe.time - qs.time : null,
            queryTaskWallMs,
            queryTaskGapMs: qe && qs ? qe.time - qs.time - queryTaskWallMs : null,
            hostLoad: os.loadavg(),
            hostBefore,
            hostAfter,
            measurementRole: 'secondary UI acceptance; not an independent-version comparison',
            phases,
            gcMs: gc,
            taskMaxMs: Math.max(0, ...tasks.map((e) => e.dur / 1000)),
            over200: long.length,
            long,
            dragQueries: raw.marks.filter((m) => m.event === 'query-start' && m.time < release)
              .length,
            pass:
              hostBefore.valid &&
              hostAfter.valid &&
              !!paint &&
              !timeout &&
              !errors.length &&
              !raw.marks.some((m) => m.event === 'cancel') &&
              warmupDuringDrag === 0 &&
              !raw.marks.some((m) => m.event === 'query-start' && m.time < release) &&
              latency <= (count === 500 ? 150 : 400) &&
              long.length === 0 &&
              warmTasks.every((e) => e.dur <= 200000),
          };
          rows.push(row);
          console.log(JSON.stringify(row));
          await writeFile(`${output}/summary.json`, JSON.stringify(rows, null, 2));
          if (!hostAfter.valid)
            throw new Error('Host became invalid: discard round and retry on a fresh page');
        }
        await context.close();
      }
} finally {
  await browser?.close();
  // These are our own non-Multica child processes, with exact handles.
  for (const child of [server, xserver])
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
}
