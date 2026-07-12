import { test, expect, type Locator } from '@playwright/test';

test.describe('DrawingSurface playground', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  async function dispatchPointerDrag(
    surface: Locator,
    options: {
      pointerId: number;
      pointerType: 'mouse' | 'touch' | 'pen';
      start: { x: number; y: number };
      moves: { x: number; y: number; pressure?: number }[];
      startPressure?: number;
    },
  ) {
    await surface.evaluate(
      (el, drag) => {
        el.setPointerCapture = () => undefined;
        el.releasePointerCapture = () => undefined;
        el.hasPointerCapture = () => true;
        const rect = el.getBoundingClientRect();
        const dispatch = (type: string, point: { x: number; y: number; pressure?: number }, buttons: number) => {
          el.dispatchEvent(new PointerEvent(type, {
            pointerId: drag.pointerId,
            pointerType: drag.pointerType,
            button: 0,
            buttons,
            clientX: rect.left + point.x,
            clientY: rect.top + point.y,
            pressure: point.pressure ?? drag.startPressure ?? 0.5,
            bubbles: true,
            cancelable: true,
          }));
        };

        dispatch('pointerdown', { ...drag.start, pressure: drag.startPressure }, 1);
        for (const point of drag.moves) {
          dispatch('pointermove', point, 1);
        }
        dispatch('pointerup', drag.moves[drag.moves.length - 1] ?? drag.start, 0);
      },
      options,
    );
  }

  async function readPreview(preview: Locator) {
    const previewText = await preview.textContent();
    expect(previewText).toBeTruthy();
    return JSON.parse(previewText!);
  }

  function pointCount(pointsAttr: string | null) {
    return pointsAttr?.trim().split(/\s+/).filter(Boolean).length ?? 0;
  }

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

    await dispatchPointerDrag(surface, {
      pointerId: 21,
      pointerType: 'mouse',
      start: { x: 220, y: 220 },
      moves: [{ x: 120, y: 120 }],
    });

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

  test('exposes all 8 tool buttons with data-tool selectors', async ({ page }) => {
    for (const tool of ['pen', 'line', 'rect', 'ellipse', 'polygon', 'bezier', 'eraser', 'lasso']) {
      const btn = page.locator(`button[data-tool="${tool}"]`);
      await expect(btn).toBeVisible();
    }
  });

  test('exposes dash / fill / cursor / eraser control panels without gesture controls', async ({ page }) => {
    await expect(page.getByTestId('panel-dash')).toBeVisible();
    await expect(page.getByTestId('panel-fill')).toBeVisible();
    await expect(page.getByTestId('panel-cursor')).toBeVisible();
    await expect(page.getByTestId('panel-eraser')).toBeVisible();
    await expect(page.getByTestId('panel-gestures')).toHaveCount(0);

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

    await expect(page.getByTestId('eraser-commit-mode')).toBeVisible();
    await expect(page.getByTestId('eraser-trajectory-visible')).toBeVisible();
    await expect(page.getByTestId('eraser-trajectory-color')).toBeVisible();
    await expect(page.getByTestId('eraser-trajectory-color')).toHaveValue('#ccc');
    await expect(page.getByTestId('eraser-trajectory-opacity')).toBeVisible();
    await expect(page.getByTestId('eraser-trajectory-opacity')).toHaveValue('0.5');
    await expect(page.getByTestId('drawing-pressure-multiplier-input')).toBeVisible();
    await expect(page.getByTestId('drawing-pressure-multiplier-input')).toHaveValue('1');

    for (const gesture of [
      'TouchSinglePan',
      'TouchDoublePan',
      'TouchDoubleZoom',
      'MousePan',
      'MouseWheelZoom',
      'PenPan',
    ]) {
      await expect(page.getByLabel(gesture)).toHaveCount(0);
    }
    await expect(page.getByTestId('gesture-min-scale-input')).toHaveCount(0);
    await expect(page.getByTestId('gesture-max-scale-input')).toHaveCount(0);
    await expect(page.getByTestId('gesture-reset-toggle')).toHaveCount(0);
  });

  test('shows shift instruction for rect / ellipse', async ({ page }) => {
    await page.locator('button[data-tool="rect"]').click();
    await expect(page.getByTestId('tool-instruction')).toHaveText(/Hold Shift to draw square\/circle/);

    await page.locator('button[data-tool="ellipse"]').click();
    await expect(page.getByTestId('tool-instruction')).toHaveText(/Hold Shift to draw square\/circle/);
  });

  test('shows click-to-place instruction for line / polygon and three-drag instruction for bezier', async ({ page }) => {
    for (const tool of ['line', 'polygon']) {
      await page.locator(`button[data-tool="${tool}"]`).click();
      await expect(page.getByTestId('tool-instruction')).toHaveText(/Click to add points, double-click or Esc to finish/);
    }

    await page.locator('button[data-tool="bezier"]').click();
    await expect(page.getByTestId('tool-instruction')).toHaveText(/Drag 1 sets the start\/end line, drag 2 sets the first control point, drag 3 sets the second control point and commits/);
  });

  test('gesture reset button is not rendered after gesture removal', async ({ page }) => {
    await expect(page.getByTestId('gesture-reset-button')).toHaveCount(0);
  });

  test('touch input draws strokes instead of panning after gesture removal', async ({ page }) => {
    const surface = page.getByTestId('drawing-surface-controlled');
    const preview = page.getByTestId('drawing-preview-controlled');
    await expect(surface).toBeVisible();
    await expect(preview).toBeVisible();
    await expect(surface).toHaveAttribute('data-stroke-count', '0');
    await expect(surface).toHaveAttribute('data-scale', '1');
    await expect(surface).toHaveAttribute('data-tx', '0');
    await expect(surface).toHaveAttribute('data-ty', '0');

    await dispatchPointerDrag(surface, {
      pointerId: 31,
      pointerType: 'touch',
      start: { x: 80, y: 90 },
      moves: [
        { x: 125, y: 120 },
        { x: 150, y: 145 },
      ],
    });

    await expect(surface).toHaveAttribute('data-scale', '1');
    await expect(surface).toHaveAttribute('data-tx', '0');
    await expect(surface).toHaveAttribute('data-ty', '0');
    await expect(surface).toHaveAttribute('data-stroke-count', '1');
    const previewText = await preview.textContent();
    expect(previewText).toBeTruthy();
    const parsed = JSON.parse(previewText!);
    expect(parsed.strokes.length).toBe(1);
    expect(parsed.strokes[0].tool).toBe('pen');
    expect(parsed.strokes[0].points.length).toBeGreaterThan(0);
  });

  test('wheel input no longer changes viewport after gesture removal', async ({ page }) => {
    const surface = page.getByTestId('drawing-surface-controlled');
    await expect(surface).toBeVisible();
    await expect(surface).toHaveAttribute('data-scale', '1');

    await surface.dispatchEvent('wheel', {
      deltaY: -120,
      clientX: 200,
      clientY: 150,
    });
    await expect(surface).toHaveAttribute('data-scale', '1');
    await expect(surface).toHaveAttribute('data-tx', '0');
    await expect(surface).toHaveAttribute('data-ty', '0');
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
    const pts = [
      { x: 80, y: 80 },
      { x: 200, y: 80 },
      { x: 220, y: 180 },
      { x: 100, y: 200 },
    ];
    await surface.evaluate((el, points) => {
      const rect = el.getBoundingClientRect();
      for (const point of points) {
        el.dispatchEvent(new PointerEvent('pointerdown', {
          pointerId: 22,
          pointerType: 'mouse',
          button: 0,
          buttons: 1,
          clientX: rect.left + point.x,
          clientY: rect.top + point.y,
          bubbles: true,
          cancelable: true,
        }));
        el.dispatchEvent(new PointerEvent('pointerup', {
          pointerId: 22,
          pointerType: 'mouse',
          button: 0,
          buttons: 0,
          clientX: rect.left + point.x,
          clientY: rect.top + point.y,
          bubbles: true,
          cancelable: true,
        }));
      }
      const last = points[points.length - 1];
      el.dispatchEvent(new MouseEvent('dblclick', {
        clientX: rect.left + last.x,
        clientY: rect.top + last.y,
        bubbles: true,
        cancelable: true,
      }));
    }, pts);

    await expect(surface).toHaveAttribute('data-stroke-count', '1');
    const previewText = await preview.textContent();
    expect(previewText).toBeTruthy();
    const parsed = JSON.parse(previewText!);
    expect(parsed.strokes.length).toBe(1);
    expect(parsed.strokes[0].tool).toBe('polygon');
  });

  test('rendered-width eraser deletes pen, rect, and bezier targets', async ({ page }) => {
    const surface = page.getByTestId('drawing-surface-controlled');
    const preview = page.getByTestId('drawing-preview-controlled');
    await expect(surface).toBeVisible();

    await page.getByTestId('drawing-stroke-width-input').fill('20');

    await page.locator('button[data-tool="pen"]').click();
    await dispatchPointerDrag(surface, {
      pointerId: 61,
      pointerType: 'pen',
      start: { x: 40, y: 50 },
      moves: [{ x: 120, y: 50 }],
    });

    await page.locator('button[data-tool="rect"]').click();
    await dispatchPointerDrag(surface, {
      pointerId: 62,
      pointerType: 'mouse',
      start: { x: 160, y: 80 },
      moves: [{ x: 240, y: 150 }],
    });

    await page.locator('button[data-tool="bezier"]').click();
    await dispatchPointerDrag(surface, {
      pointerId: 63,
      pointerType: 'mouse',
      start: { x: 40, y: 220 },
      moves: [{ x: 160, y: 220 }],
    });
    await dispatchPointerDrag(surface, {
      pointerId: 64,
      pointerType: 'mouse',
      start: { x: 80, y: 200 },
      moves: [{ x: 80, y: 220 }],
    });
    await dispatchPointerDrag(surface, {
      pointerId: 65,
      pointerType: 'mouse',
      start: { x: 120, y: 240 },
      moves: [{ x: 120, y: 220 }],
    });

    await expect(surface).toHaveAttribute('data-stroke-count', '3');
    let parsed = await readPreview(preview);
    expect(parsed.strokes.map((stroke: { tool: string }) => stroke.tool).sort()).toEqual(['bezier', 'pen', 'rect']);

    await page.locator('button[data-tool="eraser"]').click();
    await page.getByTestId('drawing-stroke-width-input').fill('2');
    await expect(surface).toHaveAttribute('data-active-tool', 'eraser');

    const sweeps = [
      { id: 66, start: { x: 40, y: 59 }, moves: [{ x: 120, y: 59 }] },
      { id: 67, start: { x: 160, y: 71 }, moves: [{ x: 240, y: 71 }] },
      { id: 68, start: { x: 40, y: 229 }, moves: [{ x: 160, y: 229 }] },
    ];

    for (const sweep of sweeps) {
      const before = Number(await surface.getAttribute('data-stroke-count'));
      await dispatchPointerDrag(surface, {
        pointerId: sweep.id,
        pointerType: 'pen',
        start: sweep.start,
        moves: sweep.moves,
      });
      const after = Number(await surface.getAttribute('data-stroke-count'));
      expect(after).toBe(before - 1);
    }

    await expect(surface).toHaveAttribute('data-stroke-count', '0');
    parsed = await readPreview(preview);
    expect(parsed.strokes).toEqual([]);
  });

  test('pressure multiplier changes visible pressure segment width without changing raw pressure data', async ({ page }) => {
    const surface = page.getByTestId('drawing-surface-controlled');
    const preview = page.getByTestId('drawing-preview-controlled');
    await expect(surface).toBeVisible();

    await page.getByTestId('drawing-pressure-toggle').check();
    await page.getByTestId('drawing-stroke-width-input').fill('10');
    const surfaceSvg = surface.locator('svg').first();
    await expect(page.getByTestId('drawing-pressure-multiplier-input')).toHaveValue('1');
    await expect(surfaceSvg).toHaveAttribute('data-pressure-multiplier', '1');

    const drawPressureStroke = async (pointerId: number) => {
      await dispatchPointerDrag(surface, {
        pointerId,
        pointerType: 'pen',
        start: { x: 50, y: 50 },
        startPressure: 0.2,
        moves: [
          { x: 100, y: 80, pressure: 0.8 },
          { x: 150, y: 110, pressure: 0.8 },
        ],
      });
    };
    const maxRenderedLineWidth = async () => {
      const widths = await surface.locator('line[stroke-width]').evaluateAll((lines) =>
        lines.map((line) => Number(line.getAttribute('stroke-width') ?? 0)),
      );
      expect(widths.length).toBeGreaterThan(0);
      return Math.max(...widths);
    };

    await drawPressureStroke(71);
    const baseWidth = await maxRenderedLineWidth();
    let parsed = await readPreview(preview);
    expect(parsed.strokes).toHaveLength(1);
    const basePressures = parsed.strokes[0].points.map((point: { pressure?: number }) => point.pressure);

    await page.getByTestId('drawing-reset-controlled').click();
    await expect(surface).toHaveAttribute('data-stroke-count', '0');
    await page.getByTestId('drawing-pressure-multiplier-input').fill('2');
    await expect(surfaceSvg).toHaveAttribute('data-pressure-multiplier', '2');
    await drawPressureStroke(72);

    const multipliedWidth = await maxRenderedLineWidth();
    expect(multipliedWidth).toBeGreaterThan(baseWidth);
    parsed = await readPreview(preview);
    expect(parsed.strokes).toHaveLength(1);
    const multipliedPressures = parsed.strokes[0].points.map((point: { pressure?: number }) => point.pressure);
    expect(multipliedPressures).toEqual(basePressures);
  });

  test('draws bezier via three drags and commits one cubic SVG path to JSON preview', async ({ page }) => {
    await page.locator('button[data-tool="bezier"]').click();

    const surface = page.getByTestId('drawing-surface-controlled');
    const preview = page.getByTestId('drawing-preview-controlled');
    await expect(surface).toBeVisible();

    await dispatchPointerDrag(surface, {
      pointerId: 41,
      pointerType: 'mouse',
      start: { x: 70, y: 70 },
      moves: [{ x: 260, y: 200 }],
    });
    await dispatchPointerDrag(surface, {
      pointerId: 42,
      pointerType: 'mouse',
      start: { x: 150, y: 120 },
      moves: [{ x: 130, y: 50 }],
    });
    await dispatchPointerDrag(surface, {
      pointerId: 43,
      pointerType: 'mouse',
      start: { x: 210, y: 140 },
      moves: [{ x: 200, y: 150 }],
    });

    await expect(surface).toHaveAttribute('data-stroke-count', '1');
    const cubicPath = surface.locator('path[d*="C"]').first();
    await expect(cubicPath).toBeVisible();
    const parsed = await readPreview(preview);
    expect(parsed.strokes.length).toBe(1);
    expect(parsed.strokes[0].tool).toBe('bezier');
    expect(parsed.strokes[0].points).toHaveLength(4);
  });

  // Task 7: Eraser options end-to-end coverage. Trajectory assertions are tight
  // (synchronous polyline render). For commit-mode we compare data-stroke-count
  // BEFORE pointerup vs AFTER to distinguish while-sliding (mid-gesture delete)
  // from on-release (delete at end). The mid-gesture on-release check uses a
  // synchronous getAttribute to avoid racing the release; brief permits skipping
  // that sub-assertion if it proves flaky in Chromium.
  test('eraser options update cursor trajectory and commit behavior', async ({ page }) => {
    const surface = page.getByTestId('drawing-surface-controlled');
    await expect(surface).toBeVisible();

    const commitMode = page.getByTestId('eraser-commit-mode');
    const trajectoryVisible = page.getByTestId('eraser-trajectory-visible');
    const trajectoryColor = page.getByTestId('eraser-trajectory-color');
    const widthInput = page.getByTestId('drawing-stroke-width-input');
    await expect(commitMode).toBeVisible();
    await expect(trajectoryVisible).toBeVisible();
    await expect(trajectoryColor).toBeVisible();
    await expect(widthInput).toBeVisible();

    // Seed: draw one pen stroke so the eraser has something to delete later.
    const box = await surface.boundingBox();
    expect(box).not.toBeNull();
    const baseY = box!.y + 150;
    await page.mouse.move(box!.x + 60, baseY);
    await page.mouse.down();
    await page.mouse.move(box!.x + 120, baseY);
    await page.mouse.move(box!.x + 180, baseY);
    await page.mouse.move(box!.x + 240, baseY);
    await page.mouse.up();
    await expect(surface).toHaveAttribute('data-stroke-count', '1');

    await page.locator('button[data-tool="eraser"]').click();
    await trajectoryVisible.check();
    await trajectoryColor.fill('#ff0000');
    // The trajectory line width now follows the shared top Width control.
    await widthInput.fill('5');
    await expect(widthInput).toHaveValue('5');
    await expect(trajectoryVisible).toBeChecked();

    // Default commit mode is while-sliding; first sweep avoids the pen stroke
    // so the test isolates trajectory rendering from deletion behavior.
    const trajY = box!.y + 50;
    await page.mouse.move(box!.x + 60, trajY);
    await page.mouse.down();
    await page.mouse.move(box!.x + 100, trajY);
    await page.mouse.move(box!.x + 140, trajY);
    await page.mouse.move(box!.x + 180, trajY);

    const trajectory = surface.locator('[data-testid="eraser-trajectory"]');
    await expect(trajectory).toHaveCount(1);
    await expect(trajectory).toHaveAttribute('stroke', '#ff0000');
    await expect(trajectory).toHaveAttribute('stroke-width', '5');

    await page.mouse.up();
    await expect(trajectory).toHaveCount(0);

    await commitMode.selectOption('on-release');
    await expect(commitMode).toHaveValue('on-release');
    await expect(surface).toHaveAttribute('data-stroke-count', '1');

    await page.mouse.move(box!.x + 60, baseY);
    await page.mouse.down();
    await page.mouse.move(box!.x + 120, baseY);
    await page.mouse.move(box!.x + 180, baseY);
    await page.mouse.move(box!.x + 240, baseY);

    // Synchronous read: in on-release the stroke must still be present mid-gesture.
    const midCount = await surface.getAttribute('data-stroke-count');
    expect(midCount).toBe('1');

    await page.mouse.up();
    await expect(surface).toHaveAttribute('data-stroke-count', '0');
  });

  // 稀疏竖向 sweep 的 down/move 端点都避开目标线，但连线穿过目标；while-sliding 应在 pointerup 前删除。
  test('eraser sparse sweep deletes a crossed target before release in while-sliding mode', async ({ page }) => {
    const surface = page.getByTestId('drawing-surface-controlled');
    const preview = page.getByTestId('drawing-preview-controlled');
    await expect(surface).toBeVisible();

    const box = await surface.boundingBox();
    expect(box).not.toBeNull();
    const baseY = box!.y + 150;

    await page.mouse.move(box!.x + 90, baseY);
    await page.mouse.down();
    await page.mouse.move(box!.x + 150, baseY);
    await page.mouse.move(box!.x + 210, baseY);
    await page.mouse.up();
    await expect(surface).toHaveAttribute('data-stroke-count', '1');

    const targetText = await preview.textContent();
    expect(targetText).toBeTruthy();
    const targetStroke = JSON.parse(targetText!).strokes[0];
    const targetPoint = targetStroke.points[Math.floor(targetStroke.points.length / 2)];
    const targetX = targetPoint.x;
    const targetY = targetPoint.y;

    const widthInput = page.getByTestId('drawing-stroke-width-input');
    await widthInput.fill('24');
    await expect(widthInput).toHaveValue('24');
    await page.getByTestId('eraser-commit-mode').selectOption('while-sliding');
    await page.locator('button[data-tool="eraser"]').click();
    await expect(surface).toHaveAttribute('data-active-tool', 'eraser');
    await surface.evaluate(
      (el, points) => {
        el.setPointerCapture = () => undefined;
        el.releasePointerCapture = () => undefined;
        el.hasPointerCapture = () => true;
        const rect = el.getBoundingClientRect();
        const dispatch = (type: string, point: { x: number; y: number }, buttons: number) => {
          el.dispatchEvent(new PointerEvent(type, {
            pointerId: 11,
            pointerType: 'pen',
            button: 0,
            buttons,
            clientX: rect.left + point.x,
            clientY: rect.top + point.y,
            bubbles: true,
            cancelable: true,
          }));
        };

        dispatch('pointerdown', points.start, 1);
        dispatch('pointermove', points.end, 1);
      },
      {
        start: { x: targetX, y: targetY - 13 },
        end: { x: targetX, y: targetY + 12.5 },
      },
    );
    await expect(surface).toHaveAttribute('data-stroke-count', '0');
    await surface.evaluate((el, point) => {
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent('pointerup', {
        pointerId: 11,
        pointerType: 'pen',
        button: 0,
        buttons: 0,
        clientX: rect.left + point.x,
        clientY: rect.top + point.y,
        bubbles: true,
        cancelable: true,
      }));
    }, { x: targetX, y: targetY + 12.5 });
  });

  test('eraser trajectory style stays continuous while deleting a stroke mid-drag', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    const surface = page.getByTestId('drawing-surface-uncontrolled');
    await expect(surface).toBeVisible();
    await expect(surface).toHaveAttribute('data-stroke-count', '1');

    await page.locator('button[data-tool="eraser"]').click();
    await page.getByTestId('drawing-stroke-width-input').fill('20');
    await page.getByTestId('eraser-trajectory-visible').check();
    await expect(page.getByTestId('eraser-trajectory-color')).toHaveValue('#ccc');
    await expect(page.getByTestId('eraser-trajectory-opacity')).toHaveValue('0.5');
    await expect(surface).toHaveAttribute('data-active-tool', 'eraser');

    const box = await surface.boundingBox();
    expect(box).not.toBeNull();
    const surfaceX = box?.x ?? 0;
    const surfaceY = box?.y ?? 0;
    await page.mouse.move(surfaceX + 10, surfaceY + 10);
    await page.mouse.down();
    await page.mouse.move(surfaceX + 100, surfaceY + 100);

    const trajectory = surface.locator('[data-testid="eraser-trajectory"]');
    await expect(trajectory).toHaveCount(1);
    await expect(trajectory).toHaveAttribute('stroke', '#ccc');
    await expect(trajectory).toHaveAttribute('opacity', '0.5');
    const afterDeleteCount = pointCount(await trajectory.getAttribute('points'));
    expect(afterDeleteCount).toBeGreaterThanOrEqual(1);
    await expect(surface).toHaveAttribute('data-stroke-count', '0');

    await page.mouse.move(surfaceX + 55, surfaceY + 130);
    const afterContinueCount = pointCount(await trajectory.getAttribute('points'));
    expect(afterContinueCount).toBeGreaterThanOrEqual(afterDeleteCount);

    await page.mouse.up();
    await expect(trajectory).toHaveCount(0);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  // 相同稀疏穿越在 on-release 下移动中只排队，必须等 pointerup 后才删除目标。
  test('eraser sparse sweep queues a crossed target until release in on-release mode', async ({ page }) => {
    const surface = page.getByTestId('drawing-surface-controlled');
    const preview = page.getByTestId('drawing-preview-controlled');
    await expect(surface).toBeVisible();

    const box = await surface.boundingBox();
    expect(box).not.toBeNull();
    const baseY = box!.y + 150;

    await page.mouse.move(box!.x + 90, baseY);
    await page.mouse.down();
    await page.mouse.move(box!.x + 150, baseY);
    await page.mouse.move(box!.x + 210, baseY);
    await page.mouse.up();
    await expect(surface).toHaveAttribute('data-stroke-count', '1');

    const targetText = await preview.textContent();
    expect(targetText).toBeTruthy();
    const targetStroke = JSON.parse(targetText!).strokes[0];
    const targetPoint = targetStroke.points[Math.floor(targetStroke.points.length / 2)];
    const targetX = targetPoint.x;
    const targetY = targetPoint.y;

    const widthInput = page.getByTestId('drawing-stroke-width-input');
    await widthInput.fill('24');
    await expect(widthInput).toHaveValue('24');
    await page.getByTestId('eraser-commit-mode').selectOption('on-release');
    await page.locator('button[data-tool="eraser"]').click();
    await expect(surface).toHaveAttribute('data-active-tool', 'eraser');
    await surface.evaluate(
      (el, points) => {
        el.setPointerCapture = () => undefined;
        el.releasePointerCapture = () => undefined;
        el.hasPointerCapture = () => true;
        const rect = el.getBoundingClientRect();
        const dispatch = (type: string, point: { x: number; y: number }, buttons: number) => {
          el.dispatchEvent(new PointerEvent(type, {
            pointerId: 12,
            pointerType: 'pen',
            button: 0,
            buttons,
            clientX: rect.left + point.x,
            clientY: rect.top + point.y,
            bubbles: true,
            cancelable: true,
          }));
        };

        dispatch('pointerdown', points.start, 1);
        dispatch('pointermove', points.end, 1);
      },
      {
        start: { x: targetX, y: targetY - 13 },
        end: { x: targetX, y: targetY + 12.5 },
      },
    );

    const sparseMidCount = await surface.getAttribute('data-stroke-count');
    expect(sparseMidCount).toBe('1');

    await surface.evaluate((el, point) => {
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent('pointerup', {
        pointerId: 12,
        pointerType: 'pen',
        button: 0,
        buttons: 0,
        clientX: rect.left + point.x,
        clientY: rect.top + point.y,
        bubbles: true,
        cancelable: true,
      }));
    }, { x: targetX, y: targetY + 12.5 });
    await expect(surface).toHaveAttribute('data-stroke-count', '0');
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

  test.describe('lasso tool integration', () => {
    test('lasso tool is exposed in toolbar and select', async ({ page }) => {
      const lassoBtn = page.locator('button[data-tool="lasso"]');
      await expect(lassoBtn).toBeVisible();

      const toolSelect = page.getByTestId('drawing-tool-select');
      await expect(toolSelect).toBeVisible();
      await toolSelect.selectOption('lasso');
      await expect(toolSelect).toHaveValue('lasso');

      // 选中 lasso 后应显示对应的工具说明
      await expect(page.getByTestId('tool-instruction')).toHaveText(/Drag to lasso strokes/);
    });

    test('delete selected button is present and initially disabled', async ({ page }) => {
      const deleteBtn = page.getByTestId('lasso-delete-selected');
      await expect(deleteBtn).toBeVisible();
      await expect(deleteBtn).toBeDisabled();
      // 初始无选中时计数标签不应出现
      await expect(page.getByTestId('lasso-selection-count')).toHaveCount(0);
    });

    test('lasso selects seed stroke and delete button removes it', async ({ page }) => {
      const surface = page.getByTestId('drawing-surface-uncontrolled');
      const preview = page.getByTestId('drawing-preview-uncontrolled');
      const deleteBtn = page.getByTestId('lasso-delete-selected');

      // 非受控画布中已注入 seed stroke
      await expect(surface).toHaveAttribute('data-stroke-count', '1');
      await expect(preview).toContainText('seed-1');

      // 切到 lasso 工具
      await page.locator('button[data-tool="lasso"]').click();
      await expect(surface).toHaveAttribute('data-active-tool', 'lasso');

      const box = await surface.boundingBox();
      expect(box).not.toBeNull();

      // 拖拽套索路径覆盖 seed stroke（seed points: 50,50 → 100,100 → 150,80）
      const startX = box!.x + 30;
      const startY = box!.y + 30;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(box!.x + 170, box!.y + 30);
      await page.mouse.move(box!.x + 170, box!.y + 120);
      await page.mouse.move(box!.x + 30, box!.y + 120);
      await page.mouse.move(startX, startY);
      await page.mouse.up();

      // 删除按钮应变为可用状态，且显示选中数量
      await expect(deleteBtn).toBeEnabled();
      await expect(page.getByTestId('lasso-selection-count')).toHaveText('(1)');

      // 套索选择框应可见，并使用半透明蓝色填充与蓝色虚线描边
      const selectionBox = surface.locator('[data-testid="lasso-selection-box"]');
      await expect(selectionBox).toHaveCount(1);
      await expect(selectionBox).toBeVisible();
      await expect(selectionBox).toHaveAttribute('fill', 'rgba(59,130,246,0.2)');
      await expect(selectionBox).toHaveAttribute('stroke', 'rgb(59,130,246)');
      await expect(selectionBox).toHaveAttribute('stroke-width', '3');
      await expect(selectionBox).toHaveAttribute('stroke-dasharray', '4 4');
      await expect(selectionBox).toHaveAttribute('vector-effect', 'non-scaling-stroke');

      // 点击删除后 seed stroke 消失
      await deleteBtn.click();
      await expect(surface).toHaveAttribute('data-stroke-count', '0');
      await expect(preview).not.toContainText('seed-1');

      // 删除后按钮应再次 disabled
      await expect(deleteBtn).toBeDisabled();
      await expect(page.getByTestId('lasso-selection-count')).toHaveCount(0);
    });

    // 选区外拖拽应立即开始新的套索，而不是只清空选区。
    test('lasso: drag outside selection box clears old selection and starts new lasso', async ({ page }) => {
      const surface = page.getByTestId('drawing-surface-uncontrolled');
      const deleteBtn = page.getByTestId('lasso-delete-selected');

      await page.locator('button[data-tool="lasso"]').click();
      await expect(surface).toHaveAttribute('data-active-tool', 'lasso');

      const box = await surface.boundingBox();
      expect(box).not.toBeNull();

      // 第一次拖拽：用套索选中 seed stroke
      const startX1 = box!.x + 30;
      const startY1 = box!.y + 30;
      await page.mouse.move(startX1, startY1);
      await page.mouse.down();
      await page.mouse.move(box!.x + 170, box!.y + 30);
      await page.mouse.move(box!.x + 170, box!.y + 120);
      await page.mouse.move(box!.x + 30, box!.y + 120);
      await page.mouse.move(startX1, startY1);
      await page.mouse.up();

      const selectionBox = surface.locator('[data-testid="lasso-selection-box"]');
      await expect(selectionBox).toHaveCount(1);
      await expect(deleteBtn).toBeEnabled();
      await expect(page.getByTestId('lasso-selection-count')).toHaveText('(1)');

      // 第二次拖拽：从选区框外开始（seed stroke 位于画布 50~150, 50~100 区域，选区框会稍外扩）
      const startX2 = box!.x + 250;
      const startY2 = box!.y + 200;
      await page.mouse.move(startX2, startY2);
      await page.mouse.down();
      await page.mouse.move(startX2 + 60, startY2 + 60);

      // 旧选区应立即消失，并且新的套索预览应出现
      await expect(selectionBox).toHaveCount(0);
      const lassoPreview = surface.locator('[data-testid="lasso-preview"]');
      await expect(lassoPreview).toBeVisible();

      await page.mouse.up();
    });

  // 选区内拖拽应保持移动模式，不应新建套索。
  test('lasso: drag inside selection box moves selected strokes', async ({ page }) => {
    const surface = page.getByTestId('drawing-surface-uncontrolled');
    const deleteBtn = page.getByTestId('lasso-delete-selected');

    await page.locator('button[data-tool="lasso"]').click();
    await expect(surface).toHaveAttribute('data-active-tool', 'lasso');

    const box = await surface.boundingBox();
    expect(box).not.toBeNull();

    // 第一次拖拽：用套索选中 seed stroke
    const startX1 = box!.x + 30;
    const startY1 = box!.y + 30;
    await page.mouse.move(startX1, startY1);
    await page.mouse.down();
    await page.mouse.move(box!.x + 170, box!.y + 30);
    await page.mouse.move(box!.x + 170, box!.y + 120);
    await page.mouse.move(box!.x + 30, box!.y + 120);
    await page.mouse.move(startX1, startY1);
    await page.mouse.up();

    const selectionBox = surface.locator('[data-testid="lasso-selection-box"]');
    await expect(selectionBox).toHaveCount(1);
    await expect(deleteBtn).toBeEnabled();

    // 第二次拖拽：从选区框内部开始并移动
    const startX2 = box!.x + 100;
    const startY2 = box!.y + 75;
    await page.mouse.move(startX2, startY2);
    await page.mouse.down();
    await page.mouse.move(startX2 + 30, startY2 + 30);
    await page.mouse.up();

    // 选区应仍然存在，删除按钮仍可用
    await expect(selectionBox).toHaveCount(1);
    await expect(deleteBtn).toBeEnabled();
  });

  // Bug 2 回归：lasso 选中后切换到 pen 工具，选区应自动清空且选区框消失。
  test('lasso selection is cleared when switching to pen tool', async ({ page }) => {
    const surface = page.getByTestId('drawing-surface-uncontrolled');
    const deleteBtn = page.getByTestId('lasso-delete-selected');

    await expect(surface).toHaveAttribute('data-stroke-count', '1');

    await page.locator('button[data-tool="lasso"]').click();
    await expect(surface).toHaveAttribute('data-active-tool', 'lasso');

    const box = await surface.boundingBox();
    expect(box).not.toBeNull();

    const startX = box!.x + 30;
    const startY = box!.y + 30;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(box!.x + 170, box!.y + 30);
    await page.mouse.move(box!.x + 170, box!.y + 120);
    await page.mouse.move(box!.x + 30, box!.y + 120);
    await page.mouse.move(startX, startY);
    await page.mouse.up();

    await expect(deleteBtn).toBeEnabled();
    await expect(page.getByTestId('lasso-selection-count')).toHaveText('(1)');
    const selectionBox = surface.locator('[data-testid="lasso-selection-box"]');
    await expect(selectionBox).toHaveCount(1);

    await page.locator('button[data-tool="pen"]').click();
    await expect(surface).toHaveAttribute('data-active-tool', 'pen');

    await expect(selectionBox).toHaveCount(0);

    const pathOpacity = await surface.locator('svg').first().locator('path').evaluate((el) =>
      el.getAttribute('opacity'),
    );
    expect(pathOpacity).toBeNull();

    await page.locator('button[data-tool="lasso"]').click();
    await expect(deleteBtn).toBeDisabled();
  });

  });

  test.describe('pen tip snapping integration', () => {
    test('snap toggles default to off with radius 8', async ({ page }) => {
      await expect(page.getByTestId('snap-endpoints-toggle')).not.toBeChecked();
      await expect(page.getByTestId('snap-lines-toggle')).not.toBeChecked();
      await expect(page.getByTestId('snap-radius-input')).toHaveValue('8');
    });

    test('snaps to endpoints when enabled', async ({ page }) => {
      const surface = page.getByTestId('drawing-surface-controlled');
      const preview = page.getByTestId('drawing-preview-controlled');

      await page.locator('button[data-tool="pen"]').click();
      await page.getByTestId('snap-endpoints-toggle').check();

      const box = await surface.boundingBox();
      expect(box).not.toBeNull();

      const p1X = box!.x + 50;
      const p1Y = box!.y + 50;
      await page.mouse.move(p1X, p1Y);
      await page.mouse.down();
      await page.mouse.move(p1X + 50, p1Y + 50);
      await page.mouse.up();

      const p2X = p1X + 4;
      const p2Y = p1Y + 4;
      await page.mouse.move(p2X, p2Y);
      await page.mouse.down();
      await page.mouse.move(p2X + 50, p2Y);
      await page.mouse.up();

      const previewText = await preview.textContent();
      const parsed = JSON.parse(previewText!);

      expect(parsed.strokes.length).toBe(2);

      const firstStrokeStart = parsed.strokes[0].points[0];
      const secondStrokeStart = parsed.strokes[1].points[0];

      expect(secondStrokeStart.x).toBeCloseTo(firstStrokeStart.x, 1);
      expect(secondStrokeStart.y).toBeCloseTo(firstStrokeStart.y, 1);
    });

    test('snaps to lines when enabled', async ({ page }) => {
      const surface = page.getByTestId('drawing-surface-controlled');
      const preview = page.getByTestId('drawing-preview-controlled');

      await page.locator('button[data-tool="pen"]').click();
      await page.getByTestId('snap-lines-toggle').check();

      const box = await surface.boundingBox();
      expect(box).not.toBeNull();

      const p1X = box!.x + 50;
      const p1Y = box!.y + 100;
      await page.mouse.move(p1X, p1Y);
      await page.mouse.down();
      await page.mouse.move(p1X + 100, p1Y);
      await page.mouse.up();

      const p2X = p1X + 50;
      const p2Y = p1Y + 4;
      await page.mouse.move(p2X, p2Y);
      await page.mouse.down();
      await page.mouse.move(p2X, p2Y + 50);
      await page.mouse.up();

      const previewText = await preview.textContent();
      const parsed = JSON.parse(previewText!);

      expect(parsed.strokes.length).toBe(2);

      const secondStrokeStart = parsed.strokes[1].points[0];

      expect(secondStrokeStart.y).toBeCloseTo(100, 1);
    });

    test('snaps to ellipse outline when line snapping is enabled', async ({ page }) => {
      const surface = page.getByTestId('drawing-surface-controlled');
      const preview = page.getByTestId('drawing-preview-controlled');

      await page.locator('button[data-tool="ellipse"]').click();

      await dispatchPointerDrag(surface, {
        pointerId: 81,
        pointerType: 'mouse',
        start: { x: 100, y: 100 },
        moves: [{ x: 220, y: 180 }],
      });

      await page.locator('button[data-tool="pen"]').click();
      await page.getByTestId('snap-lines-toggle').check();

      await dispatchPointerDrag(surface, {
        pointerId: 82,
        pointerType: 'pen',
        start: { x: 160, y: 96 },
        moves: [{ x: 190, y: 96 }],
      });

      const parsed = await readPreview(preview);

      expect(parsed.strokes.length).toBe(2);

      const secondStrokeStart = parsed.strokes[1].points[0];
      expect(secondStrokeStart.x).toBeCloseTo(160, 1);
      expect(secondStrokeStart.y).toBeCloseTo(100, 1);
    });

    test('prefers endpoint over closer line projection when both are enabled', async ({ page }) => {
      const surface = page.getByTestId('drawing-surface-controlled');
      const preview = page.getByTestId('drawing-preview-controlled');

      await page.locator('button[data-tool="pen"]').click();

      await dispatchPointerDrag(surface, {
        pointerId: 83,
        pointerType: 'pen',
        start: { x: 100, y: 100 },
        moves: [{ x: 220, y: 100 }],
      });

      await page.getByTestId('snap-endpoints-toggle').check();
      await page.getByTestId('snap-lines-toggle').check();

      await dispatchPointerDrag(surface, {
        pointerId: 84,
        pointerType: 'pen',
        start: { x: 105, y: 103 },
        moves: [{ x: 150, y: 130 }],
      });

      const parsed = await readPreview(preview);

      expect(parsed.strokes.length).toBe(2);

      const secondStrokeStart = parsed.strokes[1].points[0];
      expect(secondStrokeStart.x).toBeCloseTo(100, 1);
      expect(secondStrokeStart.y).toBeCloseTo(100, 1);
    });

    test('respects custom radius', async ({ page }) => {
      const surface = page.getByTestId('drawing-surface-controlled');
      const preview = page.getByTestId('drawing-preview-controlled');

      await page.locator('button[data-tool="pen"]').click();
      await page.getByTestId('snap-endpoints-toggle').check();
      await page.getByTestId('snap-radius-input').fill('20');

      const box = await surface.boundingBox();
      expect(box).not.toBeNull();

      const p1X = box!.x + 50;
      const p1Y = box!.y + 50;
      await page.mouse.move(p1X, p1Y);
      await page.mouse.down();
      await page.mouse.move(p1X + 50, p1Y + 50);
      await page.mouse.up();

      const p2X = p1X + 15;
      const p2Y = p1Y;
      await page.mouse.move(p2X, p2Y);
      await page.mouse.down();
      await page.mouse.move(p2X + 50, p2Y);
      await page.mouse.up();

      const p3X = p1X + 25;
      const p3Y = p1Y;
      await page.mouse.move(p3X, p3Y);
      await page.mouse.down();
      await page.mouse.move(p3X + 50, p3Y);
      await page.mouse.up();

      const previewText = await preview.textContent();
      const parsed = JSON.parse(previewText!);

      expect(parsed.strokes.length).toBe(3);

      const firstStrokeStart = parsed.strokes[0].points[0];
      const secondStrokeStart = parsed.strokes[1].points[0];
      const thirdStrokeStart = parsed.strokes[2].points[0];

      expect(secondStrokeStart.x).toBeCloseTo(firstStrokeStart.x, 1);
      expect(secondStrokeStart.y).toBeCloseTo(firstStrokeStart.y, 1);

      expect(thirdStrokeStart.x).toBeCloseTo(p3X - box!.x, 1);
      expect(thirdStrokeStart.y).toBeCloseTo(p3Y - box!.y, 1);
    });

    test('uses raw coordinates when toggles are off', async ({ page }) => {
      const surface = page.getByTestId('drawing-surface-controlled');
      const preview = page.getByTestId('drawing-preview-controlled');

      await page.locator('button[data-tool="pen"]').click();
      await expect(page.getByTestId('snap-endpoints-toggle')).not.toBeChecked();
      await expect(page.getByTestId('snap-lines-toggle')).not.toBeChecked();

      const box = await surface.boundingBox();
      expect(box).not.toBeNull();

      const p1X = box!.x + 50;
      const p1Y = box!.y + 50;
      await page.mouse.move(p1X, p1Y);
      await page.mouse.down();
      await page.mouse.move(p1X + 50, p1Y + 50);
      await page.mouse.up();

      const p2X = p1X + 4;
      const p2Y = p1Y + 4;
      await page.mouse.move(p2X, p2Y);
      await page.mouse.down();
      await page.mouse.move(p2X + 50, p2Y);
      await page.mouse.up();

      const previewText = await preview.textContent();
      const parsed = JSON.parse(previewText!);

      expect(parsed.strokes.length).toBe(2);
      
      const firstStrokeStart = parsed.strokes[0].points[0];
      const secondStrokeStart = parsed.strokes[1].points[0];
      
      expect(secondStrokeStart.x).not.toBeCloseTo(firstStrokeStart.x, 1);
      expect(secondStrokeStart.y).not.toBeCloseTo(firstStrokeStart.y, 1);
      expect(secondStrokeStart.x).toBeCloseTo(p2X - box!.x, 1);
      expect(secondStrokeStart.y).toBeCloseTo(p2Y - box!.y, 1);
    });
  });
  test.describe('ruler overlay', () => {
    test('toggle shows ruler and keeps tool', async ({ page }) => {
      const toggleBtn = page.getByTestId('drawing-ruler-toggle').first();
      const toolSelect = page.getByTestId('drawing-tool-select');
      const uncontrolled = page.getByTestId('drawing-surface-uncontrolled');
      const controlled = page.getByTestId('drawing-surface-controlled');

      await toolSelect.selectOption('pen');
      await toggleBtn.click();

      await expect(toolSelect).toHaveValue('pen');
      await expect(uncontrolled.getByTestId('drawing-ruler')).toBeVisible();
      await expect(controlled.getByTestId('drawing-ruler')).toBeVisible();
    });

    test('visual constants', async ({ page }) => {
      const toggleBtn = page.getByTestId('drawing-ruler-toggle').first();
      await toggleBtn.click();

      const uncontrolled = page.getByTestId('drawing-surface-uncontrolled');
      const rulerBg = uncontrolled.getByTestId('drawing-ruler-background');

      const fillOpacity = await rulerBg.getAttribute('fill-opacity');
      expect(fillOpacity).toBe('0.2');

      const labels = await uncontrolled.locator('text[fill="black"]').allInnerTexts();
      for (const label of labels) {
        expect(String(label).startsWith('-')).toBe(false);
      }

      const centerTick = uncontrolled.getByTestId('drawing-ruler-center-tick');
      const centerLabel = await centerTick.locator('+ text').textContent();
      expect(centerLabel?.trim()).toBe('0');
    });

    test('geometry attributes numeric', async ({ page }) => {
      const toggleBtn = page.getByTestId('drawing-ruler-toggle').first();
      await toggleBtn.click();

      const ruler = page.getByTestId('drawing-surface-uncontrolled').getByTestId('drawing-ruler');

      for (const attr of ['data-ruler-center-x', 'data-ruler-center-y', 'data-ruler-rotation', 'data-ruler-length', 'data-ruler-height']) {
        const val = await ruler.getAttribute(attr);
        expect(val).not.toBeNull();
        expect(Number.isFinite(parseFloat(val!))).toBe(true);
      }
    });

    test('draw outside ruler is normal', async ({ page }) => {
      const toggleBtn = page.getByTestId('drawing-ruler-toggle').first();
      await toggleBtn.click();

      const surface = page.getByTestId('drawing-surface-uncontrolled');
      const preview = page.getByTestId('drawing-preview-uncontrolled');
      const ruler = surface.getByTestId('drawing-ruler');

      const cx = parseFloat((await ruler.getAttribute('data-ruler-center-x'))!);
      const cy = parseFloat((await ruler.getAttribute('data-ruler-center-y'))!);
      const height = parseFloat((await ruler.getAttribute('data-ruler-height'))!);

      const drawY = cy + height + 50;

      await dispatchPointerDrag(surface, {
        pointerId: 98,
        pointerType: 'mouse',
        start: { x: cx - 50, y: drawY },
        moves: [{ x: cx + 50, y: drawY }],
      });
      await page.waitForTimeout(100);

      const previewText = await preview.textContent();
      const parsed = JSON.parse(previewText!);
      expect(parsed.strokes.length).toBeGreaterThan(1);
      const lastStroke = parsed.strokes[parsed.strokes.length - 1];

      for (const pt of lastStroke.points) {
        expect(Math.abs(pt.y - cy)).toBeGreaterThan(height / 2);
      }
    });

    test('draw inside horizontal ruler is projected', async ({ page }) => {
      const toggleBtn = page.getByTestId('drawing-ruler-toggle').first();
      await toggleBtn.click();

      const surface = page.getByTestId('drawing-surface-uncontrolled');
      const preview = page.getByTestId('drawing-preview-uncontrolled');
      const ruler = surface.getByTestId('drawing-ruler');

      const cx = parseFloat((await ruler.getAttribute('data-ruler-center-x'))!);
      const cy = parseFloat((await ruler.getAttribute('data-ruler-center-y'))!);
      const height = parseFloat((await ruler.getAttribute('data-ruler-height'))!);

      const drawY = cy + height / 4;

      await dispatchPointerDrag(surface, {
        pointerId: 99,
        pointerType: 'mouse',
        start: { x: cx - 20, y: drawY },
        moves: [{ x: cx + 50, y: drawY }],
      });
      await page.waitForTimeout(100);

      const previewText = await preview.textContent();
      const parsed = JSON.parse(previewText!);
      expect(parsed.strokes.length).toBeGreaterThan(1);
      const lastStroke = parsed.strokes[parsed.strokes.length - 1];

      for (const pt of lastStroke.points) {
        expect(Math.abs(pt.y - cy)).toBeLessThan(1);
      }
    });

    test('disable ruler restores normal drawing', async ({ page }) => {
      const toggleBtn = page.getByTestId('drawing-ruler-toggle').first();
      await toggleBtn.click();

      const surface = page.getByTestId('drawing-surface-uncontrolled');
      const preview = page.getByTestId('drawing-preview-uncontrolled');
      const ruler = surface.getByTestId('drawing-ruler');

      const cx = parseFloat((await ruler.getAttribute('data-ruler-center-x'))!);
      const cy = parseFloat((await ruler.getAttribute('data-ruler-center-y'))!);
      const height = parseFloat((await ruler.getAttribute('data-ruler-height'))!);

      await toggleBtn.click();

      const drawY = cy + height / 4;

      await dispatchPointerDrag(surface, {
        pointerId: 100,
        pointerType: 'mouse',
        start: { x: cx - 50, y: drawY },
        moves: [{ x: cx + 50, y: drawY }],
      });
      await page.waitForTimeout(100);

      const previewText = await preview.textContent();
      const parsed = JSON.parse(previewText!);
      expect(parsed.strokes.length).toBeGreaterThan(1);
      const lastStroke = parsed.strokes[parsed.strokes.length - 1];

      for (const pt of lastStroke.points) {
        expect(Math.abs(pt.y - cy)).toBeGreaterThan(5);
      }
    });

    test('grip drag changes transform without stroke', async ({ page }) => {
      const toggleBtn = page.getByTestId('drawing-ruler-toggle').first();
      await toggleBtn.click();

      const surface = page.getByTestId('drawing-surface-uncontrolled');
      const preview = page.getByTestId('drawing-preview-uncontrolled');
      const ruler = surface.getByTestId('drawing-ruler');
      const grip = surface.getByTestId('drawing-ruler-drag-grip');

      const startCx = parseFloat((await ruler.getAttribute('data-ruler-center-x'))!);
      const startCy = parseFloat((await ruler.getAttribute('data-ruler-center-y'))!);

      const gripBox = await grip.boundingBox();
      expect(gripBox).not.toBeNull();

      const previewBefore = await preview.textContent();

      await dispatchPointerDrag(grip, {
        pointerId: 101,
        pointerType: 'mouse',
        start: { x: gripBox!.width / 2, y: gripBox!.height / 2 },
        moves: [{ x: gripBox!.width / 2 + 50, y: gripBox!.height / 2 + 50 }],
      });

      const endCx = parseFloat((await ruler.getAttribute('data-ruler-center-x'))!);
      const endCy = parseFloat((await ruler.getAttribute('data-ruler-center-y'))!);

      expect(endCx).not.toBe(startCx);
      expect(endCy).not.toBe(startCy);

      const previewAfter = await preview.textContent();
      expect(previewAfter).toBe(previewBefore);
    });
  });
});
