import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { DragOperationType, Mixin, MixinType, type Pose } from '@system-ui-js/multi-drag';
import { useCanvas } from '../hooks/useCanvas';
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
  computeSelectionBox,
  type RenderedStrokeHitTestOptions,
  SELECTION_BOX_PADDING,
  selectStrokesIntersectingLasso,
} from '../utils';
import { isInsideRuler, projectOntoRuler, type RulerTransform } from '../ruler/geometry';
import { generateTicks } from '../ruler/ticks';
import {
  type DrawingViewport,
  canvasToScreen,
  resetViewport as createResetViewport,
  screenToCanvas,
} from '../viewport';

// Public drawing contract types
export type DrawingTool =
  | 'pen'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'polygon'
  | 'bezier'
  | 'eraser'
  | 'lasso';
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

/**
 * 套索选择变化回调。当用户通过 lasso 工具完成一次选择操作时触发，
 * 参数为当前选中的 stroke id 数组。
 */
export type DrawingSelectionChange = (selectedStrokeIds: string[]) => void;

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
}

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

/**
 * Ruler 状态 — 描述 ruler 在画布中的位置、朝向和尺寸。
 * 字段与 `RulerTransform`（ruler/geometry.ts）完全对齐，
 * 供受控 / 非受控模式共用。
 */
export type DrawingRulerState = RulerTransform;

/**
 * Ruler overlay 配置项。
 *
 * - `ruler={false}` 或 `ruler` 省略 → 不显示 ruler
 * - `ruler={{}}` 或 `ruler={{ enabled: true }}` → 启用 ruler，使用默认参数
 * - 受控模式：传入 `state` + `onRulerChange`
 * - 非受控模式：传入 `defaultState`（或都不传，使用内置默认值）
 */
export type DrawingRulerOptions = {
  /** 是否启用 ruler。省略时默认 true（只要 `ruler` 对象存在即启用）。 */
  readonly enabled?: boolean;
  /** 受控的 ruler 变换状态。 */
  readonly state?: DrawingRulerState;
  /** 非受控模式下的初始 ruler 变换状态。 */
  readonly defaultState?: DrawingRulerState;
  /** Ruler 长度（画布坐标）。默认 `400`。 */
  readonly length?: number;
  /** Ruler 高度（画布坐标）。默认 `48`。 */
  readonly height?: number;
  /** Ruler 背景色。默认 `'#e0e0e0'`。 */
  readonly backgroundColor?: string;
  /** Ruler 背景不透明度。默认 `0.2`。 */
  readonly backgroundOpacity?: number;
  /** 次刻度间距（画布坐标）。默认 `10`。 */
  readonly minorTickSpacing?: number;
  /** 每隔 N 个次刻度绘制一个主刻度。默认 `5`。 */
  readonly majorTickEvery?: number;
  /** 拖拽手柄尺寸（画布坐标）。默认 `24`。 */
  readonly dragGripSize?: number;
  /** Test identifier 前缀，用于自动化测试。 */
  readonly testID?: string;
};

type CursorPointer = { x: number; y: number };

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
   * Pressure multiplier applied at render time. Default `1`. Invalid values
   * (NaN, Infinity, non-finite, <=0, non-number) resolve to `1`. Does NOT
   * mutate stored `point.pressure`; only scales rendered width.
   */
  pressureMultiplier?: number;
  /** Test identifier. */
  testID?: string;

  /** 受控的选中 stroke id 列表。配合 onSelectionChange 实现受控选择模式。 */
  selectedStrokeIds?: readonly string[];
  /** 非受控模式下的初始选中 stroke id 列表。 */
  defaultSelectedStrokeIds?: readonly string[];
  /** 选择变化回调，当套索选择操作完成时触发。 */
  onSelectionChange?: DrawingSelectionChange;
  /**
   * Ruler overlay 配置。省略或 `false` → 不显示 ruler。
   * 传入 options 对象 → 启用 ruler，可用 `enabled` 字段精细控制。
   */
  ruler?: false | DrawingRulerOptions;
  /** Ruler 状态变化回调（受控模式）。当 ruler 位置/旋转/尺寸变化时触发。 */
  onRulerChange?: (next: DrawingRulerState) => void;
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
    points: stroke.points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy })),
    dashArray: stroke.dashArray ? [...stroke.dashArray] : undefined,
  };
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

export const DrawingSurface = forwardRef<DrawingSurfaceHandle, DrawingSurfaceProps>(
  function DrawingSurface(props, ref) {
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
      pressureMultiplier,
      eraserCommitMode,
      eraserTrajectory,
      testID,
      selectedStrokeIds,
      defaultSelectedStrokeIds,
      onSelectionChange,
      ruler,
    } = props;
    const hostRef = useRef<HTMLDivElement>(null);
    const multiDragRef = useRef<InstanceType<typeof Mixin> | null>(null);
    const [viewport] = useState<DrawingViewport>(() => createResetViewport());
    const viewportRef = useRef<DrawingViewport>(viewport);
    viewportRef.current = viewport;

    const internalRulerStateRef = useRef<DrawingRulerState | null>(null);
    const [rulerInitTick, setRulerInitTick] = useState(0);
    const [, setRulerGestureTick] = useState(0);
    // 尺子手势是否激活 —— 当 Mixin 检测到手势开始时置为 true，全部结束时置为 false。
    // 绘制系统的 handlePointerDown 通过此 ref 判断是否需要阻止绘制，
    // 防止双指触摸尺子时第二指落在画布上误绘（触摸双指与绘制冲突）。
    const rulerGestureActiveRef = useRef(false);

    const isRulerEnabled = ruler !== false && ruler !== undefined && (ruler.enabled ?? true);
    const effectiveRulerOptions = typeof ruler === 'object' ? ruler : {};
    
    let currentRulerState: DrawingRulerState | null = null;
    
    if (isRulerEnabled) {
      if (effectiveRulerOptions.state) {
        currentRulerState = effectiveRulerOptions.state;
      } else {
        if (!internalRulerStateRef.current) {
          const defaultState = effectiveRulerOptions.defaultState ?? {
            center: { x: 0, y: 0 },
            rotationRad: 0,
            length: effectiveRulerOptions.length ?? 400,
            height: effectiveRulerOptions.height ?? 48,
          };
          
          internalRulerStateRef.current = defaultState;
        }
        currentRulerState = internalRulerStateRef.current;
      }
    }

    const hasInitializedRulerCenter = useRef(false);

    useLayoutEffect(() => {
      if (!isRulerEnabled || !currentRulerState || effectiveRulerOptions.state || hasInitializedRulerCenter.current) {
        return;
      }
      
      if (currentRulerState.center.x === 0 && currentRulerState.center.y === 0 && hostRef.current) {
        hasInitializedRulerCenter.current = true;
        
        const hostWidth = hostRef.current.clientWidth;
        const hostHeight = hostRef.current.clientHeight;
        const screenCenter = { x: hostWidth / 2, y: hostHeight / 2 };
        const canvasCenter = screenToCanvas(screenCenter, viewportRef.current);
        
        internalRulerStateRef.current = {
          ...currentRulerState,
          center: canvasCenter,
        };

        setRulerInitTick((t) => t + 1);
      }
    }, [isRulerEnabled, currentRulerState, effectiveRulerOptions.state]);

    useEffect(() => {
      if (rulerInitTick > 0 && props.onRulerChange && internalRulerStateRef.current) {
        props.onRulerChange(internalRulerStateRef.current);
      }
    }, [rulerInitTick, props.onRulerChange]);

    useEffect(() => {
      const destroyExistingMixin = () => {
        multiDragRef.current?.destroy();
        multiDragRef.current = null;
      };

      if (!isRulerEnabled || !currentRulerState || !hostRef.current) {
        destroyExistingMixin();
        return;
      }

      destroyExistingMixin();

      const host = hostRef.current;
      let gestureRegion: 'grip' | 'body' | 'rotate' | null = null;
      const gestureStartState = currentRulerState;

      const getPose = (): Pose => ({
        position: canvasToScreen(gestureStartState.center, viewportRef.current),
        rotation: gestureStartState.rotationRad,
        width: gestureStartState.length,
        height: gestureStartState.height,
      });

      const normalizeRotationDelta = (delta: number) => {
        if (delta > Math.PI) {
          return delta - Math.PI * 2;
        }
        if (delta < -Math.PI) {
          return delta + Math.PI * 2;
        }
        return delta;
      };

      const resolveBodyRotation = () => {
        const fingers = multiDragRef.current?.getFingers() ?? [];
        const firstFinger = fingers[0];
        const secondFinger = fingers[1];
        const firstStart = firstFinger?.getPath()[0]?.point;
        const secondStart = secondFinger?.getPath()[0]?.point;
        const firstCurrent = firstFinger?.getLastOperation()?.point;
        const secondCurrent = secondFinger?.getLastOperation()?.point;

        if (!firstStart || !secondStart || !firstCurrent || !secondCurrent) {
          return null;
        }

        const center = canvasToScreen(gestureStartState.center, viewportRef.current);
        const angleFromCenter = (point: { readonly x: number; readonly y: number }) =>
          Math.atan2(point.y - center.y, point.x - center.x);
        const firstDelta = normalizeRotationDelta(
          angleFromCenter(firstCurrent) - angleFromCenter(firstStart)
        );
        const secondDelta = normalizeRotationDelta(
          angleFromCenter(secondCurrent) - angleFromCenter(secondStart)
        );

        return gestureStartState.rotationRad + (firstDelta + secondDelta) / 2;
      };

      // 鼠标 alt+拖拽单指旋转：计算鼠标围绕尺子中心的角度变化
      const resolveMouseRotation = () => {
        const fingers = multiDragRef.current?.getFingers() ?? [];
        const firstFinger = fingers[0];
        const firstStart = firstFinger?.getPath()[0]?.point;
        const firstCurrent = firstFinger?.getLastOperation()?.point;

        if (!firstStart || !firstCurrent) {
          return null;
        }

        const center = canvasToScreen(gestureStartState.center, viewportRef.current);
        const angleFromCenter = (point: { readonly x: number; readonly y: number }) =>
          Math.atan2(point.y - center.y, point.x - center.x);
        const delta = normalizeRotationDelta(
          angleFromCenter(firstCurrent) - angleFromCenter(firstStart)
        );

        return gestureStartState.rotationRad + delta;
      };

      const commitRulerState = (pose: Partial<Pose>, shouldRender: boolean) => {
        let nextState: DrawingRulerState | null = null;

        if (gestureRegion === 'grip' && pose.position) {
          nextState = {
            ...gestureStartState,
            center: screenToCanvas(pose.position, viewportRef.current),
          };
        }

if (gestureRegion === 'body') {
        const rotationRad = resolveBodyRotation();
        if (rotationRad === null) {
          return;
        }
        nextState = {
          ...gestureStartState,
          center: pose.position
            ? screenToCanvas(pose.position, viewportRef.current)
            : gestureStartState.center,
          rotationRad,
        };
      }

      if (gestureRegion === 'rotate') {
        const rotationRad = resolveMouseRotation();
        if (rotationRad === null) {
          return;
        }
        nextState = {
          ...gestureStartState,
          rotationRad,
        };
      }

        if (!nextState) {
          return;
        }

        internalRulerStateRef.current = nextState;
        if (shouldRender) {
          setRulerGestureTick((tick) => tick + 1);
        }
        props.onRulerChange?.(nextState);
      };

      const multiDrag = new Mixin(
        host,
        {
          inertial: false,
          getPose,
          setPose: (_element, pose) => {
            commitRulerState(pose, false);
          },
          setPoseOnEnd: (_element, pose) => {
            commitRulerState(pose, true);
          },
        },
        [MixinType.Drag, MixinType.Rotate],
        [MixinType.Drag]
      );

      const handleStart = () => {
        const [finger] = multiDrag.getFingers();
        const event = finger?.getLastOperation()?.event;
        const target = event?.target;

        if (!(target instanceof Element)) {
          gestureRegion = null;
          rulerGestureActiveRef.current = false;
          return;
        }

        // 鼠标修饰键：ctrl/cmd → 移动尺子, alt → 旋转尺子（需鼠标在尺子上）
        if (event?.pointerType === 'mouse' && (event.ctrlKey || event.metaKey || event.altKey)) {
          if (target.closest('[data-testid="drawing-ruler"]')) {
            gestureRegion = event.altKey ? 'rotate' : 'grip';
            rulerGestureActiveRef.current = true;
            return;
          }
        }

        if (target.closest('[data-testid="drawing-ruler-drag-grip"]')) {
          gestureRegion = 'grip';
          rulerGestureActiveRef.current = true;
          return;
        }

        if (target.closest('[data-testid="drawing-ruler"]')) {
          gestureRegion = 'body';
          rulerGestureActiveRef.current = true;
          return;
        }

        gestureRegion = null;
        rulerGestureActiveRef.current = false;
      };

      const handleMove = () => {
        if (gestureRegion === 'grip' && multiDrag.getFingers().length !== 1) {
          gestureRegion = null;
          return;
        }

        if (gestureRegion === 'rotate' && multiDrag.getFingers().length !== 1) {
          gestureRegion = null;
          return;
        }

        if (gestureRegion === 'body' && multiDrag.getFingers().length < 2) {
          return;
        }
      };

      const handleAllEnd = () => {
        gestureRegion = null;
        rulerGestureActiveRef.current = false;
        multiDrag.setEnabled();
      };

      multiDrag.addEventListener(DragOperationType.Start, handleStart);
      multiDrag.addEventListener(DragOperationType.Move, handleMove);
      multiDrag.addEventListener(DragOperationType.AllEnd, handleAllEnd);
      multiDragRef.current = multiDrag;

      return () => {
        multiDrag.removeEventListener(DragOperationType.Start, handleStart);
        multiDrag.removeEventListener(DragOperationType.Move, handleMove);
        multiDrag.removeEventListener(DragOperationType.AllEnd, handleAllEnd);
        if (multiDragRef.current === multiDrag) {
          multiDragRef.current = null;
        }
        multiDrag.destroy();
      };
    }, [isRulerEnabled, currentRulerState, props.onRulerChange]);

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
    const selectionBox = useMemo(
      () => computeSelectionBox(strokes, selectedIds),
      [strokes, selectedIds]
    );
    const selectedIdsRef = useRef<readonly string[]>(selectedIds);
    const selectionBoxRef = useRef(selectionBox);
    const onSelectionChangeRef = useRef(onSelectionChange);
    const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

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
        if (!isSelectionControlled) {
          setInternalSelectedIds(next);
        }
        onSelectionChangeRef.current?.(next);
      },
      [isSelectionControlled]
    );

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
    const previousValueRef = useRef(value);
    const addStrokeRef = useRef(addStroke);
    const removeStrokeRef = useRef(removeStroke);
    const removeStrokesRef = useRef(removeStrokesFromCanvas);
    const updateStrokesRef = useRef(updateStrokesInCanvas);
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

    const [lassoPreviewPoints, setLassoPreviewPoints] = useState<DrawingPoint[]>([]);
    const [lassoMode, setLassoMode] = useState<'idle' | 'drawing' | 'moving'>('idle');
    // 套索临时点始终存 canvas 坐标；state 只负责预览，ref 负责 pointer 管线同步读取。
    const lassoPointsRef = useRef<DrawingPoint[]>([]);
    const selectionMoveRef = useRef<{
      pointerId: number;
      startCanvasPoint: DrawingPoint;
      originals: DrawingStroke[];
    } | null>(null);
    const lassoModeRef = useRef<'idle' | 'drawing' | 'moving'>(lassoMode);

    const clearLassoInteraction = useCallback(() => {
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
        if (host?.contains(event.target as Node)) {
          return;
        }
        // 点击外部交互控件（如工具栏按钮）时不应取消套索选择，否则依赖选中的按钮（如删除）会失效。
        const target = event.target;
        if (
          target instanceof Element &&
          target.closest(
            'button, input, textarea, select, a[href], [role="button"], [role="link"], [contenteditable="true"], [data-interactive]'
          )
        ) {
          return;
        }
        if (lassoModeRef.current !== 'idle' || selectionMoveRef.current !== null) {
          return;
        }
        commitSelection([]);
      },
      [commitSelection]
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
    addStrokeRef.current = addStroke;
    removeStrokeRef.current = removeStroke;
    removeStrokesRef.current = removeStrokesFromCanvas;
    updateStrokesRef.current = updateStrokesInCanvas;
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
    lassoModeRef.current = lassoMode;

    useEffect(() => {
      const existingStrokeIds = new Set(strokes.map((stroke) => stroke.id));
      const prunedIds = selectedIdsRef.current.filter((id) => existingStrokeIds.has(id));
      commitSelection(prunedIds);
    }, [commitSelection, strokes]);

    useEffect(() => {
      if (effectiveTool !== 'lasso' || selectedIds.length === 0) {
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
      }),
      [commitSelection, removeStrokesFromCanvas]
    );

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

    const getProjectedCanvasPoint = useCallback(
      (canvasPoint: DrawingPoint): DrawingPoint => {
        if (!currentRulerState || !isInsideRuler(canvasPoint, currentRulerState)) {
          return canvasPoint;
        }
        const projected = projectOntoRuler(canvasPoint, currentRulerState);
        return projected ? { ...canvasPoint, x: projected.x, y: projected.y } : canvasPoint;
      },
      [currentRulerState]
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
        const isInsideSelectionBox =
          currentSelectionBox !== null &&
          canvasPoint.x >= currentSelectionBox.minX &&
          canvasPoint.x <= currentSelectionBox.maxX &&
          canvasPoint.y >= currentSelectionBox.minY &&
          canvasPoint.y <= currentSelectionBox.maxY;
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
          selectionMoveRef.current = {
            pointerId: input.pointerId,
            startCanvasPoint: canvasPoint,
            originals,
          };
          lassoPointsRef.current = [];
          lassoModeRef.current = 'moving';
          setLassoMode('moving');
          setLassoPreviewPoints((prev) => (prev.length === 0 ? prev : []));
        } else {
          selectionMoveRef.current = null;
          lassoPointsRef.current = [canvasPoint];
          lassoModeRef.current = 'drawing';
          setLassoMode('drawing');
          setLassoPreviewPoints([canvasPoint]);
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

      const handleSingleMove = (
        input: PointerSample,
        _event: PointerEvent,
        path: PointerSample[]
      ) => {
        if (!isDrawingEnabledRef.current) {
          clearStrokeState();
          return;
        }

        if (effectiveToolRef.current === 'polygon' || effectiveToolRef.current === 'bezier') {
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
            processedPathLengthRef.current = path.length;
            return;
          }

          return;
        }

        // 橡皮和套索在上面的分支中故意跳过投影：它们做的是命中测试/选区，必须使用原始指针位置。
        const localPath = path.map((pathItem) =>
          getProjectedCanvasPoint(screenToCanvas(pathItem.point, viewportRef.current))
        );

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

      const finishPointerInteraction = (input: PointerSample) => {
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
            point: getProjectedCanvasPoint(screenToCanvas(input.point, viewportRef.current)),
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

      const handlePointerDown = (event: PointerEvent) => {
        if (event.button !== undefined && event.button !== 0) {
          return;
        }
        // 尺子手势激活时阻止非 pen 指针绘制（防止双指触摸尺子时第二指在画布上误绘）
        if (rulerGestureActiveRef.current && event.pointerType !== 'pen') {
          return;
        }
        if (event.target instanceof Element) {
          if (event.target.closest('[data-testid="drawing-ruler-drag-grip"]')) {
            return;
          }
          if (event.pointerType !== 'pen' && event.target.closest('[data-testid="drawing-ruler"]')) {
            return;
          }
        }
        capturePointer(event);
        const input = toPointerSample(event);
        const pointerEvent = readPointerEvent(event);
        if (
          !isDrawingInput(pointerEvent, inputMethodsRef.current) ||
          !isDrawingEnabledRef.current
        ) {
          return;
        }
        // 多指按下时清空 on-release 橡皮队列，避免多指误触把之前的待提交删除一起提交。
        if (activeDrawingPointerIds.size > 0 && eraserCommitModeRef.current === 'on-release') {
          eraserQueuedHitsRef.current.clear();
        }
        activeDrawingPointerIds.add(input.pointerId);
        pointerPaths.set(input.pointerId, [input]);
        if (
          effectiveToolRef.current === 'eraser' &&
          isDrawingInput(pointerEvent, inputMethodsRef.current)
        ) {
          eraserGestureStartCanvasPointRef.current = screenToCanvas(
            input.point,
            viewportRef.current
          );
        }
        startLassoInteraction(input, event);
      };

      const handlePointerMove = (event: PointerEvent) => {
        const input = toPointerSample(event);
        const path = pointerPaths.get(input.pointerId);
        if (!path) {
          return;
        }
        path.push(input);
        handleSingleMove(input, event, path);
      };

      const handlePointerEnd = (event: PointerEvent) => {
        const input = toPointerSample(event);
        releasePointerCapture(input.pointerId);
        if (activeDrawingPointerIds.has(input.pointerId)) {
          finishPointerInteraction(input);
        }
        activeDrawingPointerIds.delete(input.pointerId);
        pointerPaths.delete(input.pointerId);
      };

      const handlePointerCancel = (event: PointerEvent) => {
        const input = toPointerSample(event);
        releasePointerCapture(input.pointerId);
        if (activeDrawingPointerIds.has(input.pointerId)) {
          cancelPointerInteraction(input);
        }
        activeDrawingPointerIds.delete(input.pointerId);
        pointerPaths.delete(input.pointerId);
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

      host.addEventListener('pointerdown', handlePointerDown);
      // pointerdown 必须从 host 开始；后续 move/end 绑到 document，保证指针离开
      // surface 或运行环境不支持 pointer capture 时仍能结束手势并提交/清理状态。
      document.addEventListener('pointermove', handlePointerMove);
      document.addEventListener('pointerup', handlePointerEnd);
      document.addEventListener('pointercancel', handlePointerCancel);
      window.addEventListener('keydown', handleKeyChange);
      window.addEventListener('keyup', handleKeyChange);
      window.addEventListener('blur', handleBlur);

      return () => {
        if (clearActiveStrokeRef.current === clearCurrentActiveStroke) {
          clearActiveStrokeRef.current = null;
        }
        host.removeEventListener('pointerdown', handlePointerDown);
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
        eraserQueuedHits.clear();
        clearEraserTrajectoryRef.current();
        clearLassoInteractionRef.current();
      };
    }, [commitSelection, getLocalCoordinates, getProjectedCanvasPoint, setActiveStroke]);

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
        previousTool === 'lasso' &&
        effectiveTool !== 'lasso' &&
        selectedIdsRef.current.length > 0
      ) {
        commitSelection([]);
      }
      clearLassoInteractionRef.current();
      previousToolForCleanupRef.current = effectiveTool;
    }, [commitSelection, effectiveTool]);

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
        return getProjectedCanvasPoint(
          screenToCanvas(getLocalCoordinates(clientX, clientY), viewportRef.current)
        );
      };

      let pendingLineClick: { point: DrawingPoint; pointerId?: number } | null = null;

      const handlePointerDown = (event: PointerEvent) => {
        if (event.button !== undefined && event.button !== 0) {
          return;
        }
        if (rulerGestureActiveRef.current && event.pointerType !== 'pen') {
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
      // Placement drags (line/bezier) must survive leaving the host between
      // pointerdown and pointerup; document listeners preserve that lifecycle.
      document.addEventListener('pointermove', handlePointerMove);
      document.addEventListener('pointerup', handlePointerUp);
      host.addEventListener('dblclick', handleDoubleClick);
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('blur', handleBlur);

      return () => {
        host.removeEventListener('pointerdown', handlePointerDown);
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', handlePointerUp);
        host.removeEventListener('dblclick', handleDoubleClick);
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('blur', handleBlur);
      };
    }, [effectiveTool, getLocalCoordinates, getProjectedCanvasPoint, isDrawingEnabled]);

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

      const normalizePointerType = (value: string | undefined): DrawingInputMethod => {
        if (value === 'touch' || value === 'pen' || value === 'mouse') {
          return value;
        }
        return 'mouse';
      };

      const computePositions = (clientX: number, clientY: number) => {
        const rawScreen = getLocalCoordinates(clientX, clientY);
        const canvas = getProjectedCanvasPoint(screenToCanvas(rawScreen, viewportRef.current));
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
        cursorPointerDownRef.current = true;
        const { clientX, clientY, pointerId, pointerType } = readPointer(event);
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

          const canvas = getProjectedCanvasPoint(screenToCanvas(nextTouchPointer, viewportRef.current));
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
    }, [cursorEnabled, getLocalCoordinates, getProjectedCanvasPoint]);

    const cursorStrokeRadius = (resolvedOpenWidth * viewport.scale) / 2;
    const crosshairCircleRadius = Math.min(
      Math.max(cursorStrokeRadius, 1),
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
                    points={eraserTrajectoryPoints
                      .map((point) => `${point.x},${point.y}`)
                      .join(' ')}
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
                strokeWidth={2}
                strokeDasharray="4 4"
                pointerEvents="none"
              />
            )}
            {effectiveTool === 'lasso' && selectedIds.length > 0 && selectionBox != null && (
              <rect
                data-testid="lasso-selection-box"
                x={selectionBox.minX}
                y={selectionBox.minY}
                width={selectionBox.maxX - selectionBox.minX}
                height={selectionBox.maxY - selectionBox.minY}
                fill="rgba(59,130,246,0.2)"
                stroke="rgb(59,130,246)"
                strokeWidth={3}
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
                data-padding={SELECTION_BOX_PADDING}
              />
            )}
            
            {isRulerEnabled && currentRulerState && (
              <g
                data-testid="drawing-ruler"
                data-ruler-center-x={String(currentRulerState.center.x)}
                data-ruler-center-y={String(currentRulerState.center.y)}
                data-ruler-rotation={String(currentRulerState.rotationRad)}
                data-ruler-length={String(currentRulerState.length)}
                data-ruler-height={String(currentRulerState.height)}
                transform={`translate(${currentRulerState.center.x} ${currentRulerState.center.y}) rotate(${(currentRulerState.rotationRad * 180) / Math.PI})`}
              >
                <rect
                  data-testid="drawing-ruler-background"
                  x={-currentRulerState.length / 2}
                  y={-currentRulerState.height / 2}
                  width={currentRulerState.length}
                  height={currentRulerState.height}
                  fill={effectiveRulerOptions.backgroundColor ?? '#e0e0e0'}
                  fillOpacity={String(effectiveRulerOptions.backgroundOpacity ?? 0.2)}
                />
                <circle
                  data-testid="drawing-ruler-drag-grip"
                  cx={0}
                  cy={0}
                  r={effectiveRulerOptions.dragGripSize ?? 24}
                  fill="white"
                  stroke="grey"
                  strokeWidth={2}
                />
                <g className="ruler-ticks">
                  {generateTicks(currentRulerState, {
                    minorSpacing: effectiveRulerOptions.minorTickSpacing ?? 10,
                    majorSpacing: (effectiveRulerOptions.minorTickSpacing ?? 10) * (effectiveRulerOptions.majorTickEvery ?? 5),
                  }).map((tick) => {
                    const isCenter = tick.localX === 0;
                    return (
                      <g key={tick.localX.toFixed(6)} transform={`translate(${tick.localX} ${-currentRulerState.height / 2})`}>
                        <line
                          data-testid={isCenter ? 'drawing-ruler-center-tick' : 'drawing-ruler-tick'}
                          x1={0}
                          y1={0}
                          x2={0}
                          y2={tick.kind === 'major' ? 20 : 10}
                          stroke="black"
                          strokeWidth={1}
                        />
                        {tick.label && (
                          <text
                            x={0}
                            y={35}
                            fontSize={12}
                            textAnchor="middle"
                            fill="black"
                          >
                            {tick.label}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </g>
              </g>
            )}
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
                  <circle
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
      </div>
    );
  }
);
