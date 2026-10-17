import type { DrawingViewport } from '../viewport';
import type { Point } from './input';
import type { SelectionGestureDescriptor } from './gesture/session';
import type { SelectionFrame } from './selectionFrame';

export const DEFAULT_SELECTION_HANDLE_SIZE = 10;
export const DEFAULT_SELECTION_HIT_SLOP = 6;
export const DEFAULT_SELECTION_ROTATE_OFFSET = 24;

export type SelectionOverlayHandle = Readonly<{
  kind: 'rotate' | 'uniform-scale';
  corner?: 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';
  center: Point;
  size: number;
  hitSize: number;
  gesture: SelectionGestureDescriptor;
}>;

/** screen DIP 的同源 visual/hit 数据；host 可直接渲染和命中，不能另行猜测几何。 */
export type SelectionOverlayModel = Readonly<{
  frame: Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>;
  handles: readonly SelectionOverlayHandle[];
  moveGesture: SelectionGestureDescriptor;
}>;

export type SelectionOverlayHit = Readonly<{
  kind: 'rotate' | 'uniform-scale' | 'move';
  gesture: SelectionGestureDescriptor;
}>;

export type SelectionOverlayOptions = Readonly<{
  handleSize?: number;
  hitSlop?: number;
  rotateOffset?: number;
  minimumScreenExtent?: number;
}>;

function point(x: number, y: number): Point {
  return Object.freeze({ x, y });
}

function inside(pointToTest: Point, center: Point, size: number): boolean {
  const half = size / 2;
  return (
    pointToTest.x >= center.x - half &&
    pointToTest.x <= center.x + half &&
    pointToTest.y >= center.y - half &&
    pointToTest.y <= center.y + half
  );
}

function valid(frame: SelectionFrame, viewport: DrawingViewport): boolean {
  return (
    Number.isFinite(frame.minX) &&
    Number.isFinite(frame.minY) &&
    Number.isFinite(frame.maxX) &&
    Number.isFinite(frame.maxY) &&
    Number.isFinite(viewport.scale) &&
    Number.isFinite(viewport.tx) &&
    Number.isFinite(viewport.ty) &&
    viewport.scale > 0
  );
}

/**
 * 将 world AABB 变为 screen-DIP 选框。AABB 保持轴对齐，故 rotationRad 恒为零；这不是 OBB。
 * 四角是唯一 scale hit，边中点不产生 resize 手势。
 */
export function deriveSelectionOverlayModel(
  worldFrame: SelectionFrame,
  viewport: DrawingViewport,
  options: SelectionOverlayOptions = {}
): SelectionOverlayModel | null {
  if (!valid(worldFrame, viewport)) return null;
  const handleSize = options.handleSize ?? DEFAULT_SELECTION_HANDLE_SIZE;
  const hitSlop = options.hitSlop ?? DEFAULT_SELECTION_HIT_SLOP;
  const rotateOffset = options.rotateOffset ?? DEFAULT_SELECTION_ROTATE_OFFSET;
  const minimumScreenExtent = options.minimumScreenExtent ?? handleSize;
  if (
    ![handleSize, hitSlop, rotateOffset, minimumScreenExtent].every(Number.isFinite) ||
    handleSize <= 0 ||
    hitSlop < 0 ||
    rotateOffset < 0 ||
    minimumScreenExtent <= 0
  )
    return null;

  const minX = worldFrame.minX * viewport.scale + viewport.tx;
  const minY = worldFrame.minY * viewport.scale + viewport.ty;
  const maxX = worldFrame.maxX * viewport.scale + viewport.tx;
  const maxY = worldFrame.maxY * viewport.scale + viewport.ty;
  if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) return null;
  const frame = Object.freeze({ minX, minY, maxX, maxY });
  const box = Object.freeze({
    center: point((minX + maxX) / 2, (minY + maxY) / 2),
    width: maxX - minX,
    height: maxY - minY,
    rotationRad: 0,
  });
  const corners = [
    ['top-left', point(minX, minY), point(maxX, maxY)],
    ['top-right', point(maxX, minY), point(minX, maxY)],
    ['bottom-right', point(maxX, maxY), point(minX, minY)],
    ['bottom-left', point(minX, maxY), point(maxX, minY)],
  ] as const;
  const handles: SelectionOverlayHandle[] = [];
  const rotateCenter = point((minX + maxX) / 2, minY - rotateOffset);
  handles.push(
    Object.freeze({
      kind: 'rotate',
      center: rotateCenter,
      size: handleSize,
      hitSize: handleSize + hitSlop * 2,
      gesture: Object.freeze({ kind: 'rotate', box, pivot: box.center }),
    })
  );
  for (const [corner, handle, anchor] of corners) {
    handles.push(
      Object.freeze({
        kind: 'uniform-scale',
        corner,
        center: handle,
        size: handleSize,
        hitSize: handleSize + hitSlop * 2,
        gesture: Object.freeze({ kind: 'uniform-scale', box, anchor, handle, minimumScreenExtent }),
      })
    );
  }
  return Object.freeze({
    frame,
    handles: Object.freeze(handles),
    moveGesture: Object.freeze({ kind: 'move', box }),
  });
}

/** 按 rotate > 四角 uniform-scale > move body 的固定优先级返回命中；未命中即由宿主视为 paper。 */
export function hitTestSelectionOverlay(
  model: SelectionOverlayModel,
  screen: Point
): SelectionOverlayHit | null {
  if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return null;
  const rotate = model.handles.find((handle) => handle.kind === 'rotate');
  if (rotate && inside(screen, rotate.center, rotate.hitSize)) {
    return Object.freeze({ kind: 'rotate', gesture: rotate.gesture });
  }
  for (const handle of model.handles) {
    if (handle.kind === 'uniform-scale' && inside(screen, handle.center, handle.hitSize)) {
      return Object.freeze({ kind: 'uniform-scale', gesture: handle.gesture });
    }
  }
  const { minX, minY, maxX, maxY } = model.frame;
  return screen.x >= minX && screen.x <= maxX && screen.y >= minY && screen.y <= maxY
    ? Object.freeze({ kind: 'move', gesture: model.moveGesture })
    : null;
}
