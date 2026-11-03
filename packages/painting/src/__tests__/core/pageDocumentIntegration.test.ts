import readerV4 from '../fixtures/migration/reader-pdf-two-column.v4.json';
import painting040 from '../fixtures/migration/painting-0.4.0.json';
import { migrateLegacyDocument } from '../../model/legacyDocumentMigration';
import { readLayeredDocument, serializeLayeredDocument } from '../../model/documentReader';
import { createPageCoordinateSpace, createPageGeometry } from '../../geometry/pageCoordinates';
import { IDENTITY_TRANSFORM } from '../../model/document';
import { v1DrawingValue } from '../fixtures/v1/strokes';

const points = [
  { x: 10, y: 20 },
  { x: 30, y: 60 },
];
const pen = { id: 'pen', tool: 'pen', strokeColor: '#cc22ff', strokeWidth: 5, points };

test('migrates actual V1 fixture, all old tools and resource fields deterministically', () => {
  const legacy = {
    schemaVersion: 2,
    strokes: [
      ...v1DrawingValue.strokes,
      pen,
      {
        ...pen,
        id: 'pressure',
        points: [
          { x: 1, y: 2, pressure: 0 },
          { x: 3, y: 4, pressure: 0.8 },
        ],
      },
      { ...pen, id: 'dot', points: [{ x: 1, y: 2 }] },
      ...['ellipse', 'rect', 'line', 'text', 'image', 'polygon', 'bezier'].map((tool) => ({
        id: tool,
        tool,
        points:
          tool === 'bezier'
            ? [...points, { x: 40, y: 15 }, { x: 60, y: 30 }]
            : tool === 'polygon'
              ? [...points, { x: 60, y: 20 }, points[0]]
              : points,
        strokeColor: '#123456',
        strokeWidth: 4,
        fillColor: '#789abc',
        fillOpacity: 0.25,
        dashArray: [3, 7],
        dashOffset: -2,
        rotationRad: Math.PI / 2,
        text: '仓鼠\nreader',
        fontSize: 18,
        src: 'data:image/png;base64,a',
        resourceId: 'image-resource',
      })),
    ],
  };
  const before = JSON.stringify(legacy);
  const migrated = migrateLegacyDocument(legacy);
  expect(migrated.ok).toBe(true);
  if (!migrated.ok) throw new Error(migrated.error.path);
  expect(migrateLegacyDocument(legacy)).toEqual(migrated);
  expect(migrateLegacyDocument(migrated.value)).toEqual(migrated);
  expect(readLayeredDocument(migrated.value)).toEqual(migrated);
  expect(serializeLayeredDocument(migrated.value).ok).toBe(true);
  expect(JSON.stringify(legacy)).toBe(before);
  expect(Object.isFrozen(migrated.value.objects[0])).toBe(true);
  expect(migrated.value.objects.map((object) => object.objectId)).toEqual(
    legacy.strokes.map((s) => s.id)
  );
  expect(migrated.value.objects.find((o) => o.objectId === 'pressure')).toMatchObject({
    kind: 'freehand',
    resolvedPressureMode: 'real',
    samples: [{ pressure: 0 }, { pressure: 0.8 }],
  });
  expect(migrated.value.objects.find((o) => o.objectId === 'pen')).toMatchObject({
    brushSnapshot: { color: '#cc22ff', nominalSize: 5, pressureMode: 'constant' },
  });
  expect(migrated.value.objects.find((o) => o.objectId === 'image')).toMatchObject({
    resourceId: 'image-resource',
  });
  expect(migrated.value.objects.find((o) => o.objectId === 'rect')).toMatchObject({
    style: { fillOpacity: 0.25, dashOffset: -2, dash: [3, 7] },
    transform: { a: expect.any(Number), b: 1, c: -1, d: expect.any(Number) },
  });
});

test.each([
  [null, '$'],
  [{}, '$.strokes'],
  [{ schemaVersion: 4, strokes: [] }, '$.schemaVersion'],
  [{ strokes: [pen, pen] }, '$.strokes[1].id'],
  [{ strokes: [{ ...pen, tool: 'future' }] }, '$.strokes[0].tool'],
  [{ strokes: [{ ...pen, points: [{ x: Infinity, y: 2 }] }] }, '$.strokes[0].points[0].x'],
  [{ strokes: [{ ...pen, dashArray: [-2, 3] }] }, '$.strokes[0].dashArray[0]'],
  [{ strokes: [{ ...pen, strokeWidth: -1 }] }, '$.strokes[0].strokeWidth'],
  [{ strokes: [{ ...pen, schemaVersion: 9 }] }, '$.strokes[0].schemaVersion'],
])('rejects unsupported or invalid input without returning partial data: %j', (input, path) => {
  expect(migrateLegacyDocument(input)).toEqual({
    ok: false,
    error: { code: 'invalid-document', path },
  });
});

test('empty legacy document migrates; normal reader still rejects legacy documents', () => {
  expect(migrateLegacyDocument({ strokes: [] })).toEqual({
    ok: true,
    value: { schemaVersion: 3, documentRevision: 0, objects: [] },
  });
  expect(readLayeredDocument({ strokes: [] }).ok).toBe(false);
});

test.each([0.1, 0.25, 1, 2.75, 16])(
  'page transforms round-trip at unrestricted host zoom %s',
  (scale) => {
    const geometry = createPageGeometry({
      width: 612,
      height: 792,
      referenceTransform: [1, 0, 0, -1, -30, 820],
      viewportTransform: [0, scale, scale, 0, -28 * scale, -30 * scale],
    });
    expect(geometry).not.toBeNull();
    const space = createPageCoordinateSpace(geometry!)!;
    for (const page of [
      { x: 0, y: 0 },
      { x: 612, y: 792 },
      { x: 111.25, y: 332.5 },
    ]) {
      const local = space.toSurface(page)!;
      const restored = space.toPage(local)!;
      expect(restored.x).toBeCloseTo(page.x, 10);
      expect(restored.y).toBeCloseTo(page.y, 10);
    }
    expect(space.toSurface({ x: NaN, y: 0 })).toBeNull();
  }
);

test('page geometry rejects invalid sizes and singular transforms', () => {
  expect(
    createPageCoordinateSpace({ width: 0, height: 800, pageToSurface: IDENTITY_TRANSFORM })
  ).toBeNull();
  expect(
    createPageCoordinateSpace({
      width: 600,
      height: 800,
      pageToSurface: { ...IDENTITY_TRANSFORM, a: 0 },
    })
  ).toBeNull();
  expect(
    createPageGeometry({
      width: 600,
      height: 800,
      referenceTransform: [0, 0, 0, 0, 0, 0],
      viewportTransform: [1, 0, 0, 1, 0, 0],
    })
  ).toBeNull();
});

test('migrates dashed pressure pens and V2 ruler polylines into deterministic shapes without losing segments', () => {
  const legacy = {
    strokes: [
      {
        ...pen,
        id: 'dashed-pressure',
        dashArray: [2, 3],
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0, pressure: 0.5 },
          { x: 20, y: 0, pressure: 0 },
        ],
      },
      {
        ...pen,
        id: 'ruler',
        tool: 'line',
        schemaVersion: 2,
        dashArray: [2, 4],
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 20, y: 0 },
        ],
      },
      {
        ...pen,
        id: 'smooth-dash',
        dashArray: [2, 3],
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 15 },
          { x: 20, y: 0 },
        ],
      },
      { ...pen, id: 'migration:ruler:1' },
    ],
  };
  const migrated = migrateLegacyDocument(legacy);
  if (!migrated.ok) throw new Error(migrated.error.path);
  expect(migrated.value.objects).toHaveLength(7);
  expect(migrated.value.objects[0]).toMatchObject({
    kind: 'shape',
    shapeType: 'line',
    style: { width: 2.5, dash: [2, 3] },
  });
  expect(migrated.value.objects[1]).toMatchObject({
    style: { color: 'transparent', dashOffset: 0 },
  });
  expect(migrated.value.objects[3]).toMatchObject({ style: { dashOffset: -10 } });
  expect(migrated.value.objects[4]).toMatchObject({ shapeType: 'bezier' });
  expect(new Set(migrated.value.objects.map((object) => object.objectId)).size).toBe(7);
  expect(migrateLegacyDocument(legacy)).toEqual(migrated);
  expect(migrateLegacyDocument(migrated.value)).toEqual(migrated);
});

test('the unmodified reader v4 fixture preserves legacy color/width aliases', () => {
  const before = JSON.stringify(readerV4);
  const result = migrateLegacyDocument(readerV4.paintings['page-1']);
  if (!result.ok) throw new Error(result.error.path);
  expect(result.value.objects[0]).toMatchObject({
    objectId: 'stroke-pdf-1',
    kind: 'shape',
    points: [
      { x: 10, y: 10 },
      { x: 90, y: 90 },
    ],
    style: { color: '#dc2626', width: 5 },
  });
  expect(JSON.stringify(readerV4)).toBe(before);
  expect(migrateLegacyDocument(readerV4.paintings['page-1'])).toEqual(result);
});

test('data generated by the published 0.4.0 normalizer preserves all supported content', () => {
  const result = migrateLegacyDocument(painting040);
  if (!result.ok) throw new Error(result.error.path);
  expect(result.value.objects.map((object) => object.objectId)).toEqual(
    painting040.strokes.map((stroke) => stroke.id)
  );
  expect(result.value.objects.find((o) => o.objectId === 'text-040')).toMatchObject({
    content: '仓鼠\nPDF',
    fontSize: 20,
    lineHeight: 1.2,
  });
  expect(result.value.objects.find((o) => o.objectId === 'image-040')).toMatchObject({
    src: 'data:image/png;base64,a',
    preserveAspectRatio: 'none',
  });
  expect(readLayeredDocument(result.value)).toEqual(result);
  expect(migrateLegacyDocument(painting040)).toEqual(result);
});
