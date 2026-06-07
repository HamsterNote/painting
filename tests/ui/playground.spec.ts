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

  test('sampling rate input is visible and defaults to 0', async ({ page }) => {
    const samplingRateInput = page.getByTestId('drawing-sampling-rate-input');

    await expect(samplingRateInput).toBeVisible();
    await expect(samplingRateInput).toHaveValue('0');
  });

  test('drawing works with fixed sampling rate', async ({ page }) => {
    const samplingRateInput = page.getByTestId('drawing-sampling-rate-input');
    const surface = page.getByTestId('drawing-surface-controlled');
    const preview = page.getByTestId('drawing-preview-controlled');

    await expect(samplingRateInput).toBeVisible();
    await expect(surface).toBeVisible();

    // 设置采样率为 10（每秒最多 10 个点）
    await samplingRateInput.fill('10');

    const box = await surface.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + 60;
    const startY = box!.y + 60;
    const endX = box!.x + 160;
    const endY = box!.y + 160;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // 添加中间点，间隔 150ms（> 100ms 阈值）
    await page.mouse.move(startX + 25, startY + 25);
    await page.waitForTimeout(150);
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

  // ===== Task 14: Playground Demo Integration =====

  test('exposes all 7 tool buttons with data-tool selectors', async ({ page }) => {
    for (const tool of ['pen', 'line', 'rect', 'ellipse', 'polygon', 'bezier', 'eraser']) {
      const btn = page.locator(`button[data-tool="${tool}"]`);
      await expect(btn).toBeVisible();
    }
  });

  test('exposes dash / fill / cursor / gesture control panels', async ({ page }) => {
    await expect(page.getByTestId('panel-dash')).toBeVisible();
    await expect(page.getByTestId('panel-fill')).toBeVisible();
    await expect(page.getByTestId('panel-cursor')).toBeVisible();
    await expect(page.getByTestId('panel-gestures')).toBeVisible();

    await expect(page.getByTestId('dash-enabled')).toBeVisible();
    await expect(page.getByTestId('dash-length')).toBeVisible();
    await expect(page.getByTestId('dash-gap')).toBeVisible();
    await expect(page.getByTestId('dash-offset')).toBeVisible();

    await expect(page.getByTestId('fill-enabled')).toBeVisible();
    await expect(page.getByTestId('fill-color')).toBeVisible();
    await expect(page.getByTestId('fill-opacity')).toBeVisible();
    await expect(page.getByTestId('force-stroke-width-zero')).toBeVisible();

    await expect(page.getByTestId('cursor-enabled')).toBeVisible();
    await expect(page.getByTestId('cursor-custom-render-toggle')).toBeVisible();

    await expect(page.getByTestId('gesture-pan-toggle')).toBeVisible();
    await expect(page.getByTestId('gesture-pinch-zoom-toggle')).toBeVisible();
    await expect(page.getByTestId('gesture-reset-toggle')).toBeVisible();
  });

  test('shows shift instruction for rect / ellipse', async ({ page }) => {
    await page.locator('button[data-tool="rect"]').click();
    await expect(page.getByTestId('tool-instruction')).toHaveText(/Hold Shift to draw square\/circle/);

    await page.locator('button[data-tool="ellipse"]').click();
    await expect(page.getByTestId('tool-instruction')).toHaveText(/Hold Shift to draw square\/circle/);
  });

  test('shows click-to-place instruction for line / polygon / bezier', async ({ page }) => {
    for (const tool of ['line', 'polygon', 'bezier']) {
      await page.locator(`button[data-tool="${tool}"]`).click();
      await expect(page.getByTestId('tool-instruction')).toHaveText(/Click to add points, double-click or Esc to finish/);
    }
  });

  test('reset button appears when gesture reset is enabled', async ({ page }) => {
    await expect(page.getByTestId('gesture-reset-button')).toHaveCount(0);
    await page.getByTestId('gesture-reset-toggle').check();
    await expect(page.getByTestId('gesture-reset-button')).toBeVisible();
  });

  test('draws ellipse via drag and commits to JSON preview', async ({ page }) => {
    await page.locator('button[data-tool="ellipse"]').click();

    const surface = page.getByTestId('drawing-surface-controlled');
    const preview = page.getByTestId('drawing-preview-controlled');
    const box = await surface.boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.move(box!.x + 80, box!.y + 80);
    await page.mouse.down();
    await page.mouse.move(box!.x + 220, box!.y + 200);
    await page.mouse.up();

    await expect(surface).toHaveAttribute('data-stroke-count', '1');
    const previewText = await preview.textContent();
    expect(previewText).toBeTruthy();
    const parsed = JSON.parse(previewText!);
    expect(parsed.strokes.length).toBe(1);
    expect(parsed.strokes[0].tool).toBe('ellipse');
  });

  test('draws polygon via 4 clicks + dblclick and commits to JSON preview', async ({ page }) => {
    await page.locator('button[data-tool="polygon"]').click();

    const surface = page.getByTestId('drawing-surface-controlled');
    const preview = page.getByTestId('drawing-preview-controlled');
    const box = await surface.boundingBox();
    expect(box).not.toBeNull();

    const pts = [
      { x: box!.x + 80, y: box!.y + 80 },
      { x: box!.x + 200, y: box!.y + 80 },
      { x: box!.x + 220, y: box!.y + 180 },
      { x: box!.x + 100, y: box!.y + 200 },
    ];
    for (const p of pts) {
      await page.mouse.click(p.x, p.y);
    }
    await page.mouse.dblclick(pts[pts.length - 1].x, pts[pts.length - 1].y);

    await expect(surface).toHaveAttribute('data-stroke-count', '1');
    const previewText = await preview.textContent();
    expect(previewText).toBeTruthy();
    const parsed = JSON.parse(previewText!);
    expect(parsed.strokes.length).toBe(1);
    expect(parsed.strokes[0].tool).toBe('polygon');
  });

  test('draws bezier via 4 clicks + dblclick and commits to JSON preview', async ({ page }) => {
    await page.locator('button[data-tool="bezier"]').click();

    const surface = page.getByTestId('drawing-surface-controlled');
    const preview = page.getByTestId('drawing-preview-controlled');
    const box = await surface.boundingBox();
    expect(box).not.toBeNull();

    const pts = [
      { x: box!.x + 70, y: box!.y + 70 },
      { x: box!.x + 130, y: box!.y + 50 },
      { x: box!.x + 200, y: box!.y + 150 },
      { x: box!.x + 260, y: box!.y + 200 },
    ];
    for (const p of pts) {
      await page.mouse.click(p.x, p.y);
    }
    await page.mouse.dblclick(pts[pts.length - 1].x, pts[pts.length - 1].y);

    await expect(surface).toHaveAttribute('data-stroke-count', '1');
    const previewText = await preview.textContent();
    expect(previewText).toBeTruthy();
    const parsed = JSON.parse(previewText!);
    expect(parsed.strokes.length).toBe(1);
    expect(parsed.strokes[0].tool).toBe('bezier');
  });

  test('draws continuous line via 3 clicks + dblclick and commits to JSON preview', async ({ page }) => {
    await page.locator('button[data-tool="line"]').click();

    const surface = page.getByTestId('drawing-surface-controlled');
    const preview = page.getByTestId('drawing-preview-controlled');
    const box = await surface.boundingBox();
    expect(box).not.toBeNull();

    const pts = [
      { x: box!.x + 60, y: box!.y + 60 },
      { x: box!.x + 160, y: box!.y + 60 },
      { x: box!.x + 220, y: box!.y + 160 },
    ];
    for (const p of pts) {
      await page.mouse.click(p.x, p.y);
    }
    await page.mouse.dblclick(pts[pts.length - 1].x, pts[pts.length - 1].y);

    await expect(surface).toHaveAttribute('data-stroke-count', '1');
    const previewText = await preview.textContent();
    expect(previewText).toBeTruthy();
    const parsed = JSON.parse(previewText!);
    expect(parsed.strokes.length).toBe(1);
    expect(parsed.strokes[0].tool).toBe('line');
  });
});
