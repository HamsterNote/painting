import {
  DRAWING_STROKE_SCHEMA_VERSION,
  type DrawingPointV2,
  type DrawingStrokeToolV2,
  type DrawingStrokeV2,
  type DrawingToolModeV2,
} from '../model/strokes';

/** 可复制到新 V2 笔迹的基础样式；不引入任何工具专属或额外持久字段。 */
export type EditorToolStrokeStyle = Readonly<{
  strokeColor?: string;
  strokeWidth?: number;
  dashArray?: readonly number[];
  dashOffset?: number;
  fillColor?: string;
  fillOpacity?: number;
  /** 仅当调用方显式提供时保留，rect/ellipse 不会自行创建 rotationRad。 */
  rotationRad?: number;
}>;

/** 稳定 ID 必须由宿主策略提供；core 永不使用随机数或时间戳生成可持久 ID。 */
export type EditorToolCreateId = (tool: DrawingStrokeToolV2) => string | null | undefined;

export type EditorToolSessionOptions = Readonly<{
  /** image 不是连续 DrawingToolModeV2，但仍须显式转交资源导入流程。 */
  tool: DrawingToolModeV2 | 'image';
  createId?: EditorToolCreateId;
  style?: EditorToolStrokeStyle;
}>;

export type EditorToolSessionDiagnostic =
  | Readonly<{ type: 'invalid-world-point' }>
  | Readonly<{ type: 'tool-session-finalized' }>
  | Readonly<{ type: 'tool-session-not-started' }>
  | Readonly<{ type: 'degenerate-tool-geometry'; tool: DrawingStrokeToolV2 }>
  | Readonly<{ type: 'polygon-requires-three-vertices' }>
  | Readonly<{ type: 'polygon-degenerate' }>
  | Readonly<{ type: 'bezier-requires-four-controls'; count: number }>
  | Readonly<{ type: 'stable-id-required'; tool: DrawingStrokeToolV2 }>
  | Readonly<{ type: 'requires-text-session' }>
  | Readonly<{ type: 'requires-resource-import' }>
  | Readonly<{ type: 'requires-query'; tool: 'eraser' | 'lasso' }>;

type ContinuousTool = 'pen' | 'line' | 'rect' | 'ellipse';
type VertexTool = 'polygon' | 'bezier';

export type EditorToolSession =
  | Readonly<{
      kind: 'continuous';
      tool: ContinuousTool;
      style: EditorToolStrokeStyle;
      createId?: EditorToolCreateId;
      points: readonly DrawingPointV2[];
      status: 'idle' | 'active' | 'finished' | 'cancelled';
    }>
  | Readonly<{
      kind: 'vertices';
      tool: VertexTool;
      style: EditorToolStrokeStyle;
      createId?: EditorToolCreateId;
      points: readonly DrawingPointV2[];
      status: 'idle' | 'active' | 'finished' | 'cancelled';
    }>
  | Readonly<{
      kind: 'handoff';
      tool: 'text' | 'image' | 'eraser' | 'lasso';
      style: EditorToolStrokeStyle;
      createId?: EditorToolCreateId;
      points: readonly DrawingPointV2[];
      status: 'idle' | 'finished' | 'cancelled';
    }>;

export type EditorToolSessionResult = Readonly<{
  session: EditorToolSession;
  /** 仅是候选值，调用方必须用 revision-aware EditorRuntime append 命令离散提交。 */
  stroke?: DrawingStrokeV2;
  preview: readonly DrawingPointV2[];
  diagnostics: readonly EditorToolSessionDiagnostic[];
}>;

function isFinitePoint(point: DrawingPointV2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && (point.pressure === undefined || Number.isFinite(point.pressure));
}

function copyPoint(point: DrawingPointV2): DrawingPointV2 {
  return Object.freeze({ ...point });
}

function copyPoints(points: readonly DrawingPointV2[]): readonly DrawingPointV2[] {
  return Object.freeze(points.map(copyPoint));
}

/**
 * 只复制新追加的点，复用既有（会话已拥有的冻结）点引用，并冻结新的顶层数组。
 * 会话 points 永远由本模块创建为冻结副本，因此结构共享不会泄露调用方的可变对象。
 */
function appendFrozenPoint(points: readonly DrawingPointV2[], point: DrawingPointV2): readonly DrawingPointV2[] {
  return Object.freeze([...points, copyPoint(point)]);
}

/** 连续 shape 只保留首末两点：首点复用既有冻结引用，末点复制，数组重新冻结。 */
function frozenEndpoints(points: readonly DrawingPointV2[], point: DrawingPointV2): readonly DrawingPointV2[] {
  return Object.freeze([points[0], copyPoint(point)]);
}

/** 连续工具 down：单点会话数组，点被复制并冻结。 */
function frozenSinglePoint(point: DrawingPointV2): readonly DrawingPointV2[] {
  return Object.freeze([copyPoint(point)]);
}

function copyStyle(style: EditorToolStrokeStyle | undefined): EditorToolStrokeStyle {
  return Object.freeze({
    ...(style?.strokeColor === undefined ? {} : { strokeColor: style.strokeColor }),
    ...(style?.strokeWidth === undefined ? {} : { strokeWidth: style.strokeWidth }),
    ...(style?.dashArray === undefined ? {} : { dashArray: Object.freeze([...style.dashArray]) }),
    ...(style?.dashOffset === undefined ? {} : { dashOffset: style.dashOffset }),
    ...(style?.fillColor === undefined ? {} : { fillColor: style.fillColor }),
    ...(style?.fillOpacity === undefined ? {} : { fillOpacity: style.fillOpacity }),
    ...(style?.rotationRad === undefined ? {} : { rotationRad: style.rotationRad }),
  });
}

function createSession(options: EditorToolSessionOptions): EditorToolSession {
  const style = copyStyle(options.style);
  const common = { style, ...(options.createId ? { createId: options.createId } : {}), points: Object.freeze([]) };
  if (options.tool === 'pen' || options.tool === 'line' || options.tool === 'rect' || options.tool === 'ellipse') {
    return Object.freeze({ kind: 'continuous', tool: options.tool, ...common, status: 'idle' });
  }
  if (options.tool === 'polygon' || options.tool === 'bezier') {
    return Object.freeze({ kind: 'vertices', tool: options.tool, ...common, status: 'idle' });
  }
  return Object.freeze({ kind: 'handoff', tool: options.tool, ...common, status: 'idle' });
}

function result(
  session: EditorToolSession,
  diagnostics: readonly EditorToolSessionDiagnostic[] = [],
  stroke?: DrawingStrokeV2
): EditorToolSessionResult {
  return Object.freeze({
    session,
    preview: session.points,
    diagnostics: Object.freeze([...diagnostics]),
    ...(stroke ? { stroke } : {}),
  });
}

function finalized(session: EditorToolSession): boolean {
  return session.status === 'finished' || session.status === 'cancelled';
}

function samePosition(left: DrawingPointV2, right: DrawingPointV2): boolean {
  return left.x === right.x && left.y === right.y;
}

function hasDistinctPair(points: readonly DrawingPointV2[]): boolean {
  return points.length >= 2 && points.some((point) => !samePosition(point, points[0]));
}

function hasNonCollinearVertex(points: readonly DrawingPointV2[]): boolean {
  if (points.length < 3) {
    return false;
  }
  const first = points[0];
  const second = points.find((point) => !samePosition(point, first));
  return second !== undefined && points.some((point) => (second.x - first.x) * (point.y - first.y) !== (second.y - first.y) * (point.x - first.x));
}

function appendUniquePoint(points: readonly DrawingPointV2[], point: DrawingPointV2): readonly DrawingPointV2[] {
  return points.length > 0 && samePosition(points[points.length - 1], point)
    ? points
    : appendFrozenPoint(points, point);
}

/**
 * 构造下一个会话。`points` 必须已是本模块拥有的冻结数组
 * （appendFrozenPoint / frozenEndpoints / frozenSinglePoint / session.points），
 * 因此这里不再重复深拷贝，避免每次 move 复制全部历史点。
 */
function nextSession(session: EditorToolSession, points: readonly DrawingPointV2[], status: EditorToolSession['status']): EditorToolSession {
  return Object.freeze({ ...session, points, status }) as EditorToolSession;
}

function createStroke(session: EditorToolSession, tool: DrawingStrokeToolV2, points: readonly DrawingPointV2[]): EditorToolSessionResult {
  const id = session.createId?.(tool);
  if (typeof id !== 'string' || id.length === 0) {
    return result(nextSession(session, points, 'finished'), [{ type: 'stable-id-required', tool }]);
  }
  const stroke = Object.freeze({
    schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
    id,
    tool,
    points: copyPoints(points),
    ...session.style,
  }) as DrawingStrokeV2;
  return result(nextSession(session, points, 'finished'), [], stroke);
}

/** 创建纯工具会话。它只构造候选笔迹，绝不写 document/history。 */
export function createEditorToolSession(options: EditorToolSessionOptions): EditorToolSessionResult {
  const session = createSession(options);
  if (options.tool === 'text') {
    return result(session, [{ type: 'requires-text-session' }]);
  }
  if (options.tool === 'image') {
    return result(session, [{ type: 'requires-resource-import' }]);
  }
  if (options.tool === 'eraser' || options.tool === 'lasso') {
    return result(session, [{ type: 'requires-query', tool: options.tool }]);
  }
  return result(session);
}

/** 连续工具的 world-DIP down；polygon/bezier 请调用 addEditorToolVertex。 */
export function beginEditorToolPointer(session: EditorToolSession, point: DrawingPointV2): EditorToolSessionResult {
  if (finalized(session)) {
    return result(session, [{ type: 'tool-session-finalized' }]);
  }
  if (!isFinitePoint(point)) {
    return result(session, [{ type: 'invalid-world-point' }]);
  }
  if (session.kind !== 'continuous') {
    return result(session, [{ type: 'tool-session-not-started' }]);
  }
  return result(nextSession(session, frozenSinglePoint(point), 'active'));
}

/** 连续工具的 world-DIP move；pen 去重相邻点，shape 始终保留稳定的首末点。 */
export function moveEditorToolPointer(session: EditorToolSession, point: DrawingPointV2): EditorToolSessionResult {
  if (finalized(session)) {
    return result(session, [{ type: 'tool-session-finalized' }]);
  }
  if (!isFinitePoint(point)) {
    return result(session, [{ type: 'invalid-world-point' }]);
  }
  if (session.kind !== 'continuous' || session.status !== 'active') {
    return result(session, [{ type: 'tool-session-not-started' }]);
  }
  const points = session.tool === 'pen'
    ? appendUniquePoint(session.points, point)
    : frozenEndpoints(session.points, point);
  return result(nextSession(session, points, 'active'));
}

/** 连续工具的 up。只有有效非退化几何会带回候选 stroke。 */
export function finishEditorToolPointer(session: EditorToolSession, point: DrawingPointV2): EditorToolSessionResult {
  if (finalized(session)) {
    return result(session, [{ type: 'tool-session-finalized' }]);
  }
  if (!isFinitePoint(point)) {
    return result(session, [{ type: 'invalid-world-point' }]);
  }
  if (session.kind !== 'continuous' || session.status !== 'active') {
    return result(session, [{ type: 'tool-session-not-started' }]);
  }
  const points = session.tool === 'pen'
    ? appendUniquePoint(session.points, point)
    : frozenEndpoints(session.points, point);
  if (!hasDistinctPair(points)) {
    return result(nextSession(session, points, 'finished'), [{ type: 'degenerate-tool-geometry', tool: session.tool }]);
  }
  if ((session.tool === 'rect' || session.tool === 'ellipse') && (points[0].x === points[1].x || points[0].y === points[1].y)) {
    return result(nextSession(session, points, 'finished'), [{ type: 'degenerate-tool-geometry', tool: session.tool }]);
  }
  return createStroke(session, session.tool, points);
}

/** 为 polygon/bezier 显式添加一个 world-DIP 顶点/控制点；不会自动添加闭合重复点。 */
export function addEditorToolVertex(session: EditorToolSession, point: DrawingPointV2): EditorToolSessionResult {
  if (finalized(session)) {
    return result(session, [{ type: 'tool-session-finalized' }]);
  }
  if (!isFinitePoint(point)) {
    return result(session, [{ type: 'invalid-world-point' }]);
  }
  if (session.kind !== 'vertices') {
    return result(session, [{ type: 'tool-session-not-started' }]);
  }
  if (session.tool === 'bezier' && session.points.length === 4) {
    return result(session, [{ type: 'bezier-requires-four-controls', count: 4 }]);
  }
  return result(nextSession(session, appendUniquePoint(session.points, point), 'active'));
}

/** 显式结束 polygon；它必须有至少三个非共线顶点，且不自动闭合。 */
export function finishEditorPolygon(session: EditorToolSession): EditorToolSessionResult {
  if (finalized(session)) {
    return result(session, [{ type: 'tool-session-finalized' }]);
  }
  if (session.kind !== 'vertices' || session.tool !== 'polygon') {
    return result(session, [{ type: 'tool-session-not-started' }]);
  }
  if (session.points.length < 3) {
    return result(nextSession(session, session.points, 'finished'), [{ type: 'polygon-requires-three-vertices' }]);
  }
  if (!hasNonCollinearVertex(session.points)) {
    return result(nextSession(session, session.points, 'finished'), [{ type: 'polygon-degenerate' }]);
  }
  return createStroke(session, 'polygon', session.points);
}

/** 显式结束 cubic Bézier；严格要求恰好四个控制点，不猜测或补造控制点。 */
export function finishEditorBezier(session: EditorToolSession): EditorToolSessionResult {
  if (finalized(session)) {
    return result(session, [{ type: 'tool-session-finalized' }]);
  }
  if (session.kind !== 'vertices' || session.tool !== 'bezier') {
    return result(session, [{ type: 'tool-session-not-started' }]);
  }
  if (session.points.length !== 4) {
    return result(nextSession(session, session.points, 'finished'), [{ type: 'bezier-requires-four-controls', count: session.points.length }]);
  }
  return createStroke(session, 'bezier', session.points);
}

/** 取消任何未结束会话。取消从不产生候选 stroke。 */
export function cancelEditorToolSession(session: EditorToolSession): EditorToolSessionResult {
  return finalized(session) ? result(session, [{ type: 'tool-session-finalized' }]) : result(nextSession(session, session.points, 'cancelled'));
}
