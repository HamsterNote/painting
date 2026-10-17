import type {
  DrawingPointV2,
  DrawingStrokeToolV2,
  DrawingStrokeV2,
  DrawingValueV2,
} from '../model/strokes';
import type { SelectionGestureIntent } from './gesture/session';

/** 以索引、ID 与可选工具三元组定位文档中的单条笔迹，重复 ID 也不会歧义。 */
export type DocumentStrokeTarget = Readonly<{
  index: number;
  expectedId: string;
  expectedTool?: DrawingStrokeToolV2;
}>;

/** 原子替换集中的一项；调用方应在所有项有效后一次性提交。 */
export type DocumentStrokeReplacement = Readonly<{
  target: DocumentStrokeTarget;
  stroke: DrawingStrokeV2;
}>;

export type SelectionTransformDiagnostic =
  | Readonly<{ type: 'selection-target-mismatch'; target: DocumentStrokeTarget }>
  | Readonly<{ type: 'duplicate-selection-target'; index: number }>
  | Readonly<{ type: 'invalid-selection-intent' }>
  | Readonly<{ type: 'non-uniform-selection-scale'; scale: Readonly<{ x: number; y: number }> }>
  | Readonly<{ type: 'invalid-selection-scale'; scale: number }>
  | Readonly<{ type: 'invalid-selection-stroke'; target: DocumentStrokeTarget }>
  | Readonly<{ type: 'selection-transform-noop' }>;

export type SelectionTransformResult = Readonly<{
  replacements: readonly DocumentStrokeReplacement[];
  diagnostics: readonly SelectionTransformDiagnostic[];
}>;

type Point = Readonly<{ x: number; y: number }>;

const UNIFORM_SCALE_EPSILON = 1e-6;
const MINIMUM_UNIFORM_SCALE = 1e-6;

function isFinitePoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function targetMatches(stroke: DrawingStrokeV2 | undefined, target: DocumentStrokeTarget): boolean {
  return (
    stroke !== undefined &&
    Number.isInteger(target.index) &&
    target.index >= 0 &&
    stroke.id === target.expectedId &&
    (target.expectedTool === undefined || stroke.tool === target.expectedTool)
  );
}

function pointAfterMove(point: DrawingPointV2, delta: Point): DrawingPointV2 | null {
  const x = point.x + delta.x;
  const y = point.y + delta.y;
  return Number.isFinite(x) && Number.isFinite(y) ? { ...point, x, y } : null;
}

function pointAfterRotate(
  point: DrawingPointV2,
  pivot: Point,
  deltaRad: number
): DrawingPointV2 | null {
  const cosine = Math.cos(deltaRad);
  const sine = Math.sin(deltaRad);
  const offsetX = point.x - pivot.x;
  const offsetY = point.y - pivot.y;
  const x = pivot.x + offsetX * cosine - offsetY * sine;
  const y = pivot.y + offsetX * sine + offsetY * cosine;
  return Number.isFinite(x) && Number.isFinite(y) ? { ...point, x, y } : null;
}

function pointAfterUniformScale(
  point: DrawingPointV2,
  anchor: Point,
  scale: number
): DrawingPointV2 | null {
  const x = anchor.x + (point.x - anchor.x) * scale;
  const y = anchor.y + (point.y - anchor.y) * scale;
  return Number.isFinite(x) && Number.isFinite(y) ? { ...point, x, y } : null;
}

function transformedPoints(
  points: readonly DrawingPointV2[],
  transform: (point: DrawingPointV2) => DrawingPointV2 | null
): DrawingPointV2[] | null {
  const nextPoints: DrawingPointV2[] = [];
  for (const point of points) {
    if (!isFinitePoint(point)) {
      return null;
    }
    const nextPoint = transform(point);
    if (nextPoint === null) {
      return null;
    }
    nextPoints.push(nextPoint);
  }
  return nextPoints;
}

function isBoxBackedStroke(stroke: DrawingStrokeV2): boolean {
  return (
    (stroke.tool === 'rect' ||
      stroke.tool === 'ellipse' ||
      stroke.tool === 'text' ||
      stroke.tool === 'image') &&
    stroke.points.length >= 2
  );
}

function copyStroke(
  stroke: DrawingStrokeV2,
  points: DrawingPointV2[],
  rotationRad?: number
): DrawingStrokeV2 {
  // points 与 dashArray 都是可变数组；新 document 不能与调用方输入共享这两个容器。
  return {
    ...stroke,
    points,
    ...(stroke.dashArray ? { dashArray: [...stroke.dashArray] } : {}),
    ...(rotationRad === undefined ? {} : { rotationRad }),
  } as DrawingStrokeV2;
}

function rotateBoxBackedStroke(
  stroke: DrawingStrokeV2,
  pivot: Point,
  deltaRad: number
): DrawingStrokeV2 | null {
  const first = stroke.points[0];
  const last = stroke.points[stroke.points.length - 1];
  if (!first || !last || !isFinitePoint(first) || !isFinitePoint(last)) {
    return null;
  }
  const center = { x: first.x / 2 + last.x / 2, y: first.y / 2 + last.y / 2 };
  if (!isFinitePoint(center)) {
    return null;
  }
  const rotatedCenter = pointAfterRotate(center, pivot, deltaRad);
  if (rotatedCenter === null) {
    return null;
  }
  const movedPoints = transformedPoints(stroke.points, (point) =>
    pointAfterMove(point, { x: rotatedCenter.x - center.x, y: rotatedCenter.y - center.y })
  );
  const currentRotation = stroke.rotationRad ?? 0;
  const rotationRad = currentRotation + deltaRad;
  return movedPoints !== null && Number.isFinite(currentRotation) && Number.isFinite(rotationRad)
    ? copyStroke(stroke, movedPoints, rotationRad)
    : null;
}

function transformStroke(
  stroke: DrawingStrokeV2,
  intent: SelectionGestureIntent
): DrawingStrokeV2 | null {
  // 旧 resize 不能为单点 text/image 表达框尺寸，故继续拒绝并保留非均匀缩放防线；新的
  // scalar uniform-scale 至少可变换其中所有已持久化坐标，且不会隐式修改 fontSize 等样式。
  if (
    intent.kind === 'resize' &&
    (stroke.tool === 'text' || stroke.tool === 'image') &&
    stroke.points.length < 2
  ) {
    return null;
  }
  if (intent.kind === 'move') {
    const points = transformedPoints(stroke.points, (point) => pointAfterMove(point, intent.delta));
    return points === null ? null : copyStroke(stroke, points);
  }
  if (intent.kind === 'rotate') {
    // V2 box-backed tools store unrotated endpoints plus rotationRad. Rotate their center and
    // accumulate angle instead of rotating endpoints as well, which would apply the turn twice.
    if (isBoxBackedStroke(stroke)) {
      return rotateBoxBackedStroke(stroke, intent.pivot, intent.deltaRad);
    }
    const points = transformedPoints(stroke.points, (point) =>
      pointAfterRotate(point, intent.pivot, intent.deltaRad)
    );
    return points === null ? null : copyStroke(stroke, points);
  }
  const scale = intent.kind === 'uniform-scale' ? intent.scale : intent.scale.x;
  const points = transformedPoints(stroke.points, (point) =>
    pointAfterUniformScale(point, intent.anchor, scale)
  );
  return points === null ? null : copyStroke(stroke, points);
}

function validateIntent(intent: SelectionGestureIntent): SelectionTransformDiagnostic | null {
  if (intent.kind === 'move') {
    return isFinitePoint(intent.delta) ? null : { type: 'invalid-selection-intent' };
  }
  if (intent.kind === 'rotate') {
    return isFinitePoint(intent.pivot) && Number.isFinite(intent.deltaRad)
      ? null
      : { type: 'invalid-selection-intent' };
  }
  if (intent.kind === 'uniform-scale') {
    return !isFinitePoint(intent.anchor) || !Number.isFinite(intent.scale)
      ? { type: 'invalid-selection-intent' }
      : intent.scale <= MINIMUM_UNIFORM_SCALE
        ? { type: 'invalid-selection-scale', scale: intent.scale }
        : null;
  }
  if (
    !isFinitePoint(intent.anchor) ||
    !Number.isFinite(intent.scale.x) ||
    !Number.isFinite(intent.scale.y)
  ) {
    return { type: 'invalid-selection-intent' };
  }
  const scaleDifference = Math.abs(intent.scale.x - intent.scale.y);
  const scaleMagnitude = Math.max(1, Math.abs(intent.scale.x), Math.abs(intent.scale.y));
  if (scaleDifference > UNIFORM_SCALE_EPSILON * scaleMagnitude) {
    return { type: 'non-uniform-selection-scale', scale: { ...intent.scale } };
  }
  return intent.scale.x <= MINIMUM_UNIFORM_SCALE
    ? { type: 'invalid-selection-scale', scale: intent.scale.x }
    : null;
}

function isIdentityIntent(intent: SelectionGestureIntent): boolean {
  return intent.kind === 'move'
    ? intent.delta.x === 0 && intent.delta.y === 0
    : intent.kind === 'rotate'
      ? intent.deltaRad === 0
      : intent.kind === 'uniform-scale'
        ? intent.scale === 1
        : intent.scale.x === 1 && intent.scale.y === 1;
}

/**
 * 依据 selection intent 构造一次性替换集，不直接写 document。
 *
 * uniform-scale 是新的 scalar 语义。旧 resize 仅接受 uniform scale，保留其拒绝非均匀
 * 防线；两者都因统一缩放在任意选框局部坐标系和世界坐标系中等价，
 * 可以安全地围绕 intent 的固定 anchor 直接计算，不会产生 shear 或新的持久化表示。
 */
export function transformSelection(
  document: DrawingValueV2,
  targets: readonly DocumentStrokeTarget[],
  intent: SelectionGestureIntent
): SelectionTransformResult {
  const intentDiagnostic = validateIntent(intent);
  if (intentDiagnostic) {
    return { replacements: [], diagnostics: [intentDiagnostic] };
  }

  const seenIndexes = new Set<number>();
  for (const target of targets) {
    if (seenIndexes.has(target.index)) {
      return {
        replacements: [],
        diagnostics: [{ type: 'duplicate-selection-target', index: target.index }],
      };
    }
    seenIndexes.add(target.index);
    if (!targetMatches(document.strokes[target.index], target)) {
      return { replacements: [], diagnostics: [{ type: 'selection-target-mismatch', target }] };
    }
  }
  if (isIdentityIntent(intent) || targets.length === 0) {
    return { replacements: [], diagnostics: [{ type: 'selection-transform-noop' }] };
  }

  const replacements: DocumentStrokeReplacement[] = [];
  for (const target of targets) {
    const stroke = transformStroke(document.strokes[target.index], intent);
    if (stroke === null) {
      return { replacements: [], diagnostics: [{ type: 'invalid-selection-stroke', target }] };
    }
    replacements.push({ target: { ...target }, stroke });
  }
  return { replacements, diagnostics: [] };
}
