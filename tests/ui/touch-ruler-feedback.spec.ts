import { expect, type Locator, test } from '@playwright/test';

interface Point {
  readonly x: number;
  readonly y: number;
}

interface RulerPose {
  readonly center: Point;
  readonly rotationRad: number;
}

interface TouchDispatch {
  readonly type: 'pointerdown' | 'pointermove' | 'pointerup';
  readonly pointerId: number;
  readonly point: Point;
}

async function dispatchTouch(target: Locator, event: TouchDispatch): Promise<void> {
  await target.evaluate(
    (element, event) => {
      element.dispatchEvent(
        new PointerEvent(event.type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: event.pointerId,
          pointerType: 'touch',
          button: 0,
          buttons: event.type === 'pointerup' ? 0 : 1,
          clientX: event.point.x,
          clientY: event.point.y,
          pressure: event.type === 'pointerup' ? 0 : 0.5,
        })
      );
    },
    event
  );
}

async function readRulerPose(ruler: Locator): Promise<RulerPose> {
  return {
    center: {
      x: Number(await ruler.getAttribute('data-ruler-center-x')),
      y: Number(await ruler.getAttribute('data-ruler-center-y')),
    },
    rotationRad: Number(await ruler.getAttribute('data-ruler-rotation')),
  };
}

function projectToRulerCenterline(point: Point, ruler: RulerPose): Point {
  const direction = {
    x: Math.cos(ruler.rotationRad),
    y: Math.sin(ruler.rotationRad),
  };
  const offset = {
    x: point.x - ruler.center.x,
    y: point.y - ruler.center.y,
  };
  const distance = offset.x * direction.x + offset.y * direction.y;
  return {
    x: ruler.center.x + distance * direction.x,
    y: ruler.center.y + distance * direction.y,
  };
}

test('moves touch ruler angle feedback along the live midpoint projection without SVG selection', async ({
  page,
}) => {
  // Given: 尺子已启用，SVG 宿主及其后代都禁止浏览器原生选择。
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto('/');
  await page.getByTestId('drawing-ruler-toggle').first().click();
  const surface = page.getByTestId('drawing-surface-uncontrolled');
  await surface.scrollIntoViewIfNeeded();
  await expect(surface).toBeVisible();
  const ruler = surface.getByTestId('drawing-ruler');
  const background = surface.getByTestId('drawing-ruler-background');
  const rulerSvg = surface.getByTestId('drawing-ruler-overlay');
  await expect(rulerSvg).toBeVisible();
  await expect(surface).toHaveCSS('user-select', 'none');
  await expect(rulerSvg).toHaveCSS('user-select', 'none');

  const svgBox = await rulerSvg.boundingBox();
  expect(svgBox).not.toBeNull();
  if (!svgBox) return;
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.mouse.move(svgBox.x + 20, svgBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(svgBox.x + svgBox.width - 20, svgBox.y + svgBox.height - 20, {
    steps: 6,
  });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');

  const surfaceBox = await surface.boundingBox();
  expect(surfaceBox).not.toBeNull();
  if (!surfaceBox) return;
  const contentOffset = await surface.evaluate((element) => ({
    x: element.clientLeft,
    y: element.clientTop,
  }));
  const contentOrigin = {
    x: surfaceBox.x + contentOffset.x,
    y: surfaceBox.y + contentOffset.y,
  };
  const initialPose = await readRulerPose(ruler);
  const toClientPoint = (point: Point): Point => ({
    x: contentOrigin.x + point.x,
    y: contentOrigin.y + point.y,
  });
  const start = [
    { x: initialPose.center.x - 100, y: initialPose.center.y },
    { x: initialPose.center.x + 20, y: initialPose.center.y },
  ] as const;

  // When: 两个触点从偏离尺子中心的中点开始，并连续平移、旋转尺子。
  await dispatchTouch(background, {
    type: 'pointerdown',
    pointerId: 201,
    point: toClientPoint(start[0]),
  });
  await dispatchTouch(background, {
    type: 'pointerdown',
    pointerId: 202,
    point: toClientPoint(start[1]),
  });
  const feedback = surface.getByTestId('drawing-ruler-angle-feedback');
  await expect(feedback).toBeVisible();
  const initialFeedback = {
    x: Number(await feedback.getAttribute('data-feedback-x')),
    y: Number(await feedback.getAttribute('data-feedback-y')),
  };
  const frames = [
    [
      { x: initialPose.center.x - 80, y: initialPose.center.y - 30 },
      { x: initialPose.center.x + 40, y: initialPose.center.y + 50 },
    ],
    [
      { x: initialPose.center.x - 60, y: initialPose.center.y - 50 },
      { x: initialPose.center.x + 60, y: initialPose.center.y + 70 },
    ],
    [
      { x: initialPose.center.x - 40, y: initialPose.center.y - 70 },
      { x: initialPose.center.x + 80, y: initialPose.center.y + 90 },
    ],
  ] as const;
  let lastObservedFeedback = initialFeedback;

  for (const frame of frames) {
    await dispatchTouch(background, {
      type: 'pointermove',
      pointerId: 201,
      point: toClientPoint(frame[0]),
    });
    await dispatchTouch(background, {
      type: 'pointermove',
      pointerId: 202,
      point: toClientPoint(frame[1]),
    });
    const midpoint = {
      x: (frame[0].x + frame[1].x) / 2,
      y: (frame[0].y + frame[1].y) / 2,
    };

    // Then: 每一帧的标签都等于“当前双指中点到当前尺子中线”的投影点。
    await expect
      .poll(async () => {
        const expected = projectToRulerCenterline(midpoint, await readRulerPose(ruler));
        const actual = {
          x: Number(await feedback.getAttribute('data-feedback-x')),
          y: Number(await feedback.getAttribute('data-feedback-y')),
        };
        return Math.hypot(actual.x - expected.x, actual.y - expected.y);
      })
      .toBeLessThan(0.75);
    lastObservedFeedback = {
      x: Number(await feedback.getAttribute('data-feedback-x')),
      y: Number(await feedback.getAttribute('data-feedback-y')),
    };
  }

  expect(
    Math.hypot(
      lastObservedFeedback.x - initialFeedback.x,
      lastObservedFeedback.y - initialFeedback.y
    )
  ).toBeGreaterThan(10);
  await surface.screenshot({ path: '/tmp/opencode/painting-touch-ruler-angle-feedback.png' });

  const finalFrame = frames[2];
  await dispatchTouch(background, {
    type: 'pointerup',
    pointerId: 202,
    point: toClientPoint(finalFrame[1]),
  });
  await dispatchTouch(background, {
    type: 'pointerup',
    pointerId: 201,
    point: toClientPoint(finalFrame[0]),
  });
  await expect(feedback).toBeHidden();
  expect(consoleErrors).toEqual([]);
});
