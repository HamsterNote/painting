import {
  formatScalePercent,
  getMouseZoomFeedbackPoint,
  getTouchZoomFeedbackPoint,
  TOUCH_ZOOM_FEEDBACK_HEIGHT,
  TOUCH_ZOOM_FEEDBACK_WIDTH,
} from '../interactionFeedback';

describe('interaction feedback geometry', () => {
  it('rounds the viewport scale to an integer percentage', () => {
    // Given: 一个包含小数百分比的真实视口比例。
    const scale = 1.236;

    // When: 将比例格式化为交互提示。
    const label = formatScalePercent(scale);

    // Then: 提示只保留整数百分比。
    expect(label).toBe('124%');
  });

  it('places mouse zoom feedback above the pointer when it fits', () => {
    // Given: 指针上方有足够的可视空间。
    const pointer = { x: 80, y: 90 };

    // When: 计算鼠标缩放提示中心。
    const point = getMouseZoomFeedbackPoint(pointer);

    // Then: 水平位置跟随指针，提示位于其上方。
    expect(point).toEqual({ x: 80, y: 62 });
  });

  it('places mouse zoom feedback below the pointer when the top would be clipped', () => {
    // Given: 指针靠近宿主顶部，顶部放不下完整提示。
    const pointer = { x: 32, y: 20 };

    // When: 计算鼠标缩放提示中心。
    const point = getMouseZoomFeedbackPoint(pointer);

    // Then: 提示翻转到指针下方。
    expect(point).toEqual({ x: 32, y: 48 });
  });

  it('keeps touch zoom feedback directly above a rising two-finger segment', () => {
    // Given: 两根手指形成从左上向右下的斜线。
    const first = { x: 20, y: 80 };
    const second = { x: 80, y: 120 };

    // When: 计算双指缩放提示中心。
    const point = getTouchZoomFeedbackPoint(first, second, { width: 200, height: 200 });

    // Then: 提示固定在双指中点正上方，不会随斜率切换到另一侧。
    expect(point).toEqual({ x: 50, y: 64 });
  });

  it('keeps touch zoom feedback directly above a falling two-finger segment', () => {
    // Given: 两根手指形成从左下向右上的斜线。
    const first = { x: 20, y: 120 };
    const second = { x: 80, y: 80 };

    // When: 计算双指缩放提示中心。
    const point = getTouchZoomFeedbackPoint(first, second, { width: 200, height: 200 });

    // Then: 提示仍固定在双指中点正上方。
    expect(point).toEqual({ x: 50, y: 64 });
  });

  it('keeps touch zoom feedback above vertically aligned fingers', () => {
    // Given: 两根手指位于同一条竖线上。
    const first = { x: 60, y: 40 };
    const second = { x: 60, y: 120 };

    // When: 计算双指缩放提示中心。
    const point = getTouchZoomFeedbackPoint(first, second, { width: 200, height: 200 });

    // Then: 提示仍优先放在双指中点上方，而不是落在两指之间。
    expect(point).toEqual({ x: 60, y: 44 });
  });

  it('uses a stable upper fallback when a horizontal segment has no finite intersections', () => {
    // Given: 水平双指连线的法线与两条独立竖线平行。
    const first = { x: 30, y: 80 };
    const second = { x: 90, y: 80 };

    // When: 精确交点退化为无穷远。
    const point = getTouchZoomFeedbackPoint(first, second, { width: 200, height: 200 });

    // Then: 使用中点正上方的稳定锚点，避免提示跳到不可见区域。
    expect(point).toEqual({ x: 60, y: 44 });
  });

  it('keeps touch zoom feedback at a stable distance above the midpoint', () => {
    // Given: 两根手指形成任意倾斜角度。
    const first = { x: 30, y: 100 };
    const second = { x: 110, y: 160 };
    const midpoint = { x: 70, y: 130 };

    // When: 在足够大的可视区域内计算提示位置。
    const point = getTouchZoomFeedbackPoint(first, second, { width: 300, height: 300 });

    // Then: 提示保持固定的 36px 上方偏移，不依赖触点连线斜率。
    expect(Math.hypot(point.x - midpoint.x, point.y - midpoint.y)).toBe(36);
    expect(point.x).toBe(midpoint.x);
    expect(point.y).toBeLessThan(midpoint.y);
  });

  it('does not move touch zoom feedback when finger order is reversed', () => {
    // Given: 同一组双指坐标以相反顺序传入。
    const first = { x: 24, y: 72 };
    const second = { x: 96, y: 124 };
    const viewport = { width: 200, height: 200 };

    // When: 分别计算两个顺序下的提示位置。
    const forwardPoint = getTouchZoomFeedbackPoint(first, second, viewport);
    const reversedPoint = getTouchZoomFeedbackPoint(second, first, viewport);

    // Then: 提示锚点完全一致，避免事件顺序造成两点闪动。
    expect(reversedPoint).toEqual(forwardPoint);
  });

  it('keeps the upper touch zoom anchor stable when the midpoint crosses the host edge', () => {
    // Given: 双指中点位于宿主右边界附近，且上方提示需要水平裁切。
    const viewport = { width: 200, height: 200 };

    // When: 中点从右边界外 2px 移到右边界外 3px。
    const beforeThreshold = getTouchZoomFeedbackPoint(
      { x: 192, y: 80 },
      { x: 212, y: 120 },
      viewport
    );
    const afterThreshold = getTouchZoomFeedbackPoint(
      { x: 193, y: 80 },
      { x: 213, y: 120 },
      viewport
    );

    // Then: 两帧都保持同一上方纵坐标，不切换到中点高度。
    expect(beforeThreshold).toEqual({ x: 168, y: 64 });
    expect(afterThreshold).toEqual({ x: 168, y: 64 });
  });

  it('clamps the whole feedback pill inside the visible host area', () => {
    // Given: 两指靠近宿主左上角，几何候选点会越过可视边界。
    const first = { x: 2, y: 20 };
    const second = { x: 22, y: 20 };

    // When: 计算 120×80 宿主中的提示中心。
    const point = getTouchZoomFeedbackPoint(first, second, { width: 120, height: 80 });

    // Then: 固定尺寸提示完整留在宿主内，且中心仍在两指中点 50px 范围内。
    expect(point).toEqual({ x: TOUCH_ZOOM_FEEDBACK_WIDTH / 2, y: 16 });
    expect(point.x - TOUCH_ZOOM_FEEDBACK_WIDTH / 2).toBeGreaterThanOrEqual(0);
    expect(point.y - TOUCH_ZOOM_FEEDBACK_HEIGHT / 2).toBeGreaterThanOrEqual(0);
    expect(point.x + TOUCH_ZOOM_FEEDBACK_WIDTH / 2).toBeLessThanOrEqual(120);
    expect(point.y + TOUCH_ZOOM_FEEDBACK_HEIGHT / 2).toBeLessThanOrEqual(80);
    expect(Math.hypot(point.x - 12, point.y - 20)).toBeLessThanOrEqual(50);
  });
});
