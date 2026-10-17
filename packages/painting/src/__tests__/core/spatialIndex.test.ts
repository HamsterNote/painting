/** @jest-environment node */

import {
  SparseSpatialIndex,
  appendSpatialQueryIndex,
  getSpatialQueryIndexDeltaDepth,
  intersectsSpatialBounds,
  type SpatialBounds,
  type SpatialIndexMatch,
  type SpatialQueryIndex,
} from '../../core';

const bounds = (minX: number, minY: number, maxX: number, maxY: number) => ({
  minX,
  minY,
  maxX,
  maxY,
});

type DrawingEntryLike = Readonly<{
  key: number;
  stroke: Readonly<{ id: string }>;
}>;

type OracleRecord = Readonly<{
  key: number;
  value: DrawingEntryLike;
  bounds: SpatialBounds;
  order: number;
}>;

function intersects(left: SpatialBounds, right: SpatialBounds): boolean {
  return (
    left.minX < right.maxX &&
    left.maxX > right.minX &&
    left.minY < right.maxY &&
    left.maxY > right.minY
  );
}

function pointInBounds(
  recordBounds: SpatialBounds,
  point: Readonly<{ x: number; y: number }>
): boolean {
  return (
    recordBounds.minX <= point.x &&
    point.x < recordBounds.maxX &&
    recordBounds.minY <= point.y &&
    point.y < recordBounds.maxY
  );
}

function checksum(matches: readonly SpatialIndexMatch<DrawingEntryLike>[]): string {
  return matches.map(({ key, order, value }) => `${key}:${order}:${value.stroke.id}`).join('|');
}

describe('core/spatialIndex', () => {
  it('uses exact half-open predicates, including negative floor cells', () => {
    const index = new SparseSpatialIndex<string>({ cellSize: 10 });
    index.upsert('negative', 'negative', bounds(-19, -19, -11, -11));

    expect(index.query(bounds(-20, -20, -10, -10)).map(({ key }) => key)).toEqual(['negative']);
    expect(index.query(bounds(-11, -19, -10, -11))).toEqual([]);
    expect(intersectsSpatialBounds(bounds(0, 0, 1, 1), bounds(1, 0, 2, 1))).toBe(false);
  });

  it('registers cross-cell entries once and returns ascending explicit order', () => {
    const index = new SparseSpatialIndex<string>({ cellSize: 10 });
    index.upsert('late', 'late', bounds(5, 5, 25, 15), 20);
    index.upsert('first', 'first', bounds(9, 5, 11, 15), 1);
    index.upsert('middle', 'middle', bounds(0, 0, 10, 10), 10);

    expect(index.query(bounds(0, 0, 30, 20)).map(({ key }) => key)).toEqual([
      'first',
      'middle',
      'late',
    ]);
  });

  it('handles overflow and normal-to-overflow transitions, removal, and empty bucket cleanup', () => {
    const index = new SparseSpatialIndex<string>({ cellSize: 10, maxCellsPerObject: 2 });
    index.upsert('item', 'normal', bounds(0, 0, 9, 9));
    expect(index.query(bounds(0, 0, 10, 10)).map(({ value }) => value)).toEqual(['normal']);
    index.upsert('item', 'overflow', bounds(0, 0, 100, 100));
    expect(index.query(bounds(90, 90, 100, 100)).map(({ value }) => value)).toEqual(['overflow']);
    index.upsert('item', 'normal-again', bounds(-9, -9, -1, -1));
    expect(index.query(bounds(90, 90, 100, 100))).toEqual([]);
    expect(index.remove('item')).toBe(true);
    expect(index.size).toBe(0);
    expect(index.query(bounds(-10, -10, 0, 0))).toEqual([]);
  });

  it.each([
    ['normal-to-normal', bounds(1, 1, 9, 9), bounds(-9, -9, -1, -1)],
    ['normal-to-overflow', bounds(1, 1, 9, 9), bounds(-20, -20, 20, 20)],
    ['overflow-to-normal', bounds(-20, -20, 20, 20), bounds(1, 1, 9, 9)],
    ['overflow-to-overflow', bounds(-20, -20, 20, 20), bounds(30, 30, 70, 70)],
  ])(
    'preserves order across %s upserts unless an explicit order replaces it',
    (_transition, initialBounds, updatedBounds) => {
      const index = new SparseSpatialIndex<string>({ cellSize: 10, maxCellsPerObject: 1 });
      index.upsert('before', 'before', bounds(0, 0, 1, 1), 10);
      index.upsert('item', 'initial', initialBounds, 20);
      index.upsert('after', 'after', bounds(2, 2, 3, 3), 30);

      index.upsert('item', 'updated', updatedBounds);
      expect(index.query(bounds(-100, -100, 100, 100)).map(({ key }) => key)).toEqual([
        'before',
        'item',
        'after',
      ]);
      expect(
        index.query(bounds(-100, -100, 100, 100)).find(({ key }) => key === 'item')?.order
      ).toBe(20);

      index.upsert('item', 'explicit-order', updatedBounds, 40);
      expect(index.query(bounds(-100, -100, 100, 100)).map(({ key }) => key)).toEqual([
        'before',
        'after',
        'item',
      ]);
      expect(
        index.query(bounds(-100, -100, 100, 100)).find(({ key }) => key === 'item')?.order
      ).toBe(40);
    }
  );

  it('queries finite points by their floor cell, half-open bounds, and sorted internal keys', () => {
    const index = new SparseSpatialIndex<Readonly<{ stroke: Readonly<{ id: string }> }>>({
      cellSize: 10,
      maxCellsPerObject: 1,
    });
    index.upsert('top', { stroke: { id: 'duplicate' } }, bounds(-1, -1, 1, 1), 30);
    index.upsert('bottom', { stroke: { id: 'duplicate' } }, bounds(-1, -1, 1, 1), 10);
    index.upsert('overflow', { stroke: { id: 'overflow' } }, bounds(-20, -20, 20, 20), 20);
    index.upsert('positive-edge', { stroke: { id: 'positive-edge' } }, bounds(10, 10, 11, 11), 40);
    index.upsert(
      'negative-edge',
      { stroke: { id: 'negative-edge' } },
      bounds(-10, -10, -9, -9),
      50
    );

    expect(index.queryPoint({ x: 0, y: 0 }).map(({ key }) => key)).toEqual([
      'bottom',
      'overflow',
      'top',
    ]);
    expect(
      index.queryPoint({ x: Number.EPSILON, y: Number.EPSILON }).map(({ key }) => key)
    ).toEqual(['bottom', 'overflow', 'top']);
    expect(
      index.queryPoint({ x: -Number.EPSILON, y: -Number.EPSILON }).map(({ key }) => key)
    ).toEqual(['bottom', 'overflow', 'top']);
    expect(index.queryPoint({ x: 10, y: 10 }).map(({ key }) => key)).toEqual([
      'overflow',
      'positive-edge',
    ]);
    expect(index.queryPoint({ x: 9.999999, y: 9.999999 }).map(({ key }) => key)).toEqual([
      'overflow',
    ]);
    expect(index.queryPoint({ x: -10, y: -10 }).map(({ key }) => key)).toEqual([
      'overflow',
      'negative-edge',
    ]);
    expect(index.queryPoint({ x: -10.000001, y: -10.000001 }).map(({ key }) => key)).toEqual([
      'overflow',
    ]);
    expect(index.queryPoint({ x: Number.NaN, y: 0 })).toEqual([]);
    expect(index.queryPoint({ x: 0, y: Number.POSITIVE_INFINITY })).toEqual([]);
  });

  it('falls back to an exact linear scan when a query covers too many cells', () => {
    const index = new SparseSpatialIndex<string>({ cellSize: 10, maxCellsPerQuery: 1 });
    index.upsert('target', 'target', bounds(95, 95, 99, 99));
    index.upsert('outside', 'outside', bounds(200, 200, 210, 210));

    expect(index.query(bounds(0, 0, 100, 100)).map(({ key }) => key)).toEqual(['target']);
  });

  it('falls back to an exact linear scan when cell counting is not safe', () => {
    const index = new SparseSpatialIndex<string>({ cellSize: 10, maxCellsPerQuery: 1 });
    index.upsert('target', 'target', bounds(95, 95, 99, 99));

    expect(index.query(bounds(-1e308, -1e308, 1e308, 1e308)).map(({ key }) => key)).toEqual([
      'target',
    ]);
  });

  it('matches a linear drawing-entry oracle through fixed queries and lifecycle changes', () => {
    const index = new SparseSpatialIndex<DrawingEntryLike>({
      cellSize: 10,
      maxCellsPerObject: 4,
      maxCellsPerQuery: 4,
    });
    const oracle = new Map<number, OracleRecord>();
    let nextOrder = 0;

    const upsert = (key: number, strokeId: string, recordBounds: SpatialBounds, order?: number) => {
      const previous = oracle.get(key);
      const value = Object.freeze({ key, stroke: Object.freeze({ id: strokeId }) });
      const recordOrder = order ?? previous?.order ?? nextOrder++;
      index.upsert(key, value, recordBounds, order);
      oracle.set(key, Object.freeze({ key, value, bounds: recordBounds, order: recordOrder }));
    };
    const remove = (key: number) => {
      expect(index.remove(key)).toBe(oracle.delete(key));
    };
    const queryBank = [
      bounds(-30, -10, -1, 10),
      bounds(-1, -1, 1, 1),
      bounds(0, 0, 30, 20),
      bounds(-1e308, -1e308, 1e308, 1e308),
    ];
    const assertMatchesOracle = () => {
      for (const queryBounds of queryBank) {
        const expected = [...oracle.values()]
          .filter((record) => intersects(record.bounds, queryBounds))
          .sort((left, right) => left.order - right.order);
        const actual = index.query(queryBounds);
        expect(actual.map(({ key }) => key)).toEqual(expected.map(({ key }) => key));
        expect(actual.map(({ order }) => order)).toEqual(expected.map(({ order }) => order));
        expect(checksum(actual)).toBe(
          expected.map(({ key, order, value }) => `${key}:${order}:${value.stroke.id}`).join('|')
        );
      }

      for (const point of [
        { x: 0, y: 0 },
        { x: -10, y: 0 },
        { x: 19.999, y: 10 },
      ]) {
        const expected = [...oracle.values()]
          .filter((record) => pointInBounds(record.bounds, point))
          .sort((left, right) => left.order - right.order);
        const actual = index.queryPoint(point);
        expect(actual.map(({ key }) => key)).toEqual(expected.map(({ key }) => key));
        expect(actual.map(({ order }) => order)).toEqual(expected.map(({ order }) => order));
        expect(checksum(actual)).toBe(
          expected.map(({ key, order, value }) => `${key}:${order}:${value.stroke.id}`).join('|')
        );
      }
    };

    upsert(0, 'duplicate-display-id', bounds(-25, -5, -5, 5), 30);
    upsert(1, 'duplicate-display-id', bounds(-1, -1, 1, 1), 10);
    upsert(2, 'cross-cell', bounds(5, 5, 25, 15), 20);
    upsert(3, 'large-overflow', bounds(-40, -40, 40, 40), 40);
    upsert(4, 'far-overflow', bounds(100, 100, 150, 150), 50);
    upsert(5, 'traveler', bounds(200, 200, 201, 201), 60);
    assertMatchesOracle();

    upsert(5, 'traveler', bounds(0, 0, 1, 1));
    assertMatchesOracle();
    upsert(5, 'traveler', bounds(200, 200, 201, 201));
    assertMatchesOracle();
    upsert(5, 'traveler', bounds(0, 0, 1, 1));
    assertMatchesOracle();

    upsert(2, 'cross-cell-updated', bounds(-15, 5, 5, 15));
    remove(4);
    assertMatchesOracle();
  });

  it('composes immutable append deltas that match a full rebuild oracle for query and queryPoint', () => {
    const options = { cellSize: 10, maxCellsPerObject: 2, maxCellsPerQuery: 4 } as const;
    const records = [
      { key: 0, strokeId: 'duplicate', recordBounds: bounds(-25, -5, -5, 5) },
      { key: 1, strokeId: 'duplicate', recordBounds: bounds(-1, -1, 1, 1) },
      { key: 2, strokeId: 'cross', recordBounds: bounds(5, 5, 25, 15) },
      { key: 3, strokeId: 'overflow', recordBounds: bounds(-40, -40, 40, 40) },
      { key: 4, strokeId: 'nested', recordBounds: bounds(0, 0, 10, 10) },
    ];
    const full = new SparseSpatialIndex<DrawingEntryLike>(options);
    const baseSparse = new SparseSpatialIndex<DrawingEntryLike>(options);
    let incremental: SpatialQueryIndex<DrawingEntryLike> = baseSparse;
    let afterFirstAppend: SpatialQueryIndex<DrawingEntryLike> | null = null;

    for (const record of records) {
      const value = Object.freeze({ key: record.key, stroke: Object.freeze({ id: record.strokeId }) });
      incremental = appendSpatialQueryIndex(incremental, record.key, value, record.recordBounds, record.key, options);
      full.upsert(record.key, value, record.recordBounds, record.key);
      if (afterFirstAppend === null) afterFirstAppend = incremental;
    }

    const queryBank = [
      bounds(-30, -10, -1, 10),
      bounds(-1, -1, 1, 1),
      bounds(0, 0, 30, 20),
      bounds(-1e6, -1e6, 1e6, 1e6),
    ];
    for (const queryBounds of queryBank) {
      expect(checksum(incremental.query(queryBounds))).toBe(checksum(full.query(queryBounds)));
    }
    for (const point of [{ x: 0, y: 0 }, { x: -10, y: 0 }, { x: 19.999, y: 10 }, { x: 10, y: 10 }]) {
      expect(incremental.queryPoint(point).map(({ key, order }) => `${key}:${order}`)).toEqual(
        full.queryPoint(point).map(({ key, order }) => `${key}:${order}`)
      );
    }

    // previous 索引绝不被追加修改：最底层 sparse 保持为空，第一个组合快照仍只含一条记录。
    expect(checksum(baseSparse.query(bounds(-1e6, -1e6, 1e6, 1e6)))).toBe('');
    expect(checksum(afterFirstAppend!.query(bounds(-1e6, -1e6, 1e6, 1e6)))).toBe('0:0:duplicate');
  });

  it('returns the previous index unchanged for invalid append bounds without advancing the chain', () => {
    const base = new SparseSpatialIndex<DrawingEntryLike>({ cellSize: 10 });
    base.upsert(0, Object.freeze({ key: 0, stroke: Object.freeze({ id: 'kept' }) }), bounds(0, 0, 5, 5), 0);
    const before = checksum(base.query(bounds(-10, -10, 10, 10)));

    const appended = appendSpatialQueryIndex(
      base,
      1,
      Object.freeze({ key: 1, stroke: Object.freeze({ id: 'invalid' }) }),
      bounds(Number.NaN, 0, 5, 5),
      1,
      { cellSize: 10 }
    );

    expect(appended).toBe(base);
    expect(getSpatialQueryIndexDeltaDepth(appended)).toBe(0);
    expect(checksum(base.query(bounds(-10, -10, 10, 10)))).toBe(before);
  });

  it('flattens the delta chain at maxDeltaDepth while preserving identical results', () => {
    const options = { cellSize: 10, maxCellsPerObject: 2, maxCellsPerQuery: 4, maxDeltaDepth: 2 } as const;
    const full = new SparseSpatialIndex<DrawingEntryLike>(options);
    let incremental: SpatialQueryIndex<DrawingEntryLike> = new SparseSpatialIndex<DrawingEntryLike>(options);
    const depths: number[] = [];

    for (let key = 0; key < 6; key += 1) {
      const value = Object.freeze({ key, stroke: Object.freeze({ id: `s${key}` }) });
      const recordBounds = bounds(key * 10, 0, key * 10 + 5, 5);
      incremental = appendSpatialQueryIndex(incremental, key, value, recordBounds, key, options);
      full.upsert(key, value, recordBounds, key);
      depths.push(getSpatialQueryIndexDeltaDepth(incremental));
    }

    // 链深被严格限制在 cap 内，并在每次触顶时重建压平（depth 归零）。
    expect(Math.max(...depths)).toBeLessThanOrEqual(2);
    expect(depths).toContain(0);
    expect(getSpatialQueryIndexDeltaDepth(incremental)).toBe(0);
    expect(checksum(incremental.query(bounds(-100, -100, 1_000, 100)))).toBe(
      checksum(full.query(bounds(-100, -100, 1_000, 100)))
    );
  });
});
