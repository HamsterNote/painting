import {
  getInfiniteRulerLayout,
  isInsideRuler,
  rotateRulerAround,
  snapRulerRotation,
  type RulerRect,
} from '../geometry';

describe('ruler rectangle geometry', () => {
  const ruler: RulerRect = {
    center: { x: 200, y: 300 },
    length: 400,
    height: 40,
    rotationRad: 0,
  };

  it('includes its center and visible edges', () => {
    expect(isInsideRuler({ x: 200, y: 300 }, ruler)).toBe(true);
    expect(isInsideRuler({ x: 0, y: 300 }, ruler)).toBe(true);
    expect(isInsideRuler({ x: 400, y: 300 }, ruler)).toBe(true);
    expect(isInsideRuler({ x: 200, y: 280 }, ruler)).toBe(true);
    expect(isInsideRuler({ x: 200, y: 320 }, ruler)).toBe(true);
  });

  it('has no endpoints but excludes points beyond its thickness', () => {
    expect(isInsideRuler({ x: -10_000, y: 300 }, ruler)).toBe(true);
    expect(isInsideRuler({ x: 10_000, y: 300 }, ruler)).toBe(true);
    expect(isInsideRuler({ x: 200, y: 279.99 }, ruler)).toBe(false);
    expect(isInsideRuler({ x: 200, y: 320.01 }, ruler)).toBe(false);
  });

  it('tests a rotated ruler in its local coordinate system', () => {
    // Given: 一把绕中心旋转 90° 的尺子。
    const rotatedRuler: RulerRect = { ...ruler, rotationRad: Math.PI / 2 };

    // When / Then: 原本的长度轴随旋转变为竖直方向，厚度轴变为水平方向。
    expect(isInsideRuler({ x: 200, y: 490 }, rotatedRuler)).toBe(true);
    expect(isInsideRuler({ x: 221, y: 300 }, rotatedRuler)).toBe(false);
  });
});

describe('infinite ruler layout', () => {
  it('projects the logical origin onto an endpoint-free strip covering the viewport diagonal', () => {
    // Given: 逻辑原点已经沿尺子方向移出画布，但直线仍穿过画布。
    const viewport = { width: 800, height: 600 };

    // When: 计算只用于可视区域的无限尺布局。
    const layout = getInfiniteRulerLayout({
      logicalCenter: { x: 2_000, y: 300 },
      rotationRad: 0,
      height: 48,
      viewport,
    });

    // Then: 可见段仍锚定在画布中心，并长于画布对角线，因此看不到端点。
    expect(layout.visualCenter).toEqual({ x: 400, y: 300 });
    expect(layout.tickOriginX).toBe(1_600);
    expect(layout.renderLength).toBeGreaterThan(Math.hypot(viewport.width, viewport.height));
  });

  it('rotates both the logical origin and ruler angle around the visible canvas center', () => {
    // Given: 水平尺子的逻辑原点位于旋转中心右侧。
    const state = { center: { x: 500, y: 300 }, rotationRad: 0 };

    // When: 绕画布可视中心顺时针旋转 90°。
    const rotated = rotateRulerAround(state, { x: 400, y: 300 }, Math.PI / 2);

    // Then: 尺子作为刚体绕同一中心旋转。
    expect(rotated.center.x).toBeCloseTo(400);
    expect(rotated.center.y).toBeCloseTo(400);
    expect(rotated.rotationRad).toBeCloseTo(Math.PI / 2);
  });
});

describe('ruler rotation snapping', () => {
  it.each([
    [Math.PI * 0.24, Math.PI / 4],
    [Math.PI * 0.49, Math.PI / 2],
    [-Math.PI * 0.24, -Math.PI / 4],
  ])('snaps %p radians to the nearest 45-degree multiple', (rotationRad, expected) => {
    // Given / When: 尺子旋转角落在相邻两个 45° 倍数之间。
    const snapped = snapRulerRotation(rotationRad);

    // Then: 角度吸附到距离最近的 45° 倍数，负角度保持方向。
    expect(snapped).toBeCloseTo(expected);
  });
});
