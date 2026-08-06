import type { DrawingPoint, DrawingStroke } from '../components/DrawingSurface';
import {
  resizeStrokeInSelectionFrame,
  type SelectionResizeTransform,
} from '../selectionResize';
import { rotatePointAroundCenter } from '../selectionRotation';

const WORLD_AXIS_STRETCH: SelectionResizeTransform = {
  frame: {
    center: { x: 0, y: 0 },
    width: 80,
    height: 60,
    rotationRad: 0,
  },
  xAxis: { anchor: -30, scale: 1.5 },
  yAxis: { anchor: -20, scale: 1 },
};

function applyExpectedStretch(point: DrawingPoint): DrawingPoint {
  return {
    ...point,
    x:
      WORLD_AXIS_STRETCH.xAxis.anchor +
      (point.x - WORLD_AXIS_STRETCH.xAxis.anchor) * WORLD_AXIS_STRETCH.xAxis.scale,
    y: point.y,
  };
}

describe('selection resize geometry', () => {
  it('preserves every rendered corner when a misaligned rectangle receives non-uniform scale', () => {
    // Given: a non-square rectangle rotated away from the world-axis selection frame.
    const rectangle: DrawingStroke = {
      id: 'misaligned-rectangle',
      tool: 'rect',
      points: [
        { x: -20, y: -10 },
        { x: 20, y: 10 },
      ],
      strokeColor: '#123456',
      strokeWidth: 3,
      dashArray: [4, 2],
      fillColor: '#abcdef',
      fillOpacity: 0.4,
      rotationRad: Math.PI / 4,
    };
    const renderedCorners = [
      { x: -20, y: -10 },
      { x: 20, y: -10 },
      { x: 20, y: 10 },
      { x: -20, y: 10 },
    ].map((point) => rotatePointAroundCenter(point, { x: 0, y: 0 }, Math.PI / 4));

    // When: the world-axis east edge stretches only the selection's X axis.
    const resized = resizeStrokeInSelectionFrame(rectangle, WORLD_AXIS_STRETCH);

    // Then: the exact affine result is retained as a styled polygon rather than approximated by bbox + angle.
    expect(resized.tool).toBe('polygon');
    expect(resized.points).toHaveLength(4);
    resized.points.forEach((point, index) => {
      expect(point.x).toBeCloseTo(applyExpectedStretch(renderedCorners[index]).x);
      expect(point.y).toBeCloseTo(applyExpectedStretch(renderedCorners[index]).y);
    });
    expect(resized).toMatchObject({
      id: rectangle.id,
      strokeColor: rectangle.strokeColor,
      strokeWidth: rectangle.strokeWidth,
      dashArray: rectangle.dashArray,
      fillColor: rectangle.fillColor,
      fillOpacity: rectangle.fillOpacity,
    });
    expect(resized.rotationRad).toBeUndefined();
  });

  it('preserves a misaligned ellipse outline when non-uniform scale requires shear', () => {
    // Given: an ellipse rotated away from the world-axis selection frame.
    const ellipse: DrawingStroke = {
      id: 'misaligned-ellipse',
      tool: 'ellipse',
      points: [
        { x: -20, y: -10 },
        { x: 20, y: 10 },
      ],
      strokeColor: '#654321',
      strokeWidth: 5,
      fillColor: '#fedcba',
      fillOpacity: 0.25,
      rotationRad: Math.PI / 4,
    };
    const cardinalPoints = [
      { x: 20, y: 0 },
      { x: 0, y: 10 },
      { x: -20, y: 0 },
      { x: 0, y: -10 },
    ].map((point) => rotatePointAroundCenter(point, { x: 0, y: 0 }, Math.PI / 4));

    // When: the world-axis east edge applies non-uniform scale.
    const resized = resizeStrokeInSelectionFrame(ellipse, WORLD_AXIS_STRETCH);

    // Then: the exact affine ellipse is retained through its principal radii and rotation.
    expect(resized.tool).toBe('ellipse');
    const first = resized.points[0];
    const last = resized.points[resized.points.length - 1];
    const radiusX = Math.abs(last.x - first.x) / 2;
    const radiusY = Math.abs(last.y - first.y) / 2;
    const rotationRad = resized.rotationRad ?? 0;
    const cosine = Math.cos(rotationRad);
    const sine = Math.sin(rotationRad);
    const covarianceXX = radiusX ** 2 * cosine ** 2 + radiusY ** 2 * sine ** 2;
    const covarianceXY = (radiusX ** 2 - radiusY ** 2) * sine * cosine;
    const covarianceYY = radiusX ** 2 * sine ** 2 + radiusY ** 2 * cosine ** 2;
    expect((first.x + last.x) / 2).toBeCloseTo(15);
    expect((first.y + last.y) / 2).toBeCloseTo(0);
    expect(covarianceXX).toBeCloseTo(562.5);
    expect(covarianceXY).toBeCloseTo(225);
    expect(covarianceYY).toBeCloseTo(250);
    cardinalPoints.forEach((point) => {
      const expected = applyExpectedStretch(point);
      const offsetX = expected.x - 15;
      const offsetY = expected.y;
      const localX = offsetX * cosine + offsetY * sine;
      const localY = -offsetX * sine + offsetY * cosine;
      expect((localX / radiusX) ** 2 + (localY / radiusY) ** 2).toBeCloseTo(1);
    });
    expect(resized).toMatchObject({
      id: ellipse.id,
      strokeColor: ellipse.strokeColor,
      strokeWidth: ellipse.strokeWidth,
      fillColor: ellipse.fillColor,
      fillOpacity: ellipse.fillOpacity,
    });
  });
});
