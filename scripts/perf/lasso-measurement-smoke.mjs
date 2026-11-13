// Functional checks only. May run on a busy host; emits no performance comparison.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { buildProbes, openProbe, querySample } from './lasso-clean-pair.mjs';

const output = process.argv[2] ?? 'artifacts/research/lasso-measurement/smoke';
await mkdir(output, { recursive: true });
const probes = await buildProbes(`${output}/bundles`);
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const checks = {
  purpose: 'functional-only; headless with diagnostics controller access; not eligible timing data',
  probes: [],
  lan: [],
};
const stable = (x) =>
  Array.isArray(x)
    ? x.map(stable)
    : x && typeof x === 'object'
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, stable(x[k])])
        )
      : x;
try {
  for (const mode of ['cpu', 'ops', 'allocation']) {
    const results = [];
    for (const label of ['A', 'B']) {
      const probe = await openProbe(
        browser,
        probes[label],
        mode,
        mode === 'ops' ? 500 : 100,
        'local'
      );
      try {
        for (let round = 0; round < 2; round++) {
          const r = await querySample(probe, mode);
          assert.equal(r.cold, round === 0);
          assert.equal(r.candidates, r.processed);
          assert.ok(r.queryThreadCpuMs >= 0);
          if (mode === 'ops') assert.ok(r.operations.fastSegmentPairs > 0);
          if (mode === 'allocation') assert.ok(r.sampledEstimatedAllocatedBytes >= 0);
          results.push(r.selected);
          checks.probes.push({
            label,
            mode,
            cold: r.cold,
            selected: r.selected.length,
            threadClockAvailable: true,
            allocationAvailable: mode === 'allocation',
            countersAvailable: mode === 'ops',
          });
        }
      } finally {
        await probe.context.close();
      }
    }
    results.forEach((r) => assert.deepEqual(r, results[0]));
  }
  await writeFile(`${output}/functional.json`, JSON.stringify(checks, null, 2));
  for (const count of [0, 100, 500]) {
    const hashes = [];
    for (const port of [6271, 6272, 6273]) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      try {
        const page = await context.newPage();
        const errors = [],
          websockets = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('requestfailed', (r) => errors.push(r.url()));
        page.on('websocket', (s) => websockets.push(s.url()));
        if (port === 6273)
          await page.addInitScript(() => {
            window.__paintingTestLassoPerf = (e) => (window.__lassoEvents ??= []).push(e);
          });
        await page.goto(
          `http://192.168.0.145:${port}/layered-editor?fixture=lasso&lassoCount=${count}&lassoScenario=local&touchDraw=1&diagnostics=1`,
          { timeout: 90000 }
        );
        await page.waitForFunction(() => !!window.__layeredEditor, {}, { timeout: 60000 });
        const document = await page.evaluate(() => window.__layeredEditor.getSnapshot('document'));
        assert.equal(document.objects.length, count);
        const hash = createHash('sha256')
          .update(JSON.stringify(stable(document.objects)))
          .digest('hex');
        hashes.push(hash);
        let samplingQueries = null,
          finalQueries = null;
        if (port === 6273 && count === 500) {
          await page.evaluate(() => window.__layeredEditor.setTool('pan'));
          await page.getByTestId('layered-surface').click({ position: { x: 5, y: 5 } });
          await page.evaluate(() => {
            window.__layeredEditor.setTool('lasso');
            window.__lassoEvents = [];
          });
          const rect = await page.getByTestId('layered-surface').boundingBox();
          const v = await page.evaluate(
            () => window.__layeredEditor.getSnapshot('viewport').viewport
          );
          const points = Array.from({ length: 40 }, (_, i) => ({
            x: rect.x + (220 + 180 * Math.cos((i * Math.PI * 2) / 39)) * v.scale + v.tx,
            y: rect.y + (200 + 120 * Math.sin((i * Math.PI * 2) / 39)) * v.scale + v.ty,
          }));
          await page.mouse.move(points[0].x, points[0].y);
          await page.mouse.down();
          for (const p of points.slice(1)) await page.mouse.move(p.x, p.y);
          samplingQueries = await page.evaluate(
            () => window.__lassoEvents.filter((e) => e.event === 'query-start').length
          );
          assert.equal(samplingQueries, 0);
          await page.mouse.up();
          await page.waitForFunction(
            () => window.__layeredEditor.getSnapshot('selection').length > 0,
            {},
            { timeout: 60000 }
          );
          finalQueries = await page.evaluate(
            () => window.__lassoEvents.filter((e) => e.event === 'query-start').length
          );
          assert.equal(finalQueries, 1);
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(websockets, []);
        checks.lan.push({ port, count, hash, samplingQueries, finalQueries, errors, websockets });
        await writeFile(`${output}/functional.json`, JSON.stringify(checks, null, 2));
      } finally {
        await context.close();
      }
    }
    assert.equal(new Set(hashes).size, 1, `fixture differs at ${count} strokes`);
  }
  await writeFile(`${output}/functional.json`, JSON.stringify(checks, null, 2));
  console.log(
    JSON.stringify({
      probeChecks: checks.probes.length,
      pages: checks.lan.length,
      allGeometryPairsMatch: true,
      pr53SamplingQueries: 0,
      pr53FinalQueries: 1,
    })
  );
} finally {
  await browser.close();
}
