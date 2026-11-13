import type { LayeredEditorController } from './layeredEditorController';
import type { SelectionOperation } from './layeredToolSession';
import type { Point } from '../model/document';
import { layeredGeometryCache } from './layeredGeometryCache';
import { deriveLayeredWorldBounds } from '../geometry/worldBounds';

export type SelectionRect = Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>;
export type LayeredSelectionGeometry = Readonly<{
  frame: SelectionRect;
  resize: SelectionRect;
  rotate: Readonly<{ x: number; y: number; radius: number }>;
  region: SelectionRect;
}>;

/** Schema 3 visual bounds mapped to host-local DIP, with fixed screen-size handles. */
export function deriveLayeredSelectionGeometry(
  controller: LayeredEditorController
): LayeredSelectionGeometry | null {
  if (controller.getSnapshot('tools').activeTool !== 'selection') return null;
  const selection = controller.getSnapshot('selection');
  if (!selection.length) return null;
  const document = controller.getSnapshot('document');
  const preview = controller.getSnapshot('preview');
  const v = controller.getSnapshot('viewport').viewport;
  const cache = layeredGeometryCache(controller);
  const selected = new Set(selection);
  const bounds = document.objects
    .filter((object) => selected.has(object.objectId))
    .map(
      (original) =>
        deriveLayeredWorldBounds(
          preview.objects.find((object) => object.objectId === original.objectId) ?? original,
          cache
        )?.visualWorldBounds
    );
  if (bounds.length !== selection.length || bounds.some((entry) => !entry)) return null;
  const frame = {
    minX: Math.min(...bounds.map((b) => b!.minX)) * v.scale + v.tx,
    minY: Math.min(...bounds.map((b) => b!.minY)) * v.scale + v.ty,
    maxX: Math.max(...bounds.map((b) => b!.maxX)) * v.scale + v.tx,
    maxY: Math.max(...bounds.map((b) => b!.maxY)) * v.scale + v.ty,
  };
  if (!Object.values(frame).every(Number.isFinite)) return null;
  const resize = {
    minX: frame.maxX - 5,
    minY: frame.maxY - 5,
    maxX: frame.maxX + 5,
    maxY: frame.maxY + 5,
  };
  const rotate = { x: (frame.minX + frame.maxX) / 2, y: frame.minY - 20, radius: 6 };
  const region = {
    minX: Math.min(frame.minX, resize.minX, rotate.x - rotate.radius),
    minY: Math.min(frame.minY, resize.minY, rotate.y - rotate.radius),
    maxX: Math.max(frame.maxX, resize.maxX, rotate.x + rotate.radius),
    maxY: Math.max(frame.maxY, resize.maxY, rotate.y + rotate.radius),
  };
  return { frame, resize, rotate, region };
}

function contains(rect: SelectionRect, point: Point) {
  return (
    point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY
  );
}

/** Specific handles win, then the complete enclosing rectangle, including its empty bands. */
export function hitLayeredSelectionGeometry(
  geometry: LayeredSelectionGeometry | null,
  point: Point
): SelectionOperation | null {
  if (!geometry || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const { rotate } = geometry;
  if (Math.hypot(point.x - rotate.x, point.y - rotate.y) <= rotate.radius) return 'rotate';
  if (contains(geometry.resize, point)) return 'resize';
  return contains(geometry.region, point) ? 'move' : null;
}
