/** @jest-environment node */

/**
 * Task 2.6 证据：自由笔几何/呈现缓存（`geometry/freehandCache.ts`）。
 *
 * 范围声明（重要）：
 * - 只验证 headless、instance-scoped 缓存的 key/失效/生命周期与呈现变换，不依赖 DOM/RN/Skia。
 * - 只读 `model/document.ts` 与 `geometry/freehand.ts` 的既有契约，不修改生产代码。
 * - 证明缓存全部为派生数据、不写回 object、不进入文档序列化。
 */

import { buildFreehandGeometryCacheKey, FreehandGeometryCache } from '../../geometry/freehandCache';
import { FREEHAND_ALGORITHM_REVISION } from '../../geometry/freehand';
import {
  IDENTITY_TRANSFORM,
  type AcceptedSample,
  type BrushSnapshot,
  type DocumentObject,
  type EditorDocument,
  type FreehandObject,
} from '../../model/document';

/** 构造一段带真实压力的 accepted raw 序列（长度 >= 3，保证 down/move/up 齐全）。 */
function makeSamples(pressures: readonly number[]): readonly AcceptedSample[] {
  return pressures.map((pressure, index) => ({
    sequence: index,
    x: index * 3,
    y: index * 2,
    pressure,
    time: index * 10,
    phase: index === 0 ? 'down' : index === pressures.length - 1 ? 'up' : 'move',
    source: 'pen',
  }));
}

/** 构造 brush snapshot。 */
function makeBrush(overrides: Partial<BrushSnapshot> = {}): BrushSnapshot {
  return {
    color: '#111111',
    nominalSize: 12,
    opacity: 1,
    pressureMode: 'real',
    presetRevision: 1,
    ...overrides,
  };
}

/** 构造自由笔对象。 */
function makeFreehand(overrides: Partial<FreehandObject> = {}): FreehandObject {
  return {
    kind: 'freehand',
    objectId: 'obj-1',
    objectRevision: 1,
    transform: IDENTITY_TRANSFORM,
    transformRevision: 1,
    commitId: 'commit-1',
    samples: makeSamples([0.3, 0.5, 0.7, 0.6, 0.4]),
    brushSnapshot: makeBrush(),
    resolvedPressureMode: 'real',
    samplesRevision: 1,
    brushRevision: 1,
    ...overrides,
  };
}

/** 构造文档。 */
function makeDocument(objects: readonly DocumentObject[]): EditorDocument {
  return { schemaVersion: 3, documentRevision: 1, objects };
}

describe('FreehandGeometryCache: 复用命中与 active/final 分离', () => {
  it('重复 getGeometry/getPresentation 命中同一 frozen 引用', () => {
    const cache = new FreehandGeometryCache();
    const object = makeFreehand();

    const g1 = cache.getGeometry(object, 'active');
    const g2 = cache.getGeometry(object, 'active');
    expect(g2).toBe(g1);

    const p1 = cache.getPresentation(object, 'active');
    const p2 = cache.getPresentation(object, 'active');
    expect(p2).toBe(p1);
    expect(Object.isFrozen(p1)).toBe(true);
    expect(Object.isFrozen(p1.worldBounds)).toBe(true);
  });

  it('active 与 final 分开 key，互不复用', () => {
    const cache = new FreehandGeometryCache();
    const object = makeFreehand();

    const active = cache.getGeometry(object, 'active');
    const final = cache.getGeometry(object, 'final');

    expect(final).not.toBe(active);
    expect(cache.getGeometry(object, 'active')).toBe(active);
    expect(cache.getGeometry(object, 'final')).toBe(final);
  });
});

describe('FreehandGeometryCache: 版本与对象身份失效', () => {
  it('samplesRevision 变化即使 samples 引用相同也重算', () => {
    const cache = new FreehandGeometryCache();
    const object = makeFreehand();
    const g1 = cache.getGeometry(object, 'active');

    const bumped = { ...object, samplesRevision: object.samplesRevision + 1 };
    expect(bumped.samples).toBe(object.samples);
    expect(cache.getGeometry(bumped, 'active')).not.toBe(g1);
  });

  it('同一 id/revision 但新 samples 引用（新 payload）必须重算', () => {
    const cache = new FreehandGeometryCache();
    const object = makeFreehand();
    const g1 = cache.getGeometry(object, 'active');

    const rehydrated = { ...object, samples: object.samples.map((sample) => ({ ...sample })) };
    expect(rehydrated.samplesRevision).toBe(object.samplesRevision);
    expect(rehydrated.samples).not.toBe(object.samples);
    expect(cache.getGeometry(rehydrated, 'active')).not.toBe(g1);
  });

  it('新 brushSnapshot 引用（同值同 revision）必须重算', () => {
    const cache = new FreehandGeometryCache();
    const object = makeFreehand();
    const g1 = cache.getGeometry(object, 'active');

    const nextBrush = { ...object.brushSnapshot };
    const next = { ...object, brushSnapshot: nextBrush };
    expect(next.brushRevision).toBe(object.brushRevision);
    expect(nextBrush).not.toBe(object.brushSnapshot);
    expect(cache.getGeometry(next, 'active')).not.toBe(g1);
  });

  it('brushRevision 变化重算', () => {
    const cache = new FreehandGeometryCache();
    const object = makeFreehand();
    const g1 = cache.getGeometry(object, 'active');

    const bumped = { ...object, brushRevision: object.brushRevision + 1 };
    expect(cache.getGeometry(bumped, 'active')).not.toBe(g1);
  });

  it('presetRevision 变化重算', () => {
    const cache = new FreehandGeometryCache();
    const object = makeFreehand();
    const g1 = cache.getGeometry(object, 'active');

    const next = {
      ...object,
      brushSnapshot: makeBrush({
        presetRevision: object.brushSnapshot.presetRevision + 1,
      }),
    };
    expect(cache.getGeometry(next, 'active')).not.toBe(g1);
  });

  it('resolvedPressureMode 变化重算', () => {
    const cache = new FreehandGeometryCache();
    const object = makeFreehand();
    const g1 = cache.getGeometry(object, 'active');

    const simulated = { ...object, resolvedPressureMode: 'simulated' as const };
    expect(cache.getGeometry(simulated, 'active')).not.toBe(g1);
  });

  it('algorithm revision 参与 key（const assert + key 敏感性）', () => {
    // 锁定当前算法/preset 常量，future 升级必须显式改此值。
    expect(FREEHAND_ALGORITHM_REVISION).toBe('pf@1.2.3:preset1');

    const base = {
      objectId: 'obj-1',
      state: 'active' as const,
      samplesRevision: 1,
      brushRevision: 1,
      presetRevision: 1,
      mode: 'real' as const,
    };
    const keyA = buildFreehandGeometryCacheKey({ ...base, algorithmRevision: 'algo-a' });
    const keyB = buildFreehandGeometryCacheKey({ ...base, algorithmRevision: 'algo-b' });

    expect(keyA).not.toBe(keyB);
    expect(keyA).toContain('algo-a');
    expect(
      buildFreehandGeometryCacheKey({
        ...base,
        algorithmRevision: FREEHAND_ALGORITHM_REVISION,
      })
    ).toContain(FREEHAND_ALGORITHM_REVISION);
  });
});

describe('FreehandGeometryCache: transform 只失效呈现', () => {
  it('仅 transform 变化：几何复用，呈现重算，samples/brush 引用与版本不变', () => {
    const cache = new FreehandGeometryCache();
    const object = makeFreehand();
    const g1 = cache.getGeometry(object, 'active');
    const p1 = cache.getPresentation(object, 'active');

    const moved = {
      ...object,
      transform: Object.freeze({ ...object.transform, tx: 100, ty: 20 }),
      transformRevision: object.transformRevision + 1,
    };
    const g2 = cache.getGeometry(moved, 'active');
    const p2 = cache.getPresentation(moved, 'active');

    // 几何 key 不含 transform：仍复用同一几何。
    expect(g2).toBe(g1);
    // 未改写 raw samples / brush 引用与版本。
    expect(moved.samples).toBe(object.samples);
    expect(moved.brushSnapshot).toBe(object.brushSnapshot);
    expect(moved.samplesRevision).toBe(object.samplesRevision);
    expect(moved.brushRevision).toBe(object.brushRevision);

    // 呈现按新 transform 重算，且平移量精确反映在 worldBounds。
    expect(p2).not.toBe(p1);
    expect(p2.worldBounds.minX).toBeCloseTo(p1.worldBounds.minX + 100, 6);
    expect(p2.worldBounds.minY).toBeCloseTo(p1.worldBounds.minY + 20, 6);
    // 原对象的呈现未被污染。
    expect(cache.getPresentation(object, 'active')).toBe(p1);
  });

  it('transformRevision 单独变化（数值不变）→ 几何复用，呈现按 revision 重算且数值相等', () => {
    const cache = new FreehandGeometryCache();
    const object = makeFreehand();
    const g1 = cache.getGeometry(object, 'active');
    const p1 = cache.getPresentation(object, 'active');

    const revisionBumped = { ...object, transformRevision: object.transformRevision + 1 };

    // 几何 key 不含 transform/transformRevision：仍复用同一几何。
    expect(cache.getGeometry(revisionBumped, 'active')).toBe(g1);

    // 呈现由 transformRevision 失效：生成新对象，但数值 bounds / polygon 相同。
    const p2 = cache.getPresentation(revisionBumped, 'active');
    expect(p2).not.toBe(p1);
    expect(p2.worldBounds).toEqual(p1.worldBounds);
    expect(p2.transformedPolygon).toEqual(p1.transformedPolygon);
  });

  it('有限矩阵乘大坐标溢出 → 拒绝，不生成 infinite bounds', () => {
    const cache = new FreehandGeometryCache();
    // det = MAX_VALUE * 1 = MAX_VALUE（有限、非奇异）；但 MAX_VALUE * ~O(10) 的局部坐标会溢出。
    const object = makeFreehand({
      transform: Object.freeze({ a: Number.MAX_VALUE, b: 0, c: 0, d: 1, tx: 0, ty: 0 }),
    });

    expect(() => cache.getPresentation(object, 'active')).toThrow(TypeError);
  });

  it('非有限 transform 在呈现阶段被拒绝，几何仍可派生', () => {
    const cache = new FreehandGeometryCache();
    const object = makeFreehand();
    const bad = { ...object, transform: { ...object.transform, a: Number.NaN } };

    expect(() => cache.getGeometry(bad, 'active')).not.toThrow();
    expect(() => cache.getPresentation(bad, 'active')).toThrow(TypeError);
  });

  it('奇异 transform（det=0）被拒绝', () => {
    const cache = new FreehandGeometryCache();
    const object = makeFreehand();
    const singular = { ...object, transform: { ...object.transform, a: 0, b: 0, c: 0, d: 0 } };

    expect(() => cache.getPresentation(singular, 'active')).toThrow(TypeError);
  });
});

describe('FreehandGeometryCache: 文档生命周期', () => {
  it('syncDocument 删除后条目失效；reinsert 重新派生', () => {
    const cache = new FreehandGeometryCache();
    const object = makeFreehand();

    cache.syncDocument(makeDocument([object]));
    const g1 = cache.getGeometry(object, 'active');

    // 删除：文档不再包含该对象 → 缓存槽清除。
    cache.syncDocument(makeDocument([]));
    const g2 = cache.getGeometry(object, 'active');
    expect(g2).not.toBe(g1);

    // reinsert：重新建立缓存。
    cache.syncDocument(makeDocument([object]));
    expect(cache.getGeometry(object, 'active')).toBe(g2);
  });

  it('文档替换为不同 objectId 的对象 → 旧条目删除，新对象独立缓存', () => {
    const cache = new FreehandGeometryCache();
    const oldObject = makeFreehand({ objectId: 'old' });
    const newObject = makeFreehand({
      objectId: 'new',
      samples: makeSamples([0.5, 0.5, 0.5]),
    });

    cache.syncDocument(makeDocument([oldObject]));
    const oldGeometry = cache.getGeometry(oldObject, 'active');

    cache.syncDocument(makeDocument([newObject]));
    expect(cache.getGeometry(newObject, 'active')).not.toBe(oldGeometry);

    // 旧对象即使再次使用也不命中已删除的旧几何。
    expect(cache.getGeometry(oldObject, 'active')).not.toBe(oldGeometry);
  });

  it('undo/redo 快照：不返回 stale outline，同引用回到可复用', () => {
    const cache = new FreehandGeometryCache();
    const base = makeFreehand({ samples: makeSamples([0.2, 0.4, 0.6, 0.4, 0.2]) });

    cache.syncDocument(makeDocument([base]));
    const baseGeometry = cache.getGeometry(base, 'active');

    // 编辑产生新 payload（新 samples 引用，revision+1）。
    const edited = {
      ...base,
      samples: makeSamples([0.5, 0.6, 0.7, 0.6, 0.5]),
      samplesRevision: base.samplesRevision + 1,
    };
    cache.syncDocument(makeDocument([edited]));
    const editedGeometry = cache.getGeometry(edited, 'active');
    expect(editedGeometry).not.toBe(baseGeometry);
    expect(editedGeometry.geometryRevision).not.toBe(baseGeometry.geometryRevision);

    // undo：回到 base 快照（同一 samples 引用/版本）→ 复用 base 几何，而非 edited。
    cache.syncDocument(makeDocument([base]));
    expect(cache.getGeometry(base, 'active')).toBe(baseGeometry);

    // redo：回到 edited → 复用 edited 几何。
    cache.syncDocument(makeDocument([edited]));
    expect(cache.getGeometry(edited, 'active')).toBe(editedGeometry);

    // undo 后的几何内容确实不同于 edited，未 stale。
    expect(cache.getGeometry(base, 'active').polygon).not.toEqual(editedGeometry.polygon);
  });

  it('clear 后重新派生，不残留 stale 条目', () => {
    const cache = new FreehandGeometryCache();
    const object = makeFreehand();
    const g1 = cache.getGeometry(object, 'active');

    cache.clear();
    expect(cache.getGeometry(object, 'active')).not.toBe(g1);
  });
});

describe('FreehandGeometryCache: 派生数据不进入保存数据', () => {
  it('文档序列化不含 polygon/commands/worldBounds/geometryRevision', () => {
    const cache = new FreehandGeometryCache();
    const object = makeFreehand();
    const document = makeDocument([object]);

    cache.syncDocument(document);
    const geometry = cache.getGeometry(object, 'active');
    const presentation = cache.getPresentation(object, 'active');

    expect(geometry.polygon.length).toBeGreaterThan(0);
    expect(presentation.transformedPolygon.length).toBeGreaterThan(0);

    const json = JSON.stringify(document);
    expect(json).not.toContain('polygon');
    expect(json).not.toContain('commands');
    expect(json).not.toContain('worldBounds');
    expect(json).not.toContain('geometryRevision');
  });

  it('raw samples 与对象不被修改，引用保持', () => {
    const cache = new FreehandGeometryCache();
    const object = makeFreehand();
    const samplesRef = object.samples;
    const brushRef = object.brushSnapshot;
    const before = JSON.stringify(object);

    cache.syncDocument(makeDocument([object]));
    cache.getGeometry(object, 'active');
    cache.getGeometry(object, 'final');
    cache.getPresentation(object, 'active');
    cache.getPresentation(object, 'final');

    expect(object.samples).toBe(samplesRef);
    expect(object.brushSnapshot).toBe(brushRef);
    expect(JSON.stringify(object)).toBe(before);
  });
});
