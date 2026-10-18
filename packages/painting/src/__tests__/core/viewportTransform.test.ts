/** @jest-environment node */

import {
  applyViewportTransformIntent,
  createViewportTransformIntent,
  normalizeViewportTransform,
  panViewport,
  resolveViewportScaleLimits,
  screenToCanvas,
  zoomViewportAt,
} from '../../core/internal';

describe('core/viewportTransform', () => {
  it('在 focal zoom 和 pinch 后保持焦点对应的世界坐标不漂移', () => {
    const viewport = { scale: 2, tx: 10, ty: 20 };
    const focal = { x: 100, y: 50 };
    const worldAtFocal = screenToCanvas(focal, viewport);
    const zoomed = zoomViewportAt(viewport, focal, 1.5);
    const pinch = applyViewportTransformIntent(
      viewport,
      createViewportTransformIntent({ x: 100, y: 50 }, { x: 130, y: 90 }, 1.5)!
    );

    expect(zoomed).not.toBeNull();
    // 仿射缩放会经过一次除法，IEEE-754 的最后一位舍入不应被误判为焦点漂移。
    for (const point of [
      screenToCanvas(focal, zoomed!),
      screenToCanvas({ x: 130, y: 90 }, pinch!),
    ]) {
      expect(point.x).toBeCloseTo(worldAtFocal.x, 12);
      expect(point.y).toBeCloseTo(worldAtFocal.y, 12);
    }
  });

  it('将 scale 限制收敛为全局与用户范围交集，并拒绝非有限或空交集输入', () => {
    expect(resolveViewportScaleLimits({ min: 0.5, max: 3 })).toEqual({ min: 0.5, max: 3 });
    expect(resolveViewportScaleLimits({ min: 0.1, max: 20 })).toEqual({ min: 0.25, max: 8 });
    expect(resolveViewportScaleLimits({ min: 9, max: 10 })).toBeNull();
    expect(resolveViewportScaleLimits({ min: Number.NaN })).toBeNull();
    expect(normalizeViewportTransform({ scale: 0.1, tx: 4, ty: 5 }, { min: 0.5 })).toEqual({
      scale: 0.5,
      tx: 4,
      ty: 5,
    });
    expect(
      normalizeViewportTransform({ scale: 1, tx: Number.POSITIVE_INFINITY, ty: 0 })
    ).toBeNull();
    expect(createViewportTransformIntent({ x: 0, y: 0 }, { x: 0, y: 0 }, Number.NaN)).toBeNull();
  });

  it('pan 支持不可变 no-op identity，并拒绝非法输入', () => {
    const viewport = Object.freeze({ scale: 1, tx: 10, ty: 20 });
    const noOp = panViewport(viewport, { x: 0, y: 0 });
    const panned = panViewport(viewport, { x: -4, y: 6 });

    expect(noOp).toBe(viewport);
    expect(panned).toEqual({ scale: 1, tx: 6, ty: 26 });
    expect(Object.isFrozen(panned)).toBe(true);
    expect(panViewport(viewport, { x: Number.NaN, y: 0 })).toBeNull();
  });
});
