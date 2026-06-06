/// <reference path="../multi-drag.d.ts" />

import { Drag, DragOperationType } from "@system-ui-js/multi-drag";
import { useCallback, useEffect, useRef } from "react";
import { useCanvas } from "../hooks/useCanvas";
import { createPointerInputController } from "../input/pointerInputController";
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
export type DrawingTool = "pen" | "line" | "rect" | "ellipse" | "eraser";
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
		tool === "eraser"
	);
}

function isClosedShapeTool(tool: DrawingTool): boolean {
	return tool === "rect" || tool === "ellipse";
}

// Shift 约束：把首末两点收敛为正方形 bbox，保持原拖拽方向（dx/dy 符号不变），
// 长边吸住短边。仅对闭合 bbox 形状（rect/ellipse）生效；其他工具或点数 < 2 时原样返回。
function applyShiftConstraintToShape(stroke: DrawingStroke): DrawingStroke {
	if (!isClosedShapeTool(stroke.tool) || stroke.points.length < 2) {
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
				shiftPressedRef.current && isClosedShapeTool(currentActiveStroke.tool)
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
			for (const pathItem of path.slice(processedPathLengthRef.current)) {
				const sourcePoint =
					pathItem.event?.clientX !== undefined &&
					pathItem.event.clientY !== undefined
						? { x: pathItem.event.clientX, y: pathItem.event.clientY }
						: pathItem.point;
				const localPoint = getLocalCoordinates(sourcePoint.x, sourcePoint.y);
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
						shiftPressedRef.current && isClosedShapeTool(stroke.tool)
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
				isClosedShapeTool(currentActiveStroke.tool)
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
			</svg>
		</div>
	);
}
