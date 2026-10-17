/** 使用半开 AABB 的通用空间索引 bounds。 */
export type SpatialBounds = Readonly<{
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}>;

/** 世界坐标中的精确查询点。 */
export type SpatialPoint = Readonly<{
  x: number;
  y: number;
}>;

export type SparseSpatialIndexOptions = Readonly<{
  cellSize?: number;
  maxCellsPerObject?: number;
  maxCellsPerQuery?: number;
}>;

export type SpatialIndexMatch<T> = Readonly<{
  key: string | number;
  value: T;
  bounds: SpatialBounds;
  order: number;
}>;

/**
 * 只读空间查询契约。`SparseSpatialIndex` 与增量组合索引都实现它；
 * frame/hit 只依赖 query/queryPoint，不依赖任何可变 upsert/remove。
 */
export type SpatialQueryIndex<T> = Readonly<{
  query(bounds: SpatialBounds): readonly SpatialIndexMatch<T>[];
  queryPoint(point: SpatialPoint): readonly SpatialIndexMatch<T>[];
}>;

/** 覆盖全部有限 bounds 的查询范围，用于把链式 delta 压平重建时枚举所有记录。 */
const ALL_SPATIAL_BOUNDS: SpatialBounds = Object.freeze({
  minX: -1e308,
  minY: -1e308,
  maxX: 1e308,
  maxY: 1e308,
});

/** 链式 delta 的默认深度上限；超过时用一次全量重建压平，避免查询沿无界链退化。 */
export const DEFAULT_MAX_SPATIAL_DELTA_DEPTH = 32;

export type AppendSpatialQueryIndexOptions = SparseSpatialIndexOptions &
  Readonly<{
    /** 允许的最大 delta 链深；设为 1 表示每次 append 都重建。 */
    maxDeltaDepth?: number;
  }>;

type Record<T> = SpatialIndexMatch<T> & { readonly cells: readonly string[] | null };

const DEFAULT_CELL_SIZE = 256;
const DEFAULT_MAX_CELLS_PER_OBJECT = 64;
const DEFAULT_MAX_CELLS_PER_QUERY = 4096;

function isFiniteBounds(bounds: SpatialBounds): boolean {
  return (
    [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite) &&
    bounds.minX < bounds.maxX &&
    bounds.minY < bounds.maxY
  );
}

function isFinitePoint(point: SpatialPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

/** 半开区间相交；接触边界不算相交。 */
export function intersectsSpatialBounds(left: SpatialBounds, right: SpatialBounds): boolean {
  return (
    left.minX < right.maxX &&
    left.maxX > right.minX &&
    left.minY < right.maxY &&
    left.maxY > right.minY
  );
}

/** 半开 bounds 内含；与 query(bounds) 的相交谓词不同，max 边不属于对象。 */
function containsSpatialPoint(bounds: SpatialBounds, point: SpatialPoint): boolean {
  return (
    bounds.minX <= point.x &&
    point.x < bounds.maxX &&
    bounds.minY <= point.y &&
    point.y < bounds.maxY
  );
}

function cellRange(
  bounds: SpatialBounds,
  cellSize: number
): Readonly<{ minX: number; maxX: number; minY: number; maxY: number }> | null {
  if (!isFiniteBounds(bounds)) return null;
  // max 是半开边界，ceil(max / size) - 1 正好排除落在下一 cell 起点的边。
  const minX = Math.floor(bounds.minX / cellSize);
  const maxX = Math.ceil(bounds.maxX / cellSize) - 1;
  const minY = Math.floor(bounds.minY / cellSize);
  const maxY = Math.ceil(bounds.maxY / cellSize) - 1;
  return [minX, maxX, minY, maxY].every(Number.isFinite)
    ? Object.freeze({ minX, maxX, minY, maxY })
    : null;
}

function cellCount(
  range: Readonly<{ minX: number; maxX: number; minY: number; maxY: number }>
): number | null {
  const columns = range.maxX - range.minX + 1;
  const rows = range.maxY - range.minY + 1;
  const count = columns * rows;
  return Number.isSafeInteger(columns) &&
    Number.isSafeInteger(rows) &&
    Number.isSafeInteger(count) &&
    count >= 0
    ? count
    : null;
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * 无 document 语义的稀疏 hash。对象与查询的大范围情况回退为线性精确过滤，
 * 所以保护阈值只影响性能，不影响结果正确性。
 */
export class SparseSpatialIndex<T> implements SpatialQueryIndex<T> {
  private readonly cells = new Map<string, Set<string | number>>();
  private readonly records = new Map<string | number, Record<T>>();
  private readonly overflow = new Set<string | number>();
  private nextOrder = 0;
  readonly cellSize: number;
  readonly maxCellsPerObject: number;
  readonly maxCellsPerQuery: number;

  constructor(options: SparseSpatialIndexOptions = {}) {
    const cellSize = options.cellSize ?? DEFAULT_CELL_SIZE;
    const maxCellsPerObject = options.maxCellsPerObject ?? DEFAULT_MAX_CELLS_PER_OBJECT;
    const maxCellsPerQuery = options.maxCellsPerQuery ?? DEFAULT_MAX_CELLS_PER_QUERY;
    if (
      !Number.isFinite(cellSize) ||
      cellSize <= 0 ||
      !Number.isSafeInteger(maxCellsPerObject) ||
      maxCellsPerObject <= 0 ||
      !Number.isSafeInteger(maxCellsPerQuery) ||
      maxCellsPerQuery <= 0
    ) {
      throw new Error('SparseSpatialIndex options must be finite positive values');
    }
    this.cellSize = cellSize;
    this.maxCellsPerObject = maxCellsPerObject;
    this.maxCellsPerQuery = maxCellsPerQuery;
  }

  get size(): number {
    return this.records.size;
  }

  upsert(key: string | number, value: T, bounds: SpatialBounds, order?: number): boolean {
    if (!isFiniteBounds(bounds) || (order !== undefined && !Number.isFinite(order))) return false;
    // 移除 bucket 归属前保留序号，使无显式 order 的更新不改变绘制层级。
    const previousOrder = this.records.get(key)?.order;
    this.remove(key);
    const range = cellRange(bounds, this.cellSize);
    const count = range === null ? null : cellCount(range);
    const copiedBounds = Object.freeze({ ...bounds });
    const cells: string[] = [];
    const isOverflow = count === null || count > this.maxCellsPerObject;
    if (!isOverflow && range !== null) {
      for (let y = range.minY; y <= range.maxY; y += 1) {
        for (let x = range.minX; x <= range.maxX; x += 1) {
          const keyForCell = cellKey(x, y);
          cells.push(keyForCell);
          let bucket = this.cells.get(keyForCell);
          if (!bucket) {
            bucket = new Set();
            this.cells.set(keyForCell, bucket);
          }
          bucket.add(key);
        }
      }
    } else {
      this.overflow.add(key);
    }
    const record = Object.freeze({
      key,
      value,
      bounds: copiedBounds,
      order: order ?? previousOrder ?? this.nextOrder++,
      cells: isOverflow ? null : Object.freeze(cells),
    });
    this.records.set(key, record);
    return true;
  }

  remove(key: string | number): boolean {
    const record = this.records.get(key);
    if (!record) return false;
    if (record.cells === null) {
      this.overflow.delete(key);
    } else {
      for (const keyForCell of record.cells) {
        const bucket = this.cells.get(keyForCell);
        if (!bucket) continue;
        bucket.delete(key);
        if (bucket.size === 0) this.cells.delete(keyForCell);
      }
    }
    this.records.delete(key);
    return true;
  }

  query(bounds: SpatialBounds): readonly SpatialIndexMatch<T>[] {
    if (!isFiniteBounds(bounds)) return Object.freeze([]);
    const range = cellRange(bounds, this.cellSize);
    const count = range === null ? null : cellCount(range);
    const candidates = new Set<string | number>();
    if (count === null || count > this.maxCellsPerQuery) {
      for (const key of this.records.keys()) candidates.add(key);
    } else if (range !== null) {
      for (let y = range.minY; y <= range.maxY; y += 1) {
        for (let x = range.minX; x <= range.maxX; x += 1) {
          const bucket = this.cells.get(cellKey(x, y));
          if (bucket) for (const key of bucket) candidates.add(key);
        }
      }
      for (const key of this.overflow) candidates.add(key);
    }
    const result: SpatialIndexMatch<T>[] = [];
    for (const key of candidates) {
      const record = this.records.get(key);
      if (record && intersectsSpatialBounds(record.bounds, bounds)) result.push(record);
    }
    result.sort((left, right) => left.order - right.order);
    return Object.freeze(result);
  }

  /**
   * 精确点查询直接读取 point 所在的单个 bucket 与 overflow，不经半开 AABB query。
   * 这与 query(bounds) 的相交查询不同：点落在 record.maxX/maxY 上时不命中。
   */
  queryPoint(point: SpatialPoint): readonly SpatialIndexMatch<T>[] {
    if (!isFinitePoint(point)) return Object.freeze([]);
    const candidates = new Set<string | number>();
    const bucket = this.cells.get(
      cellKey(Math.floor(point.x / this.cellSize), Math.floor(point.y / this.cellSize))
    );
    if (bucket) for (const key of bucket) candidates.add(key);
    for (const key of this.overflow) candidates.add(key);

    const result: SpatialIndexMatch<T>[] = [];
    for (const key of candidates) {
      const record = this.records.get(key);
      if (record && containsSpatialPoint(record.bounds, point)) result.push(record);
    }
    result.sort((left, right) => left.order - right.order);
    return Object.freeze(result);
  }
}

export function createSparseSpatialIndex<T>(
  options?: SparseSpatialIndexOptions
): SparseSpatialIndex<T> {
  return new SparseSpatialIndex<T>(options);
}

/** 简短别名，保留 sparse 实现细节在类型名称中可见。 */
export { SparseSpatialIndex as SpatialIndex };

function sparseOptionsFrom(options: AppendSpatialQueryIndexOptions): SparseSpatialIndexOptions {
  return {
    ...(options.cellSize === undefined ? {} : { cellSize: options.cellSize }),
    ...(options.maxCellsPerObject === undefined ? {} : { maxCellsPerObject: options.maxCellsPerObject }),
    ...(options.maxCellsPerQuery === undefined ? {} : { maxCellsPerQuery: options.maxCellsPerQuery }),
  };
}

/**
 * 不可变组合索引：base 是任意既有查询索引，delta 只承载本次追加的一条记录。
 *
 * 不变量：append-only 场景下 delta 的 order（document 下标）严格大于 base 中所有 order，
 * 且 base/delta 的 key 互不相交。因此 base.query 与 delta.query 各自升序，直接拼接即为
 * 全局升序，无需排序，也不会产生重复 key。组合过程不修改 base，也不读取其可变内部状态。
 */
class ComposedSpatialQueryIndex<T> implements SpatialQueryIndex<T> {
  readonly deltaDepth: number;
  private readonly base: SpatialQueryIndex<T>;
  private readonly delta: SparseSpatialIndex<T>;

  constructor(base: SpatialQueryIndex<T>, delta: SparseSpatialIndex<T>, deltaDepth: number) {
    this.base = base;
    this.delta = delta;
    this.deltaDepth = deltaDepth;
    Object.freeze(this);
  }

  query(bounds: SpatialBounds): readonly SpatialIndexMatch<T>[] {
    const baseMatches = this.base.query(bounds);
    const deltaMatches = this.delta.query(bounds);
    if (deltaMatches.length === 0) return baseMatches;
    if (baseMatches.length === 0) return deltaMatches;
    return Object.freeze([...baseMatches, ...deltaMatches]);
  }

  queryPoint(point: SpatialPoint): readonly SpatialIndexMatch<T>[] {
    const baseMatches = this.base.queryPoint(point);
    const deltaMatches = this.delta.queryPoint(point);
    if (deltaMatches.length === 0) return baseMatches;
    if (baseMatches.length === 0) return deltaMatches;
    return Object.freeze([...baseMatches, ...deltaMatches]);
  }
}

/** 返回查询索引当前的 delta 链深；非组合索引（含全量 SparseSpatialIndex）为 0。 */
export function getSpatialQueryIndexDeltaDepth(index: SpatialQueryIndex<unknown>): number {
  return index instanceof ComposedSpatialQueryIndex ? index.deltaDepth : 0;
}

/**
 * append-only 增量空间索引：在不修改 previous 的前提下，把一条新记录组合到既有查询索引上。
 *
 * - 边界、overflow、query/queryPoint 的半开语义完全委托给底层 SparseSpatialIndex，结果与全量重建一致。
 * - 非法 bounds 直接返回 previous（不推进链）。
 * - 当链深达到 maxDeltaDepth 时，用一次全量重建（枚举 previous 所有记录）压平，返回新的
 *   SparseSpatialIndex；调用方可通过 getSpatialQueryIndexDeltaDepth 观察并自行控制上限。
 */
export function appendSpatialQueryIndex<T>(
  previous: SpatialQueryIndex<T>,
  key: string | number,
  value: T,
  bounds: SpatialBounds,
  order: number,
  options: AppendSpatialQueryIndexOptions = {}
): SpatialQueryIndex<T> {
  const sparseOptions = sparseOptionsFrom(options);
  const delta = new SparseSpatialIndex<T>(sparseOptions);
  if (!delta.upsert(key, value, bounds, order)) return previous;

  const maxDeltaDepth = Number.isSafeInteger(options.maxDeltaDepth) && (options.maxDeltaDepth as number) > 0
    ? (options.maxDeltaDepth as number)
    : DEFAULT_MAX_SPATIAL_DELTA_DEPTH;
  const currentDepth = getSpatialQueryIndexDeltaDepth(previous as SpatialQueryIndex<unknown>);
  if (currentDepth >= maxDeltaDepth) {
    const flattened = new SparseSpatialIndex<T>(sparseOptions);
    for (const match of previous.query(ALL_SPATIAL_BOUNDS)) {
      flattened.upsert(match.key, match.value, match.bounds, match.order);
    }
    flattened.upsert(key, value, bounds, order);
    return flattened;
  }
  return new ComposedSpatialQueryIndex(previous, delta, currentDepth + 1);
}
