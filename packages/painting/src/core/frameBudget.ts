import type { GeometryPoint } from './geometry';
import type { FrameGeometryProgram, FrameLocalClipRegion, FrameResourceBoxFragment, FrameResourceLayout, FrameTextProgram } from './frameClipping';
import type { Affine2D } from '../viewport';

/**
 * 单帧送入绘制后端的数值上限。这个边界同时约束 local program 和 local->screen
 * 仿射计算，避免某一层只验证几何而把样式、资源或矩阵溢出留给 Skia。
 */
export type FrameDrawBudget = Readonly<{
  maxCoordinate: number;
  localToScreen: Affine2D;
}>;

export type DrawStyleNumbers = Readonly<{
  strokeWidth: number;
  fillOpacity: number;
  dashArray?: readonly number[];
  dashOffset: number;
}>;

function finite(value: number): boolean { return Number.isFinite(value); }

export function createFrameDrawBudget(maxCoordinate: number, localToScreen: Affine2D): FrameDrawBudget | null {
  if (!finite(maxCoordinate) || maxCoordinate <= 0) return null;
  if (![localToScreen.a, localToScreen.b, localToScreen.c, localToScreen.d, localToScreen.tx, localToScreen.ty].every((value) => finite(value) && Math.abs(value) <= maxCoordinate)) {
    return null;
  }
  return Object.freeze({ maxCoordinate, localToScreen: Object.freeze({ ...localToScreen }) });
}

/** 兼容入口不拥有 frame 时使用同一套纯数值边界，而不是把未验证值交给 Skia。 */
export function createLegacyDrawBudget(maxCoordinate = 1_000_000): FrameDrawBudget {
  return Object.freeze({
    maxCoordinate,
    localToScreen: Object.freeze({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }),
  });
}

export function isDrawNumber(value: number, budget: FrameDrawBudget): boolean {
  return finite(value) && Math.abs(value) <= budget.maxCoordinate;
}

export function isDrawPoint(point: GeometryPoint, budget: FrameDrawBudget): boolean {
  return isDrawNumber(point.x, budget) && isDrawNumber(point.y, budget);
}

export function isScreenPointForFrame(point: GeometryPoint, budget: FrameDrawBudget): boolean {
  if (!isDrawPoint(point, budget)) return false;
  const { a, b, c, d, tx, ty } = budget.localToScreen;
  const linearX = a * point.x + c * point.y;
  const linearY = b * point.x + d * point.y;
  return [linearX, linearY, linearX + tx, linearY + ty].every((value) => isDrawNumber(value, budget));
}

export function isDrawClip(clip: FrameLocalClipRegion, budget: FrameDrawBudget): boolean {
  return [clip.minX, clip.minY, clip.maxX, clip.maxY].every((value) => isDrawNumber(value, budget)) &&
    clip.minX <= clip.maxX && clip.minY <= clip.maxY;
}

export function isDrawDash(dashArray: readonly number[] | undefined, dashOffset: number, budget: FrameDrawBudget): boolean {
  if (!isDrawNumber(dashOffset, budget)) return false;
  if (dashArray === undefined) return true;
  if (dashArray.length === 0 || !dashArray.every((value) => isDrawNumber(value, budget) && value >= 0)) return false;
  const period = dashArray.reduce((sum, value) => sum + value, 0);
  return isDrawNumber(period, budget) && period > 0;
}

/** 原始 dash 输入的范围 gate；格式无效时可由 adapter 安全地降级为无 dash。 */
export function isDrawDashInput(dashArray: readonly number[] | undefined, dashOffset: number, budget: FrameDrawBudget): boolean {
  return isDrawNumber(dashOffset, budget) && (dashArray === undefined || dashArray.every((value) => isDrawNumber(value, budget)));
}

export function isDrawStyle(style: DrawStyleNumbers, budget: FrameDrawBudget): boolean {
  return isDrawNumber(style.strokeWidth, budget) && style.strokeWidth >= 0 &&
    isDrawNumber(style.fillOpacity, budget) && style.fillOpacity >= 0 && style.fillOpacity <= 1 &&
    isDrawDash(style.dashArray, style.dashOffset, budget);
}

export function isDrawResourceBox(fragment: FrameResourceBoxFragment, budget: FrameDrawBudget): boolean {
  const { resourceBox } = fragment;
  const isDrawLayout = (layout: FrameResourceLayout): boolean => {
    const { center, halfWidth, halfHeight, rotationRad } = layout;
    if (!isScreenPointForFrame(center, budget) || ![halfWidth, halfHeight, rotationRad].every((value) => isDrawNumber(value, budget)) || halfWidth < 0 || halfHeight < 0) return false;
    // renderer 会构造旋转后的 resource 四角；每一个最终 screen 坐标均须通过预算，不能仅
    // 检查 local box。该检查也覆盖 scale=8 时 local 合法而 screen 超限的情况。
    const cosine = Math.cos(rotationRad);
    const sine = Math.sin(rotationRad);
    if (![cosine, sine].every((value) => isDrawNumber(value, budget))) return false;
    return [[-halfWidth, -halfHeight], [halfWidth, -halfHeight], [halfWidth, halfHeight], [-halfWidth, halfHeight]].every(([x, y]) =>
      isScreenPointForFrame({ x: center.x + x * cosine - y * sine, y: center.y + x * sine + y * cosine }, budget)
    );
  };
  // 未类型化 legacy 调用方可伪造 fragment；缺少完整 layout 必须安全拒绝，不能抛给 renderer。
  if (!resourceBox.layout) return false;
  const visible = resourceBox.visible;
  if (visible && (!isDrawClip(visible.clipBounds, budget) || !visible.polygon.every((point) => isScreenPointForFrame(point, budget)))) return false;
  if (resourceBox.tool === 'image' && resourceBox.imageMapping) {
    const { source, destination } = resourceBox.imageMapping;
    return Object.values(source).every((value) => isDrawNumber(value, budget) && value >= 0 && value <= 1) &&
      source.width > 0 && source.height > 0 && source.x + source.width <= 1 && source.y + source.height <= 1 &&
      isDrawLayout(destination);
  }
  // partial text 不把完整巨大 resource layout 交给 Skia；只有已解析 program 才能进入后端。
  if (resourceBox.tool === 'text') {
    if (visible) return resourceBox.textRequest !== undefined && resourceBox.textProgram !== undefined &&
      isFrameTextProgramWithinBudget(resourceBox.textProgram, budget);
    // 未迁移的完整、有限 resource fragment 仍可走现有 Paragraph；core 自产 fragment 会携带
    // program，因此不会让 partial/超大 text 走到这条兼容分支。
    return resourceBox.textRequest === undefined
      ? isDrawLayout(resourceBox.layout)
      : resourceBox.textProgram !== undefined && isFrameTextProgramWithinBudget(resourceBox.textProgram, budget);
  }
  return isDrawLayout(resourceBox.layout);
}

/** 文本 program 的锚点、绘制偏移、glyph 坐标与命中语义区域都必须经过同一最终预算。 */
export function isFrameTextProgramWithinBudget(program: FrameTextProgram, budget: FrameDrawBudget): boolean {
  if (program.kind === 'empty-text') return true;
  const semantic = program.semanticRegions.every((region) => region.polygon.length >= 3 && region.polygon.every((point) => isScreenPointForFrame(point, budget)));
  if (!semantic || !isScreenPointForFrame(program.anchor, budget) || !isDrawNumber(program.rotationRad, budget)) return false;
  const cosine = Math.cos(program.rotationRad);
  const sine = Math.sin(program.rotationRad);
  if (![cosine, sine].every((value) => isDrawNumber(value, budget))) return false;
  if (program.kind === 'paragraph-slice') {
    const cosine = Math.cos(program.rotationRad);
    const sine = Math.sin(program.rotationRad);
    return isDrawPoint(program.paintOffset, budget) && isDrawNumber(program.paragraphWidth, budget) && program.paragraphWidth > 0 &&
      isScreenPointForFrame({
        x: program.anchor.x + (program.paintOffset.x + program.paragraphWidth) * cosine - program.paintOffset.y * sine,
        y: program.anchor.y + (program.paintOffset.x + program.paragraphWidth) * sine + program.paintOffset.y * cosine,
      }, budget);
  }
  return program.runs.length > 0 && program.runs.every((run) =>
    run.glyphs.length > 0 && run.positions.length === run.glyphs.length * 2 &&
    (!run.clusters || run.clusters.length === run.glyphs.length) &&
    // fontReady 只是 provider 的声明；必须同时持有非 null/undefined 的 opaque font handle，
    // 否则 Skia renderer 会在绘制时跳过该 run，导致 render/hit 不一致。不能仅信 fontReady。
    run.fontReady === true && run.font !== null && run.font !== undefined &&
    isDrawNumber(run.size, budget) && run.size > 0 &&
    isDrawNumber(run.scaleX, budget) && run.scaleX > 0 &&
    Array.from(run.positions).every((value, index) => {
      if (!isDrawNumber(value, budget)) return false;
      if (index % 2 === 1) return true;
      const x = value;
      const y = run.positions[index + 1];
      if (!isDrawNumber(y, budget)) return false;
      // Glyphs receives paragraph-local positions, then renderer applies anchor + rotation + frame affine.
      return isScreenPointForFrame({
        x: program.anchor.x + x * cosine - y * sine,
        y: program.anchor.y + x * sine + y * cosine,
      }, budget);
    })
  );
}

export function isFrameProgramWithinBudget(program: FrameGeometryProgram, budget: FrameDrawBudget): boolean {
  return program.strokes.every((stroke) =>
    stroke.points.every((point) => isScreenPointForFrame(point, budget)) &&
    // source distance 只用于 JS modulo 推导 dash phase，不会原样进入 Skia；不能因一条
    // 超长但可裁剪的路径拒绝当前 frame。descriptor 会检查最终归一化 phase。
    finite(stroke.sourceDistanceStart) &&
    finite(stroke.sourceDistanceEnd) &&
    stroke.sourceDistanceStart >= 0 && stroke.sourceDistanceEnd >= stroke.sourceDistanceStart &&
    true
  ) && program.fills.every((fill) => fill.polygons.every((polygon) =>
    polygon.outer.every((point) => isScreenPointForFrame(point, budget)) &&
    polygon.holes.every((hole) => hole.every((point) => isScreenPointForFrame(point, budget)))
  ));
}
