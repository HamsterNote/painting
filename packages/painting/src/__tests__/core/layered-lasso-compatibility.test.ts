import {
  createLayeredLassoQuery,
  prepareLayeredObjectQuery,
  queryObjectLasso,
} from '../../core/layeredObjectQuery';
import { createLayeredToolSession, type LayeredToolScheduler } from '../../core/layeredToolSession';
import { FreehandGeometryCache } from '../../geometry/freehandCache';
import type { DocumentObject } from '../../model/document';
import { makeLayeredController } from '../fixtures/layered';

function image(objectId: string, x: number, y: number, size: number): DocumentObject {
  return {
    kind: 'image',
    objectId,
    objectRevision: 1,
    transformRevision: 1,
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    src: 'data:image/png;base64,AA==',
    localBounds: { minX: x, minY: y, maxX: x + size, maxY: y + size },
  };
}
const cases = [
  {
    name: 'review floating intersection at image corner (31,34)',
    target: image('target', 31, 31, 3),
    path: [
      [70, 10],
      [20, 50],
      [10, 20],
      [10, 60],
      [0, 70],
      [10, 20],
      [40, 40],
    ].map(([x, y]) => ({ x, y })),
  },
  {
    name: 'legacy separated collinear segments remain a hit',
    target: image('target', 40, 40, 20),
    path: [
      [0, 0],
      [100, 0],
      [100, 20],
      [20, 20],
      [20, 40],
      [0, 40],
    ].map(([x, y]) => ({ x, y })),
  },
  {
    name: 'seed 245 trajectory 9180: touching canonical components retain boolean interior hit',
    target: image('target', 51, 61, 3),
    path: [
      [100, 10],
      [20, 90],
      [60, 50],
      [60, 90],
      [10, 70],
      [40, 0],
      [20, 50],
      [40, 70],
      [90, 60],
      [90, 0],
    ].map(([x, y]) => ({ x, y })),
  },
];
function prepared(objects: readonly DocumentObject[]) {
  const result = prepareLayeredObjectQuery(
    { schemaVersion: 3, documentRevision: 0, objects },
    new FreehandGeometryCache()
  );
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
function complete(query: ReturnType<typeof createLayeredLassoQuery>) {
  return query.ok ? query.value.step(() => 0, Infinity)! : query;
}

test('segment bounds skip a separated negative candidate but preserve both compatibility cases', () => {
  const separated = image('target', 43, 43, 14);
  const lasso = [
    [0, 0],
    [100, 0],
    [100, 20],
    [20, 20],
    [20, 100],
    [0, 100],
  ].map(([x, y]) => ({ x, y }));
  const document = prepared([separated]);
  const onFallback = jest.fn();
  const query = createLayeredLassoQuery(document, lasso, { now: () => 0, onFallback });
  expect(query.ok && query.value.candidateCount).toBe(1);
  const result = complete(query);
  const oracle = queryObjectLasso(document, lasso, 'intersects');
  expect(result).toEqual(oracle);
  expect(result.ok && result.value.map((hit) => hit.objectId)).toEqual([]);
  expect(oracle.ok && oracle.value.map((hit) => hit.objectId)).toEqual([]);
  expect(onFallback).not.toHaveBeenCalled();

  const boundary = cases[0]!;
  const boundaryQuery = createLayeredLassoQuery(prepared([boundary.target]), boundary.path, {
    now: () => 0,
    onFallback,
  });
  const boundaryResult = complete(boundaryQuery);
  expect(boundaryResult.ok && boundaryResult.value.map((hit) => hit.objectId)).toEqual(['target']);
  expect(onFallback).toHaveBeenCalledWith('target', 0, 'overlapping-bounds');

  onFallback.mockClear();
  const collinear = cases[1]!;
  const legacy = complete(
    createLayeredLassoQuery(prepared([collinear.target]), collinear.path, {
      now: () => 0,
      onFallback,
    })
  );
  expect(legacy.ok && legacy.value.map((hit) => hit.objectId)).toEqual(['target']);
  expect(onFallback).not.toHaveBeenCalled();
});

test('a long closing diagonal box overlaps the target, but its line is provably separated', () => {
  const document = prepared([image('target', 60, 60, 3)]);
  const path = [
    [0, 0],
    [100, 0],
    [100, 10],
  ].map(([x, y]) => ({ x, y }));
  // The closing diagonal bbox covers x=0..100, y=0..10. Place the target
  // within that box but well above the diagonal, without collinear edges.
  const insideBox = prepared([image('target', 40, 7, 1)]);
  for (const candidate of [document, insideBox]) {
    const onFallback = jest.fn();
    const query = createLayeredLassoQuery(candidate, path, { now: () => 0, onFallback });
    const oracle = queryObjectLasso(candidate, path, 'intersects');
    const result = complete(query);
    expect(oracle.ok && oracle.value.map((hit) => hit.objectId)).toEqual([]);
    expect(result).toEqual(oracle);
    expect(onFallback).not.toHaveBeenCalled();
  }
});

test.each(cases)(
  '$name: oracle and complete optimized query explicitly select target',
  ({ target, path }) => {
    const document = prepared([target]);
    const oldResult = queryObjectLasso(document, path, 'intersects');
    const newResult = complete(createLayeredLassoQuery(document, path));
    expect(oldResult.ok && oldResult.value.map((hit) => hit.objectId)).toEqual(['target']);
    expect(newResult.ok && newResult.value.map((hit) => hit.objectId)).toEqual(['target']);
  }
);

test('seed 245 trajectory 9180 retains the overlapping-bounds diagnostic on the full path', () => {
  const { target, path } = cases[2]!;
  const document = prepared([target]);
  const onFallback = jest.fn();
  const result = complete(createLayeredLassoQuery(document, path, { now: () => 0, onFallback }));
  expect(result).toEqual(queryObjectLasso(document, path, 'intersects'));
  expect(result.ok && result.value.map((hit) => hit.objectId)).toEqual(['target']);
  expect(onFallback).toHaveBeenCalledWith('target', 0, 'overlapping-bounds');
});

test('in-flight prefixes on one prepared snapshot keep independent results through reverse completion', () => {
  const { path } = cases[2]!;
  const objects = Array.from({ length: 100 }, (_, i) =>
    image(`image-${i}`, (i % 10) * 10 + 1, Math.floor(i / 10) * 10 + 1, 3)
  );
  const document = prepared(objects);
  const pending: {
    query: Extract<ReturnType<typeof createLayeredLassoQuery>, { ok: true }>['value'];
    expected: ReturnType<typeof queryObjectLasso>;
  }[] = [];
  const rejected: {
    actual: ReturnType<typeof queryObjectLasso>;
    expected: ReturnType<typeof queryObjectLasso>;
  }[] = [];
  for (let length = 3; length <= path.length; length++) {
    const prefix = path.slice(0, length);
    const query = createLayeredLassoQuery(document, prefix);
    const expected = queryObjectLasso(document, prefix, 'intersects');
    if (!query.ok) {
      // The first three points of this exact trajectory are collinear.
      rejected.push({ actual: query, expected });
      continue;
    }
    // Leave earlier queries unfinished while each newer prefix enters. Zero
    // budget advances one candidate, independent of machine speed.
    expect(query.value.candidateCount).toBeGreaterThan(1);
    expect(query.value.step(() => 0, 0)).toBeNull();
    pending.push({ query: query.value, expected });
  }
  // Finish the full path first, then older prefixes; caches are shared but
  // each result's membership and document ordering must belong to its path.
  expect(rejected.map(({ actual }) => actual)).toEqual(rejected.map(({ expected }) => expected));
  expect(pending.length).toBeGreaterThan(1);
  for (const { query, expected } of pending.slice().reverse()) {
    let result = query.step(() => 0, 0);
    while (!result) result = query.step(() => 0, 0);
    expect(result).toEqual(expected);
    expect(query.step(() => 0, Infinity)).toBe(result);
  }
});

describe.each(cases)('$name: tool session', ({ target, path }) => {
  test.each(['synchronous', 'end-before-frame', 'preview-flushed'] as const)(
    '%s final selection includes target',
    (mode) => {
      const controller = makeLayeredController([target]);
      controller.setTool('lasso');
      const jobs = new Set<() => void>();
      const enqueue = (callback: () => void) => {
        jobs.add(callback);
        return () => {
          jobs.delete(callback);
        };
      };
      const scheduler: LayeredToolScheduler = { frame: enqueue, work: enqueue, now: () => 0 };
      const session = createLayeredToolSession(
        controller,
        () => 'unused',
        mode === 'synchronous' ? {} : { scheduler }
      );
      const document = controller.getSnapshot('document');
      const history = controller.getSnapshot('history');
      session.begin(path[0]!);
      session.update(path.slice(1));
      if (mode === 'preview-flushed') {
        while (jobs.size) {
          const batch = [...jobs];
          jobs.clear();
          batch.forEach((job) => job());
        }
      }
      expect(controller.getSnapshot('selection')).toEqual([]);
      session.end();
      for (let i = 0; jobs.size && i < 100; i++) {
        const batch = [...jobs];
        jobs.clear();
        batch.forEach((job) => job());
      }
      expect(controller.getSnapshot('selection')).toEqual(['target']);
      expect(controller.getSnapshot('tools').activeTool).toBe('selection');
      expect(controller.getSnapshot('document')).toBe(document);
      expect(controller.getSnapshot('history')).toBe(history);
      expect(jobs.size).toBe(0);
      session.destroy();
    }
  );
});
