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

  test('switches drawing tools', async ({ page }) => {
    const surface = page.getByTestId('drawing-surface-controlled');
    const preview = page.getByTestId('drawing-preview-controlled');
    const toolSelect = page.getByTestId('drawing-tool-select');

    await expect(surface).toBeVisible();
    await expect(preview).toBeVisible();
    await expect(toolSelect).toBeVisible();

    await toolSelect.selectOption('line');

    const box = await surface.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + 60;
    const startY = box!.y + 60;
    const endX = box!.x + 180;
    const endY = box!.y + 180;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY);
    await page.mouse.up();

    const previewText = await preview.textContent();
    expect(previewText).toBeTruthy();
    expect(previewText!).toContain('"tool": "line"');

    await expect(surface.locator('line').first()).toBeVisible();
  });

  test('applies stroke props', async ({ page }) => {
    const surface = page.getByTestId('drawing-surface-controlled');
    const colorInput = page.getByTestId('drawing-stroke-color-input');
    const widthInput = page.getByTestId('drawing-stroke-width-input');

    await expect(surface).toBeVisible();
    await expect(colorInput).toBeVisible();
    await expect(widthInput).toBeVisible();

    await colorInput.fill('#ff0000');
    await widthInput.fill('7');

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

    const strokeEl = surface.locator('svg').locator('path').last();
    await expect(strokeEl).toHaveAttribute('stroke', '#ff0000');
    await expect(strokeEl).toHaveAttribute('stroke-width', '7');
  });

  test('pressure toggle enables variable-width pen stroke', async ({ page }) => {
    await page.getByTestId('drawing-pressure-toggle').check();
    await page.getByTestId('drawing-stroke-width-input').fill('10');

    const surface = page.getByTestId('drawing-surface-controlled');
    const box = await surface.boundingBox();
    expect(box).not.toBeNull();

    await page.evaluate((rect) => {
      const el = document.querySelector('[data-testid="drawing-surface-controlled"]');
      if (!el) return;
      const x1 = rect.x + 50;
      const y1 = rect.y + 50;
      const x2 = rect.x + 150;
      const y2 = rect.y + 150;

      el.dispatchEvent(new PointerEvent('pointerdown', {
        pointerId: 1,
        pointerType: 'pen',
        clientX: x1,
        clientY: y1,
        pressure: 0.25,
        buttons: 1,
        bubbles: true,
      }));
      el.dispatchEvent(new PointerEvent('pointermove', {
        pointerId: 1,
        pointerType: 'pen',
        clientX: x2,
        clientY: y2,
        pressure: 0.75,
        buttons: 1,
        bubbles: true,
      }));
      el.dispatchEvent(new PointerEvent('pointerup', {
        pointerId: 1,
        pointerType: 'pen',
        clientX: x2,
        clientY: y2,
        pressure: 0.75,
        buttons: 0,
        bubbles: true,
      }));
    }, box);

    const segment = surface.locator('line[stroke-width="7.5"]').first();
    await expect(segment).toBeVisible();
  });

  test('pressure toggle off keeps base width', async ({ page }) => {
    await page.getByTestId('drawing-stroke-width-input').fill('10');

    const surface = page.getByTestId('drawing-surface-controlled');
    const box = await surface.boundingBox();
    expect(box).not.toBeNull();

    await page.evaluate((rect) => {
      const el = document.querySelector('[data-testid="drawing-surface-controlled"]');
      if (!el) return;
      const x1 = rect.x + 50;
      const y1 = rect.y + 50;
      const x2 = rect.x + 150;
      const y2 = rect.y + 150;

      el.dispatchEvent(new PointerEvent('pointerdown', {
        pointerId: 1,
        pointerType: 'pen',
        clientX: x1,
        clientY: y1,
        pressure: 0.25,
        buttons: 1,
        bubbles: true,
      }));
      el.dispatchEvent(new PointerEvent('pointermove', {
        pointerId: 1,
        pointerType: 'pen',
        clientX: x2,
        clientY: y2,
        pressure: 0.75,
        buttons: 1,
        bubbles: true,
      }));
      el.dispatchEvent(new PointerEvent('pointerup', {
        pointerId: 1,
        pointerType: 'pen',
        clientX: x2,
        clientY: y2,
        pressure: 0.75,
        buttons: 0,
        bubbles: true,
      }));
    }, box);

    const segments = surface.locator('line[stroke-width="7.5"]');
    await expect(segments).toHaveCount(0);

    const baseWidthElement = surface.locator('[stroke-width="10"]').first();
    await expect(baseWidthElement).toBeVisible();
  });

  test('draws normalized rectangle', async ({ page }) => {
    const surface = page.getByTestId('drawing-surface-controlled');
    const toolSelect = page.getByTestId('drawing-tool-select');

    await expect(surface).toBeVisible();
    await expect(toolSelect).toBeVisible();

    await toolSelect.selectOption('rect');

    const box = await surface.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + 220;
    const startY = box!.y + 220;
    const endX = box!.x + 120;
    const endY = box!.y + 120;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY);
    await page.mouse.up();

    const rect = surface.locator('rect').first();
    await expect(rect).toBeVisible();

    const width = await rect.getAttribute('width');
    const height = await rect.getAttribute('height');
    expect(width).toBeTruthy();
    expect(height).toBeTruthy();
    expect(Number(width)).toBeGreaterThan(0);
    expect(Number(height)).toBeGreaterThan(0);
  });
});
