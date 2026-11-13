// Exact recorded floating-point/coalesced geometry via DOM events. Native capture
// ordering is tested separately by lasso-capture-browser.mjs with trusted CDP input.
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const [url = 'http://127.0.0.1:6275', output = 'artifacts/research/lasso-capture/replay-after'] =
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
const results = [];
try {
  assert.equal(browser.version().split('.')[0], '156');
  for (const id of ['78872624', '384ec7d3']) {
    const raw = JSON.parse(
      await readFile(`artifacts/research/lasso-capture/raw/recording-${id}.json`, 'utf8')
    );
    const groups = [];
    let group;
    for (const e of raw.events) {
      if (e.kind !== 'pointer') continue;
      if (e.type === 'pointerdown') {
        group = ['surface', 'rect', 'path'].includes(e.target) ? [e] : undefined;
      } else if (group) {
        group.push(e);
        if (e.type === 'pointerup') {
          groups.push(group);
          group = undefined;
        }
      }
    }
    const context = await browser.newContext({
      viewport: { width: raw.environment.width, height: raw.environment.height },
      deviceScaleFactor: raw.environment.dpr,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    await page.addInitScript(() => {
      window.__replayEvents = [];
      window.__paintingTestLassoPerf = (e) => window.__replayEvents.push(e);
    });
    await page.goto(`${url}/layered-editor?fixture=lasso&lassoCount=500&touchDraw=1&lassoPerf=1`);
    await page.waitForFunction(() => Boolean(window.__layeredEditor));
    await page.addScriptTag({ content: oracle.outputFiles[0].text });
    let lasso = 0;
    for (const events of groups) {
      const start = events[0];
      const isLasso = start.state.tool === 'lasso';
      const metadata = await page.evaluate(
        ({ events, isLasso }) => {
          const c = window.__layeredEditor;
          const host = document.querySelector('[data-testid="layered-surface"]');
          const start = events[0],
            state = start.state;
          c.setTool(state.tool);
          c.setSelection(state.selected);
          if (c.getSnapshot('document').documentRevision !== state.revision)
            throw Error('Recorded document revision diverged before replay');
          window.__replayEvents = [];
          const v = state.viewport.viewport,
            bounds = state.surfaceBounds;
          const world = (p) => ({
            x: (p.x - bounds.left - v.tx) / v.scale,
            y: (p.y - bounds.top - v.ty) / v.scale,
          });
          const points = [world(start.samples[0]), world(start.samples[0])];
          for (const e of events.slice(1))
            if (e.type === 'pointermove' || e.type === 'pointerup')
              points.push(...e.samples.map(world));
          const expected = isLasso
            ? window.__recordingOracle.query(c.getSnapshot('document'), points)
            : null;
          const before = c.getSnapshot('document');
          for (const e of events) {
            if (!['pointerdown', 'pointermove', 'lostpointercapture', 'pointerup'].includes(e.type))
              continue;
            const sample = e.samples.at(-1);
            const init = (p) => ({
              bubbles: true,
              cancelable: true,
              pointerId: e.id,
              pointerType: e.source,
              button: 0,
              buttons: p.pressure ? 1 : 0,
              pressure: p.pressure,
              clientX: p.x,
              clientY: p.y,
            });
            const event = new PointerEvent(e.type, init(sample));
            Object.defineProperty(event, 'getCoalescedEvents', {
              value: () => e.samples.map((p) => new PointerEvent(e.type, init(p))),
            });
            const target =
              e.type === 'pointerdown' && !isLasso
                ? document.elementFromPoint(sample.x, sample.y)
                : host;
            (target ?? host).dispatchEvent(event);
          }
          return {
            expected,
            points,
            beforeRevision: before.documentRevision,
            afterRevision: c.getSnapshot('document').documentRevision,
          };
        },
        { events, isLasso }
      );
      if (!isLasso) {
        results.push({
          recording: id,
          kind: 'selection-transform',
          startSequence: start.sequence,
          ...metadata,
        });
        continue;
      }
      lasso++;
      await page.waitForFunction(() =>
        window.__replayEvents.some((e) => e.event === 'selection-submit' || e.event === 'cancel')
      );
      const actual = await page.evaluate(() => ({
        events: window.__replayEvents,
        selected: [...window.__layeredEditor.getSnapshot('selection')],
        revision: window.__layeredEditor.getSnapshot('document').documentRevision,
      }));
      const count = (e) => actual.events.filter((x) => x.event === e).length;
      const lostBeforeUp = events.some((e) => e.type === 'lostpointercapture');
      const recordedEnd = raw.events.findIndex((e) => e.sequence === events.at(-1).sequence);
      const nextDown = raw.events.findIndex((e, i) => i > recordedEnd && e.type === 'pointerdown');
      const originalSubmit = raw.events
        .slice(recordedEnd, nextDown < 0 ? undefined : nextDown)
        .find((e) => e.event === 'selection-submit');
      const result = {
        recording: id,
        kind: 'lasso',
        gesture: lasso,
        startSequence: start.sequence,
        browser: browser.version(),
        lostBeforeUp,
        starts: count('query-start'),
        completes: count('query-complete'),
        submits: count('selection-submit'),
        cancels: count('cancel'),
        originalSelected: originalSubmit?.state.selected ?? null,
        ...metadata,
        ...actual,
      };
      results.push(result);
      await writeFile(`${output}/${id}-${lasso}.json`, JSON.stringify(result, null, 2));
      // Existing successes validate the reconstructed fixture and exact geometry.
      if (originalSubmit) assert.deepEqual(metadata.expected, originalSubmit.state.selected);
      if (process.env.LASSO_EXPECT_FIXED === '1' || !lostBeforeUp) {
        assert.equal(result.starts, 1);
        assert.equal(result.completes, 1);
        assert.equal(result.submits, 1);
        assert.equal(result.cancels, 0);
        assert(result.selected.length > 0);
        assert.deepEqual(result.selected, metadata.expected);
      }
      console.log(
        JSON.stringify({
          recording: id,
          gesture: lasso,
          lostBeforeUp,
          selected: result.selected.length,
          expected: metadata.expected.length,
          starts: result.starts,
          completes: result.completes,
          submits: result.submits,
          cancels: result.cancels,
          revision: result.revision,
        })
      );
    }
    await context.close();
  }
  assert.equal(results.filter((r) => r.kind === 'lasso').length, 8);
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
