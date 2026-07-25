import type { DrawingPoint, DrawingStroke } from './components/DrawingSurface';
import { rotatePointAroundCenter, type SelectionFrame } from './selectionRotation';

export type SelectionResizeAxis = {
  readonly anchor: number;
  readonly scale: number;
};

export type SelectionResizeTransform = {
  readonly frame: SelectionFrame;
  readonly xAxis: SelectionResizeAxis;
  readonly yAxis: SelectionResizeAxis;
};

function resizePointInSelectionFrame(
  point: DrawingPoint,
  transform: SelectionResizeTransform
): DrawingPoint {
  const { frame, xAxis, yAxis } = transform;
  const localPoint = rotatePointAroundCenter(point, frame.center, -frame.rotationRad);
  const resizedLocalPoint = {
    ...localPoint,
    x: xAxis.anchor + (localPoint.x - xAxis.anchor) * xAxis.scale,
    y: yAxis.anchor + (localPoint.y - yAxis.anchor) * yAxis.scale,
  };
  return rotatePointAroundCenter(resizedLocalPoint, frame.center, frame.rotationRad);
}

function resizeDirectionVector(
  vector: DrawingPoint,
  transform: SelectionResizeTransform
): DrawingPoint {
  const cosine = Math.cos(transform.frame.rotationRad);
  const sine = Math.sin(transform.frame.rotationRad);
  const localX = vector.x * cosine + vector.y * sine;
  const localY = -vector.x * sine + vector.y * cosine;
  const resizedX = localX * transform.xAxis.scale;
  const resizedY = localY * transform.yAxis.scale;
  return {
    x: resizedX * cosine - resizedY * sine,
    y: resizedX * sine + resizedY * cosine,
  };
}

function strokeRotation(stroke: DrawingStroke): number {
  return typeof stroke.rotationRad === 'number' && Number.isFinite(stroke.rotationRad)
    ? stroke.rotationRad
    : 0;
}

function resizedRectangle(
  stroke: DrawingStroke,
  transform: SelectionResizeTransform
): DrawingStroke {
  const first = stroke.points[0];
  const last = stroke.points[stroke.points.length - 1];
  const center = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
  const rotationRad = strokeRotation(stroke);
  const resizedXAxis = resizeDirectionVector(
    { x: Math.cos(rotationRad), y: Math.sin(rotationRad) },
    transform
  );
  const resizedYAxis = resizeDirectionVector(
    { x: -Math.sin(rotationRad), y: Math.cos(rotationRad) },
    transform
  );
  const orthogonality = resizedXAxis.x * resizedYAxis.x + resizedXAxis.y * resizedYAxis.y;
  const axisMagnitude =
    Math.hypot(resizedXAxis.x, resizedXAxis.y) * Math.hypot(resizedYAxis.x, resizedYAxis.y);

  if (Math.abs(orthogonality) <= Number.EPSILON * 16 * Math.max(1, axisMagnitude)) {
    const resizedCenter = resizePointInSelectionFrame(center, transform);
    const signedWidth =
      (last.x - first.x) * Math.hypot(resizedXAxis.x, resizedXAxis.y);
    const signedHeight =
      (last.y - first.y) * Math.hypot(resizedYAxis.x, resizedYAxis.y);
    return {
      ...stroke,
      points: stroke.points.map((point, index) => {
        if (index !== 0 && index !== stroke.points.length - 1) {
          return resizePointInSelectionFrame(point, transform);
        }
        const isFirst = index === 0;
        return {
          ...point,
          x: resizedCenter.x + (isFirst ? -signedWidth : signedWidth) / 2,
          y: resizedCenter.y + (isFirst ? -signedHeight : signedHeight) / 2,
        };
      }),
      rotationRad: Math.atan2(resizedXAxis.y, resizedXAxis.x),
      dashArray: stroke.dashArray ? [...stroke.dashArray] : undefined,
    };
  }

  const minX = Math.min(first.x, last.x);
  const maxX = Math.max(first.x, last.x);
  const minY = Math.min(first.y, last.y);
  const maxY = Math.max(first.y, last.y);
  const corners = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ].map((point) =>
    resizePointInSelectionFrame(rotatePointAroundCenter(point, center, rotationRad), transform)
  );
  if (stroke.tool === 'image') {
    return {
      ...stroke,
      points: stroke.points.map((point) => resizePointInSelectionFrame(point, transform)),
      dashArray: stroke.dashArray ? [...stroke.dashArray] : undefined,
    };
  }
  return {
    ...stroke,
    tool: 'polygon',
    points: corners,
    rotationRad: undefined,
    dashArray: stroke.dashArray ? [...stroke.dashArray] : undefined,
  };
}

function resizedEllipse(
  stroke: DrawingStroke,
  transform: SelectionResizeTransform
): DrawingStroke {
  const first = stroke.points[0];
  const last = stroke.points[stroke.points.length - 1];
  const center = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
  const rotationRad = strokeRotation(stroke);
  const radiusX = Math.abs(last.x - first.x) / 2;
  const radiusY = Math.abs(last.y - first.y) / 2;
  const xRadiusVector = resizeDirectionVector(
    { x: radiusX * Math.cos(rotationRad), y: radiusX * Math.sin(rotationRad) },
    transform
  );
  const yRadiusVector = resizeDirectionVector(
    { x: -radiusY * Math.sin(rotationRad), y: radiusY * Math.cos(rotationRad) },
    transform
  );
  const covarianceXX = xRadiusVector.x ** 2 + yRadiusVector.x ** 2;
  const covarianceXY = xRadiusVector.x * xRadiusVector.y + yRadiusVector.x * yRadiusVector.y;
  const covarianceYY = xRadiusVector.y ** 2 + yRadiusVector.y ** 2;
  const halfDifference = (covarianceXX - covarianceYY) / 2;
  const eigenDistance = Math.hypot(halfDifference, covarianceXY);
  const halfTrace = (covarianceXX + covarianceYY) / 2;
  const nextRadiusX = Math.sqrt(Math.max(0, halfTrace + eigenDistance));
  const nextRadiusY = Math.sqrt(Math.max(0, halfTrace - eigenDistance));
  const nextRotationRad =
    eigenDistance === 0 ? 0 : Math.atan2(covarianceXY, halfDifference) / 2;
  const resizedCenter = resizePointInSelectionFrame(center, transform);

  return {
    ...stroke,
    points: [
      { ...first, x: resizedCenter.x - nextRadiusX, y: resizedCenter.y - nextRadiusY },
      { ...last, x: resizedCenter.x + nextRadiusX, y: resizedCenter.y + nextRadiusY },
    ],
    rotationRad: nextRotationRad,
    dashArray: stroke.dashArray ? [...stroke.dashArray] : undefined,
  };
}

export function resizeStrokeInSelectionFrame(
  stroke: DrawingStroke,
  transform: SelectionResizeTransform
): DrawingStroke {
  if ((stroke.tool === 'rect' || stroke.tool === 'image') && stroke.points.length >= 2) {
    return resizedRectangle(stroke, transform);
  }
  if (stroke.tool === 'ellipse' && stroke.points.length >= 2) {
    return resizedEllipse(stroke, transform);
  }
  return {
    ...stroke,
    points: stroke.points.map((point) => resizePointInSelectionFrame(point, transform)),
    dashArray: stroke.dashArray ? [...stroke.dashArray] : undefined,
  };
}
