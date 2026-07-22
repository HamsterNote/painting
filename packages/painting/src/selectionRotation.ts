import type { DrawingPoint, DrawingStroke } from './components/DrawingSurface';
import type { SelectionBox } from './utils';

export type RotationCenter = Readonly<Pick<DrawingPoint, 'x' | 'y'>>;

export type SelectionFrame = {
  readonly center: DrawingPoint;
  readonly width: number;
  readonly height: number;
  readonly rotationRad: number;
};

export function rotatePointAroundCenter(
  point: DrawingPoint,
  center: RotationCenter,
  rotationRad: number
): DrawingPoint {
  const cosine = Math.cos(rotationRad);
  const sine = Math.sin(rotationRad);
  const offsetX = point.x - center.x;
  const offsetY = point.y - center.y;
  return {
    ...point,
    x: center.x + offsetX * cosine - offsetY * sine,
    y: center.y + offsetX * sine + offsetY * cosine,
  };
}

export function rotateStrokeAroundSelection(
  stroke: DrawingStroke,
  center: RotationCenter,
  rotationRad: number
): DrawingStroke {
  if ((stroke.tool === 'rect' || stroke.tool === 'ellipse') && stroke.points.length >= 2) {
    const first = stroke.points[0];
    const last = stroke.points[stroke.points.length - 1];
    const shapeCenter = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
    const nextShapeCenter = rotatePointAroundCenter(shapeCenter, center, rotationRad);
    const offsetX = nextShapeCenter.x - shapeCenter.x;
    const offsetY = nextShapeCenter.y - shapeCenter.y;
    const currentRotationRad =
      typeof stroke.rotationRad === 'number' && Number.isFinite(stroke.rotationRad)
        ? stroke.rotationRad
        : 0;
    return {
      ...stroke,
      points: stroke.points.map((point) => ({
        ...point,
        x: point.x + offsetX,
        y: point.y + offsetY,
      })),
      rotationRad: currentRotationRad + rotationRad,
      dashArray: stroke.dashArray ? [...stroke.dashArray] : undefined,
    };
  }

  return {
    ...stroke,
    points: stroke.points.map((point) => rotatePointAroundCenter(point, center, rotationRad)),
    dashArray: stroke.dashArray ? [...stroke.dashArray] : undefined,
  };
}

export function selectionFrameFromBox(box: SelectionBox): SelectionFrame {
  return {
    center: {
      x: (box.minX + box.maxX) / 2,
      y: (box.minY + box.maxY) / 2,
    },
    width: box.maxX - box.minX,
    height: box.maxY - box.minY,
    rotationRad: 0,
  };
}

export function selectionFrameFromLocalBox(
  box: SelectionBox,
  orientation: Readonly<Pick<SelectionFrame, 'center' | 'rotationRad'>>
): SelectionFrame {
  const localCenter = {
    x: (box.minX + box.maxX) / 2,
    y: (box.minY + box.maxY) / 2,
  };
  return {
    center: rotatePointAroundCenter(localCenter, orientation.center, orientation.rotationRad),
    width: box.maxX - box.minX,
    height: box.maxY - box.minY,
    rotationRad: orientation.rotationRad,
  };
}

export function selectionFrameLocalBox(frame: SelectionFrame): SelectionBox {
  return {
    minX: frame.center.x - frame.width / 2,
    minY: frame.center.y - frame.height / 2,
    maxX: frame.center.x + frame.width / 2,
    maxY: frame.center.y + frame.height / 2,
  };
}

export function isPointInsideSelectionFrame(point: DrawingPoint, frame: SelectionFrame): boolean {
  const localPoint = rotatePointAroundCenter(point, frame.center, -frame.rotationRad);
  const box = selectionFrameLocalBox(frame);
  return (
    localPoint.x >= box.minX &&
    localPoint.x <= box.maxX &&
    localPoint.y >= box.minY &&
    localPoint.y <= box.maxY
  );
}

export function selectionFrameBoundingBox(frame: SelectionFrame): SelectionBox {
  const box = selectionFrameLocalBox(frame);
  const corners = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ].map((point) => rotatePointAroundCenter(point, frame.center, frame.rotationRad));
  return {
    minX: Math.min(...corners.map((point) => point.x)),
    minY: Math.min(...corners.map((point) => point.y)),
    maxX: Math.max(...corners.map((point) => point.x)),
    maxY: Math.max(...corners.map((point) => point.y)),
  };
}
