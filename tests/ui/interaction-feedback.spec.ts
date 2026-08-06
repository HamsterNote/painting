import { expect, type Locator, type Page, test } from '@playwright/test';

async function openPlayground(page: Page): Promise<void> {
  await page.goto('/');
}

async function getSurface(page: Page): Promise<Locator> {
  const surface = page.getByTestId('drawing-surface-uncontrolled');
  await surface.scrollIntoViewIfNeeded();
  await expect(surface).toBeVisible();
  return surface;
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

test.describe('interaction feedback browser contract', () => {
  test('keeps the ruler angle at the mouse gesture-start pivot while rotating', async ({ page }) => {
    // Given: 水平尺子已启用，并先平移到可视中心上方的非对称位置。
    const consoleErrors = recordConsoleErrors(page);
    await openPlayground(page);
    await page.getByTestId('drawing-ruler-toggle').first().click();
    const surface = await getSurface(page);
    const ruler = surface.getByTestId('drawing-ruler');
    const surfaceBox = await surface.boundingBox();
    expect(surfaceBox).not.toBeNull();
    if (!surfaceBox) return;
    const viewportSize = await surface.evaluate((element) => ({
      width: element.clientWidth,
      height: element.clientHeight,
      left: element.clientLeft,
      top: element.clientTop,
    }));
    const initialCenter = {
      x: Number(await ruler.getAttribute('data-ruler-center-x')),
      y: Number(await ruler.getAttribute('data-ruler-center-y')),
    };
    const contentOrigin = {
      x: surfaceBox.x + viewportSize.left,
      y: surfaceBox.y + viewportSize.top,
    };
    const translateStart = {
      x: contentOrigin.x + viewportSize.width * 0.25,
      y: contentOrigin.y + initialCenter.y,
    };
    await page.keyboard.down('Control');
    await page.mouse.move(translateStart.x, translateStart.y);
    await page.mouse.down();
    await page.mouse.move(translateStart.x + 80, translateStart.y - 60, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Control');
    const translatedCenter = {
      x: Number(await ruler.getAttribute('data-ruler-center-x')),
      y: Number(await ruler.getAttribute('data-ruler-center-y')),
    };
    const pivot = {
      x: contentOrigin.x + viewportSize.width / 2,
      y: contentOrigin.y + translatedCenter.y,
    };
    const start = {
      x: contentOrigin.x + viewportSize.width * 0.75,
      y: pivot.y,
    };

    // When: Alt + 左键从尺子上开始，并旋转四分之一圈。
    await page.keyboard.down('Alt');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const feedback = surface.getByTestId('drawing-ruler-angle-feedback');
    await expect(feedback).toBeVisible();
    await expect(feedback).toContainText('0°');
    const initialAnchor = {
      x: Number(await feedback.getAttribute('data-feedback-x')),
      y: Number(await feedback.getAttribute('data-feedback-y')),
    };
    expect(initialAnchor.x).toBeCloseTo(viewportSize.width / 2, 4);
    expect(initialAnchor.y).toBeCloseTo(translatedCenter.y, 4);
    await page.mouse.move(pivot.x, pivot.y + (start.x - pivot.x), { steps: 8 });

    // Then: 整数角度更新，但提示仍固定在手势开始时的裁切中线中点。
    await expect(feedback).toContainText('90°');
    await expect(feedback.locator('circle')).toHaveCSS('fill', 'rgb(255, 255, 255)');
    await expect(feedback.locator('text')).toHaveCSS('fill', 'rgb(0, 0, 0)');
    expect(Number(await feedback.getAttribute('data-feedback-x'))).toBeCloseTo(initialAnchor.x, 4);
    expect(Number(await feedback.getAttribute('data-feedback-y'))).toBeCloseTo(initialAnchor.y, 4);
    await expect
      .poll(async () => Number(await ruler.getAttribute('data-ruler-rotation')))
      .toBeCloseTo(Math.PI / 2, 4);
    await surface.screenshot({ path: '/tmp/opencode/painting-ruler-angle-feedback.png' });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await expect(feedback).toBeHidden();
    expect(consoleErrors).toEqual([]);
  });

  test('shows the real wheel zoom percentage above the pointer and then clears it', async ({
    page,
  }) => {
    // Given: VirtualPaper 已启用，鼠标上方有足够空间容纳提示。
    const consoleErrors = recordConsoleErrors(page);
    await openPlayground(page);
    await page.getByTestId('drawing-virtualpaper-toggle').click();
    const surface = await getSurface(page);
    const surfaceBox = await surface.boundingBox();
    expect(surfaceBox).not.toBeNull();
    if (!surfaceBox) return;
    const pointer = { x: 120, y: 120 };
    await surface.evaluate((element) => {
      new MutationObserver(() => {
        const feedback = element.querySelector<HTMLElement>(
          '[data-testid="drawing-zoom-feedback"]'
        );
        if (!feedback) return;
        element.dataset.observedZoomFeedback = 'true';
        element.dataset.observedZoomLabel = feedback.textContent ?? '';
        element.dataset.observedZoomSource = feedback.dataset.feedbackSource ?? '';
        element.dataset.observedZoomX = feedback.dataset.feedbackX ?? '';
        element.dataset.observedZoomY = feedback.dataset.feedbackY ?? '';
      }).observe(element, { childList: true, subtree: true });
    });

    // When: Ctrl + 滚轮通过 VirtualPaper 执行真实缩放。
    await page.mouse.move(surfaceBox.x + pointer.x, surfaceBox.y + pointer.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');

    // Then: 提示使用真实回传比例，锚定在鼠标上方并在滚轮停止后隐藏。
    await expect(surface).toHaveAttribute('data-observed-zoom-feedback', 'true');
    await expect(surface).toHaveAttribute(
      'data-observed-zoom-label',
      `${Math.round(Number(await surface.getAttribute('data-scale')) * 100)}%`
    );
    await expect(surface).toHaveAttribute('data-observed-zoom-source', 'mouse');
    expect(Number(await surface.getAttribute('data-observed-zoom-x'))).toBeCloseTo(pointer.x, 4);
    expect(
      Math.abs(Number(await surface.getAttribute('data-observed-zoom-y')) - (pointer.y - 28))
    ).toBeLessThan(0.5);

    const wrapper = surface.getByTestId('virtual-paper-wrapper');
    await wrapper.evaluate((element, localPointer) => {
      const bounds = element.getBoundingClientRect();
      element.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaY: -100,
          ctrlKey: true,
          clientX: bounds.x + localPointer.x,
          clientY: bounds.y + localPointer.y,
        })
      );
    }, pointer);
    const feedback = surface.getByTestId('drawing-zoom-feedback');
    await expect(feedback).toBeVisible();
    await surface.screenshot({ path: '/tmp/opencode/painting-mouse-zoom-feedback.png' });
    await expect(feedback).toBeHidden({ timeout: 1_200 });
    expect(consoleErrors).toEqual([]);
  });

  test('keeps touch zoom percentage stably above the midpoint and inside the host', async ({
    page,
  }) => {
    // Given: VirtualPaper 已启用，两个触点在宿主内形成斜线。
    const consoleErrors = recordConsoleErrors(page);
    await openPlayground(page);
    await page.getByTestId('drawing-virtualpaper-toggle').click();
    const surface = await getSurface(page);
    const wrapper = surface.getByTestId('virtual-paper-wrapper');
    const surfaceBox = await surface.boundingBox();
    const wrapperBox = await wrapper.boundingBox();
    expect(surfaceBox).not.toBeNull();
    expect(wrapperBox).not.toBeNull();
    if (!surfaceBox || !wrapperBox) return;
    const first = { x: 80, y: 120 };
    const second = { x: 180, y: 180 };

    // When: 第二根手指远离第一根手指，触发双指缩放。
    await wrapper.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const dispatch = (type: string, pointerId: number, x: number, y: number) => {
        element.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId,
            pointerType: 'touch',
            button: 0,
            buttons: 1,
            clientX: rect.x + x,
            clientY: rect.y + y,
          })
        );
      };
      dispatch('pointerdown', 101, 80, 120);
      dispatch('pointerdown', 102, 160, 160);
      dispatch('pointermove', 102, 180, 180);
    });

    // Then: 提示使用真实比例，并稳定锚定在两指中点正上方 36px。
    const feedback = surface.getByTestId('drawing-zoom-feedback');
    await expect(feedback).toBeVisible();
    await expect(feedback).toHaveAttribute('data-feedback-source', 'touch');
    await expect(feedback).toContainText(
      `${Math.round(Number(await surface.getAttribute('data-scale')) * 100)}%`
    );
    const hostFirst = {
      x: wrapperBox.x + first.x - surfaceBox.x,
      y: wrapperBox.y + first.y - surfaceBox.y,
    };
    const hostSecond = {
      x: wrapperBox.x + second.x - surfaceBox.x,
      y: wrapperBox.y + second.y - surfaceBox.y,
    };
    const midpoint = {
      x: (hostFirst.x + hostSecond.x) / 2,
      y: (hostFirst.y + hostSecond.y) / 2,
    };
    const feedbackPoint = {
      x: Number(await feedback.getAttribute('data-feedback-x')),
      y: Number(await feedback.getAttribute('data-feedback-y')),
    };
    expect(feedbackPoint.x).toBeCloseTo(midpoint.x, 4);
    expect(feedbackPoint.y).toBeCloseTo(midpoint.y - 36, 4);
    const feedbackBox = await feedback.boundingBox();
    expect(feedbackBox).not.toBeNull();
    if (!feedbackBox) return;
    expect(feedbackBox.x).toBeGreaterThanOrEqual(surfaceBox.x);
    expect(feedbackBox.y).toBeGreaterThanOrEqual(surfaceBox.y);
    expect(feedbackBox.x + feedbackBox.width).toBeLessThanOrEqual(surfaceBox.x + surfaceBox.width);
    expect(feedbackBox.y + feedbackBox.height).toBeLessThanOrEqual(
      surfaceBox.y + surfaceBox.height
    );
    await surface.screenshot({ path: '/tmp/opencode/painting-touch-zoom-feedback.png' });

    // When: 已捕获的两个触点保持高度，并让中点连续跨出宿主右边界。
    const wrapperWidth = wrapperBox.width;
    await wrapper.evaluate((element, width) => {
      const rect = element.getBoundingClientRect();
      const move = (pointerId: number, x: number) => {
        element.dispatchEvent(
          new PointerEvent('pointermove', {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId,
            pointerType: 'touch',
            button: 0,
            buttons: 1,
            clientX: rect.x + x,
            clientY: rect.y + 100,
          })
        );
      };
      move(101, width - 8);
      move(102, width + 12);
    }, wrapperWidth);
    const outsideMidpointY = wrapperBox.y + 100 - surfaceBox.y;
    const firstOutsideY = Number(await feedback.getAttribute('data-feedback-y'));
    expect(firstOutsideY).toBeCloseTo(outsideMidpointY - 36, 4);

    await wrapper.evaluate((element, width) => {
      const rect = element.getBoundingClientRect();
      const move = (pointerId: number, x: number) => {
        element.dispatchEvent(
          new PointerEvent('pointermove', {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId,
            pointerType: 'touch',
            button: 0,
            buttons: 1,
            clientX: rect.x + x,
            clientY: rect.y + 100,
          })
        );
      };
      move(101, width - 7);
      move(102, width + 13);
    }, wrapperWidth);

    // Then: 越界前后保持同一上方纵坐标，仅水平裁切，不切换到中点高度。
    await expect
      .poll(async () => Number(await feedback.getAttribute('data-feedback-y')))
      .toBeCloseTo(firstOutsideY, 4);
    const outsideFeedbackBox = await feedback.boundingBox();
    expect(outsideFeedbackBox).not.toBeNull();
    if (!outsideFeedbackBox) return;
    expect(outsideFeedbackBox.x + outsideFeedbackBox.width).toBeLessThanOrEqual(
      surfaceBox.x + surfaceBox.width
    );

    // When: 两个活动触点保持间距并整体移向宿主左上角。
    const translatedFirst = { x: 10, y: 20 };
    const translatedSecond = { x: 110, y: 80 };
    await wrapper.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const move = (pointerId: number, x: number, y: number) => {
        element.dispatchEvent(
          new PointerEvent('pointermove', {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId,
            pointerType: 'touch',
            button: 0,
            buttons: 1,
            clientX: rect.x + x,
            clientY: rect.y + y,
          })
        );
      };
      move(101, 10, 20);
      move(102, 110, 80);
    });

    // Then: 提示跟随最新中点，并同时保持 50px 距离与完整可见。
    const translatedHostFirst = {
      x: wrapperBox.x + translatedFirst.x - surfaceBox.x,
      y: wrapperBox.y + translatedFirst.y - surfaceBox.y,
    };
    const translatedHostSecond = {
      x: wrapperBox.x + translatedSecond.x - surfaceBox.x,
      y: wrapperBox.y + translatedSecond.y - surfaceBox.y,
    };
    const translatedMidpoint = {
      x: (translatedHostFirst.x + translatedHostSecond.x) / 2,
      y: (translatedHostFirst.y + translatedHostSecond.y) / 2,
    };
    await expect
      .poll(async () => {
        const x = Number(await feedback.getAttribute('data-feedback-x'));
        const y = Number(await feedback.getAttribute('data-feedback-y'));
        return Math.hypot(x - translatedMidpoint.x, y - translatedMidpoint.y);
      })
      .toBeLessThanOrEqual(50);
    const translatedFeedbackBox = await feedback.boundingBox();
    expect(translatedFeedbackBox).not.toBeNull();
    if (!translatedFeedbackBox) return;
    expect(translatedFeedbackBox.x).toBeGreaterThanOrEqual(surfaceBox.x);
    expect(translatedFeedbackBox.y).toBeGreaterThanOrEqual(surfaceBox.y);
    expect(translatedFeedbackBox.x + translatedFeedbackBox.width).toBeLessThanOrEqual(
      surfaceBox.x + surfaceBox.width
    );
    expect(translatedFeedbackBox.y + translatedFeedbackBox.height).toBeLessThanOrEqual(
      surfaceBox.y + surfaceBox.height
    );
    await surface.screenshot({ path: '/tmp/opencode/painting-touch-zoom-feedback-edge.png' });

    // When: 第三根手指仍按住时，固定 pinch 二元组中的任一触点结束。
    await wrapper.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      element.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 103,
          pointerType: 'touch',
          button: 0,
          buttons: 1,
          clientX: rect.x + 220,
          clientY: rect.y + 200,
        })
      );
    });
    await page.evaluate(() => {
      document.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 102,
          pointerType: 'touch',
          button: 0,
          buttons: 0,
        })
      );
    });

    // Then: 第三根手指不会接替原 pinch，缩放提示立即消失。
    await expect(feedback).toBeHidden();
    expect(consoleErrors).toEqual([]);
  });

  test('keeps textarea selection and replacement enabled inside the non-selectable SVG host', async ({
    page,
  }) => {
    // Given: 文字工具在受控画布中创建了一个原生 textarea 编辑器。
    const consoleErrors = recordConsoleErrors(page);
    await openPlayground(page);
    await page.getByTestId('drawing-tool-select').selectOption('text');
    const surface = page.getByTestId('drawing-surface-controlled');
    await surface.scrollIntoViewIfNeeded();
    const surfaceBox = await surface.boundingBox();
    expect(surfaceBox).not.toBeNull();
    if (!surfaceBox) return;
    await page.mouse.click(surfaceBox.x + 90, surfaceBox.y + 90);
    const editor = surface.locator('textarea[data-testid="text-editor"]');
    await expect(editor).toBeVisible();
    await expect(surface).toHaveCSS('user-select', 'none');
    await expect(editor).toHaveCSS('user-select', 'text');
    await editor.fill('Editable canvas text');

    // When: 浏览器全选 textarea 内容并用新文本替换。
    await editor.selectText();
    expect(
      await editor.evaluate((element) =>
        element instanceof HTMLTextAreaElement
          ? { start: element.selectionStart, end: element.selectionEnd }
          : null
      )
    ).toEqual({ start: 0, end: 20 });
    await editor.pressSequentially('Replaced text');

    // Then: 编辑器和受控画布 JSON 同步保存替换后的内容。
    await expect(editor).toHaveValue('Replaced text');
    await expect(page.getByTestId('drawing-preview-controlled')).toContainText('Replaced text');
    expect(consoleErrors).toEqual([]);
  });
});
