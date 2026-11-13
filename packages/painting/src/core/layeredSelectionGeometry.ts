import type { LayeredEditorController } from './layeredEditorController';
import type { SelectionOperation } from './layeredToolSession';
import type { Point } from '../model/document';
import { applyAffine, invertAffine } from '../geometry/affine';
import type { AffineTransform } from '../model/document';

export type SelectionRect = Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>;
export type LayeredSelectionGeometry = Readonly<{
  /** Rectangles and handle positions are in the unrotated host-DIP local space. */
  frame: SelectionRect;
  localToHost: AffineTransform;
  hostToLocal: AffineTransform;
  corners: readonly Point[];
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
  const session =
    controller.getSnapshot('preview').selectionFrame ?? controller.getSnapshot('selectionFrame');
  if (!session) return null;
  const v = controller.getSnapshot('viewport').viewport;
  const { transform: t, bounds } = session;
  const scale = Math.hypot(t.a, t.b);
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(v.scale) || v.scale <= 0)
    return null;
  const frame = {
    minX: bounds.minX * scale * v.scale,
    minY: bounds.minY * scale * v.scale,
    maxX: bounds.maxX * scale * v.scale,
    maxY: bounds.maxY * scale * v.scale,
  };
  // Keep screen-size handles independent of both viewport and accumulated object scale.
  const localToHost = {
    a: t.a / scale,
    b: t.b / scale,
    c: t.c / scale,
    d: t.d / scale,
    tx: t.tx * v.scale + v.tx,
    ty: t.ty * v.scale + v.ty,
  };
  // Preserve the historical unrotated host coordinates for consumers and zero-angle tests.
  frame.minX += localToHost.tx;
  frame.maxX += localToHost.tx;
  frame.minY += localToHost.ty;
  frame.maxY += localToHost.ty;
  localToHost.tx -=
    localToHost.a * (t.tx * v.scale + v.tx) + localToHost.c * (t.ty * v.scale + v.ty);
  localToHost.ty -=
    localToHost.b * (t.tx * v.scale + v.tx) + localToHost.d * (t.ty * v.scale + v.ty);
  const hostToLocal = invertAffine(localToHost);
  if (!hostToLocal || !Object.values(frame).every(Number.isFinite)) return null;
  const corners = [
    { x: frame.minX, y: frame.minY },
    { x: frame.maxX, y: frame.minY },
    { x: frame.maxX, y: frame.maxY },
    { x: frame.minX, y: frame.maxY },
  ].map((p) => applyAffine(localToHost, p));
  if (corners.some((p) => !p)) return null;
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
  return { frame, resize, rotate, region, localToHost, hostToLocal, corners: corners as Point[] };
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
  const local = applyAffine(geometry.hostToLocal, point);
  if (!local) return null;
  point = local;
  const { rotate } = geometry;
  if (Math.hypot(point.x - rotate.x, point.y - rotate.y) <= rotate.radius) return 'rotate';
  if (contains(geometry.resize, point)) return 'resize';
  return contains(geometry.region, point) ? 'move' : null;
}
