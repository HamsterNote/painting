import {
  createLayeredLassoQuery,
  prepareLayeredObjectQuery,
  queryObjectLasso,
} from '../../core/layeredObjectQuery';
import { FreehandGeometryCache } from '../../geometry/freehandCache';
import { layeredRect } from '../fixtures/layered';
import type { DocumentObject, Point } from '../../model/document';

test('incremental lasso agrees with the complete oracle on seeded mixed geometry and adversarial rings', () => {
  let seed = 245;
  const random = () => (seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296;
  const objects: DocumentObject[] = Array.from({ length: 20 }, (_, i) => ({
    ...layeredRect(`rect-${i}`),
    transform: { a: 0.7, b: 0.3, c: -0.2, d: 0.9, tx: random() * 600, ty: random() * 400 },
  }));
  objects.push({
    kind: 'text',
    objectId: 'text',
    objectRevision: 1,
    transformRevision: 1,
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    content: '245',
    color: '#000000',
    fontSize: 16,
    localBounds: { minX: 20, minY: 20, maxX: 80, maxY: 60 },
  });
  const base = {
    objectRevision: 1,
    transformRevision: 1,
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
  };
  objects.push({
    ...base,
    kind: 'image',
    objectId: 'image',
    src: 'data:image/png;base64,AA==',
    localBounds: { minX: 200, minY: 50, maxX: 260, maxY: 90 },
  });
  for (let i = 0; i < 5; i++)
    objects.push({
      ...base,
      kind: 'freehand',
      objectId: `ink-${i}`,
      commitId: `commit-${i}`,
      samplesRevision: 1,
      brushRevision: 1,
      resolvedPressureMode: 'constant',
      brushSnapshot: {
        color: '#222222',
        nominalSize: 3,
        opacity: 1,
        pressureMode: 'constant',
        presetRevision: 1,
      },
      samples: Array.from({ length: 64 }, (_, j) => ({
        sequence: j,
        x: 50 + i * 70 + j,
        y: 100 + i * 40 + Math.sin(j / 8) * 20,
        pressure: 0.5,
        source: 'pen',
        phase: j === 0 ? 'down' : j === 63 ? 'up' : 'move',
        time: j * 8,
      })),
    });
  const prepared = prepareLayeredObjectQuery(
    { schemaVersion: 3, documentRevision: 7, objects },
    new FreehandGeometryCache()
  );
  if (!prepared.ok) throw new Error(prepared.error.code);
  const rings: Point[][] = [
    [],
    [{ x: 0, y: 0 }],
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ],
    [
      { x: -10, y: -10 },
      { x: 1000, y: -10 },
      { x: 1000, y: 1000 },
      { x: -10, y: 1000 },
    ],
    [
      { x: 20, y: 20 },
      { x: 80, y: 60 },
      { x: 80, y: 20 },
      { x: 20, y: 60 },
    ],
    [
      { x: 20, y: 20 },
      { x: 80, y: 20 },
      { x: 80, y: 60 },
      { x: 20, y: 60 },
      { x: 20, y: 20 },
      { x: 20, y: 60 },
      { x: 80, y: 60 },
      { x: 80, y: 20 },
    ],
    [
      { x: 0, y: 0 },
      { x: NaN, y: 1 },
      { x: 2, y: 2 },
    ],
  ];
  for (let i = 0; i < 30; i++)
    rings.push(Array.from({ length: 6 }, () => ({ x: random() * 800, y: random() * 600 })));
  rings.push(
    Array.from({ length: 600 }, (_, i) => ({
      x: 300 + Math.cos((i * Math.PI * 2) / 599) * 350,
      y: 200 + Math.sin((i * Math.PI * 2) / 599) * 240,
    }))
  );
  for (const ring of rings) {
    const expected = queryObjectLasso(prepared.value, ring, 'intersects');
    const query = createLayeredLassoQuery(prepared.value, ring);
    let actual: typeof expected;
    if (!query.ok) actual = query;
    else {
      let result = query.value.step(() => 0, 0);
      while (!result) result = query.value.step(() => 0, 0);
      actual = result;
    }
    expect(actual).toEqual(expected);
  }
});

test('bounds index excludes distant objects without losing boundary contact or document order', () => {
  const objects = Array.from({ length: 100 }, (_, i) => ({
    ...layeredRect(`rect-${i}`),
    transform: { a: 1, b: 0, c: 0, d: 1, tx: i * 200, ty: 0 },
  }));
  const prepared = prepareLayeredObjectQuery(
    { schemaVersion: 3, documentRevision: 0, objects },
    new FreehandGeometryCache()
  );
  if (!prepared.ok) throw new Error(prepared.error.code);
  const ring = [
    { x: 100, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 100 },
    { x: 100, y: 100 },
  ];
  const query = createLayeredLassoQuery(prepared.value, ring);
  if (!query.ok) throw new Error(query.error.code);
  expect(query.value.candidateCount).toBeLessThan(5);
  expect(query.value.step(() => 0, Infinity)).toEqual(
    queryObjectLasso(prepared.value, ring, 'intersects')
  );
});
