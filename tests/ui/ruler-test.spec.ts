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

  test('plain left drag is blocked while Ctrl left drag translates the ruler', async ({ page }) => {
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

    await expect(surface).toHaveAttribute('data-stroke-count', strokeCount ?? '');
    await expect.poll(() => readRulerCenter(ruler)).toEqual(initialCenter);

    await page.keyboard.down('Control');
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.keyboard.up('Control');
    await page.mouse.move(startX + 50, startY + 32, { steps: 6 });
    await page.mouse.up();

    const translatedCenter = await readRulerCenter(ruler);
    expect(translatedCenter.x - initialCenter.x).toBeCloseTo(50, 4);
    expect(translatedCenter.y - initialCenter.y).toBeCloseTo(32, 4);
    await expect(surface).toHaveAttribute('data-stroke-count', strokeCount ?? '');
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
    }));
    const pivot = {
      x: surfaceBox.x + viewportSize.width / 2,
      y: surfaceBox.y + viewportSize.height / 2,
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

  test('Alt left drag rotates only from the ruler around the visible surface center', async ({
    page,
  }) => {
    const { surface, ruler } = await enableRuler(page);
    const surfaceBox = await surface.boundingBox();
    expect(surfaceBox).not.toBeNull();
    if (!surfaceBox) return;
    const surfaceViewport = await surface.evaluate((element) => ({
      width: element.clientWidth,
      height: element.clientHeight,
    }));
    const localPivot = {
      x: surfaceViewport.width / 2,
      y: surfaceViewport.height / 2,
    };
    const pivot = {
      x: surfaceBox.x + localPivot.x,
      y: surfaceBox.y + localPivot.y,
    };
    const initialCenter = await readRulerCenter(ruler);

    // Given：先把水平尺子向上平移 100px，建立可观察的旋转半径。
    const translateStartX = surfaceBox.x + surfaceViewport.width * 0.2;
    await page.keyboard.down('Control');
    await page.mouse.move(translateStartX, surfaceBox.y + initialCenter.y);
    await page.mouse.down();
    await page.mouse.move(translateStartX, surfaceBox.y + initialCenter.y - 100, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Control');
    const translatedCenter = await readRulerCenter(ruler);
    const initialRadius = Math.hypot(
      translatedCenter.x - localPivot.x,
      translatedCenter.y - localPivot.y
    );

    // When：从尺子上的点开始 Alt+左键拖拽四分之一圈。
    const rotationStart = {
      x: surfaceBox.x + surfaceViewport.width * 0.2,
      y: surfaceBox.y + translatedCenter.y,
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

    // Then：角度增加 90°，逻辑中心绕可视中心刚性旋转且半径不变。
    await expect
      .poll(async () => Number(await ruler.getAttribute('data-ruler-rotation')))
      .toBeCloseTo(Math.PI / 2, 4);
    const rotatedCenter = await readRulerCenter(ruler);
    expect(Math.hypot(rotatedCenter.x - localPivot.x, rotatedCenter.y - localPivot.y)).toBeCloseTo(
      initialRadius,
      4
    );

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

  test('two ruler touches translate by their midpoint while an ignored third touch cannot interrupt them', async ({
    page,
  }) => {
    const { ruler, background } = await enableRuler(page);
    const initialCenter = await readRulerCenter(ruler);

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
  });

  test('two ruler touches rotate through multi-drag and snap to a 45-degree multiple', async ({
    page,
  }) => {
    const { surface, ruler, background } = await enableRuler(page);
    const surfaceBox = await surface.boundingBox();
    expect(surfaceBox).not.toBeNull();
    if (!surfaceBox) return;
    const initialCenter = await readRulerCenter(ruler);
    const center = {
      x: surfaceBox.x + initialCenter.x,
      y: surfaceBox.y + initialCenter.y,
    };

    await background.evaluate((element, gestureCenter) => {
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

      dispatch(element, 'pointerdown', 51, gestureCenter.x - 40, gestureCenter.y);
      dispatch(element, 'pointerdown', 52, gestureCenter.x + 40, gestureCenter.y);
      dispatch(document, 'pointermove', 51, gestureCenter.x, gestureCenter.y - 40);
      dispatch(document, 'pointermove', 52, gestureCenter.x, gestureCenter.y + 40);
      dispatch(document, 'pointerup', 51, gestureCenter.x, gestureCenter.y - 40);
      dispatch(document, 'pointerup', 52, gestureCenter.x, gestureCenter.y + 40);
    }, center);

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
