/**
 * 自由笔几何 / 呈现缓存（Task 2.6）。
 *
 * 设计约束（design.md 决策 3 / spec freehand-geometry-pressure）：
 * - **headless 且 instance-scoped**：本模块只依赖冻结的 `model/document.ts` 契约与
 *   `geometry/freehand.ts` 的纯派生函数，不依赖 controller、DOM、Canvas、SVG、Skia 或 legacy。
 * - **只缓存派生几何/呈现**：缓存对象绝不为文档数据，也不写回 object；`samples`、`brushSnapshot`
 *   与文档对象始终只读，缓存不进入任何序列化结果。
 * - **几何 key 必须同时包含版本与对象身份**：仅相同 `objectId` + 相同 revision 不足以复用——
 *   当 `samples` / `brushSnapshot` 的**引用身份**变化时（即使 revision 未变）必须重算，避免
 *   文档替换或 undo/redo 快照复用到 stale outline。
 * - **transform 只影响呈现**：`getGeometry` 不含 transform；`getPresentation` 的 key 含
 *   `transformRevision` 与 transform 数值，`transformRevision` 变化即失效呈现，几何、raw
 *   samples 与 brush 引用保持不变。
 * - **active / final 分开 key**：同一对象两种派生状态各自独立缓存，互不复用。
 * - 变换要求各分量有限且矩阵非奇异；无法求逆的变换在此拒绝，避免未来几何 query/inverse 出错。
 *   本模块不生成任何 history/undo entry。
 */

import type {
  AcceptedSample,
  AffineTransform,
  Bounds,
  BrushSnapshot,
  EditorDocument,
  FreehandObject,
  Point,
  ResolvedPressureMode,
} from '../model/document';
import {
  deriveFreehandGeometry,
  FREEHAND_ALGORITHM_REVISION,
  type DerivedFreehandGeometry,
  type FreehandGeometryState,
} from './freehand';

/** 每个对象每种状态最多保留的几何条目数（当前 + 一步 undo/redo 复用）。 */
export const FREEHAND_CACHE_MAX_ENTRIES_PER_STATE = 2;

/** 每个对象最多保留的呈现条目数（覆盖若干 transform 版本，避免无界增长）。 */
export const FREEHAND_CACHE_MAX_PRESENTATIONS = 4;

/**
 * 世界坐标呈现结果。
 * - `worldBounds`：由 outline 顶点精确仿射变换后求包围盒得到。
 * - `transformedPolygon`：outline 顶点经 transform 后的世界坐标序列（本地几何的变换视图）。
 */
export type FreehandPresentation = Readonly<{
  worldBounds: Bounds;
  transformedPolygon: readonly Point[];
}>;

/**
 * 几何缓存 key 的版本输入。
 *
 * 注意：引用身份（`samples` / `brushSnapshot` 的 `===`）不能表示为字符串，由缓存内部的
 * `isSameGeometryInput` 额外守护；本函数只负责可序列化的版本部分，便于测试与调试。
 */
export type FreehandGeometryKeyInput = Readonly<{
  objectId: string;
  state: FreehandGeometryState;
  samplesRevision: number;
  brushRevision: number;
  presetRevision: number;
  mode: ResolvedPressureMode;
  /** 仅参与 key；实际派生始终使用当前 `FREEHAND_ALGORITHM_REVISION` 对应的实现。 */
  algorithmRevision: string;
}>;

/**
 * 组装几何缓存版本 key（纯函数，不含引用身份）。
 *
 * algorithm revision 是 key 的一部分：算法/preset 升级后必须视为不同条目。当前生产只传入
 * 常量 `FREEHAND_ALGORITHM_REVISION`，本函数不改变派生实现，也不提供人为的算法开关。
 */
export function buildFreehandGeometryCacheKey(input: FreehandGeometryKeyInput): string {
  return [
    input.algorithmRevision,
    input.objectId,
    input.state,
    `s${input.samplesRevision}`,
    `b${input.brushRevision}`,
    `p${input.presetRevision}`,
    `m${input.mode}`,
  ].join('|');
}

/** 内部几何缓存条目：version key + 引用身份 + 派生结果。 */
type GeometryCacheEntry = Readonly<{
  state: FreehandGeometryState;
  versionKey: string;
  samples: readonly AcceptedSample[];
  brush: BrushSnapshot;
  geometry: DerivedFreehandGeometry;
}>;

/** 内部呈现缓存条目：几何身份 + transform revision/值 + 呈现结果。 */
type PresentationCacheEntry = Readonly<{
  geometry: DerivedFreehandGeometry;
  transformRevision: number;
  transform: AffineTransform;
  presentation: FreehandPresentation;
}>;

/** 单个 objectId 的缓存槽。 */
type ObjectCacheSlot = {
  geometry: Map<FreehandGeometryState, GeometryCacheEntry[]>;
  presentation: PresentationCacheEntry[];
};

/** 数值相等的仿射比较；按值而非引用比较，使等价的新 transform 对象仍能复用呈现。 */
function isSameTransform(a: AffineTransform, b: AffineTransform): boolean {
  return (
    a.a === b.a &&
    a.b === b.b &&
    a.c === b.c &&
    a.d === b.d &&
    a.tx === b.tx &&
    a.ty === b.ty
  );
}

/** 断言 transform 各分量有限且矩阵可逆（det != 0）。 */
function assertUsableTransform(transform: AffineTransform): void {
  const components: ReadonlyArray<readonly [string, number]> = [
    ['a', transform.a],
    ['b', transform.b],
    ['c', transform.c],
    ['d', transform.d],
    ['tx', transform.tx],
    ['ty', transform.ty],
  ];
  for (const [name, value] of components) {
    if (!Number.isFinite(value)) {
      throw new TypeError(`transform.${name} must be finite, received ${String(value)}`);
    }
  }

  const determinant = transform.a * transform.d - transform.b * transform.c;
  if (!Number.isFinite(determinant) || determinant === 0) {
    throw new TypeError(`transform must be non-singular, determinant=${String(determinant)}`);
  }
}

/**
 * 把局部点按屏幕空间仿射约定变换到世界坐标。
 *
 * 有限矩阵乘以大坐标可能溢出为 ±Infinity；一旦查出非有限结果立即抛错，
 * 避免生成 infinite/NaN 的 worldBounds。
 */
function applyTransform(point: Point, transform: AffineTransform): Point {
  const x = transform.a * point.x + transform.c * point.y + transform.tx;
  const y = transform.b * point.x + transform.d * point.y + transform.ty;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new TypeError(
      `transform overflow: point (${String(point.x)}, ${String(point.y)}) produced non-finite (${String(x)}, ${String(y)})`
    );
  }
  return Object.freeze({ x, y });
}

/** 由一组点计算包围盒；调用方保证至少一个点，空退化输入回退到原点。 */
function computeBounds(points: readonly Point[]): Bounds {
  if (points.length === 0) {
    return Object.freeze({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of points) {
    if (point.x < minX) {
      minX = point.x;
    }
    if (point.y < minY) {
      minY = point.y;
    }
    if (point.x > maxX) {
      maxX = point.x;
    }
    if (point.y > maxY) {
      maxY = point.y;
    }
  }

  return Object.freeze({ minX, minY, maxX, maxY });
}

/** 空 polygon 时用 localBounds 四角作为变换源，保证 worldBounds 仍为有效单点/矩形。 */
function boundsCorners(bounds: Bounds): readonly Point[] {
  return Object.freeze([
    Object.freeze({ x: bounds.minX, y: bounds.minY }),
    Object.freeze({ x: bounds.maxX, y: bounds.minY }),
    Object.freeze({ x: bounds.maxX, y: bounds.maxY }),
    Object.freeze({ x: bounds.minX, y: bounds.maxY }),
  ]);
}

/** 派生世界坐标呈现；精确变换 outline 顶点后求 bounds。 */
function derivePresentation(
  geometry: DerivedFreehandGeometry,
  transform: AffineTransform
): FreehandPresentation {
  const source =
    geometry.polygon.length > 0 ? geometry.polygon : boundsCorners(geometry.localBounds);
  const transformedPolygon = Object.freeze(source.map((point) => applyTransform(point, transform)));

  return Object.freeze({
    worldBounds: computeBounds(transformedPolygon),
    transformedPolygon,
  });
}

/**
 * headless 自由笔几何/呈现缓存。
 *
 * 每个实例独立持有缓存；同一文档同一对象在 key 不变时复用派生结果，key 变化时重算。
 * 缓存槽由 `syncDocument` 按当前文档的 freehand objectId 保留/删除，生命周期与文档对象对齐。
 */
export class FreehandGeometryCache {
  private readonly objects = new Map<string, ObjectCacheSlot>();

  /** 按当前文档清理不再存在的 freehand 对象缓存槽；不做任何重算。 */
  syncDocument(document: EditorDocument): void {
    const liveFreehandIds = new Set<string>();
    for (const object of document.objects) {
      if (object.kind === 'freehand') {
        liveFreehandIds.add(object.objectId);
      }
    }

    // 先收集再删除，避免边遍历边修改。
    const staleIds: string[] = [];
    for (const objectId of this.objects.keys()) {
      if (!liveFreehandIds.has(objectId)) {
        staleIds.push(objectId);
      }
    }
    for (const objectId of staleIds) {
      this.objects.delete(objectId);
    }
  }

  /**
   * 取对象在指定状态下的派生几何（active / final 分开缓存）。
   *
   * key 同时要求版本相等与 `samples` / `brushSnapshot` 引用身份相等；文档替换或 undo/redo
   * 带来的新引用（即使 revision 未变）会触发重算，绝不返回 stale outline。
   */
  getGeometry(object: FreehandObject, state: FreehandGeometryState): DerivedFreehandGeometry {
    const slot = this.ensureSlot(object.objectId);
    const entries = slot.geometry.get(state) ?? [];
    if (!slot.geometry.has(state)) {
      slot.geometry.set(state, entries);
    }

    const versionKey = buildFreehandGeometryCacheKey({
      objectId: object.objectId,
      state,
      samplesRevision: object.samplesRevision,
      brushRevision: object.brushRevision,
      presetRevision: object.brushSnapshot.presetRevision,
      mode: object.resolvedPressureMode,
      algorithmRevision: FREEHAND_ALGORITHM_REVISION,
    });

    const hit = entries.find(
      (entry) =>
        entry.versionKey === versionKey &&
        entry.samples === object.samples &&
        entry.brush === object.brushSnapshot
    );
    if (hit !== undefined) {
      return hit.geometry;
    }

    const geometry = deriveFreehandGeometry(object, state);
    entries.unshift(
      Object.freeze({
        state,
        versionKey,
        samples: object.samples,
        brush: object.brushSnapshot,
        geometry,
      })
    );
    if (entries.length > FREEHAND_CACHE_MAX_ENTRIES_PER_STATE) {
      entries.length = FREEHAND_CACHE_MAX_ENTRIES_PER_STATE;
    }

    return geometry;
  }

  /**
   * 取对象在指定状态下的世界坐标呈现（bounds + 变换后 polygon）。
   *
   * 呈现 key = 几何身份 + `transformRevision` + transform 数值；`transformRevision` 变化即失效
   * （即使数值相同），与 design.md「世界 bounds 由 transformRevision 失效」一致。几何缓存被复用，
   * raw samples / brush 不被改写。非有限、奇异或溢出 transform 在此拒绝并抛错，不产生任何 history。
   */
  getPresentation(object: FreehandObject, state: FreehandGeometryState): FreehandPresentation {
    assertUsableTransform(object.transform);

    const geometry = this.getGeometry(object, state);
    const slot = this.ensureSlot(object.objectId);
    const hit = slot.presentation.find(
      (entry) =>
        entry.geometry === geometry &&
        entry.transformRevision === object.transformRevision &&
        isSameTransform(entry.transform, object.transform)
    );
    if (hit !== undefined) {
      return hit.presentation;
    }

    const presentation = derivePresentation(geometry, object.transform);
    slot.presentation.unshift(
      Object.freeze({
        geometry,
        transformRevision: object.transformRevision,
        transform: Object.freeze({ ...object.transform }),
        presentation,
      })
    );
    if (slot.presentation.length > FREEHAND_CACHE_MAX_PRESENTATIONS) {
      slot.presentation.length = FREEHAND_CACHE_MAX_PRESENTATIONS;
    }

    return presentation;
  }

  /** 清空全部缓存槽；不触碰任何文档数据。 */
  clear(): void {
    this.objects.clear();
  }

  /** 懒创建对象缓存槽。 */
  private ensureSlot(objectId: string): ObjectCacheSlot {
    const existing = this.objects.get(objectId);
    if (existing !== undefined) {
      return existing;
    }

    const slot: ObjectCacheSlot = {
      geometry: new Map<FreehandGeometryState, GeometryCacheEntry[]>(),
      presentation: [],
    };
    this.objects.set(objectId, slot);
    return slot;
  }
}
