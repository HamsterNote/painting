/** @jest-environment node */

import { clipPreparedDrawingEntry, createDrawingFrame, createPreparedDrawingSpatialIndex, hitTestDrawingFrame, prepareDrawingDocument, type DrawingStrokeV2 } from '../../core';
import type { FrameResourceBoxFragment } from '../../core/frameClipping';

function createFrame(strokes: DrawingStrokeV2[]) {
  const prepared = prepareDrawingDocument({ schemaVersion: 2, strokes });
  return createDrawingFrame({ prepared, spatialIndex: createPreparedDrawingSpatialIndex(prepared), viewport: { scale: 1, tx: 0, ty: 0 }, layoutSize: { width: 100, height: 100 } })!;
}

describe('core/frameClipping', () => {
  it('keeps rotated rectangle fill semantic and never creates an artificial clip stroke edge', () => {
    const frame = createFrame([{
      schemaVersion: 2, id: 'rect', tool: 'rect', fillColor: '#000',
      points: [{ x: -100, y: 25 }, { x: 200, y: 75 }], rotationRad: 0,
    }]);
    const entry = frame.renderableEntries[0];
    const strokes = entry.fragments.filter((fragment) => fragment.kind === 'stroke');
    const areas = entry.fragments.filter((fragment) => fragment.kind === 'semantic-area');

    expect(entry.status).toBe('segmented');
    expect(areas).toHaveLength(1);
    // 每个 entry 以视觉描边外扩后的 clip region 裁剪，因此允许超过中心线 base region。
    expect(areas[0].points.every((point) => Math.abs(point.x) <= frame.maxLocalCoordinate && Math.abs(point.y) <= frame.maxLocalCoordinate)).toBe(true);
    // 左右人工裁剪边只允许出现在 semantic fill polygon，不能作为 rectangle boundary stroke。
    expect(strokes.some((fragment) => fragment.points[0].x === fragment.points[1].x && (fragment.points[0].x === frame.localClipRegion.minX || fragment.points[0].x === frame.localClipRegion.maxX))).toBe(false);
    expect(hitTestDrawingFrame(frame, { x: 50, y: 50 }, 0)?.entry).toBe(entry);
  });

  it('clips partial cubic/ellipse and keeps huge text pending while image remains renderable', () => {
    const frame = createFrame([
      { schemaVersion: 2, id: 'cubic', tool: 'bezier', points: [{ x: -2_000_000, y: 50 }, { x: -1_000_000, y: -2_000_000 }, { x: 1_000_000, y: 2_000_000 }, { x: 2_000_000, y: 50 }] },
      { schemaVersion: 2, id: 'ellipse', tool: 'ellipse', points: [{ x: -2_000_000, y: -2_000_000 }, { x: 2_000_000, y: 2_000_000 }] },
      // 左上内容起点在 frame 内，右侧原始 Paragraph 约束极大；有限 mapping 仍须真实可绘。
      { schemaVersion: 2, id: 'text', tool: 'text', text: 'x', fontSize: 12, points: [{ x: 0, y: 0 }, { x: 2_000_000, y: 100 }] },
      { schemaVersion: 2, id: 'image', tool: 'image', src: 'image://x', points: [{ x: -2_000_000, y: 0 }, { x: 2_000_000, y: 100 }] },
    ]);

    expect(frame.visibleEntries.map((entry) => entry.status)).toEqual(['clipped', 'clipped', 'pending', 'clipped']);
    expect(frame.renderableEntries).toHaveLength(3);
    expect(frame.hasUnresolvedClipping).toBe(false);
    const text = frame.visibleEntries.find((entry) => entry.source.stroke.tool === 'text')!;
    expect(text).toMatchObject({ status: 'pending' });
    const image = frame.renderableEntries.find((entry) => entry.source.stroke.tool === 'image')!;
    const resource = image.fragments[0];
    if (!('resourceBox' in resource)) throw new Error('massive image must retain a resource box');
    const resourceBox = (resource as FrameResourceBoxFragment).resourceBox;
    expect(resourceBox.layout.halfWidth).toBe(2_000_000);
    expect(resourceBox.visible?.polygon).toEqual(resource.points);
    expect(resourceBox.imageMapping).toMatchObject({
      source: { x: expect.any(Number), y: expect.any(Number), width: expect.any(Number), height: expect.any(Number) },
      destination: { center: { x: expect.any(Number), y: expect.any(Number) }, halfWidth: expect.any(Number), halfHeight: expect.any(Number) },
    });
    expect(Object.values(resourceBox.imageMapping!.source).every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
    expect([resourceBox.imageMapping!.destination.center.x, resourceBox.imageMapping!.destination.center.y, resourceBox.imageMapping!.destination.halfWidth, resourceBox.imageMapping!.destination.halfHeight].every((value) => Number.isFinite(value) && Math.abs(value) <= frame.maxLocalCoordinate)).toBe(true);
    // 最上层巨大 image 仍由同一 visible resource fragment 命中；clip 外不产生 ghost hit。
    expect(hitTestDrawingFrame(frame, { x: 50, y: 50 }, 2)?.entry.source.stroke.id).toBe('image');
    expect(hitTestDrawingFrame(frame, { x: 110, y: 50 }, 0)).toBeNull();
  });

  it('keeps huge partial text pending without a program, never exposing a resource-box hit', () => {
    const stroke: DrawingStrokeV2 = {
      schemaVersion: 2, id: 'huge-text', tool: 'text', text: 'original paragraph width', fontSize: 12,
      points: [{ x: -2_000_000, y: 0 }, { x: 2_000_000, y: 100 }],
    };
    const prepared = prepareDrawingDocument({ schemaVersion: 2, strokes: [stroke] });
    const fragment = clipPreparedDrawingEntry(
      prepared.entries[0],
      { x: 50, y: 50 },
      { minX: -51, minY: -51, maxX: 51, maxY: 51 },
      1_000_000
    ).fragments[0] as FrameResourceBoxFragment;
    const frame = createDrawingFrame({
      prepared,
      spatialIndex: createPreparedDrawingSpatialIndex(prepared),
      viewport: { scale: 1, tx: 0, ty: 0 },
      layoutSize: { width: 100, height: 100 },
    })!;

    expect(fragment.resourceBox.layout).toEqual({
      center: { x: -50, y: 0 }, halfWidth: 2_000_000, halfHeight: 50, rotationRad: 0,
    });
    expect(fragment.resourceBox.visible?.polygon).toEqual(fragment.points);
    // 完整 layout 仍是原始 4m 约束，request 同样保留原宽，不会用 visible AABB 重排。
    expect(frame.visibleEntries[0]).toMatchObject({ status: 'pending' });
    expect(fragment.resourceBox.textRequest).toMatchObject({ paragraphWidth: 4_000_000, paragraphLayoutWidth: 1_000_000, visiblePolygon: fragment.points });
    expect(frame.renderableEntries).toHaveLength(0);
    expect(hitTestDrawingFrame(frame, { x: 50, y: 50 }, 0)).toBeNull();
    expect(hitTestDrawingFrame(frame, { x: 110, y: 50 }, 0)).toBeNull();
  });

  it('exposes an explicit safe fragment contract: local points, matrix products, translation and screen values stay finite and bounded', () => {
    const global = 1_000_000_000.125;
    const scale = 8;
    const frame = (() => {
      const prepared = prepareDrawingDocument({ schemaVersion: 2, strokes: [{ schemaVersion: 2, id: 'safe', tool: 'line', points: [{ x: global, y: global }, { x: global + 10, y: global }] }] });
      return createDrawingFrame({ prepared, spatialIndex: createPreparedDrawingSpatialIndex(prepared), viewport: { scale, tx: -global * scale, ty: -global * scale }, layoutSize: { width: 100, height: 100 } })!;
    })();
    for (const fragment of frame.renderableEntries[0].fragments) {
      for (const point of fragment.points) {
        const linearX = frame.localToScreen.a * point.x + frame.localToScreen.c * point.y;
        const linearY = frame.localToScreen.b * point.x + frame.localToScreen.d * point.y;
        const screenX = linearX + frame.localToScreen.tx;
        const screenY = linearY + frame.localToScreen.ty;
        expect([point.x, point.y, linearX, linearY, frame.localToScreen.tx, frame.localToScreen.ty, screenX, screenY].every((value) => Number.isFinite(value) && Math.abs(value) <= 1_000_000)).toBe(true);
      }
    }
  });

  it('represents a fully-contained text/image as local resource boxes without raw boundary strokes', () => {
    const source: DrawingStrokeV2[] = [
      { schemaVersion: 2, id: 'text', tool: 'text', text: 'safe', fontSize: 18, rotationRad: Math.PI / 6, points: [{ x: 10, y: 10 }, { x: 40, y: 30 }] },
      { schemaVersion: 2, id: 'image', tool: 'image', resourceId: 'safe-image-id', src: 'image://safe', points: [{ x: 55, y: 10 }, { x: 85, y: 35 }] },
    ];
    const frame = createFrame(source);
    const before = JSON.stringify(source);

    for (const entry of frame.renderableEntries) {
      const fragment = entry.fragments[0];
      expect(entry.status).toBe('rebased');
      expect(fragment.kind).toBe('semantic-area');
      expect('resourceBox' in fragment).toBe(true);
      // 先用 guard 收窄类型，避免把断言放在条件分支内；guard 失败直接抛错。
      if (!('resourceBox' in fragment)) {
        throw new Error('expected semantic-area fragment to expose a resourceBox');
      }
      const resourceBox = (fragment as FrameResourceBoxFragment).resourceBox;
      expect(resourceBox.tool).toBe(entry.source.stroke.tool);
      expect(resourceBox.layout.center).not.toBe(entry.source.geometry.kind === 'rect' ? entry.source.geometry.center : undefined);
      expect(resourceBox.source).toMatchObject(entry.source.stroke.tool === 'text' ? { text: 'safe', fontSize: 18 } : { resourceId: 'safe-image-id', src: 'image://safe' });
      expect(entry.fragments.some((item) => item.kind === 'stroke')).toBe(false);
      expect(hitTestDrawingFrame(frame, { x: entry.source.stroke.tool === 'text' ? 25 : 70, y: 20 }, 0)?.entry).toBe(entry);
    }
    expect(source).toEqual(JSON.parse(before));
  });

  it.each([
    ['text', { text: 'partial', fontSize: 18 }],
    ['image', { src: 'image://partial' }],
  ] as const)('clips a rotated partial %s resource without granting unresolved text a box hit', (tool, resource) => {
    const stroke: DrawingStrokeV2 = tool === 'text'
      ? { schemaVersion: 2, id: tool, tool, rotationRad: Math.PI / 6, points: [{ x: -30, y: 25 }, { x: 70, y: 75 }], ...resource }
      : { schemaVersion: 2, id: tool, tool, rotationRad: Math.PI / 6, points: [{ x: -30, y: 25 }, { x: 70, y: 75 }], ...resource };
    const frame = createFrame([stroke]);
    const entry = tool === 'text' ? frame.visibleEntries[0] : frame.renderableEntries[0];
    const fragment = tool === 'text'
      ? clipPreparedDrawingEntry(prepareDrawingDocument({ schemaVersion: 2, strokes: [stroke] }).entries[0], { x: 50, y: 50 }, frame.localClipRegion, frame.maxLocalCoordinate).fragments[0]
      : entry.fragments[0];

    expect(entry.status).toBe(tool === 'text' ? 'pending' : 'clipped');
    expect(fragment.kind).toBe('semantic-area');
    if (!('resourceBox' in fragment)) throw new Error('partial resource must retain resourceBox metadata');
    const resourceBox = (fragment as FrameResourceBoxFragment).resourceBox;
    expect(resourceBox.visible).toMatchObject({ clipBounds: { minX: expect.any(Number), maxX: expect.any(Number) }, polygon: fragment.points });
    expect(resourceBox.layout).toMatchObject({ halfWidth: 50, halfHeight: 25, rotationRad: Math.PI / 6 });
    expect(typeof resourceBox.imageMapping === 'object').toBe(tool === 'image');
    expect(fragment.points).toHaveLength(4);
    // local clip 的左边是 global x=-1（包含默认 1 DIP cull guard）；intersection 的该边
    // 可命中，外侧则不能因完整 resource rect 而形成 ghost hit。
    expect(hitTestDrawingFrame(frame, { x: -1, y: 50 }, 0)?.entry).toBe(tool === 'text' ? undefined : entry);
    expect(hitTestDrawingFrame(frame, { x: -1.5, y: 50 }, 0)).toBeNull();
    expect(hitTestDrawingFrame(frame, { x: -1.5, y: 50 }, 0.4)).toBeNull();
    expect(hitTestDrawingFrame(frame, { x: -1.5, y: 50 }, 0.6)?.entry).toBe(tool === 'text' ? undefined : entry);
  });

  it('returns empty rather than a resource fragment when a rotated resource does not intersect the local clip region', () => {
    const prepared = prepareDrawingDocument({ schemaVersion: 2, strokes: [{
      schemaVersion: 2, id: 'touch', tool: 'image', src: 'image://touch', rotationRad: Math.PI / 4,
      points: [{ x: 10, y: 10 }, { x: 30, y: 30 }],
    }] });
    const result = clipPreparedDrawingEntry(prepared.entries[0], { x: 0, y: 0 }, { minX: 35, minY: 0, maxX: 40, maxY: 40 }, 100);

    expect(result).toMatchObject({ status: 'empty', fragments: [], program: { strokes: [], fills: [] } });
  });

  it('hits rotated resource boxes and clipped semantic rings by interior, exact edge, and tolerance', () => {
    const resource = createFrame([{
      schemaVersion: 2, id: 'rotated-text', tool: 'text', text: 'safe', fontSize: 18, rotationRad: Math.PI / 4,
      points: [{ x: 25, y: 25 }, { x: 75, y: 75 }],
    }]);
    const resourceEntry = resource.renderableEntries[0];
    const resourceRing = resourceEntry.fragments[0];
    const toScreen = (frame: typeof resource, point: { x: number; y: number }) => ({
      x: frame.localToScreen.a * point.x + frame.localToScreen.c * point.y + frame.localToScreen.tx,
      y: frame.localToScreen.b * point.x + frame.localToScreen.d * point.y + frame.localToScreen.ty,
    });
    const first = resourceRing.points[0];
    const second = resourceRing.points[1];
    const edge = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const length = Math.hypot(dx, dy);
    const outside = { x: edge.x + dy / length * 1.5, y: edge.y - dx / length * 1.5 };

    expect(hitTestDrawingFrame(resource, { x: 50, y: 50 }, 0)?.entry).toBe(resourceEntry);
    expect(hitTestDrawingFrame(resource, toScreen(resource, edge), 0)?.entry).toBe(resourceEntry);
    expect(hitTestDrawingFrame(resource, toScreen(resource, outside), 1)).toBeNull();
    expect(hitTestDrawingFrame(resource, toScreen(resource, outside), 2)?.entry).toBe(resourceEntry);

    const image = createFrame([{
      schemaVersion: 2, id: 'rotated-image', tool: 'image', src: 'image://safe', rotationRad: Math.PI / 6,
      points: [{ x: 25, y: 25 }, { x: 75, y: 75 }],
    }]);
    expect(hitTestDrawingFrame(image, { x: 50, y: 50 }, 0)?.entry.source.stroke.tool).toBe('image');

    const clipped = createFrame([{
      schemaVersion: 2, id: 'clipped-fill', tool: 'rect', fillColor: '#000',
      points: [{ x: -100, y: 25 }, { x: 200, y: 75 }], rotationRad: 0,
    }]);
    const clippedEntry = clipped.renderableEntries[0];
    const clippedRing = clippedEntry.fragments.find((fragment) => fragment.kind === 'semantic-area')!;
    const minX = Math.min(...clippedRing.points.map((point) => point.x));
    const clippedEdge = clippedRing.points.filter((point) => point.x === minX);
    const clippedMidpoint = { x: minX, y: (clippedEdge[0].y + clippedEdge[1].y) / 2 };

    // 这条边来自 clip polygon 而非 stroke fragment，零容差仍应命中语义区域。
    expect(hitTestDrawingFrame(clipped, toScreen(clipped, clippedMidpoint), 0)?.entry).toBe(clippedEntry);

    const halfOpenSemantic = createFrame([{
      schemaVersion: 2, id: 'half-open-fill', tool: 'rect', fillColor: '#000', strokeWidth: 0,
      points: [{ x: 10, y: 10 }, { x: 30, y: 30 }], rotationRad: 0,
    }]);
    // 几何上位于 semantic ring 的 max 边，但零容差仍必须保留 index 的 half-open queryPoint 规则。
    expect(hitTestDrawingFrame(halfOpenSemantic, { x: 30, y: 20 }, 0)).toBeNull();
  });

  it('preserves source strokes but uses compound nonzero fill for partial concave and self-intersecting rings', () => {
    const full = createFrame([{
      schemaVersion: 2, id: 'concave', tool: 'polygon', fillColor: '#000',
      points: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 50, y: 50 }, { x: 10, y: 90 }],
    }]);
    const fullEntry = full.renderableEntries[0];
    const closed = fullEntry.fragments.find((fragment) => fragment.kind === 'stroke');
    expect(fullEntry.status).toBe('rebased');
    expect(closed).toMatchObject({ closed: true, sourceSegmentStart: 0, sourceSegmentEnd: 4 });
    expect(hitTestDrawingFrame(full, { x: 20, y: 20 }, 0)?.entry).toBe(fullEntry);

    const partial = createFrame([{
      schemaVersion: 2, id: 'partial-concave', tool: 'polygon', fillColor: '#000',
      points: [{ x: -10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 50, y: 50 }, { x: -10, y: 90 }],
    }]);
    expect(partial.visibleEntries[0]).toMatchObject({ status: 'clipped' });
    expect(partial.renderableEntries[0].program.fills).toHaveLength(1);
    expect(partial.renderableEntries[0].fragments.filter((fragment) => fragment.kind === 'semantic-area')).toEqual([]);

    const selfIntersecting = createFrame([{
      schemaVersion: 2, id: 'bow-tie', tool: 'polygon', fillColor: '#000',
      points: [{ x: 10, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }, { x: 90, y: 10 }],
    }]);
    expect(selfIntersecting.visibleEntries[0]).toMatchObject({ status: 'rebased' });
    expect(selfIntersecting.renderableEntries[0].program.fills).toHaveLength(1);
    // 原始 source edge 可以描边；只有由 clip 生成的人工边禁止进入 stroke program。
    expect(selfIntersecting.renderableEntries[0].program.strokes.every((stroke) => stroke.closed || stroke.points.length >= 2)).toBe(true);
    expect(hitTestDrawingFrame(selfIntersecting, { x: 30, y: 30 }, 0)?.entry).toBe(selfIntersecting.renderableEntries[0]);
  });

  it('supports cubic and ellipse programs that require more than the former 65,536 contour cap', () => {
    const cubic: DrawingStrokeV2 = {
      schemaVersion: 2, id: 'cubic-over-65k', tool: 'bezier',
      points: [{ x: -1_000_000_000, y: 0 }, { x: -1_000_000_000, y: 1_000_000_000 }, { x: 1_000_000_000, y: -1_000_000_000 }, { x: 1_000_000_000, y: 0 }],
    };
    const ellipse: DrawingStrokeV2 = {
      schemaVersion: 2, id: 'ellipse-over-65k', tool: 'ellipse',
      points: [{ x: -1_000_000_000, y: -1_000_000_000 }, { x: 1_000_000_000, y: 1_000_000_000 }],
    };
    const source = [cubic, ellipse];
    const before = JSON.stringify(source);
    const prepared = prepareDrawingDocument({ schemaVersion: 2, strokes: source });
    const preparedBefore = JSON.stringify(prepared);
    const region = { minX: -500_000_000, minY: -500_000_000, maxX: 500_000_000, maxY: 500_000_000 };
    // 更严格的 0.01 DIP screen-space 预算使 cubic 同样真实超过旧 65,536 cap；
    // 这里验证的是 safe program，而非仅把默认 1024 上限调大。
    const cubicResult = clipPreparedDrawingEntry(prepared.entries[0], { x: 0, y: 0 }, region, 1_000_000_000, 0.01);
    const ellipseResult = clipPreparedDrawingEntry(prepared.entries[1], { x: 0, y: 0 }, region, 1_000_000_000);

    for (const result of [cubicResult, ellipseResult]) {
      expect(result.status).not.toBe('unresolved');
      expect(result.program.maxDeviation).toBeLessThanOrEqual(result === cubicResult ? 0.01 : 0.25);
      expect(result.program.strokes.flatMap((stroke) => stroke.points).every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
      expect(result.program.fills.flatMap((fill) => fill.polygons).every((polygon) => polygon.outer.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)))).toBe(true);
    }
    expect(cubicResult.program.strokes.flatMap((stroke) => stroke.points).length).toBeGreaterThan(65_536);
    // 完整 ellipse 在 .25 DIP 预算下需要超过 65,536 段；frame 不分配其画面外轮廓，
    // 而是用安全 clip fill 表达“视口完全在填充内”的同一语义。
    expect(Math.ceil(Math.PI * Math.sqrt(1_000_000_000 / (2 * 0.25)))).toBeGreaterThan(65_536);
    expect(ellipseResult.program.fills).toHaveLength(1);
    // 全局 canonical document 与 prepared snapshot 都不因 transient contour/crop 被改写。
    expect(source).toEqual(JSON.parse(before));
    expect(JSON.stringify(prepared)).toBe(preparedBefore);
  });

  it('uses the larger safe contour budget instead of the legacy 1024-segment unresolved cap', () => {
    const prepared = prepareDrawingDocument({ schemaVersion: 2, strokes: [{
      schemaVersion: 2, id: 'capped', tool: 'bezier',
      points: [{ x: -900_000, y: 0 }, { x: -900_000, y: 900_000 }, { x: 900_000, y: -900_000 }, { x: 900_000, y: 0 }],
    }] });
    const result = clipPreparedDrawingEntry(prepared.entries[0], { x: 0, y: 0 }, { minX: -1_000_000, minY: -1_000_000, maxX: 1_000_000, maxY: 1_000_000 }, 1_000_000);
    expect(result.status).toBe('rebased');
    expect(result.program.strokes[0].points.length).toBeGreaterThan(1_024);
    expect(result.program.strokes[0].points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
  });
});
