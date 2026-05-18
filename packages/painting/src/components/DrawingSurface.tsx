/// <reference path="../multi-drag.d.ts" />

import { Drag, DragOperationType } from "@system-ui-js/multi-drag";
import { useCallback, useEffect, useRef } from "react";
import { useCanvas } from "../hooks/useCanvas";
import {
	appendPoint,
	createStroke,
	createVelocityAdaptivePoints,
	type DrawingStrokeSmoothingOptions,
	isValidStroke,
	pointsToSvgPath,
	resolveStrokeSmoothingOptions,
	type TimedDrawingPoint,
} from "../stroke-helpers";
import { pick as pickStroke } from "../utils";

// Public drawing contract types
export type DrawingTool = "pen" | "line" | "rect" | "eraser";
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
};

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
	/** Enable velocity-adaptive stroke smoothing. Default: true. */
	strokeSmoothing?: boolean | DrawingStrokeSmoothingOptions;
	/** Allowed input methods. Defaults to ['touch', 'mouse', 'pen']. */
	inputMethods?: DrawingInputMethod[];
	/** Capture and render pen pressure when available. */
	pressure?: boolean;
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
	return tool === "pen" || tool === "line" || tool === "rect" || tool === "eraser";
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

function hasPressureData(stroke: DrawingStroke): boolean {
	return (
		stroke.tool === "pen" &&
		stroke.points.some((point) => point.pressure !== undefined)
	);
}

export function DrawingSurface(props: DrawingSurfaceProps) {
	const {
		tool,
		value,
		defaultValue,
		onChange,
		strokeColor,
		strokeWidth,
		strokeSmoothing,
		inputMethods,
		pressure,
		testID,
	} = props;
	const hostRef = useRef<HTMLDivElement>(null);

	const effectiveTool: DrawingTool = isDrawingToolSupported(tool)
		? tool
		: "pen";
	const isDrawingEnabled = tool === undefined || isDrawingToolSupported(tool);

	const resolvedColor =
		strokeColor && strokeColor.trim() !== "" ? strokeColor : "black";
	const resolvedWidth =
		typeof strokeWidth === "number" &&
		Number.isFinite(strokeWidth) &&
		strokeWidth >= 1
			? strokeWidth
			: 2;

	const hasCapturedDefaultValueRef = useRef(false);
	const initialDefaultValueRef = useRef<DrawingValue | undefined>(undefined);
	if (!hasCapturedDefaultValueRef.current) {
		hasCapturedDefaultValueRef.current = true;
		initialDefaultValueRef.current = defaultValue
			? {
					strokes: defaultValue.strokes.map((stroke) => ({
						...stroke,
						strokeColor: stroke.strokeColor ?? resolvedColor,
						strokeWidth: stroke.strokeWidth ?? resolvedWidth,
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
	const resolvedWidthRef = useRef(resolvedWidth);
	const strokesRef = useRef(strokes);
	const pressureRef = useRef(pressure);
	const inputMethodsRef = useRef<DrawingInputMethod[]>(DEFAULT_INPUT_METHODS);
	const smoothingOptionsRef = useRef(
		resolveStrokeSmoothingOptions(strokeSmoothing),
	);

	effectiveToolRef.current = effectiveTool;
	isDrawingEnabledRef.current = isDrawingEnabled;
	addStrokeRef.current = addStroke;
	removeStrokeRef.current = removeStroke;
	strokesRef.current = strokes;
	resolvedColorRef.current = resolvedColor;
	resolvedWidthRef.current = resolvedWidth;
	pressureRef.current = pressure;
	inputMethodsRef.current = inputMethods ?? DEFAULT_INPUT_METHODS;
	smoothingOptionsRef.current = resolveStrokeSmoothingOptions(strokeSmoothing);

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

		drag.addEventListener(DragOperationType.Move, (fingers: DragFinger[]) => {
			if (!isDrawingEnabledRef.current) {
				clearActiveStroke();
				return;
			}

			if (fingers.length !== 1) {
				if (fingers.length > 1) {
					clearActiveStroke();
				}
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
					const eraserRadius = resolvedWidthRef.current / 2;
					const hitStroke = pickStroke(localPoint, strokesRef.current, eraserRadius);
					if (hitStroke) {
						removeStrokeRef.current(hitStroke.id);
					}
				}
				processedPathLengthRef.current = path.length;
				return;
			}

			let nextStroke = currentActiveStroke;
			if (!nextStroke) {
				nextStroke = createStroke(
					effectiveToolRef.current,
					resolvedColorRef.current,
					resolvedWidthRef.current,
				);
				currentActiveStroke = nextStroke;
				isDrawingRef.current = true;
				processedPathLengthRef.current = 0;
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

			const nextPoints =
				effectiveToolRef.current === "pen"
					? createVelocityAdaptivePoints(
							rawTimedPoints,
							smoothingOptionsRef.current,
						)
					: rawTimedPoints;

			for (const point of nextPoints) {
				nextStroke = appendPoint(nextStroke, point);
			}

			processedPathLengthRef.current = path.length;
			currentActiveStroke = nextStroke;
			setActiveStroke(nextStroke);
		});

		drag.addEventListener(DragOperationType.AllEnd, (fingers: DragFinger[]) => {
			if (fingers.length > 1) {
				clearActiveStroke();
				return;
			}

			if (effectiveToolRef.current !== "eraser") {
				const stroke = currentActiveStroke;
				if (stroke && isValidStroke(stroke)) {
					addStrokeRef.current(stroke);
				}
			}

			clearActiveStroke();
		});

		return () => {
			if (clearActiveStrokeRef.current === clearCurrentActiveStroke) {
				clearActiveStrokeRef.current = null;
			}
			drag.destroy();
		};
	}, [clearActiveStroke, getLocalCoordinates, setActiveStroke]);

	return (
		<div
			ref={hostRef}
			data-testid={testID}
			data-tool={effectiveTool}
			data-enabled={String(isDrawingEnabled)}
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
				{strokes.map((stroke) => {
					if (stroke.points.length === 0) {
						return null;
					}
					const first = stroke.points[0];
					const last = stroke.points[stroke.points.length - 1];
					const strokeColor = stroke.strokeColor ?? resolvedColor;
					const strokeWidth = stroke.strokeWidth ?? resolvedWidth;
					if (stroke.tool === "rect") {
						const x = Math.min(first.x, last.x);
						const y = Math.min(first.y, last.y);
						const width = Math.abs(last.x - first.x);
						const height = Math.abs(last.y - first.y);
						return (
							<rect
								key={stroke.id}
								x={x}
								y={y}
								width={width}
								height={height}
								fill="none"
								stroke={strokeColor}
								strokeWidth={strokeWidth}
							/>
						);
					}
					if (stroke.tool === "line") {
						return (
							<line
								key={stroke.id}
								x1={first.x}
								y1={first.y}
								x2={last.x}
								y2={last.y}
								fill="none"
								stroke={strokeColor}
								strokeWidth={strokeWidth}
								strokeLinecap="round"
							/>
						);
					}
					if (hasPressureData(stroke) && stroke.points.length >= 2) {
						return stroke.points.slice(1).map((point, index) => {
							const previousPoint = stroke.points[index];
							const segmentKey = `${stroke.id}-${index}`;
							return (
								<line
									key={segmentKey}
									x1={previousPoint.x}
									y1={previousPoint.y}
									x2={point.x}
									y2={point.y}
									stroke={strokeColor}
									strokeWidth={strokeWidth * normalizePointPressure(point.pressure)}
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
							);
						});
					}
					return (
						<path
							key={stroke.id}
							d={pointsToSvgPath(stroke.points)}
							fill="none"
							stroke={strokeColor}
							strokeWidth={strokeWidth}
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					);
				})}

				{activeStroke &&
					activeStroke.points.length > 0 &&
					(activeStroke.tool === "rect" ? (
						(() => {
							const first = activeStroke.points[0];
							const last = activeStroke.points[activeStroke.points.length - 1];
							const x = Math.min(first.x, last.x);
							const y = Math.min(first.y, last.y);
							const width = Math.abs(last.x - first.x);
							const height = Math.abs(last.y - first.y);
							return (
								<rect
									x={x}
									y={y}
									width={width}
									height={height}
									fill="none"
									stroke={resolvedColor}
									strokeWidth={resolvedWidth}
									opacity="0.7"
								/>
							);
						})()
					) : activeStroke.tool === "line" ? (
						(() => {
							const first = activeStroke.points[0];
							const last = activeStroke.points[activeStroke.points.length - 1];
							return (
								<line
									x1={first.x}
									y1={first.y}
									x2={last.x}
									y2={last.y}
									fill="none"
									stroke={resolvedColor}
									strokeWidth={resolvedWidth}
									strokeLinecap="round"
									opacity="0.7"
								/>
							);
						})()
					) : hasPressureData(activeStroke) && activeStroke.points.length >= 2 ? (
						activeStroke.points.slice(1).map((point, index) => {
							const previousPoint = activeStroke.points[index];
							const segmentKey = `active-${index}`;
							return (
								<line
									key={segmentKey}
									x1={previousPoint.x}
									y1={previousPoint.y}
									x2={point.x}
									y2={point.y}
									stroke={resolvedColor}
									strokeWidth={
										(activeStroke.strokeWidth ?? resolvedWidth) *
										normalizePointPressure(point.pressure)
									}
									strokeLinecap="round"
									strokeLinejoin="round"
									opacity="0.7"
								/>
							);
						})
					) : (
						<path
							d={pointsToSvgPath(activeStroke.points)}
							fill="none"
							stroke={resolvedColor}
							strokeWidth={resolvedWidth}
							strokeLinecap="round"
							strokeLinejoin="round"
							opacity="0.7"
						/>
					))}
			</svg>
		</div>
	);
}
