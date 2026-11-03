import {
  IDENTITY_TRANSFORM,
  type DocumentObject,
  type EditorDocument,
  type Point,
  type ShapeStyle,
  type ShapeType,
} from './document';
import { readLayeredDocument, type DocumentReadResult } from './documentReader';
import { deriveShapeGeometry } from '../geometry/shape';

class MigrationFailure extends Error {}
function fail(path: string): never {
  throw new MigrationFailure(path);
}
function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path);
  return value as Record<string, unknown>;
}
function number(value: unknown, path: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path);
  return value;
}
function string(value: unknown, path: string, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || !value.length) fail(path);
  return value;
}

/**
 * Explicit, all-or-nothing upgrade of DrawingValue/schema 1 or 2 to schema 3.
 * No IO, source mutation, generated random IDs, silent filtering or downgrade.
 * Schema 3 is accepted too, so retrying a completed upgrade is value-idempotent.
 * Legacy pen samples use the current freehand geometry (not the retired SVG renderer).
 */
export function migrateLegacyDocument(input: unknown): DocumentReadResult<EditorDocument> {
  try {
    const document = record(input, '$');
    if (document.schemaVersion === 3) return readLayeredDocument(input);
    if (
      document.schemaVersion !== undefined &&
      document.schemaVersion !== 1 &&
      document.schemaVersion !== 2
    )
      fail('$.schemaVersion');
    if (!Array.isArray(document.strokes)) fail('$.strokes');
    const ids = new Set<string>();
    const reserved = new Set(
      document.strokes.map((entry, index) => record(entry, `$.strokes[${index}]`).id)
    );
    const extraId = (id: string, part: number) => {
      let candidate = `migration:${id}:${part}`;
      while (reserved.has(candidate)) candidate = `migration:${candidate}`;
      reserved.add(candidate);
      return candidate;
    };
    const objects: DocumentObject[] = document.strokes.flatMap((entry, index): DocumentObject[] => {
      const path = `$.strokes[${index}]`;
      const stroke = record(entry, path);
      if (
        stroke.schemaVersion !== undefined &&
        stroke.schemaVersion !== 1 &&
        stroke.schemaVersion !== 2
      )
        fail(`${path}.schemaVersion`);
      const objectId = string(stroke.id, `${path}.id`);
      if (ids.has(objectId)) fail(`${path}.id`);
      ids.add(objectId);
      if (!Array.isArray(stroke.points) || !stroke.points.length) fail(`${path}.points`);
      const points = stroke.points.map((entry, pointIndex) => {
        const pointPath = `${path}.points[${pointIndex}]`;
        const point = record(entry, pointPath);
        return {
          x: number(point.x, `${pointPath}.x`),
          y: number(point.y, `${pointPath}.y`),
          ...(point.pressure === undefined
            ? {}
            : { pressure: number(point.pressure, `${pointPath}.pressure`) }),
        };
      });
      const colorKey =
        stroke.strokeColor === undefined && stroke.color !== undefined ? 'color' : 'strokeColor';
      const color = string(stroke[colorKey], `${path}.${colorKey}`, '#000000');
      const widthKey =
        stroke.strokeWidth === undefined && stroke.width !== undefined ? 'width' : 'strokeWidth';
      const width = number(stroke[widthKey], `${path}.${widthKey}`, 2);
      if (width < 0) fail(`${path}.strokeWidth`);
      let dash: number[] | undefined;
      if (stroke.dashArray !== undefined) {
        if (!Array.isArray(stroke.dashArray)) fail(`${path}.dashArray`);
        dash = stroke.dashArray.map((entry, i) => {
          const value = number(entry, `${path}.dashArray[${i}]`);
          if (value < 0) fail(`${path}.dashArray[${i}]`);
          return value;
        });
      }
      const base = {
        objectId,
        objectRevision: 0,
        transformRevision: 0,
        transform: IDENTITY_TRANSFORM,
      };
      if (stroke.tool === 'pen' && width > 0 && !dash?.some((value) => value > 0)) {
        const pressureMode = points.some((point) => point.pressure !== undefined)
          ? 'real'
          : 'constant';
        const samples = points.length === 1 ? [points[0]!, points[0]!] : points;
        return [
          {
            ...base,
            kind: 'freehand',
            commitId: `migration:${objectId}`,
            samplesRevision: 0,
            brushRevision: 0,
            resolvedPressureMode: pressureMode,
            brushSnapshot: {
              color,
              nominalSize: width,
              opacity: 1,
              pressureMode,
              presetRevision: 0,
            },
            samples: samples.map((point, sequence) => ({
              ...point,
              sequence,
              time: sequence,
              source: 'pen',
              phase: sequence === 0 ? 'down' : sequence === samples.length - 1 ? 'up' : 'move',
            })),
          },
        ];
      }
      const first = points[0]!;
      const last = points[points.length - 1]!;
      const localBounds = {
        minX: Math.min(first.x, last.x),
        minY: Math.min(first.y, last.y),
        maxX: Math.max(first.x, last.x),
        maxY: Math.max(first.y, last.y),
      };
      const rotation = number(stroke.rotationRad, `${path}.rotationRad`, 0);
      const rotated = ['rect', 'ellipse', 'text', 'image'].includes(String(stroke.tool));
      const cx = first.x / 2 + last.x / 2;
      const cy = first.y / 2 + last.y / 2;
      const a = Math.cos(rotation),
        b = Math.sin(rotation);
      const transform = rotated
        ? { a, b, c: -b, d: a, tx: cx - a * cx + b * cy, ty: cy - b * cx - a * cy }
        : IDENTITY_TRANSFORM;
      if (stroke.tool === 'text') {
        if (typeof stroke.text !== 'string') fail(`${path}.text`);
        const fontSize = number(stroke.fontSize, `${path}.fontSize`, 24);
        if (fontSize <= 0) fail(`${path}.fontSize`);
        return [
          {
            ...base,
            transform,
            kind: 'text',
            content: stroke.text,
            fontSize,
            lineHeight: 1.2,
            color,
            localBounds,
          },
        ];
      }
      if (stroke.tool === 'image') {
        return [
          {
            ...base,
            transform,
            kind: 'image',
            preserveAspectRatio: 'none',
            src: string(stroke.src, `${path}.src`),
            localBounds,
            ...(stroke.resourceId === undefined
              ? {}
              : { resourceId: string(stroke.resourceId, `${path}.resourceId`) }),
          },
        ];
      }
      if (!['pen', 'line', 'rect', 'ellipse', 'polygon', 'bezier'].includes(String(stroke.tool)))
        fail(`${path}.tool`);
      const shapeType = (stroke.tool === 'pen' ? 'line' : stroke.tool) as ShapeType;
      let shapePoints: readonly Point[] = points;
      if (shapeType === 'line' || shapeType === 'rect' || shapeType === 'ellipse') {
        shapePoints = [first, last];
      }
      if (shapeType === 'polygon' && points.length > 1 && first.x === last.x && first.y === last.y)
        shapePoints = points.slice(0, -1);
      const fillOpacity = number(stroke.fillOpacity, `${path}.fillOpacity`, 1);
      if (fillOpacity < 0 || fillOpacity > 1) fail(`${path}.fillOpacity`);
      const style: ShapeStyle = {
        color: width === 0 ? 'transparent' : color,
        width: width || 1,
        opacity: 1,
        ...(dash?.some((value) => value > 0) ? { dash } : {}),
        ...(stroke.dashOffset === undefined
          ? {}
          : { dashOffset: number(stroke.dashOffset, `${path}.dashOffset`) }),
        ...(['rect', 'ellipse', 'polygon'].includes(shapeType)
          ? { fill: string(stroke.fillColor, `${path}.fillColor`, 'none'), fillOpacity }
          : {}),
      };
      // V2 ruler polylines and dashed pen have no schema3 freehand equivalent.
      // Convert once into ordinary editable shape primitives; no legacy renderer survives.
      if ((stroke.tool === 'line' && points.length > 2) || stroke.tool === 'pen') {
        const pressurePen =
          stroke.tool === 'pen' && points.some((point) => point.pressure !== undefined);
        const smoothPen = stroke.tool === 'pen' && !pressurePen && points.length > 2;
        let distance = 0;
        const sourcePoints = points.length === 1 ? [points[0]!, points[0]!] : points;
        return sourcePoints.slice(1).map((end, part) => {
          const start = sourcePoints[part]!;
          const next = sourcePoints[part + 2];
          const segmentPoints = smoothPen
            ? [
                start,
                { x: start.x + (end.x - start.x) / 3, y: start.y + (end.y - start.y) / 3 },
                next
                  ? { x: end.x - (next.x - start.x) / 6, y: end.y - (next.y - start.y) / 6 }
                  : end,
                end,
              ]
            : [start, end];
          const pressure =
            end.pressure === undefined || end.pressure < 0 || end.pressure > 1 ? 1 : end.pressure;
          const segmentWidth = pressurePen ? width * pressure : width;
          const object: DocumentObject = {
            ...base,
            objectId: part === 0 ? objectId : extraId(objectId, part),
            kind: 'shape',
            shapeType: smoothPen ? 'bezier' : 'line',
            points: segmentPoints,
            style: {
              ...style,
              color: segmentWidth === 0 ? 'transparent' : color,
              width: segmentWidth || 1,
              ...(style.dash
                ? { dashOffset: (style.dashOffset ?? 0) - (pressurePen ? 0 : distance) }
                : {}),
            },
          };
          distance += smoothPen
            ? cubicLength(segmentPoints)
            : Math.hypot(end.x - start.x, end.y - start.y);
          if (!Number.isFinite(distance) || !deriveShapeGeometry(object)) fail(`${path}.points`);
          return object;
        });
      }
      const shape = {
        ...base,
        transform,
        kind: 'shape' as const,
        shapeType,
        points: shapePoints,
        style,
      };
      if (!deriveShapeGeometry(shape)) fail(`${path}.points`);
      return [shape];
    });
    return readLayeredDocument({ schemaVersion: 3, documentRevision: 0, objects });
  } catch (error) {
    if (!(error instanceof MigrationFailure)) throw error;
    return { ok: false, error: { code: 'invalid-document', path: error.message } };
  }
}

/** Adaptive cubic arc length, used only to continue dash phase across migrated pieces. */
function cubicLength(points: readonly Point[], depth = 0): number {
  const [p0, p1, p2, p3] = points as readonly [Point, Point, Point, Point];
  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  const polygon =
    Math.hypot(p1.x - p0.x, p1.y - p0.y) +
    Math.hypot(p2.x - p1.x, p2.y - p1.y) +
    Math.hypot(p3.x - p2.x, p3.y - p2.y);
  if (!Number.isFinite(polygon) || depth >= 16 || polygon - chord < 0.0001)
    return (polygon + chord) / 2;
  const mid = (a: Point, b: Point): Point => ({ x: a.x / 2 + b.x / 2, y: a.y / 2 + b.y / 2 });
  const a = mid(p0, p1),
    b = mid(p1, p2),
    c = mid(p2, p3),
    d = mid(a, b),
    e = mid(b, c),
    f = mid(d, e);
  return cubicLength([p0, a, d, f], depth + 1) + cubicLength([f, e, c, p3], depth + 1);
}
