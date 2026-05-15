import { test, expect } from '@playwright/test';

test.describe('DrawingSurface playground', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('uncontrolled demo shows committed stroke data after drawing', async ({ page }) => {
    const surface = page.getByTestId('drawing-surface-uncontrolled');
    const preview = page.getByTestId('drawing-preview-uncontrolled');

    await expect(surface).toBeVisible();
    await expect(preview).toBeVisible();

    await expect(preview).toContainText('seed-1');
    await expect(preview).toContainText('pen');

    const box = await surface.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + 50;
    const startY = box!.y + 50;
    const endX = box!.x + 150;
    const endY = box!.y + 150;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY);
    await page.mouse.up();

    await expect(preview).toContainText('seed-1');
    const previewText = await preview.textContent();
    expect(previewText).toBeTruthy();
    const parsed = JSON.parse(previewText!);
    expect(parsed.strokes.length).toBeGreaterThanOrEqual(1);
  });

  test('controlled demo shows committed stroke data after drawing', async ({ page }) => {
    const surface = page.getByTestId('drawing-surface-controlled');
    const preview = page.getByTestId('drawing-preview-controlled');

    await expect(surface).toBeVisible();
    await expect(preview).toBeVisible();

    await expect(preview).toContainText('"strokes": []');

    const box = await surface.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + 60;
    const startY = box!.y + 60;
    const endX = box!.x + 160;
    const endY = box!.y + 160;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY);
    await page.mouse.up();

    await expect(preview).not.toContainText('"strokes": []');

    const previewText = await preview.textContent();
    expect(previewText).toBeTruthy();
    const parsed = JSON.parse(previewText!);
    expect(parsed.strokes.length).toBeGreaterThanOrEqual(1);
    expect(parsed.strokes[0].tool).toBe('pen');
    expect(parsed.strokes[0].points.length).toBeGreaterThan(0);
  });

  test('controlled demo resets from parent state', async ({ page }) => {
    const surface = page.getByTestId('drawing-surface-controlled');
    const preview = page.getByTestId('drawing-preview-controlled');
    const resetButton = page.getByTestId('drawing-reset-controlled');

    await expect(surface).toBeVisible();
    await expect(preview).toBeVisible();
    await expect(resetButton).toBeVisible();

    const box = await surface.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + 70;
    const startY = box!.y + 70;
    const endX = box!.x + 170;
    const endY = box!.y + 170;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY);
    await page.mouse.up();

    await expect(preview).not.toContainText('"strokes": []');

    let previewText = await preview.textContent();
    expect(previewText).toBeTruthy();
    let parsed = JSON.parse(previewText!);
    expect(parsed.strokes.length).toBeGreaterThanOrEqual(1);

    await resetButton.click();

    await expect(preview).toContainText('"strokes": []');
  });

  test('tap without move does not create new stroke', async ({ page }) => {
    const surface = page.getByTestId('drawing-surface-uncontrolled');
    const preview = page.getByTestId('drawing-preview-uncontrolled');

    await expect(surface).toBeVisible();
    await expect(preview).toBeVisible();

    // Get initial stroke count
    const initialText = await preview.textContent();
    expect(initialText).toBeTruthy();
    const initialParsed = JSON.parse(initialText!);
    const initialStrokeCount = initialParsed.strokes.length;

    // Tap (click without move)
    const box = await surface.boundingBox();
    expect(box).not.toBeNull();
    const tapX = box!.x + 100;
    const tapY = box!.y + 100;

    await page.mouse.click(tapX, tapY);

    // Preview should not change (no new stroke added)
    const finalText = await preview.textContent();
    expect(finalText).toBeTruthy();
    const finalParsed = JSON.parse(finalText!);
    expect(finalParsed.strokes.length).toBe(initialStrokeCount);
  });

  test('second pointer is rejected during drawing', async ({ page }) => {
    const surface = page.getByTestId('drawing-surface-controlled');
    const preview = page.getByTestId('drawing-preview-controlled');

    await expect(surface).toBeVisible();
    await expect(preview).toBeVisible();

    const surfaceEl = await surface.elementHandle();
    expect(surfaceEl).not.toBeNull();

    await page.evaluate((el) => {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x1 = rect.left + 50;
      const y1 = rect.top + 50;
      const x2 = rect.left + 150;
      const y2 = rect.top + 150;

      el.dispatchEvent(new PointerEvent('pointerdown', {
        pointerId: 1,
        pointerType: 'pen',
        clientX: x1,
        clientY: y1,
        bubbles: true,
      }));

      el.dispatchEvent(new PointerEvent('pointermove', {
        pointerId: 1,
        pointerType: 'pen',
        clientX: x1 + 20,
        clientY: y1 + 20,
        bubbles: true,
      }));

      el.dispatchEvent(new PointerEvent('pointerdown', {
        pointerId: 2,
        pointerType: 'pen',
        clientX: x2,
        clientY: y2,
        bubbles: true,
      }));

      el.dispatchEvent(new PointerEvent('pointermove', {
        pointerId: 2,
        pointerType: 'pen',
        clientX: x2 + 20,
        clientY: y2 + 20,
        bubbles: true,
      }));

      el.dispatchEvent(new PointerEvent('pointerup', {
        pointerId: 2,
        pointerType: 'pen',
        clientX: x2 + 20,
        clientY: y2 + 20,
        bubbles: true,
      }));

      el.dispatchEvent(new PointerEvent('pointermove', {
        pointerId: 1,
        pointerType: 'pen',
        clientX: x1 + 40,
        clientY: y1 + 40,
        bubbles: true,
      }));

      el.dispatchEvent(new PointerEvent('pointerup', {
        pointerId: 1,
        pointerType: 'pen',
        clientX: x1 + 40,
        clientY: y1 + 40,
        bubbles: true,
      }));
    }, surfaceEl);

    await page.waitForTimeout(100);

    const previewText = await preview.textContent();
    expect(previewText).toBeTruthy();
    const parsed = JSON.parse(previewText!);
    expect(parsed.strokes.length).toBe(1);
  });
});
