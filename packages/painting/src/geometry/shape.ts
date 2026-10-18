/**
 * 形状几何派生（Task 5.1 基础）
 *
 * 只依赖 `model/document.ts` 的 `ShapeObject` / `ShapeStyle` / `ShapeType` / `Bounds` / `Point`
 * 类型契约；无 DOM / PF / V2 / Skia import，不依赖 controller。
 *
 * - 输出为直接 M/L/C/E/Z 命令（单一实现，无自主平滑/圆整）；不 begin/fill/stroke（渲染调用方负责）。
 * - 仅 local 几何，不 apply 对象 transform。
 * - 任何运行时非法 / 缺失 / 非有限 / 不支持 / 派生溢出输入返回 `null`，不 mutation、不 throw。
 * - 所有输出深冻结。
 */

import type { Bounds, Point, ShapeObject, ShapeStyle, ShapeType } from '../model/document';

/** 形状 path 命令；ellipse 为完整 2π 椭圆（Canvas 语义），SVG 序列化时展开为两段圆弧。 */
export type ShapeCommand =
  | Readonly<{ type: 'moveTo'; x: number; y: number }>
  | Readonly<{ type: 'lineTo'; x: number; y: number }>
  | Readonly<{
      type: 'bezierCurveTo';
      cp1x: number;
      cp1y: number;
      cp2x: number;
      cp2y: number;
      x: number;
      y: number;
    }>
  | Readonly<{ type: 'ellipse'; cx: number; cy: number; rx: number; ry: number }>
  | Readonly<{ type: 'closePath' }>;

/**
 * 结构化回放目标：Canvas2D context 与 `Path2D` 都可满足（**无 beginPath**）。
 * 与 `geometry/closedPath.ts` 的 `ClosedPathTarget` 同风格，回放不负责重置路径。
 */
export interface ShapePathTarget {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    anticlockwise?: boolean
  ): void;
  closePath(): void;
}

/** 派生形状几何：local 命令与 bounds。 */
export type DerivedShapeGeometry = Readonly<{
  commands: readonly ShapeCommand[];
  localBounds: Bounds;
  visualLocalBounds: Bounds;
}>;

const KNOWN_SHAPE_TYPES: readonly ShapeType[] = ['line', 'rect', 'ellipse', 'polygon', 'bezier'];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** 校验并白名单拷贝样式；非法返回 null（不引用未知字段）。 */
function readStyle(value: unknown): ShapeStyle | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const style = value as Record<string, unknown>;
  if (!isNonEmptyString(style.color)) {
    return null;
  }
  if (!isFiniteNumber(style.width) || style.width <= 0) {
    return null;
  }
  if (!isFiniteNumber(style.opacity) || style.opacity < 0 || style.opacity > 1) {
    return null;
  }
  if (style.dash !== undefined) {
    if (
      !Array.isArray(style.dash) ||
      !style.dash.every((entry) => isFiniteNumber(entry) && entry >= 0)
    ) {
      return null;
    }
  }
  if (style.fill !== undefined && typeof style.fill !== 'string') {
    return null;
  }
  const result: {
    color: string;
    width: number;
    opacity: number;
    dash?: readonly number[];
    fill?: string;
  } = {
    color: style.color,
    width: style.width,
    opacity: style.opacity,
  };
  if (style.dash !== undefined) {
    result.dash = Object.freeze((style.dash as number[]).slice());
  }
  if (style.fill !== undefined) {
    result.fill = style.fill as string;
  }
  return Object.freeze(result);
}

/** 读取有限点序列；任一非法返回 null。 */
function readFinitePoints(value: unknown): readonly Point[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const points: Point[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      return null;
    }
    const point = entry as Record<string, unknown>;
    if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
      return null;
    }
    points.push(Object.freeze({ x: point.x, y: point.y }));
  }
  return Object.freeze(points);
}

/** 点集 min/max；空集调用方保证非空。 */
function pointsBounds(points: readonly Point[]): Bounds | null {
  if (points.length === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) {
      minX = point.x;
    }
    if (point.y < minY) {
      minY = point.y;
    }
    if (point.x > maxX) {
      maxX = point.x;
    }
    if (point.y > maxY) {
      maxY = point.y;
    }
  }
  return Object.freeze({ minX, minY, maxX, maxY });
}

/** 由两角构造椭圆（safe 中心 a/2+b/2 + 半径 diff/2）；溢出/非有限返回 null。 */
function ellipseFromCorners(
  first: Point,
  second: Point
): Readonly<{ cx: number; cy: number; rx: number; ry: number }> | null {
  const cx = first.x / 2 + second.x / 2;
  const cy = first.y / 2 + second.y / 2;
  const rx = Math.abs(second.x - first.x) / 2;
  const ry = Math.abs(second.y - first.y) / 2;
  if (
    !Number.isFinite(cx) ||
    !Number.isFinite(cy) ||
    !Number.isFinite(rx) ||
    !Number.isFinite(ry)
  ) {
    return null;
  }
  return Object.freeze({ cx, cy, rx, ry });
}

/** 保守视觉 bounds：localBounds 统一按 width/2 外扩；非有限返回 null。 */
function expandBounds(bounds: Bounds, halfWidth: number): Bounds | null {
  const minX = bounds.minX - halfWidth;
  const minY = bounds.minY - halfWidth;
  const maxX = bounds.maxX + halfWidth;
  const maxY = bounds.maxY + halfWidth;
  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  ) {
    return null;
  }
  return Object.freeze({ minX, minY, maxX, maxY });
}

function allFiniteBounds(bounds: Bounds): boolean {
  return (
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.maxY)
  );
}

/** 一维 cubic Bézier B(t) 在参数 t 的求值。 */
function cubicValue(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

/**
 * 一维 cubic 在 [0,1] 的精确极值候选 t（端点 + 导数根）。
 * 系数、判别式、分母或根运算出现非有限（溢出/underflow）一律返回 null，
 * 绝不以“忽略根”的方式退化成错误的端点 bounds；不使用任意 epsilon；a===0 退化为线性。
 */
function cubicExtremaTs(p0: number, p1: number, p2: number, p3: number): readonly number[] | null {
  const a = p1 - p0 - 2 * (p2 - p1) + (p3 - p2);
  const b = 2 * (p2 - p1 - (p1 - p0));
  const c = p1 - p0;
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) {
    return null;
  }
  const ts: number[] = [0, 1];
  if (a === 0) {
    if (b !== 0) {
      const t = -c / b;
      if (!Number.isFinite(t)) {
        return null;
      }
      if (t > 0 && t < 1) {
        ts.push(t);
      }
    }
  } else {
    const discriminant = b * b - 4 * a * c;
    if (!Number.isFinite(discriminant)) {
      return null;
    }
    if (discriminant >= 0) {
      const sqrt = Math.sqrt(discriminant);
      const denominator = 2 * a;
      if (!Number.isFinite(sqrt) || !Number.isFinite(denominator)) {
        return null;
      }
      const t1 = (-b + sqrt) / denominator;
      const t2 = (-b - sqrt) / denominator;
      if (!Number.isFinite(t1) || !Number.isFinite(t2)) {
        return null;
      }
      if (t1 > 0 && t1 < 1) {
        ts.push(t1);
      }
      if (t2 > 0 && t2 < 1) {
        ts.push(t2);
      }
    }
  }
  return ts;
}

/** cubic 2D 精确 AABB（导数根求值，不用控制点 hull 当 final bounds）；非有限返回 null。 */
function cubicBounds(p0: Point, p1: Point, p2: Point, p3: Point): Bounds | null {
  const xs = cubicExtremaTs(p0.x, p1.x, p2.x, p3.x);
  const ys = cubicExtremaTs(p0.y, p1.y, p2.y, p3.y);
  if (!xs || !ys) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of xs) {
    const x = cubicValue(p0.x, p1.x, p2.x, p3.x, t);
    if (!Number.isFinite(x)) {
      return null;
    }
    if (x < minX) {
      minX = x;
    }
    if (x > maxX) {
      maxX = x;
    }
  }
  for (const t of ys) {
    const y = cubicValue(p0.y, p1.y, p2.y, p3.y, t);
    if (!Number.isFinite(y)) {
      return null;
    }
    if (y < minY) {
      minY = y;
    }
    if (y > maxY) {
      maxY = y;
    }
  }
  return Object.freeze({ minX, minY, maxX, maxY });
}

/**
 * 所有点是否共线（允许 interior 重复点）。用 `direction - origin` 差值计算 cross，
 * 而不是绝对坐标；中间运算非有限（溢出）返回 null，由调用方按 reject 处理，不假非共线。
 * 返回 true=共线，false=存在非共线，null=无法精确判定。
 */
function isCollinear(points: readonly Point[]): boolean | null {
  const origin = points[0]!;
  let direction: Point | undefined;
  for (let index = 1; index < points.length; index += 1) {
    const candidate = points[index]!;
    if (candidate.x !== origin.x || candidate.y !== origin.y) {
      direction = candidate;
      break;
    }
  }
  if (!direction) {
    return true; // 全部重合 → 共线。
  }
  const dx = direction.x - origin.x;
  const dy = direction.y - origin.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    return null;
  }
  for (const point of points) {
    const px = point.x - origin.x;
    const py = point.y - origin.y;
    const cross = dx * py - dy * px;
    if (!Number.isFinite(cross)) {
      return null;
    }
    if (cross !== 0) {
      return false;
    }
  }
  return true;
}

/** 深冻结命令数组与每条命令。 */
function freezeCommands(commands: readonly ShapeCommand[]): readonly ShapeCommand[] {
  return Object.freeze(commands.map((command) => Object.freeze({ ...command })) as ShapeCommand[]);
}

/**
 * 派生形状几何：命令 + local bounds + 保守视觉 bounds（width/2 外扩）。
 * 运行时非法 / 缺失 / 非有限 / 不支持类型 / 派生溢出返回 null；不 mutation。
 */
export function deriveShapeGeometry(shape: ShapeObject): DerivedShapeGeometry | null {
  if (!shape || typeof shape !== 'object') {
    return null;
  }
  const record = shape as unknown as Record<string, unknown>;
  if (
    typeof record.shapeType !== 'string' ||
    !KNOWN_SHAPE_TYPES.includes(record.shapeType as ShapeType)
  ) {
    return null;
  }
  const shapeType = record.shapeType as ShapeType;
  const points = readFinitePoints(record.points);
  if (!points) {
    return null;
  }
  const style = readStyle(record.style);
  if (!style) {
    return null;
  }

  let commands: readonly ShapeCommand[] | null = null;
  let localBounds: Bounds | null = null;

  switch (shapeType) {
    case 'line': {
      if (points.length !== 2) {
        return null;
      }
      const [start, end] = points as readonly [Point, Point];
      commands = freezeCommands([
        { type: 'moveTo', x: start.x, y: start.y },
        { type: 'lineTo', x: end.x, y: end.y },
      ]);
      localBounds = pointsBounds(points);
      break;
    }
    case 'rect': {
      if (points.length !== 2) {
        return null; // 允许零 area。
      }
      const [first, second] = points as readonly [Point, Point];
      commands = freezeCommands([
        { type: 'moveTo', x: first.x, y: first.y },
        { type: 'lineTo', x: second.x, y: first.y },
        { type: 'lineTo', x: second.x, y: second.y },
        { type: 'lineTo', x: first.x, y: second.y },
        { type: 'closePath' },
      ]);
      localBounds = pointsBounds(points);
      break;
    }
    case 'polygon': {
      if (points.length < 3) {
        return null;
      }
      const first = points[0]!;
      const last = points[points.length - 1]!;
      if (first.x === last.x && first.y === last.y) {
        return null; // 重复末点拒绝（不改 caller）。
      }
      if (isCollinear(points) !== false) {
        return null; // 共线或无法精确判定（溢出）都拒绝；至少 3 非共线。
      }
      const built: ShapeCommand[] = [{ type: 'moveTo', x: first.x, y: first.y }];
      for (let index = 1; index < points.length; index += 1) {
        const point = points[index]!;
        built.push({ type: 'lineTo', x: point.x, y: point.y });
      }
      built.push({ type: 'closePath' });
      commands = freezeCommands(built);
      localBounds = pointsBounds(points);
      break;
    }
    case 'ellipse': {
      if (points.length !== 2) {
        return null; // reader 二点；允许零 area。
      }
      const ellipse = ellipseFromCorners(points[0]!, points[1]!);
      if (!ellipse) {
        return null;
      }
      const { cx, cy, rx, ry } = ellipse;
      if (rx === 0 && ry === 0) {
        // 双零：退化为点（端点 line 退化）。
        commands = freezeCommands([
          { type: 'moveTo', x: cx, y: cy },
          { type: 'lineTo', x: cx, y: cy },
          { type: 'closePath' },
        ]);
      } else if (rx === 0) {
        // rx=0, ry>0：竖向两端 (cx, cy+ry)/(cx, cy-ry)，不产生无效 arc。
        commands = freezeCommands([
          { type: 'moveTo', x: cx, y: cy + ry },
          { type: 'lineTo', x: cx, y: cy - ry },
          { type: 'closePath' },
        ]);
      } else if (ry === 0) {
        // ry=0, rx>0：横向两端 (cx+rx, cy)/(cx-rx, cy)。
        commands = freezeCommands([
          { type: 'moveTo', x: cx + rx, y: cy },
          { type: 'lineTo', x: cx - rx, y: cy },
          { type: 'closePath' },
        ]);
      } else {
        commands = freezeCommands([
          { type: 'moveTo', x: cx + rx, y: cy },
          { type: 'ellipse', cx, cy, rx, ry },
          { type: 'closePath' },
        ]);
      }
      localBounds = Object.freeze({ minX: cx - rx, minY: cy - ry, maxX: cx + rx, maxY: cy + ry });
      if (!allFiniteBounds(localBounds)) {
        return null;
      }
      break;
    }
    case 'bezier': {
      if (points.length !== 4) {
        return null; // [P0, C1, C2, P3]。
      }
      const [p0, cp1, cp2, p3] = points as readonly [Point, Point, Point, Point];
      commands = freezeCommands([
        { type: 'moveTo', x: p0.x, y: p0.y },
        {
          type: 'bezierCurveTo',
          cp1x: cp1.x,
          cp1y: cp1.y,
          cp2x: cp2.x,
          cp2y: cp2.y,
          x: p3.x,
          y: p3.y,
        },
      ]);
      localBounds = cubicBounds(p0, cp1, cp2, p3);
      break;
    }
  }

  if (!commands || !localBounds) {
    return null;
  }
  const visualLocalBounds = expandBounds(localBounds, style.width / 2);
  if (!visualLocalBounds) {
    return null; // expanded bounds 溢出拒绝。
  }
  return Object.freeze({ commands, localBounds, visualLocalBounds });
}

/**
 * 序列化命令为 SVG path `d`。
 *
 * - 与 Canvas replay 共享同一命令序列（M/L/C/E/Z）。
 * - `ellipse` 只输出两段 large-arc 圆弧（**不额外 M/Z**；周边 moveTo/closePath 命令已提供），
 *   sweep=1 对应 Canvas `ellipse(...,0,2π,false)` 的顺时针方向，避免与 dash 方向不一致。
 * - 假定输入为 known valid commands（内部派生消费者，非 arbitrary parser）。
 */
export function shapeCommandsToSvgPath(commands: readonly ShapeCommand[]): string {
  const segments: string[] = [];
  for (const command of commands) {
    switch (command.type) {
      case 'moveTo':
        segments.push(`M ${command.x} ${command.y}`);
        break;
      case 'lineTo':
        segments.push(`L ${command.x} ${command.y}`);
        break;
      case 'bezierCurveTo':
        segments.push(
          `C ${command.cp1x} ${command.cp1y} ${command.cp2x} ${command.cp2y} ${command.x} ${command.y}`
        );
        break;
      case 'ellipse': {
        const right = command.cx + command.rx;
        const left = command.cx - command.rx;
        segments.push(`A ${command.rx} ${command.ry} 0 1 1 ${left} ${command.cy}`);
        segments.push(`A ${command.rx} ${command.ry} 0 1 1 ${right} ${command.cy}`);
        break;
      }
      case 'closePath':
        segments.push('Z');
        break;
    }
  }
  return segments.join(' ');
}

/**
 * 回放命令到结构化 target（Canvas2D context / `Path2D`）。
 *
 * - **不调用 `beginPath`**，也不 fill/stroke（渲染调用方负责）。
 * - `ellipse` 命令一命令一语义：只调用 target.ellipse(...,0,2π,false)，
 *   不自主 moveTo/closePath（序列中已有单独命令提供）。
 */
export function replayShapeCommands(
  target: ShapePathTarget,
  commands: readonly ShapeCommand[]
): void {
  for (const command of commands) {
    switch (command.type) {
      case 'moveTo':
        target.moveTo(command.x, command.y);
        break;
      case 'lineTo':
        target.lineTo(command.x, command.y);
        break;
      case 'bezierCurveTo':
        target.bezierCurveTo(
          command.cp1x,
          command.cp1y,
          command.cp2x,
          command.cp2y,
          command.x,
          command.y
        );
        break;
      case 'ellipse':
        target.ellipse(command.cx, command.cy, command.rx, command.ry, 0, 0, Math.PI * 2, false);
        break;
      case 'closePath':
        target.closePath();
        break;
    }
  }
}
