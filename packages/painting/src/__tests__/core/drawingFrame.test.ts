/** @jest-environment node */

import {
  appendPreparedDrawingEntry,
  createDrawingFrame,
  createPreparedDrawingSpatialIndex,
  hitTestDrawingFrame,
  prepareDrawingDocument,
  tryCreateDrawingFrame,
  type DrawingStrokeV2,
} from '../../core/internal';

function line(id: string, x: number, y = 0): DrawingStrokeV2 {
  return {
    schemaVersion: 2,
    id,
    tool: 'line',
    points: [
      { x, y },
      { x: x + 10, y },
    ],
  };
}

function frameFor(
  strokes: DrawingStrokeV2[],
  viewport = { scale: 1, tx: 0, ty: 0 },
  layoutSize = { width: 100, height: 100 },
  cullGuardScreenDip?: number
) {
  const prepared = prepareDrawingDocument({ schemaVersion: 2, strokes });
  const spatialIndex = createPreparedDrawingSpatialIndex(prepared);
  return createDrawingFrame({
    prepared,
    spatialIndex,
    viewport,
    layoutSize,
    ...(cullGuardScreenDip === undefined ? {} : { cullGuardScreenDip }),
  });
}

describe('core/drawingFrame', () => {
  it('culls by visible global bounds and returns entries after pan restores them', () => {
    const strokes = [line('near', 10), line('far', 1_000)];
    const initial = frameFor(strokes)!;
    const panned = frameFor(strokes, { scale: 1, tx: -1_000, ty: 0 })!;

    expect(initial.visibleEntries.map(({ source }) => source.stroke.id)).toEqual(['near']);
    expect(panned.visibleEntries.map(({ source }) => source.stroke.id)).toEqual(['far']);
  });

  it('rejects a spatial index bound to another prepared revision and invalid values without a fallback', () => {
    const first = prepareDrawingDocument({ schemaVersion: 2, strokes: [line('one', 0)] });
    const second = prepareDrawingDocument({ schemaVersion: 2, strokes: [line('two', 0)] });
    const index = createPreparedDrawingSpatialIndex(first);
    const mismatch = tryCreateDrawingFrame({
      prepared: second,
      spatialIndex: index,
      viewport: { scale: 1, tx: 0, ty: 0 },
      layoutSize: { width: 10, height: 10 },
    });
    const invalid = tryCreateDrawingFrame({
      prepared: first,
      spatialIndex: index,
      viewport: { scale: Number.NaN, tx: 0, ty: 0 },
      layoutSize: { width: 10, height: 10 },
    });

    expect(mismatch).toEqual({ ok: false, diagnostics: [{ type: 'prepared-index-mismatch' }] });
    expect(invalid).toEqual({
      ok: false,
      diagnostics: [{ type: 'invalid-input', field: 'viewport' }],
    });
  });

  it('rejects a copied prepared snapshot even when a caller copies its revision value', () => {
    const prepared = prepareDrawingDocument({ schemaVersion: 2, strokes: [line('one', 0)] });
    const copied = Object.freeze({
      ...prepared,
      entries: prepared.entries,
      diagnostics: prepared.diagnostics,
    });
    const result = tryCreateDrawingFrame({
      prepared: copied,
      spatialIndex: createPreparedDrawingSpatialIndex(prepared),
      viewport: { scale: 1, tx: 0, ty: 0 },
      layoutSize: { width: 10, height: 10 },
    });

    expect(result).toEqual({ ok: false, diagnostics: [{ type: 'prepared-index-mismatch' }] });
  });

  it.each([0.25, 1, 8])('preserves affine equality for 1e9 rebasing at scale %s', (scale) => {
    const global = 1_000_000_000.125;
    const frame = frameFor([line('large', global, global)], {
      scale,
      tx: -global * scale,
      ty: -global * scale,
    })!;
    const entry = frame.visibleEntries[0];
    const local = entry.geometry.kind === 'path' ? entry.geometry.points[0] : null;
    const globalScreen = {
      x: frame.globalToScreen.a * global + frame.globalToScreen.tx,
      y: frame.globalToScreen.d * global + frame.globalToScreen.ty,
    };
    const localScreen = {
      x: frame.localToScreen.a * local!.x + frame.localToScreen.tx,
      y: frame.localToScreen.d * local!.y + frame.localToScreen.ty,
    };

    expect(localScreen.x).toBeCloseTo(globalScreen.x, 7);
    expect(localScreen.y).toBeCloseTo(globalScreen.y, 7);
  });

  it('changes origin while keeping rendered screen positions stable and never mutates the document', () => {
    const original = line('immutable', 1_000_000_000.125, 5);
    const before = JSON.parse(JSON.stringify(original));
    const first = frameFor([original], { scale: 1, tx: -1_000_000_000, ty: 0 })!;
    const second = frameFor(
      [original],
      { scale: 1, tx: -1_000_000_000, ty: 0 },
      { width: 200, height: 100 }
    )!;
    const firstPoint =
      first.visibleEntries[0].geometry.kind === 'path'
        ? first.visibleEntries[0].geometry.points[0]
        : null;
    const secondPoint =
      second.visibleEntries[0].geometry.kind === 'path'
        ? second.visibleEntries[0].geometry.points[0]
        : null;

    expect(first.frameOrigin).not.toEqual(second.frameOrigin);
    expect(first.localToScreen.a * firstPoint!.x + first.localToScreen.tx).toBeCloseTo(0.125, 7);
    expect(second.localToScreen.a * secondPoint!.x + second.localToScreen.tx).toBeCloseTo(0.125, 7);
    expect(original).toEqual(before);
  });

  it('flags local coordinates requiring clipping and resolves topmost duplicate-ID hits from visible entries', () => {
    const bottom = line('duplicate', 0, 0);
    const top = line('duplicate', 0, 2);
    const visible = frameFor([bottom, top])!;
    const clipping = frameFor(
      [
        {
          schemaVersion: 2,
          id: 'wide',
          tool: 'line',
          points: [
            { x: 0, y: 0 },
            { x: 2_000_002, y: 0 },
          ],
        },
      ],
      { scale: 1, tx: 0, ty: 0 },
      { width: 2_000_000, height: 20 }
    )!;

    expect(hitTestDrawingFrame(visible, { x: 5, y: 2 }, 1)?.entry.source.order).toBe(1);
    expect(visible.visibleEntries.map(({ source }) => source.key)).toEqual([0, 1]);
    // 全部安全时 renderable 与 visible 一致。
    expect(visible.renderableEntries.map(({ source }) => source.key)).toEqual([0, 1]);
    expect(visible.unsafeEntryKeys).toEqual([]);
    expect(visible.requiresClipping).toBe(false);
    // unsafe entry 仍保留在可审计的 visibleEntries，但被排除出 renderableEntries。
    expect(clipping.requiresClipping).toBe(true);
    expect(clipping.visibleEntries.map(({ source }) => source.key)).toEqual([0]);
    // 2m 宽 layout 本身会把最终 screen 值推过 1e6 的硬预算，因此明确 unresolved，
    // 而非输出超预算 fragment；常规 viewport 下的超长 path 裁剪由下方专门用例覆盖。
    expect(clipping.renderableEntries).toEqual([]);
    expect(clipping.unsafeEntryKeys).toEqual([0]);
    expect(clipping.hasUnresolvedClipping).toBe(true);
    expect(clipping.diagnostics).toContainEqual({
      type: 'unresolved-clipping',
      entryKey: 0,
      reason: 'unsafe-number',
    });
  });

  it('never hits an index candidate absent from frame.visibleEntries and reuses the same local geometry', () => {
    // near 进入可见集；far 在默认 guard 下被 cull，不在同一帧 visibleEntries 内。
    const strokes = [line('near', 10), line('far', 500)];
    const frame = frameFor(strokes)!;
    expect(frame.visibleEntries.map(({ source }) => source.stroke.id)).toEqual(['near']);

    // far 的全局线段位于 (500,0)-(510,0)：屏幕 (505,0) 的索引查询会召回 far 候选。
    // 若像旧实现那样重建 geometry，该点恰好落在线段上必然命中；现在候选不在本帧
    // visibleEntries 内，必须不命中（证明未重建、未返回）。
    expect(hitTestDrawingFrame(frame, { x: 505, y: 0 }, 1)).toBeNull();

    // 正常命中返回的必须是 frame.visibleEntries 中的同一对象与同一份 local geometry。
    const hit = hitTestDrawingFrame(frame, { x: 15, y: 0 }, 1);
    expect(hit).not.toBeNull();
    expect(frame.visibleEntries).toContain(hit!.entry);
    expect(hit!.entry.geometry).toBe(frame.visibleEntries[0].geometry);
  });

  it('keeps tolerance beyond the cull guard correct by only hitting the same frame visible set', () => {
    // edge 的保守 bounds 从 x=102 起；默认 guard=1 时未进入可见世界 AABB [−1,101]，被 cull。
    const strokes = [line('near', 10), line('edge', 103)];
    const defaultGuard = frameFor(strokes)!;
    expect(defaultGuard.visibleEntries.map(({ source }) => source.stroke.id)).toEqual(['near']);

    // tolerance=3 已超出默认 cull guard：查询会召回 edge 候选，但候选不在本帧可见集内 → 不命中。
    expect(hitTestDrawingFrame(defaultGuard, { x: 100, y: 0 }, 3)).toBeNull();

    // 构帧时预留 guard=3：edge 进入同一帧 visibleEntries，同一命中在 3 DIP 容差内成立。
    const reserved = frameFor(strokes, { scale: 1, tx: 0, ty: 0 }, { width: 100, height: 100 }, 3)!;
    expect(reserved.visibleEntries.map(({ source }) => source.stroke.id)).toEqual(['near', 'edge']);
    const hit = hitTestDrawingFrame(reserved, { x: 100, y: 0 }, 3);
    expect(hit?.entry.source.stroke.id).toBe('edge');
  });

  it('excludes only the unsafe entry from renderable/hit while keeping safe visible entries and never mutating the document', () => {
    const safe = line('safe', 10);
    const unsafe: DrawingStrokeV2 = {
      schemaVersion: 2,
      id: 'unsafe',
      tool: 'line',
      points: [
        { x: 0, y: 0 },
        { x: 2_000_002, y: 0 },
      ],
    };
    const before = JSON.parse(JSON.stringify([safe, unsafe]));
    const frame = frameFor(
      [safe, unsafe],
      { scale: 1, tx: 0, ty: 0 },
      { width: 2_000_000, height: 20 }
    )!;

    // 一条 unsafe entry 不会清空安全 visible / renderable 对象。
    expect(frame.visibleEntries.map(({ source }) => source.stroke.id)).toEqual(['safe', 'unsafe']);
    expect(frame.renderableEntries.map(({ source }) => source.stroke.id)).toEqual(['safe']);
    // diagnostics / requiresClipping 逐条准确。
    expect(frame.requiresClipping).toBe(true);
    expect(frame.unsafeEntryKeys).toEqual([1]);
    expect(frame.diagnostics).toEqual([
      { type: 'unresolved-clipping', entryKey: 1, reason: 'unsafe-number' },
    ]);
    // renderable 与 visible 对安全对象复用同一 entry / 同一 local geometry，不重建。
    expect(frame.visibleEntries[0]).toBe(frame.renderableEntries[0]);

    // 安全对象可命中，且命中的是 renderable 集合内的同一份 geometry。
    const safeHit = hitTestDrawingFrame(frame, { x: 15, y: 0 }, 1);
    expect(safeHit?.entry.source.stroke.id).toBe('safe');
    expect(frame.renderableEntries).toContain(safeHit!.entry);
    // unsafe 自身在屏幕命中为 null（其可见候选被逐条排除，不 fallback 重建）。
    expect(hitTestDrawingFrame(frame, { x: 1_000_000, y: 0 }, 1)).toBeNull();

    // 不可变性：构帧不修改 document。
    expect([safe, unsafe]).toEqual(before);
  });

  it('preserves topmost, duplicate-ID and tolerance hit semantics', () => {
    const bottom = line('duplicate', 0, 0);
    const top = line('duplicate', 0, 2);
    const frame = frameFor([bottom, top])!;

    // topmost：同 stroke.id 但 key 不同，命中最高 order。
    expect(hitTestDrawingFrame(frame, { x: 5, y: 2 }, 1)?.entry.source.order).toBe(1);
    // 容差命中：2 DIP 外、3 DIP 内命中；超出容差不命中。
    expect(hitTestDrawingFrame(frame, { x: 5, y: 5 }, 3)?.entry.source.order).toBe(1);
    expect(hitTestDrawingFrame(frame, { x: 5, y: 6 }, 3)).toBeNull();
    // 严格 finite：非有限屏幕点 / 负 tolerance 不命中。
    expect(hitTestDrawingFrame(frame, { x: Number.NaN, y: 0 }, 1)).toBeNull();
    expect(hitTestDrawingFrame(frame, { x: 5, y: 2 }, -1)).toBeNull();
  });

  it('hits the correct renderable entry for zero-tolerance points at frame origin and negative cell boundaries', () => {
    // 默认 scale=1 / tx=ty=0 时 frameOrigin=(50,50)，screen==global，便于直接推演 global 点。
    const throughOrigin: DrawingStrokeV2 = {
      schemaVersion: 2,
      id: 'origin',
      tool: 'line',
      points: [
        { x: 40, y: 50 },
        { x: 60, y: 50 },
      ],
    };
    // 该线横跨负 cell：其 bounds minX=-21 → cell -1，查询点 global x=-10 也落在 cell -1。
    const negativeCell: DrawingStrokeV2 = {
      schemaVersion: 2,
      id: 'negative',
      tool: 'line',
      points: [
        { x: -20, y: 0 },
        { x: 20, y: 0 },
      ],
    };
    const frame = frameFor([throughOrigin, negativeCell])!;
    expect(frame.frameOrigin).toEqual({ x: 50, y: 50 });
    expect(frame.renderableEntries.map(({ source }) => source.stroke.id)).toEqual([
      'origin',
      'negative',
    ]);

    // 零容差在 frame origin 对应的 global 点命中本帧 renderable entry。
    const originHit = hitTestDrawingFrame(frame, { x: 50, y: 50 }, 0);
    expect(originHit?.entry.source.stroke.id).toBe('origin');
    expect(frame.renderableEntries).toContain(originHit!.entry);

    // global (-10,0) 落在本帧 screen/guard 外：新的 fragment-only 命中不重建 canonical
    // geometry，因此不再产生画面外 ghost hit。
    expect(hitTestDrawingFrame(frame, { x: -10, y: 0 }, 0)).toBeNull();

    // tolerance>0 仍走既有 bounds query，命中语义不变。
    expect(hitTestDrawingFrame(frame, { x: 50, y: 50 }, 1)?.entry.source.stroke.id).toBe('origin');
  });

  it('treats zero-tolerance point queries as half-open on the max edge', () => {
    // strokeWidth=0 且对角线走向：语义 bounds 与几何端点重合，便于直接验证半开点包含。
    // （轴对齐零宽线会退化出横/纵零高度轴，此处刻意避开。）
    const zeroWidth: DrawingStrokeV2 = {
      schemaVersion: 2,
      id: 'zero-width',
      tool: 'line',
      strokeWidth: 0,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    };
    const frame = frameFor([zeroWidth])!;
    expect(frame.renderableEntries.map(({ source }) => source.stroke.id)).toEqual(['zero-width']);

    // min 端点 (0,0)：min 边闭合，零容差命中。
    expect(hitTestDrawingFrame(frame, { x: 0, y: 0 }, 0)?.entry.source.stroke.id).toBe(
      'zero-width'
    );

    // max 端点 (10,10)：max 边半开，queryPoint 不召回该对象 → 零容差不命中。
    expect(hitTestDrawingFrame(frame, { x: 10, y: 10 }, 0)).toBeNull();

    // 对照：tolerance>0 时 bounds query 会召回该对象，几何在 (10,10) 处本就距离为 0，
    // 证明上面的 null 来自半开点包含而非几何判定。
    expect(hitTestDrawingFrame(frame, { x: 10, y: 10 }, 0.5)?.entry.source.stroke.id).toBe(
      'zero-width'
    );
  });

  it('keeps zero-tolerance hits restricted to the frame renderable set for unsafe and culled entries', () => {
    // unsafe entry 的 global 点落在其索引 bounds 内，但 local geometry 超 maxLocalCoordinate，
    // 被逐条排除出 renderableEntries；零容差点查询仍不得命中，避免 ghost hit。
    const safe = line('safe', 20, 5);
    const unsafe: DrawingStrokeV2 = {
      schemaVersion: 2,
      id: 'unsafe',
      tool: 'line',
      points: [
        { x: 0, y: 0 },
        { x: 2_000_002, y: 0 },
      ],
    };
    const frame = frameFor(
      [safe, unsafe],
      { scale: 1, tx: 0, ty: 0 },
      { width: 2_000_000, height: 20 }
    )!;
    expect(frame.renderableEntries.map(({ source }) => source.stroke.id)).toEqual(['safe']);
    // frameOrigin=(1_000_000,10)，global (1_000_000,0) 映射为 screen (1_000_000,0)，位于 unsafe 线上。
    expect(hitTestDrawingFrame(frame, { x: 1_000_000, y: 0 }, 0)).toBeNull();
    // 同帧安全对象零容差仍可命中。
    expect(hitTestDrawingFrame(frame, { x: 20, y: 5 }, 0)?.entry.source.stroke.id).toBe('safe');

    // 非本帧（被 cull guard 排除）的远处对象：其 global 点可被 queryPoint 召回，
    // 但不在 renderableEntries 内，零容差也不得命中。
    const culled = frameFor([line('near', 10), line('far', 500)])!;
    expect(culled.visibleEntries.map(({ source }) => source.stroke.id)).toEqual(['near']);
    expect(hitTestDrawingFrame(culled, { x: 505, y: 0 }, 0)).toBeNull();
  });

  it('clips a multi-million global path before rebasing, preserves prepared/index snapshots and shares fragments with hit testing', () => {
    const stroke: DrawingStrokeV2 = {
      schemaVersion: 2,
      id: 'crossing',
      tool: 'pen',
      points: [
        { x: -2_000_000, y: 50, pressure: 0.1 },
        { x: 10, y: 50, pressure: 0.2 },
        { x: 2_000_000, y: 50, pressure: 0.8 },
        { x: 10, y: 60, pressure: 0.4 },
        { x: -2_000_000, y: 60, pressure: 0.3 },
      ],
    };
    const prepared = prepareDrawingDocument({ schemaVersion: 2, strokes: [stroke] });
    const spatialIndex = createPreparedDrawingSpatialIndex(prepared);
    const preparedBefore = JSON.stringify(prepared);
    const indexEntry = spatialIndex.index.query({
      minX: -2_000_001,
      minY: -1,
      maxX: 2_000_001,
      maxY: 101,
    })[0].value;
    const frame = createDrawingFrame({
      prepared,
      spatialIndex,
      viewport: { scale: 1, tx: 0, ty: 0 },
      layoutSize: { width: 100, height: 100 },
    })!;
    const entry = frame.renderableEntries[0];
    const strokes = entry.fragments.filter((fragment) => fragment.kind === 'stroke');

    expect(JSON.stringify(prepared)).toBe(preparedBefore);
    expect(
      spatialIndex.index.query({ minX: -2_000_001, minY: -1, maxX: 2_000_001, maxY: 101 })[0].value
    ).toBe(indexEntry);
    expect(entry.status).toBe('segmented');
    expect(entry.canonicalLocalGeometry).toBeNull();
    expect(strokes).toHaveLength(4);
    expect(
      strokes.every((fragment) =>
        fragment.points.every(
          (point) => Math.abs(point.x) <= 1_000_000 && Math.abs(point.y) <= 1_000_000
        )
      )
    ).toBe(true);
    expect(strokes.map((fragment) => fragment.sourceSegmentIndex)).toEqual([0, 1, 2, 3]);
    expect(strokes[0].sourcePressures).toEqual({
      start: expect.any(Number),
      end: expect.any(Number),
    });
    expect(hitTestDrawingFrame(frame, { x: 50, y: 50 }, 0)?.entry).toBe(entry);
    // 两条进入/离开轨迹之间没有原始线段，不能因 fragment 收集而被错误桥接。
    expect(hitTestDrawingFrame(frame, { x: 50, y: 55 }, 0)).toBeNull();
  });

  it.each([0.25, 1, 8])(
    'recalls a round-capped thick stroke whose centerline starts outside the viewport at scale %s',
    (scale) => {
      // centerline 比 viewport 右边缘多 2 屏幕 DIP；40 world DIP 描边仍会进入画面。
      const centerX = 102 / scale;
      const frame = frameFor(
        [
          {
            schemaVersion: 2,
            id: 'thick-edge',
            tool: 'line',
            strokeWidth: 40,
            points: [
              { x: centerX, y: 50 / scale },
              { x: 130 / scale, y: 50 / scale },
            ],
          },
        ],
        { scale, tx: 0, ty: 0 }
      )!;
      const entry = frame.renderableEntries[0];

      expect(entry).toBeDefined();
      expect(entry.fragments.some((fragment) => fragment.kind === 'stroke')).toBe(true);
      // hit 同 renderable fragment 和其有效描边宽度，不会因中心线在 viewport 外漏掉圆端帽。
      expect(hitTestDrawingFrame(frame, { x: 100, y: 50 }, 0)?.entry).toBe(entry);
    }
  );

  it.each([
    [0.1, 0.25],
    [9, 8],
  ])(
    'uses normalized global affine scale %s -> %s for visual clip outset without mutating the viewport',
    (rawScale, normalizedScale) => {
      const viewport = Object.freeze({ scale: rawScale, tx: 0, ty: 0 });
      const stroke: DrawingStrokeV2 = {
        schemaVersion: 2,
        id: `normalized-${rawScale}`,
        tool: 'line',
        strokeWidth: 40,
        // 端帽中心位于右边缘外 4.5 screen DIP，仍应由 20 world DIP 半径召回。
        points: [
          { x: 104.5 / normalizedScale, y: 50 / normalizedScale },
          { x: 130 / normalizedScale, y: 50 / normalizedScale },
        ],
      };
      const frame = frameFor([stroke], viewport)!;

      expect(frame.globalToScreen.a).toBe(normalizedScale);
      expect(frame.renderableEntries).toHaveLength(1);
      expect(hitTestDrawingFrame(frame, { x: 100, y: 50 }, 0)?.entry).toBe(
        frame.renderableEntries[0]
      );
      expect(viewport).toEqual({ scale: rawScale, tx: 0, ty: 0 });
    }
  );

  it('keeps source endpoint pressure for a locally clipped pressure segment and records clip pressure only for audit', () => {
    const frame = frameFor([
      {
        schemaVersion: 2,
        id: 'pressure',
        tool: 'pen',
        strokeWidth: 20,
        points: [
          { x: -100, y: 50, pressure: 0.1 },
          { x: 50, y: 50, pressure: 0.9 },
          { x: 200, y: 50, pressure: 0.2 },
        ],
      },
    ])!;
    const strokes = frame.renderableEntries[0].fragments.filter(
      (fragment) => fragment.kind === 'stroke'
    );

    expect(strokes).toHaveLength(2);
    expect(strokes[0].sourcePressures).toEqual({ start: 0.1, end: 0.9 });
    expect(strokes[1].sourcePressures).toEqual({ start: 0.9, end: 0.2 });
    expect(strokes[0].clip?.insertedPressures.start).toBeGreaterThan(0.1);
    expect(strokes[0].clip?.insertedPressures.start).toBeLessThan(0.9);
    expect(strokes[1].clip?.insertedPressures.end).toBeGreaterThan(0.2);
    expect(strokes[1].clip?.insertedPressures.end).toBeLessThan(0.9);
    // 高压的第一个 source segment 保持其 10 world DIP 半径，而非使用 clip 起点的插值 pressure。
    expect(hitTestDrawingFrame(frame, { x: 0, y: 58 }, 0)?.entry).toBe(frame.renderableEntries[0]);
  });

  it('uses only pen source end pressure for hit width, including a clipped fragment', () => {
    const narrowEnd = frameFor([
      {
        schemaVersion: 2,
        id: 'narrow-end',
        tool: 'pen',
        strokeWidth: 20,
        points: [
          { x: 10, y: 50, pressure: 1 },
          { x: 90, y: 50, pressure: 0.1 },
        ],
      },
    ])!;
    // 仅落在 start=1 的大宽度、end=.1 的小宽度差区：不得取两端最大值。
    expect(hitTestDrawingFrame(narrowEnd, { x: 50, y: 55 }, 0)).toBeNull();

    const clippedMissingStart = frameFor([
      {
        schemaVersion: 2,
        id: 'clipped-missing-start',
        tool: 'pen',
        strokeWidth: 20,
        points: [
          { x: -100, y: 50 },
          { x: 50, y: 50, pressure: 0.25 },
        ],
      },
    ])!;
    const fragment = clippedMissingStart.renderableEntries[0].fragments.find(
      (item) => item.kind === 'stroke'
    )!;
    expect(fragment.sourcePressures).toEqual({ end: 0.25 });
    // 裁剪点没有可用 source start pressure，插值审计值不得参与命中半径。
    expect(fragment.clip?.insertedPressures.start).toBeUndefined();
    expect(hitTestDrawingFrame(clippedMissingStart, { x: 0, y: 54 }, 0)).toBeNull();
  });

  it('coalesces ordinary contiguous paths and closed contours into runs without bridging clipped gaps', () => {
    const ordinary = frameFor([
      {
        schemaVersion: 2,
        id: 'ordinary-run',
        tool: 'pen',
        points: [
          { x: 10, y: 50 },
          { x: 30, y: 50 },
          { x: 50, y: 50 },
          { x: 70, y: 50 },
        ],
      },
    ])!;
    const ordinaryStroke = ordinary.renderableEntries[0].fragments.find(
      (fragment) => fragment.kind === 'stroke'
    )!;
    expect(ordinaryStroke).toMatchObject({
      closed: false,
      sourceSegmentStart: 0,
      sourceSegmentEnd: 2,
    });
    expect(ordinaryStroke.points).toHaveLength(4);

    const clipped = frameFor([
      {
        schemaVersion: 2,
        id: 'split-run',
        tool: 'pen',
        points: [
          { x: -100, y: 20 },
          { x: 50, y: 20 },
          { x: 200, y: 20 },
          { x: 50, y: 80 },
          { x: -100, y: 80 },
        ],
      },
    ])!;
    const clippedStrokes = clipped.renderableEntries[0].fragments.filter(
      (fragment) => fragment.kind === 'stroke'
    );
    expect(clippedStrokes).toHaveLength(2);
    expect(clippedStrokes.every((fragment) => fragment.points.length === 3)).toBe(true);
    expect(hitTestDrawingFrame(clipped, { x: 50, y: 50 }, 0)).toBeNull();
  });

  it.each([0.25, 1, 8])(
    'keeps normal 1e9+.125 geometry rebased and within the screen budget at scale %s',
    (scale) => {
      const global = 1_000_000_000.125;
      const frame = frameFor([line('normal', global, global)], {
        scale,
        tx: -global * scale,
        ty: -global * scale,
      })!;
      const entry = frame.renderableEntries[0];
      expect(entry.status).toBe('rebased');
      expect(
        entry.fragments.every((fragment) =>
          fragment.points.every(
            (point) => Math.abs(point.x) <= 1_000_000 && Math.abs(point.y) <= 1_000_000
          )
        )
      ).toBe(true);
      expect(hitTestDrawingFrame(frame, { x: 0.125, y: 0.125 }, 1)?.entry).toBe(entry);
    }
  );

  it('uses overflow-resistant same-sign frame origins and rejects unsafe 2^53 canonical coordinates', () => {
    const huge = 1e308;
    const prepared = prepareDrawingDocument({ schemaVersion: 2, strokes: [line('huge', huge, 0)] });
    const frame = createDrawingFrame({
      prepared,
      spatialIndex: createPreparedDrawingSpatialIndex(prepared),
      viewport: { scale: 1, tx: -huge, ty: 0 },
      layoutSize: { width: 10, height: 10 },
    });
    expect(frame?.frameOrigin.x).toBe(huge);

    const boundary = 2 ** 53;
    const unsafe = frameFor(
      [
        {
          schemaVersion: 2,
          id: 'unsafe-precision',
          tool: 'line',
          points: [
            { x: boundary, y: 0 },
            { x: boundary + 2, y: 0 },
          ],
        },
      ],
      { scale: 1, tx: -boundary, ty: 0 }
    )!;
    expect(unsafe.hasUnresolvedClipping).toBe(true);
    expect(unsafe.renderableEntries).toEqual([]);
    expect(hitTestDrawingFrame(unsafe, { x: 0, y: 0 }, 0)).toBeNull();
  });

  it.each([0.25, 1, 8])(
    'keeps partial cubic and rotated ellipse finite, bounded and hittable at scale %s around 1e9+.125',
    (scale) => {
      const global = 1_000_000_000.125;
      const strokes: DrawingStrokeV2[] = [
        {
          schemaVersion: 2,
          id: 'partial-cubic',
          tool: 'bezier',
          points: [
            { x: global - 200, y: global + 50 },
            { x: global - 100, y: global - 200 },
            { x: global + 100, y: global + 300 },
            { x: global + 200, y: global + 50 },
          ],
        },
        {
          schemaVersion: 2,
          id: 'partial-ellipse',
          tool: 'ellipse',
          rotationRad: Math.PI / 5,
          points: [
            { x: global - 180, y: global - 120 },
            { x: global + 180, y: global + 120 },
          ],
        },
      ];
      // cubic 的中心可见分支在 global+50；所有 scale 均以该分支作为 screen 中心。
      const frame = frameFor(strokes, { scale, tx: -global * scale, ty: -(global + 50) * scale })!;

      expect(frame.renderableEntries).toHaveLength(2);
      for (const entry of frame.renderableEntries) {
        expect(entry.status).not.toBe('unresolved');
        expect(
          entry.program.strokes
            .flatMap((stroke) => stroke.points)
            .every(
              (point) =>
                Number.isFinite(point.x) &&
                Number.isFinite(point.y) &&
                Math.abs(point.x) <= frame.maxLocalCoordinate &&
                Math.abs(point.y) <= frame.maxLocalCoordinate
            )
        ).toBe(true);
        expect(
          entry.program.fills
            .flatMap((fill) => fill.polygons)
            .every((polygon) =>
              polygon.outer.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
            )
        ).toBe(true);
      }
      const ellipse = frame.renderableEntries.find(
        (entry) => entry.source.stroke.id === 'partial-ellipse'
      )!;
      const ellipseBoundary = ellipse.program.fills[0].polygons[0].outer[0];
      const ellipseScreenPoint = {
        x:
          frame.localToScreen.a * ellipseBoundary.x +
          frame.localToScreen.c * ellipseBoundary.y +
          frame.localToScreen.tx,
        y:
          frame.localToScreen.b * ellipseBoundary.x +
          frame.localToScreen.d * ellipseBoundary.y +
          frame.localToScreen.ty,
      };
      expect(hitTestDrawingFrame(frame, ellipseScreenPoint, 0.1)?.entry).toBe(ellipse);
    }
  );

  it('keeps the document and prepared checksum unchanged across pan-away/back frames', () => {
    const document = {
      schemaVersion: 2 as const,
      strokes: [
        {
          schemaVersion: 2 as const,
          id: 'compound',
          tool: 'polygon' as const,
          fillColor: '#000',
          points: [
            { x: -20, y: 10 },
            { x: 90, y: 10 },
            { x: 90, y: 90 },
            { x: 50, y: 50 },
            { x: -20, y: 90 },
          ],
        },
      ],
    };
    const prepared = prepareDrawingDocument(document);
    const index = createPreparedDrawingSpatialIndex(prepared);
    const documentChecksum = JSON.stringify(document);
    const preparedChecksum = JSON.stringify(prepared);
    const first = createDrawingFrame({
      prepared,
      spatialIndex: index,
      viewport: { scale: 1, tx: 0, ty: 0 },
      layoutSize: { width: 100, height: 100 },
    })!;
    const away = createDrawingFrame({
      prepared,
      spatialIndex: index,
      viewport: { scale: 1, tx: -10_000, ty: 0 },
      layoutSize: { width: 100, height: 100 },
    })!;
    const back = createDrawingFrame({
      prepared,
      spatialIndex: index,
      viewport: { scale: 1, tx: 0, ty: 0 },
      layoutSize: { width: 100, height: 100 },
    })!;

    expect(away.renderableEntries).toEqual([]);
    expect(back.renderableEntries[0].program).toEqual(first.renderableEntries[0].program);
    expect(JSON.stringify(document)).toBe(documentChecksum);
    expect(JSON.stringify(prepared)).toBe(preparedChecksum);
  });

  it('renders and hits a compound fill whose source boundary remains entirely outside the viewport', () => {
    // 凹口远离视口：所有原始边都在 frame 外，但 nonzero compound fill 完整覆盖中心视口。
    // 这类对象没有 legacy semantic-area fragment，只能由对象级 program.fills 判定 renderable。
    const compound: DrawingStrokeV2 = {
      schemaVersion: 2,
      id: 'outside-compound',
      tool: 'polygon',
      fillColor: '#000',
      strokeWidth: 0,
      points: [
        { x: -1_000, y: -1_000 },
        { x: 1_000, y: -1_000 },
        { x: 1_000, y: 1_000 },
        { x: -1_000, y: 1_000 },
        { x: -1_000, y: 600 },
        { x: 600, y: 600 },
        { x: 600, y: 400 },
        { x: -1_000, y: 400 },
      ],
    };
    const frame = frameFor([compound])!;
    const entry = frame.visibleEntries[0];

    expect(entry.fragments).toEqual([]);
    expect(entry.program.fills).toHaveLength(1);
    expect(frame.renderableEntries).toEqual([entry]);
    expect(hitTestDrawingFrame(frame, { x: 50, y: 50 }, 0)?.entry).toBe(entry);
    expect(hitTestDrawingFrame(frame, { x: 50, y: 450 }, 0)).toBeNull();

    const unresolved = frameFor(
      [
        {
          schemaVersion: 2,
          id: 'unsafe',
          tool: 'line',
          points: [
            { x: 2 ** 53, y: 0 },
            { x: 2 ** 53 + 2, y: 0 },
          ],
        },
      ],
      { scale: 1, tx: -(2 ** 53), ty: 0 }
    )!;
    expect(unresolved.renderableEntries).toEqual([]);
    expect(hitTestDrawingFrame(unresolved, { x: 0, y: 0 }, 0)).toBeNull();
  });

  it('keeps partial curves beyond 65,536 legacy contour segments bounded, hittable, and transient', () => {
    const radius = 250_000_000;
    const strokes: DrawingStrokeV2[] = [
      {
        schemaVersion: 2,
        id: 'partial-cubic-over-65k',
        tool: 'bezier',
        points: [
          { x: -radius, y: 0 },
          { x: -radius, y: radius },
          { x: radius, y: -radius },
          { x: radius, y: 0 },
        ],
      },
      {
        schemaVersion: 2,
        id: 'partial-ellipse-over-65k',
        tool: 'ellipse',
        points: [
          { x: -radius, y: -radius },
          { x: radius, y: radius },
        ],
      },
    ];
    const documentBefore = JSON.stringify(strokes);
    const prepared = prepareDrawingDocument({ schemaVersion: 2, strokes });
    const preparedBefore = JSON.stringify(prepared);
    // cubic 从中心穿过；ellipse 仅右缘小弧进入 viewport。二者的完整 .25 DIP contour
    // 均超过历史 65,536 上限，但 frame 只持有安全 local program。
    const cubicPrepared = Object.freeze({
      ...prepared,
      entries: Object.freeze([prepared.entries[0]]),
    });
    const ellipsePrepared = Object.freeze({
      ...prepared,
      entries: Object.freeze([prepared.entries[1]]),
    });
    const cubicFrame = createDrawingFrame({
      prepared: cubicPrepared,
      spatialIndex: createPreparedDrawingSpatialIndex(cubicPrepared),
      viewport: { scale: 1, tx: 0, ty: 0 },
      layoutSize: { width: 100, height: 100 },
    })!;
    const ellipseFrame = createDrawingFrame({
      prepared: ellipsePrepared,
      spatialIndex: createPreparedDrawingSpatialIndex(ellipsePrepared),
      viewport: { scale: 1, tx: -(radius - 50), ty: 0 },
      layoutSize: { width: 100, height: 100 },
    })!;

    for (const frame of [cubicFrame, ellipseFrame]) {
      expect(frame.hasUnresolvedClipping).toBe(false);
      for (const entry of frame.renderableEntries) {
        expect(entry.program.maxDeviation).toBeLessThanOrEqual(0.25);
        expect(
          entry.program.strokes
            .flatMap((stroke) => stroke.points)
            .every(
              (point) =>
                Number.isFinite(point.x) &&
                Number.isFinite(point.y) &&
                Math.abs(point.x) <= frame.maxLocalCoordinate &&
                Math.abs(point.y) <= frame.maxLocalCoordinate
            )
        ).toBe(true);
        expect(
          entry.program.fills
            .flatMap((fill) => fill.polygons)
            .every((polygon) =>
              polygon.outer.every(
                (point) =>
                  Number.isFinite(point.x) &&
                  Number.isFinite(point.y) &&
                  Math.abs(point.x) <= frame.maxLocalCoordinate &&
                  Math.abs(point.y) <= frame.maxLocalCoordinate
              )
            )
        ).toBe(true);
      }
    }
    expect(hitTestDrawingFrame(cubicFrame, { x: 0, y: 0 }, 1)?.entry.source.stroke.id).toBe(
      'partial-cubic-over-65k'
    );
    expect(hitTestDrawingFrame(cubicFrame, { x: 0, y: 2 }, 0)).toBeNull();
    expect(hitTestDrawingFrame(ellipseFrame, { x: 50, y: 0 }, 0)?.entry.source.stroke.id).toBe(
      'partial-ellipse-over-65k'
    );
    expect(hitTestDrawingFrame(ellipseFrame, { x: 101, y: 0 }, 0)).toBeNull();
    expect(JSON.stringify(strokes)).toBe(documentBefore);
    expect(JSON.stringify(prepared)).toBe(preparedBefore);
  });

  it.each([
    ['stroke width', { strokeWidth: 1_000_001 }],
    ['dash interval', { dashArray: [1_000_001, 1] }],
    ['dash phase', { dashOffset: Number.POSITIVE_INFINITY }],
  ])('excludes a frame entry whose %s exceeds the final draw budget', (_name, style) => {
    const frame = frameFor([
      {
        schemaVersion: 2,
        id: 'unsafe-style',
        tool: 'line',
        points: [
          { x: 10, y: 50 },
          { x: 90, y: 50 },
        ],
        ...style,
      },
    ]);
    expect(frame?.renderableEntries).toEqual([]);
    expect(frame?.hasUnresolvedClipping).toBe(true);
  });

  it.each([
    ['font', { tool: 'text' as const, text: 'unsafe', fontSize: 1_000_001 }],
    [
      'rotation',
      { tool: 'image' as const, src: 'memory://unsafe', rotationRad: Number.POSITIVE_INFINITY },
    ],
  ])('excludes a resource whose %s input cannot enter the draw budget', (_name, resource) => {
    const frame = frameFor([
      {
        schemaVersion: 2,
        id: 'unsafe-resource',
        points: [
          { x: 10, y: 10 },
          { x: 90, y: 90 },
        ],
        ...resource,
      } as DrawingStrokeV2,
    ]);
    expect(frame?.renderableEntries).toEqual([]);
  });

  it('keeps a scale-8 rotated resource out of Skia when its local corners are valid but final screen corners exceed the draw budget', () => {
    const frame = frameFor(
      [
        {
          schemaVersion: 2,
          id: 'scale-eight-resource',
          tool: 'text',
          text: 'do not reflow',
          fontSize: 12,
          rotationRad: Math.PI / 4,
          points: [
            { x: -200_000, y: -10 },
            { x: 200_000, y: 10 },
          ],
        },
      ],
      { scale: 8, tx: 0, ty: 0 }
    )!;
    const entry = frame.visibleEntries[0];

    // partial text 尚未具备 provider 产生的实际 glyph anchor/positions，因此明确 pending；
    // 它不会进入 Skia 或 hit，也不会把超预算完整 layout 伪装为可绘内容。
    expect(entry.status).toBe('pending');
    expect(frame.renderableEntries).toEqual([]);
    expect(frame.diagnostics).toEqual([]);
  });

  it('admits resolved shaped text only through its own semantic region for render and hit', () => {
    const prepared = prepareDrawingDocument({
      schemaVersion: 2,
      strokes: [
        {
          schemaVersion: 2,
          id: 'resolved-partial-text',
          tool: 'text',
          text: 'very large paragraph',
          fontSize: 12,
          points: [
            { x: -2_000_000, y: 0 },
            { x: 2_000_000, y: 100 },
          ],
        },
      ],
    });
    const frame = createDrawingFrame({
      prepared,
      spatialIndex: createPreparedDrawingSpatialIndex(prepared),
      viewport: { scale: 1, tx: 0, ty: 0 },
      layoutSize: { width: 100, height: 100 },
      resolveTextProgram: (request) => ({
        kind: 'shaped-runs',
        anchor: { x: 0, y: 0 },
        rotationRad: request.rotationRad,
        runs: [
          {
            glyphs: new Uint16Array([1]),
            positions: new Float32Array([0, 0]),
            typeface: {},
            font: {},
            fontReady: true,
            size: 12,
            scaleX: 1,
          },
        ],
        semanticRegions: [{ polygon: request.visiblePolygon }],
      }),
    })!;

    expect(frame.visibleEntries[0].status).toBe('clipped');
    expect(frame.renderableEntries).toEqual([frame.visibleEntries[0]]);
    expect(hitTestDrawingFrame(frame, { x: 50, y: 50 }, 0)?.entry).toBe(frame.renderableEntries[0]);
    expect(hitTestDrawingFrame(frame, { x: 110, y: 50 }, 0)).toBeNull();
  });

  it('keeps preflight-failed shaped text out of both render and hit', () => {
    const prepared = prepareDrawingDocument({
      schemaVersion: 2,
      strokes: [
        {
          schemaVersion: 2,
          id: 'preflight-failed',
          tool: 'text',
          text: 'full text retained',
          fontSize: 12,
          points: [
            { x: -2_000_000, y: 0 },
            { x: 2_000_000, y: 100 },
          ],
        },
      ],
    });
    const frame = createDrawingFrame({
      prepared,
      spatialIndex: createPreparedDrawingSpatialIndex(prepared),
      viewport: { scale: 1, tx: 0, ty: 0 },
      layoutSize: { width: 100, height: 100 },
      resolveTextProgram: (request) => ({
        kind: 'shaped-runs',
        anchor: { x: 0, y: 0 },
        rotationRad: request.rotationRad,
        runs: [
          {
            glyphs: new Uint16Array([1]),
            positions: new Float32Array([0, 0]),
            typeface: {},
            font: null,
            fontReady: false,
            size: 12,
            scaleX: 1,
          },
        ],
        semanticRegions: [{ polygon: request.visiblePolygon }],
      }),
    })!;

    expect(frame.visibleEntries[0].status).toBe('unresolved');
    expect(frame.renderableEntries).toEqual([]);
    expect(hitTestDrawingFrame(frame, { x: 50, y: 50 }, 0)).toBeNull();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])(
    'keeps a shaped text run with fontReady true but %s font out of both render and hit',
    (_name, font) => {
      const prepared = prepareDrawingDocument({
        schemaVersion: 2,
        strokes: [
          {
            schemaVersion: 2,
            id: `missing-font-${_name}`,
            tool: 'text',
            text: 'full text retained',
            fontSize: 12,
            points: [
              { x: -2_000_000, y: 0 },
              { x: 2_000_000, y: 100 },
            ],
          },
        ],
      });
      const frame = createDrawingFrame({
        prepared,
        spatialIndex: createPreparedDrawingSpatialIndex(prepared),
        viewport: { scale: 1, tx: 0, ty: 0 },
        layoutSize: { width: 100, height: 100 },
        // provider 错误地声明 fontReady 但未提供 opaque font handle；预算 gate 必须拒绝，
        // 不能把 render/hit 交给 Skia renderer 的防御性检查首次发现。
        resolveTextProgram: (request) => ({
          kind: 'shaped-runs',
          anchor: { x: 0, y: 0 },
          rotationRad: request.rotationRad,
          runs: [
            {
              glyphs: new Uint16Array([1]),
              positions: new Float32Array([0, 0]),
              typeface: {},
              font,
              fontReady: true,
              size: 12,
              scaleX: 1,
            },
          ],
          semanticRegions: [{ polygon: request.visiblePolygon }],
        }),
      })!;

      expect(frame.visibleEntries[0].status).toBe('unresolved');
      expect(frame.renderableEntries).toEqual([]);
      // 同一 semantic region 不能命中，证明 render 与 hit 共享被拒绝的语义。
      expect(hitTestDrawingFrame(frame, { x: 50, y: 50 }, 0)).toBeNull();
    }
  );

  it('keeps empty text out of render and hit even when its resource box intersects the frame', () => {
    const frame = frameFor([
      {
        schemaVersion: 2,
        id: 'empty',
        tool: 'text',
        text: '',
        fontSize: 12,
        points: [
          { x: 10, y: 10 },
          { x: 90, y: 40 },
        ],
      },
    ])!;

    expect(frame.visibleEntries[0].fragments[0]).toMatchObject({
      resourceBox: { textProgram: { kind: 'empty-text' } },
    });
    expect(frame.renderableEntries).toEqual([]);
    expect(hitTestDrawingFrame(frame, { x: 50, y: 25 }, 0)).toBeNull();
  });

  it('appends prepared entries incrementally while old index and frame stay valid', () => {
    const prepared = prepareDrawingDocument({
      schemaVersion: 2,
      strokes: [line('near', 10), line('far', 1_000)],
    });
    const spatialIndex = createPreparedDrawingSpatialIndex(prepared);
    const viewport = { scale: 1, tx: 0, ty: 0 };
    const layoutSize = { width: 100, height: 100 };
    const frame = createDrawingFrame({ prepared, spatialIndex, viewport, layoutSize })!;
    const preparedBefore = JSON.stringify(prepared);

    const appended = appendPreparedDrawingEntry(spatialIndex, line('later', 20));
    const frameAfter = createDrawingFrame({
      prepared: appended.prepared,
      spatialIndex: appended,
      viewport,
      layoutSize,
    })!;

    // 新索引满足 frame 的 identity/revision 校验，正确 cull。
    expect(frameAfter.visibleEntries.map(({ source }) => source.stroke.id)).toEqual([
      'near',
      'later',
    ]);
    expect(appended.preparedRevision).toBe(appended.prepared.revision);
    expect(appended.prepared.entries[0]).toBe(prepared.entries[0]);
    expect(appended.prepared.entries[1]).toBe(prepared.entries[1]);

    // 旧 prepared / index / frame 完全不变。
    expect(JSON.stringify(prepared)).toBe(preparedBefore);
    expect(
      spatialIndex.index
        .query({ minX: -1, minY: -1, maxX: 1_001, maxY: 101 })
        .map(({ value }) => value.stroke.id)
    ).toEqual(['near', 'far']);
    expect(frame.visibleEntries.map(({ source }) => source.stroke.id)).toEqual(['near']);
    // 新索引覆盖三条，且顺序按 document 下标升序。
    expect(
      appended.index
        .query({ minX: -1, minY: -1, maxX: 1_001, maxY: 101 })
        .map(({ value }) => value.stroke.id)
    ).toEqual(['near', 'far', 'later']);
  });

  it('appends an invalid-geometry stroke without breaking the frame contract', () => {
    const prepared = prepareDrawingDocument({ schemaVersion: 2, strokes: [line('kept', 10)] });
    const spatialIndex = createPreparedDrawingSpatialIndex(prepared);

    const appended = appendPreparedDrawingEntry(spatialIndex, {
      schemaVersion: 2,
      id: 'bad',
      tool: 'pen',
      points: [{ x: 0, y: 0 }],
    });

    expect(appended.prepared.strokeCount).toBe(2);
    expect(appended.prepared.diagnostics).toEqual([{ type: 'invalid-geometry', index: 1 }]);
    // 几何无效时索引保持不变，但 revision 前进使 frame 校验通过。
    expect(appended.index).toBe(spatialIndex.index);
    const frame = createDrawingFrame({
      prepared: appended.prepared,
      spatialIndex: appended,
      viewport: { scale: 1, tx: 0, ty: 0 },
      layoutSize: { width: 100, height: 100 },
    });
    expect(frame?.visibleEntries.map(({ source }) => source.stroke.id)).toEqual(['kept']);
  });

  it('matches a full rebuild after capped incremental appends', () => {
    const strokes = Array.from({ length: 6 }, (_, index) => line(`s${index}`, index * 15));
    const viewport = { scale: 1, tx: 0, ty: 0 };
    const layoutSize = { width: 100, height: 100 };
    const fullPrepared = prepareDrawingDocument({ schemaVersion: 2, strokes });
    const fullFrame = createDrawingFrame({
      prepared: fullPrepared,
      spatialIndex: createPreparedDrawingSpatialIndex(fullPrepared),
      viewport,
      layoutSize,
    })!;

    let incremental = createPreparedDrawingSpatialIndex(
      prepareDrawingDocument({ schemaVersion: 2, strokes: [] })
    );
    for (const item of strokes)
      incremental = appendPreparedDrawingEntry(incremental, item, { maxDeltaDepth: 2 });

    const frame = tryCreateDrawingFrame({
      prepared: incremental.prepared,
      spatialIndex: incremental,
      viewport,
      layoutSize,
    });
    expect(frame.ok).toBe(true);
    if (!frame.ok) return;
    expect(frame.frame.visibleEntries.map(({ source }) => [source.key, source.stroke.id])).toEqual(
      fullFrame.visibleEntries.map(({ source }) => [source.key, source.stroke.id])
    );
  });
});
