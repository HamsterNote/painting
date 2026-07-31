import { expect, type Locator, type Page, test } from '@playwright/test';

async function enableRuler(page: Page): Promise<{
  readonly surface: Locator;
  readonly overlay: Locator;
  readonly ruler: Locator;
  readonly background: Locator;
}> {
  const toggle = page.getByTestId('drawing-ruler-toggle').first();
  await toggle.click();

  const surface = page.getByTestId('drawing-surface-uncontrolled');
  await surface.scrollIntoViewIfNeeded();
  const overlay = surface.getByTestId('drawing-ruler-overlay');
  const ruler = surface.getByTestId('drawing-ruler');
  const background = surface.getByTestId('drawing-ruler-background');
  await expect(ruler).toBeVisible();

  return { surface, overlay, ruler, background };
}

async function readRulerCenter(
  ruler: Locator
): Promise<{ readonly x: number; readonly y: number }> {
  return {
    x: Number(await ruler.getAttribute('data-ruler-center-x')),
    y: Number(await ruler.getAttribute('data-ruler-center-y')),
  };
}

test.describe('ruler first-phase browser contract', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('clips an endpoint-free physical ruler to the drawing surface', async ({ page }) => {
    const { surface, overlay, ruler, background } = await enableRuler(page);
    const surfaceBox = await surface.boundingBox();
    expect(surfaceBox).not.toBeNull();
    if (!surfaceBox) return;

    expect(Number(await ruler.getAttribute('data-ruler-length'))).toBeGreaterThan(
      Math.hypot(surfaceBox.width, surfaceBox.height) * 2
    );
    await expect(ruler).toHaveAttribute('data-ruler-height', '48');
    await expect(ruler).toHaveAttribute('data-ruler-rotation', '0');
    await expect(overlay).toHaveCSS('overflow', 'hidden');
    await expect(overlay).toHaveCSS('pointer-events', 'none');
    await expect(overlay).toHaveCSS('z-index', '0');
    await expect(background).toHaveAttribute('fill-opacity', '0.2');
    await expect(background).not.toHaveAttribute('stroke', /.+/);
    await expect(background).not.toHaveAttribute('rx', /.+/);
    await expect(ruler.locator('rect')).toHaveCount(1);
    await expect(ruler.locator('circle')).toHaveCount(0);
    await expect(ruler.getByTestId('drawing-ruler-ticks')).toHaveAttribute(
      'pointer-events',
      'none'
    );
    expect(await ruler.locator('line').count()).toBeGreaterThan(100);
    await expect(ruler.locator('text')).toHaveCount(0);

    const backgroundBox = await background.boundingBox();
    expect(backgroundBox).not.toBeNull();
    if (!backgroundBox) return;
    expect(backgroundBox.x).toBeLessThan(surfaceBox.x);
    expect(backgroundBox.x + backgroundBox.width).toBeGreaterThan(surfaceBox.x + surfaceBox.width);
  });

  test('keeps the same screen-space ruler layout when virtual-paper zoom changes', async ({
    page,
  }) => {
    const virtualPaperToggle = page.getByTestId('drawing-virtualpaper-toggle');
    await virtualPaperToggle.click();
    const { surface, ruler } = await enableRuler(page);
    const initialTransform = await ruler.getAttribute('transform');
    const initialLength = await ruler.getAttribute('data-ruler-length');
    const surfaceBox = await surface.boundingBox();
    expect(surfaceBox).not.toBeNull();
    if (!surfaceBox) return;
    const center = await readRulerCenter(ruler);

    await page.mouse.move(surfaceBox.x + surfaceBox.width * 0.2, surfaceBox.y + center.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -240);
    await page.keyboard.up('Control');

    await expect.poll(() => surface.getAttribute('data-scale')).not.toBe('1');
    await expect(ruler).toHaveAttribute('transform', initialTransform ?? '');
    await expect(ruler).toHaveAttribute('data-ruler-length', initialLength ?? '');
    await expect(ruler.getByTestId('drawing-ruler-ticks')).toHaveCSS('user-select', 'none');
  });

  test('plain mouse drag draws without translating the ruler', async ({ page }) => {
    const { surface, ruler } = await enableRuler(page);
    const strokeCount = await surface.getAttribute('data-stroke-count');
    const initialCenter = await readRulerCenter(ruler);
    const box = await surface.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // 避开 playground 右下角的 minimap 覆盖层，确保真实指针命中尺子矩形。
    const startX = box.x + box.width * 0.2;
    const startY = box.y + initialCenter.y;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 30, startY + 18, { steps: 4 });
    await page.mouse.up();

    const centerAfterDrawing = await readRulerCenter(ruler);
    expect(centerAfterDrawing).toEqual(initialCenter);
    await expect(surface).toHaveAttribute(
      'data-stroke-count',
      String(Number(strokeCount) + 1)
    );
  });

  test('re-arms after leaving so one drawing gesture can constrain again on re-entry', async ({
    page,
  }) => {
    const smoothingToggle = page.getByTestId('drawing-smoothing-toggle');
    await smoothingToggle.uncheck();
    const { surface, ruler } = await enableRuler(page);
    const preview = page.getByTestId('drawing-preview-uncontrolled');
    const surfaceBox = await surface.boundingBox();
    expect(surfaceBox).not.toBeNull();
    if (!surfaceBox) return;
    const center = await readRulerCenter(ruler);
    const height = Number(await ruler.getAttribute('data-ruler-height'));
    const selectedEdgeY = center.y - height / 2;

    // Given：起点位于水平尺子的上侧，最近的物理尺边是上边。
    const start = {
      x: surfaceBox.x + center.x - 80,
      y: surfaceBox.y + selectedEdgeY - 24,
    };

    const oppositeEdgeY = center.y + height / 2;

    // When：指针先跨入尺身、从另一侧离开，再在同一次按压中从下方重新进入。
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 80, surfaceBox.y + center.y, { steps: 4 });
    await page.mouse.move(start.x + 160, surfaceBox.y + center.y + height, { steps: 4 });
    await page.mouse.move(start.x + 220, surfaceBox.y + center.y, { steps: 4 });
    await page.mouse.move(start.x + 260, surfaceBox.y + center.y - height, { steps: 4 });
    await page.mouse.up();

    const points = await preview.evaluate((element) => {
      const value: unknown = JSON.parse(element.textContent ?? '{}');
      if (typeof value !== 'object' || value === null || !('strokes' in value)) return [];
      const strokes = value.strokes;
      if (!Array.isArray(strokes) || strokes.length === 0) return [];
      const stroke: unknown = strokes[strokes.length - 1];
      if (typeof stroke !== 'object' || stroke === null || !('points' in stroke)) return [];
      if (!Array.isArray(stroke.points)) return [];
      return stroke.points.flatMap((point: unknown) => {
        if (
          typeof point !== 'object' ||
          point === null ||
          !('x' in point) ||
          !('y' in point) ||
          typeof point.x !== 'number' ||
          typeof point.y !== 'number'
        ) {
          return [];
        }
        return [{ x: point.x, y: point.y }];
      });
    });

    // Then：首次进入吸到上边，离尺段保持自由；再次进入后改吸到下边。
    const firstLockedPoint = points.findIndex((point) =>
      Number.isFinite(point.y) && Math.abs(point.y - selectedEdgeY) < 0.01
    );
    expect(firstLockedPoint).toBeGreaterThan(0);
    let lastLockedPoint = -1;
    for (let index = points.length - 1; index >= 0; index -= 1) {
      const point = points[index];
      if (point && Number.isFinite(point.y) && Math.abs(point.y - selectedEdgeY) < 0.01) {
        lastLockedPoint = index;
        break;
      }
    }
    expect(lastLockedPoint).toBeGreaterThan(firstLockedPoint);
    for (const point of points.slice(firstLockedPoint, lastLockedPoint + 1)) {
      expect(point.y).toBeCloseTo(selectedEdgeY, 4);
    }
    const firstRelockedPoint = points.findIndex(
      (point, index) => index > lastLockedPoint && Math.abs(point.y - oppositeEdgeY) < 0.01
    );
    expect(firstRelockedPoint).toBeGreaterThan(lastLockedPoint);
    expect(points.slice(lastLockedPoint + 1, firstRelockedPoint)).toContainEqual(
      expect.objectContaining({ y: expect.any(Number) })
    );
    expect(points[firstRelockedPoint]?.y).toBeCloseTo(oppositeEdgeY, 4);
    expect(points[points.length - 1]?.y).toBeLessThan(selectedEdgeY);
  });

  test('renders the ruler below the relative PaintingBoard toolbar', async ({ page }) => {
    const boardCountToggle = page.getByTestId('painting-controller-board-count-toggle');
    await boardCountToggle.click();
    await expect(boardCountToggle).toHaveText('画板 ×1');

    const toolbar = page.getByTestId('painting-board-toolbar');
    await toolbar.getByTestId('painting-board-more-btn').click();
    await page.getByTestId('painting-board-ruler-toggle').click();

    const boardSurface = page.getByTestId('painting-board-demo-a');
    const overlay = boardSurface.getByTestId('drawing-ruler-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveCSS('z-index', '0');
    await expect(toolbar).toHaveCSS('z-index', '1');
  });

  test('keeps both visual endpoints outside the clipped surface after extreme translation', async ({
    page,
  }) => {
    const { surface, ruler, background } = await enableRuler(page);
    const initialCenter = await readRulerCenter(ruler);
    const initialTx = await surface.getAttribute('data-tx');
    const initialTy = await surface.getAttribute('data-ty');
    const surfaceBox = await surface.boundingBox();
    expect(surfaceBox).not.toBeNull();
    if (!surfaceBox) return;
    const startX = surfaceBox.x + surfaceBox.width * 0.75;
    const startY = surfaceBox.y + initialCenter.y;

    await page.keyboard.down('Control');
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + surfaceBox.width * 2, startY, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Control');

    const translatedCenter = await readRulerCenter(ruler);
    expect(translatedCenter.x - initialCenter.x).toBeCloseTo(surfaceBox.width * 2, 4);
    expect(translatedCenter.y).toBeCloseTo(initialCenter.y, 4);
    await expect(surface).toHaveAttribute('data-tx', initialTx ?? '');
    await expect(surface).toHaveAttribute('data-ty', initialTy ?? '');
    const backgroundBox = await background.boundingBox();
    expect(backgroundBox).not.toBeNull();
    if (!backgroundBox) return;
    expect(backgroundBox.x).toBeLessThan(surfaceBox.x);
    expect(backgroundBox.x + backgroundBox.width).toBeGreaterThan(surfaceBox.x + surfaceBox.width);
    await expect(ruler.locator('text')).toHaveCount(0);
  });

  test('routes Alt rotation through the overlapped minimap without moving the viewport', async ({
    page,
  }) => {
    const { surface, ruler } = await enableRuler(page);
    const surfaceBox = await surface.boundingBox();
    expect(surfaceBox).not.toBeNull();
    if (!surfaceBox) return;
    const viewportSize = await surface.evaluate((element) => ({
      width: element.clientWidth,
      height: element.clientHeight,
      left: element.clientLeft,
      top: element.clientTop,
    }));
    const pivot = {
      x: surfaceBox.x + viewportSize.left + viewportSize.width / 2,
      y: surfaceBox.y + viewportSize.top + viewportSize.height / 2,
    };
    const start = {
      x: surfaceBox.x + viewportSize.width * 0.75,
      y: pivot.y,
    };
    const initialTx = await surface.getAttribute('data-tx');
    const initialTy = await surface.getAttribute('data-ty');

    await page.keyboard.down('Alt');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(pivot.x, pivot.y + (start.x - pivot.x), { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Alt');

    await expect
      .poll(async () => Number(await ruler.getAttribute('data-ruler-rotation')))
      .toBeCloseTo(Math.PI / 2, 4);
    await expect(surface).toHaveAttribute('data-tx', initialTx ?? '');
    await expect(surface).toHaveAttribute('data-ty', initialTy ?? '');
  });

  test('Alt left drag rotates around the clipped visible centerline midpoint', async ({
    page,
  }) => {
    const { surface, ruler } = await enableRuler(page);
    const surfaceBox = await surface.boundingBox();
    expect(surfaceBox).not.toBeNull();
    if (!surfaceBox) return;
    const surfaceViewport = await surface.evaluate((element) => ({
      width: element.clientWidth,
      left: element.clientLeft,
      top: element.clientTop,
    }));
    const initialCenter = await readRulerCenter(ruler);
    const contentLeft = surfaceBox.x + surfaceViewport.left;
    const contentTop = surfaceBox.y + surfaceViewport.top;

    // Given：先把水平尺子的逻辑原点向右、向上各平移 100px，使它偏离可视段中心。
    const translateStartX = contentLeft + surfaceViewport.width * 0.2;
    await page.keyboard.down('Control');
    await page.mouse.move(translateStartX, contentTop + initialCenter.y);
    await page.mouse.down();
    await page.mouse.move(translateStartX + 100, contentTop + initialCenter.y - 100, {
      steps: 4,
    });
    await page.mouse.up();
    await page.keyboard.up('Control');
    const translatedCenter = await readRulerCenter(ruler);
    const pivot = {
      x: contentLeft + surfaceViewport.width / 2,
      y: contentTop + translatedCenter.y,
    };

    // When：从尺子上的点开始 Alt+左键拖拽四分之一圈。
    const rotationStart = {
      x: contentLeft + surfaceViewport.width * 0.2,
      y: contentTop + translatedCenter.y,
    };
    const startVector = {
      x: rotationStart.x - pivot.x,
      y: rotationStart.y - pivot.y,
    };
    await page.keyboard.down('Alt');
    await page.mouse.move(rotationStart.x, rotationStart.y);
    await page.mouse.down();
    await page.mouse.move(pivot.x - startVector.y, pivot.y + startVector.x, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Alt');

    // Then：角度增加 90°，逻辑原点作为刚体绕可见裁切段中点旋转。
    await expect
      .poll(async () => Number(await ruler.getAttribute('data-ruler-rotation')))
      .toBeCloseTo(Math.PI / 2, 4);
    const rotatedCenter = await readRulerCenter(ruler);
    expect(rotatedCenter.x).toBeCloseTo(surfaceViewport.width / 2, 4);
    expect(rotatedCenter.y).toBeCloseTo(translatedCenter.y + 100, 4);

    // Given/When/Then：画布外的 Alt 拖动不会再次改变尺子。
    const rotationBeforeMiss = await ruler.getAttribute('data-ruler-rotation');
    await page.keyboard.down('Alt');
    await page.mouse.move(surfaceBox.x - 20, surfaceBox.y - 20);
    await page.mouse.down();
    await page.mouse.move(surfaceBox.x - 60, surfaceBox.y - 60);
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await expect(ruler).toHaveAttribute('data-ruler-rotation', rotationBeforeMiss ?? '');
  });

  test('Alt rotation stays free outside the snap tolerance', async ({ page }) => {
    const { surface, ruler } = await enableRuler(page);
    const surfaceBox = await surface.boundingBox();
    expect(surfaceBox).not.toBeNull();
    if (!surfaceBox) return;
    const viewportSize = await surface.evaluate((element) => ({
      width: element.clientWidth,
      left: element.clientLeft,
      top: element.clientTop,
    }));
    const initialCenter = await readRulerCenter(ruler);
    const pivot = {
      x: surfaceBox.x + viewportSize.left + viewportSize.width / 2,
      y: surfaceBox.y + viewportSize.top + initialCenter.y,
    };
    const radius = viewportSize.width / 4;

    // Given / When: 从水平尺子开始旋转 30°，该角度不在 0° 或 45° 的吸附范围内。
    await page.keyboard.down('Alt');
    await page.mouse.move(pivot.x + radius, pivot.y);
    await page.mouse.down();
    await page.mouse.move(
      pivot.x + radius * Math.cos(Math.PI / 6),
      pivot.y + radius * Math.sin(Math.PI / 6),
      { steps: 8 }
    );
    await page.mouse.up();
    await page.keyboard.up('Alt');

    // Then: 尺子保持 30° 自由角度，不跳到相邻的 45°。
    await expect
      .poll(async () => Number(await ruler.getAttribute('data-ruler-rotation')))
      .toBeCloseTo(Math.PI / 6, 2);
  });

  test('two ruler touches translate by their midpoint while an ignored third touch cannot interrupt them', async ({
    page,
  }) => {
    const { ruler, background } = await enableRuler(page);
    const initialCenter = await readRulerCenter(ruler);
    const initialTx = await page.getByTestId('drawing-surface-uncontrolled').getAttribute('data-tx');
    const initialTy = await page.getByTestId('drawing-surface-uncontrolled').getAttribute('data-ty');

    await background.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const dispatch = (
        target: EventTarget,
        type: string,
        pointerId: number,
        clientX: number,
        clientY: number
      ) => {
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId,
            pointerType: 'touch',
            button: 0,
            buttons: type === 'pointerup' ? 0 : 1,
            clientX,
            clientY,
          })
        );
      };

      const y = rect.y + rect.height / 2;
      const firstX = rect.x + rect.width * 0.4;
      const secondX = rect.x + rect.width * 0.6;
      dispatch(element, 'pointerdown', 41, firstX, y);
      dispatch(document, 'pointermove', 41, firstX + 25, y + 10);

      dispatch(element, 'pointerdown', 42, secondX, y);
      dispatch(document, 'pointermove', 41, firstX + 40, y + 24);
      dispatch(document, 'pointermove', 42, secondX + 40, y + 24);
      dispatch(element, 'pointerdown', 43, (firstX + secondX) / 2, y);
      dispatch(document, 'pointerup', 43, (firstX + secondX) / 2, y);
      dispatch(document, 'pointermove', 41, firstX + 50, y + 30);
      dispatch(document, 'pointermove', 42, secondX + 50, y + 30);
      dispatch(document, 'pointerup', 41, firstX + 50, y + 30);
      dispatch(document, 'pointerup', 42, secondX + 50, y + 30);
    });

    const translatedCenter = await readRulerCenter(ruler);
    expect(translatedCenter.x - initialCenter.x).toBeCloseTo(37.5, 4);
    expect(translatedCenter.y - initialCenter.y).toBeCloseTo(25, 4);
    await expect(page.getByTestId('drawing-surface-uncontrolled')).toHaveAttribute(
      'data-tx',
      initialTx ?? ''
    );
    await expect(page.getByTestId('drawing-surface-uncontrolled')).toHaveAttribute(
      'data-ty',
      initialTy ?? ''
    );
  });

  test('one ruler touch does not move the ruler or viewport', async ({ page }) => {
    const { surface, ruler, background } = await enableRuler(page);
    const initialCenter = await readRulerCenter(ruler);
    const initialTx = await surface.getAttribute('data-tx');
    const initialTy = await surface.getAttribute('data-ty');

    await background.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const dispatch = (target: EventTarget, type: string, clientX: number, clientY: number) => {
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId: 61,
            pointerType: 'touch',
            button: 0,
            buttons: type === 'pointerup' ? 0 : 1,
            clientX,
            clientY,
          })
        );
      };
      const startX = rect.x + rect.width / 2;
      const startY = rect.y + rect.height / 2;
      dispatch(element, 'pointerdown', startX, startY);
      dispatch(document, 'pointermove', startX + 36, startY + 22);
      dispatch(document, 'pointerup', startX + 36, startY + 22);
    });

    expect(await readRulerCenter(ruler)).toEqual(initialCenter);
    await expect(surface).toHaveAttribute('data-tx', initialTx ?? '');
    await expect(surface).toHaveAttribute('data-ty', initialTy ?? '');
  });

  test('two ruler touches keep the projected initial midpoint as the fixed angle anchor', async ({
    page,
  }) => {
    const { surface, ruler, background } = await enableRuler(page);
    const surfaceBox = await surface.boundingBox();
    expect(surfaceBox).not.toBeNull();
    if (!surfaceBox) return;
    const clientOrigin = await surface.evaluate((element) => ({
      left: element.clientLeft,
      top: element.clientTop,
    }));
    const initialCenter = await readRulerCenter(ruler);
    const gestureCenter = {
      x: surfaceBox.x + clientOrigin.left + initialCenter.x + 50,
      y: surfaceBox.y + clientOrigin.top + initialCenter.y + 10,
    };

    await background.evaluate((element, center) => {
      const dispatch = (
        target: EventTarget,
        type: string,
        pointerId: number,
        clientX: number,
        clientY: number
      ) => {
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId,
            pointerType: 'touch',
            button: 0,
            buttons: type === 'pointerup' ? 0 : 1,
            clientX,
            clientY,
          })
        );
      };

      dispatch(element, 'pointerdown', 51, center.x - 40, center.y);
      dispatch(element, 'pointerdown', 52, center.x + 40, center.y);
    }, gestureCenter);

    const feedback = surface.getByTestId('drawing-ruler-angle-feedback');
    await expect(feedback).toBeVisible();
    const initialAnchor = {
      x: Number(await feedback.getAttribute('data-feedback-x')),
      y: Number(await feedback.getAttribute('data-feedback-y')),
    };
    expect(initialAnchor.x).toBeCloseTo(initialCenter.x + 50, 4);
    expect(initialAnchor.y).toBeCloseTo(initialCenter.y, 4);

    await background.evaluate((element, center) => {
      const dispatch = (
        target: EventTarget,
        type: string,
        pointerId: number,
        clientX: number,
        clientY: number
      ) => {
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId,
            pointerType: 'touch',
            button: 0,
            buttons: 1,
            clientX,
            clientY,
          })
        );
      };
      dispatch(document, 'pointermove', 51, center.x, center.y - 40);
      dispatch(document, 'pointermove', 52, center.x, center.y + 40);
      void element;
    }, gestureCenter);

    await expect
      .poll(async () => Number(await ruler.getAttribute('data-ruler-rotation')))
      .toBeCloseTo(Math.PI / 2, 4);
    await expect(feedback).toContainText('90°');
    expect(Number(await feedback.getAttribute('data-feedback-x'))).toBeCloseTo(initialAnchor.x, 4);
    expect(Number(await feedback.getAttribute('data-feedback-y'))).toBeCloseTo(initialAnchor.y, 4);

    await background.evaluate((element, center) => {
      const dispatch = (pointerId: number, clientX: number, clientY: number) => {
        document.dispatchEvent(
          new PointerEvent('pointerup', {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId,
            pointerType: 'touch',
            button: 0,
            buttons: 0,
            clientX,
            clientY,
          })
        );
      };
      dispatch(51, center.x, center.y - 40);
      dispatch(52, center.x, center.y + 40);
      void element;
    }, gestureCenter);
    await expect(feedback).toBeHidden();
  });

  test('ordinary mouse release does not end an active two-touch ruler gesture', async ({ page }) => {
    const { surface, ruler, background } = await enableRuler(page);
    const surfaceBox = await surface.boundingBox();
    expect(surfaceBox).not.toBeNull();
    if (!surfaceBox) return;
    const clientOrigin = await surface.evaluate((element) => ({
      left: element.clientLeft,
      top: element.clientTop,
    }));
    const center = await readRulerCenter(ruler);
    const clientCenter = {
      x: surfaceBox.x + clientOrigin.left + center.x,
      y: surfaceBox.y + clientOrigin.top + center.y,
    };

    await background.evaluate((element, point) => {
      const dispatch = (
        target: EventTarget,
        type: string,
        pointerId: number,
        pointerType: 'mouse' | 'touch',
        clientX: number,
        clientY: number
      ) => {
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId,
            pointerType,
            button: 0,
            buttons: type === 'pointerup' ? 0 : 1,
            clientX,
            clientY,
          })
        );
      };
      dispatch(element, 'pointerdown', 90, 'mouse', point.x, point.y);
      dispatch(element, 'pointerdown', 51, 'touch', point.x - 40, point.y);
      dispatch(element, 'pointerdown', 52, 'touch', point.x + 40, point.y);
    }, clientCenter);

    const feedback = surface.getByTestId('drawing-ruler-angle-feedback');
    await expect(feedback).toBeVisible();

    await background.evaluate((element, point) => {
      document.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 90,
          pointerType: 'mouse',
          button: 0,
          buttons: 0,
          clientX: point.x,
          clientY: point.y,
        })
      );
      document.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 51,
          pointerType: 'touch',
          button: 0,
          buttons: 1,
          clientX: point.x,
          clientY: point.y - 40,
        })
      );
      document.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 52,
          pointerType: 'touch',
          button: 0,
          buttons: 1,
          clientX: point.x,
          clientY: point.y + 40,
        })
      );
      void element;
    }, clientCenter);

    await expect(feedback).toBeVisible();
    await expect
      .poll(async () => Number(await ruler.getAttribute('data-ruler-rotation')))
      .toBeCloseTo(Math.PI / 2, 4);
  });

  test('virtual-paper wheel remains available over the ruler', async ({ page }) => {
    const virtualPaperToggle = page.getByTestId('drawing-virtualpaper-toggle');
    await virtualPaperToggle.click();
    await expect(virtualPaperToggle).toHaveText('VirtualPaper ON');

    const { surface, ruler } = await enableRuler(page);
    const initialTx = Number(await surface.getAttribute('data-tx'));
    const initialTy = Number(await surface.getAttribute('data-ty'));
    const surfaceBox = await surface.boundingBox();
    expect(surfaceBox).not.toBeNull();
    if (!surfaceBox) return;
    const center = await readRulerCenter(ruler);

    await page.mouse.move(surfaceBox.x + surfaceBox.width * 0.2, surfaceBox.y + center.y);
    await page.mouse.wheel(45, 55);

    await expect
      .poll(async () => {
        const tx = Number(await surface.getAttribute('data-tx'));
        const ty = Number(await surface.getAttribute('data-ty'));
        return Math.abs(tx - initialTx) + Math.abs(ty - initialTy);
      })
      .toBeGreaterThan(0);
  });
});
