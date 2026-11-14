import { sampleHost } from './lasso-host-gate.mjs';

// Noise traces showed no recovery over 25s, so a fixed delay is not evidence of
// stability. Require two consecutive valid 3s windows, with a 10-window limit.
// For UI runs these are blank pages: do not warm the product before its first gesture.
export async function settleLassoPages(pages, record, { sample = sampleHost } = {}) {
  for (const page of pages) {
    await page.bringToFront();
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
  }
  let consecutive = 0;
  for (let attempt = 0; attempt < 10; attempt++) {
    const host = await sample();
    consecutive = host.valid ? consecutive + 1 : 0;
    await record({ stage: 'settle', attempt, consecutive, host });
    if (consecutive === 2) return true;
  }
  await record({
    stage: 'settle-abort',
    before: null,
    after: null,
    abortReason: 'no-two-consecutive-valid-3s-windows-before-measurement',
  });
  return false;
}
