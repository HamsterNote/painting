import { getDrawingStrokeBounds } from './geometry';
import { prepareDrawingDocument, type DrawingBounds } from './preparedDocument';
import type { DocumentStrokeTarget } from './selectionTransform';
import type { DrawingStrokeV2, DrawingValueV2 } from '../model/strokes';

/** 多选框是所选 stroke 保守世界 AABB 的并集，不是随内容旋转的 OBB。 */
export type SelectionFrame = Readonly<{
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}>;

/** 退化 path 也需要可拖动的世界选框；screen handle 尺寸不会改变这个 document anchor。 */
export const MINIMUM_SELECTION_FRAME_EXTENT = 1;

function matches(stroke: DrawingStrokeV2 | undefined, target: DocumentStrokeTarget): boolean {
  return (
    stroke !== undefined &&
    Number.isInteger(target.index) &&
    target.index >= 0 &&
    stroke.id === target.expectedId &&
    (target.expectedTool === undefined || stroke.tool === target.expectedTool)
  );
}

function finitePointBounds(stroke: DrawingStrokeV2): DrawingBounds | null {
  if (stroke.points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of stroke.points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return [minX, minY, maxX, maxY].every(Number.isFinite) ? { minX, minY, maxX, maxY } : null;
}

function visualOutset(stroke: DrawingStrokeV2): number | null {
  const strokeWidth = stroke.strokeWidth ?? 2;
  if (!Number.isFinite(strokeWidth) || strokeWidth < 0) return null;
  // prepared bounds 以完整半宽作为 pressure 安全上界；未进入 prepared 的退化 path 保持同一保守策略。
  return strokeWidth / 2;
}

function fallbackBounds(stroke: DrawingStrokeV2): DrawingBounds | null {
  const geometryBounds = getDrawingStrokeBounds(stroke) ?? finitePointBounds(stroke);
  const outset = visualOutset(stroke);
  if (!geometryBounds || outset === null) return null;
  const minX = geometryBounds.minX - outset;
  const minY = geometryBounds.minY - outset;
  const maxX = geometryBounds.maxX + outset;
  const maxY = geometryBounds.maxY + outset;
  return [minX, minY, maxX, maxY].every(Number.isFinite) ? { minX, minY, maxX, maxY } : null;
}

function minimumExtent(min: number, max: number): readonly [number, number] | null {
  const extent = max - min;
  if (!Number.isFinite(extent) || extent < 0) return null;
  if (extent >= MINIMUM_SELECTION_FRAME_EXTENT) return [min, max];
  const center = min / 2 + max / 2;
  const half = MINIMUM_SELECTION_FRAME_EXTENT / 2;
  const nextMin = center - half;
  const nextMax = center + half;
  return Number.isFinite(nextMin) && Number.isFinite(nextMax) ? [nextMin, nextMax] : null;
}

/**
 * 根据已冻结的 index/id/tool targets 派生保守 world AABB。任意 stale、重复或无几何 target
 * 都返回 null，避免候选 UI 为与可提交集合不同的一组 stroke 绘制选框。
 */
export function deriveSelectionFrame(
  document: DrawingValueV2,
  targets: readonly DocumentStrokeTarget[]
): SelectionFrame | null {
  if (targets.length === 0) return null;
  const indexes = new Set<number>();
  // prepared bounds 是渲染/查询权威，已含旋转 box/ellipse、cubic 控制点 hull 与保守描边/pressure 外扩。
  const preparedByIndex = new Map(prepareDrawingDocument(document).entries.map((entry) => [entry.key, entry.bounds]));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const target of targets) {
    if (indexes.has(target.index) || !matches(document.strokes[target.index], target)) return null;
    indexes.add(target.index);
    const stroke = document.strokes[target.index];
    const bounds = preparedByIndex.get(target.index) ?? fallbackBounds(stroke);
    if (bounds === null) return null;
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  }
  const horizontal = minimumExtent(minX, maxX);
  const vertical = minimumExtent(minY, maxY);
  if (!horizontal || !vertical) return null;
  [minX, maxX] = horizontal;
  [minY, maxY] = vertical;
  const width = maxX - minX;
  const height = maxY - minY;
  return [minX, minY, maxX, maxY, width, height].every(Number.isFinite)
    ? Object.freeze({ minX, minY, maxX, maxY, width, height })
    : null;
}
