import { expect, type Locator, type Page, test } from '@playwright/test';

async function enableRuler(page: Page): Promise<{
  readonly surface: Locator;
  readonly ruler: Locator;
}> {
  await page.getByTestId('drawing-ruler-toggle').first().click();

  const surface = page.getByTestId('drawing-surface-uncontrolled');
  await surface.scrollIntoViewIfNeeded();
  const ruler = surface.getByTestId('drawing-ruler');
  await expect(ruler).toBeVisible();

  return { surface, ruler };
}

async function readRulerCenter(
  ruler: Locator
): Promise<{ readonly x: number; readonly y: number }> {
  return {
    x: Number(await ruler.getAttribute('data-ruler-center-x')),
    y: Number(await ruler.getAttribute('data-ruler-center-y')),
  };
}

test.describe('ruler edge input browser contract', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  for (const pointerType of ['mouse', 'pen', 'touch'] as const) {
    test(`projects ${pointerType} samples onto the selected physical ruler edge after crossing it`, async ({
      page,
    }) => {
      // Given: 关闭平滑后，输入从水平尺上方开始，尚未跨过最近的上尺边。
      await page.getByTestId('drawing-smoothing-toggle').uncheck();
      const { surface, ruler } = await enableRuler(page);
      const preview = page.getByTestId('drawing-preview-uncontrolled');
      const center = await readRulerCenter(ruler);
      const height = Number(await ruler.getAttribute('data-ruler-height'));
      const selectedEdgeY = center.y - height / 2;

      // When: 鼠标、笔或单指跨入尺身后抬起，均走真实浏览器 PointerEvent 链。
      await surface.evaluate(
        (element, input) => {
          element.setPointerCapture = () => undefined;
          element.releasePointerCapture = () => undefined;
          element.hasPointerCapture = () => true;
          const rect = element.getBoundingClientRect();
          const contentOrigin = {
            x: rect.left + element.clientLeft,
            y: rect.top + element.clientTop,
          };
          const dispatch = (
            target: EventTarget,
            type: 'pointerdown' | 'pointermove' | 'pointerup',
            x: number,
            y: number
          ) => {
            target.dispatchEvent(
              new PointerEvent(type, {
                bubbles: true,
                cancelable: true,
                composed: true,
                pointerId: 91,
                pointerType: input.pointerType,
                button: 0,
                buttons: type === 'pointerup' ? 0 : 1,
                clientX: contentOrigin.x + x,
                clientY: contentOrigin.y + y,
                pressure: type === 'pointerup' ? 0 : 0.5,
              })
            );
          };

          dispatch(
            element,
            'pointerdown',
            input.centerX - 80,
            input.selectedEdgeY - 24
          );
          dispatch(document, 'pointermove', input.centerX, input.centerY - 10);
          dispatch(document, 'pointerup', input.centerX, input.centerY - 10);
        },
        { pointerType, centerX: center.x, centerY: center.y, selectedEdgeY }
      );

      const points = await preview.evaluate((element) => {
        const value: unknown = JSON.parse(element.textContent ?? '{}');
        if (typeof value !== 'object' || value === null || !('strokes' in value)) return [];
        const strokes = value.strokes;
        if (!Array.isArray(strokes) || strokes.length === 0) return [];
        const stroke: unknown = strokes[strokes.length - 1];
        if (typeof stroke !== 'object' || stroke === null || !('points' in stroke)) return [];
        return Array.isArray(stroke.points) ? stroke.points : [];
      });

      // Then: 尺身内采样固定落在开始时选中的物理上尺边，而非保留原始纵坐标。
      expect(points).toHaveLength(2);
      expect(points[0]).toEqual(
        expect.objectContaining({ x: center.x - 80, y: selectedEdgeY - 24 })
      );
      expect(points[1]).toEqual(expect.objectContaining({ x: center.x, y: selectedEdgeY }));
    });
  }
});
