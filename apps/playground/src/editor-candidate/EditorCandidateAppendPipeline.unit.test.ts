/// <reference types="jest" />
/**
 * Candidate Surface 增量 prepared 管线所依赖的 core append 契约聚焦测试。
 *
 * Surface 的 pipeline 集成只在「新 document 严格以旧 document 的全部 stroke 引用为前缀且更长」
 * 时才走 appendPreparedDrawingEntry，其余情况全量重建。本测试用真实 core API 固化该依赖：
 *  - 单条/多条追加的增量结果必须与一次性全量重建产生一致的可见 frame；
 *  - 旧 prepared / spatial index 与旧 frame 在追加后保持不变（不可变前缀复用）；
 *  - 几何无效的追加只前进 strokeCount 并保留索引，frame 仍可构建。
 */
import {
  appendPreparedDrawingEntry,
  createPreparedDrawingSpatialIndex,
  prepareDrawingDocument,
  tryCreateDrawingFrame,
  type DrawingStrokeV2,
  type DrawingValueV2,
  type PreparedDrawingSpatialIndex,
} from '@hamster-note/painting/core';

const VIEWPORT = { scale: 1, tx: 0, ty: 0 } as const;
const LAYOUT_SIZE = { width: 200, height: 200 } as const;

/** 水平线段：y 决定其是否落在 frame 可见范围。 */
function line(id: string, y: number): DrawingStrokeV2 {
  return {
    schemaVersion: 2,
    id,
    tool: 'line',
    points: [
      { x: 0, y },
      { x: 120, y },
    ],
    strokeColor: '#000000',
    strokeWidth: 2,
  };
}

function documentWith(strokes: readonly DrawingStrokeV2[]): DrawingValueV2 {
  return { schemaVersion: 2, strokes: [...strokes] };
}

function visibleIds(spatialIndex: PreparedDrawingSpatialIndex): readonly string[] {
  const outcome = tryCreateDrawingFrame({
    prepared: spatialIndex.prepared,
    spatialIndex,
    viewport: VIEWPORT,
    layoutSize: LAYOUT_SIZE,
  });
  if (!outcome.ok) throw new Error('frame 构建失败');
  return outcome.frame.visibleEntries.map((entry) => entry.source.stroke.id);
}

describe('candidate pipeline incremental append contract', () => {
  it('单条追加与全量重建产生一致 frame，且旧快照保持不可变', () => {
    const base = documentWith([line('a', 20), line('b', 60)]);
    const prepared = prepareDrawingDocument(base);
    const spatialIndex = createPreparedDrawingSpatialIndex(prepared);
    const before = JSON.stringify(prepared);
    const baseVisible = visibleIds(spatialIndex);

    const appended = appendPreparedDrawingEntry(spatialIndex, line('c', 100));
    const appendedVisible = visibleIds(appended);

    const full = createPreparedDrawingSpatialIndex(
      prepareDrawingDocument(documentWith([line('a', 20), line('b', 60), line('c', 100)]))
    );
    const fullVisible = visibleIds(full);

    expect(appendedVisible).toEqual(fullVisible);
    expect(appendedVisible).toEqual(['a', 'b', 'c']);
    // 旧 prepared 未被修改；新快照复用旧 entry 引用（严格前缀复用）。
    expect(JSON.stringify(prepared)).toBe(before);
    expect(appended.prepared.entries[0]).toBe(prepared.entries[0]);
    expect(appended.prepared.entries[1]).toBe(prepared.entries[1]);
    // 旧 index 仍只覆盖基线段，追加不污染旧 frame 的可见集合。
    expect(baseVisible).toEqual(['a', 'b']);
    expect(appended.preparedRevision).toBe(appended.prepared.revision);
  });

  it('多条链式追加与全量重建一致（含索引压平路径）', () => {
    const strokes = [line('s0', 10), line('s1', 30), line('s2', 50), line('s3', 70)];
    const full = createPreparedDrawingSpatialIndex(prepareDrawingDocument(documentWith(strokes)));

    let incremental = createPreparedDrawingSpatialIndex(
      prepareDrawingDocument(documentWith([] as DrawingStrokeV2[]))
    );
    for (const stroke of strokes) {
      incremental = appendPreparedDrawingEntry(incremental, stroke, { maxDeltaDepth: 2 });
    }

    expect(visibleIds(incremental)).toEqual(visibleIds(full));
  });

  it('几何无效的追加只前进 strokeCount 并保留索引，frame 仍可构建', () => {
    const base = documentWith([line('kept', 40)]);
    const spatialIndex = createPreparedDrawingSpatialIndex(prepareDrawingDocument(base));

    const invalid: DrawingStrokeV2 = {
      schemaVersion: 2,
      id: 'bad',
      tool: 'pen',
      points: [{ x: 0, y: 0 }],
    };
    const appended = appendPreparedDrawingEntry(spatialIndex, invalid);

    expect(appended.prepared.strokeCount).toBe(2);
    expect(appended.prepared.diagnostics).toEqual([{ type: 'invalid-geometry', index: 1 }]);
    expect(appended.index).toBe(spatialIndex.index);
    expect(visibleIds(appended)).toEqual(['kept']);
  });
});
