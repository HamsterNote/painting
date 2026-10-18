import fs from 'node:fs';
import { chromium } from '@playwright/test';

const [tracePath, ...urls] = process.argv.slice(2);
if (!tracePath || !urls.length) {
  throw new Error('Usage: node replay-device-trace.mjs <trace.json> <base-url> [base-url...]');
}
const trace = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
const events = trace.entries.filter((entry) =>
  ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].includes(entry.action)
);
const browser = await chromium.launch();
try {
  for (const url of urls) {
    const page = await browser.newPage({ viewport: { width: 1080, height: 810 } });
    await page.goto(new URL('/layered-editor?diagnostics=1', url).href);
    await page.waitForSelector('[data-input-ready=true]');
    await page.evaluate((entries) => {
      const host = document.querySelector('[data-testid=layered-surface]');
      for (const entry of entries) {
        const event = new PointerEvent(entry.action, {
          bubbles: true,
          cancelable: true,
          pointerId: entry.pointerId,
          pointerType: entry.source,
          clientX: entry.x,
          clientY: entry.y,
          // The original trace omitted button. Replay primary contact, as in the UI tests.
          button: entry.button ?? 0,
          buttons: entry.buttons,
          pressure: entry.pressure,
        });
        Object.defineProperty(event, 'timeStamp', { value: entry.timeStamp });
        host.dispatchEvent(event);
      }
    }, events);
    const result = await page.evaluate(() => ({
      objects: window.__layeredEditor.getSnapshot('document').objects.length,
      input: window.__layeredEditor.getSnapshot('input'),
      viewport: window.__layeredEditor.getSnapshot('viewport'),
      alerts: Array.from(document.querySelectorAll('[role=alert]')).map((node) => node.textContent),
    }));
    console.log(
      JSON.stringify({
        url,
        events: events.length,
        downs: events.filter((event) => event.action === 'pointerdown').length,
        penDowns: events.filter((event) => event.action === 'pointerdown' && event.source === 'pen')
          .length,
        result,
      })
    );
    await page.close();
  }
} finally {
  await browser.close();
}
