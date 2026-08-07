import { DragOperationType, Mixin, MixinType, type Pose } from '@system-ui-js/multi-drag';
import {
  type CSSProperties,
  forwardRef,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { useCanvas } from '../hooks/useCanvas';
import { type CanvasPoint, createInitialState, interactionReducer } from '../interaction/reducer';
import {
  formatAngleDegrees,
  formatScalePercent,
  getMouseZoomFeedbackPoint,
  getTouchZoomFeedbackPoint,
  type InteractionFeedbackPoint,
} from '../interactionFeedback';
import {
  buildPointerInteractionInput,
  type ClassifyInteractionOptions,
  classifyInteraction,
  createGestureOwner,
  isSafeInteractiveTarget,
  type PointerInteractionEvent,
} from '../interactionOwnership';
import {
  type BezierStrokeV2,
  DRAWING_STROKE_SCHEMA_VERSION,
  type LineStrokeV2,
  type PolygonStrokeV2,
} from '../model/strokes';
import {
  createTextBoxPoints,
  MIN_TEXT_BOX_WIDTH,
  resizeTextBoxHeight,
  resolveTextBoxHeight,
  resolveTextFontSize,
  TEXT_LINE_HEIGHT,
  textBoxFromPoints,
} from '../model/text';
import { StrokeRenderer } from '../render/StrokeRenderer';
import {
  constrainPointToRulerEdge,
  createRulerEdgeConstraint,
  getInfiniteRulerLayout,
  isInsideRuler,
  projectPointToRulerCenterline,
  projectPointToRulerEdge,
  type RulerEdgeConstraint,
  type RulerPoint,
  type RulerRect,
  rotateRulerAround,
  snapRulerRotation,
} from '../ruler/geometry';
import { RulerTicks } from '../ruler/RulerTicks';
import { installCapturePhaseRulerPointerBridge } from '../rulerPointerBridge';
import { resizeStrokeInSelectionFrame } from '../selectionResize';
import {
  isPointInsideSelectionFrame,
  rotateStrokeAroundSelection,
  type SelectionFrame,
  selectionFrameBoundingBox,
  selectionFrameFromBox,
  selectionFrameFromLocalBox,
  selectionFrameLocalBox,
} from '../selectionRotation';
import {
  appendPoint,
  createStroke,
  createVelocityAdaptivePoints,
  type DrawingStrokeSmoothingOptions,
  isValidStroke,
  resolveStrokeSmoothingOptions,
  type TimedDrawingPoint,
} from '../stroke-helpers';
import {
  computeSelectionBox,
  computeSelectionGeometryBox,
  pickImageStrokeAtPoint,
  pickRenderedStrokeIntersectingPolyline,
  pickRenderedStrokeIntersectingSegment,
  pickTextStrokeAtPoint,
  type RenderedStrokeHitTestOptions,
  resolveSnapPoint,
  SELECTION_BOX_PADDING,
  type SelectionBox,
  type SnapPointResult,
  selectStrokesIntersectingLasso,
} from '../utils';
import { VirtualPaperSurfaceFrame } from '../VirtualPaperSurfaceFrame';
import {
  canvasToScreen,
  resetViewport as createResetViewport,
  type DrawingViewport,
  normalizeViewport,
  screenToCanvas,
} from '../viewport';
import { isVirtualPaperEnabled } from '../virtualPaperAdapter';
import {
  type DrawingSurfaceVirtualPaperOptions,
  SAFE_DEFAULT_VIRTUAL_PAPER_INTERACTIONS,
} from '../virtualPaperOptions';
import {
  POINTER_DOWN_CAPTURE_OPTIONS,
  shouldCaptureVirtualPaperPointerDown,
} from '../virtualPaperPointerCapture';
import { InteractionFeedback } from './InteractionFeedback';
import { Minimap, type MinimapOptions } from './Minimap';

// Public drawing contract types
export type DrawingTool =
  | 'pen'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'polygon'
  | 'bezier'
  | 'text'
  | 'eraser'
  | 'lasso';
export type DrawingInputMethod = 'touch' | 'mouse' | 'pen';

type ZoomFeedbackState = {
  readonly label: string;
  readonly point: InteractionFeedbackPoint;
  readonly source: 'mouse' | 'touch';
};

type TouchDrawingArbitration =
  | { readonly phase: 'idle' }
  | {
      readonly phase: 'pending' | 'drawing' | 'viewport';
      readonly pointerId: number;
    };

/**
 * Eraser commit mode controls when stroke deletions are applied during an
 * eraser gesture.
 *
 * - `"while-sliding"` (default): each stroke hit during the gesture is
 *   deleted immediately while the pointer is moving.
 * - `"on-release"`: stroke hits accumulate in a queue and are deleted
 *   atomically on normal pointerup. Cancel / multi-start / tool change /
 *   value-prop replacement / component cleanup all DISCARD the queue.
 */
export type DrawingEraserCommitMode = 'while-sliding' | 'on-release';

/**
 * 套索选择变化回调。当用户通过 lasso 工具完成一次选择操作时触发，
 * 参数为当前选中的 stroke id 数组。
 */
export type DrawingSelectionChange = (selectedStrokeIds: string[]) => void;

/**
 * 套索选区在宿主元素本地屏幕坐标系下的包围盒（已应用视口变换）。
 * 供外层（如 PaintingBoard）在选区附近放置 Popover 等 UI 使用。
 */
export type DrawingSelectionOverlay = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/**
 * DrawingSurface 的 imperative handle，通过 React ref 获取。
 * 用于从外部以命令式方式操控选区状态。
 *
 * @example
 * ```tsx
 * const ref = useRef<DrawingSurfaceHandle>(null);
 * <DrawingSurface ref={ref} tool="lasso" />
 * // 删除选中的笔画
 * ref.current?.deleteSelectedStrokes();
 * ```
 */
export interface DrawingSurfaceHandle {
  /** 删除所有当前选中的 stroke（内部会同步更新 value 并触发 onChange） */
  deleteSelectedStrokes(): void;
  /** 清除当前选择（将 selectedStrokeIds 置为空数组） */
  clearSelection(): void;
  /** 获取当前选中的 stroke id 数组（快照） */
  getSelectedStrokeIds(): string[];
  /** 获取画布宿主元素的尺寸（CSS 像素），用于 minimap 等外部组件 */
  getHostSize(): { width: number; height: number };
}

export type DrawingPoint = {
  x: number;
  y: number;
  pressure?: number;
};

export type DrawingStroke = {
  id: string;
  tool: DrawingTool | 'image';
  points: DrawingPoint[];
  strokeColor?: string;
  strokeWidth?: number;
  dashArray?: number[];
  dashOffset?: number;
  fillColor?: string;
  fillOpacity?: number;
  rotationRad?: number;
  text?: string;
  fontSize?: number;
  /** 图片元素的数据地址；导入时使用 data URL，随画布值一并持久化。 */
  src?: string;
};

export type DrawingStrokeStyle = Pick<
  DrawingStroke,
  'strokeColor' | 'strokeWidth' | 'dashArray' | 'dashOffset' | 'fillColor' | 'fillOpacity'
>;

export type DrawingValue = {
  strokes: DrawingStroke[];
};

/**
 * State passed to the cursor `render` callback. `screen` is in CSS pixels
 * relative to the host div's top-left corner (same as the pointer event
 * `clientX/Y` minus the host bounding rect). `canvas` is the same point
 * expressed in canvas-local coordinates, derived via `screenToCanvas` so
 * it reflects the current viewport pan/zoom state.
 */
export type DrawingCursorRenderState = {
  /** Pointer position in screen (CSS) pixels relative to the host element. */
  screen: { x: number; y: number };
  /** Pointer position in canvas-local coordinates. */
  canvas: { x: number; y: number };
  /** Pointer type — `'mouse' | 'touch' | 'pen'`, defaulting to `'mouse'`. */
  pointerType: DrawingInputMethod;
  /** Currently active drawing tool. */
  activeTool: DrawingTool;
  /** Whether the crosshair should be visible (hover for mouse/pen; down for touch). */
  visible: boolean;
  /**
   * Eraser pickup radius in screen-space CSS pixels scaled by viewport.scale.
   * Defined ONLY when the active tool is `eraser`; `undefined` for every other
   * tool. The default cursor renderer reads this to draw the eraser hover
   * circle; custom `render` callbacks may also consult it to visualise the same
   * radius.
   */
  eraserRadius?: number;
};

/**
 * Cursor overlay configuration. Pass `false` to disable the overlay entirely.
 * When undefined (the default), the surface renders a 20px screen-pixel
 * crosshair centered on the pointer.
 */
export type DrawingCursorOptions = {
  /** Square size in CSS pixels (length of each cross arm). Defaults to 20. */
  size?: number;
  /** Stroke color used by the default crosshair shape. Defaults to `currentColor`. */
  color?: string;
  /** Override the rendered crosshair entirely. Receives current pointer state. */
  render?: (state: DrawingCursorRenderState) => ReactNode;
};

/**
 * Pen-tip snapping configuration. Disabled by default: omitting `snap`, passing
 * `{}`, or leaving both target booleans false keeps current drawing behavior.
 */
export type DrawingSnapOptions = {
  /** Enable snapping to existing stroke endpoints. Defaults to false. */
  endpoints?: boolean;
  /** Enable snapping to existing line geometry. Defaults to false. */
  lines?: boolean;
  /** Snap search radius in CSS pixels. Defaults to 8 when snapping is enabled. */
  radius?: number;
};

/**
 * Eraser trajectory polyline rendered inside the canvas-transformed `<g>`
 * during an active eraser gesture. Off by default. The polyline is cleared
 * on every gesture terminator (end / cancel / multi-start / tool change /
 * value replacement / unmount). Color and opacity default to `"#ccc"` and
 * `0.5` respectively; lineWidth defaults to the resolved open-stroke width.
 */
export type DrawingEraserTrajectoryOptions = {
  visible?: boolean;
  color?: string;
  opacity?: number;
  lineWidth?: number;
};

export type DrawingEventTargetRef = { readonly current: EventTarget | null };

/**
 * Pointer/mouse/touch listener target for drawing interactions.
 * Defaults to the DrawingSurface host; pass a parent/container element ref to
 * receive gestures there while strokes are still stored in this surface's
 * local SVG coordinate system.
 */
export type DrawingEventTarget = EventTarget | DrawingEventTargetRef | null;

/**
 * 尺子状态描述其宿主元素内的逻辑原点和屏幕旋转角度。尺寸由尺子选项配置。
 */
export type DrawingRulerState = {
  readonly center: RulerPoint;
  /** 顺时针旋转弧度；省略时为 0。 */
  readonly rotationRad?: number;
};

/**
 * Ruler overlay 配置项。
 *
 * - `ruler={false}` 或 `ruler` 省略 → 不显示 ruler
 * - `ruler={{}}` 或 `ruler={{ enabled: true }}` → 启用 ruler，使用默认参数
 * - 受控模式：传入 `ruler.state` + 顶层 `onRulerChange`
 * - 非受控模式：不传 `state`，首次启用时自动居中；隐藏后重新显示会保留几何状态
 */
export type DrawingRulerOptions = {
  /** 是否启用 ruler。省略时默认 true（只要 `ruler` 对象存在即启用）。 */
  readonly enabled?: boolean;
  /** 受控的尺子屏幕中心状态，使用宿主元素内的 CSS 像素坐标。 */
  readonly state?: DrawingRulerState;
  /** 兼容字段；宿主尺寸可用后，尺子会自动延伸到裁剪区域外以隐藏端点。默认 `400`。 */
  readonly length?: number;
  /** Ruler 在屏幕上的高度（CSS 像素）。默认 `48`。 */
  readonly height?: number;
  /**
   * 每物理英寸对应的 CSS 像素数。默认 `96`。
   * 已知显示器面板 PPI 时，可传入 `面板 PPI / devicePixelRatio` 作为初始校准值。
   */
  readonly pixelsPerInch?: number;
  /** Ruler 背景色。默认 `'#e0e0e0'`。 */
  readonly backgroundColor?: string;
  /** Ruler 背景不透明度。默认 `0.2`。 */
  readonly backgroundOpacity?: number;
};

const RULER_CENTER_EPSILON = 1e-6;

type CursorPointer = { x: number; y: number };

type ResolvedDrawingSnapOptions = {
  enabled: boolean;
  endpoints: boolean;
  lines: boolean;
  radius: number;
};

type ResolvedPointerSnap = {
  screen: DrawingPoint;
  canvas: DrawingPoint;
  result: SnapPointResult;
};

export type DrawingSurfaceProps = {
  /** The drawing tool to use. Defaults to 'pen'. */
  tool?: DrawingTool;
  /** Controlled drawing value. */
  value?: DrawingValue;
  /** Initial drawing value for uncontrolled usage. */
  defaultValue?: DrawingValue;
  /** Callback fired when drawing changes (controlled mode). */
  onChange?: (nextValue: DrawingValue) => void;
  /** Stroke color. Defaults to 'black'. Invalid/empty values resolve to 'black'. */
  strokeColor?: string;
  /** Stroke width. Defaults to 2. Non-finite or < 1 values resolve to 2. */
  strokeWidth?: number;
  /** Text font size in canvas units. Defaults to 24. */
  fontSize?: number;
  /** Numeric SVG dash segments. Invalid arrays render as a solid stroke. */
  dashArray?: number[];
  /** Numeric SVG dash offset. Non-finite values are ignored. */
  dashOffset?: number;
  /** Closed-shape fill color. Open tools always render with fill="none". */
  fillColor?: string;
  /** Closed-shape fill opacity. Defaults to 1 when a fill color is rendered. */
  fillOpacity?: number;
  /** Enable velocity-adaptive stroke smoothing. Default: true. */
  strokeSmoothing?: boolean | DrawingStrokeSmoothingOptions;
  /** Allowed input methods. Defaults to ['touch', 'mouse', 'pen']. */
  inputMethods?: DrawingInputMethod[];
  /** Capture and render pen pressure when available. */
  pressure?: boolean;
  /** 采样率（点/秒），控制笔画点密度。0 表示保留所有点。 */
  samplingRate?: number;
  /**
   * Pointer crosshair overlay. Defaults to a 10px screen-pixel cross
   * centered on the pointer. Pass `false` to hide the overlay, or an
   * options object to customize size/color or fully override rendering.
   */
  cursor?: false | DrawingCursorOptions;
  /** Pen-tip snapping configuration. Disabled unless at least one target is enabled. */
  snap?: DrawingSnapOptions;
  /**
   * Controls when eraser deletions are committed. Defaults to `"while-sliding"`
   * (delete each hit stroke immediately during the gesture). `"on-release"`
   * queues hits and deletes them atomically on pointerup; interruptions
   * (cancel, second pointer, tool change, value replacement, unmount)
   * discard the queue.
   */
  eraserCommitMode?: DrawingEraserCommitMode;
  /**
   * Show a live polyline of the current eraser gesture path inside the
   * transformed canvas group (so it pans/zooms with strokes). Off by
   * default. Cleared on every gesture terminator. Color defaults to
   * `"#ccc"`, opacity to `0.5`, and lineWidth to the resolved stroke width.
   */
  eraserTrajectory?: DrawingEraserTrajectoryOptions;
  /**
   * Pressure multiplier applied at render time. Default `1`. Invalid values
   * (NaN, Infinity, non-finite, <=0, non-number) resolve to `1`. Does NOT
   * mutate stored `point.pressure`; only scales rendered width.
   */
  pressureMultiplier?: number;
  /** Test identifier. */
  testID?: string;

  /**
   * Element (or ref) that receives drawing pointer/mouse/touch events.
   * Coordinates remain relative to this DrawingSurface's SVG host, so a parent
   * can own the events and forward the resulting gesture into the child canvas.
   */
  eventTarget?: DrawingEventTarget;
  /** CSS overflow value applied to the root SVG element. */
  overflow?: CSSProperties['overflow'];

  /** 受控的选中 stroke id 列表。配合 onSelectionChange 实现受控选择模式。 */
  selectedStrokeIds?: readonly string[];
  /** 非受控模式下的初始选中 stroke id 列表。 */
  defaultSelectedStrokeIds?: readonly string[];
  /** 选择变化回调，当套索选择操作完成时触发。 */
  onSelectionChange?: DrawingSelectionChange;
  /** 选区开始移动、缩放或旋转时触发。 */
  onSelectionTransformStart?: () => void;
  /** 选区移动、缩放或旋转手势结束时触发。 */
  onSelectionTransformEnd?: () => void;
  /**
   * 套索选区包围盒变化回调。坐标为宿主元素本地屏幕像素（已含视口变换），
   * 选区出现/移动/缩放/视口变化时触发；无选区或非 lasso 工具时回调 null。
   */
  onSelectionOverlayChange?: (overlay: DrawingSelectionOverlay | null) => void;
  /**
   * Ruler overlay 配置。省略或 `false` → 不显示 ruler。
   * 传入 options 对象 → 启用 ruler，可用 `enabled` 字段精细控制。
   */
  ruler?: false | DrawingRulerOptions;
  /** Ruler 状态变化回调（受控模式）。当 ruler 位置/旋转/尺寸变化时触发。 */
  onRulerChange?: (next: DrawingRulerState) => void;
  /** Virtual paper pan/zoom layer. `true` enables safe default interactions. */
  virtualPaper?: boolean | DrawingSurfaceVirtualPaperOptions;
  /**
   * 受控视口状态。传入后 DrawingSurface 将使用此值作为当前视口，
   * 不再使用内部状态。配合 `onViewportChange` 可实现外部与主画布的双向视口同步。
   */
  viewport?: DrawingViewport;
  /** 非受控模式下的初始视口状态。仅在未传入 `viewport` 时生效。 */
  defaultViewport?: DrawingViewport;
  /** 视口变化回调（平移/缩放或 minimap 交互时触发）。 */
  onViewportChange?: (viewport: DrawingViewport) => void;
  /**
   * 小地图 overlay 配置。省略或 `false` -> 不显示 minimap。
   * 传入 options 对象 -> 启用 minimap，可配置尺寸/位置等。
   */
  minimap?: false | MinimapOptions;
};

type PointerInputEvent = {
  pointerType?: string;
  button?: number;
  clientX?: number;
  clientY?: number;
  timeStamp?: number;
};

function isDrawingToolSupported(tool: unknown): tool is DrawingTool {
  return (
    tool === 'pen' ||
    tool === 'line' ||
    tool === 'rect' ||
    tool === 'ellipse' ||
    tool === 'polygon' ||
    tool === 'bezier' ||
    tool === 'text' ||
    tool === 'eraser' ||
    tool === 'lasso'
  );
}

// Tools that use click-to-place interaction rather than drag. Their pointer
// events are routed through `interactionReducer` instead of stroke sampling.
// `line` is hybrid: click placement AND drag both work, so it appears here
// to install click listeners while still allowing drag-line creation.
function isClickToPlaceTool(tool: DrawingTool): boolean {
  return tool === 'polygon' || tool === 'line';
}

function isPlacementReducerTool(tool: DrawingTool): boolean {
  return isClickToPlaceTool(tool) || tool === 'bezier';
}

function isClosedShapeTool(tool: DrawingStroke['tool']): boolean {
  return tool === 'rect' || tool === 'ellipse' || tool === 'polygon';
}

// Shift constraint only applies to bbox-defined shapes (rect/ellipse).
// Polygon is closed but defined by vertex list, not bbox; shift has no meaning there.
function isBboxShapeTool(tool: DrawingStroke['tool']): boolean {
  return tool === 'rect' || tool === 'ellipse';
}

function isSnapEligibleTool(tool: DrawingTool): boolean {
  return (
    tool === 'pen' ||
    tool === 'line' ||
    tool === 'rect' ||
    tool === 'ellipse' ||
    tool === 'polygon' ||
    tool === 'bezier'
  );
}

// Shift 约束：把首末两点收敛为正方形 bbox，保持原拖拽方向（dx/dy 符号不变），
// 长边吸住短边。仅对闭合 bbox 形状（rect/ellipse）生效；其他工具或点数 < 2 时原样返回。
function applyShiftConstraintToShape(stroke: DrawingStroke): DrawingStroke {
  if (!isBboxShapeTool(stroke.tool) || stroke.points.length < 2) {
    return stroke;
  }
  const first = stroke.points[0];
  const last = stroke.points[stroke.points.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const size = Math.max(Math.abs(dx), Math.abs(dy));
  if (size === 0) {
    return stroke;
  }
  const signX = dx === 0 ? 1 : Math.sign(dx);
  const signY = dy === 0 ? 1 : Math.sign(dy);
  const constrainedLast: DrawingPoint = {
    ...last,
    x: first.x + signX * size,
    y: first.y + signY * size,
  };
  const nextPoints = stroke.points.slice(0, -1);
  nextPoints.push(constrainedLast);
  return { ...stroke, points: nextPoints };
}

const DEFAULT_INPUT_METHODS: DrawingInputMethod[] = ['touch', 'mouse', 'pen'];
const LINE_DRAG_THRESHOLD_PX = 4;
// 单指绘制与双指画布操作共享首个触点。只有越过该屏幕距离后，
// 首指才正式承诺为绘制，避免第二指紧接着落下时留下短误笔。
const TOUCH_DRAWING_COMMIT_THRESHOLD_PX = 10;
const LASSO_RESIZE_HANDLE_SIZE_PX = 10;
const LASSO_ROTATE_HANDLE_OFFSET_PX = 24;
const LASSO_ROTATE_HANDLE_SIZE_PX = 14;
const LASSO_ROTATE_HANDLE_HIT_SIZE_PX = 24;
const LASSO_RESIZE_MIN_SIZE = 1;

type LassoResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

type LassoResizeHandleDescriptor = {
  handle: LassoResizeHandle;
  xRatio: number;
  yRatio: number;
  cursor: CSSProperties['cursor'];
};

const LASSO_RESIZE_HANDLES: readonly LassoResizeHandleDescriptor[] = [
  { handle: 'nw', xRatio: 0, yRatio: 0, cursor: 'nwse-resize' },
  { handle: 'n', xRatio: 0.5, yRatio: 0, cursor: 'ns-resize' },
  { handle: 'ne', xRatio: 1, yRatio: 0, cursor: 'nesw-resize' },
  { handle: 'e', xRatio: 1, yRatio: 0.5, cursor: 'ew-resize' },
  { handle: 'se', xRatio: 1, yRatio: 1, cursor: 'nwse-resize' },
  { handle: 's', xRatio: 0.5, yRatio: 1, cursor: 'ns-resize' },
  { handle: 'sw', xRatio: 0, yRatio: 1, cursor: 'nesw-resize' },
  { handle: 'w', xRatio: 0, yRatio: 0.5, cursor: 'ew-resize' },
];

function generateStrokeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function verticesEndWith(
  vertices: { x: number; y: number }[],
  point: { x: number; y: number }
): boolean {
  const last = vertices[vertices.length - 1];
  return last !== undefined && last.x === point.x && last.y === point.y;
}

function totalPathDistance(points: DrawingPoint[]): number {
  let distance = 0;
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const current = points[index];
    distance += Math.hypot(current.x - previous.x, current.y - previous.y);
  }
  return distance;
}

function uniqueStrokeIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      unique.push(id);
    }
  }
  return unique;
}

function areStrokeIdListsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((id, index) => id === right[index]);
}

function cloneStrokeForLassoMove(stroke: DrawingStroke): DrawingStroke {
  return {
    ...stroke,
    points: stroke.points.map((point) => ({ ...point })),
    dashArray: stroke.dashArray ? [...stroke.dashArray] : undefined,
  };
}

function offsetStrokeForLassoMove(stroke: DrawingStroke, dx: number, dy: number): DrawingStroke {
  return {
    ...stroke,
    points: stroke.points.map((point) => ({
      ...point,
      x: point.x + dx,
      y: point.y + dy,
    })),
    dashArray: stroke.dashArray ? [...stroke.dashArray] : undefined,
  };
}

function isLassoResizeHandle(value: string | null): value is LassoResizeHandle {
  switch (value) {
    case 'nw':
    case 'n':
    case 'ne':
    case 'e':
    case 'se':
    case 's':
    case 'sw':
    case 'w':
      return true;
    default:
      return false;
  }
}

function resizeDirectionForHandle(handle: LassoResizeHandle): {
  x: -1 | 0 | 1;
  y: -1 | 0 | 1;
} {
  switch (handle) {
    case 'nw':
      return { x: -1, y: -1 };
    case 'n':
      return { x: 0, y: -1 };
    case 'ne':
      return { x: 1, y: -1 };
    case 'e':
      return { x: 1, y: 0 };
    case 'se':
      return { x: 1, y: 1 };
    case 's':
      return { x: 0, y: 1 };
    case 'sw':
      return { x: -1, y: 1 };
    case 'w':
      return { x: -1, y: 0 };
  }
}

function resolveLassoResizeAxis(
  min: number,
  max: number,
  delta: number,
  direction: -1 | 0 | 1,
  minimumSize = LASSO_RESIZE_MIN_SIZE
): { anchor: number; scale: number } {
  const size = max - min;
  if (direction === 0 || size <= 0) {
    return { anchor: min, scale: 1 };
  }

  if (direction === 1) {
    const anchor = min;
    const movingEdge = Math.max(anchor + minimumSize, max + delta);
    return { anchor, scale: (movingEdge - anchor) / size };
  }

  const anchor = max;
  const movingEdge = Math.min(anchor - minimumSize, min + delta);
  return { anchor, scale: (movingEdge - anchor) / (min - anchor) };
}

function isDrawingInput(
  event: PointerInputEvent | undefined,
  allowedMethods: DrawingInputMethod[]
): boolean {
  if (!event) {
    return false;
  }

  if (event.pointerType === 'pen') {
    return allowedMethods.includes('pen');
  }

  if (event.pointerType === undefined || event.pointerType === 'touch') {
    return allowedMethods.includes('touch');
  }

  if (event.pointerType === 'mouse') {
    return allowedMethods.includes('mouse') && event.button === 0;
  }

  return false;
}

function normalizePointPressure(pressure: number | undefined): number {
  if (pressure === 0) {
    return 0;
  }

  return typeof pressure === 'number' && Number.isFinite(pressure) && pressure >= 0 && pressure <= 1
    ? pressure
    : 1;
}

function resolveDrawingSnapOptions(
  snap: DrawingSnapOptions | undefined
): ResolvedDrawingSnapOptions {
  const endpoints = snap?.endpoints === true;
  const lines = snap?.lines === true;
  const enabled = endpoints || lines;
  const radius =
    enabled && typeof snap?.radius === 'number' && Number.isFinite(snap.radius) && snap.radius > 0
      ? snap.radius
      : 8;

  return { enabled, endpoints, lines, radius };
}

function isEventTargetLike(target: EventTarget | DrawingEventTargetRef): target is EventTarget {
  return 'addEventListener' in target && typeof target.addEventListener === 'function';
}

function resolveDrawingEventTarget(target: DrawingEventTarget | undefined): EventTarget | null {
  if (!target) {
    return null;
  }
  return isEventTargetLike(target) ? target : target.current;
}

function containsEventTarget(container: EventTarget | null, target: EventTarget | null): boolean {
  return container instanceof Node && target instanceof Node && container.contains(target);
}

function clientPointToHostContentBox(
  host: HTMLElement,
  clientX: number,
  clientY: number
): DrawingPoint {
  const bounds = host.getBoundingClientRect();
  return {
    x: clientX - bounds.left - host.clientLeft,
    y: clientY - bounds.top - host.clientTop,
  };
}

function clientPointHitsRuler(
  host: HTMLElement,
  clientX: number,
  clientY: number,
  ruler: RulerRect | null
): boolean {
  if (ruler === null) {
    return false;
  }
  const hostBounds = host.getBoundingClientRect();
  const width = host.clientWidth || hostBounds.width;
  const height = host.clientHeight || hostBounds.height;
  const point = clientPointToHostContentBox(host, clientX, clientY);
  if (point.x < 0 || point.x > width || point.y < 0 || point.y > height) {
    return false;
  }
  return isInsideRuler(point, ruler);
}

function isPointerDomEvent(event: Event): event is PointerEvent {
  return event.type.startsWith('pointer');
}

function isDoubleClickDomEvent(event: Event): event is MouseEvent {
  return event.type === 'dblclick';
}

export const DrawingSurface = forwardRef<DrawingSurfaceHandle, DrawingSurfaceProps>(
  function DrawingSurface(props, ref) {
    const {
      tool,
      value,
      defaultValue,
      onChange,
      strokeColor,
      strokeWidth,
      fontSize,
      dashArray,
      dashOffset,
      fillColor,
      fillOpacity,
      strokeSmoothing,
      inputMethods,
      pressure,
      samplingRate,
      cursor,
      snap,
      pressureMultiplier,
      eraserCommitMode,
      eraserTrajectory,
      testID,
      eventTarget,
      overflow,
      selectedStrokeIds,
      defaultSelectedStrokeIds,
      onSelectionChange,
      onSelectionTransformStart,
      onSelectionTransformEnd,
      onSelectionOverlayChange,
      ruler,
      onRulerChange,
      virtualPaper,
      viewport: viewportProp,
      defaultViewport,
      onViewportChange,
      minimap: minimapProp,
    } = props;
    const minimapOptions = typeof minimapProp === 'object' ? minimapProp : {};
    const minimapEnabled =
      minimapProp !== false && minimapProp !== undefined && minimapOptions.enabled !== false;
    const hostRef = useRef<HTMLDivElement>(null);
    const eventTargetRef = useRef<DrawingEventTarget | undefined>(eventTarget);
    const selectionTransformDragRef = useRef<InstanceType<typeof Mixin> | null>(null);
    const onSelectionTransformStartRef = useRef(onSelectionTransformStart);
    const onSelectionTransformEndRef = useRef(onSelectionTransformEnd);
    onSelectionTransformStartRef.current = onSelectionTransformStart;
    onSelectionTransformEndRef.current = onSelectionTransformEnd;
    const gestureOwnerRef = useRef(createGestureOwner());
    const rulerEdgeConstraintsRef = useRef(new Map<number, RulerEdgeConstraint>());
    const isViewportControlled = viewportProp !== undefined;
    const isVirtualPaperActive = isVirtualPaperEnabled(virtualPaper);
    const resolvedVirtualPaperOptions = typeof virtualPaper === 'object' ? virtualPaper : {};
    const virtualPaperInteractions =
      resolvedVirtualPaperOptions.enabledInteractions ?? SAFE_DEFAULT_VIRTUAL_PAPER_INTERACTIONS;
    const isTouchZoomEnabled = virtualPaperInteractions.includes('touchTwoFingerZoom');
    const shouldArbitrateTouchDrawing =
      isVirtualPaperActive &&
      !virtualPaperInteractions.includes('touchSingleFingerPan') &&
      (virtualPaperInteractions.includes('touchTwoFingerPan') || isTouchZoomEnabled);
    const isCtrlWheelZoomEnabled = virtualPaperInteractions.includes('mouseWheelCtrlZoom');
    const isWheelZoomEnabled = virtualPaperInteractions.includes('mouseWheelZoom');
    const isTrackpadPanEnabled = virtualPaperInteractions.includes('trackpadScrollPan');
    const [internalViewport, setInternalViewport] = useState<DrawingViewport>(() =>
      defaultViewport ? normalizeViewport(defaultViewport) : createResetViewport()
    );
    const viewport = useMemo(
      () => (viewportProp === undefined ? internalViewport : normalizeViewport(viewportProp)),
      [internalViewport, viewportProp]
    );
    const viewportRef = useRef<DrawingViewport>(viewport);
    viewportRef.current = viewport;

    const isViewportControlledRef = useRef(isViewportControlled);
    isViewportControlledRef.current = isViewportControlled;
    const onViewportChangeRef = useRef(onViewportChange);
    onViewportChangeRef.current = onViewportChange;

    const [zoomFeedback, setZoomFeedback] = useState<ZoomFeedbackState | null>(null);
    const wheelZoomPointRef = useRef<InteractionFeedbackPoint | null>(null);
    const wheelZoomPointTimerRef = useRef<number | null>(null);
    const touchZoomPointsRef = useRef(new Map<number, InteractionFeedbackPoint>());
    const touchZoomPointerIdsRef = useRef<readonly [number, number] | null>(null);
    const touchDrawingArbitrationRef = useRef<TouchDrawingArbitration>({
      phase: 'idle',
    });
    const touchZoomEnabledRef = useRef(isTouchZoomEnabled);
    touchZoomEnabledRef.current = isTouchZoomEnabled;
    const zoomFeedbackTimerRef = useRef<number | null>(null);

    const clearZoomFeedbackTimer = useCallback(() => {
      if (zoomFeedbackTimerRef.current !== null) {
        window.clearTimeout(zoomFeedbackTimerRef.current);
        zoomFeedbackTimerRef.current = null;
      }
    }, []);

    const clearWheelZoomPoint = useCallback(() => {
      wheelZoomPointRef.current = null;
      if (wheelZoomPointTimerRef.current !== null) {
        window.clearTimeout(wheelZoomPointTimerRef.current);
        wheelZoomPointTimerRef.current = null;
      }
    }, []);

    const updateTouchZoomFeedback = useCallback(
      (scale: number): boolean => {
        const touchZoomPointerIds = touchZoomPointerIdsRef.current;
        const firstTouchPoint = touchZoomPointerIds
          ? touchZoomPointsRef.current.get(touchZoomPointerIds[0])
          : undefined;
        const secondTouchPoint = touchZoomPointerIds
          ? touchZoomPointsRef.current.get(touchZoomPointerIds[1])
          : undefined;
        if (!touchZoomEnabledRef.current || !firstTouchPoint || !secondTouchPoint) {
          return false;
        }

        const host = hostRef.current;
        const bounds = host?.getBoundingClientRect();
        clearZoomFeedbackTimer();
        setZoomFeedback({
          label: formatScalePercent(scale),
          point: getTouchZoomFeedbackPoint(firstTouchPoint, secondTouchPoint, {
            width: host?.clientWidth || bounds?.width || 0,
            height: host?.clientHeight || bounds?.height || 0,
          }),
          source: 'touch',
        });
        return true;
      },
      [clearZoomFeedbackTimer]
    );

    const handleViewportChange = useCallback(
      (nextViewport: DrawingViewport) => {
        const previousViewport = viewportRef.current;
        viewportRef.current = nextViewport;
        if (!isViewportControlledRef.current) {
          setInternalViewport(nextViewport);
        }
        onViewportChangeRef.current?.(nextViewport);
        if (nextViewport.scale === previousViewport.scale) {
          return;
        }

        if (updateTouchZoomFeedback(nextViewport.scale)) {
          return;
        }

        const wheelPoint = wheelZoomPointRef.current;
        if (!wheelPoint) {
          return;
        }
        clearWheelZoomPoint();
        clearZoomFeedbackTimer();
        setZoomFeedback({
          label: formatScalePercent(nextViewport.scale),
          point: getMouseZoomFeedbackPoint(wheelPoint),
          source: 'mouse',
        });
        zoomFeedbackTimerRef.current = window.setTimeout(() => {
          setZoomFeedback(null);
          zoomFeedbackTimerRef.current = null;
        }, 600);
      },
      [clearWheelZoomPoint, clearZoomFeedbackTimer, updateTouchZoomFeedback]
    );

    const handleVirtualPaperViewportChange = handleViewportChange;

    const internalRulerStateRef = useRef<DrawingRulerState>({
      center: { x: 0, y: 0 },
    });
    const [, renderRuler] = useReducer((tick: number) => tick + 1, 0);
    const [isRulerDragging, setIsRulerDragging] = useState(false);
    const [rulerRotationFeedback, setRulerRotationFeedback] = useState<{
      readonly rotationRad: number;
      readonly point: InteractionFeedbackPoint;
    } | null>(null);
    const [hasRulerModifierHover, setHasRulerModifierHover] = useState(false);
    const [rulerViewportSize, setRulerViewportSize] = useState({
      width: 0,
      height: 0,
    });

    const isRulerEnabled = ruler !== false && ruler !== undefined && (ruler.enabled ?? true);
    const effectiveRulerOptions = typeof ruler === 'object' ? ruler : {};
    const effectiveRulerHeight = effectiveRulerOptions.height ?? 48;
    const currentRulerState = isRulerEnabled
      ? (effectiveRulerOptions.state ?? internalRulerStateRef.current)
      : null;
    const currentRulerRect = currentRulerState
      ? {
          center: currentRulerState.center,
          length: effectiveRulerOptions.length ?? 400,
          height: effectiveRulerHeight,
          rotationRad: currentRulerState.rotationRad ?? 0,
        }
      : null;
    const currentRulerStateRef = useRef<DrawingRulerState | null>(null);
    currentRulerStateRef.current = currentRulerState;
    const currentRulerRectRef = useRef<RulerRect | null>(currentRulerRect);
    currentRulerRectRef.current = currentRulerRect;
    const beginRulerEdgeConstraint = useCallback(
      (pointerId: number, point: DrawingPoint, tool: DrawingTool) => {
        const rulerRect = currentRulerRectRef.current;
        if (!rulerRect || !isSnapEligibleTool(tool)) {
          return;
        }
        rulerEdgeConstraintsRef.current.set(pointerId, createRulerEdgeConstraint(point, rulerRect));
      },
      []
    );
    const applyRulerEdgeConstraint = useCallback(
      (pointerId: number, point: DrawingPoint): DrawingPoint => {
        const constraint = rulerEdgeConstraintsRef.current.get(pointerId);
        if (!constraint) {
          return point;
        }
        const result = constrainPointToRulerEdge(point, constraint);
        rulerEdgeConstraintsRef.current.set(pointerId, result.constraint);
        return result.point;
      },
      []
    );
    const projectLockedRulerEdge = useCallback(
      (pointerId: number, point: DrawingPoint): DrawingPoint => {
        const constraint = rulerEdgeConstraintsRef.current.get(pointerId);
        return constraint?.phase === 'constrained'
          ? projectPointToRulerEdge(point, constraint)
          : point;
      },
      []
    );
    const endRulerEdgeConstraint = useCallback((pointerId: number) => {
      rulerEdgeConstraintsRef.current.delete(pointerId);
    }, []);
    const isPointerReservedForRuler = useCallback((clientX: number, clientY: number) => {
      const host = hostRef.current;
      const rulerRect = currentRulerRectRef.current;
      return host !== null && rulerRect !== null
        ? clientPointHitsRuler(host, clientX, clientY, rulerRect)
        : false;
    }, []);
    const onRulerChangeRef = useRef(onRulerChange);
    onRulerChangeRef.current = onRulerChange;
    const controlledRulerStateRef = useRef(effectiveRulerOptions.state);
    controlledRulerStateRef.current = effectiveRulerOptions.state;
    const lastRequestedRulerCenterRef = useRef<DrawingPoint | null>(null);
    const lastRequestedRulerRotationRef = useRef<number | null>(null);
    const cancelActiveRulerDragRef = useRef<(() => void) | null>(null);
    const hasInitializedRulerRef = useRef(false);

    useLayoutEffect(() => {
      const controlledState = effectiveRulerOptions.state;
      const requestedCenter = lastRequestedRulerCenterRef.current;
      const requestedRotation = lastRequestedRulerRotationRef.current;
      if (!isRulerDragging || !controlledState || !requestedCenter || requestedRotation === null) {
        return;
      }
      const followsRequestedCenter =
        Math.abs(controlledState.center.x - requestedCenter.x) <= RULER_CENTER_EPSILON &&
        Math.abs(controlledState.center.y - requestedCenter.y) <= RULER_CENTER_EPSILON;
      const followsRequestedRotation =
        Math.abs(
          Math.atan2(
            Math.sin((controlledState.rotationRad ?? 0) - requestedRotation),
            Math.cos((controlledState.rotationRad ?? 0) - requestedRotation)
          )
        ) <= RULER_CENTER_EPSILON;
      if (followsRequestedCenter && followsRequestedRotation) {
        return;
      }
      cancelActiveRulerDragRef.current?.();
    }, [effectiveRulerOptions.state, isRulerDragging]);

    useLayoutEffect(() => {
      const host = hostRef.current;
      if (!isRulerEnabled || !host) {
        return undefined;
      }
      const updateSize = () => {
        setRulerViewportSize({
          width: host.clientWidth,
          height: host.clientHeight,
        });
      };
      updateSize();
      if (typeof ResizeObserver === 'undefined') {
        return undefined;
      }
      const observer = new ResizeObserver(updateSize);
      observer.observe(host);
      return () => observer.disconnect();
    }, [isRulerEnabled]);

    useLayoutEffect(() => {
      if (!isRulerEnabled || hasInitializedRulerRef.current) {
        return;
      }
      const host = hostRef.current;
      if (!host) {
        return;
      }
      hasInitializedRulerRef.current = true;
      const existingState = controlledRulerStateRef.current ?? internalRulerStateRef.current;
      const centeredState: DrawingRulerState = {
        ...existingState,
        center: { x: host.clientWidth / 2, y: host.clientHeight / 2 },
      };
      if (controlledRulerStateRef.current) {
        onRulerChangeRef.current?.(centeredState);
        return;
      }
      internalRulerStateRef.current = centeredState;
      currentRulerStateRef.current = centeredState;
      renderRuler();
      onRulerChangeRef.current?.(centeredState);
    }, [isRulerEnabled]);

    useEffect(() => {
      const host = hostRef.current;
      if (!isRulerEnabled || !host) {
        setIsRulerDragging(false);
        setRulerRotationFeedback(null);
        return undefined;
      }

      type ActiveInput = 'mouse-translate' | 'mouse-rotate' | 'touch' | null;
      type DragAnchor = {
        readonly centerToPointer: DrawingPoint;
      };
      type RotationAnchor = {
        readonly pivot: DrawingPoint;
        readonly ruler: {
          readonly center: DrawingPoint;
          readonly rotationRad: number;
        };
        previousPointerAngle: number | null;
        accumulatedRotationRad: number;
      };
      const mouseElement = document.createElement('div');
      const touchElement = document.createElement('div');
      const acceptedTouchIds = new Set<number>();
      const suppressedTouchIds = new Set<number>();
      let activeInput: ActiveInput = null;
      let mousePointerId: number | null = null;
      let dragAnchor: DragAnchor | null = null;
      let rotationAnchor: RotationAnchor | null = null;
      let touchDrag: Mixin;

      const getEmptyPose = (): Pose => ({
        position: { x: 0, y: 0 },
        width: 0,
        height: 0,
      });
      const commitRulerState = (nextState: DrawingRulerState) => {
        lastRequestedRulerCenterRef.current = nextState.center;
        lastRequestedRulerRotationRef.current = nextState.rotationRad ?? 0;
        internalRulerStateRef.current = nextState;
        currentRulerStateRef.current = controlledRulerStateRef.current ?? nextState;
        if (!controlledRulerStateRef.current) {
          renderRuler();
        }
        if (activeInput === 'mouse-rotate') {
          setRulerRotationFeedback((feedback) =>
            feedback ? { ...feedback, rotationRad: nextState.rotationRad ?? 0 } : null
          );
        }
        onRulerChangeRef.current?.(nextState);
      };
      const commitCenterAtScreenPoint = (screenPoint: DrawingPoint) => {
        if (!dragAnchor) {
          return;
        }
        const state = currentRulerStateRef.current;
        const nextState: DrawingRulerState = {
          ...state,
          center: {
            x: screenPoint.x + dragAnchor.centerToPointer.x,
            y: screenPoint.y + dragAnchor.centerToPointer.y,
          },
        };
        commitRulerState(nextState);
      };
      const currentFingerPoint = (mixin: Mixin, index: number) =>
        mixin.getFingers()[index]?.getLastOperation()?.point;
      const toTouchHostPoint = (point: DrawingPoint): DrawingPoint => {
        return clientPointToHostContentBox(host, point.x, point.y);
      };
      const toMouseHostPoint = (point: DrawingPoint): DrawingPoint =>
        clientPointToHostContentBox(host, point.x, point.y);
      const touchMidpoint = (mixin: Mixin): DrawingPoint | null => {
        const first = currentFingerPoint(mixin, 0);
        const second = currentFingerPoint(mixin, 1);
        return first && second
          ? { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
          : null;
      };
      const getTouchPose = (): Pose => {
        const state = currentRulerStateRef.current;
        if (!state) {
          return getEmptyPose();
        }
        const bounds = host.getBoundingClientRect();
        return {
          position: {
            x: state.center.x + bounds.left + host.clientLeft,
            y: state.center.y + bounds.top + host.clientTop,
          },
          rotation: ((state.rotationRad ?? 0) * 180) / Math.PI,
          width: 0,
          height: 0,
        };
      };
      const setTouchPose = (_element: HTMLElement, pose: Partial<Pose>) => {
        if (
          activeInput !== 'touch' ||
          acceptedTouchIds.size !== 2 ||
          !pose.position ||
          !dragAnchor
        ) {
          return;
        }
        const bounds = host.getBoundingClientRect();
        const state = currentRulerStateRef.current;
        if (!state) {
          return;
        }
        const nextState: DrawingRulerState = {
          center: {
            x: pose.position.x - bounds.left - host.clientLeft,
            y: pose.position.y - bounds.top - host.clientTop,
          },
          rotationRad: snapRulerRotation(
            typeof pose.rotation === 'number'
              ? (pose.rotation * Math.PI) / 180
              : (state.rotationRad ?? 0)
          ),
        };
        commitRulerState(nextState);
        const hostMidpoint = {
          x: nextState.center.x - dragAnchor.centerToPointer.x,
          y: nextState.center.y - dragAnchor.centerToPointer.y,
        };
        setRulerRotationFeedback({
          rotationRad: nextState.rotationRad ?? 0,
          point: projectPointToRulerCenterline(hostMidpoint, nextState),
        });
      };
      const createForwardedPointerDown = (event: PointerEvent): Event => {
        const forwarded = new Event('pointerdown');
        Object.defineProperties(forwarded, {
          button: { value: event.button },
          buttons: { value: event.buttons },
          clientX: { value: event.clientX },
          clientY: { value: event.clientY },
          altKey: { value: event.altKey },
          ctrlKey: { value: event.ctrlKey },
          metaKey: { value: event.metaKey },
          pointerId: { value: event.pointerId },
          pointerType: { value: event.pointerType },
          pressure: { value: event.pressure },
          timeStamp: { value: event.timeStamp },
        });
        return forwarded;
      };

      const mouseDrag = new Mixin(
        mouseElement,
        { inertial: false, getPose: getEmptyPose, setPose: () => undefined },
        [MixinType.Drag]
      );
      touchDrag = new Mixin(
        touchElement,
        { inertial: false, getPose: getTouchPose, setPose: setTouchPose },
        [MixinType.Drag, MixinType.Rotate],
        []
      );

      const beginDragAt = (screenPoint: DrawingPoint) => {
        const state = currentRulerStateRef.current;
        if (!state) {
          return;
        }
        dragAnchor = {
          centerToPointer: {
            x: state.center.x - screenPoint.x,
            y: state.center.y - screenPoint.y,
          },
        };
        lastRequestedRulerCenterRef.current = state.center;
        lastRequestedRulerRotationRef.current = state.rotationRad ?? 0;
        setIsRulerDragging(true);
      };
      const beginRotationAt = (screenPoint: DrawingPoint) => {
        const state = currentRulerStateRef.current;
        if (!state) {
          return;
        }
        const rotationRad = state.rotationRad ?? 0;
        const bounds = host.getBoundingClientRect();
        const viewportWidth = host.clientWidth || bounds.width;
        const viewportHeight = host.clientHeight || bounds.height;
        const pivot = getInfiniteRulerLayout({
          logicalCenter: state.center,
          rotationRad,
          height: effectiveRulerHeight,
          viewport: { width: viewportWidth, height: viewportHeight },
        }).visualCenter;
        const distanceFromPivot = Math.hypot(screenPoint.x - pivot.x, screenPoint.y - pivot.y);
        rotationAnchor = {
          pivot,
          ruler: { center: state.center, rotationRad },
          previousPointerAngle:
            distanceFromPivot >= 8
              ? Math.atan2(screenPoint.y - pivot.y, screenPoint.x - pivot.x)
              : null,
          accumulatedRotationRad: 0,
        };
        lastRequestedRulerCenterRef.current = state.center;
        lastRequestedRulerRotationRef.current = state.rotationRad ?? 0;
        setIsRulerDragging(true);
        setRulerRotationFeedback({
          rotationRad: state.rotationRad ?? 0,
          point: pivot,
        });
      };
      const handleMouseMove = () => {
        const point = currentFingerPoint(mouseDrag, 0);
        if (!point) {
          return;
        }
        const hostPoint = toMouseHostPoint(point);
        if (activeInput === 'mouse-translate') {
          commitCenterAtScreenPoint(hostPoint);
        } else if (activeInput === 'mouse-rotate' && rotationAnchor) {
          const { pivot } = rotationAnchor;
          if (Math.hypot(hostPoint.x - pivot.x, hostPoint.y - pivot.y) < 8) {
            rotationAnchor.previousPointerAngle = null;
            return;
          }
          const pointerAngle = Math.atan2(hostPoint.y - pivot.y, hostPoint.x - pivot.x);
          if (rotationAnchor.previousPointerAngle === null) {
            rotationAnchor.previousPointerAngle = pointerAngle;
            return;
          }
          const frameDelta = Math.atan2(
            Math.sin(pointerAngle - rotationAnchor.previousPointerAngle),
            Math.cos(pointerAngle - rotationAnchor.previousPointerAngle)
          );
          rotationAnchor.previousPointerAngle = pointerAngle;
          rotationAnchor.accumulatedRotationRad += frameDelta;
          const snappedTarget = snapRulerRotation(
            rotationAnchor.ruler.rotationRad + rotationAnchor.accumulatedRotationRad
          );
          commitRulerState(
            rotateRulerAround(
              rotationAnchor.ruler,
              pivot,
              snappedTarget - rotationAnchor.ruler.rotationRad
            )
          );
        }
      };
      mouseDrag.addEventListener(DragOperationType.Move, handleMouseMove);

      const restartTouchDrag = () => {
        touchDrag.destroy();
        touchDrag = new Mixin(
          touchElement,
          { inertial: false, getPose: getTouchPose, setPose: setTouchPose },
          [MixinType.Drag, MixinType.Rotate],
          []
        );
      };
      const cancelWaitingTouches = () => {
        for (const pointerId of acceptedTouchIds) {
          suppressedTouchIds.add(pointerId);
        }
        acceptedTouchIds.clear();
        restartTouchDrag();
      };
      const cancelActiveDrag = () => {
        const wasTouchDrag = activeInput === 'touch';
        activeInput = null;
        mousePointerId = null;
        dragAnchor = null;
        rotationAnchor = null;
        lastRequestedRulerCenterRef.current = null;
        lastRequestedRulerRotationRef.current = null;
        setIsRulerDragging(false);
        setRulerRotationFeedback(null);
        if (!wasTouchDrag) {
          return;
        }
        for (const pointerId of acceptedTouchIds) {
          suppressedTouchIds.add(pointerId);
        }
        acceptedTouchIds.clear();
        restartTouchDrag();
      };
      cancelActiveRulerDragRef.current = cancelActiveDrag;
      const handlePointerDown = (event: PointerEvent) => {
        const target = event.target;
        const hitsRuler =
          (target instanceof Element && target.closest('[data-testid="drawing-ruler"]') !== null) ||
          clientPointHitsRuler(host, event.clientX, event.clientY, currentRulerRectRef.current);
        if (!hitsRuler) {
          return;
        }
        if (event.pointerType === 'mouse') {
          const ownsRulerGesture = event.altKey || event.ctrlKey || event.metaKey;
          if (event.button !== 0 || activeInput !== null || !ownsRulerGesture) {
            return;
          }
          cancelWaitingTouches();
          mousePointerId = event.pointerId;
          const hostPoint = toMouseHostPoint({
            x: event.clientX,
            y: event.clientY,
          });
          if (event.altKey) {
            activeInput = 'mouse-rotate';
            beginRotationAt(hostPoint);
          } else if (event.ctrlKey || event.metaKey) {
            activeInput = 'mouse-translate';
            beginDragAt(hostPoint);
          }
          mouseElement.dispatchEvent(createForwardedPointerDown(event));
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (event.pointerType !== 'touch' || activeInput?.startsWith('mouse')) {
          return;
        }
        if (acceptedTouchIds.size >= 2) {
          suppressedTouchIds.add(event.pointerId);
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        acceptedTouchIds.add(event.pointerId);
        touchElement.dispatchEvent(createForwardedPointerDown(event));
        if (acceptedTouchIds.size === 2) {
          const midpoint = touchMidpoint(touchDrag);
          if (!midpoint) {
            return;
          }
          activeInput = 'touch';
          const hostMidpoint = toTouchHostPoint(midpoint);
          beginDragAt(hostMidpoint);
          const state = currentRulerStateRef.current;
          if (state) {
            setRulerRotationFeedback({
              rotationRad: state.rotationRad ?? 0,
              point: projectPointToRulerCenterline(hostMidpoint, state),
            });
          }
        }
        event.preventDefault();
        event.stopPropagation();
      };
      const endPointer = (event: PointerEvent) => {
        if (suppressedTouchIds.delete(event.pointerId)) {
          return;
        }
        if (event.pointerId === mousePointerId) {
          mousePointerId = null;
          activeInput = null;
          dragAnchor = null;
          rotationAnchor = null;
          lastRequestedRulerCenterRef.current = null;
          lastRequestedRulerRotationRef.current = null;
          setIsRulerDragging(false);
          setRulerRotationFeedback(null);
          return;
        }
        if (!acceptedTouchIds.has(event.pointerId)) {
          return;
        }
        acceptedTouchIds.delete(event.pointerId);
        if (activeInput === 'touch') {
          for (const pointerId of acceptedTouchIds) {
            suppressedTouchIds.add(pointerId);
          }
          activeInput = null;
          dragAnchor = null;
          rotationAnchor = null;
          lastRequestedRulerCenterRef.current = null;
          lastRequestedRulerRotationRef.current = null;
          setIsRulerDragging(false);
          setRulerRotationFeedback(null);
        }
        acceptedTouchIds.clear();
        restartTouchDrag();
      };
      const listenerTarget = resolveDrawingEventTarget(eventTarget) ?? host;
      const disposeBridge = installCapturePhaseRulerPointerBridge({
        listenerTarget,
        onPointerDown: handlePointerDown,
      });
      document.addEventListener('pointerup', endPointer, true);
      document.addEventListener('pointercancel', endPointer, true);
      host.addEventListener('lostpointercapture', endPointer, true);

      return () => {
        cancelActiveRulerDragRef.current = null;
        disposeBridge();
        document.removeEventListener('pointerup', endPointer, true);
        document.removeEventListener('pointercancel', endPointer, true);
        host.removeEventListener('lostpointercapture', endPointer, true);
        mouseDrag.removeEventListener(DragOperationType.Move, handleMouseMove);
        mouseDrag.destroy();
        touchDrag.destroy();
        setIsRulerDragging(false);
        setRulerRotationFeedback(null);
      };
    }, [effectiveRulerHeight, eventTarget, isRulerEnabled]);

    useEffect(
      () => () => {
        clearWheelZoomPoint();
        clearZoomFeedbackTimer();
      },
      [clearWheelZoomPoint, clearZoomFeedbackTimer]
    );

    const handleZoomWheelCapture = useCallback(
      (event: WheelEvent) => {
        if (!isVirtualPaperActive) {
          return;
        }
        const usesModifierZoom = (event.ctrlKey || event.metaKey) && isCtrlWheelZoomEnabled;
        const usesPlainWheelZoom =
          !event.ctrlKey && !event.metaKey && isWheelZoomEnabled && !isTrackpadPanEnabled;
        if (!usesModifierZoom && !usesPlainWheelZoom) {
          clearWheelZoomPoint();
          return;
        }
        const host = hostRef.current;
        if (!host) {
          return;
        }
        const bounds = host.getBoundingClientRect();
        const wheelPoint = {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        };
        clearWheelZoomPoint();
        wheelZoomPointRef.current = wheelPoint;
        wheelZoomPointTimerRef.current = window.setTimeout(clearWheelZoomPoint, 250);
      },
      [
        clearWheelZoomPoint,
        isCtrlWheelZoomEnabled,
        isTrackpadPanEnabled,
        isVirtualPaperActive,
        isWheelZoomEnabled,
      ]
    );

    useEffect(() => {
      const host = hostRef.current;
      if (!host) {
        return undefined;
      }
      host.addEventListener('wheel', handleZoomWheelCapture, true);
      return () => {
        host.removeEventListener('wheel', handleZoomWheelCapture, true);
      };
    }, [handleZoomWheelCapture]);

    const handleZoomPointerDownCapture = useCallback(
      (event: ReactPointerEvent<HTMLDivElement>) => {
        const virtualPaperWrapper = event.currentTarget.querySelector(
          '[data-testid="virtual-paper-wrapper"]'
        );
        const isVirtualPaperTouch =
          event.pointerType === 'touch' && containsEventTarget(virtualPaperWrapper, event.target);
        const isRulerTouch = isPointerReservedForRuler(event.clientX, event.clientY);
        const touchDrawingArbitration = touchDrawingArbitrationRef.current;
        if (
          shouldArbitrateTouchDrawing &&
          isVirtualPaperTouch &&
          !isRulerTouch &&
          touchDrawingArbitration.phase !== 'idle' &&
          touchDrawingArbitration.pointerId !== event.pointerId
        ) {
          if (touchDrawingArbitration.phase === 'pending') {
            touchDrawingArbitrationRef.current = {
              phase: 'viewport',
              pointerId: touchDrawingArbitration.pointerId,
            };
          } else if (touchDrawingArbitration.phase === 'drawing') {
            event.preventDefault();
            event.stopPropagation();
            touchZoomPointerIdsRef.current = null;
            touchZoomPointsRef.current.clear();
            setZoomFeedback((current) => (current?.source === 'touch' ? null : current));
            return;
          }
        }
        if (
          !isVirtualPaperActive ||
          !isTouchZoomEnabled ||
          !isVirtualPaperTouch ||
          touchZoomPointerIdsRef.current !== null ||
          touchZoomPointsRef.current.size >= 2 ||
          isRulerTouch
        ) {
          return;
        }
        const bounds = event.currentTarget.getBoundingClientRect();
        touchZoomPointsRef.current.set(event.pointerId, {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        });
        const pointerIds = Array.from(touchZoomPointsRef.current.keys());
        const firstPointerId = pointerIds[0];
        const secondPointerId = pointerIds[1];
        if (firstPointerId !== undefined && secondPointerId !== undefined) {
          touchZoomPointerIdsRef.current = [firstPointerId, secondPointerId];
        }
      },
      [
        isPointerReservedForRuler,
        isTouchZoomEnabled,
        isVirtualPaperActive,
        shouldArbitrateTouchDrawing,
      ]
    );

    const handleZoomPointerMoveCapture = useCallback(
      (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!touchZoomPointsRef.current.has(event.pointerId)) {
          return;
        }
        const bounds = event.currentTarget.getBoundingClientRect();
        touchZoomPointsRef.current.set(event.pointerId, {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        });
        if (touchZoomPointerIdsRef.current?.includes(event.pointerId)) {
          updateTouchZoomFeedback(viewportRef.current.scale);
        }
      },
      [updateTouchZoomFeedback]
    );

    const handleZoomPointerEndCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
      const touchZoomPointerIds = touchZoomPointerIdsRef.current;
      if (!touchZoomPointsRef.current.has(event.pointerId)) {
        return;
      }
      if (touchZoomPointerIds?.includes(event.pointerId)) {
        touchZoomPointerIdsRef.current = null;
        touchZoomPointsRef.current.clear();
        setZoomFeedback((current) => (current?.source === 'touch' ? null : current));
        return;
      }
      touchZoomPointsRef.current.delete(event.pointerId);
    }, []);

    useEffect(() => {
      const finishTouchZoom = (event: PointerEvent) => {
        const touchZoomPointerIds = touchZoomPointerIdsRef.current;
        if (!touchZoomPointsRef.current.has(event.pointerId)) {
          return;
        }
        if (touchZoomPointerIds?.includes(event.pointerId)) {
          touchZoomPointerIdsRef.current = null;
          touchZoomPointsRef.current.clear();
          setZoomFeedback((current) => (current?.source === 'touch' ? null : current));
          return;
        }
        touchZoomPointsRef.current.delete(event.pointerId);
      };
      document.addEventListener('pointerup', finishTouchZoom, true);
      document.addEventListener('pointercancel', finishTouchZoom, true);
      return () => {
        document.removeEventListener('pointerup', finishTouchZoom, true);
        document.removeEventListener('pointercancel', finishTouchZoom, true);
      };
    }, []);

    useEffect(() => {
      if (isVirtualPaperActive && isTouchZoomEnabled) {
        return;
      }
      touchZoomPointerIdsRef.current = null;
      touchZoomPointsRef.current.clear();
      setZoomFeedback((current) => (current?.source === 'touch' ? null : current));
    }, [isTouchZoomEnabled, isVirtualPaperActive]);

    const effectiveTool: DrawingTool = isDrawingToolSupported(tool) ? tool : 'pen';
    const isDrawingEnabled = tool === undefined || isDrawingToolSupported(tool);
    eventTargetRef.current = eventTarget;

    const resolvedColor = strokeColor && strokeColor.trim() !== '' ? strokeColor : 'black';
    const resolvedFontSize = resolveTextFontSize(fontSize);
    const resolvedOpenWidth =
      typeof strokeWidth === 'number' && Number.isFinite(strokeWidth) && strokeWidth >= 1
        ? strokeWidth
        : 2;
    const resolvedClosedWidth =
      typeof strokeWidth === 'number' && Number.isFinite(strokeWidth) && strokeWidth >= 0
        ? strokeWidth
        : 1;
    const resolvedDashArray = dashArray ? [...dashArray] : undefined;
    const resolvedDashOffset =
      typeof dashOffset === 'number' && Number.isFinite(dashOffset) ? dashOffset : undefined;
    const resolvedFillOpacity =
      typeof fillOpacity === 'number' && Number.isFinite(fillOpacity) ? fillOpacity : undefined;

    const resolvedSamplingRate =
      typeof samplingRate === 'number' && Number.isFinite(samplingRate) && samplingRate > 0
        ? samplingRate
        : 0;

    const resolvedSnapOptions = resolveDrawingSnapOptions(snap);

    // Pressure multiplier: invalid (NaN, Infinity, non-finite, <=0, non-number) → 1.
    const resolvedPressureMultiplier =
      typeof pressureMultiplier === 'number' &&
      Number.isFinite(pressureMultiplier) &&
      pressureMultiplier > 0
        ? pressureMultiplier
        : 1;

    const resolvedEraserCommitMode: DrawingEraserCommitMode =
      eraserCommitMode === 'on-release' ? 'on-release' : 'while-sliding';

    const resolvedEraserTrajectory = useMemo(() => {
      const visible = eraserTrajectory?.visible ?? false;
      const rawColor = eraserTrajectory?.color;
      const color = typeof rawColor === 'string' && rawColor.trim().length > 0 ? rawColor : '#ccc';
      const rawOpacity = eraserTrajectory?.opacity;
      const opacity =
        typeof rawOpacity === 'number' && Number.isFinite(rawOpacity)
          ? Math.max(0, Math.min(1, rawOpacity))
          : 0.5;
      const rawLineWidth = eraserTrajectory?.lineWidth;
      const lineWidth =
        typeof rawLineWidth === 'number' && Number.isFinite(rawLineWidth) && rawLineWidth > 0
          ? rawLineWidth
          : resolvedOpenWidth;
      return { visible, color, opacity, lineWidth };
    }, [eraserTrajectory, resolvedOpenWidth]);

    const hasCapturedDefaultValueRef = useRef(false);
    const initialDefaultValueRef = useRef<DrawingValue | undefined>(undefined);
    if (!hasCapturedDefaultValueRef.current) {
      hasCapturedDefaultValueRef.current = true;
      initialDefaultValueRef.current = defaultValue
        ? {
            strokes: defaultValue.strokes.map((stroke) => ({
              ...stroke,
              strokeColor: stroke.strokeColor ?? resolvedColor,
              strokeWidth:
                stroke.strokeWidth ??
                (isClosedShapeTool(stroke.tool) ? resolvedClosedWidth : resolvedOpenWidth),
              dashArray: stroke.dashArray ?? resolvedDashArray,
              dashOffset: stroke.dashOffset ?? resolvedDashOffset,
              fillColor: stroke.fillColor ?? fillColor,
              fillOpacity: stroke.fillOpacity ?? resolvedFillOpacity,
            })),
          }
        : undefined;
    }

    const {
      strokes,
      activeStroke,
      setActiveStroke,
      addStroke,
      removeStroke,
      removeStrokes: removeStrokesFromCanvas,
      updateStrokes: updateStrokesInCanvas,
    } = useCanvas({
      value,
      onChange,
      defaultValue: initialDefaultValueRef.current,
    });

    const [internalSelectedIds, setInternalSelectedIds] = useState<string[]>(() =>
      uniqueStrokeIds(defaultSelectedStrokeIds ?? [])
    );
    const isSelectionControlled = selectedStrokeIds !== undefined;
    const selectedIds = useMemo(
      () => uniqueStrokeIds(isSelectionControlled ? selectedStrokeIds : internalSelectedIds),
      [internalSelectedIds, isSelectionControlled, selectedStrokeIds]
    );
    const selectedTextStroke = useMemo(() => {
      if (selectedIds.length !== 1) {
        return null;
      }
      return (
        strokes.find((stroke) => stroke.id === selectedIds[0] && stroke.tool === 'text') ?? null
      );
    }, [selectedIds, strokes]);
    const selectionBox = useMemo(
      () => computeSelectionBox(strokes, selectedIds),
      [strokes, selectedIds]
    );
    const selectionFrameFromTextStroke = useCallback((textStroke: DrawingStroke) => {
      const textBox = textBoxFromPoints(textStroke.points);
      if (textBox === null) {
        return null;
      }
      return {
        center: {
          x: textBox.x + textBox.width / 2,
          y: textBox.y + textBox.height / 2,
        },
        width: textBox.width + SELECTION_BOX_PADDING * 2,
        height: textBox.height + SELECTION_BOX_PADDING * 2,
        rotationRad:
          typeof textStroke.rotationRad === 'number' && Number.isFinite(textStroke.rotationRad)
            ? textStroke.rotationRad
            : 0,
      };
    }, []);
    const resolveSelectionFrame = useCallback(
      (box: SelectionBox | null): SelectionFrame | null => {
        if (selectedTextStroke === null) {
          return box === null ? null : selectionFrameFromBox(box);
        }
        return selectionFrameFromTextStroke(selectedTextStroke);
      },
      [selectedTextStroke, selectionFrameFromTextStroke]
    );
    const selectionIdentity = selectedIds.join('\u0000');
    const [selectionFrame, setSelectionFrame] = useState<SelectionFrame | null>(() =>
      resolveSelectionFrame(selectionBox)
    );
    const selectedIdsRef = useRef<readonly string[]>(selectedIds);
    const selectionBoxRef = useRef(selectionBox);
    const selectionFrameRef = useRef<SelectionFrame | null>(selectionFrame);
    const previousSelectionIdentityRef = useRef(selectionIdentity);
    const onSelectionChangeRef = useRef(onSelectionChange);
    const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
    const [editingTextId, setEditingTextId] = useState<string | null>(null);
    const editingTextIdRef = useRef<string | null>(editingTextId);
    const textEditorRef = useRef<HTMLTextAreaElement>(null);

    editingTextIdRef.current = editingTextId;

    useEffect(() => {
      if (editingTextId !== null) {
        textEditorRef.current?.focus();
      }
    }, [editingTextId]);

    const commitSelectionFrame = useCallback((nextFrame: SelectionFrame | null) => {
      selectionFrameRef.current = nextFrame;
      setSelectionFrame(nextFrame);
    }, []);

    useLayoutEffect(() => {
      if (previousSelectionIdentityRef.current === selectionIdentity) {
        return;
      }
      previousSelectionIdentityRef.current = selectionIdentity;
      commitSelectionFrame(resolveSelectionFrame(selectionBox));
    }, [commitSelectionFrame, resolveSelectionFrame, selectionBox, selectionIdentity]);

    const activeSelectionFrame =
      selectionBox === null ? null : (selectionFrame ?? resolveSelectionFrame(selectionBox));
    selectionFrameRef.current = activeSelectionFrame;

    useEffect(() => {
      selectedIdsRef.current = selectedIds;
    }, [selectedIds]);

    useEffect(() => {
      selectionBoxRef.current = selectionBox;
    }, [selectionBox]);

    onSelectionChangeRef.current = onSelectionChange;

    const commitSelection = useCallback(
      (nextIds: readonly string[]) => {
        const next = uniqueStrokeIds(nextIds);
        const current = selectedIdsRef.current;
        if (areStrokeIdListsEqual(current, next)) {
          return;
        }
        selectedIdsRef.current = next;
        commitSelectionFrame(null);
        if (!isSelectionControlled) {
          setInternalSelectedIds(next);
        }
        onSelectionChangeRef.current?.(next);
      },
      [commitSelectionFrame, isSelectionControlled]
    );

    const finishEditingText = useCallback((): string | null => {
      const textId = editingTextIdRef.current;
      if (textId === null) {
        return null;
      }
      const textStroke = strokesRef.current.find(
        (stroke) => stroke.id === textId && stroke.tool === 'text'
      );
      let removedTextId: string | null = null;
      if (textStroke !== undefined && !(textStroke.text ?? '').trim()) {
        removeStrokeRef.current(textId);
        commitSelection(selectedIdsRef.current.filter((id) => id !== textId));
        removedTextId = textId;
      }
      editingTextIdRef.current = null;
      setEditingTextId(null);
      return removedTextId;
    }, [commitSelection]);

    // Click-to-place interaction state (polygon tool). The standalone reducer from Task 5
    // owns all vertex/cursor bookkeeping and completion semantics; we only translate native
    // pointer events to reducer actions and observe `completedStroke` to commit.
    const [interactionState, dispatchInteraction] = useReducer(
      interactionReducer,
      effectiveTool,
      createInitialState
    );
    const isDrawingRef = useRef(false);
    const cursorPointersRef = useRef(new Map<number, CursorPointer>());
    const processedPathLengthRef = useRef(0);
    const effectiveToolRef = useRef(effectiveTool);
    const previousToolForCleanupRef = useRef(effectiveTool);
    const isDrawingEnabledRef = useRef(isDrawingEnabled);
    // Ruler 启用状态 ref，供 drawing effect 内部读取最新值
    // （drawing effect 依赖数组不含 isRulerEnabled，需通过 ref 避免闭包陈旧值）
    const isRulerEnabledRef = useRef(isRulerEnabled);
    const virtualPaperEnabledRef = useRef(isVirtualPaperActive);
    const virtualPaperInteractionsRef = useRef(resolvedVirtualPaperOptions.enabledInteractions);
    const previousValueRef = useRef(value);
    const addStrokeRef = useRef(addStroke);
    const removeStrokeRef = useRef(removeStroke);
    const removeStrokesRef = useRef(removeStrokesFromCanvas);
    const updateStrokesRef = useRef(updateStrokesInCanvas);
    const clearActiveStrokeRef = useRef<(() => void) | null>(null);
    const resolvedColorRef = useRef(resolvedColor);
    const resolvedFontSizeRef = useRef(resolvedFontSize);
    const resolvedOpenWidthRef = useRef(resolvedOpenWidth);
    const resolvedClosedWidthRef = useRef(resolvedClosedWidth);
    const resolvedPressureMultiplierRef = useRef(resolvedPressureMultiplier);
    const resolvedDashArrayRef = useRef(resolvedDashArray);
    const resolvedDashOffsetRef = useRef(resolvedDashOffset);
    const resolvedFillColorRef = useRef(fillColor);
    const resolvedFillOpacityRef = useRef(resolvedFillOpacity);
    const strokesRef = useRef(strokes);
    const pressureRef = useRef(pressure);
    const inputMethodsRef = useRef<DrawingInputMethod[]>(DEFAULT_INPUT_METHODS);
    const smoothingOptionsRef = useRef(resolveStrokeSmoothingOptions(strokeSmoothing));
    // Snapping is only normalized and exposed through a ref in this task. Pointer
    // listeners can read current values later without closing over stale props.
    const snapOptionsRef = useRef<ResolvedDrawingSnapOptions>(resolvedSnapOptions);

    const samplingRateRef = useRef(samplingRate);
    const pendingPointsRef = useRef<TimedDrawingPoint[]>([]);
    // 跟踪最后一个被保留的采样点的时间戳，用于按采样率降采样
    const lastSampledTimestampRef = useRef(0);
    // Shift 键按下状态：用于 rect/ellipse 工具的正方形/正圆约束。
    // PointerEvent 不保证每个采样都带可用 shiftKey，改用 window 监听。
    const shiftPressedRef = useRef(false);
    // eraserCommitMode 解析后值，pointer 管线通过 ref 读取避免重建监听
    const eraserCommitModeRef = useRef<DrawingEraserCommitMode>(resolvedEraserCommitMode);
    // on-release 模式累计命中的 stroke id；正常 pointerup 时统一删除，
    // cancel/multi-start/tool-change/value 替换/卸载时丢弃。
    const eraserQueuedHitsRef = useRef<Set<string>>(new Set());
    const eraserProcessedHitsRef = useRef<Set<string>>(new Set());

    const [lassoPreviewPoints, setLassoPreviewPoints] = useState<DrawingPoint[]>([]);
    const [lassoMode, setLassoMode] = useState<'idle' | 'drawing' | 'moving'>('idle');
    // 套索临时点始终存 canvas 坐标；state 只负责预览，ref 负责 pointer 管线同步读取。
    const lassoPointsRef = useRef<DrawingPoint[]>([]);
    const selectionMoveRef = useRef<{
      pointerId: number;
      startCanvasPoint: DrawingPoint;
      originals: DrawingStroke[];
      frame: SelectionFrame;
    } | null>(null);
    const lassoModeRef = useRef<'idle' | 'drawing' | 'moving'>(lassoMode);
    const lassoMoveTransactionActiveRef = useRef(false);

    const beginLassoMoveTransaction = useCallback(() => {
      if (lassoMoveTransactionActiveRef.current) {
        return;
      }
      lassoMoveTransactionActiveRef.current = true;
      onSelectionTransformStartRef.current?.();
    }, []);

    const clearLassoInteraction = useCallback(() => {
      if (lassoMoveTransactionActiveRef.current) {
        lassoMoveTransactionActiveRef.current = false;
        onSelectionTransformEndRef.current?.();
      }
      lassoPointsRef.current = [];
      selectionMoveRef.current = null;
      lassoModeRef.current = 'idle';
      setLassoMode('idle');
      setLassoPreviewPoints((prev) => (prev.length === 0 ? prev : []));
    }, []);
    const clearLassoInteractionRef = useRef(clearLassoInteraction);
    clearLassoInteractionRef.current = clearLassoInteraction;

    const handleDocumentPointerDown = useCallback(
      (event: PointerEvent) => {
        const host = hostRef.current;
        const target = event.target;
        const listenerTarget = resolveDrawingEventTarget(eventTargetRef.current);
        if (containsEventTarget(host, target) || containsEventTarget(listenerTarget, target)) {
          return;
        }
        // 点击外部交互控件（如工具栏按钮）时不应取消套索选择，否则依赖选中的按钮（如删除）会失效。
        if (isSafeInteractiveTarget(target)) {
          return;
        }
        if (lassoModeRef.current !== 'idle' || selectionMoveRef.current !== null) {
          return;
        }
        commitSelection([]);
      },
      [commitSelection]
    );

    const getInteractionOwnerOptions = useCallback(
      (input: ClassifyInteractionOptions['input'], activeTouchPointers = 1) => ({
        input,
        isDrawingEnabled: isDrawingEnabledRef.current,
        isRulerEnabled: isRulerEnabledRef.current,
        virtualPaperEnabled: virtualPaperEnabledRef.current,
        virtualPaperInteractions: virtualPaperInteractionsRef.current,
        allowedDrawingInputMethods: inputMethodsRef.current,
        activeTouchPointers,
      }),
      []
    );
    const buildSurfacePointerInteractionInput = useCallback(
      (event: PointerInteractionEvent, buttonOverride?: number) => {
        const host = hostRef.current;
        return {
          ...buildPointerInteractionInput(event, buttonOverride),
          hitsRuler:
            host !== null &&
            clientPointHitsRuler(host, event.clientX, event.clientY, currentRulerRectRef.current),
        };
      },
      []
    );

    // 当前橡皮手势在 canvas 坐标系下的轨迹点；空数组表示当前无活动手势。
    // 每次 single-move 追加一个点；single-end / cancel / multi-start /
    // 切换工具 / value prop 替换 / 卸载 都重置为空数组。
    const [eraserTrajectoryPoints, setEraserTrajectoryPoints] = useState<DrawingPoint[]>([]);
    // 轨迹 state 负责渲染 polyline；ref 负责 pointermove 中的同步碰撞检测。
    // React state 会滞后一帧，所以橡皮段扫必须以 ref 作为实时数据源。
    const eraserTrajectoryPointsRef = useRef<DrawingPoint[]>([]);
    const eraserGestureStartCanvasPointRef = useRef<DrawingPoint | null>(null);
    const clearEraserTrajectory = useCallback(() => {
      eraserTrajectoryPointsRef.current = [];
      eraserGestureStartCanvasPointRef.current = null;
      eraserProcessedHitsRef.current.clear();
      setEraserTrajectoryPoints((prev) => (prev.length === 0 ? prev : []));
    }, []);
    const clearEraserTrajectoryRef = useRef(clearEraserTrajectory);
    clearEraserTrajectoryRef.current = clearEraserTrajectory;
    const appendEraserTrajectoryPoint = useCallback((point: DrawingPoint) => {
      eraserTrajectoryPointsRef.current.push(point);
      setEraserTrajectoryPoints((prev) => [...prev, point]);
    }, []);
    const appendEraserTrajectoryPointRef = useRef(appendEraserTrajectoryPoint);
    appendEraserTrajectoryPointRef.current = appendEraserTrajectoryPoint;

    effectiveToolRef.current = effectiveTool;
    isDrawingEnabledRef.current = isDrawingEnabled;
    isRulerEnabledRef.current = isRulerEnabled;
    virtualPaperEnabledRef.current = isVirtualPaperActive;
    virtualPaperInteractionsRef.current = resolvedVirtualPaperOptions.enabledInteractions;
    addStrokeRef.current = addStroke;
    removeStrokeRef.current = removeStroke;
    removeStrokesRef.current = removeStrokesFromCanvas;
    updateStrokesRef.current = updateStrokesInCanvas;
    strokesRef.current = strokes;
    resolvedColorRef.current = resolvedColor;
    resolvedFontSizeRef.current = resolvedFontSize;
    resolvedOpenWidthRef.current = resolvedOpenWidth;
    resolvedClosedWidthRef.current = resolvedClosedWidth;
    resolvedPressureMultiplierRef.current = resolvedPressureMultiplier;
    resolvedDashArrayRef.current = resolvedDashArray;
    resolvedDashOffsetRef.current = resolvedDashOffset;
    resolvedFillColorRef.current = fillColor;
    resolvedFillOpacityRef.current = resolvedFillOpacity;
    pressureRef.current = pressure;
    inputMethodsRef.current = inputMethods ?? DEFAULT_INPUT_METHODS;
    smoothingOptionsRef.current = resolveStrokeSmoothingOptions(strokeSmoothing);
    snapOptionsRef.current = resolvedSnapOptions;
    samplingRateRef.current = resolvedSamplingRate;
    eraserCommitModeRef.current = resolvedEraserCommitMode;
    lassoModeRef.current = lassoMode;

    useEffect(() => {
      const existingStrokeIds = new Set(strokes.map((stroke) => stroke.id));
      const prunedIds = selectedIdsRef.current.filter((id) => existingStrokeIds.has(id));
      commitSelection(prunedIds);
    }, [commitSelection, strokes]);

    const previousTextStyleRef = useRef({
      color: resolvedColor,
      fontSize: resolvedFontSize,
    });
    useEffect(() => {
      const previous = previousTextStyleRef.current;
      previousTextStyleRef.current = {
        color: resolvedColor,
        fontSize: resolvedFontSize,
      };
      if (
        effectiveTool !== 'text' ||
        selectedTextStroke === null ||
        (previous.color === resolvedColor && previous.fontSize === resolvedFontSize)
      ) {
        return;
      }
      const nextStroke = {
        ...selectedTextStroke,
        strokeColor: resolvedColor,
        fontSize: resolvedFontSize,
        points: resizeTextBoxHeight(
          selectedTextStroke.points,
          resolveTextBoxHeight(
            selectedTextStroke.text ?? '',
            resolvedFontSize,
            textBoxFromPoints(selectedTextStroke.points)?.width ?? MIN_TEXT_BOX_WIDTH
          )
        ),
      };
      updateStrokesInCanvas([nextStroke]);
      commitSelectionFrame(selectionFrameFromTextStroke(nextStroke));
    }, [
      commitSelectionFrame,
      effectiveTool,
      resolvedColor,
      resolvedFontSize,
      selectedTextStroke,
      selectionFrameFromTextStroke,
      updateStrokesInCanvas,
    ]);

    const onSelectionOverlayChangeRef = useRef(onSelectionOverlayChange);
    useEffect(() => {
      onSelectionOverlayChangeRef.current = onSelectionOverlayChange;
    }, [onSelectionOverlayChange]);

    // 将套索选区包围盒换算为宿主本地屏幕坐标并同步给外层，
    // 外层据此在选区附近放置 Popover（第一期：删除按钮）。
    useEffect(() => {
      const callback = onSelectionOverlayChangeRef.current;
      if (!callback) {
        return;
      }
      if (effectiveTool !== 'lasso' || selectedIds.length === 0 || selectionBox == null) {
        callback(null);
        return;
      }
      if (activeSelectionFrame === null) {
        callback(null);
        return;
      }
      const frameBounds = selectionFrameBoundingBox(activeSelectionFrame);
      const topLeft = canvasToScreen({ x: frameBounds.minX, y: frameBounds.minY }, viewport);
      const bottomRight = canvasToScreen({ x: frameBounds.maxX, y: frameBounds.maxY }, viewport);
      callback({
        x: topLeft.x,
        y: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
      });
    }, [activeSelectionFrame, effectiveTool, selectedIds.length, selectionBox, viewport]);

    useEffect(() => {
      const host = hostRef.current;
      if (!host) {
        return undefined;
      }

      type ResizeGesture = {
        kind: 'resize';
        handle: LassoResizeHandle;
        frame: SelectionFrame;
        geometryBox: SelectionBox;
        originals: DrawingStroke[];
        lastPosition: Pose['position'] | null;
        minimumWidth: number;
      };

      type RotateGesture = {
        kind: 'rotate';
        pointerId: number;
        center: DrawingPoint;
        centerScreen: DrawingPoint;
        originals: DrawingStroke[];
        frame: SelectionFrame;
        previousPointerAngle: number;
        accumulatedRotationRad: number;
      };

      type MoveGesture = {
        kind: 'move';
        originals: DrawingStroke[];
        frame: SelectionFrame;
        lastPosition: Pose['position'] | null;
      };

      type SelectionTransformGesture = MoveGesture | ResizeGesture | RotateGesture;

      let gesture: SelectionTransformGesture | null = null;
      let finalPointer: {
        readonly pointerId: number;
        readonly point: DrawingPoint;
      } | null = null;
      const getPose = (): Pose => ({
        position: { x: 0, y: 0 },
        width: 0,
        height: 0,
      });
      const applySelectionTransformPose = (pose: Partial<Pose>) => {
        if (!gesture) {
          return;
        }

        if (gesture.kind === 'rotate') {
          const rotateGesture = gesture;
          const [finger] = multiDrag.getFingers();
          const current =
            finger?.getLastOperation()?.point ??
            (finalPointer?.pointerId === rotateGesture.pointerId ? finalPointer.point : undefined);
          if (!current) {
            return;
          }

          const currentAngle = Math.atan2(
            current.y - rotateGesture.centerScreen.y,
            current.x - rotateGesture.centerScreen.x
          );
          let rotationDelta = currentAngle - rotateGesture.previousPointerAngle;
          if (rotationDelta > Math.PI) {
            rotationDelta -= Math.PI * 2;
          } else if (rotationDelta < -Math.PI) {
            rotationDelta += Math.PI * 2;
          }
          if (rotationDelta === 0) {
            return;
          }
          rotateGesture.previousPointerAngle = currentAngle;
          rotateGesture.accumulatedRotationRad += rotationDelta;
          commitSelectionFrame({
            ...rotateGesture.frame,
            rotationRad: rotateGesture.frame.rotationRad + rotateGesture.accumulatedRotationRad,
          });
          updateStrokesRef.current(
            rotateGesture.originals.map((stroke) =>
              rotateStrokeAroundSelection(
                stroke,
                rotateGesture.center,
                rotateGesture.accumulatedRotationRad
              )
            )
          );
          return;
        }

        if (!pose.position) {
          return;
        }

        if (gesture.kind === 'move') {
          const moveGesture = gesture;
          if (
            moveGesture.lastPosition?.x === pose.position.x &&
            moveGesture.lastPosition.y === pose.position.y
          ) {
            return;
          }
          moveGesture.lastPosition = pose.position;

          const viewportScale = viewportRef.current.scale;
          const dx = pose.position.x / viewportScale;
          const dy = pose.position.y / viewportScale;
          updateStrokesRef.current(
            moveGesture.originals.map((stroke) => offsetStrokeForLassoMove(stroke, dx, dy))
          );
          commitSelectionFrame({
            ...moveGesture.frame,
            center: {
              x: moveGesture.frame.center.x + dx,
              y: moveGesture.frame.center.y + dy,
            },
          });
          return;
        }

        const resizeGesture = gesture;

        if (
          resizeGesture.lastPosition?.x === pose.position.x &&
          resizeGesture.lastPosition.y === pose.position.y
        ) {
          return;
        }
        resizeGesture.lastPosition = pose.position;

        const viewportScale = viewportRef.current.scale;
        const direction = resizeDirectionForHandle(resizeGesture.handle);
        const worldDeltaX = pose.position.x / viewportScale;
        const worldDeltaY = pose.position.y / viewportScale;
        const cosine = Math.cos(resizeGesture.frame.rotationRad);
        const sine = Math.sin(resizeGesture.frame.rotationRad);
        const localDeltaX = worldDeltaX * cosine + worldDeltaY * sine;
        const localDeltaY = -worldDeltaX * sine + worldDeltaY * cosine;
        const xAxis = resolveLassoResizeAxis(
          resizeGesture.geometryBox.minX,
          resizeGesture.geometryBox.maxX,
          localDeltaX,
          direction.x,
          resizeGesture.minimumWidth
        );
        const yAxis = resolveLassoResizeAxis(
          resizeGesture.geometryBox.minY,
          resizeGesture.geometryBox.maxY,
          localDeltaY,
          direction.y
        );
        const nextStrokes = resizeGesture.originals.map((stroke) => {
          const resizedStroke = resizeStrokeInSelectionFrame(stroke, {
            frame: resizeGesture.frame,
            xAxis,
            yAxis,
          });
          if (resizeGesture.originals.length !== 1 || resizedStroke.tool !== 'text') {
            return resizedStroke;
          }
          const resizedTextBox = textBoxFromPoints(resizedStroke.points);
          if (resizedTextBox === null) {
            return resizedStroke;
          }
          return {
            ...resizedStroke,
            points: resizeTextBoxHeight(
              resizedStroke.points,
              resolveTextBoxHeight(
                resizedStroke.text ?? '',
                resolveTextFontSize(resizedStroke.fontSize),
                resizedTextBox.width
              )
            ),
          };
        });
        updateStrokesRef.current(nextStrokes);
        const localStrokes = nextStrokes.map((stroke) =>
          rotateStrokeAroundSelection(
            stroke,
            resizeGesture.frame.center,
            -resizeGesture.frame.rotationRad
          )
        );
        const nextLocalBox = computeSelectionBox(localStrokes, selectedIdsRef.current);
        if (nextLocalBox !== null) {
          commitSelectionFrame(
            selectionFrameFromLocalBox(nextLocalBox, {
              center: resizeGesture.frame.center,
              rotationRad: resizeGesture.frame.rotationRad,
            })
          );
        }
      };

      const multiDrag = new Mixin(
        host,
        {
          inertial: false,
          getPose,
          setPose: (_element: HTMLElement, pose: Partial<Pose>) => {
            applySelectionTransformPose(pose);
          },
          setPoseOnEnd: (_element: HTMLElement, pose: Partial<Pose>) => {
            applySelectionTransformPose(pose);
          },
        },
        [MixinType.Drag],
        [MixinType.Drag]
      );

      const handleStart = () => {
        if (gesture !== null) {
          return;
        }
        const [finger] = multiDrag.getFingers();
        const operation = finger?.getLastOperation();
        const event = operation?.event;
        const target = event?.target;
        if (!(target instanceof Element)) {
          return;
        }

        const rotateHandle = target.closest('[data-lasso-rotate-handle]');
        const handleElement = target.closest('[data-lasso-resize-handle]');
        const handle = handleElement?.getAttribute('data-lasso-resize-handle') ?? null;
        const textSelectionEdge =
          rotateHandle === null && handleElement === null
            ? target.closest('[data-text-selection-edge]')
            : null;
        if (!rotateHandle && !isLassoResizeHandle(handle) && textSelectionEdge === null) {
          return;
        }

        const activeTool = effectiveToolRef.current;
        const selectedText =
          selectedIdsRef.current.length === 1
            ? strokesRef.current.find(
                (stroke) => stroke.id === selectedIdsRef.current[0] && stroke.tool === 'text'
              )
            : undefined;
        const canResizeText =
          activeTool === 'text' && selectedText !== undefined && (handle === 'w' || handle === 'e');
        const canMoveText =
          (activeTool === 'text' || activeTool === 'lasso') &&
          selectedText !== undefined &&
          textSelectionEdge !== null;
        if (activeTool !== 'lasso' && !canResizeText && !canMoveText) {
          return;
        }
        if (activeTool === 'text' && rotateHandle) {
          return;
        }

        if (
          !event ||
          !isPointerDomEvent(event) ||
          !isDrawingInput(event, inputMethodsRef.current) ||
          classifyInteraction(
            getInteractionOwnerOptions(buildSurfacePointerInteractionInput(event))
          ) !== 'drawing'
        ) {
          return;
        }

        const selectedIdSetAtStart = new Set(selectedIdsRef.current);
        const originals = strokesRef.current
          .filter((stroke) => selectedIdSetAtStart.has(stroke.id))
          .map(cloneStrokeForLassoMove);
        const geometryBox = computeSelectionGeometryBox(originals, selectedIdsRef.current);
        const frame = selectionFrameRef.current;
        if (originals.length === 0 || geometryBox === null || frame === null) {
          return;
        }

        if (rotateHandle) {
          // 旋转中心与用户看到的带描边/内边距选框保持一致，避免多笔迹或不同线宽时
          // 手柄绕一个中心移动、笔迹却绕另一个中心旋转。
          const center = frame.center;
          const centerLocalScreen = canvasToScreen(center, viewportRef.current);
          const hostRect = host.getBoundingClientRect();
          const centerScreen = {
            x: centerLocalScreen.x + hostRect.left,
            y: centerLocalScreen.y + hostRect.top,
          };
          const pointer = operation?.point;
          if (!pointer) {
            return;
          }
          gesture = {
            kind: 'rotate',
            pointerId: event.pointerId,
            center,
            centerScreen,
            originals,
            frame,
            previousPointerAngle: Math.atan2(
              pointer.y - centerScreen.y,
              pointer.x - centerScreen.x
            ),
            accumulatedRotationRad: 0,
          };
          onSelectionTransformStartRef.current?.();
          return;
        }

        if (canMoveText) {
          gesture = {
            kind: 'move',
            originals,
            frame,
            lastPosition: null,
          };
          onSelectionTransformStartRef.current?.();
          return;
        }

        if (isLassoResizeHandle(handle)) {
          const localOriginals = originals.map((stroke) =>
            rotateStrokeAroundSelection(stroke, frame.center, -frame.rotationRad)
          );
          const localGeometryBox = computeSelectionGeometryBox(
            localOriginals,
            selectedIdsRef.current
          );
          if (localGeometryBox === null) {
            return;
          }
          gesture = {
            kind: 'resize',
            handle,
            frame,
            geometryBox: localGeometryBox,
            originals,
            lastPosition: null,
            minimumWidth:
              originals.length === 1 && originals[0]?.tool === 'text'
                ? MIN_TEXT_BOX_WIDTH
                : LASSO_RESIZE_MIN_SIZE,
          };
          onSelectionTransformStartRef.current?.();
        }
      };
      const handleEnd = () => {
        if (gesture !== null) {
          onSelectionTransformEndRef.current?.();
        }
        gesture = null;
        finalPointer = null;
      };

      const captureFinalPointer = (event: PointerEvent) => {
        finalPointer = {
          pointerId: event.pointerId,
          point: { x: event.clientX, y: event.clientY },
        };
      };

      multiDrag.addEventListener(DragOperationType.Start, handleStart);
      multiDrag.addEventListener(DragOperationType.End, handleEnd);
      document.addEventListener('pointerup', captureFinalPointer, true);
      document.addEventListener('pointercancel', captureFinalPointer, true);
      selectionTransformDragRef.current = multiDrag;

      // VirtualPaper 激活时会在内部容器上 stopPropagation 拦截鼠标 pointerdown 冒泡，
      // 导致绑定在 host（bubble 阶段）上的 Mixin 永远收不到事件，套索缩放/旋转无法启动。
      // 这里在 capture 阶段把落在套索手柄上的 pointerdown 直接转发给 Mixin（与
      // rulerPointerBridge 同一思路）；转发后 stopPropagation，防止事件继续传播到
      // host 的 bubble 阶段时被 Mixin 自身监听重复处理（同一 pointerId 会重复建 Finger）。
      const handleBridgePointerDown = (event: PointerEvent) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }
        if (
          !target.closest(
            '[data-lasso-resize-handle], [data-lasso-rotate-handle], [data-text-selection-edge]'
          )
        ) {
          return;
        }
        if (
          classifyInteraction(
            getInteractionOwnerOptions(buildSurfacePointerInteractionInput(event))
          ) === 'ruler'
        ) {
          return;
        }
        // @system-ui-js/multi-drag 在运行期暴露 handlePointerDown 箭头属性，但声明里标记为
        // private；与 rulerPointerBridge 相同，通过结构化类型调用该入口。
        const bridge = multiDrag as object as {
          readonly handlePointerDown?: (event: PointerEvent) => void;
        };
        // 选框边缘不是新的焦点目标；阻止浏览器把焦点从文字编辑器移走，
        // 否则空文字会因 textarea blur 触发既有清理逻辑而在拖动开始前被删除。
        event.preventDefault();
        bridge.handlePointerDown?.(event);
        event.stopPropagation();
      };
      host.addEventListener('pointerdown', handleBridgePointerDown, true);

      return () => {
        if (gesture !== null) {
          onSelectionTransformEndRef.current?.();
          gesture = null;
        }
        host.removeEventListener('pointerdown', handleBridgePointerDown, true);
        document.removeEventListener('pointerup', captureFinalPointer, true);
        document.removeEventListener('pointercancel', captureFinalPointer, true);
        multiDrag.removeEventListener(DragOperationType.Start, handleStart);
        multiDrag.removeEventListener(DragOperationType.End, handleEnd);
        if (selectionTransformDragRef.current === multiDrag) {
          selectionTransformDragRef.current = null;
        }
        multiDrag.destroy();
      };
    }, [buildSurfacePointerInteractionInput, commitSelectionFrame, getInteractionOwnerOptions]);

    useEffect(() => {
      if ((effectiveTool !== 'lasso' && effectiveTool !== 'text') || selectedIds.length === 0) {
        return undefined;
      }
      document.addEventListener('pointerdown', handleDocumentPointerDown);
      return () => {
        document.removeEventListener('pointerdown', handleDocumentPointerDown);
      };
    }, [effectiveTool, selectedIds.length, handleDocumentPointerDown]);

    useImperativeHandle(
      ref,
      () => ({
        deleteSelectedStrokes() {
          const ids = selectedIdsRef.current;
          if (ids.length === 0) {
            return;
          }
          removeStrokesFromCanvas(ids);
          commitSelection([]);
        },
        clearSelection() {
          commitSelection([]);
        },
        getSelectedStrokeIds() {
          return [...selectedIdsRef.current];
        },
        getHostSize() {
          const host = hostRef.current;
          if (!host) return { width: 0, height: 0 };
          return { width: host.clientWidth, height: host.clientHeight };
        },
      }),
      [commitSelection, removeStrokesFromCanvas]
    );

    const getLocalCoordinates = useCallback((clientX: number, clientY: number): DrawingPoint => {
      const host = hostRef.current;
      if (!host) {
        return { x: 0, y: 0 };
      }
      return clientPointToHostContentBox(host, clientX, clientY);
    }, []);

    // 跟踪宿主元素尺寸，供 minimap 计算指示框大小
    const [hostSize, setHostSize] = useState({ width: 0, height: 0 });
    useLayoutEffect(() => {
      if (!minimapEnabled) return undefined;
      const host = hostRef.current;
      if (!host) return undefined;
      const updateSize = () => {
        setHostSize({ width: host.clientWidth, height: host.clientHeight });
      };
      updateSize();
      if (typeof ResizeObserver === 'undefined') return undefined;
      const observer = new ResizeObserver(updateSize);
      observer.observe(host);
      return () => observer.disconnect();
    }, [minimapEnabled]);

    const resolvePointerSnap = useCallback(
      (
        screenPoint: DrawingPoint,
        viewport: DrawingViewport,
        snapOptions: ResolvedDrawingSnapOptions,
        targetStrokes: DrawingStroke[]
      ): ResolvedPointerSnap => {
        const canvas = screenToCanvas(screenPoint, viewport);
        const result = resolveSnapPoint(canvas, targetStrokes, snapOptions, viewport.scale);
        if (!result) {
          return { screen: screenPoint, canvas, result };
        }
        return {
          screen: canvasToScreen(result.canvas, viewport),
          canvas: result.canvas,
          result,
        };
      },
      []
    );

    const resolveInteractiveCanvasPoint = useCallback(
      (
        screenPoint: DrawingPoint,
        tool: DrawingTool,
        viewport: DrawingViewport,
        snapOptions: ResolvedDrawingSnapOptions,
        targetStrokes: DrawingStroke[]
      ): DrawingPoint => {
        const snappedOrRawCanvas = isSnapEligibleTool(tool)
          ? resolvePointerSnap(screenPoint, viewport, snapOptions, targetStrokes).canvas
          : screenToCanvas(screenPoint, viewport);
        return snappedOrRawCanvas;
      },
      [resolvePointerSnap]
    );

    const clearActiveStroke = useCallback(() => {
      clearActiveStrokeRef.current?.();
      isDrawingRef.current = false;
      processedPathLengthRef.current = 0;
      pendingPointsRef.current = [];
      lastSampledTimestampRef.current = 0;
      setActiveStroke(null);
    }, [setActiveStroke]);

    useEffect(() => {
      if (previousValueRef.current !== value && value !== undefined && isDrawingRef.current) {
        clearActiveStroke();
      }
      // Value-prop replacement is treated as an external truth-source change:
      // any queued (uncommitted) eraser hits become stale and must be dropped
      // without deletion. The new strokes array is now authoritative.
      if (previousValueRef.current !== value && value !== undefined) {
        eraserQueuedHitsRef.current.clear();
        clearEraserTrajectoryRef.current();
      }
      previousValueRef.current = value;
    }, [clearActiveStroke, value]);

    useEffect(() => {
      const host = hostRef.current;
      if (!host) {
        return undefined;
      }
      const listenerTarget = resolveDrawingEventTarget(eventTarget) ?? host;
      const pointerCaptureTarget = listenerTarget instanceof Element ? listenerTarget : host;
      const pointerDownListenerOptions = shouldCaptureVirtualPaperPointerDown(
        listenerTarget,
        host,
        isVirtualPaperActive
      )
        ? POINTER_DOWN_CAPTURE_OPTIONS
        : undefined;

      type PointerSample = {
        pointerId: number;
        point: DrawingPoint;
        timestamp: number;
        pointerType: string;
        pressure: number;
        isPrimary: boolean;
      };

      const pointerPaths = new Map<number, PointerSample[]>();
      const activeDrawingPointerIds = new Set<number>();
      const activePaperTouchPointerIds = new Set<number>();
      const capturedPointerIds = new Set<number>();
      const eraserQueuedHits = eraserQueuedHitsRef.current;
      let currentActiveStroke: DrawingStroke | null = null;

      const clearCurrentActiveStroke = () => {
        currentActiveStroke = null;
      };
      clearActiveStrokeRef.current = clearCurrentActiveStroke;

      const clearStrokeState = () => {
        currentActiveStroke = null;
        isDrawingRef.current = false;
        processedPathLengthRef.current = 0;
        pendingPointsRef.current = [];
        lastSampledTimestampRef.current = 0;
        setActiveStroke(null);
      };

      const processPoints = (points: TimedDrawingPoint[]) => {
        if (!currentActiveStroke || points.length === 0) return;

        const nextPoints =
          effectiveToolRef.current === 'pen' && smoothingOptionsRef.current.enabled
            ? createVelocityAdaptivePoints(points, smoothingOptionsRef.current)
            : points;

        for (const point of nextPoints) {
          currentActiveStroke = appendPoint(currentActiveStroke, point);
        }

        // 闭合形状（rect/ellipse）按住 Shift 时实时显示正方形/正圆预览；
        // 渲染用的 stroke 单独构造，currentActiveStroke 保留原始拖拽点，
        // 这样松开 Shift 后能立即恢复无约束预览。
        const renderableStroke =
          shiftPressedRef.current && isBboxShapeTool(currentActiveStroke.tool)
            ? applyShiftConstraintToShape(currentActiveStroke)
            : currentActiveStroke;

        setActiveStroke(renderableStroke);
      };

      // Flush any pending points immediately (used in auto mode and cleanup)
      const flushPendingPoints = () => {
        const pending = pendingPointsRef.current;
        if (pending.length === 0) return;

        const rate = samplingRateRef.current;
        if (!rate || rate <= 0) {
          processPoints(pending);
          pendingPointsRef.current = [];
          return;
        }

        const minIntervalMs = 1000 / rate;
        const lastTimestamp = lastSampledTimestampRef.current;
        const filtered: TimedDrawingPoint[] = [];
        let lastKept = lastTimestamp;
        // 为缺失时间戳的点提供确定性单调回退，避免 Date.now() 引入处理时序依赖
        let fallbackTs = lastTimestamp;

        for (const point of pending) {
          const ts = point.timestamp ?? ++fallbackTs;
          // 第一个点（lastKept === 0 表示笔画刚开始）总是保留，
          // 之后只有时间间隔 >= minIntervalMs 的点才保留
          if (lastKept === 0 || ts - lastKept >= minIntervalMs) {
            filtered.push(point);
            lastKept = ts;
          }
        }

        if (filtered.length === 1 && pending.length > 1) {
          const lastPoint = pending[pending.length - 1];
          const firstPoint = filtered[0];
          // 避免在单点敲击无移动时产生重复坐标
          if (lastPoint.x !== firstPoint.x || lastPoint.y !== firstPoint.y) {
            filtered.push(lastPoint);
          }
        }

        if (filtered.length > 0) {
          lastSampledTimestampRef.current = lastKept;
          processPoints(filtered);
        }
        pendingPointsRef.current = [];
      };

      const commitCurrentActiveStroke = () => {
        flushPendingPoints();
        const stroke = currentActiveStroke;
        if (stroke && stroke.tool !== 'eraser' && isValidStroke(stroke)) {
          const committed =
            shiftPressedRef.current && isBboxShapeTool(stroke.tool)
              ? applyShiftConstraintToShape(stroke)
              : stroke;
          addStrokeRef.current(committed);
        }
        clearStrokeState();
      };

      // Eraser hit-test helpers: callers pass canvas-space points so point-pick
      // fallback and segment-sweep share the exact same coordinate semantics.
      const getPickableStrokes = () =>
        strokesRef.current
          .filter(
            (stroke) =>
              !eraserQueuedHitsRef.current.has(stroke.id) &&
              !eraserProcessedHitsRef.current.has(stroke.id)
          )
          .map((stroke) => ({
            ...stroke,
            fillColor: stroke.fillColor ?? resolvedFillColorRef.current,
          }));

      const getCanvasEraserRadius = () =>
        resolvedOpenWidthRef.current / 2 / viewportRef.current.scale;

      const getRenderedEraserHitTestOptions = (): RenderedStrokeHitTestOptions => ({
        eraserRadius: getCanvasEraserRadius(),
        openFallbackWidth: resolvedOpenWidthRef.current,
        closedFallbackWidth: resolvedClosedWidthRef.current,
        pressureMultiplier: resolvedPressureMultiplierRef.current,
      });

      const pickEraserStrokeIdAtPoint = (canvasPoint: DrawingPoint): string | null => {
        const hitStroke = pickRenderedStrokeIntersectingPolyline(
          [canvasPoint],
          getPickableStrokes(),
          getRenderedEraserHitTestOptions()
        );
        return hitStroke ? hitStroke.id : null;
      };

      const pickEraserStrokeIdOnSegment = (
        startCanvasPoint: DrawingPoint,
        endCanvasPoint: DrawingPoint
      ): string | null => {
        const hitStroke = pickRenderedStrokeIntersectingSegment(
          startCanvasPoint,
          endCanvasPoint,
          getPickableStrokes(),
          getRenderedEraserHitTestOptions()
        );
        return hitStroke ? hitStroke.id : null;
      };

      const pickSelectedLassoStrokeIdAtPoint = (canvasPoint: DrawingPoint): string | null => {
        const selectedIdLookup = new Set(selectedIdsRef.current);
        if (selectedIdLookup.size === 0) {
          return null;
        }
        const selectedStrokes = strokesRef.current.filter((stroke) =>
          selectedIdLookup.has(stroke.id)
        );
        const hitStroke = pickRenderedStrokeIntersectingPolyline(
          [canvasPoint],
          selectedStrokes,
          getRenderedEraserHitTestOptions()
        );
        return hitStroke ? hitStroke.id : null;
      };

      const startLassoInteraction = (input: PointerSample, event: PointerEvent) => {
        if (effectiveToolRef.current !== 'lasso' || !isDrawingEnabledRef.current) {
          return;
        }
        if (!isDrawingInput(readPointerEvent(event), inputMethodsRef.current)) {
          clearLassoInteractionRef.current();
          return;
        }

        const canvasPoint = screenToCanvas(input.point, viewportRef.current);
        const currentSelectionBox = selectionBoxRef.current;
        const currentSelectionFrame = selectionFrameRef.current;
        const isInsideSelectionBox =
          currentSelectionFrame !== null &&
          isPointInsideSelectionFrame(canvasPoint, currentSelectionFrame);
        if (currentSelectionBox !== null && !isInsideSelectionBox) {
          // 在选区框外按下时，清空旧选区并继续执行下面的 else 分支，
          // 从而在同一手势中立即开始新的套索绘制。
          commitSelection([]);
        }
        const hitSelectedId = pickSelectedLassoStrokeIdAtPoint(canvasPoint);
        if (isInsideSelectionBox || (currentSelectionBox === null && hitSelectedId)) {
          const selectedIdLookup = new Set(selectedIdsRef.current);
          const originals = strokesRef.current
            .filter((stroke) => selectedIdLookup.has(stroke.id))
            .map(cloneStrokeForLassoMove);
          const moveFrame =
            currentSelectionFrame ??
            (() => {
              const box = computeSelectionBox(originals, selectedIdsRef.current);
              return box === null ? null : selectionFrameFromBox(box);
            })();
          if (moveFrame === null) {
            return;
          }
          selectionMoveRef.current = {
            pointerId: input.pointerId,
            startCanvasPoint: canvasPoint,
            originals,
            frame: moveFrame,
          };
          lassoPointsRef.current = [];
          lassoModeRef.current = 'moving';
          setLassoMode('moving');
          setLassoPreviewPoints((prev) => (prev.length === 0 ? prev : []));
          beginLassoMoveTransaction();
        } else {
          const hitBoxStroke =
            pickImageStrokeAtPoint(canvasPoint, strokesRef.current) ??
            pickTextStrokeAtPoint(canvasPoint, strokesRef.current);
          if (hitBoxStroke !== null) {
            const boxSelection = [hitBoxStroke.id];
            commitSelection(boxSelection);
            const moveBox = computeSelectionBox([hitBoxStroke], boxSelection);
            const moveFrame =
              hitBoxStroke.tool === 'text'
                ? selectionFrameFromTextStroke(hitBoxStroke)
                : moveBox === null
                  ? null
                  : selectionFrameFromBox(moveBox);
            if (moveBox === null || moveFrame === null) {
              return;
            }
            selectionMoveRef.current = {
              pointerId: input.pointerId,
              startCanvasPoint: canvasPoint,
              originals: [cloneStrokeForLassoMove(hitBoxStroke)],
              frame: moveFrame,
            };
            lassoPointsRef.current = [];
            lassoModeRef.current = 'moving';
            setLassoMode('moving');
            setLassoPreviewPoints((previous) => (previous.length === 0 ? previous : []));
            beginLassoMoveTransaction();
          } else {
            selectionMoveRef.current = null;
            lassoPointsRef.current = [canvasPoint];
            lassoModeRef.current = 'drawing';
            setLassoMode('drawing');
            setLassoPreviewPoints([canvasPoint]);
          }
        }
        processedPathLengthRef.current = 1;
      };

      const finishLassoInteraction = () => {
        if (lassoModeRef.current === 'drawing') {
          commitSelection(
            selectStrokesIntersectingLasso(strokesRef.current, lassoPointsRef.current)
          );
          clearLassoInteractionRef.current();
          return true;
        }
        if (lassoModeRef.current === 'moving') {
          clearLassoInteractionRef.current();
          return true;
        }
        return false;
      };

      const routeEraserHit = (hitId: string | null) => {
        if (!hitId) {
          return;
        }
        if (eraserCommitModeRef.current === 'on-release') {
          eraserQueuedHitsRef.current.add(hitId);
        } else {
          eraserProcessedHitsRef.current.add(hitId);
          removeStrokeRef.current(hitId);
        }
      };

      const commitQueuedEraserHits = () => {
        const queue = eraserQueuedHitsRef.current;
        if (queue.size === 0) {
          return;
        }
        for (const strokeId of queue) {
          removeStrokeRef.current(strokeId);
        }
        queue.clear();
      };

      const readPointerEvent = (event: PointerEvent): PointerInputEvent => ({
        pointerType: event.pointerType,
        button: event.button,
        clientX: event.clientX,
        clientY: event.clientY,
        timeStamp: event.timeStamp,
      });

      const toPointerSample = (event: PointerEvent): PointerSample => ({
        pointerId: event.pointerId ?? 1,
        point: getLocalCoordinates(event.clientX ?? 0, event.clientY ?? 0),
        timestamp: event.timeStamp ?? 0,
        pointerType: event.pointerType ?? 'mouse',
        pressure: event.pressure,
        isPrimary: event.isPrimary ?? true,
      });

      const resolveDrawingScreenPoint = (
        pointerId: number,
        rawPoint: DrawingPoint,
        tool: DrawingTool
      ): DrawingPoint => {
        if (!isSnapEligibleTool(tool)) {
          return rawPoint;
        }

        // 只有原始指针能推进“越过尺边”的锁定状态。普通吸附完成后只在已经
        // 锁定时投影，避免吸附坐标提前锁边，也避免它把已锁定点拉离物理尺边。
        applyRulerEdgeConstraint(pointerId, rawPoint);
        const snappedScreenPoint = resolvePointerSnap(
          rawPoint,
          viewportRef.current,
          snapOptionsRef.current,
          strokesRef.current
        ).screen;
        return projectLockedRulerEdge(pointerId, snappedScreenPoint);
      };

      const releasePointerCapture = (pointerId: number) => {
        if (!capturedPointerIds.has(pointerId)) {
          return;
        }
        if (
          typeof pointerCaptureTarget.releasePointerCapture === 'function' &&
          (typeof pointerCaptureTarget.hasPointerCapture !== 'function' ||
            pointerCaptureTarget.hasPointerCapture(pointerId))
        ) {
          pointerCaptureTarget.releasePointerCapture(pointerId);
        }
        capturedPointerIds.delete(pointerId);
      };

      const capturePointer = (event: PointerEvent) => {
        if (typeof pointerCaptureTarget.setPointerCapture !== 'function') {
          return;
        }
        pointerCaptureTarget.setPointerCapture(event.pointerId);
        capturedPointerIds.add(event.pointerId);
      };

      const handleSingleMove = (
        input: PointerSample,
        _event: PointerEvent,
        path: PointerSample[]
      ) => {
        if (!isDrawingEnabledRef.current) {
          clearStrokeState();
          return;
        }

        if (
          effectiveToolRef.current === 'polygon' ||
          effectiveToolRef.current === 'bezier' ||
          effectiveToolRef.current === 'text'
        ) {
          return;
        }

        // pointerdown 已校验 button/输入方式，move 阶段若再校验 button 会把
        // 真实浏览器 pointermove 的 button=-1 误判为非法输入，导致鼠标无法绘制。
        if (!activeDrawingPointerIds.has(input.pointerId)) {
          clearStrokeState();
          return;
        }

        if (effectiveToolRef.current === 'eraser') {
          for (let index = processedPathLengthRef.current; index < path.length; index++) {
            const pathItem = path[index];
            if (!pathItem) {
              continue;
            }

            // 每个新输入点先沿用既有 screen→canvas 转换；后续所有碰撞半径
            // 和 helper 都在 canvas 坐标系中运算，避免缩放时混用屏幕坐标。
            const canvasPoint = screenToCanvas(pathItem.point, viewportRef.current);
            const trajectoryPoints = eraserTrajectoryPointsRef.current;
            const gestureStartCanvasPoint = eraserGestureStartCanvasPointRef.current;
            const previousCanvasPoint =
              trajectoryPoints[trajectoryPoints.length - 1] ?? gestureStartCanvasPoint;
            const shouldSeedGestureStart =
              trajectoryPoints.length === 0 &&
              gestureStartCanvasPoint !== null &&
              (gestureStartCanvasPoint.x !== canvasPoint.x ||
                gestureStartCanvasPoint.y !== canvasPoint.y);

            // 首个 move 优先从 pointerdown 起点做段扫；没有起点时才保留
            // point-pick fallback，确保 tap/零长度橡皮不回退。
            const hitId = previousCanvasPoint
              ? pickEraserStrokeIdOnSegment(previousCanvasPoint, canvasPoint)
              : pickEraserStrokeIdAtPoint(canvasPoint);
            routeEraserHit(hitId);

            if (shouldSeedGestureStart && gestureStartCanvasPoint) {
              appendEraserTrajectoryPointRef.current(gestureStartCanvasPoint);
            }

            // 同一个 canvas 点必须同时进入 ref 与 state：ref 立即成为下一段
            // sweep 的起点，state 只用于渲染可见轨迹 polyline。
            appendEraserTrajectoryPointRef.current(canvasPoint);
          }
          processedPathLengthRef.current = path.length;
          return;
        }

        if (effectiveToolRef.current === 'lasso') {
          if (lassoModeRef.current === 'drawing') {
            for (let index = processedPathLengthRef.current; index < path.length; index++) {
              const pathItem = path[index];
              if (!pathItem) {
                continue;
              }
              const canvasPoint = screenToCanvas(pathItem.point, viewportRef.current);
              lassoPointsRef.current.push(canvasPoint);
            }
            processedPathLengthRef.current = path.length;
            setLassoPreviewPoints([...lassoPointsRef.current]);
            return;
          }

          if (lassoModeRef.current === 'moving') {
            const moveState = selectionMoveRef.current;
            if (!moveState || moveState.pointerId !== input.pointerId) {
              return;
            }
            const canvasPoint = screenToCanvas(input.point, viewportRef.current);
            const dx = canvasPoint.x - moveState.startCanvasPoint.x;
            const dy = canvasPoint.y - moveState.startCanvasPoint.y;
            updateStrokesRef.current(
              moveState.originals.map((stroke) => offsetStrokeForLassoMove(stroke, dx, dy))
            );
            commitSelectionFrame({
              ...moveState.frame,
              center: {
                x: moveState.frame.center.x + dx,
                y: moveState.frame.center.y + dy,
              },
            });
            processedPathLengthRef.current = path.length;
            return;
          }

          return;
        }

        // 橡皮和套索在上面的分支中故意跳过投影：它们做的是命中测试/选区，必须使用原始指针位置。
        const localPath = path.map((pathItem) =>
          screenToCanvas(pathItem.point, viewportRef.current)
        );

        // Line is click-to-place by default. Drag remains the shortcut, but only
        // after real movement: at least two path samples and >4 px total travel.
        if (effectiveToolRef.current === 'line' && !currentActiveStroke) {
          if (path.length < 2) {
            return;
          }
          if (totalPathDistance(localPath) <= LINE_DRAG_THRESHOLD_PX) {
            return;
          }
        }

        if (!currentActiveStroke) {
          const currentTool = effectiveToolRef.current;
          currentActiveStroke = createStroke(currentTool, {
            strokeColor: resolvedColorRef.current,
            strokeWidth: isClosedShapeTool(currentTool)
              ? resolvedClosedWidthRef.current
              : resolvedOpenWidthRef.current,
            dashArray: resolvedDashArrayRef.current,
            dashOffset: resolvedDashOffsetRef.current,
            fillColor: resolvedFillColorRef.current,
            fillOpacity: resolvedFillOpacityRef.current,
          });
          isDrawingRef.current = true;
          processedPathLengthRef.current = 0;
          lastSampledTimestampRef.current = 0;
        }

        const rawTimedPoints: TimedDrawingPoint[] = [];
        for (let index = processedPathLengthRef.current; index < path.length; index++) {
          const pathItem = path[index];
          if (!pathItem) {
            continue;
          }
          const localPoint =
            localPath[index] ?? screenToCanvas(pathItem.point, viewportRef.current);
          const timedPoint: TimedDrawingPoint = {
            ...localPoint,
            timestamp: pathItem.timestamp || undefined,
          };

          if (
            pressureRef.current === true &&
            effectiveToolRef.current === 'pen' &&
            pathItem.pressure !== undefined
          ) {
            timedPoint.pressure = normalizePointPressure(pathItem.pressure);
          }

          rawTimedPoints.push(timedPoint);
        }

        pendingPointsRef.current.push(...rawTimedPoints);
        processedPathLengthRef.current = path.length;
        flushPendingPoints();
      };

      const finishPointerInteraction = (input: PointerSample) => {
        if (effectiveToolRef.current === 'text') {
          return;
        }
        if (effectiveToolRef.current === 'eraser') {
          commitQueuedEraserHits();
          clearEraserTrajectoryRef.current();
        }
        if (effectiveToolRef.current === 'lasso' && finishLassoInteraction()) {
          dispatchInteraction({ type: 'POINTER_UP', pointerId: input.pointerId });
          return;
        }
        commitCurrentActiveStroke();
        if (!isPlacementReducerTool(effectiveToolRef.current)) {
          dispatchInteraction({
            type: 'POINTER_UP',
            pointerId: input.pointerId,
            point: screenToCanvas(input.point, viewportRef.current),
          });
        }
      };

      const cancelPointerInteraction = (input: PointerSample) => {
        eraserQueuedHits.clear();
        clearEraserTrajectoryRef.current();
        clearLassoInteractionRef.current();
        clearStrokeState();
        dispatchInteraction(
          isPlacementReducerTool(effectiveToolRef.current)
            ? { type: 'POINTER_CANCEL', pointerId: input.pointerId }
            : { type: 'POINTER_UP', pointerId: input.pointerId }
        );
      };

      const activateDrawingPointer = (rawInput: PointerSample, event: PointerEvent) => {
        capturePointer(event);
        if (activeDrawingPointerIds.size > 0 && eraserCommitModeRef.current === 'on-release') {
          eraserQueuedHitsRef.current.clear();
        }
        activeDrawingPointerIds.add(rawInput.pointerId);
        beginRulerEdgeConstraint(rawInput.pointerId, rawInput.point, effectiveToolRef.current);
        const input = {
          ...rawInput,
          point: resolveDrawingScreenPoint(
            rawInput.pointerId,
            rawInput.point,
            effectiveToolRef.current
          ),
        };
        pointerPaths.set(input.pointerId, [input]);
        if (effectiveToolRef.current === 'eraser') {
          eraserGestureStartCanvasPointRef.current = screenToCanvas(
            input.point,
            viewportRef.current
          );
        }
        startLassoInteraction(input, event);
      };

      const handlePointerDown = (event: PointerEvent) => {
        if (event.button !== undefined && event.button !== 0) {
          return;
        }
        if (
          event.target instanceof Element &&
          event.target.closest(
            '[data-lasso-resize-handle], [data-lasso-rotate-handle], [data-text-selection-edge], [data-text-editor]'
          )
        ) {
          return;
        }
        const interactionInput = buildSurfacePointerInteractionInput(event);
        if (event.pointerType === 'touch' && interactionInput.hitsRuler !== true) {
          activePaperTouchPointerIds.add(event.pointerId);
        }
        const owner = gestureOwnerRef.current.startPointer(
          getInteractionOwnerOptions(interactionInput, activePaperTouchPointerIds.size)
        );
        if (owner !== 'drawing') {
          return;
        }
        const rawInput = toPointerSample(event);
        const pointerEvent = readPointerEvent(event);
        if (
          !isDrawingInput(pointerEvent, inputMethodsRef.current) ||
          !isDrawingEnabledRef.current
        ) {
          return;
        }
        if (effectiveToolRef.current === 'text') {
          event.preventDefault();
          const canvasPoint = screenToCanvas(rawInput.point, viewportRef.current);
          const hadSelectedText = selectedIdsRef.current.some((selectedId) =>
            strokesRef.current.some((stroke) => stroke.id === selectedId && stroke.tool === 'text')
          );
          const removedTextId = finishEditingText();
          if (removedTextId !== null) {
            gestureOwnerRef.current.endPointer(rawInput.pointerId);
            return;
          }
          const hitTextStroke = pickTextStrokeAtPoint(canvasPoint, strokesRef.current);
          if (hitTextStroke !== null) {
            commitSelection([hitTextStroke.id]);
            setEditingTextId(hitTextStroke.id);
          } else if (hadSelectedText) {
            commitSelection([]);
          } else {
            const textStroke: DrawingStroke = {
              id: generateStrokeId(),
              tool: 'text',
              points: createTextBoxPoints(canvasPoint, resolvedFontSizeRef.current),
              strokeColor: resolvedColorRef.current,
              strokeWidth: 0,
              text: '',
              fontSize: resolvedFontSizeRef.current,
            };
            addStrokeRef.current(textStroke);
            commitSelection([textStroke.id]);
            setEditingTextId(textStroke.id);
          }
          gestureOwnerRef.current.endPointer(rawInput.pointerId);
          return;
        }
        if (
          shouldArbitrateTouchDrawing &&
          event.pointerType === 'touch' &&
          !isPlacementReducerTool(effectiveToolRef.current)
        ) {
          touchDrawingArbitrationRef.current = {
            phase: 'pending',
            pointerId: rawInput.pointerId,
          };
          pointerPaths.set(rawInput.pointerId, [rawInput]);
          return;
        }
        activateDrawingPointer(rawInput, event);
      };
      const handlePointerDownEvent: EventListener = (event) => {
        if (isPointerDomEvent(event)) {
          handlePointerDown(event);
        }
      };

      const handlePointerMove = (event: PointerEvent) => {
        const rawInput = toPointerSample(event);
        if (gestureOwnerRef.current.getPointerOwner(rawInput.pointerId) !== 'drawing') {
          return;
        }
        const touchDrawingArbitration = touchDrawingArbitrationRef.current;
        if (
          rawInput.pointerType === 'touch' &&
          touchDrawingArbitration.phase !== 'idle' &&
          touchDrawingArbitration.pointerId === rawInput.pointerId
        ) {
          if (touchDrawingArbitration.phase === 'viewport') {
            gestureOwnerRef.current.endPointer(rawInput.pointerId);
            pointerPaths.delete(rawInput.pointerId);
            return;
          }
          if (touchDrawingArbitration.phase === 'pending') {
            const pendingPath = pointerPaths.get(rawInput.pointerId);
            const startInput = pendingPath?.[0];
            if (!startInput) {
              return;
            }
            const distanceFromStart = Math.hypot(
              rawInput.point.x - startInput.point.x,
              rawInput.point.y - startInput.point.y
            );
            if (distanceFromStart < TOUCH_DRAWING_COMMIT_THRESHOLD_PX) {
              return;
            }
            touchDrawingArbitrationRef.current = {
              phase: 'drawing',
              pointerId: rawInput.pointerId,
            };
            activateDrawingPointer(startInput, event);
          }
        }
        const path = pointerPaths.get(rawInput.pointerId);
        if (!path) {
          return;
        }
        const input = {
          ...rawInput,
          point: resolveDrawingScreenPoint(
            rawInput.pointerId,
            rawInput.point,
            effectiveToolRef.current
          ),
        };
        path.push(input);
        handleSingleMove(input, event, path);
      };

      const handlePointerEnd = (event: PointerEvent) => {
        const rawInput = toPointerSample(event);
        const isPlacementTool = isPlacementReducerTool(effectiveToolRef.current);
        const input = {
          ...rawInput,
          point: resolveDrawingScreenPoint(
            rawInput.pointerId,
            rawInput.point,
            effectiveToolRef.current
          ),
        };
        const owner = isPlacementTool
          ? gestureOwnerRef.current.getPointerOwner(input.pointerId)
          : gestureOwnerRef.current.endPointer(input.pointerId);
        releasePointerCapture(input.pointerId);
        if (owner === 'drawing' && activeDrawingPointerIds.has(input.pointerId)) {
          finishPointerInteraction(input);
        }
        activeDrawingPointerIds.delete(input.pointerId);
        pointerPaths.delete(input.pointerId);
        if (!isPlacementTool) {
          endRulerEdgeConstraint(input.pointerId);
        }
        if (event.pointerType === 'touch') {
          activePaperTouchPointerIds.delete(event.pointerId);
          const touchDrawingArbitration = touchDrawingArbitrationRef.current;
          if (
            touchDrawingArbitration.phase !== 'idle' &&
            touchDrawingArbitration.pointerId === event.pointerId
          ) {
            touchDrawingArbitrationRef.current = { phase: 'idle' };
          }
        }
      };

      const handlePointerCancel = (event: PointerEvent) => {
        const input = toPointerSample(event);
        const owner = gestureOwnerRef.current.endPointer(input.pointerId);
        releasePointerCapture(input.pointerId);
        if (owner === 'drawing' && activeDrawingPointerIds.has(input.pointerId)) {
          cancelPointerInteraction(input);
        }
        activeDrawingPointerIds.delete(input.pointerId);
        pointerPaths.delete(input.pointerId);
        endRulerEdgeConstraint(input.pointerId);
        if (event.pointerType === 'touch') {
          activePaperTouchPointerIds.delete(event.pointerId);
          const touchDrawingArbitration = touchDrawingArbitrationRef.current;
          if (
            touchDrawingArbitration.phase !== 'idle' &&
            touchDrawingArbitration.pointerId === event.pointerId
          ) {
            touchDrawingArbitrationRef.current = { phase: 'idle' };
          }
        }
      };

      const handleKeyChange = (event: KeyboardEvent) => {
        if (event.key !== 'Shift') return;
        const nextPressed = event.type === 'keydown';
        if (shiftPressedRef.current === nextPressed) return;
        shiftPressedRef.current = nextPressed;
        // 拖拽进行中时立刻刷新预览：按下时收敛到正方形/正圆，松开时恢复原始 bbox。
        if (currentActiveStroke && isBboxShapeTool(currentActiveStroke.tool)) {
          const renderableStroke = nextPressed
            ? applyShiftConstraintToShape(currentActiveStroke)
            : currentActiveStroke;
          setActiveStroke(renderableStroke);
        }
      };
      const handleBlur = () => {
        shiftPressedRef.current = false;
      };

      listenerTarget.addEventListener(
        'pointerdown',
        handlePointerDownEvent,
        pointerDownListenerOptions
      );
      document.addEventListener('pointermove', handlePointerMove);
      document.addEventListener('pointerup', handlePointerEnd);
      document.addEventListener('pointercancel', handlePointerCancel);
      window.addEventListener('keydown', handleKeyChange);
      window.addEventListener('keyup', handleKeyChange);
      window.addEventListener('blur', handleBlur);

      return () => {
        clearStrokeState();
        if (clearActiveStrokeRef.current === clearCurrentActiveStroke) {
          clearActiveStrokeRef.current = null;
        }
        listenerTarget.removeEventListener(
          'pointerdown',
          handlePointerDownEvent,
          pointerDownListenerOptions
        );
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', handlePointerEnd);
        document.removeEventListener('pointercancel', handlePointerCancel);
        window.removeEventListener('keydown', handleKeyChange);
        window.removeEventListener('keyup', handleKeyChange);
        window.removeEventListener('blur', handleBlur);
        for (const pointerId of capturedPointerIds) {
          releasePointerCapture(pointerId);
        }
        activeDrawingPointerIds.clear();
        pointerPaths.clear();
        rulerEdgeConstraintsRef.current.clear();
        activePaperTouchPointerIds.clear();
        touchDrawingArbitrationRef.current = { phase: 'idle' };
        gestureOwnerRef.current.reset();
        eraserQueuedHits.clear();
        clearEraserTrajectoryRef.current();
        clearLassoInteractionRef.current();
      };
    }, [
      commitSelection,
      commitSelectionFrame,
      beginLassoMoveTransaction,
      applyRulerEdgeConstraint,
      beginRulerEdgeConstraint,
      buildSurfacePointerInteractionInput,
      eventTarget,
      endRulerEdgeConstraint,
      finishEditingText,
      getInteractionOwnerOptions,
      getLocalCoordinates,
      projectLockedRulerEdge,
      resolvePointerSnap,
      isVirtualPaperActive,
      selectionFrameFromTextStroke,
      shouldArbitrateTouchDrawing,
      setActiveStroke,
    ]);

    // Tool switch: reset reducer state. Cancels any in-progress polygon placement
    // when user picks a different tool mid-draw (or vice versa).
    useEffect(() => {
      const previousTool = previousToolForCleanupRef.current;
      dispatchInteraction({ type: 'TOOL_CHANGE', tool: effectiveTool });
      // Switching tool discards any in-flight on-release eraser queue —
      // hits collected before the switch were never committed.
      if (effectiveTool !== 'eraser') {
        eraserQueuedHitsRef.current.clear();
        clearEraserTrajectoryRef.current();
      }
      if (
        (previousTool === 'lasso' || previousTool === 'text') &&
        effectiveTool !== 'lasso' &&
        effectiveTool !== 'text' &&
        selectedIdsRef.current.length > 0
      ) {
        commitSelection([]);
      }
      clearLassoInteractionRef.current();
      if (effectiveTool !== 'text') {
        finishEditingText();
      }
      previousToolForCleanupRef.current = effectiveTool;
    }, [commitSelection, effectiveTool, finishEditingText]);

    useEffect(() => {
      eraserCommitModeRef.current = resolvedEraserCommitMode;
    }, [resolvedEraserCommitMode]);

    // When the reducer reaches a `completedStroke` (line/polygon placement finished), commit a v2 stroke
    // and clear the completion marker so we don't double-commit on re-render.
    useEffect(() => {
      if (interactionState.phase !== 'idle' || !interactionState.completedStroke) {
        return;
      }
      const completed = interactionState.completedStroke;
      if (completed.tool === 'line' && completed.points.length >= 2) {
        const line: LineStrokeV2 = {
          schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
          id: generateStrokeId(),
          tool: 'line',
          points: completed.points.map((point) => ({ x: point.x, y: point.y })),
          strokeColor: resolvedColorRef.current,
          strokeWidth: resolvedOpenWidthRef.current,
          dashArray: resolvedDashArrayRef.current ? [...resolvedDashArrayRef.current] : undefined,
          dashOffset: resolvedDashOffsetRef.current,
          fillColor: resolvedFillColorRef.current,
          fillOpacity: resolvedFillOpacityRef.current,
        };
        addStrokeRef.current(line as unknown as DrawingStroke);
      }
      if (completed.tool === 'polygon' && completed.points.length >= 3) {
        const polygon: PolygonStrokeV2 = {
          schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
          id: generateStrokeId(),
          tool: 'polygon',
          points: completed.points.map((point) => ({ x: point.x, y: point.y })),
          strokeColor: resolvedColorRef.current,
          strokeWidth: resolvedClosedWidthRef.current,
          dashArray: resolvedDashArrayRef.current ? [...resolvedDashArrayRef.current] : undefined,
          dashOffset: resolvedDashOffsetRef.current,
          fillColor: resolvedFillColorRef.current,
          fillOpacity: resolvedFillOpacityRef.current,
        };
        addStrokeRef.current(polygon as unknown as DrawingStroke);
      }
      if (completed.tool === 'bezier' && completed.points.length === 4) {
        // Bezier is an open tool: no fill, dash applies. The reducer emits exactly four
        // points in [start, cp1, cp2, end] order; renderer's bezierPath() draws `M ... C ...`.
        const bezier: BezierStrokeV2 = {
          schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
          id: generateStrokeId(),
          tool: 'bezier',
          points: completed.points.map((point) => ({ x: point.x, y: point.y })),
          strokeColor: resolvedColorRef.current,
          strokeWidth: resolvedOpenWidthRef.current,
          dashArray: resolvedDashArrayRef.current ? [...resolvedDashArrayRef.current] : undefined,
          dashOffset: resolvedDashOffsetRef.current,
        };
        addStrokeRef.current(bezier as unknown as DrawingStroke);
      }
      dispatchInteraction({ type: 'TOOL_CHANGE', tool: effectiveTool });
    }, [interactionState, effectiveTool]);

    // Placement reducer listeners are wired only for line/polygon/Bezier. Line and
    // polygon keep click/dblclick placement; Bezier uses three drag gestures whose
    // phase bookkeeping lives in interactionReducer.
    useEffect(() => {
      if (!isPlacementReducerTool(effectiveTool) || !isDrawingEnabled) {
        return undefined;
      }
      const host = hostRef.current;
      if (!host) {
        return undefined;
      }
      const listenerTarget = resolveDrawingEventTarget(eventTarget) ?? host;
      const pointerDownListenerOptions = shouldCaptureVirtualPaperPointerDown(
        listenerTarget,
        host,
        isVirtualPaperActive
      )
        ? POINTER_DOWN_CAPTURE_OPTIONS
        : undefined;

      const toCanvasPoint = (clientX: number, clientY: number, pointerId: number) => {
        const rawScreenPoint = getLocalCoordinates(clientX, clientY);
        applyRulerEdgeConstraint(pointerId, rawScreenPoint);
        const snappedScreenPoint = resolvePointerSnap(
          rawScreenPoint,
          viewportRef.current,
          snapOptionsRef.current,
          strokesRef.current
        ).screen;
        return screenToCanvas(
          projectLockedRulerEdge(pointerId, snappedScreenPoint),
          viewportRef.current
        );
      };

      let pendingLineClick: { point: DrawingPoint; pointerId?: number } | null = null;

      const handlePointerDown = (event: PointerEvent) => {
        if (event.button !== undefined && event.button !== 0) {
          return;
        }
        const owner = gestureOwnerRef.current.startPointer(
          getInteractionOwnerOptions(buildSurfacePointerInteractionInput(event))
        );
        if (owner !== 'drawing') {
          return;
        }
        const screenPoint = getLocalCoordinates(event.clientX, event.clientY);
        beginRulerEdgeConstraint(event.pointerId, screenPoint, effectiveTool);
        const point = toCanvasPoint(event.clientX, event.clientY, event.pointerId);
        if (effectiveTool === 'line') {
          pendingLineClick = { point, pointerId: event.pointerId };
          return;
        }
        dispatchInteraction({
          type: 'POINTER_DOWN',
          point,
          pointerId: event.pointerId,
          detail: event.detail,
        });
      };
      const handlePointerDownEvent: EventListener = (event) => {
        if (isPointerDomEvent(event)) {
          handlePointerDown(event);
        }
      };

      const handlePointerMove = (event: PointerEvent) => {
        const lockedOwner = gestureOwnerRef.current.getPointerOwner(event.pointerId);
        const moveOwner =
          lockedOwner === 'none'
            ? classifyInteraction(
                getInteractionOwnerOptions(
                  buildSurfacePointerInteractionInput(
                    event,
                    event.button === undefined || event.button === -1 ? 0 : event.button
                  )
                )
              )
            : lockedOwner;
        if (moveOwner !== 'drawing') {
          return;
        }
        const point = toCanvasPoint(event.clientX, event.clientY, event.pointerId);
        if (
          effectiveTool === 'line' &&
          pendingLineClick &&
          Math.hypot(point.x - pendingLineClick.point.x, point.y - pendingLineClick.point.y) >
            LINE_DRAG_THRESHOLD_PX
        ) {
          pendingLineClick = null;
        }
        dispatchInteraction({
          type: 'POINTER_MOVE',
          point,
          pointerId: event.pointerId,
        });
      };

      const handlePointerUp = (event: PointerEvent) => {
        const owner = gestureOwnerRef.current.endPointer(event.pointerId);
        if (owner !== 'drawing') {
          endRulerEdgeConstraint(event.pointerId);
          return;
        }
        const point = toCanvasPoint(event.clientX, event.clientY, event.pointerId);
        endRulerEdgeConstraint(event.pointerId);
        if (effectiveTool === 'bezier') {
          dispatchInteraction({
            type: 'POINTER_UP',
            point,
            pointerId: event.pointerId,
            detail: event.detail,
          });
          return;
        }
        if (effectiveTool !== 'line' || !pendingLineClick) {
          return;
        }
        const click = pendingLineClick;
        pendingLineClick = null;
        if (
          event.pointerId !== undefined &&
          click.pointerId !== undefined &&
          event.pointerId !== click.pointerId
        ) {
          return;
        }
        if (Math.hypot(point.x - click.point.x, point.y - click.point.y) > LINE_DRAG_THRESHOLD_PX) {
          return;
        }
        dispatchInteraction({
          type: 'POINTER_DOWN',
          point,
          pointerId: event.pointerId,
          detail: event.detail,
          mode: 'place',
        });
      };

      const handleDoubleClick = (event: MouseEvent) => {
        if (!isClickToPlaceTool(effectiveTool)) {
          return;
        }
        const owner = classifyInteraction(
          getInteractionOwnerOptions(buildSurfacePointerInteractionInput(event, event.button ?? 0))
        );
        if (owner !== 'drawing') {
          return;
        }
        pendingLineClick = null;
        // Forward as a POINTER_DOWN with detail=2 — the reducer recognises
        // that as the polygon/line finish signal.
        const point = resolveInteractiveCanvasPoint(
          getLocalCoordinates(event.clientX, event.clientY),
          effectiveTool,
          viewportRef.current,
          snapOptionsRef.current,
          strokesRef.current
        );
        dispatchInteraction({
          type: 'POINTER_DOWN',
          point,
          detail: 2,
        });
      };
      const handleDoubleClickEvent: EventListener = (event) => {
        if (isDoubleClickDomEvent(event)) {
          handleDoubleClick(event);
        }
      };

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          dispatchInteraction({ type: 'KEY_DOWN', key: 'Escape' });
        }
      };

      const handleBlur = () => {
        pendingLineClick = null;
        dispatchInteraction({ type: 'BLUR' });
      };

      listenerTarget.addEventListener(
        'pointerdown',
        handlePointerDownEvent,
        pointerDownListenerOptions
      );
      // Placement drags (line/bezier) must survive leaving the host between
      // pointerdown and pointerup; document listeners preserve that lifecycle.
      document.addEventListener('pointermove', handlePointerMove);
      document.addEventListener('pointerup', handlePointerUp);
      listenerTarget.addEventListener('dblclick', handleDoubleClickEvent);
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('blur', handleBlur);

      return () => {
        listenerTarget.removeEventListener(
          'pointerdown',
          handlePointerDownEvent,
          pointerDownListenerOptions
        );
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', handlePointerUp);
        listenerTarget.removeEventListener('dblclick', handleDoubleClickEvent);
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('blur', handleBlur);
        gestureOwnerRef.current.reset();
      };
    }, [
      effectiveTool,
      eventTarget,
      applyRulerEdgeConstraint,
      beginRulerEdgeConstraint,
      buildSurfacePointerInteractionInput,
      getInteractionOwnerOptions,
      getLocalCoordinates,
      endRulerEdgeConstraint,
      projectLockedRulerEdge,
      resolveInteractiveCanvasPoint,
      resolvePointerSnap,
      isVirtualPaperActive,
      isDrawingEnabled,
    ]);

    const linePreviewStroke: LineStrokeV2 | null =
      interactionState.phase === 'placingLine'
        ? {
            schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
            id: 'line-preview',
            tool: 'line',
            points:
              interactionState.cursorPoint &&
              !verticesEndWith(interactionState.vertices, interactionState.cursorPoint)
                ? [...interactionState.vertices, interactionState.cursorPoint]
                : [...interactionState.vertices],
            strokeColor: resolvedColor,
            strokeWidth: resolvedOpenWidth,
            dashArray: resolvedDashArray ? [...resolvedDashArray] : undefined,
            dashOffset: resolvedDashOffset,
            fillColor,
            fillOpacity: resolvedFillOpacity,
          }
        : null;

    // Derive polygon preview stroke directly from reducer state. Vertices placed so far
    // plus the cursor edge form a v2 polygon (auto-closes back to vertex 0 via SVG <polygon>).
    const polygonPreviewStroke: PolygonStrokeV2 | null =
      interactionState.phase === 'placingPolygon'
        ? {
            schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
            id: 'polygon-preview',
            tool: 'polygon',
            points:
              interactionState.cursorPoint &&
              !verticesEndWith(interactionState.vertices, interactionState.cursorPoint)
                ? [...interactionState.vertices, interactionState.cursorPoint]
                : [...interactionState.vertices],
            strokeColor: resolvedColor,
            strokeWidth: resolvedClosedWidth,
            dashArray: resolvedDashArray ? [...resolvedDashArray] : undefined,
            dashOffset: resolvedDashOffset,
            fillColor,
            fillOpacity: resolvedFillOpacity,
          }
        : null;

    // Bezier preview mirrors the reducer's three-drag state without storing derived
    // control points: drag 1 shows start→end, drag 2 renders cubic cp2=end for
    // preview only, and drag 3 renders the full [start, cp1, cp2, end] cubic.
    const bezierPreviewStroke: LineStrokeV2 | BezierStrokeV2 | null = (() => {
      if (interactionState.phase !== 'placingBezier') {
        return null;
      }
      const [start, cp1, , end] = interactionState.points;
      const cursor = interactionState.cursorPoint;
      let previewPoints: CanvasPoint[] = [];

      if (interactionState.creationPhase === 'line' && start) {
        const previewEnd = cursor ?? end;
        previewPoints = previewEnd ? [start, previewEnd] : [start];
      } else if (interactionState.creationPhase === 'control1' && start && end) {
        const previewCp1 = cursor ?? cp1 ?? end;
        previewPoints = [start, previewCp1, end, end];
      } else if (interactionState.creationPhase === 'control2' && start && cp1 && end) {
        const previewCp2 = cursor ?? end;
        previewPoints = [start, cp1, previewCp2, end];
      }

      if (previewPoints.length === 0) {
        return null;
      }
      // Drag 1 has only start and end — render as a straight line. Drag 2 and 3
      // have four points in Bezier order and render as transient cubic curves.
      const isCubic = previewPoints.length === 4;
      return {
        schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
        id: 'bezier-preview',
        tool: isCubic ? 'bezier' : ('line' as const),
        points: previewPoints.map((point) => ({ x: point.x, y: point.y })),
        strokeColor: resolvedColor,
        strokeWidth: resolvedOpenWidth,
        dashArray: resolvedDashArray ? [...resolvedDashArray] : undefined,
        dashOffset: resolvedDashOffset,
      };
    })();

    const cursorEnabled = cursor !== false;
    const cursorOptions: DrawingCursorOptions = cursor && typeof cursor === 'object' ? cursor : {};
    const cursorSize =
      typeof cursorOptions.size === 'number' &&
      Number.isFinite(cursorOptions.size) &&
      cursorOptions.size > 0
        ? cursorOptions.size
        : 20;
    const cursorColor = cursorOptions.color ?? 'currentColor';
    const cursorRender = cursorOptions.render;

    type CursorState = {
      visible: boolean;
      screen: { x: number; y: number };
      canvas: { x: number; y: number };
      pointerType: DrawingInputMethod;
    };

    const [cursorState, setCursorState] = useState<CursorState>({
      visible: false,
      screen: { x: 0, y: 0 },
      canvas: { x: 0, y: 0 },
      pointerType: 'mouse',
    });
    const cursorPointerDownRef = useRef(false);

    useEffect(() => {
      if (!cursorEnabled) return undefined;
      const host = hostRef.current;
      if (!host) return undefined;
      const listenerTarget = resolveDrawingEventTarget(eventTarget) ?? host;
      const pointerDownListenerOptions = shouldCaptureVirtualPaperPointerDown(
        listenerTarget,
        host,
        isVirtualPaperActive
      )
        ? POINTER_DOWN_CAPTURE_OPTIONS
        : undefined;

      const normalizePointerType = (value: string | undefined): DrawingInputMethod => {
        if (value === 'touch' || value === 'pen' || value === 'mouse') {
          return value;
        }
        return 'mouse';
      };

      const computePositions = (clientX: number, clientY: number) => {
        const rawScreen = getLocalCoordinates(clientX, clientY);
        const canvas = resolveInteractiveCanvasPoint(
          rawScreen,
          effectiveToolRef.current,
          viewportRef.current,
          snapOptionsRef.current,
          strokesRef.current
        );
        const screen = canvasToScreen(canvas, viewportRef.current);
        return { screen, canvas };
      };

      const readPointer = (
        event: Event
      ): {
        clientX: number;
        clientY: number;
        pointerId: number;
        pointerType: DrawingInputMethod;
      } => {
        const pointerLike = event as Event & {
          clientX?: number;
          clientY?: number;
          pointerId?: number;
          pointerType?: string;
        };
        return {
          clientX: pointerLike.clientX ?? 0,
          clientY: pointerLike.clientY ?? 0,
          pointerId: pointerLike.pointerId ?? 1,
          pointerType: normalizePointerType(pointerLike.pointerType),
        };
      };

      const handleEnter = (event: Event) => {
        const { clientX, clientY, pointerType } = readPointer(event);
        const { screen, canvas } = computePositions(clientX, clientY);
        setCursorState({
          visible: pointerType !== 'touch',
          screen,
          canvas,
          pointerType,
        });
      };

      const handleMove = (event: Event) => {
        const { clientX, clientY, pointerId, pointerType } = readPointer(event);
        const owner = gestureOwnerRef.current.getPointerOwner(pointerId);
        if (owner === 'virtual-paper') {
          setCursorState((prev) => ({ ...prev, visible: false }));
          return;
        }
        const { screen, canvas } = computePositions(clientX, clientY);
        if (pointerType === 'touch' && cursorPointerDownRef.current) {
          cursorPointersRef.current.set(pointerId, screen);
        }
        const nextVisible =
          pointerType === 'touch'
            ? cursorPointerDownRef.current && cursorPointersRef.current.size < 2
            : true;
        setCursorState({ visible: nextVisible, screen, canvas, pointerType });
      };

      const handleLeave = () => {
        cursorPointerDownRef.current = false;
        cursorPointersRef.current.clear();
        setCursorState((prev) => ({ ...prev, visible: false }));
      };

      const handleDown = (event: Event) => {
        const pointer = readPointer(event);
        const owner = gestureOwnerRef.current.getPointerOwner(pointer.pointerId);
        if (owner === 'virtual-paper') {
          cursorPointerDownRef.current = false;
          cursorPointersRef.current.delete(pointer.pointerId);
          setCursorState((prev) => ({
            ...prev,
            visible: false,
            pointerType: pointer.pointerType,
          }));
          return;
        }
        cursorPointerDownRef.current = true;
        const { clientX, clientY, pointerId, pointerType } = pointer;
        const { screen, canvas } = computePositions(clientX, clientY);
        if (pointerType === 'touch') {
          cursorPointersRef.current.set(pointerId, screen);
        }
        setCursorState({
          visible: pointerType !== 'touch' || cursorPointersRef.current.size < 2,
          screen,
          canvas,
          pointerType,
        });
      };

      const handleUp = (event: Event) => {
        const pointer = readPointer(event);
        cursorPointersRef.current.delete(pointer.pointerId);
        const nextTouchPointer =
          pointer.pointerType === 'touch'
            ? Array.from(cursorPointersRef.current.entries()).find(
                ([pointerId]) => pointerId !== pointer.pointerId
              )?.[1]
            : undefined;
        cursorPointerDownRef.current = nextTouchPointer !== undefined;
        // Touch lifts the finger off the surface — hide; mouse/pen keep hovering.
        if (pointer.pointerType === 'touch') {
          if (!nextTouchPointer) {
            setCursorState((prev) => ({
              ...prev,
              visible: false,
              pointerType: pointer.pointerType,
            }));
            return;
          }

          const canvas = resolveInteractiveCanvasPoint(
            nextTouchPointer,
            effectiveToolRef.current,
            viewportRef.current,
            snapOptionsRef.current,
            strokesRef.current
          );
          setCursorState({
            visible: true,
            screen: canvasToScreen(canvas, viewportRef.current),
            canvas,
            pointerType: pointer.pointerType,
          });
        }
      };

      const handleWindowBlur = () => {
        cursorPointerDownRef.current = false;
        cursorPointersRef.current.clear();
        setCursorState((prev) => ({ ...prev, visible: false }));
      };

      listenerTarget.addEventListener('pointerenter', handleEnter);
      listenerTarget.addEventListener('pointermove', handleMove);
      listenerTarget.addEventListener('pointerleave', handleLeave);
      listenerTarget.addEventListener('pointerdown', handleDown, pointerDownListenerOptions);
      listenerTarget.addEventListener('pointerup', handleUp);
      window.addEventListener('blur', handleWindowBlur);

      return () => {
        listenerTarget.removeEventListener('pointerenter', handleEnter);
        listenerTarget.removeEventListener('pointermove', handleMove);
        listenerTarget.removeEventListener('pointerleave', handleLeave);
        listenerTarget.removeEventListener('pointerdown', handleDown, pointerDownListenerOptions);
        listenerTarget.removeEventListener('pointerup', handleUp);
        window.removeEventListener('blur', handleWindowBlur);
      };
    }, [
      cursorEnabled,
      eventTarget,
      getLocalCoordinates,
      resolveInteractiveCanvasPoint,
      isVirtualPaperActive,
    ]);

    const cursorStrokeRadius = (resolvedOpenWidth * viewport.scale) / 2;
    const crosshairStrokeRadius =
      ((isBboxShapeTool(effectiveTool) ? resolvedClosedWidth : resolvedOpenWidth) *
        viewport.scale) /
      2;
    const crosshairCircleRadius = Math.min(
      Math.max(crosshairStrokeRadius, 1),
      Math.max(1, cursorSize / 2 - 1)
    );

    const cursorRenderState: DrawingCursorRenderState = {
      screen: cursorState.screen,
      canvas: cursorState.canvas,
      pointerType: cursorState.pointerType,
      activeTool: effectiveTool,
      visible: cursorState.visible,
      eraserRadius: effectiveTool === 'eraser' ? cursorStrokeRadius : undefined,
    };

    const svgContentTransform = isVirtualPaperActive
      ? undefined
      : `translate(${viewport.tx} ${viewport.ty}) scale(${viewport.scale})`;
    // React Native Web (used by @hamster-note/virtual-paper under React 18)
    // does not auto-size the absolutely-positioned VP container — it collapses
    // to 0×0, making the inner SVG un-hit-testable. Explicitly force it to fill
    // the wrapper so pointer interactions reach the drawing surface.
    const virtualPaperContainerStyle: CSSProperties | undefined = isVirtualPaperActive
      ? {
          width: '100%',
          height: '100%',
          // Virtual-Paper 开启时默认 overflow: visible（笔迹可溢出纸张边界显示），
          // 调用方显式传入 overflow 时优先使用。
          overflow: overflow ?? 'visible',
        }
      : undefined;

    // ---- Minimap 配置解析 ----
    const minimapPosition = minimapOptions.position ?? 'bottom-right';
    const minimapPositionStyle: CSSProperties = (() => {
      const offset = 8;
      const bottomOffset = minimapOptions.bottomOffset ?? offset;
      switch (minimapPosition) {
        case 'top-left':
          return { position: 'absolute', top: offset, left: offset, zIndex: 10 };
        case 'top-right':
          return { position: 'absolute', top: offset, right: offset, zIndex: 10 };
        case 'bottom-left':
          return {
            position: 'absolute',
            bottom: bottomOffset,
            left: offset,
            zIndex: 10,
          };
        default:
          return {
            position: 'absolute',
            bottom: bottomOffset,
            right: offset,
            zIndex: 10,
          };
      }
    })();
    const selectionControlsBox =
      activeSelectionFrame === null ? null : selectionFrameLocalBox(activeSelectionFrame);
    const selectionControlsRotationDeg =
      activeSelectionFrame === null ? 0 : (activeSelectionFrame.rotationRad * 180) / Math.PI;
    const selectionControlsTransform =
      activeSelectionFrame === null || activeSelectionFrame.rotationRad === 0
        ? undefined
        : `rotate(${selectionControlsRotationDeg} ${activeSelectionFrame.center.x} ${activeSelectionFrame.center.y})`;
    const selectedTextBox =
      selectedTextStroke === null ? null : textBoxFromPoints(selectedTextStroke.points);
    const selectedTextRotationDeg =
      typeof selectedTextStroke?.rotationRad === 'number'
        ? (selectedTextStroke.rotationRad * 180) / Math.PI
        : 0;
    const selectedTextTransform =
      selectedTextBox === null || selectedTextRotationDeg === 0
        ? undefined
        : `rotate(${selectedTextRotationDeg} ${selectedTextBox.x + selectedTextBox.width / 2} ${selectedTextBox.y + selectedTextBox.height / 2})`;

    const drawingSurfaceSvg = (
      <svg
        data-pressure-multiplier={String(resolvedPressureMultiplier)}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          // Virtual-Paper 开启时默认 overflow: visible；显式传入的 overflow 优先。
          overflow: isVirtualPaperActive ? (overflow ?? 'visible') : overflow,
        }}
      >
        <title>Drawing surface</title>
        <g transform={svgContentTransform}>
          {strokes.map((stroke) =>
            effectiveTool === 'text' && editingTextId === stroke.id ? null : (
              <StrokeRenderer
                key={stroke.id}
                stroke={stroke}
                isActive={selectedIdSet.has(stroke.id)}
                fallbackColor={resolvedColor}
                fallbackWidth={resolvedOpenWidth}
                fallbackClosedWidth={resolvedClosedWidth}
                fallbackDashArray={resolvedDashArray}
                fallbackDashOffset={resolvedDashOffset}
                fallbackFillColor={fillColor}
                fallbackFillOpacity={resolvedFillOpacity}
                pressureMultiplier={resolvedPressureMultiplier}
              />
            )
          )}

          {effectiveTool === 'text' &&
            selectedTextStroke !== null &&
            selectedTextBox !== null &&
            editingTextId === selectedTextStroke.id && (
              <foreignObject
                x={selectedTextBox.x}
                y={selectedTextBox.y}
                width={selectedTextBox.width}
                height={selectedTextBox.height}
                transform={selectedTextTransform}
              >
                <textarea
                  ref={textEditorRef}
                  data-text-editor
                  data-testid="text-editor"
                  aria-label="Text content"
                  value={selectedTextStroke.text ?? ''}
                  placeholder="输入文字"
                  onChange={(event) => {
                    const currentStroke = strokesRef.current.find(
                      (stroke) => stroke.id === selectedTextStroke.id && stroke.tool === 'text'
                    );
                    if (currentStroke !== undefined) {
                      const nextText = event.currentTarget.value;
                      const nextStroke = {
                        ...currentStroke,
                        text: nextText,
                        points: resizeTextBoxHeight(
                          currentStroke.points,
                          resolveTextBoxHeight(
                            nextText,
                            resolveTextFontSize(currentStroke.fontSize),
                            textBoxFromPoints(currentStroke.points)?.width ?? MIN_TEXT_BOX_WIDTH,
                            event.currentTarget.scrollHeight
                          )
                        ),
                      };
                      updateStrokesRef.current([nextStroke]);
                      commitSelectionFrame(selectionFrameFromTextStroke(nextStroke));
                    }
                  }}
                  onBlur={finishEditingText}
                  onPointerDown={(event) => event.stopPropagation()}
                  style={{
                    width: '100%',
                    height: '100%',
                    boxSizing: 'border-box',
                    padding: 0,
                    border: 0,
                    outline: 'none',
                    resize: 'none',
                    overflow: 'hidden',
                    background: 'transparent',
                    color: selectedTextStroke.strokeColor ?? resolvedColor,
                    fontSize: resolveTextFontSize(selectedTextStroke.fontSize),
                    lineHeight: TEXT_LINE_HEIGHT,
                    fontFamily: 'inherit',
                    userSelect: 'text',
                    WebkitUserSelect: 'text',
                  }}
                />
              </foreignObject>
            )}

          {activeStroke && (
            <StrokeRenderer
              stroke={activeStroke}
              isActive={true}
              fallbackColor={resolvedColor}
              fallbackWidth={resolvedOpenWidth}
              fallbackClosedWidth={resolvedClosedWidth}
              fallbackDashArray={resolvedDashArray}
              fallbackDashOffset={resolvedDashOffset}
              fallbackFillColor={fillColor}
              fallbackFillOpacity={resolvedFillOpacity}
              pressureMultiplier={resolvedPressureMultiplier}
            />
          )}

          {linePreviewStroke && (
            <StrokeRenderer
              stroke={linePreviewStroke}
              isActive={true}
              fallbackColor={resolvedColor}
              fallbackWidth={resolvedOpenWidth}
              fallbackClosedWidth={resolvedClosedWidth}
              fallbackDashArray={resolvedDashArray}
              fallbackDashOffset={resolvedDashOffset}
              fallbackFillColor={fillColor}
              fallbackFillOpacity={resolvedFillOpacity}
              pressureMultiplier={resolvedPressureMultiplier}
            />
          )}

          {polygonPreviewStroke && (
            <StrokeRenderer
              stroke={polygonPreviewStroke}
              isActive={true}
              fallbackColor={resolvedColor}
              fallbackWidth={resolvedOpenWidth}
              fallbackClosedWidth={resolvedClosedWidth}
              fallbackDashArray={resolvedDashArray}
              fallbackDashOffset={resolvedDashOffset}
              fallbackFillColor={fillColor}
              fallbackFillOpacity={resolvedFillOpacity}
              pressureMultiplier={resolvedPressureMultiplier}
            />
          )}

          {bezierPreviewStroke && (
            <StrokeRenderer
              stroke={bezierPreviewStroke}
              isActive={true}
              fallbackColor={resolvedColor}
              fallbackWidth={resolvedOpenWidth}
              fallbackClosedWidth={resolvedClosedWidth}
              fallbackDashArray={resolvedDashArray}
              fallbackDashOffset={resolvedDashOffset}
              fallbackFillColor={fillColor}
              fallbackFillOpacity={resolvedFillOpacity}
              pressureMultiplier={resolvedPressureMultiplier}
            />
          )}

          <g data-testid="eraser-trajectory-layer">
            {resolvedEraserTrajectory.visible &&
              effectiveTool === 'eraser' &&
              eraserTrajectoryPoints.length > 0 && (
                <polyline
                  data-testid="eraser-trajectory"
                  points={eraserTrajectoryPoints.map((point) => `${point.x},${point.y}`).join(' ')}
                  stroke={resolvedEraserTrajectory.color}
                  strokeWidth={resolvedEraserTrajectory.lineWidth}
                  opacity={resolvedEraserTrajectory.opacity}
                  fill="none"
                  pointerEvents="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
          </g>
          {lassoPreviewPoints.length > 1 && (
            <polyline
              data-testid="lasso-preview"
              points={lassoPreviewPoints.map((point) => `${point.x},${point.y}`).join(' ')}
              fill="rgba(59,130,246,0.1)"
              stroke="rgb(59,130,246)"
              strokeWidth={2 / viewport.scale}
              strokeDasharray={`${4 / viewport.scale} ${4 / viewport.scale}`}
              pointerEvents="none"
            />
          )}
          {effectiveTool === 'lasso' &&
            selectedIds.length > 0 &&
            selectedTextStroke === null &&
            activeSelectionFrame != null &&
            selectionControlsBox != null && (
              <g
                data-testid="lasso-selection-controls"
                data-rotation-rad={activeSelectionFrame.rotationRad}
                transform={selectionControlsTransform}
              >
                <rect
                  data-testid="lasso-selection-box"
                  x={selectionControlsBox.minX}
                  y={selectionControlsBox.minY}
                  width={selectionControlsBox.maxX - selectionControlsBox.minX}
                  height={selectionControlsBox.maxY - selectionControlsBox.minY}
                  fill="rgba(59,130,246,0.2)"
                  stroke="rgb(59,130,246)"
                  strokeWidth={3 / viewport.scale}
                  strokeDasharray={`${4 / viewport.scale} ${4 / viewport.scale}`}
                  pointerEvents="none"
                  data-padding={SELECTION_BOX_PADDING}
                />
                <line
                  x1={activeSelectionFrame.center.x}
                  y1={selectionControlsBox.minY}
                  x2={activeSelectionFrame.center.x}
                  y2={selectionControlsBox.minY - LASSO_ROTATE_HANDLE_OFFSET_PX / viewport.scale}
                  stroke="rgb(59,130,246)"
                  strokeWidth={2 / viewport.scale}
                  pointerEvents="none"
                />
                <g
                  data-testid="lasso-rotate-handle"
                  data-lasso-rotate-handle="true"
                  style={{ cursor: 'grab' }}
                >
                  <circle
                    cx={activeSelectionFrame.center.x}
                    cy={selectionControlsBox.minY - LASSO_ROTATE_HANDLE_OFFSET_PX / viewport.scale}
                    r={LASSO_ROTATE_HANDLE_HIT_SIZE_PX / 2 / viewport.scale}
                    fill="transparent"
                  />
                  <circle
                    cx={activeSelectionFrame.center.x}
                    cy={selectionControlsBox.minY - LASSO_ROTATE_HANDLE_OFFSET_PX / viewport.scale}
                    r={LASSO_ROTATE_HANDLE_SIZE_PX / 2 / viewport.scale}
                    fill="white"
                    stroke="rgb(59,130,246)"
                    strokeWidth={2 / viewport.scale}
                    pointerEvents="none"
                  />
                </g>
                {LASSO_RESIZE_HANDLES.map(({ handle, xRatio, yRatio, cursor }) => {
                  const size = LASSO_RESIZE_HANDLE_SIZE_PX / viewport.scale;
                  const centerX =
                    selectionControlsBox.minX +
                    (selectionControlsBox.maxX - selectionControlsBox.minX) * xRatio;
                  const centerY =
                    selectionControlsBox.minY +
                    (selectionControlsBox.maxY - selectionControlsBox.minY) * yRatio;
                  return (
                    <rect
                      key={handle}
                      data-testid={`lasso-resize-handle-${handle}`}
                      data-lasso-resize-handle={handle}
                      x={centerX - size / 2}
                      y={centerY - size / 2}
                      width={size}
                      height={size}
                      rx={1 / viewport.scale}
                      fill="white"
                      stroke="rgb(59,130,246)"
                      strokeWidth={2 / viewport.scale}
                      style={{ cursor }}
                    />
                  );
                })}
              </g>
            )}

          {(effectiveTool === 'text' || effectiveTool === 'lasso') &&
            selectedTextStroke !== null &&
            selectedTextBox !== null &&
            selectionControlsBox !== null &&
            activeSelectionFrame !== null && (
              <g
                data-testid="text-selection-controls"
                data-rotation-rad={activeSelectionFrame.rotationRad}
                transform={selectionControlsTransform}
              >
                <rect
                  data-testid="text-selection-box"
                  x={selectionControlsBox.minX}
                  y={selectionControlsBox.minY}
                  width={selectionControlsBox.maxX - selectionControlsBox.minX}
                  height={selectionControlsBox.maxY - selectionControlsBox.minY}
                  fill="rgba(59,130,246,0.2)"
                  stroke="rgb(59,130,246)"
                  strokeWidth={3 / viewport.scale}
                  strokeDasharray={`${4 / viewport.scale} ${4 / viewport.scale}`}
                  pointerEvents="none"
                  data-padding={SELECTION_BOX_PADDING}
                />
                <rect
                  data-testid="text-selection-edge"
                  data-text-selection-edge="true"
                  x={selectionControlsBox.minX}
                  y={selectionControlsBox.minY}
                  width={selectionControlsBox.maxX - selectionControlsBox.minX}
                  height={selectionControlsBox.maxY - selectionControlsBox.minY}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={12}
                  pointerEvents="stroke"
                  style={{ cursor: 'move' }}
                />
                {(
                  [
                    ['left', 'w', selectedTextBox.x],
                    ['right', 'e', selectedTextBox.x + selectedTextBox.width],
                  ] as const
                ).map(([side, handle, centerX]) => {
                  const size = LASSO_RESIZE_HANDLE_SIZE_PX / viewport.scale;
                  const centerY = selectedTextBox.y + selectedTextBox.height / 2;
                  return (
                    <rect
                      key={side}
                      data-testid={`text-resize-handle-${side}`}
                      data-lasso-resize-handle={handle}
                      x={centerX - size / 2}
                      y={centerY - size / 2}
                      width={size}
                      height={size}
                      rx={1 / viewport.scale}
                      fill="white"
                      stroke="rgb(59,130,246)"
                      strokeWidth={2 / viewport.scale}
                      style={{ cursor: 'ew-resize' }}
                    />
                  );
                })}
              </g>
            )}
        </g>
      </svg>
    );

    const rulerLayout = (() => {
      if (!isRulerEnabled || !currentRulerRect) return null;
      const { height, rotationRad } = currentRulerRect;
      const viewportSize = {
        width: rulerViewportSize.width || currentRulerRect.length,
        height: rulerViewportSize.height || Math.max(height, 200),
      };
      return getInfiniteRulerLayout({
        logicalCenter: currentRulerRect.center,
        rotationRad,
        height,
        viewport: viewportSize,
      });
    })();

    const rulerOverlay = (() => {
      if (!currentRulerRect || !rulerLayout) return null;
      const { height, rotationRad } = currentRulerRect;
      const layout = rulerLayout;
      const left = layout.visualCenter.x - layout.renderLength / 2;
      const top = layout.visualCenter.y - height / 2;
      return (
        <div
          data-testid="drawing-ruler-overlay"
          style={{
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
            zIndex: 0,
            // 尺子拖动由宿主捕获阶段按几何范围识别。视觉层必须穿透，
            // 否则作为 VirtualPaper 的兄弟节点会截断 wheel 事件的冒泡路径。
            pointerEvents: 'none',
          }}
        >
          <svg width="100%" height="100%" style={{ display: 'block', overflow: 'hidden' }}>
            <title>Ruler overlay</title>
            <g
              data-testid="drawing-ruler"
              data-ruler-center-x={String(currentRulerRect.center.x)}
              data-ruler-center-y={String(currentRulerRect.center.y)}
              data-ruler-length={String(layout.renderLength)}
              data-ruler-height={String(height)}
              data-ruler-rotation={String(rotationRad)}
              transform={`rotate(${rotationRad * (180 / Math.PI)} ${layout.visualCenter.x} ${layout.visualCenter.y})`}
              onPointerEnter={(event) => {
                if (event.pointerType === 'mouse') {
                  setHasRulerModifierHover(event.altKey || event.ctrlKey || event.metaKey);
                }
              }}
              onPointerMove={(event) => {
                if (event.pointerType === 'mouse' && !isRulerDragging) {
                  setHasRulerModifierHover(event.altKey || event.ctrlKey || event.metaKey);
                }
              }}
              onPointerLeave={() => setHasRulerModifierHover(false)}
              style={{
                cursor: isRulerDragging ? 'grabbing' : hasRulerModifierHover ? 'grab' : 'default',
              }}
            >
              <rect
                data-testid="drawing-ruler-background"
                x={left}
                y={top}
                width={layout.renderLength}
                height={height}
                fill={effectiveRulerOptions.backgroundColor ?? '#e0e0e0'}
                fillOpacity={String(effectiveRulerOptions.backgroundOpacity ?? 0.2)}
              />
              <g transform={`translate(${layout.visualCenter.x} ${layout.visualCenter.y})`}>
                <RulerTicks
                  length={layout.renderLength}
                  height={height}
                  pixelsPerInch={effectiveRulerOptions.pixelsPerInch}
                  originX={layout.tickOriginX}
                />
              </g>
            </g>
          </svg>
        </div>
      );
    })();

    const rulerAngleFeedback =
      rulerRotationFeedback !== null ? (
        <svg
          width="100%"
          height="100%"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 20,
            pointerEvents: 'none',
          }}
        >
          <title>Ruler angle feedback</title>
          <g
            data-testid="drawing-ruler-angle-feedback"
            data-feedback-x={String(rulerRotationFeedback.point.x)}
            data-feedback-y={String(rulerRotationFeedback.point.y)}
            transform={`translate(${rulerRotationFeedback.point.x} ${rulerRotationFeedback.point.y})`}
          >
            <circle cx={0} cy={0} r={22} fill="white" />
            <text
              x={0}
              y={0}
              fill="black"
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={13}
              fontWeight={600}
              style={{ fontVariantNumeric: 'tabular-nums', userSelect: 'none' }}
            >
              {formatAngleDegrees(rulerRotationFeedback.rotationRad)}
            </text>
          </g>
        </svg>
      ) : null;

    return (
      <div
        ref={hostRef}
        data-testid={testID}
        data-tool={effectiveTool}
        data-enabled={String(isDrawingEnabled)}
        data-stroke-count={strokes.length}
        data-active-tool={effectiveTool}
        data-scale={String(viewport.scale)}
        data-tx={String(viewport.tx)}
        data-ty={String(viewport.ty)}
        style={{
          width: '100%',
          height: '100%',
          minHeight: '200px',
          border: '1px solid #ccc',
          position: 'relative',
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          cursor: cursorEnabled ? 'none' : undefined,
        }}
        onPointerDownCapture={handleZoomPointerDownCapture}
        onPointerMoveCapture={handleZoomPointerMoveCapture}
        onPointerUpCapture={handleZoomPointerEndCapture}
        onPointerCancelCapture={handleZoomPointerEndCapture}
      >
        <VirtualPaperSurfaceFrame
          enabled={isVirtualPaperActive}
          options={resolvedVirtualPaperOptions}
          viewport={viewport}
          onViewportChange={handleVirtualPaperViewportChange}
          containerStyle={virtualPaperContainerStyle}
        >
          {drawingSurfaceSvg}
        </VirtualPaperSurfaceFrame>
        {cursorEnabled && cursorState.visible && (
          <div
            data-crosshair-layer
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: cursorState.screen.x,
                top: cursorState.screen.y,
                transform: 'translate(-50%, -50%)',
              }}
            >
              {cursorRender ? (
                cursorRender(cursorRenderState)
              ) : effectiveTool === 'eraser' && cursorRenderState.eraserRadius !== undefined ? (
                (() => {
                  // 屏幕坐标系下的圆形橡皮指示器。viewBox 取直径+2px 余量
                  // 防止 stroke=1 时被裁切；用 overflow="visible" 双保险。
                  const radius = cursorRenderState.eraserRadius;
                  const size = radius * 2 + 2;
                  return (
                    <svg
                      data-testid="eraser-cursor"
                      width={size}
                      height={size}
                      viewBox={`-${radius + 1} -${radius + 1} ${size} ${size}`}
                      style={{ display: 'block', overflow: 'visible' }}
                    >
                      <title>Eraser cursor</title>
                      <circle
                        cx={0}
                        cy={0}
                        r={radius}
                        fill="none"
                        stroke={cursorColor}
                        strokeWidth={1}
                      />
                    </svg>
                  );
                })()
              ) : (
                <svg
                  data-crosshair
                  width={cursorSize}
                  height={cursorSize}
                  viewBox={`0 0 ${cursorSize} ${cursorSize}`}
                  style={{ display: 'block', overflow: 'visible' }}
                >
                  <title>Pointer crosshair</title>
                  <line
                    x1={0}
                    y1={cursorSize / 2}
                    x2={cursorSize}
                    y2={cursorSize / 2}
                    stroke={cursorColor}
                    strokeWidth={1}
                  />
                  <line
                    x1={cursorSize / 2}
                    y1={0}
                    x2={cursorSize / 2}
                    y2={cursorSize}
                    stroke={cursorColor}
                    strokeWidth={1}
                  />
                  <circle
                    data-testid="crosshair-center-circle"
                    cx={cursorSize / 2}
                    cy={cursorSize / 2}
                    r={crosshairCircleRadius}
                    fill="none"
                    stroke={cursorColor}
                    strokeWidth={1}
                  />
                </svg>
              )}
            </div>
          </div>
        )}
        {minimapEnabled && hostSize.width > 0 && hostSize.height > 0 && (
          <Minimap
            strokes={strokes}
            viewport={viewport}
            onViewportChange={handleViewportChange}
            hostSize={hostSize}
            isPointerReserved={isPointerReservedForRuler}
            width={minimapOptions.width}
            height={minimapOptions.height}
            testID={minimapOptions.testID}
            style={minimapPositionStyle}
          />
        )}
        {rulerOverlay}
        {rulerAngleFeedback}
        {zoomFeedback && <InteractionFeedback {...zoomFeedback} />}
      </div>
    );
  }
);
