import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useCanvas } from '../hooks/useCanvas';
import { createGestureAdapter, type GestureAdapterInput } from '../input/gestureAdapter';
import { type CanvasPoint, createInitialState, interactionReducer } from '../interaction/reducer';
import {
  type BezierStrokeV2,
  DRAWING_STROKE_SCHEMA_VERSION,
  type LineStrokeV2,
  type PolygonStrokeV2,
} from '../model/strokes';
import { StrokeRenderer } from '../render/StrokeRenderer';
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
  pickRenderedStrokeIntersectingPolyline,
  pickRenderedStrokeIntersectingSegment,
  type RenderedStrokeHitTestOptions,
} from '../utils';
import {
  type DrawingViewport,
  resetViewport as createResetViewport,
  screenToCanvas,
  zoomViewportAroundScreenPoint,
} from '../viewport';

// Public drawing contract types
export type DrawingTool = 'pen' | 'line' | 'rect' | 'ellipse' | 'polygon' | 'bezier' | 'eraser';
export type DrawingInputMethod = 'touch' | 'mouse' | 'pen';

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

export type DrawingPoint = {
  x: number;
  y: number;
  pressure?: number;
};

export type DrawingStroke = {
  id: string;
  tool: DrawingTool;
  points: DrawingPoint[];
  strokeColor?: string;
  strokeWidth?: number;
  dashArray?: number[];
  dashOffset?: number;
  fillColor?: string;
  fillOpacity?: number;
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
   * Eraser pickup radius in CSS pixels (screen-space). Defined ONLY when the
   * active tool is `eraser`; `undefined` for every other tool. The default
   * cursor renderer reads this to draw the eraser hover circle; custom
   * `render` callbacks may also consult it to visualise the same radius.
   */
  eraserRadius?: number;
};

/**
 * Cursor overlay configuration. Pass `false` to disable the overlay entirely.
 * When undefined (the default), the surface renders a 10px screen-pixel
 * crosshair centered on the pointer.
 */
export type DrawingCursorOptions = {
  /** Square size in CSS pixels (length of each cross arm). Defaults to 10. */
  size?: number;
  /** Stroke color used by the default crosshair shape. Defaults to `currentColor`. */
  color?: string;
  /** Override the rendered crosshair entirely. Receives current pointer state. */
  render?: (state: DrawingCursorRenderState) => ReactNode;
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

type ActivePointer = { x: number; y: number };

/**
 * Gesture enum values that control viewport pan/zoom interactions.
 * When `gestures` is omitted, all pan/zoom gestures are disabled (legacy default).
 * When `gestures` is an explicit empty array `[]`, all pan/zoom gestures are disabled
 * while drawing remains available. Individual enum values opt-in specific behaviors.
 *
 * - `TouchSinglePan`: single-touch drag routes to viewport pan before drawing; non-touch pointers can still draw.
 * - `TouchDoublePan`: two-finger drag translates viewport centroid.
 * - `TouchDoubleZoom`: two-finger pinch scales viewport.
 * - `MousePan`: mouse drag routes to viewport pan before drawing; non-mouse pointers can still draw.
 * - `MouseWheelPan`: mouse wheel / trackpad two-axis scroll translates viewport.
 * - `MouseWheelAndCtrlPan`: Ctrl/Command + mouse wheel translates viewport.
 * - `MouseAndCtrlPan`: Ctrl/Command + mouse drag routes to viewport pan.
 * - `MouseAndSpacePan`: Space + mouse drag routes to viewport pan.
 * - `MouseWheelZoom`: mouse wheel zooms viewport around cursor.
 * - `MouseWheelAndCtrlZoom`: Ctrl/Command + mouse wheel zooms viewport around cursor.
 * - `NatureMouseWheel`: reverses all mouse wheel pan/zoom delta directions.
 * - `PenPan`: pen drag routes to viewport pan before drawing; non-pen pointers can still draw.
 */
export type DrawingGesture =
  | 'TouchSinglePan'
  | 'TouchDoublePan'
  | 'TouchDoubleZoom'
  | 'MousePan'
  | 'MouseWheelPan'
  | 'MouseWheelAndCtrlPan'
  | 'MouseAndCtrlPan'
  | 'MouseAndSpacePan'
  | 'MouseWheelZoom'
  | 'MouseWheelAndCtrlZoom'
  | 'NatureMouseWheel'
  | 'PenPan';

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
   * Opt-in viewport gesture list. Omitted preserves current default behavior
   * (no pan/pinch/wheel gestures). Explicit empty array `[]` disables all
   * pan/zoom gestures while drawing remains available.
   */
  gestures?: readonly DrawingGesture[];
  /**
   * Viewport scale bounds for pinch zoom and wheel zoom. Replaces old
   * `gestures.minScale/maxScale` after the gesture enum migration.
   */
  gestureScaleBounds?: { minScale?: number; maxScale?: number };
  /**
   * When true, installs `host.resetViewport()` for imperative viewport reset.
   * Replaces old `gestures.reset` after the gesture enum migration.
   */
  gestureReset?: boolean;
  /**
   * Pressure multiplier applied at render time. Default `1`. Invalid values
   * (NaN, Infinity, non-finite, <=0, non-number) resolve to `1`. Does NOT
   * mutate stored `point.pressure`; only scales rendered width.
   */
  pressureMultiplier?: number;
  /** Test identifier. */
  testID?: string;
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
    tool === 'eraser'
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

function isClosedShapeTool(tool: DrawingTool): boolean {
  return tool === 'rect' || tool === 'ellipse' || tool === 'polygon';
}

// Shift constraint only applies to bbox-defined shapes (rect/ellipse).
// Polygon is closed but defined by vertex list, not bbox; shift has no meaning there.
function isBboxShapeTool(tool: DrawingTool): boolean {
  return tool === 'rect' || tool === 'ellipse';
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
const DEFAULT_MIN_VIEWPORT_SCALE = 0.25;
const DEFAULT_MAX_VIEWPORT_SCALE = 8;
const WHEEL_ZOOM_DELTA_SCALE = 0.002;

function normalizeGestureList(
  gestures: readonly DrawingGesture[] | undefined
): Set<DrawingGesture> | undefined {
  // Runtime JS callers can still pass the removed object shape. Treat any
  // non-array value as omitted enum routing, without reintroducing compatibility.
  if (!Array.isArray(gestures)) {
    return undefined;
  }

  return new Set(gestures);
}

function isSinglePanEnabled(
  pointerType: string | undefined,
  gestureSet: Set<DrawingGesture> | undefined
): boolean {
  if (!gestureSet) {
    return false;
  }
  if (pointerType === 'touch' || pointerType === undefined) {
    return gestureSet.has('TouchSinglePan');
  }
  if (pointerType === 'mouse') {
    return gestureSet.has('MousePan');
  }
  if (pointerType === 'pen') {
    return gestureSet.has('PenPan');
  }
  return false;
}

function hasCommandModifier(event: MouseEvent | PointerEvent | WheelEvent): boolean {
  return event.ctrlKey === true || event.metaKey === true;
}

function isMouseSinglePanEnabled(
  input: GestureAdapterInput,
  event: PointerEvent,
  gestureSet: Set<DrawingGesture> | undefined,
  spacePressed: boolean
): boolean {
  if (input.pointerType !== 'mouse') {
    return isSinglePanEnabled(input.pointerType, gestureSet);
  }
  if (!gestureSet) {
    return false;
  }
  // 先匹配带修饰键的鼠标拖拽，避免只想按 Ctrl/Space 平移时普通鼠标拖拽抢占绘制。
  if (hasCommandModifier(event) && gestureSet.has('MouseAndCtrlPan')) {
    return true;
  }
  if (spacePressed && gestureSet.has('MouseAndSpacePan')) {
    return true;
  }
  return gestureSet.has('MousePan');
}

function isTouchDoublePanEnabled(gestureSet: Set<DrawingGesture> | undefined): boolean {
  return gestureSet?.has('TouchDoublePan') ?? false;
}

function isTouchDoubleZoomEnabled(gestureSet: Set<DrawingGesture> | undefined): boolean {
  return gestureSet?.has('TouchDoubleZoom') ?? false;
}

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

function resolveGestureScaleBounds(
  scaleBounds: { minScale?: number; maxScale?: number } | undefined
) {
  const rawMin =
    typeof scaleBounds?.minScale === 'number' && Number.isFinite(scaleBounds.minScale)
      ? scaleBounds.minScale
      : DEFAULT_MIN_VIEWPORT_SCALE;
  const rawMax =
    typeof scaleBounds?.maxScale === 'number' && Number.isFinite(scaleBounds.maxScale)
      ? scaleBounds.maxScale
      : DEFAULT_MAX_VIEWPORT_SCALE;
  const minScale = Math.max(DEFAULT_MIN_VIEWPORT_SCALE, Math.min(rawMin, rawMax));
  const maxScale = Math.min(DEFAULT_MAX_VIEWPORT_SCALE, Math.max(rawMin, rawMax));

  return { minScale, maxScale };
}

function clampGestureScale(scale: number, bounds: { minScale: number; maxScale: number }): number {
  if (Number.isNaN(scale)) {
    return 1;
  }
  return Math.max(bounds.minScale, Math.min(bounds.maxScale, scale));
}

export function DrawingSurface(props: DrawingSurfaceProps) {
  const {
    tool,
    value,
    defaultValue,
    onChange,
    strokeColor,
    strokeWidth,
    dashArray,
    dashOffset,
    fillColor,
    fillOpacity,
    strokeSmoothing,
    inputMethods,
    pressure,
    samplingRate,
    cursor,
    gestures,
    gestureScaleBounds,
    gestureReset,
    pressureMultiplier,
    eraserCommitMode,
    eraserTrajectory,
    testID,
  } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<DrawingViewport>(() => createResetViewport());
  const viewportRef = useRef<DrawingViewport>(viewport);
  viewportRef.current = viewport;
  const normalizedGestureSet = useMemo(() => normalizeGestureList(gestures), [gestures]);
  const gestureSetRef = useRef<Set<DrawingGesture> | undefined>(normalizedGestureSet);
  gestureSetRef.current = normalizedGestureSet;

  const effectiveTool: DrawingTool = isDrawingToolSupported(tool) ? tool : 'pen';
  const isDrawingEnabled = tool === undefined || isDrawingToolSupported(tool);

  const resolvedColor = strokeColor && strokeColor.trim() !== '' ? strokeColor : 'black';
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

  const { strokes, activeStroke, setActiveStroke, addStroke, removeStroke } = useCanvas({
    value,
    onChange,
    defaultValue: initialDefaultValueRef.current,
  });

  // Click-to-place interaction state (polygon tool). The standalone reducer from Task 5
  // owns all vertex/cursor bookkeeping and completion semantics; we only translate native
  // pointer events to reducer actions and observe `completedStroke` to commit.
  const [interactionState, dispatchInteraction] = useReducer(
    interactionReducer,
    effectiveTool,
    createInitialState
  );
  const isDrawingRef = useRef(false);
  const activePointersRef = useRef(new Map<number, ActivePointer>());
  const processedPathLengthRef = useRef(0);
  const effectiveToolRef = useRef(effectiveTool);
  const isDrawingEnabledRef = useRef(isDrawingEnabled);
  const previousValueRef = useRef(value);
  const addStrokeRef = useRef(addStroke);
  const removeStrokeRef = useRef(removeStroke);
  const clearActiveStrokeRef = useRef<(() => void) | null>(null);
  const resolvedColorRef = useRef(resolvedColor);
  const resolvedOpenWidthRef = useRef(resolvedOpenWidth);
  const resolvedClosedWidthRef = useRef(resolvedClosedWidth);
  const resolvedPressureMultiplierRef = useRef(resolvedPressureMultiplier);
  const resolvedDashArrayRef = useRef(resolvedDashArray);
  const resolvedDashOffsetRef = useRef(resolvedDashOffset);
  const resolvedFillColorRef = useRef(fillColor);
  const resolvedFillOpacityRef = useRef(resolvedFillOpacity);
  const strokesRef = useRef(strokes);
  const gestureScaleBoundsRef = useRef(gestureScaleBounds);
  gestureScaleBoundsRef.current = gestureScaleBounds;
  const pressureRef = useRef(pressure);
  const inputMethodsRef = useRef<DrawingInputMethod[]>(DEFAULT_INPUT_METHODS);
  const smoothingOptionsRef = useRef(resolveStrokeSmoothingOptions(strokeSmoothing));

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
  addStrokeRef.current = addStroke;
  removeStrokeRef.current = removeStroke;
  strokesRef.current = strokes;
  resolvedColorRef.current = resolvedColor;
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
  samplingRateRef.current = resolvedSamplingRate;
  eraserCommitModeRef.current = resolvedEraserCommitMode;

  const getLocalCoordinates = useCallback((clientX: number, clientY: number): DrawingPoint => {
    if (!hostRef.current) {
      return { x: 0, y: 0 };
    }
    const rect = hostRef.current.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }, []);

  const resetViewportToDefault = useCallback(() => {
    setViewport(createResetViewport());
  }, []);

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

    const adapter = createGestureAdapter({ initialScale: viewportRef.current.scale });
    const activePointers = activePointersRef.current;
    const pointerStartEvents = new Map<number, PointerInputEvent>();
    const capturedPointerIds = new Set<number>();
    let currentActiveStroke: DrawingStroke | null = null;
    let multiStartViewport: DrawingViewport | null = null;
    let multiStartCenter: DrawingPoint | null = null;
    let accumulatedCenterDelta: DrawingPoint = { x: 0, y: 0 };
    let singlePan: {
      pointerId: number;
      startPoint: DrawingPoint;
      startViewport: DrawingViewport;
    } | null = null;
    let spacePressed = false;

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

    const toAdapterInput = (
      event: PointerEvent,
      phase: GestureAdapterInput['phase']
    ): GestureAdapterInput => ({
      pointerId: event.pointerId ?? 1,
      phase,
      point: getLocalCoordinates(event.clientX ?? 0, event.clientY ?? 0),
      timestamp: event.timeStamp ?? 0,
      pointerType: event.pointerType,
      pressure: event.pressure,
      isPrimary: event.isPrimary,
    });

    const releasePointerCapture = (pointerId: number) => {
      if (!capturedPointerIds.has(pointerId)) {
        return;
      }
      if (
        typeof host.releasePointerCapture === 'function' &&
        (typeof host.hasPointerCapture !== 'function' || host.hasPointerCapture(pointerId))
      ) {
        host.releasePointerCapture(pointerId);
      }
      capturedPointerIds.delete(pointerId);
    };

    const capturePointer = (event: PointerEvent) => {
      if (typeof host.setPointerCapture !== 'function') {
        return;
      }
      host.setPointerCapture(event.pointerId);
      capturedPointerIds.add(event.pointerId);
    };

    const updateActivePointers = (input: GestureAdapterInput) => {
      if (input.phase === 'start') {
        activePointers.set(input.pointerId, input.point);
        return;
      }

      if (input.phase === 'move') {
        if (activePointers.has(input.pointerId)) {
          activePointers.set(input.pointerId, input.point);
        }
        return;
      }

      activePointers.delete(input.pointerId);
    };

    const startSinglePan = (input: GestureAdapterInput, event: PointerEvent) => {
      if (
        !isMouseSinglePanEnabled(input, event, gestureSetRef.current, spacePressed) ||
        isDrawingRef.current
      ) {
        return;
      }

      singlePan = {
        pointerId: input.pointerId,
        startPoint: input.point,
        startViewport: viewportRef.current,
      };
      dispatchInteraction({
        type: 'POINTER_DOWN',
        gesture: 'pan',
        viewport: viewportRef.current,
        pointerId: input.pointerId,
        point: input.point,
      });
    };

    const handleSingleMove = (
      input: GestureAdapterInput,
      event: PointerEvent,
      path: GestureAdapterInput[]
    ) => {
      if (singlePan && singlePan.pointerId === input.pointerId) {
        const dx = input.point.x - singlePan.startPoint.x;
        const dy = input.point.y - singlePan.startPoint.y;
        const nextViewport = {
          scale: singlePan.startViewport.scale,
          tx: singlePan.startViewport.tx + dx,
          ty: singlePan.startViewport.ty + dy,
        };
        viewportRef.current = nextViewport;
        setViewport(nextViewport);
        dispatchInteraction({
          type: 'POINTER_MOVE',
          viewport: nextViewport,
          pointerId: input.pointerId,
          point: input.point,
        });
        return;
      }

      if (!isDrawingEnabledRef.current) {
        clearStrokeState();
        return;
      }

      if (effectiveToolRef.current === 'polygon' || effectiveToolRef.current === 'bezier') {
        return;
      }

      const startEvent = pointerStartEvents.get(input.pointerId) ?? readPointerEvent(event);
      if (!isDrawingInput(startEvent, inputMethodsRef.current)) {
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

      const localPath = path.map((pathItem) => screenToCanvas(pathItem.point, viewportRef.current));

      // Line is click-to-place by default. Drag remains the shortcut, but only
      // after real movement: at least two path samples and >4 px total travel.
      if (
        effectiveToolRef.current === 'line' &&
        !currentActiveStroke &&
        (path.length < 2 || totalPathDistance(localPath) <= LINE_DRAG_THRESHOLD_PX)
      ) {
        return;
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
        const localPoint = localPath[index];
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

    const handleMultiStart = (input: GestureAdapterInput, center: DrawingPoint) => {
      if (singlePan) {
        dispatchInteraction({ type: 'POINTER_UP', pointerId: singlePan.pointerId });
        singlePan = null;
      }
      if (currentActiveStroke?.tool !== 'eraser') {
        commitCurrentActiveStroke();
      } else {
        clearStrokeState();
      }

      const firstPointerId = activePointers.keys().next().value as number | undefined;
      if (firstPointerId !== undefined) {
        releasePointerCapture(firstPointerId);
      }

      multiStartViewport = { ...viewportRef.current };
      multiStartCenter = { ...center };
      accumulatedCenterDelta = { x: 0, y: 0 };
      const pointerIds = Array.from(activePointers.keys()).slice(0, 2) as [number, number];
      dispatchInteraction({
        type: 'POINTER_DOWN',
        gesture: 'pinch',
        viewport: viewportRef.current,
        pointerIds,
        centroid: center,
        pointerId: input.pointerId,
      });
    };

    const handleMultiMove = (
      input: GestureAdapterInput,
      center: DrawingPoint | undefined,
      centerDelta: DrawingPoint | undefined,
      requestedScaleValue: number | undefined
    ) => {
      if (!multiStartViewport || !multiStartCenter) {
        multiStartViewport = { ...viewportRef.current };
        multiStartCenter = center ? { ...center } : { x: 0, y: 0 };
      }

      const startViewport = multiStartViewport;
      const startCenter = multiStartCenter;
      const bounds = resolveGestureScaleBounds(gestureScaleBoundsRef.current);
      const requestedScale = clampGestureScale(requestedScaleValue ?? startViewport.scale, bounds);
      const scaleOnly = zoomViewportAroundScreenPoint(startViewport, startCenter, requestedScale);
      const deltaStep = centerDelta ?? { x: 0, y: 0 };
      accumulatedCenterDelta = {
        x: accumulatedCenterDelta.x + deltaStep.x,
        y: accumulatedCenterDelta.y + deltaStep.y,
      };
      const delta = accumulatedCenterDelta;
      const gestureSet = gestureSetRef.current;
      const panEnabled = isTouchDoublePanEnabled(gestureSet);
      const pinchEnabled = isTouchDoubleZoomEnabled(gestureSet);
      let nextViewport: DrawingViewport = {
        scale: scaleOnly.scale,
        tx: scaleOnly.tx + delta.x,
        ty: scaleOnly.ty + delta.y,
      };

      if (!pinchEnabled) {
        nextViewport = {
          scale: startViewport.scale,
          tx: startViewport.tx + delta.x,
          ty: startViewport.ty + delta.y,
        };
      }
      if (!panEnabled) {
        nextViewport = {
          ...nextViewport,
          tx: nextViewport.tx - delta.x,
          ty: nextViewport.ty - delta.y,
        };
      }
      if (!panEnabled && !pinchEnabled) {
        nextViewport = startViewport;
      }

      viewportRef.current = nextViewport;
      setViewport(nextViewport);
      dispatchInteraction({
        type: 'POINTER_MOVE',
        viewport: nextViewport,
        centroid: center,
        pointerId: input.pointerId,
      });
    };

    const handleAdapterResult = (input: GestureAdapterInput, event: PointerEvent) => {
      const result = adapter.process(input);

      switch (result.kind) {
        case 'single-move':
          handleSingleMove(input, event, result.path ?? []);
          break;
        case 'single-end':
          if (singlePan?.pointerId === input.pointerId) {
            dispatchInteraction({ type: 'POINTER_UP', pointerId: input.pointerId });
            singlePan = null;
          } else {
            // Eraser on-release: flush queued hits as a single atomic batch
            // before the generic commit path. Other tools/modes no-op here.
            if (effectiveToolRef.current === 'eraser') {
              commitQueuedEraserHits();
              clearEraserTrajectoryRef.current();
            }
            commitCurrentActiveStroke();
            if (!isPlacementReducerTool(effectiveToolRef.current)) {
              dispatchInteraction({
                type: 'POINTER_UP',
                pointerId: input.pointerId,
                point: screenToCanvas(input.point, viewportRef.current),
              });
            }
          }
          multiStartViewport = null;
          multiStartCenter = null;
          accumulatedCenterDelta = { x: 0, y: 0 };
          if (result.activePointerCount === 0) {
            adapter.reset();
          }
          break;
        case 'multi-start':
          // Multi-finger interrupt: drop queued eraser hits before
          // transitioning to viewport gesture.
          eraserQueuedHitsRef.current.clear();
          clearEraserTrajectoryRef.current();
          handleMultiStart(input, result.center ?? input.point);
          break;
        case 'multi-move':
          handleMultiMove(input, result.center, result.centerDelta, result.requestedScale);
          break;
        case 'cancel':
          // pointercancel discards any uncommitted eraser hits.
          eraserQueuedHitsRef.current.clear();
          clearEraserTrajectoryRef.current();
          clearStrokeState();
          singlePan = null;
          multiStartViewport = null;
          multiStartCenter = null;
          accumulatedCenterDelta = { x: 0, y: 0 };
          dispatchInteraction(
            isPlacementReducerTool(effectiveToolRef.current)
              ? { type: 'POINTER_CANCEL', pointerId: input.pointerId }
              : { type: 'POINTER_UP', pointerId: input.pointerId }
          );
          break;
        case 'idle':
          break;
        default:
          break;
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== undefined && event.button !== 0) {
        return;
      }
      capturePointer(event);
      const input = toAdapterInput(event, 'start');
      const pointerEvent = readPointerEvent(event);
      pointerStartEvents.set(input.pointerId, pointerEvent);
      if (
        effectiveToolRef.current === 'eraser' &&
        isDrawingEnabledRef.current &&
        isDrawingInput(pointerEvent, inputMethodsRef.current)
      ) {
        eraserGestureStartCanvasPointRef.current = screenToCanvas(input.point, viewportRef.current);
      }
      updateActivePointers(input);
      if (activePointers.size === 2) {
        adapter.setScale(viewportRef.current.scale);
      }
      startSinglePan(input, event);
      handleAdapterResult(input, event);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const input = toAdapterInput(event, 'move');
      updateActivePointers(input);
      handleAdapterResult(input, event);
    };

    const handlePointerEnd = (event: PointerEvent) => {
      const input = toAdapterInput(event, 'end');
      updateActivePointers(input);
      releasePointerCapture(input.pointerId);
      handleAdapterResult(input, event);
      pointerStartEvents.delete(input.pointerId);
    };

    const handlePointerCancel = (event: PointerEvent) => {
      const input = toAdapterInput(event, 'cancel');
      updateActivePointers(input);
      releasePointerCapture(input.pointerId);
      handleAdapterResult(input, event);
      pointerStartEvents.delete(input.pointerId);
    };

    const handleKeyChange = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.key === ' ') {
        spacePressed = event.type === 'keydown';
        return;
      }
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
      spacePressed = false;
    };

    host.addEventListener('pointerdown', handlePointerDown);
    host.addEventListener('pointermove', handlePointerMove);
    host.addEventListener('pointerup', handlePointerEnd);
    host.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('keydown', handleKeyChange);
    window.addEventListener('keyup', handleKeyChange);
    window.addEventListener('blur', handleBlur);

    return () => {
      if (clearActiveStrokeRef.current === clearCurrentActiveStroke) {
        clearActiveStrokeRef.current = null;
      }
      host.removeEventListener('pointerdown', handlePointerDown);
      host.removeEventListener('pointermove', handlePointerMove);
      host.removeEventListener('pointerup', handlePointerEnd);
      host.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('keydown', handleKeyChange);
      window.removeEventListener('keyup', handleKeyChange);
      window.removeEventListener('blur', handleBlur);
      for (const pointerId of capturedPointerIds) {
        releasePointerCapture(pointerId);
      }
      activePointers.clear();
      pointerStartEvents.clear();
      eraserQueuedHitsRef.current.clear();
      clearEraserTrajectoryRef.current();
      adapter.reset();
    };
  }, [getLocalCoordinates, setActiveStroke]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || gestureReset !== true) {
      return undefined;
    }

    const resettableHost = host as HTMLDivElement & { resetViewport?: () => void };
    resettableHost.resetViewport = resetViewportToDefault;
    return () => {
      if (resettableHost.resetViewport === resetViewportToDefault) {
        delete resettableHost.resetViewport;
      }
    };
  }, [gestureReset, resetViewportToDefault]);

  useEffect(() => {
    const host = hostRef.current;
    const gestureSet = normalizedGestureSet;
    const hasWheelGesture =
      gestureSet?.has('MouseWheelZoom') === true ||
      gestureSet?.has('MouseWheelAndCtrlZoom') === true ||
      gestureSet?.has('MouseWheelPan') === true ||
      gestureSet?.has('MouseWheelAndCtrlPan') === true;
    if (!host || !gestureSet || !hasWheelGesture) {
      return undefined;
    }

    const handleWheel = (event: WheelEvent) => {
      const commandModifierPressed = hasCommandModifier(event);
      const shouldZoom = commandModifierPressed
        ? gestureSet.has('MouseWheelAndCtrlZoom') ||
          (!gestureSet.has('MouseWheelAndCtrlPan') && gestureSet.has('MouseWheelZoom'))
        : gestureSet.has('MouseWheelZoom');
      const shouldPan = commandModifierPressed
        ? !shouldZoom && gestureSet.has('MouseWheelAndCtrlPan')
        : !shouldZoom && gestureSet.has('MouseWheelPan');

      if (!shouldZoom && !shouldPan) {
        return;
      }

      event.preventDefault();
      const wheelDirection = gestureSet.has('NatureMouseWheel') ? -1 : 1;
      const deltaX = event.deltaX * wheelDirection;
      const deltaY = event.deltaY * wheelDirection;

      if (shouldPan) {
        const nextViewport = {
          scale: viewportRef.current.scale,
          // 鼠标滚轮/触摸板滚动语义：delta 为正代表视图向该方向滚动，
          // 因此画布内容需要向反方向平移；NatureMouseWheel 统一反转 delta。
          tx: viewportRef.current.tx - deltaX,
          ty: viewportRef.current.ty - deltaY,
        };
        viewportRef.current = nextViewport;
        setViewport(nextViewport);
        return;
      }

      const localPoint = getLocalCoordinates(event.clientX, event.clientY);
      const bounds = resolveGestureScaleBounds(gestureScaleBoundsRef.current);
      const zoomFactor = Math.exp(-deltaY * WHEEL_ZOOM_DELTA_SCALE);
      const nextScale = clampGestureScale(viewportRef.current.scale * zoomFactor, bounds);
      const nextViewport = zoomViewportAroundScreenPoint(
        viewportRef.current,
        localPoint,
        nextScale
      );
      viewportRef.current = nextViewport;
      setViewport(nextViewport);
    };

    host.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      host.removeEventListener('wheel', handleWheel);
    };
  }, [getLocalCoordinates, normalizedGestureSet]);

  // Tool switch: reset reducer state. Cancels any in-progress polygon placement
  // when user picks a different tool mid-draw (or vice versa).
  useEffect(() => {
    dispatchInteraction({ type: 'TOOL_CHANGE', tool: effectiveTool });
    // Switching tool discards any in-flight on-release eraser queue —
    // hits collected before the switch were never committed.
    if (effectiveTool !== 'eraser') {
      eraserQueuedHitsRef.current.clear();
      clearEraserTrajectoryRef.current();
    }
  }, [effectiveTool]);

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

    const toCanvasPoint = (clientX: number, clientY: number) => {
      return screenToCanvas(getLocalCoordinates(clientX, clientY), viewportRef.current);
    };

    let pendingLineClick: { point: DrawingPoint; pointerId?: number } | null = null;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== undefined && event.button !== 0) {
        return;
      }
      const point = toCanvasPoint(event.clientX, event.clientY);
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

    const handlePointerMove = (event: PointerEvent) => {
      const point = toCanvasPoint(event.clientX, event.clientY);
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
      if (effectiveTool === 'bezier') {
        dispatchInteraction({
          type: 'POINTER_UP',
          point: toCanvasPoint(event.clientX, event.clientY),
          pointerId: event.pointerId,
          detail: event.detail,
        });
        return;
      }
      if (effectiveTool !== 'line' || !pendingLineClick) {
        return;
      }
      const point = toCanvasPoint(event.clientX, event.clientY);
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
      pendingLineClick = null;
      // Forward as a POINTER_DOWN with detail=2 — the reducer recognises
      // that as the polygon/line finish signal.
      const point = toCanvasPoint(event.clientX, event.clientY);
      dispatchInteraction({
        type: 'POINTER_DOWN',
        point,
        detail: 2,
      });
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

    host.addEventListener('pointerdown', handlePointerDown);
    host.addEventListener('pointermove', handlePointerMove);
    host.addEventListener('pointerup', handlePointerUp);
    host.addEventListener('dblclick', handleDoubleClick);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleBlur);

    return () => {
      host.removeEventListener('pointerdown', handlePointerDown);
      host.removeEventListener('pointermove', handlePointerMove);
      host.removeEventListener('pointerup', handlePointerUp);
      host.removeEventListener('dblclick', handleDoubleClick);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleBlur);
    };
  }, [effectiveTool, getLocalCoordinates, isDrawingEnabled]);

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
      : 10;
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

    const normalizePointerType = (value: string | undefined): DrawingInputMethod => {
      if (value === 'touch' || value === 'pen' || value === 'mouse') {
        return value;
      }
      return 'mouse';
    };

    const computePositions = (clientX: number, clientY: number) => {
      const screen = getLocalCoordinates(clientX, clientY);
      const canvas = screenToCanvas(screen, viewportRef.current);
      return { screen, canvas };
    };

    const readPointer = (
      event: Event
    ): {
      clientX: number;
      clientY: number;
      pointerType: DrawingInputMethod;
    } => {
      const pointerLike = event as Event & {
        clientX?: number;
        clientY?: number;
        pointerType?: string;
      };
      return {
        clientX: pointerLike.clientX ?? 0,
        clientY: pointerLike.clientY ?? 0,
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
      const { clientX, clientY, pointerType } = readPointer(event);
      const { screen, canvas } = computePositions(clientX, clientY);
      const nextVisible =
        pointerType === 'touch'
          ? cursorPointerDownRef.current && activePointersRef.current.size < 2
          : true;
      setCursorState({ visible: nextVisible, screen, canvas, pointerType });
    };

    const handleLeave = () => {
      cursorPointerDownRef.current = false;
      setCursorState((prev) => ({ ...prev, visible: false }));
    };

    const handleDown = (event: Event) => {
      cursorPointerDownRef.current = true;
      const { clientX, clientY, pointerType } = readPointer(event);
      const { screen, canvas } = computePositions(clientX, clientY);
      setCursorState({
        visible: pointerType !== 'touch' || activePointersRef.current.size < 2,
        screen,
        canvas,
        pointerType,
      });
    };

    const handleUp = (event: Event) => {
      const pointer = readPointer(event);
      const pointerLike = event as Event & { pointerId?: number };
      const nextTouchPointer =
        pointer.pointerType === 'touch'
          ? Array.from(activePointersRef.current.entries()).find(
              ([pointerId]) => pointerId !== (pointerLike.pointerId ?? 1)
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

        setCursorState({
          visible: true,
          screen: nextTouchPointer,
          canvas: screenToCanvas(nextTouchPointer, viewportRef.current),
          pointerType: pointer.pointerType,
        });
      }
    };

    const handleWindowBlur = () => {
      cursorPointerDownRef.current = false;
      setCursorState((prev) => ({ ...prev, visible: false }));
    };

    host.addEventListener('pointerenter', handleEnter);
    host.addEventListener('pointermove', handleMove);
    host.addEventListener('pointerleave', handleLeave);
    host.addEventListener('pointerdown', handleDown);
    host.addEventListener('pointerup', handleUp);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      host.removeEventListener('pointerenter', handleEnter);
      host.removeEventListener('pointermove', handleMove);
      host.removeEventListener('pointerleave', handleLeave);
      host.removeEventListener('pointerdown', handleDown);
      host.removeEventListener('pointerup', handleUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [cursorEnabled, getLocalCoordinates]);

  const cursorRenderState: DrawingCursorRenderState = {
    screen: cursorState.screen,
    canvas: cursorState.canvas,
    pointerType: cursorState.pointerType,
    activeTool: effectiveTool,
    visible: cursorState.visible,
    eraserRadius: effectiveTool === 'eraser' ? resolvedOpenWidth / 2 : undefined,
  };

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
      }}
    >
      <svg
        data-pressure-multiplier={String(resolvedPressureMultiplier)}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
        }}
      >
        <title>Drawing surface</title>
        <g transform={`translate(${viewport.tx} ${viewport.ty}) scale(${viewport.scale})`}>
          {strokes.map((stroke) => (
            <StrokeRenderer
              key={stroke.id}
              stroke={stroke}
              fallbackColor={resolvedColor}
              fallbackWidth={resolvedOpenWidth}
              fallbackClosedWidth={resolvedClosedWidth}
              fallbackDashArray={resolvedDashArray}
              fallbackDashOffset={resolvedDashOffset}
              fallbackFillColor={fillColor}
              fallbackFillOpacity={resolvedFillOpacity}
              pressureMultiplier={resolvedPressureMultiplier}
            />
          ))}

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
        </g>
      </svg>
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
              </svg>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
