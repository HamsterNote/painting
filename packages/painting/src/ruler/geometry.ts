/**
 * Ruler 几何模块 — 纯数学，不依赖 React / DOM。
 *
 * 约定：
 * - 输入点与尺子必须位于同一坐标系；当前尺子使用宿主局部 CSS 像素
 * - 尺子按无限长条处理；`length` 只控制屏幕上用于覆盖视口的渲染长度
 */

// ─── 类型 ────────────────────────────────────────────────────────────────────

/** 二维点，兼容 DrawingPoint 但不含 pressure */
export interface RulerPoint {
  readonly x: number;
  readonly y: number;
}

export interface RulerRect {
  /** ruler 中心位置；单位与命中点一致 */
  readonly center: RulerPoint;
  readonly length: number;
  /** ruler 高度（沿 y 轴方向，旋转前） */
  readonly height: number;
  /** 顺时针旋转弧度；省略时保持向后兼容并按 0 处理 */
  readonly rotationRad?: number;
}

export type RulerState = {
  readonly center: RulerPoint;
  readonly rotationRad: number;
};

export type RulerEdgeConstraint = {
  readonly ruler: RulerRect;
  readonly edgeNormal: -1 | 1;
  readonly phase: 'approaching' | 'constrained';
};

export type RulerEdgeConstraintResult = {
  readonly point: RulerPoint;
  readonly constraint: RulerEdgeConstraint;
};

export type InfiniteRulerLayout = {
  readonly visualCenter: RulerPoint;
  readonly renderLength: number;
  readonly tickOriginX: number;
};

export type InfiniteRulerLayoutOptions = {
  readonly logicalCenter: RulerPoint;
  readonly rotationRad: number;
  readonly height: number;
  readonly viewport: { readonly width: number; readonly height: number };
};

const RULER_ROTATION_SNAP_RAD = Math.PI / 4;
const RULER_ROTATION_SNAP_TOLERANCE_RAD = (6 * Math.PI) / 180;

export function snapRulerRotation(rotationRad: number): number {
  const snappedRotation =
    Math.round(rotationRad / RULER_ROTATION_SNAP_RAD) * RULER_ROTATION_SNAP_RAD;
  return Math.abs(rotationRad - snappedRotation) <= RULER_ROTATION_SNAP_TOLERANCE_RAD
    ? snappedRotation
    : rotationRad;
}

/**
 * 判断同坐标系中的点是否在 ruler 矩形区域内。
 */
export function isInsideRuler(point: RulerPoint, ruler: RulerRect): boolean {
  const dx = point.x - ruler.center.x;
  const dy = point.y - ruler.center.y;
  const rotationRad = ruler.rotationRad ?? 0;
  const sine = Math.sin(rotationRad);
  const cosine = Math.cos(rotationRad);
  const localY = -dx * sine + dy * cosine;

  return Math.abs(localY) <= ruler.height / 2;
}

/**
 * 记录一次绘制手势所选择的物理尺边。尺边只在手势越过它后锁定，
 * 因而指针从尺子外侧接近时仍保持自然轨迹。
 */
export function createRulerEdgeConstraint(
  start: RulerPoint,
  ruler: RulerRect
): RulerEdgeConstraint {
  const rotationRad = ruler.rotationRad ?? 0;
  const localY =
    -(start.x - ruler.center.x) * Math.sin(rotationRad) +
    (start.y - ruler.center.y) * Math.cos(rotationRad);

  return {
    ruler,
    edgeNormal: localY >= 0 ? 1 : -1,
    phase: 'approaching',
  };
}

export function constrainPointToRulerEdge(
  point: RulerPoint,
  constraint: RulerEdgeConstraint
): RulerEdgeConstraintResult {
  const { ruler, edgeNormal } = constraint;
  const rotationRad = ruler.rotationRad ?? 0;
  const sine = Math.sin(rotationRad);
  const cosine = Math.cos(rotationRad);
  const dx = point.x - ruler.center.x;
  const dy = point.y - ruler.center.y;
  const localY = -dx * sine + dy * cosine;
  const halfHeight = ruler.height / 2;

  if (constraint.phase === 'approaching') {
    const distanceTowardRuler = edgeNormal * localY;
    if (distanceTowardRuler >= halfHeight) {
      return { point, constraint };
    }
    if (distanceTowardRuler < -halfHeight) {
      return { point, constraint: createRulerEdgeConstraint(point, ruler) };
    }
  } else if (Math.abs(localY) > halfHeight) {
    return { point, constraint: createRulerEdgeConstraint(point, ruler) };
  }

  return {
    point: projectPointToRulerEdge(point, constraint),
    constraint:
      constraint.phase === 'constrained' ? constraint : { ...constraint, phase: 'constrained' },
  };
}

export function projectPointToRulerEdge(
  point: RulerPoint,
  constraint: RulerEdgeConstraint
): RulerPoint {
  const { ruler, edgeNormal } = constraint;
  const rotationRad = ruler.rotationRad ?? 0;
  const sine = Math.sin(rotationRad);
  const cosine = Math.cos(rotationRad);
  const dx = point.x - ruler.center.x;
  const dy = point.y - ruler.center.y;
  const localX = dx * cosine + dy * sine;
  const edgeY = edgeNormal * (ruler.height / 2);

  return {
    x: ruler.center.x + localX * cosine - edgeY * sine,
    y: ruler.center.y + localX * sine + edgeY * cosine,
  };
}

export function projectPointToRulerCenterline(
  point: RulerPoint,
  ruler: Pick<RulerRect, 'center' | 'rotationRad'>
): RulerPoint {
  const rotationRad = ruler.rotationRad ?? 0;
  const sine = Math.sin(rotationRad);
  const cosine = Math.cos(rotationRad);
  const dx = point.x - ruler.center.x;
  const dy = point.y - ruler.center.y;
  const localX = dx * cosine + dy * sine;

  return {
    x: ruler.center.x + localX * cosine,
    y: ruler.center.y + localX * sine,
  };
}

export function getInfiniteRulerLayout(options: InfiniteRulerLayoutOptions): InfiniteRulerLayout {
  const viewportCenter = {
    x: options.viewport.width / 2,
    y: options.viewport.height / 2,
  };
  const axis = {
    x: Math.cos(options.rotationRad),
    y: Math.sin(options.rotationRad),
  };
  const centerToViewport = {
    x: viewportCenter.x - options.logicalCenter.x,
    y: viewportCenter.y - options.logicalCenter.y,
  };
  const viewportProjection = centerToViewport.x * axis.x + centerToViewport.y * axis.y;
  const clipAxis = (origin: number, direction: number, maximum: number) => {
    if (Math.abs(direction) < Number.EPSILON) {
      return origin >= 0 && origin <= maximum
        ? { minimum: Number.NEGATIVE_INFINITY, maximum: Number.POSITIVE_INFINITY }
        : null;
    }
    const first = -origin / direction;
    const second = (maximum - origin) / direction;
    return { minimum: Math.min(first, second), maximum: Math.max(first, second) };
  };
  const xInterval = clipAxis(options.logicalCenter.x, axis.x, options.viewport.width);
  const yInterval = clipAxis(options.logicalCenter.y, axis.y, options.viewport.height);
  const clippedMinimum = Math.max(
    xInterval?.minimum ?? Number.POSITIVE_INFINITY,
    yInterval?.minimum ?? Number.POSITIVE_INFINITY
  );
  const clippedMaximum = Math.min(
    xInterval?.maximum ?? Number.NEGATIVE_INFINITY,
    yInterval?.maximum ?? Number.NEGATIVE_INFINITY
  );
  const projection =
    clippedMinimum <= clippedMaximum ? (clippedMinimum + clippedMaximum) / 2 : viewportProjection;
  const visualCenter = {
    x: options.logicalCenter.x + projection * axis.x,
    y: options.logicalCenter.y + projection * axis.y,
  };
  const diagonal = Math.hypot(options.viewport.width, options.viewport.height);

  return {
    visualCenter,
    renderLength: Math.max(diagonal * 2 + options.height * 2, options.height),
    tickOriginX: -projection,
  };
}

export function rotateRulerAround(
  ruler: RulerState,
  pivot: RulerPoint,
  deltaRad: number
): RulerState {
  const cosine = Math.cos(deltaRad);
  const sine = Math.sin(deltaRad);
  const offsetX = ruler.center.x - pivot.x;
  const offsetY = ruler.center.y - pivot.y;

  return {
    center: {
      x: pivot.x + offsetX * cosine - offsetY * sine,
      y: pivot.y + offsetX * sine + offsetY * cosine,
    },
    rotationRad: ruler.rotationRad + deltaRad,
  };
}
