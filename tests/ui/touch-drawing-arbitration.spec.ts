import { expect, type Locator, type Page, test } from '@playwright/test';

type TouchEventType = 'pointerdown' | 'pointermove' | 'pointerup';

interface TouchEventInput {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
}

function recordConsoleErrors(page: Page): readonly string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  return errors;
}

async function getFingerDrawingSurface(page: Page): Promise<{
  readonly surface: Locator;
  readonly wrapper: Locator;
}> {
  const surface = page.getByTestId('painting-board-demo-a');
  await surface.scrollIntoViewIfNeeded();
  await expect(surface).toBeVisible();

  // 测试通过合成 PointerEvent 驱动真实浏览器事件链；关闭浏览器的原生捕获，
  // 让后续触点仍能稳定命中 VirtualPaper wrapper，与现有 UI 测试保持一致。
  await surface.evaluate((element) => {
    element.setPointerCapture = () => undefined;
    element.releasePointerCapture = () => undefined;
    element.hasPointerCapture = () => true;
  });

  return {
    surface,
    wrapper: surface.getByTestId('virtual-paper-wrapper'),
  };
}

async function dispatchTouch(
  wrapper: Locator,
  type: TouchEventType,
  input: TouchEventInput
): Promise<void> {
  await wrapper.evaluate(
    (element, eventInit) => {
      const rect = element.getBoundingClientRect();
      element.dispatchEvent(
        new PointerEvent(eventInit.type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: eventInit.pointerId,
          pointerType: 'touch',
          button: 0,
          buttons: eventInit.type === 'pointerup' ? 0 : 1,
          clientX: rect.x + eventInit.x,
          clientY: rect.y + eventInit.y,
          pressure: eventInit.type === 'pointerup' ? 0 : 0.5,
        })
      );
    },
    { type, ...input }
  );
}

test.describe('touch drawing arbitration browser contract', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('hands a pending first touch to two-finger viewport manipulation without drawing', async ({
    page,
  }) => {
    // Given: 默认 PaintingBoard 处于“单指绘制、双指操作画布”模式，首指只移动 4px。
    const consoleErrors = recordConsoleErrors(page);
    const { surface, wrapper } = await getFingerDrawingSurface(page);
    await expect(surface).toHaveAttribute('data-stroke-count', '0');
    const initialScale = Number(await surface.getAttribute('data-scale'));

    await dispatchTouch(wrapper, 'pointerdown', { pointerId: 71, x: 80, y: 120 });
    await dispatchTouch(wrapper, 'pointermove', { pointerId: 71, x: 84, y: 120 });
    await expect(surface.locator('path[opacity="0.7"]')).toHaveCount(0);

    // When: 第二指介入并拉大两指距离，VirtualPaper 接管双指缩放。
    await dispatchTouch(wrapper, 'pointerdown', { pointerId: 72, x: 200, y: 120 });
    await dispatchTouch(wrapper, 'pointermove', { pointerId: 72, x: 260, y: 120 });

    // Then: 画布真实缩放并显示提示，但绘制层不产生预览或提交笔画。
    await expect
      .poll(async () => Number(await surface.getAttribute('data-scale')))
      .not.toBe(initialScale);
    await expect(surface.getByTestId('drawing-zoom-feedback')).toBeVisible();
    await expect(surface.locator('path[opacity="0.7"]')).toHaveCount(0);
    await expect(surface).toHaveAttribute('data-stroke-count', '0');
    await surface.screenshot({ path: '/tmp/opencode/painting-touch-pending-handoff.png' });

    await dispatchTouch(wrapper, 'pointerup', { pointerId: 72, x: 260, y: 120 });
    await dispatchTouch(wrapper, 'pointerup', { pointerId: 71, x: 84, y: 120 });
    await expect(surface).toHaveAttribute('data-stroke-count', '0');
    expect(consoleErrors).toEqual([]);
  });

  test('keeps a committed first-touch stroke isolated from a later second touch', async ({
    page,
  }) => {
    // Given: 首指已移动 30px，超过绘制承诺阈值并产生活动笔画。
    const consoleErrors = recordConsoleErrors(page);
    const { surface, wrapper } = await getFingerDrawingSurface(page);
    await dispatchTouch(wrapper, 'pointerdown', { pointerId: 81, x: 80, y: 100 });
    await dispatchTouch(wrapper, 'pointermove', { pointerId: 81, x: 110, y: 100 });
    await expect(surface.locator('path[opacity="0.7"]')).toHaveCount(1);
    const initialViewport = {
      scale: await surface.getAttribute('data-scale'),
      tx: await surface.getAttribute('data-tx'),
      ty: await surface.getAttribute('data-ty'),
    };

    // When: 第二指随后按下并移动，首指继续完成当前笔画。
    await dispatchTouch(wrapper, 'pointerdown', { pointerId: 82, x: 210, y: 100 });
    await dispatchTouch(wrapper, 'pointermove', { pointerId: 82, x: 270, y: 100 });
    await dispatchTouch(wrapper, 'pointermove', { pointerId: 81, x: 150, y: 100 });

    // Then: 第二指既不平移也不缩放画布，只有首指的活动笔画继续存在。
    await expect(surface).toHaveAttribute('data-scale', initialViewport.scale ?? '');
    await expect(surface).toHaveAttribute('data-tx', initialViewport.tx ?? '');
    await expect(surface).toHaveAttribute('data-ty', initialViewport.ty ?? '');
    await expect(surface.getByTestId('drawing-zoom-feedback')).toHaveCount(0);
    await expect(surface.locator('path[opacity="0.7"]')).toHaveCount(1);
    await surface.screenshot({ path: '/tmp/opencode/painting-touch-committed-stroke.png' });

    await dispatchTouch(wrapper, 'pointerup', { pointerId: 81, x: 150, y: 100 });
    await dispatchTouch(wrapper, 'pointerup', { pointerId: 82, x: 270, y: 100 });
    await expect(surface.locator('path[opacity="0.7"]')).toHaveCount(0);
    await expect(surface).toHaveAttribute('data-stroke-count', '1');
    expect(consoleErrors).toEqual([]);
  });
});
