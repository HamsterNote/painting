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
    await expect(page.getByTestId('panel-eraser')).toBeVisible();
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

    await expect(page.getByTestId('eraser-commit-mode')).toBeVisible();
    await expect(page.getByTestId('eraser-trajectory-visible')).toBeVisible();
    await expect(page.getByTestId('eraser-trajectory-color')).toBeVisible();
    await expect(page.getByTestId('eraser-trajectory-line-width')).toBeVisible();

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

  // Task 8: two-finger pinch behavior-lock test.
  //
  // Strategy: CDP `Input.dispatchTouchEvent` is the most reliable way to drive
  // genuine multi-touch in headless Chromium because Playwright's `page.touchscreen`
  // only models a single touch point. We open a CDP session against the controlled
  // surface page, enable pan + pinch-zoom gestures, then dispatch touchStart,
  // touchMove, touchEnd with two concrete touch points whose distance ratio is
  // 1.4 (start 100px apart at y=100, end 140px apart at y=110, so scale ratio = 1.4).
  //
  // The center moves from (150, 100) to (160, 110) producing a 10/10 px center
  // delta in screen space, so we assert data-scale != "1" AND at least one of
  // data-tx / data-ty changed from "0" (the DrawingSurface viewport formula
  // also folds the focal-point translation into tx/ty so the canvas point under
  // the original center stays anchored).
  //
  // `hasTouch: true` is enabled at the describe level below so the browser
  // context advertises touch support; CDP itself doesn't strictly require it
  // but it prevents Chromium from short-circuiting touch handlers.
  test.describe('two-finger gestures', () => {
    test.use({ hasTouch: true });

    test('two-finger pinch changes viewport transform', async ({ page }) => {
      // Enable the gesture toggles. They are unchecked by default in the playground.
      await page.getByTestId('gesture-pan-toggle').check();
      await page.getByTestId('gesture-pinch-zoom-toggle').check();
      await expect(page.getByTestId('gesture-pan-toggle')).toBeChecked();
      await expect(page.getByTestId('gesture-pinch-zoom-toggle')).toBeChecked();

      const surface = page.getByTestId('drawing-surface-controlled');
      await expect(surface).toBeVisible();

      // Baseline viewport: surface should advertise identity transform.
      await expect(surface).toHaveAttribute('data-scale', '1');
      await expect(surface).toHaveAttribute('data-tx', '0');
      await expect(surface).toHaveAttribute('data-ty', '0');

      const box = await surface.boundingBox();
      expect(box).not.toBeNull();

      // Start: touches 100px apart centered at (x+150, y+100).
      // End:   touches 140px apart centered at (x+160, y+110).
      // Distance ratio = 140/100 = 1.4 -> requested scale = 1.4 (within clamp).
      const startA = { x: box!.x + 100, y: box!.y + 100 };
      const startB = { x: box!.x + 200, y: box!.y + 100 };
      const endA = { x: box!.x + 90, y: box!.y + 110 };
      const endB = { x: box!.x + 230, y: box!.y + 110 };

      // CDP fallback: open a session against the page and dispatch genuine
      // multi-touch events. `Input.dispatchTouchEvent` is the only API surface
      // in Playwright/Chromium that supports >1 simultaneous touch point.
      const cdp = await page.context().newCDPSession(page);

      // touchStart with both fingers down. CDP requires both points in a single
      // payload for the simultaneous-down case.
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [
          { x: startA.x, y: startA.y, id: 1 },
          { x: startB.x, y: startB.y, id: 2 },
        ],
      });

      // A small intermediate move halfway between start and end smoothes the
      // adapter's pose accumulation so the snapshot is well-formed before the
      // final move (mirrors how a real pinch produces multiple samples).
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: (startA.x + endA.x) / 2, y: (startA.y + endA.y) / 2, id: 1 },
          { x: (startB.x + endB.x) / 2, y: (startB.y + endB.y) / 2, id: 2 },
        ],
      });

      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: endA.x, y: endA.y, id: 1 },
          { x: endB.x, y: endB.y, id: 2 },
        ],
      });

      // Release. Note CDP touchEnd payload is just the remaining points (empty here).
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });

      await cdp.detach();

      // Assert viewport mutated. Scale must have moved away from 1 (we expect
      // ~1.4) and the translation should also have shifted from the identity
      // origin because the two-finger center moved by (10, 10) AND the focal
      // point zoom around the start center contributes additional tx/ty.
      const scaleAttr = await surface.getAttribute('data-scale');
      const txAttr = await surface.getAttribute('data-tx');
      const tyAttr = await surface.getAttribute('data-ty');
      expect(scaleAttr).not.toBeNull();
      expect(scaleAttr).not.toBe('1');
      expect(Number(scaleAttr)).toBeGreaterThan(1);
      expect(txAttr !== '0' || tyAttr !== '0').toBe(true);

      // Persist a screenshot as evidence so the run is auditable from the
      // .omo/evidence directory.
      await page.screenshot({ path: '.omo/evidence/task-8-pinch-after.png' });
    });
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
    const trajectoryLineWidth = page.getByTestId('eraser-trajectory-line-width');
    await expect(commitMode).toBeVisible();
    await expect(trajectoryVisible).toBeVisible();
    await expect(trajectoryColor).toBeVisible();
    await expect(trajectoryLineWidth).toBeVisible();

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
    await trajectoryLineWidth.fill('3');
    await expect(trajectoryVisible).toBeChecked();
    await expect(trajectoryLineWidth).toHaveValue('3');

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
    await expect(trajectory).toHaveAttribute('stroke-width', '3');

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
});
