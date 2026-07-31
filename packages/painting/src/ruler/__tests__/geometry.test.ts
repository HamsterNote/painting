import {
  constrainPointToRulerEdge,
  createRulerEdgeConstraint,
  getInfiniteRulerLayout,
  isInsideRuler,
  projectPointToRulerCenterline,
  type RulerRect,
  rotateRulerAround,
  snapRulerRotation,
} from '../geometry';

describe('physical ruler edge constraint', () => {
  const ruler: RulerRect = {
    center: { x: 100, y: 100 },
    length: 400,
    height: 40,
    rotationRad: 0,
  };

  it('selects the nearer edge and leaves points untouched before crossing it', () => {
    // Given: 指针从尺子上方开始，最近的物理尺边是 y=80。
    const constraint = createRulerEdgeConstraint({ x: 40, y: 60 }, ruler);

    // When: 指针仍停留在起点同侧。
    const result = constrainPointToRulerEdge({ x: 70, y: 70 }, constraint);

    // Then: 约束尚未锁定，原始点不被提前吸到尺边。
    expect(result.constraint.phase).toBe('approaching');
    expect(result.point).toEqual({ x: 70, y: 70 });
  });

  it('re-arms from the exit side so the same gesture can constrain again after re-entry', () => {
    // Given: 指针从上方接近 y=80 的尺边。
    const constraint = createRulerEdgeConstraint({ x: 40, y: 60 }, ruler);

    // When: 指针先跨入尺身，再从另一侧离开尺子，随后重新进入尺身。
    const crossed = constrainPointToRulerEdge({ x: 70, y: 90 }, constraint);
    const leftRuler = constrainPointToRulerEdge({ x: 120, y: 140 }, crossed.constraint);
    const reentered = constrainPointToRulerEdge({ x: 150, y: 90 }, leftRuler.constraint);

    // Then: 首次进入吸到上边；离尺样本保持原始值，并从下侧重新等待下一次进入。
    expect(crossed.constraint.phase).toBe('constrained');
    expect(crossed.point).toEqual({ x: 70, y: 80 });
    expect(leftRuler.constraint).toMatchObject({
      phase: 'approaching',
      edgeNormal: 1,
    });
    expect(leftRuler.point).toEqual({ x: 120, y: 140 });
    expect(reentered.constraint.phase).toBe('constrained');
    expect(reentered.point).toEqual({ x: 150, y: 120 });
  });

  it('keeps approaching after touching the selected edge without crossing it', () => {
    // Given: 指针从尺子上方接近 y=80 的尺边。
    const constraint = createRulerEdgeConstraint({ x: 40, y: 60 }, ruler);

    // When: 指针先精确接触尺边，随后退回同侧，最后才真正进入尺身。
    const touched = constrainPointToRulerEdge({ x: 70, y: 80 }, constraint);
    const retreated = constrainPointToRulerEdge({ x: 90, y: 70 }, touched.constraint);
    const crossed = constrainPointToRulerEdge({ x: 110, y: 90 }, retreated.constraint);

    // Then: 接触和后退都不改变阶段；真正跨入后才约束到最初选择的尺边。
    expect(touched.constraint.phase).toBe('approaching');
    expect(touched.point).toEqual({ x: 70, y: 80 });
    expect(retreated.constraint.phase).toBe('approaching');
    expect(retreated.point).toEqual({ x: 90, y: 70 });
    expect(crossed.constraint.phase).toBe('constrained');
    expect(crossed.point).toEqual({ x: 110, y: 80 });
  });

  it('re-arms without inventing a constrained point when one sparse sample jumps across', () => {
    // Given: 指针从尺子上方开始，尚未进入尺身。
    const constraint = createRulerEdgeConstraint({ x: 40, y: 60 }, ruler);

    // When: 下一个稀疏采样直接落到尺子下方，随后又回到尺身内。
    const jumpedAcross = constrainPointToRulerEdge({ x: 100, y: 140 }, constraint);
    const reentered = constrainPointToRulerEdge({ x: 130, y: 90 }, jumpedAcross.constraint);

    // Then: 跳越点不补造吸附，但落到下侧后会重新等待下一次真实进入。
    expect(jumpedAcross.constraint).toMatchObject({
      phase: 'approaching',
      edgeNormal: 1,
    });
    expect(jumpedAcross.point).toEqual({ x: 100, y: 140 });
    expect(reentered.constraint.phase).toBe('constrained');
    expect(reentered.point).toEqual({ x: 130, y: 120 });
  });

  it('projects onto the nearer edge of a rotated ruler', () => {
    // Given: 竖直尺子的左侧边为 x=80，指针从其左侧开始。
    const rotatedRuler = { ...ruler, rotationRad: Math.PI / 2 };
    const constraint = createRulerEdgeConstraint({ x: 60, y: 40 }, rotatedRuler);

    // When: 指针横向跨过左侧边。
    const result = constrainPointToRulerEdge({ x: 95, y: 150 }, constraint);

    // Then: 点沿尺轴保留纵向位置，并投影到 x=80 的同一条物理边。
    expect(result.point.x).toBeCloseTo(80);
    expect(result.point.y).toBeCloseTo(150);
  });

  it('projects a point onto a rotated ruler centerline', () => {
    // Given: 一把 45° 尺子和一个偏离其中线的触摸中点。
    const rotatedRuler = { ...ruler, rotationRad: Math.PI / 4 };

    // When: 将触摸中点投影到尺子中线。
    const projected = projectPointToRulerCenterline({ x: 120, y: 100 }, rotatedRuler);

    // Then: 投影点的 x/y 沿 45° 中线等量偏移。
    expect(projected.x).toBeCloseTo(110);
    expect(projected.y).toBeCloseTo(110);
  });
});

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

  it('uses the midpoint of the viewport-clipped centerline as the visible center', () => {
    // Given: 45° 尺子中线从画布左上角进入、底边离开；其逻辑原点不在裁切段中点。
    const viewport = { width: 800, height: 600 };

    // When: 计算无限尺在可视区域中的布局。
    const layout = getInfiniteRulerLayout({
      logicalCenter: { x: 100, y: 100 },
      rotationRad: Math.PI / 4,
      height: 48,
      viewport,
    });

    // Then: 可见中心是裁切中线段 (0,0)→(600,600) 的中点，并严格位于尺子中线上。
    expect(layout.visualCenter.x).toBeCloseTo(300);
    expect(layout.visualCenter.y).toBeCloseTo(300);
    expect(layout.tickOriginX).toBeCloseTo(-Math.hypot(200, 200));
  });
});

describe('ruler rotation snapping', () => {
  it.each([
    [Math.PI * 0.24, Math.PI / 4],
    [Math.PI * 0.49, Math.PI / 2],
    [-Math.PI * 0.24, -Math.PI / 4],
  ])('snaps %p radians to the nearest 45-degree multiple', (rotationRad, expected) => {
    // Given / When: 尺子旋转角已进入某个 45° 倍数附近的吸附范围。
    const snapped = snapRulerRotation(rotationRad);

    // Then: 角度吸附到距离最近的 45° 倍数，负角度保持方向。
    expect(snapped).toBeCloseTo(expected);
  });

  it.each([Math.PI / 6, -Math.PI / 6])(
    'keeps %p radians free outside the snap tolerance',
    (rotationRad) => {
      // Given / When: 尺子方向距离最近的 45° 倍数仍有明显距离。
      const rotation = snapRulerRotation(rotationRad);

      // Then: 范围外保持连续自由旋转，不提前跳到吸附角。
      expect(rotation).toBeCloseTo(rotationRad);
    }
  );
});
