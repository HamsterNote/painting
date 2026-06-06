/// <reference path="../multi-drag.d.ts" />

import { Drag, DragOperationType } from "@system-ui-js/multi-drag";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { useCanvas } from "../hooks/useCanvas";
import { createPointerInputController } from "../input/pointerInputController";
import {
	type CanvasPoint,
	createInitialState,
	interactionReducer,
} from "../interaction/reducer";
import {
	type BezierStrokeV2,
	DRAWING_STROKE_SCHEMA_VERSION,
	type LineStrokeV2,
	type PolygonStrokeV2,
} from "../model/strokes";
import {
	appendPoint,
	createStroke,
	createVelocityAdaptivePoints,
	type DrawingStrokeSmoothingOptions,
	isValidStroke,
	resolveStrokeSmoothingOptions,
	type TimedDrawingPoint,
} from "../stroke-helpers";
import { StrokeRenderer } from "../render/StrokeRenderer";
import { pick as pickStroke } from "../utils";

// Public drawing contract types
export type DrawingTool =
	| "pen"
	| "line"
	| "rect"
	| "ellipse"
	| "polygon"
	| "bezier"
	| "eraser";
export type DrawingInputMethod = "touch" | "mouse" | "pen";

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
	"strokeColor" | "strokeWidth" | "dashArray" | "dashOffset" | "fillColor" | "fillOpacity"
>;

export type DrawingValue = {
	strokes: DrawingStroke[];
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
	/** Test identifier. */
	testID?: string;
};

type DragInputEvent = {
	pointerType?: string;
	button?: number;
	clientX?: number;
	clientY?: number;
	timeStamp?: number;
};

type DragPathItem = {
	point: DrawingPoint;
	event?: DragInputEvent;
	timestamp?: number;
	pressure?: number;
};

type DragFinger = {
	getPath: () => DragPathItem[];
};

function isDrawingToolSupported(tool: unknown): tool is DrawingTool {
	return (
		tool === "pen" ||
		tool === "line" ||
		tool === "rect" ||
		tool === "ellipse" ||
		tool === "polygon" ||
		tool === "bezier" ||
		tool === "eraser"
	);
}

// Tools that use click-to-place interaction rather than drag. Their pointer
// events are routed through `interactionReducer` instead of multi-drag.
// `line` is hybrid: click placement AND legacy drag both work, so it appears
// here (to install click listeners) but NOT in `skipsMultiDragMove` below.
function isClickToPlaceTool(tool: DrawingTool): boolean {
	return tool === "polygon" || tool === "line" || tool === "bezier";
}

// Tools whose multi-drag Move handler should early-return — pure click tools
// where every drag sample would be misinterpreted as a zero-distance stroke.
// `line` is excluded: its multi-drag Move path still creates a drag-line once
// the user moves beyond `LINE_DRAG_THRESHOLD_PX`.
function skipsMultiDragMove(tool: DrawingTool): boolean {
	return tool === "polygon" || tool === "bezier";
}

function isClosedShapeTool(tool: DrawingTool): boolean {
	return tool === "rect" || tool === "ellipse" || tool === "polygon";
}

// Shift constraint only applies to bbox-defined shapes (rect/ellipse).
// Polygon is closed but defined by vertex list, not bbox; shift has no meaning there.
function isBboxShapeTool(tool: DrawingTool): boolean {
	return tool === "rect" || tool === "ellipse";
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

const DEFAULT_INPUT_METHODS: DrawingInputMethod[] = ["touch", "mouse", "pen"];
const LINE_DRAG_THRESHOLD_PX = 4;

function generateStrokeId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function verticesEndWith(
	vertices: { x: number; y: number }[],
	point: { x: number; y: number },
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
	event: DragInputEvent | undefined,
	allowedMethods: DrawingInputMethod[],
): boolean {
	if (!event) {
		return false;
	}

	if (event.pointerType === "pen") {
		return allowedMethods.includes("pen");
	}

	if (event.pointerType === undefined || event.pointerType === "touch") {
		return allowedMethods.includes("touch");
	}

	if (event.pointerType === "mouse") {
		return allowedMethods.includes("mouse") && event.button === 0;
	}

	return false;
}

function normalizePointPressure(pressure: number | undefined): number {
	if (pressure === 0) {
		return 0;
	}

	return typeof pressure === "number" &&
		Number.isFinite(pressure) &&
		pressure >= 0 &&
		pressure <= 1
		? pressure
		: 1;
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
		testID,
	} = props;
	const hostRef = useRef<HTMLDivElement>(null);

	const effectiveTool: DrawingTool = isDrawingToolSupported(tool)
		? tool
		: "pen";
	const isDrawingEnabled = tool === undefined || isDrawingToolSupported(tool);

	const resolvedColor =
		strokeColor && strokeColor.trim() !== "" ? strokeColor : "black";
	const resolvedOpenWidth =
		typeof strokeWidth === "number" &&
		Number.isFinite(strokeWidth) &&
		strokeWidth >= 1
			? strokeWidth
			: 2;
	const resolvedClosedWidth =
		typeof strokeWidth === "number" &&
		Number.isFinite(strokeWidth) &&
		strokeWidth >= 0
			? strokeWidth
			: 1;
	const resolvedDashArray = dashArray ? [...dashArray] : undefined;
	const resolvedDashOffset =
		typeof dashOffset === "number" && Number.isFinite(dashOffset)
			? dashOffset
			: undefined;
	const resolvedFillOpacity =
		typeof fillOpacity === "number" && Number.isFinite(fillOpacity)
			? fillOpacity
			: undefined;

	const resolvedSamplingRate =
		typeof samplingRate === "number" &&
		Number.isFinite(samplingRate) &&
		samplingRate > 0
			? samplingRate
			: 0;

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
		createInitialState,
	);
	const isDrawingRef = useRef(false);
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
	const resolvedDashArrayRef = useRef(resolvedDashArray);
	const resolvedDashOffsetRef = useRef(resolvedDashOffset);
	const resolvedFillColorRef = useRef(fillColor);
	const resolvedFillOpacityRef = useRef(resolvedFillOpacity);
	const strokesRef = useRef(strokes);
	const pressureRef = useRef(pressure);
	const inputMethodsRef = useRef<DrawingInputMethod[]>(DEFAULT_INPUT_METHODS);
	const smoothingOptionsRef = useRef(
		resolveStrokeSmoothingOptions(strokeSmoothing),
	);

	const samplingRateRef = useRef(samplingRate);
	const pendingPointsRef = useRef<TimedDrawingPoint[]>([]);
	// 跟踪最后一个被保留的采样点的时间戳，用于按采样率降采样
	const lastSampledTimestampRef = useRef(0);
	// Shift 键按下状态：用于 rect/ellipse 工具的正方形/正圆约束。
	// 不依赖 DragInputEvent（multi-drag 未透传 shiftKey），改用 window 监听。
	const shiftPressedRef = useRef(false);

	effectiveToolRef.current = effectiveTool;
	isDrawingEnabledRef.current = isDrawingEnabled;
	addStrokeRef.current = addStroke;
	removeStrokeRef.current = removeStroke;
	strokesRef.current = strokes;
	resolvedColorRef.current = resolvedColor;
	resolvedOpenWidthRef.current = resolvedOpenWidth;
	resolvedClosedWidthRef.current = resolvedClosedWidth;
	resolvedDashArrayRef.current = resolvedDashArray;
	resolvedDashOffsetRef.current = resolvedDashOffset;
	resolvedFillColorRef.current = fillColor;
	resolvedFillOpacityRef.current = resolvedFillOpacity;
	pressureRef.current = pressure;
	inputMethodsRef.current = inputMethods ?? DEFAULT_INPUT_METHODS;
	smoothingOptionsRef.current = resolveStrokeSmoothingOptions(strokeSmoothing);
	samplingRateRef.current = resolvedSamplingRate;

	const getLocalCoordinates = useCallback(
		(clientX: number, clientY: number): DrawingPoint => {
			if (!hostRef.current) {
				return { x: 0, y: 0 };
			}
			const rect = hostRef.current.getBoundingClientRect();
			return {
				x: clientX - rect.left,
				y: clientY - rect.top,
			};
		},
		[],
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
		if (
			previousValueRef.current !== value &&
			value !== undefined &&
			isDrawingRef.current
		) {
			clearActiveStroke();
		}
		previousValueRef.current = value;
	}, [clearActiveStroke, value]);

	useEffect(() => {
		const host = hostRef.current;
		if (!host) {
			return undefined;
		}

		let currentActiveStroke: DrawingStroke | null = null;
		const clearCurrentActiveStroke = () => {
			currentActiveStroke = null;
		};
		clearActiveStrokeRef.current = clearCurrentActiveStroke;

		const drag = new Drag(host, {
			maxFingerCount: 1,
			getPose: () => ({ position: { x: 0, y: 0 }, width: 0, height: 0 }),
			setPose: () => {},
		});
		const pointerInputController = createPointerInputController(host, {
			gesturesEnabled: false,
		});

		const processPoints = (points: TimedDrawingPoint[]) => {
			if (!currentActiveStroke || points.length === 0) return;

			const nextPoints =
				effectiveToolRef.current === "pen" && smoothingOptionsRef.current.enabled
					? createVelocityAdaptivePoints(
							points,
							smoothingOptionsRef.current,
						)
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

		drag.addEventListener(DragOperationType.Move, (fingers: DragFinger[]) => {
			if (!isDrawingEnabledRef.current) {
				clearActiveStroke();
				return;
			}

			// Polygon/bezier use click-to-place, not drag — handled by a separate effect below.
			// Line is hybrid: drag still creates a 2-point line once movement passes the threshold.
			if (skipsMultiDragMove(effectiveToolRef.current)) {
				return;
			}

			if (fingers.length !== 1) {
				return;
			}

			const finger = fingers[0];
			const path = finger.getPath();
			const firstPathItem = path[0];

			if (
				!firstPathItem ||
				!isDrawingInput(firstPathItem.event, inputMethodsRef.current)
			) {
				clearActiveStroke();
				return;
			}

			if (effectiveToolRef.current === "eraser") {
				for (const pathItem of path.slice(processedPathLengthRef.current)) {
					const sourcePoint =
						pathItem.event?.clientX !== undefined &&
						pathItem.event.clientY !== undefined
							? { x: pathItem.event.clientX, y: pathItem.event.clientY }
							: pathItem.point;
					const localPoint = getLocalCoordinates(sourcePoint.x, sourcePoint.y);
					const eraserRadius = resolvedOpenWidthRef.current / 2;
					const pickableStrokes = strokesRef.current.map((stroke) => ({
						...stroke,
						fillColor: stroke.fillColor ?? resolvedFillColorRef.current,
					}));
					const hitStroke = pickStroke(localPoint, pickableStrokes, eraserRadius);
					if (hitStroke) {
						removeStrokeRef.current(hitStroke.id);
					}
				}
				processedPathLengthRef.current = path.length;
				return;
			}

			const localPath = path.map((pathItem) => {
				const sourcePoint =
					pathItem.event?.clientX !== undefined &&
					pathItem.event.clientY !== undefined
						? { x: pathItem.event.clientX, y: pathItem.event.clientY }
						: pathItem.point;
				return getLocalCoordinates(sourcePoint.x, sourcePoint.y);
			});

			// Line is now click-to-place by default. Multi-drag remains the legacy shortcut,
			// but only after real movement: at least two path samples and >4 px total travel.
			if (
				effectiveToolRef.current === "line" &&
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
					timestamp: pathItem.timestamp || pathItem.event?.timeStamp,
				};

				if (
					pressureRef.current === true &&
					effectiveToolRef.current === "pen" &&
					pathItem.pressure !== undefined
				) {
					timedPoint.pressure = normalizePointPressure(pathItem.pressure);
				}

				rawTimedPoints.push(timedPoint);
			}

			pendingPointsRef.current.push(...rawTimedPoints);
			processedPathLengthRef.current = path.length;
			flushPendingPoints();
		});

		drag.addEventListener(DragOperationType.AllEnd, (fingers: DragFinger[]) => {
			if (fingers.length > 1) {
				clearActiveStroke();
				return;
			}

			flushPendingPoints();

			if (effectiveToolRef.current !== "eraser") {
				const stroke = currentActiveStroke;
				if (stroke && isValidStroke(stroke)) {
					const committed =
						shiftPressedRef.current && isBboxShapeTool(stroke.tool)
							? applyShiftConstraintToShape(stroke)
							: stroke;
					addStrokeRef.current(committed);
				}
			}

			clearActiveStroke();
		});

		const handleKeyChange = (event: KeyboardEvent) => {
			if (event.key !== "Shift") return;
			const nextPressed = event.type === "keydown";
			if (shiftPressedRef.current === nextPressed) return;
			shiftPressedRef.current = nextPressed;
			// 拖拽进行中时立刻刷新预览：按下时收敛到正方形/正圆，松开时恢复原始 bbox。
			if (
				currentActiveStroke &&
				isBboxShapeTool(currentActiveStroke.tool)
			) {
				const renderableStroke = nextPressed
					? applyShiftConstraintToShape(currentActiveStroke)
					: currentActiveStroke;
				setActiveStroke(renderableStroke);
			}
		};
		const handleBlur = () => {
			shiftPressedRef.current = false;
		};
		window.addEventListener("keydown", handleKeyChange);
		window.addEventListener("keyup", handleKeyChange);
		window.addEventListener("blur", handleBlur);

		return () => {
			if (clearActiveStrokeRef.current === clearCurrentActiveStroke) {
				clearActiveStrokeRef.current = null;
			}
			window.removeEventListener("keydown", handleKeyChange);
			window.removeEventListener("keyup", handleKeyChange);
			window.removeEventListener("blur", handleBlur);
			drag.destroy();
			pointerInputController.destroy();
		};
	}, [clearActiveStroke, getLocalCoordinates, setActiveStroke]);

	// Tool switch: reset reducer state. Cancels any in-progress polygon placement
	// when user picks a different tool mid-draw (or vice versa).
	useEffect(() => {
		dispatchInteraction({ type: "TOOL_CHANGE", tool: effectiveTool });
	}, [effectiveTool]);

	// When the reducer reaches a `completedStroke` (line/polygon placement finished), commit a v2 stroke
	// and clear the completion marker so we don't double-commit on re-render.
	useEffect(() => {
		if (interactionState.phase !== "idle" || !interactionState.completedStroke) {
			return;
		}
		const completed = interactionState.completedStroke;
		if (completed.tool === "line" && completed.points.length >= 2) {
			const line: LineStrokeV2 = {
				schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
				id: generateStrokeId(),
				tool: "line",
				points: completed.points.map((point) => ({ x: point.x, y: point.y })),
				strokeColor: resolvedColorRef.current,
				strokeWidth: resolvedOpenWidthRef.current,
				dashArray: resolvedDashArrayRef.current
					? [...resolvedDashArrayRef.current]
					: undefined,
				dashOffset: resolvedDashOffsetRef.current,
				fillColor: resolvedFillColorRef.current,
				fillOpacity: resolvedFillOpacityRef.current,
			};
			addStrokeRef.current(line as unknown as DrawingStroke);
		}
		if (completed.tool === "polygon" && completed.points.length >= 3) {
			const polygon: PolygonStrokeV2 = {
				schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
				id: generateStrokeId(),
				tool: "polygon",
				points: completed.points.map((point) => ({ x: point.x, y: point.y })),
				strokeColor: resolvedColorRef.current,
				strokeWidth: resolvedClosedWidthRef.current,
				dashArray: resolvedDashArrayRef.current
					? [...resolvedDashArrayRef.current]
					: undefined,
				dashOffset: resolvedDashOffsetRef.current,
				fillColor: resolvedFillColorRef.current,
				fillOpacity: resolvedFillOpacityRef.current,
			};
			addStrokeRef.current(polygon as unknown as DrawingStroke);
		}
		if (completed.tool === "bezier" && completed.points.length === 4) {
			// Bezier is an open tool: no fill, dash applies. The reducer emits exactly four
			// points in [start, cp1, cp2, end] order; renderer's bezierPath() draws `M ... C ...`.
			const bezier: BezierStrokeV2 = {
				schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
				id: generateStrokeId(),
				tool: "bezier",
				points: completed.points.map((point) => ({ x: point.x, y: point.y })),
				strokeColor: resolvedColorRef.current,
				strokeWidth: resolvedOpenWidthRef.current,
				dashArray: resolvedDashArrayRef.current
					? [...resolvedDashArrayRef.current]
					: undefined,
				dashOffset: resolvedDashOffsetRef.current,
			};
			addStrokeRef.current(bezier as unknown as DrawingStroke);
		}
		dispatchInteraction({ type: "TOOL_CHANGE", tool: effectiveTool });
	}, [interactionState, effectiveTool]);

	// Click-to-place listeners are only wired when the line/polygon/bezier tool is active.
	// Re-mounting on tool change is intentional: a different tool means a different
	// set of pointer semantics, so the listener lifetime tracks the tool.
	useEffect(() => {
		if (!isClickToPlaceTool(effectiveTool) || !isDrawingEnabled) {
			return undefined;
		}
		const host = hostRef.current;
		if (!host) {
			return undefined;
		}

		const toCanvasPoint = (clientX: number, clientY: number) => {
			const rect = host.getBoundingClientRect();
			return { x: clientX - rect.left, y: clientY - rect.top };
		};

		let pendingLineClick: { point: DrawingPoint; pointerId?: number } | null = null;

		const handlePointerDown = (event: PointerEvent) => {
			if (event.button !== undefined && event.button !== 0) {
				return;
			}
			const point = toCanvasPoint(event.clientX, event.clientY);
			if (effectiveTool === "line") {
				pendingLineClick = { point, pointerId: event.pointerId };
				return;
			}
			dispatchInteraction({
				type: "POINTER_DOWN",
				point,
				pointerId: event.pointerId,
				detail: event.detail,
			});
		};

		const handlePointerMove = (event: PointerEvent) => {
			const point = toCanvasPoint(event.clientX, event.clientY);
			if (
				effectiveTool === "line" &&
				pendingLineClick &&
				Math.hypot(point.x - pendingLineClick.point.x, point.y - pendingLineClick.point.y) > LINE_DRAG_THRESHOLD_PX
			) {
				pendingLineClick = null;
			}
			dispatchInteraction({
				type: "POINTER_MOVE",
				point,
				pointerId: event.pointerId,
			});
		};

		const handlePointerUp = (event: PointerEvent) => {
			if (effectiveTool !== "line" || !pendingLineClick) {
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
				type: "POINTER_DOWN",
				point,
				pointerId: event.pointerId,
				detail: event.detail,
				mode: "place",
			});
		};

		const handleDoubleClick = (event: MouseEvent) => {
			pendingLineClick = null;
			// Forward as a POINTER_DOWN with detail=2 — the reducer recognises
			// that as the polygon/line/bezier finish signal.
			const point = toCanvasPoint(event.clientX, event.clientY);
			dispatchInteraction({
				type: "POINTER_DOWN",
				point,
				detail: 2,
			});
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				dispatchInteraction({ type: "KEY_DOWN", key: "Escape" });
			}
		};

		const handleBlur = () => {
			pendingLineClick = null;
			dispatchInteraction({ type: "BLUR" });
		};

		host.addEventListener("pointerdown", handlePointerDown);
		host.addEventListener("pointermove", handlePointerMove);
		host.addEventListener("pointerup", handlePointerUp);
		host.addEventListener("dblclick", handleDoubleClick);
		window.addEventListener("keydown", handleKeyDown);
		window.addEventListener("blur", handleBlur);

		return () => {
			host.removeEventListener("pointerdown", handlePointerDown);
			host.removeEventListener("pointermove", handlePointerMove);
			host.removeEventListener("pointerup", handlePointerUp);
			host.removeEventListener("dblclick", handleDoubleClick);
			window.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("blur", handleBlur);
		};
	}, [effectiveTool, isDrawingEnabled]);

	const linePreviewStroke: LineStrokeV2 | null =
		interactionState.phase === "placingLine"
			? {
					schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
					id: "line-preview",
					tool: "line",
					points: interactionState.cursorPoint &&
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
		interactionState.phase === "placingPolygon"
			? {
					schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
					id: "polygon-preview",
					tool: "polygon",
					points: interactionState.cursorPoint &&
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

	// Bezier preview is the open control polyline of placed points + cursor. The
	// renderer's v2 line branch draws `M ... L ... L ...` for >2 points, which is
	// exactly the visual feedback (start → cp1 → cp2 → end skeleton) the user
	// needs while clicking through the four points. The final committed stroke
	// renders as a true cubic curve via `bezierPath()` once the 4th click lands.
	const bezierPreviewStroke: LineStrokeV2 | null = (() => {
		if (interactionState.phase !== "placingBezier") {
			return null;
		}
		const placed = interactionState.points.filter(
			(point): point is CanvasPoint => point !== undefined,
		);
		const cursor = interactionState.cursorPoint;
		const previewPoints =
			cursor && (placed.length === 0 || placed[placed.length - 1].x !== cursor.x || placed[placed.length - 1].y !== cursor.y)
				? [...placed, cursor]
				: [...placed];
		if (previewPoints.length === 0) {
			return null;
		}
		return {
			schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
			id: "bezier-preview",
			tool: "line",
			points: previewPoints.map((point) => ({ x: point.x, y: point.y })),
			strokeColor: resolvedColor,
			strokeWidth: resolvedOpenWidth,
			dashArray: resolvedDashArray ? [...resolvedDashArray] : undefined,
			dashOffset: resolvedDashOffset,
		};
	})();

	return (
		<div
			ref={hostRef}
			data-testid={testID}
			data-tool={effectiveTool}
			data-enabled={String(isDrawingEnabled)}
			data-stroke-count={strokes.length}
			data-active-tool={effectiveTool}
			data-scale="1"
			data-tx="0"
			data-ty="0"
			style={{
				width: "100%",
				height: "100%",
				minHeight: "200px",
				border: "1px solid #ccc",
				position: "relative",
				touchAction: "none",
			}}
		>
			<svg
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					width: "100%",
					height: "100%",
				}}
			>
				<title>Drawing surface</title>
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
					/>
				)}
			</svg>
		</div>
	);
}
