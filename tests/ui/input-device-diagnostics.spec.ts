import { devices, expect, test } from '@playwright/test';
import { layeredState, openLayeredEditor } from './layered-helpers';

test('iPad browser input reaches the ready arbiter through real hit testing', async ({
  browser,
}) => {
  const context = await browser.newContext({ ...devices['iPad (gen 7)'] });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await openLayeredEditor(page);
    const panel = page.getByTestId('input-device-diagnostics');
    await expect(panel).toContainText('ready=true mode=auto arbiter=ready pointer-events=auto');
    const box = (await page.getByTestId('layered-surface').boundingBox())!;
    await page.touchscreen.tap(box.x + 100, box.y + 100);
    expect((await layeredState(page)).document.objects).toHaveLength(1);
    await expect(panel).toContainText('touch=1/0/1/0');
    await expect(panel).toContainText('trusted=true hit=true');
    await page.mouse.move(box.x + 100, box.y + 180);
    await page.mouse.down();
    await page.mouse.move(box.x + 220, box.y + 200, { steps: 3 });
    await page.mouse.up();
    expect((await layeredState(page)).document.objects).toHaveLength(2);
    expect(errors).toEqual([]);
    await expect(panel).toContainText('window.error: none');
  } finally {
    await context.close();
  }
});

test('device diagnostics expose blocked hit testing, cancellation and runtime errors', async ({
  page,
}) => {
  await openLayeredEditor(page);
  await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('[data-testid="layered-surface"]')!;
    host.dataset.inputReady = 'false';
    delete host.dataset.inputArbiter;
    host.style.pointerEvents = 'none';
  });
  const panel = page.getByTestId('input-device-diagnostics');
  await expect(panel).toContainText('ready=false mode=auto arbiter=missing pointer-events=none');
  const box = (await page.getByTestId('layered-surface').boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 120);
  await page.mouse.down();
  await page.mouse.up();
  await expect(panel).toContainText('mouse=1/0/1/0');
  await expect(panel).toContainText('trusted=true hit=false');
  expect((await layeredState(page)).document.objects).toHaveLength(0);
  await page.evaluate(() => {
    const host = document.querySelector('[data-testid="layered-surface"]')!;
    const rect = host.getBoundingClientRect();
    for (const type of ['pointerdown', 'pointercancel'])
      host.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerType: 'pen',
          pointerId: 12,
          clientX: rect.x + 100,
          clientY: rect.y + 120,
        })
      );
    window.dispatchEvent(new ErrorEvent('error', { message: 'device diagnostic probe' }));
  });
  await expect(panel).toContainText('pen=1/0/0/1');
  await expect(panel).toContainText('window.error: device diagnostic probe');
});

test('device diagnostics are absent without the diagnostics query flag', async ({ page }) => {
  await page.goto('/layered-editor');
  await expect(page.getByTestId('layered-drawing')).toBeVisible();
  await expect(page.getByTestId('input-device-diagnostics')).toHaveCount(0);
});
