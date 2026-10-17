import { addStroke } from '../document';
import { isNormalizedPointerInput, type NormalizedPointerInput, type Point } from '../input';
import {
  createPointerOwnershipState,
  getPointerOwner,
  reducePointerOwnership,
  type PointerOwnershipState,
} from './ownership';
import { rotateRulerAround, snapRulerRotation } from '../../ruler/geometry';
import { createViewportTransformIntent, type ViewportTransformIntent } from '../viewportTransform';
import type {
  DrawingPointV2,
  DrawingStrokeV2,
  DrawingToolModeV2,
  DrawingValueV2,
} from '../../model/strokes';

/** GestureSession 当前仅真正提交 `pen`；其他既有工具会保留安全的无操作会话，不会假装已支持。 */
export type GestureSessionTool = DrawingToolModeV2;

/** 纯交互策略，不复用 legacy 组件的 options 类型。 */
export type GestureInteractionPolicy = Readonly<{
  singleTouch?: 'draw' | 'pan' | 'none';
  /** 默认 `pan-zoom`，与 legacy SAFE 的纸面双指平移加缩放语义兼容。 */
  twoTouch?: 'none' | 'pan' | 'zoom' | 'pan-zoom';
  mouseDragPan?: boolean;
  penPan?: boolean;
  /** 最小有效绘制距离，单位为宿主局部 DIP；仅显式提供时启用。 */
  drawCommitThreshold?: number;
}>;

type ResolvedGestureInteractionPolicy = Readonly<{
  singleTouch: 'draw' | 'pan' | 'none';
  twoTouch: 'none' | 'pan' | 'zoom' | 'pan-zoom';
  mouseDragPan: boolean;
  penPan: boolean;
  drawCommitThreshold: number | null;
}>;

/** 不依赖 viewport 或平台对象的尺子位姿。 */
export type GestureRulerState = Readonly<{
  center: Point;
  rotationRad: number;
}>;

/** 选框的纯几何描述；其中坐标与输入 `screen` 同为宿主局部 DIP。 */
export type SelectionBox = Readonly<{
  center: Point;
  width: number;
  height: number;
  rotationRad: number;
}>;

/** 由 adapter 的命中结果构造的选区手势，不包含元素、回调或 legacy selection 类型。 */
export type SelectionGestureDescriptor =
  | Readonly<{ kind: 'move'; box: SelectionBox }>
  | Readonly<{
      /** 四个角手柄专用的等比缩放；所有字段均为 screen DIP。 */
      kind: 'uniform-scale';
      box: SelectionBox;
      /** 与被抓取的角手柄相对的固定角。 */
      anchor: Point;
      /** 手势开始前被抓取角手柄的稳定位置。 */
      handle: Point;
      /** 选框两条轴都不能低于的屏幕 DIP 尺寸。 */
      minimumScreenExtent?: number;
    }>
  | Readonly<{
      kind: 'resize';
      box: SelectionBox;
      /** 不随拖动变化的对角锚点。 */
      anchor: Point;
      /** 被抓取手柄相对锚点的稳定象限。 */
      axis: Readonly<{ x: -1 | 1; y: -1 | 1 }>;
      minimumSize?: number;
    }>
  | Readonly<{ kind: 'rotate'; box: SelectionBox; pivot?: Point }>;

/** 由调用者提供的稳定笔迹构造器；不得依赖随机数或平台对象。 */
export type PenStrokeFactory = (
  request: Readonly<{
    pointerId: NormalizedPointerInput['pointerId'];
    points: readonly DrawingPointV2[];
    startedAt: number;
  }>
) => DrawingStrokeV2 | null;

/** 构造纯 GestureSession 时注入的静态领域数据。 */
export type CreateGestureSessionOptions = Readonly<{
  document: DrawingValueV2;
  tool?: GestureSessionTool;
  createPenStroke?: PenStrokeFactory;
  /** 缺失时 ruler owner 是显式安全 no-op，而非猜测尺子位置。 */
  ruler?: Readonly<{ state: GestureRulerState; pivot?: Point }>;
  /** adapter 在 selection down 前构造；本阶段不在 core 中进行命中或 document 变形。 */
  selection?: SelectionGestureDescriptor;
  interactionPolicy?: GestureInteractionPolicy;
}>;

export type GestureSessionStatus = 'idle' | 'active' | 'completed' | 'cancelled' | 'failed';

export type PaperGestureState =
  | Readonly<{ kind: 'pending-single'; pointerId: string | number }>
  | Readonly<{ kind: 'drawing'; pointerId: string | number; points: readonly DrawingPointV2[] }>
  | Readonly<{ kind: 'navigating-single'; pointerId: string | number }>
  | Readonly<{ kind: 'navigating-two'; pointerIds: readonly [string | number, string | number] }>
  | Readonly<{ kind: 'unsupported'; pointerId: string | number; tool: GestureSessionTool }>;

export type NavigationPreview = Readonly<{
  pointerIds: readonly (string | number)[];
  startMidpoint: Point;
  currentMidpoint: Point;
  midpointDelta: Point;
  scaleRatio: number;
  intent: ViewportTransformIntent;
}>;

export type RulerPreview = Readonly<{
  pointerIds: readonly (string | number)[];
  state: GestureRulerState;
}>;

export type SelectionIntent =
  | Readonly<{ kind: 'move'; delta: Point }>
  | Readonly<{
      kind: 'resize';
      anchor: Point;
      axis: Readonly<{ x: -1 | 1; y: -1 | 1 }>;
      scale: Readonly<{ x: number; y: number }>;
    }>
  | Readonly<{ kind: 'rotate'; pivot: Point; deltaRad: number }>;

/** 新选框手势使用的标量缩放语义，刻意不复用旧 `resize: { x, y }`。 */
export type UniformScaleSelectionIntent = Readonly<{
  kind: 'uniform-scale';
  anchor: Point;
  scale: number;
}>;

/** GestureSession 的 transient/effect 可包含新 scalar intent；旧 UI 类型仍是 SelectionIntent。 */
export type SelectionGestureIntent = SelectionIntent | UniformScaleSelectionIntent;

/** 高频预览。所有字段均不写入 `document`，也绝不代表 history 提交。 */
export type GestureTransientState = Readonly<{
  paper?: PaperGestureState;
  navigation?: NavigationPreview;
  ruler?: RulerPreview;
  /** 旧 selection transient 兼容接口；uniform-scale 在 `uniformScaleSelection` 中单独暴露。 */
  selection?: SelectionIntent;
  uniformScaleSelection?: UniformScaleSelectionIntent;
}>;

/** selection 的最终语义必须由后续 3/4 接缝原子应用到 V2 document，不能被当成 document commit。 */
export type GestureSessionEffect =
  | Readonly<{ type: 'document-commit'; document: DrawingValueV2 }>
  | Readonly<{ type: 'selection-commit'; intent: SelectionIntent }>
  | Readonly<{ type: 'uniform-scale-commit'; intent: UniformScaleSelectionIntent }>
  | Readonly<{ type: 'ruler-complete'; state: GestureRulerState }>;

type Position = Readonly<{ pointerId: string | number; point: Point }>;

type PaperRuntime =
  | Readonly<{
      kind: 'pending-single';
      pointerId: string | number;
      device: NormalizedPointerInput['device'];
      start: DrawingPointV2;
      startedAt: number;
      behavior: 'draw' | 'pan' | 'none';
    }>
  | Readonly<{
      kind: 'drawing';
      pointerId: string | number;
      points: readonly DrawingPointV2[];
      startedAt: number;
    }>
  | Readonly<{
      kind: 'navigating-single';
      pointerId: string | number;
      start: Position;
      current: Position;
    }>
  | Readonly<{
      kind: 'navigating-two';
      pointerIds: readonly [string | number, string | number];
      start: readonly [Position, Position];
      current: readonly [Position, Position];
      behavior: 'pan' | 'zoom' | 'pan-zoom';
    }>
  | Readonly<{ kind: 'unsupported'; pointerId: string | number; tool: GestureSessionTool }>;

type RulerRuntime =
  | Readonly<{
      kind: 'mouse-translate';
      pointerId: string | number;
      initial: GestureRulerState;
      current: GestureRulerState;
      grabOffset: Point;
    }>
  | Readonly<{
      kind: 'mouse-rotate';
      pointerId: string | number;
      initial: GestureRulerState;
      current: GestureRulerState;
      pivot: Point;
      startAngle: number;
    }>
  | Readonly<{ kind: 'touch-wait'; pointerId: string | number; start: Point }>
  | Readonly<{
      kind: 'touch-pair';
      pointerIds: readonly [string | number, string | number];
      initial: GestureRulerState;
      start: readonly [Position, Position];
      current: readonly [Position, Position];
    }>;

type SelectionRuntime = Readonly<{
  pointerId: string | number;
  descriptor: SelectionGestureDescriptor;
  start: Point;
  /** pointer 相对原始手柄的偏移，避免按在放大命中区内时跳变。 */
  grabOffset: Point;
  intent: SelectionGestureIntent;
}>;

/**
 * 平台无关的领域手势状态。调用方以替换整个值的方式使用，内部数组与预览都冻结。
 * `status` 表示最近可观察的生命周期结果；并发 owner 尚有活跃会话时始终为 `active`。
 */
export type GestureSession = Readonly<{
  document: DrawingValueV2;
  ownership: PointerOwnershipState;
  tool: GestureSessionTool;
  paper: PaperRuntime | null;
  ruler: RulerRuntime | null;
  selection: SelectionRuntime | null;
  transient: GestureTransientState;
  status: GestureSessionStatus;
  createPenStroke?: PenStrokeFactory;
  rulerOptions?: Readonly<{ state: GestureRulerState; pivot?: Point }>;
  selectionDescriptor?: SelectionGestureDescriptor;
  interactionPolicy: ResolvedGestureInteractionPolicy;
}>;

export type GestureSessionTransition = Readonly<{
  session: GestureSession;
  effects: readonly GestureSessionEffect[];
}>;

const NO_EFFECTS: readonly GestureSessionEffect[] = Object.freeze([]);

function freezePoint(point: Point): Point {
  return Object.freeze({ x: point.x, y: point.y });
}

function freezePoints(points: readonly DrawingPointV2[]): readonly DrawingPointV2[] {
  return Object.freeze(points.map((point) => Object.freeze({ ...point })));
}

function freezeDocument(document: DrawingValueV2): DrawingValueV2 {
  return Object.freeze({
    // 保留读时迁移已容忍的未知顶层字段；GestureSession 只冻结，不重新定义文档 schema。
    ...document,
    schemaVersion: 2,
    strokes: Object.freeze(
      document.strokes.map(
        (stroke) =>
          Object.freeze({
            ...stroke,
            schemaVersion: 2,
            points: freezePoints(stroke.points),
          }) as DrawingStrokeV2
      )
    ) as DrawingStrokeV2[],
  }) as DrawingValueV2;
}

function copyRulerState(state: GestureRulerState): GestureRulerState {
  return Object.freeze({ center: freezePoint(state.center), rotationRad: state.rotationRad });
}

function pointFrom(input: NormalizedPointerInput): DrawingPointV2 {
  return Object.freeze({
    x: input.screen.x,
    y: input.screen.y,
    ...(input.pressure === undefined ? {} : { pressure: input.pressure }),
  });
}

function hasFiniteBox(box: SelectionBox): boolean {
  return (
    Number.isFinite(box.center.x) &&
    Number.isFinite(box.center.y) &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height) &&
    Number.isFinite(box.rotationRad) &&
    box.width > 0 &&
    box.height > 0
  );
}

function isOppositeCornerPair(box: SelectionBox, anchor: Point, handle: Point): boolean {
  const cosine = Math.cos(box.rotationRad);
  const sine = Math.sin(box.rotationRad);
  const corners = [
    { x: -box.width / 2, y: -box.height / 2 },
    { x: box.width / 2, y: -box.height / 2 },
    { x: box.width / 2, y: box.height / 2 },
    { x: -box.width / 2, y: box.height / 2 },
  ].map(({ x, y }) => ({
    x: box.center.x + x * cosine - y * sine,
    y: box.center.y + x * sine + y * cosine,
  }));
  const tolerance = Math.max(1, box.width, box.height) * 1e-9;
  return corners.some((corner, index) => {
    const opposite = corners[(index + 2) % 4];
    return (
      Math.hypot(handle.x - corner.x, handle.y - corner.y) <= tolerance &&
      Math.hypot(anchor.x - opposite.x, anchor.y - opposite.y) <= tolerance
    );
  });
}

function isSelectionDescriptor(
  value: SelectionGestureDescriptor | undefined
): value is SelectionGestureDescriptor {
  if (!value || !hasFiniteBox(value.box)) {
    return false;
  }
  if (value.kind === 'resize') {
    return (
      Number.isFinite(value.anchor.x) &&
      Number.isFinite(value.anchor.y) &&
      (value.axis.x === -1 || value.axis.x === 1) &&
      (value.axis.y === -1 || value.axis.y === 1) &&
      (value.minimumSize === undefined ||
        (Number.isFinite(value.minimumSize) && value.minimumSize > 0))
    );
  }
  if (value.kind === 'uniform-scale') {
    const handleOffsetX = value.handle.x - value.anchor.x;
    const handleOffsetY = value.handle.y - value.anchor.y;
    return (
      Number.isFinite(value.anchor.x) &&
      Number.isFinite(value.anchor.y) &&
      Number.isFinite(value.handle.x) &&
      Number.isFinite(value.handle.y) &&
      Number.isFinite(handleOffsetX * handleOffsetX + handleOffsetY * handleOffsetY) &&
      handleOffsetX * handleOffsetX + handleOffsetY * handleOffsetY > 0 &&
      isOppositeCornerPair(value.box, value.anchor, value.handle) &&
      (value.minimumScreenExtent === undefined ||
        (Number.isFinite(value.minimumScreenExtent) && value.minimumScreenExtent > 0))
    );
  }
  return (
    value.kind !== 'rotate' ||
    !value.pivot ||
    (Number.isFinite(value.pivot.x) && Number.isFinite(value.pivot.y))
  );
}

function copySelectionDescriptor(
  descriptor: SelectionGestureDescriptor
): SelectionGestureDescriptor {
  const box = Object.freeze({
    center: freezePoint(descriptor.box.center),
    width: descriptor.box.width,
    height: descriptor.box.height,
    rotationRad: descriptor.box.rotationRad,
  });
  if (descriptor.kind === 'move') {
    return Object.freeze({ kind: 'move', box });
  }
  if (descriptor.kind === 'resize') {
    return Object.freeze({
      kind: 'resize',
      box,
      anchor: freezePoint(descriptor.anchor),
      axis: Object.freeze({ ...descriptor.axis }),
      ...(descriptor.minimumSize === undefined ? {} : { minimumSize: descriptor.minimumSize }),
    });
  }
  if (descriptor.kind === 'uniform-scale') {
    return Object.freeze({
      kind: 'uniform-scale',
      box,
      anchor: freezePoint(descriptor.anchor),
      handle: freezePoint(descriptor.handle),
      ...(descriptor.minimumScreenExtent === undefined
        ? {}
        : { minimumScreenExtent: descriptor.minimumScreenExtent }),
    });
  }
  return Object.freeze({
    kind: 'rotate',
    box,
    ...(descriptor.pivot ? { pivot: freezePoint(descriptor.pivot) } : {}),
  });
}

function angle(from: Point, to: Point): number | null {
  const result = Math.atan2(to.y - from.y, to.x - from.x);
  return Number.isFinite(result) ? result : null;
}

function normalizedAngle(delta: number): number {
  return Math.atan2(Math.sin(delta), Math.cos(delta));
}

function midpoint(first: Point, second: Point): Point {
  return freezePoint({ x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 });
}

function replacePosition(
  pair: readonly [Position, Position],
  pointerId: string | number,
  point: Point
): readonly [Position, Position] {
  return Object.freeze(
    pair.map((position) =>
      position.pointerId === pointerId
        ? Object.freeze({ pointerId, point: freezePoint(point) })
        : position
    ) as [Position, Position]
  );
}

function pair<T>(first: T, second: T): readonly [T, T] {
  return Object.freeze([first, second]) as readonly [T, T];
}

function resolveInteractionPolicy(
  policy: GestureInteractionPolicy | undefined
): ResolvedGestureInteractionPolicy {
  const threshold = policy?.drawCommitThreshold;
  return Object.freeze({
    singleTouch: policy?.singleTouch ?? 'draw',
    twoTouch: policy?.twoTouch ?? 'pan-zoom',
    mouseDragPan: policy?.mouseDragPan ?? false,
    penPan: policy?.penPan ?? false,
    drawCommitThreshold:
      threshold !== undefined && Number.isFinite(threshold) && threshold >= 0 ? threshold : null,
  });
}

function paperBehavior(
  device: NormalizedPointerInput['device'],
  policy: ResolvedGestureInteractionPolicy
): 'draw' | 'pan' | 'none' {
  switch (device) {
    case 'touch':
      return policy.singleTouch;
    case 'mouse':
      return policy.mouseDragPan ? 'pan' : 'draw';
    case 'pen':
      return policy.penPan ? 'pan' : 'draw';
  }
}

function navigationPreview(
  pointerIds: readonly (string | number)[],
  start: readonly Position[],
  current: readonly Position[],
  behavior: 'pan' | 'zoom' | 'pan-zoom'
): NavigationPreview | null {
  const startMidpoint =
    start.length === 1 ? freezePoint(start[0].point) : midpoint(start[0].point, start[1].point);
  const currentMidpoint =
    current.length === 1
      ? freezePoint(current[0].point)
      : midpoint(current[0].point, current[1].point);
  const startDistance =
    start.length === 2
      ? Math.hypot(start[1].point.x - start[0].point.x, start[1].point.y - start[0].point.y)
      : 1;
  const currentDistance =
    current.length === 2
      ? Math.hypot(current[1].point.x - current[0].point.x, current[1].point.y - current[0].point.y)
      : 1;
  const scaleRatio =
    behavior !== 'pan' &&
    Number.isFinite(startDistance) &&
    startDistance > 0 &&
    Number.isFinite(currentDistance)
      ? currentDistance / startDistance
      : 1;
  // zoom-only 固定手势起点为 focal，避免两指整体平移被意外合成进缩放变换。
  const intentFocal = behavior === 'zoom' ? startMidpoint : currentMidpoint;
  const intent = createViewportTransformIntent(startMidpoint, intentFocal, scaleRatio);
  return intent
    ? Object.freeze({
        pointerIds: Object.freeze([...pointerIds]),
        startMidpoint,
        currentMidpoint,
        midpointDelta: freezePoint({
          x: currentMidpoint.x - startMidpoint.x,
          y: currentMidpoint.y - startMidpoint.y,
        }),
        scaleRatio,
        intent,
      })
    : null;
}

function distanceBetween(first: Point, second: Point): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function transientFor(
  paper: PaperRuntime | null,
  ruler: RulerRuntime | null,
  selection: SelectionRuntime | null
): GestureTransientState {
  const transient: {
    paper?: PaperGestureState;
    navigation?: NavigationPreview;
    ruler?: RulerPreview;
    selection?: SelectionIntent;
    uniformScaleSelection?: UniformScaleSelectionIntent;
  } = {};
  if (paper?.kind === 'pending-single') {
    transient.paper = Object.freeze({ kind: 'pending-single', pointerId: paper.pointerId });
  } else if (paper?.kind === 'drawing') {
    transient.paper = Object.freeze({
      kind: 'drawing',
      pointerId: paper.pointerId,
      points: freezePoints(paper.points),
    });
  } else if (paper?.kind === 'navigating-single') {
    transient.paper = Object.freeze({ kind: 'navigating-single', pointerId: paper.pointerId });
    transient.navigation =
      navigationPreview([paper.pointerId], [paper.start], [paper.current], 'pan') ?? undefined;
  } else if (paper?.kind === 'unsupported') {
    transient.paper = Object.freeze({
      kind: 'unsupported',
      pointerId: paper.pointerId,
      tool: paper.tool,
    });
  } else if (paper?.kind === 'navigating-two') {
    transient.paper = Object.freeze({
      kind: 'navigating-two',
      pointerIds: Object.freeze([...paper.pointerIds]) as [string | number, string | number],
    });
    transient.navigation =
      navigationPreview(paper.pointerIds, paper.start, paper.current, paper.behavior) ?? undefined;
  }
  if (ruler) {
    if (ruler.kind === 'mouse-translate') {
      transient.ruler = Object.freeze({
        pointerIds: Object.freeze([ruler.pointerId]),
        state: ruler.current,
      });
    } else if (ruler.kind === 'mouse-rotate') {
      transient.ruler = Object.freeze({
        pointerIds: Object.freeze([ruler.pointerId]),
        state: ruler.current,
      });
    } else if (ruler.kind === 'touch-pair') {
      const startMidpoint = midpoint(ruler.start[0].point, ruler.start[1].point);
      const currentMidpoint = midpoint(ruler.current[0].point, ruler.current[1].point);
      const startAngle = angle(ruler.start[0].point, ruler.start[1].point);
      const currentAngle = angle(ruler.current[0].point, ruler.current[1].point);
      const delta =
        startAngle === null || currentAngle === null
          ? 0
          : normalizedAngle(currentAngle - startAngle);
      transient.ruler = Object.freeze({
        pointerIds: Object.freeze([...ruler.pointerIds]),
        state: copyRulerState({
          center: {
            x: ruler.initial.center.x + currentMidpoint.x - startMidpoint.x,
            y: ruler.initial.center.y + currentMidpoint.y - startMidpoint.y,
          },
          rotationRad: snapRulerRotation(ruler.initial.rotationRad + delta),
        }),
      });
    }
  }
  if (selection) {
    if (selection.intent.kind === 'uniform-scale') {
      transient.uniformScaleSelection = selection.intent;
    } else {
      transient.selection = selection.intent;
    }
  }
  return Object.freeze(transient);
}

function makeSession(
  previous: GestureSession,
  updates: Readonly<{
    document?: DrawingValueV2;
    ownership?: PointerOwnershipState;
    paper?: PaperRuntime | null;
    ruler?: RulerRuntime | null;
    selection?: SelectionRuntime | null;
    status: GestureSessionStatus;
  }>
): GestureSession {
  const document = updates.document ?? previous.document;
  const ownership = updates.ownership ?? previous.ownership;
  const paper = updates.paper === undefined ? previous.paper : updates.paper;
  const ruler = updates.ruler === undefined ? previous.ruler : updates.ruler;
  const selection = updates.selection === undefined ? previous.selection : updates.selection;
  return Object.freeze({
    document,
    ownership,
    tool: previous.tool,
    paper,
    ruler,
    selection,
    transient: transientFor(paper, ruler, selection),
    status: paper || ruler || selection ? 'active' : updates.status,
    ...(previous.createPenStroke ? { createPenStroke: previous.createPenStroke } : {}),
    ...(previous.rulerOptions ? { rulerOptions: previous.rulerOptions } : {}),
    ...(previous.selectionDescriptor ? { selectionDescriptor: previous.selectionDescriptor } : {}),
    interactionPolicy: previous.interactionPolicy,
  });
}

function transition(
  session: GestureSession,
  effects: readonly GestureSessionEffect[] = NO_EFFECTS
): GestureSessionTransition {
  return Object.freeze({ session, effects: Object.freeze([...effects]) });
}

function defaultPenStroke(request: Parameters<PenStrokeFactory>[0]): DrawingStrokeV2 {
  return {
    schemaVersion: 2,
    id: `pen-${String(request.pointerId)}-${request.startedAt}`,
    tool: 'pen',
    points: request.points.map((point) => ({ ...point })),
  };
}

function createCommittedPen(
  session: GestureSession,
  drawing: Extract<PaperRuntime, { kind: 'drawing' }>
): DrawingValueV2 | null {
  if (
    drawing.points.length < 2 ||
    drawing.points.every(
      (point) => point.x === drawing.points[0].x && point.y === drawing.points[0].y
    )
  ) {
    return null;
  }
  try {
    const stroke = (session.createPenStroke ?? defaultPenStroke)({
      pointerId: drawing.pointerId,
      points: freezePoints(drawing.points),
      startedAt: drawing.startedAt,
    });
    return stroke?.schemaVersion === 2 && stroke.tool === 'pen'
      ? freezeDocument(addStroke(session.document, stroke))
      : null;
  } catch {
    return null;
  }
}

function resizeIntent(
  descriptor: Extract<SelectionGestureDescriptor, { kind: 'resize' }>,
  point: Point
): SelectionIntent {
  const cosine = Math.cos(descriptor.box.rotationRad);
  const sine = Math.sin(descriptor.box.rotationRad);
  const dx = point.x - descriptor.anchor.x;
  const dy = point.y - descriptor.anchor.y;
  const localX = dx * cosine + dy * sine;
  const localY = -dx * sine + dy * cosine;
  const minimumSize = descriptor.minimumSize ?? 1;
  return Object.freeze({
    kind: 'resize',
    anchor: freezePoint(descriptor.anchor),
    axis: Object.freeze({ ...descriptor.axis }),
    scale: Object.freeze({
      x: Math.max(
        minimumSize / descriptor.box.width,
        (descriptor.axis.x * localX) / descriptor.box.width
      ),
      y: Math.max(
        minimumSize / descriptor.box.height,
        (descriptor.axis.y * localY) / descriptor.box.height
      ),
    }),
  });
}

function uniformScaleIntent(
  descriptor: Extract<SelectionGestureDescriptor, { kind: 'uniform-scale' }>,
  grabOffset: Point,
  point: Point
): UniformScaleSelectionIntent {
  const handleVector = {
    x: descriptor.handle.x - descriptor.anchor.x,
    y: descriptor.handle.y - descriptor.anchor.y,
  };
  const lengthSquared = handleVector.x * handleVector.x + handleVector.y * handleVector.y;
  const adjustedPoint = { x: point.x - grabOffset.x, y: point.y - grabOffset.y };
  const pointerVector = {
    x: adjustedPoint.x - descriptor.anchor.x,
    y: adjustedPoint.y - descriptor.anchor.y,
  };
  const rawScale =
    (pointerVector.x * handleVector.x + pointerVector.y * handleVector.y) / lengthSquared;
  // 穿过 anchor 会引入反射；它不是本阶段支持的仿射变形，因而安全回到 identity。
  if (!Number.isFinite(rawScale) || rawScale < 0) {
    return Object.freeze({
      kind: 'uniform-scale',
      anchor: freezePoint(descriptor.anchor),
      scale: 1,
    });
  }
  const minimumScreenExtent = descriptor.minimumScreenExtent ?? 1;
  // 若调用方提供的初始选框已经小于最小可缩屏幕尺寸，down 仍必须精确为 1，不能跳变。
  const minimumScale = Math.min(
    1,
    minimumScreenExtent / Math.min(descriptor.box.width, descriptor.box.height)
  );
  const scale = Math.max(minimumScale, rawScale);
  return Number.isFinite(scale) && scale > 0
    ? Object.freeze({ kind: 'uniform-scale', anchor: freezePoint(descriptor.anchor), scale })
    : Object.freeze({ kind: 'uniform-scale', anchor: freezePoint(descriptor.anchor), scale: 1 });
}

function selectionIntent(
  descriptor: SelectionGestureDescriptor,
  start: Point,
  grabOffset: Point,
  current: Point
): SelectionGestureIntent {
  if (descriptor.kind === 'move') {
    return Object.freeze({
      kind: 'move',
      delta: freezePoint({ x: current.x - start.x, y: current.y - start.y }),
    });
  }
  if (descriptor.kind === 'resize') {
    return resizeIntent(descriptor, current);
  }
  if (descriptor.kind === 'uniform-scale') {
    // 明确保留 down 的 identity，而不依赖浮点减法后“恰好”再得到 1。
    if (current.x === start.x && current.y === start.y) {
      return Object.freeze({
        kind: 'uniform-scale',
        anchor: freezePoint(descriptor.anchor),
        scale: 1,
      });
    }
    return uniformScaleIntent(descriptor, grabOffset, current);
  }
  const pivot = descriptor.pivot ?? descriptor.box.center;
  const startAngle = angle(pivot, start);
  const currentAngle = angle(pivot, current);
  return Object.freeze({
    kind: 'rotate',
    pivot: freezePoint(pivot),
    deltaRad:
      startAngle === null || currentAngle === null ? 0 : normalizedAngle(currentAngle - startAngle),
  });
}

function selectionChanged(intent: SelectionGestureIntent): boolean {
  return intent.kind === 'move'
    ? intent.delta.x !== 0 || intent.delta.y !== 0
    : intent.kind === 'uniform-scale'
      ? intent.scale !== 1
      : intent.kind === 'resize'
        ? intent.scale.x !== 1 || intent.scale.y !== 1
        : intent.deltaRad !== 0;
}

/**
 * 创建无副作用 GestureSession。它不持有平台对象，也不主动写 document/history；调用方只需把
 * 每个规范化样本依次交给 `reduceGestureSession`，并在收到 `document-commit` 时执行持久化。
 *
 * 选区最终只发 `selection-commit`：当前 core 没有可安全变形所有 V2 stroke 的公共操作，后续
 * 3/4 接缝必须把该 immutable intent 原子应用为唯一 `document-commit`，不能把预览当作提交。
 */
export function createGestureSession(options: CreateGestureSessionOptions): GestureSession {
  const rulerOptions =
    options.ruler &&
    Number.isFinite(options.ruler.state.center.x) &&
    Number.isFinite(options.ruler.state.center.y) &&
    Number.isFinite(options.ruler.state.rotationRad)
      ? Object.freeze({
          state: copyRulerState(options.ruler.state),
          ...(options.ruler.pivot ? { pivot: freezePoint(options.ruler.pivot) } : {}),
        })
      : undefined;
  const selectionDescriptor = isSelectionDescriptor(options.selection)
    ? copySelectionDescriptor(options.selection)
    : undefined;
  return Object.freeze({
    document: freezeDocument(options.document),
    ownership: createPointerOwnershipState(),
    tool: options.tool ?? 'pen',
    paper: null,
    ruler: null,
    selection: null,
    transient: Object.freeze({}),
    status: 'idle',
    ...(options.createPenStroke ? { createPenStroke: options.createPenStroke } : {}),
    ...(rulerOptions ? { rulerOptions } : {}),
    ...(selectionDescriptor ? { selectionDescriptor } : {}),
    interactionPolicy: resolveInteractionPolicy(options.interactionPolicy),
  });
}

/** 单步消费一个规范化 pointer 样本。无效、重复或未知生命周期不会抛出，也不会产生错误提交。 */
export function reduceGestureSession(
  session: GestureSession,
  input: unknown
): GestureSessionTransition {
  if (!isNormalizedPointerInput(input)) {
    return transition(makeSession(session, { status: 'failed' }));
  }
  const ownerBefore = getPointerOwner(session.ownership, input.pointerId);
  const ownership = reducePointerOwnership(session.ownership, input);
  const owner = input.phase === 'down' ? getPointerOwner(ownership, input.pointerId) : ownerBefore;
  if (!owner) {
    return transition(makeSession(session, { ownership, status: session.status }));
  }

  let paper = session.paper;
  let ruler = session.ruler;
  let selection = session.selection;
  let document = session.document;
  let status: GestureSessionStatus = 'completed';
  let effects: readonly GestureSessionEffect[] = NO_EFFECTS;

  if (owner === 'paper') {
    if (input.phase === 'down') {
      if (!paper) {
        paper = Object.freeze({
          kind: 'pending-single',
          pointerId: input.pointerId,
          device: input.device,
          start: pointFrom(input),
          startedAt: input.timestamp,
          behavior: paperBehavior(input.device, session.interactionPolicy),
        });
      } else if (
        paper.kind === 'pending-single' &&
        paper.device === 'touch' &&
        input.device === 'touch' &&
        input.pointerId !== paper.pointerId &&
        session.interactionPolicy.twoTouch !== 'none'
      ) {
        const first = Object.freeze({
          pointerId: paper.pointerId,
          point: freezePoint(paper.start),
        });
        const second = Object.freeze({
          pointerId: input.pointerId,
          point: freezePoint(input.screen),
        });
        paper = Object.freeze({
          kind: 'navigating-two',
          pointerIds: pair(paper.pointerId, input.pointerId),
          start: pair(first, second),
          current: pair(first, second),
          behavior: session.interactionPolicy.twoTouch,
        });
      }
    } else if (input.phase === 'move') {
      if (paper?.kind === 'pending-single' && paper.pointerId === input.pointerId) {
        if (paper.behavior === 'pan') {
          const start = Object.freeze({
            pointerId: paper.pointerId,
            point: freezePoint(paper.start),
          });
          paper = Object.freeze({
            kind: 'navigating-single',
            pointerId: paper.pointerId,
            start,
            current: Object.freeze({
              pointerId: paper.pointerId,
              point: freezePoint(input.screen),
            }),
          });
        } else if (
          paper.behavior === 'draw' &&
          (session.interactionPolicy.drawCommitThreshold === null ||
            distanceBetween(paper.start, input.screen) >=
              session.interactionPolicy.drawCommitThreshold)
        ) {
          paper =
            session.tool === 'pen'
              ? Object.freeze({
                  kind: 'drawing',
                  pointerId: paper.pointerId,
                  points: freezePoints([paper.start, pointFrom(input)]),
                  startedAt: paper.startedAt,
                })
              : Object.freeze({
                  kind: 'unsupported',
                  pointerId: paper.pointerId,
                  tool: session.tool,
                });
        }
      } else if (paper?.kind === 'drawing' && paper.pointerId === input.pointerId) {
        const next = pointFrom(input);
        const last = paper.points[paper.points.length - 1];
        paper =
          last.x === next.x && last.y === next.y
            ? paper
            : Object.freeze({ ...paper, points: freezePoints([...paper.points, next]) });
      } else if (paper?.kind === 'navigating-single' && paper.pointerId === input.pointerId) {
        paper = Object.freeze({
          ...paper,
          current: Object.freeze({ pointerId: paper.pointerId, point: freezePoint(input.screen) }),
        });
      } else if (paper?.kind === 'navigating-two' && paper.pointerIds.includes(input.pointerId)) {
        paper = Object.freeze({
          ...paper,
          current: replacePosition(paper.current, input.pointerId, input.screen),
        });
      }
    } else if (input.phase === 'up' || input.phase === 'cancel') {
      const cancelled = input.phase === 'cancel';
      if (paper?.kind === 'drawing' && paper.pointerId === input.pointerId) {
        if (!cancelled) {
          const finalPoint = pointFrom(input);
          const lastPoint = paper.points[paper.points.length - 1];
          const completedDrawing =
            lastPoint.x === finalPoint.x && lastPoint.y === finalPoint.y
              ? paper
              : Object.freeze({ ...paper, points: freezePoints([...paper.points, finalPoint]) });
          const committed = createCommittedPen(session, completedDrawing);
          if (committed) {
            document = committed;
            effects = Object.freeze([{ type: 'document-commit', document: committed }]);
          } else if (completedDrawing.points.length > 1) {
            status = 'failed';
          }
        }
        paper = null;
        status = cancelled ? 'cancelled' : status;
      } else if (paper?.kind === 'navigating-two' && paper.pointerIds.includes(input.pointerId)) {
        paper = null;
        status = cancelled ? 'cancelled' : 'completed';
      } else if (paper?.kind === 'navigating-single' && paper.pointerId === input.pointerId) {
        paper = null;
        status = cancelled ? 'cancelled' : 'completed';
      } else if (
        (paper?.kind === 'pending-single' || paper?.kind === 'unsupported') &&
        paper.pointerId === input.pointerId
      ) {
        if (
          !cancelled &&
          paper.kind === 'pending-single' &&
          paper.behavior === 'draw' &&
          session.tool === 'pen' &&
          (session.interactionPolicy.drawCommitThreshold === null ||
            distanceBetween(paper.start, input.screen) >=
              session.interactionPolicy.drawCommitThreshold)
        ) {
          const completedDrawing = Object.freeze({
            kind: 'drawing' as const,
            pointerId: paper.pointerId,
            points: freezePoints([paper.start, pointFrom(input)]),
            startedAt: paper.startedAt,
          });
          const committed = createCommittedPen(session, completedDrawing);
          if (committed) {
            document = committed;
            effects = Object.freeze([{ type: 'document-commit', document: committed }]);
          }
        }
        const unsupported = paper.kind === 'unsupported';
        paper = null;
        status = cancelled ? 'cancelled' : unsupported ? 'failed' : 'completed';
      }
    }
  }

  if (owner === 'ruler' && session.rulerOptions) {
    const initial = session.rulerOptions.state;
    if (input.phase === 'down' && !ruler) {
      if (input.device === 'mouse') {
        if (input.modifiers.alt) {
          const pivot = session.rulerOptions.pivot ?? initial.center;
          const startAngle = angle(pivot, input.screen);
          ruler =
            startAngle === null
              ? null
              : Object.freeze({
                  kind: 'mouse-rotate',
                  pointerId: input.pointerId,
                  initial,
                  current: initial,
                  pivot,
                  startAngle,
                });
        } else {
          ruler = Object.freeze({
            kind: 'mouse-translate',
            pointerId: input.pointerId,
            initial,
            current: initial,
            grabOffset: freezePoint({
              x: initial.center.x - input.screen.x,
              y: initial.center.y - input.screen.y,
            }),
          });
        }
      } else if (input.device === 'touch') {
        ruler = Object.freeze({
          kind: 'touch-wait',
          pointerId: input.pointerId,
          start: freezePoint(input.screen),
        });
      }
    } else if (
      input.phase === 'down' &&
      ruler?.kind === 'touch-wait' &&
      input.device === 'touch' &&
      input.pointerId !== ruler.pointerId
    ) {
      const first = Object.freeze({ pointerId: ruler.pointerId, point: ruler.start });
      const second = Object.freeze({
        pointerId: input.pointerId,
        point: freezePoint(input.screen),
      });
      ruler = Object.freeze({
        kind: 'touch-pair',
        pointerIds: pair(ruler.pointerId, input.pointerId),
        initial,
        start: pair(first, second),
        current: pair(first, second),
      });
    } else if (input.phase === 'move') {
      if (ruler?.kind === 'mouse-translate' && ruler.pointerId === input.pointerId) {
        ruler = Object.freeze({
          ...ruler,
          current: copyRulerState({
            center: {
              x: input.screen.x + ruler.grabOffset.x,
              y: input.screen.y + ruler.grabOffset.y,
            },
            rotationRad: ruler.initial.rotationRad,
          }),
        });
      } else if (ruler?.kind === 'mouse-rotate' && ruler.pointerId === input.pointerId) {
        const currentAngle = angle(ruler.pivot, input.screen);
        if (currentAngle !== null) {
          const desired = normalizedAngle(currentAngle - ruler.startAngle);
          const rotated = rotateRulerAround(ruler.initial, ruler.pivot, desired);
          const snapped = snapRulerRotation(rotated.rotationRad);
          ruler = Object.freeze({
            ...ruler,
            current: copyRulerState(
              rotateRulerAround(ruler.initial, ruler.pivot, snapped - ruler.initial.rotationRad)
            ),
          });
        }
      } else if (ruler?.kind === 'touch-pair' && ruler.pointerIds.includes(input.pointerId)) {
        ruler = Object.freeze({
          ...ruler,
          current: replacePosition(ruler.current, input.pointerId, input.screen),
        });
      }
    } else if ((input.phase === 'up' || input.phase === 'cancel') && ruler) {
      const participates =
        (ruler.kind === 'touch-pair' && ruler.pointerIds.includes(input.pointerId)) ||
        (ruler.kind !== 'touch-pair' && ruler.pointerId === input.pointerId);
      if (participates) {
        let finalState: GestureRulerState | null = null;
        if (input.phase === 'up') {
          if (ruler.kind === 'mouse-translate') {
            finalState = copyRulerState({
              center: {
                x: input.screen.x + ruler.grabOffset.x,
                y: input.screen.y + ruler.grabOffset.y,
              },
              rotationRad: ruler.initial.rotationRad,
            });
          } else if (ruler.kind === 'mouse-rotate') {
            const finalAngle = angle(ruler.pivot, input.screen);
            if (finalAngle !== null) {
              const rotated = rotateRulerAround(
                ruler.initial,
                ruler.pivot,
                normalizedAngle(finalAngle - ruler.startAngle)
              );
              finalState = copyRulerState(
                rotateRulerAround(
                  ruler.initial,
                  ruler.pivot,
                  snapRulerRotation(rotated.rotationRad) - ruler.initial.rotationRad
                )
              );
            }
          } else if (ruler.kind === 'touch-pair') {
            const current = replacePosition(ruler.current, input.pointerId, input.screen);
            const startMidpoint = midpoint(ruler.start[0].point, ruler.start[1].point);
            const currentMidpoint = midpoint(current[0].point, current[1].point);
            const startAngle = angle(ruler.start[0].point, ruler.start[1].point);
            const currentAngle = angle(current[0].point, current[1].point);
            const delta =
              startAngle === null || currentAngle === null
                ? 0
                : normalizedAngle(currentAngle - startAngle);
            finalState = copyRulerState({
              center: {
                x: ruler.initial.center.x + currentMidpoint.x - startMidpoint.x,
                y: ruler.initial.center.y + currentMidpoint.y - startMidpoint.y,
              },
              rotationRad: snapRulerRotation(ruler.initial.rotationRad + delta),
            });
          }
        }
        ruler = null;
        status = input.phase === 'cancel' ? 'cancelled' : 'completed';
        effects = finalState
          ? Object.freeze([{ type: 'ruler-complete', state: finalState }])
          : effects;
      }
    }
  }

  if (owner === 'selection' && session.selectionDescriptor) {
    if (input.phase === 'down' && !selection) {
      const descriptor = session.selectionDescriptor;
      selection = Object.freeze({
        pointerId: input.pointerId,
        descriptor,
        start: freezePoint(input.screen),
        grabOffset: freezePoint(
          descriptor.kind === 'uniform-scale'
            ? { x: input.screen.x - descriptor.handle.x, y: input.screen.y - descriptor.handle.y }
            : { x: 0, y: 0 }
        ),
        intent: selectionIntent(
          descriptor,
          input.screen,
          descriptor.kind === 'uniform-scale'
            ? { x: input.screen.x - descriptor.handle.x, y: input.screen.y - descriptor.handle.y }
            : { x: 0, y: 0 },
          input.screen
        ),
      });
    } else if (input.phase === 'move' && selection?.pointerId === input.pointerId) {
      selection = Object.freeze({
        ...selection,
        intent: selectionIntent(
          selection.descriptor,
          selection.start,
          selection.grabOffset,
          input.screen
        ),
      });
    } else if (
      (input.phase === 'up' || input.phase === 'cancel') &&
      selection?.pointerId === input.pointerId
    ) {
      const finalIntent =
        input.phase === 'up'
          ? selectionIntent(
              selection.descriptor,
              selection.start,
              selection.grabOffset,
              input.screen
            )
          : selection.intent;
      if (input.phase === 'up' && selectionChanged(finalIntent)) {
        effects = Object.freeze([
          finalIntent.kind === 'uniform-scale'
            ? { type: 'uniform-scale-commit', intent: finalIntent }
            : { type: 'selection-commit', intent: finalIntent },
        ]);
      }
      selection = null;
      status = input.phase === 'cancel' ? 'cancelled' : 'completed';
    }
  }

  return transition(
    makeSession(session, { document, ownership, paper, ruler, selection, status }),
    effects
  );
}
