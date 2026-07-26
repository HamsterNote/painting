import { Fragment, type ReactElement } from "react";
import type { DrawingStroke } from "../components/DrawingSurface";
import { assertNever } from "../model/assertNever";
import type { DrawingPointV2, DrawingStrokeV2 } from "../model/strokes";
import { pointsToSvgPath } from "../stroke-helpers";
import { ImageRenderer } from "./ImageRenderer";
import { resolveStrokeStyle, type StrokeStyleFields } from "./resolveStrokeStyle";
import { TextRenderer } from "./TextRenderer";

type StrokePoint = DrawingPointV2;

export type RenderableStroke = DrawingStroke | DrawingStrokeV2;

export type StrokeRendererProps = {
	stroke: RenderableStroke;
	isActive?: boolean;
	fallbackColor: string;
	fallbackWidth: number;
	fallbackClosedWidth?: number;
	fallbackDashArray?: number[];
	fallbackDashOffset?: number;
	fallbackFillColor?: string;
	fallbackFillOpacity?: number;
	pressureMultiplier?: number;
};

type StyledRenderableStroke = RenderableStroke & StrokeStyleFields;

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

function normalizePressureMultiplier(pressureMultiplier: number | undefined): number {
	return typeof pressureMultiplier === "number" &&
		Number.isFinite(pressureMultiplier) &&
		pressureMultiplier > 0
		? pressureMultiplier
		: 1;
}

function hasPressureData(stroke: RenderableStroke): boolean {
	return (
		stroke.tool === "pen" &&
		stroke.points.some((point) => point.pressure !== undefined)
	);
}

function firstAndLast(points: StrokePoint[]): [StrokePoint, StrokePoint] | null {
	const first = points[0];
	const last = points[points.length - 1];
	return first && last ? [first, last] : null;
}

function getBbox(points: StrokePoint[]) {
	const endpoints = firstAndLast(points);
	if (!endpoints) {
		return null;
	}

	const [first, last] = endpoints;
	return {
		x: Math.min(first.x, last.x),
		y: Math.min(first.y, last.y),
		width: Math.abs(last.x - first.x),
		height: Math.abs(last.y - first.y),
	};
}

function shapeRotationTransform(stroke: RenderableStroke, bbox: ReturnType<typeof getBbox>): string | undefined {
	const rotationRad = stroke.rotationRad;
	if (!bbox || typeof rotationRad !== "number" || !Number.isFinite(rotationRad) || rotationRad === 0) {
		return undefined;
	}
	const centerX = bbox.x + bbox.width / 2;
	const centerY = bbox.y + bbox.height / 2;
	return `rotate(${(rotationRad * 180) / Math.PI} ${centerX} ${centerY})`;
}

function pointList(points: StrokePoint[]): string {
	return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function openLinePath(points: StrokePoint[]): string {
	return points
		.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
		.join(" ");
}

function bezierPath(points: StrokePoint[]): string | undefined {
	if (points.length !== 4) {
		return undefined;
	}

	const [start, cp1, cp2, end] = points;
	return `M ${start.x} ${start.y} C ${cp1.x} ${cp1.y} ${cp2.x} ${cp2.y} ${end.x} ${end.y}`;
}

function styleFor(
	stroke: StyledRenderableStroke,
	fallbackColor: string,
	fallbackWidth: number,
	fallbackClosedWidth: number | undefined,
	fallbackStyle: StrokeStyleFields,
	isClosedShape: boolean,
) {
	return resolveStrokeStyle({
		...stroke,
		dashArray: stroke.dashArray ?? fallbackStyle.dashArray,
		dashOffset: stroke.dashOffset ?? fallbackStyle.dashOffset,
		fillColor: stroke.fillColor ?? fallbackStyle.fillColor,
		fillOpacity: stroke.fillOpacity ?? fallbackStyle.fillOpacity,
	}, {
		isClosedShape,
		fallbackColor,
		fallbackWidth: isClosedShape ? (fallbackClosedWidth ?? fallbackWidth) : fallbackWidth,
	});
}

function renderPen(
	stroke: StyledRenderableStroke,
	fallbackColor: string,
	fallbackWidth: number,
	fallbackClosedWidth: number | undefined,
	fallbackStyle: StrokeStyleFields,
	opacity: "0.7" | undefined,
	resolvedPressureMultiplier: number,
): ReactElement | ReactElement[] | null {
	const style = styleFor(stroke, fallbackColor, fallbackWidth, fallbackClosedWidth, fallbackStyle, false);

	if (hasPressureData(stroke) && stroke.points.length >= 2) {
		return stroke.points.slice(1).map((point, index) => {
			const previousPoint = stroke.points[index];
			const segmentKey = opacity ? `active-${index}` : `${stroke.id}-${index}`;
			return (
				<line
					key={segmentKey}
					x1={previousPoint.x}
					y1={previousPoint.y}
					x2={point.x}
					y2={point.y}
					fill={style.fill}
					stroke={style.stroke}
					strokeWidth={(style.strokeWidth ?? fallbackWidth) * normalizePointPressure(point.pressure) * resolvedPressureMultiplier}
					strokeDasharray={style.strokeDasharray}
					strokeDashoffset={style.strokeDashoffset}
					strokeLinecap="round"
					strokeLinejoin="round"
					opacity={opacity}
				/>
			);
		});
	}

	return (
		<path
			key={opacity ? undefined : stroke.id}
			d={pointsToSvgPath(stroke.points)}
			fill={style.fill}
			stroke={style.stroke}
			strokeWidth={style.strokeWidth}
			strokeDasharray={style.strokeDasharray}
			strokeDashoffset={style.strokeDashoffset}
			strokeLinecap="round"
			strokeLinejoin="round"
			opacity={opacity}
		/>
	);
}

function renderV1Stroke(
	stroke: StyledRenderableStroke & DrawingStroke,
	fallbackColor: string,
	fallbackWidth: number,
	fallbackClosedWidth: number | undefined,
	fallbackStyle: StrokeStyleFields,
	opacity: "0.7" | undefined,
	resolvedPressureMultiplier: number,
): ReactElement | ReactElement[] | null {
	const endpoints = firstAndLast(stroke.points);
	if (!endpoints) {
		return null;
	}

	const [first, last] = endpoints;

	if (stroke.tool === "text") {
		return <TextRenderer stroke={stroke} fallbackColor={fallbackColor} fallbackFontSize={24} />;
	}

	if (stroke.tool === "image") {
		return <ImageRenderer id={stroke.id} points={stroke.points} src={stroke.src} rotationRad={stroke.rotationRad} opacity={opacity} />;
	}

	if (stroke.tool === "rect") {
		const bbox = getBbox(stroke.points);
		if (!bbox) {
			return null;
		}
		const style = styleFor(stroke, fallbackColor, fallbackWidth, fallbackClosedWidth, fallbackStyle, true);
		return (
			<rect
				key={opacity ? undefined : stroke.id}
				x={bbox.x}
				y={bbox.y}
				width={bbox.width}
				height={bbox.height}
				fill={style.fill}
				stroke={style.stroke}
				strokeWidth={style.strokeWidth}
				strokeDasharray={style.strokeDasharray}
				strokeDashoffset={style.strokeDashoffset}
				fillOpacity={style.fillOpacity}
				transform={shapeRotationTransform(stroke, bbox)}
				opacity={opacity}
			/>
		);
	}

	if (stroke.tool === "ellipse") {
		const bbox = getBbox(stroke.points);
		if (!bbox) {
			return null;
		}
		const style = styleFor(stroke, fallbackColor, fallbackWidth, fallbackClosedWidth, fallbackStyle, true);
		return (
			<ellipse
				key={opacity ? undefined : stroke.id}
				cx={bbox.x + bbox.width / 2}
				cy={bbox.y + bbox.height / 2}
				rx={bbox.width / 2}
				ry={bbox.height / 2}
				fill={style.fill}
				stroke={style.stroke}
				strokeWidth={style.strokeWidth}
				strokeDasharray={style.strokeDasharray}
				strokeDashoffset={style.strokeDashoffset}
				fillOpacity={style.fillOpacity}
				transform={shapeRotationTransform(stroke, bbox)}
				opacity={opacity}
			/>
		);
	}

	if (stroke.tool === "line") {
		const style = styleFor(stroke, fallbackColor, fallbackWidth, fallbackClosedWidth, fallbackStyle, false);
		return (
			<line
				key={opacity ? undefined : stroke.id}
				x1={first.x}
				y1={first.y}
				x2={last.x}
				y2={last.y}
				fill={style.fill}
				stroke={style.stroke}
				strokeWidth={style.strokeWidth}
				strokeDasharray={style.strokeDasharray}
				strokeDashoffset={style.strokeDashoffset}
				strokeLinecap="round"
				opacity={opacity}
			/>
		);
	}

	return renderPen(stroke, fallbackColor, fallbackWidth, fallbackClosedWidth, fallbackStyle, opacity, resolvedPressureMultiplier);
}

function renderV2Stroke(
	stroke: StyledRenderableStroke & DrawingStrokeV2,
	fallbackColor: string,
	fallbackWidth: number,
	fallbackClosedWidth: number | undefined,
	fallbackStyle: StrokeStyleFields,
	opacity: "0.7" | undefined,
	resolvedPressureMultiplier: number,
): ReactElement | ReactElement[] | null {
	const endpoints = firstAndLast(stroke.points);
	if (!endpoints) {
		return null;
	}

	const [first, last] = endpoints;

	switch (stroke.tool) {
		case "pen":
			return renderPen(stroke, fallbackColor, fallbackWidth, fallbackClosedWidth, fallbackStyle, opacity, resolvedPressureMultiplier);
		case "line": {
			const style = styleFor(stroke, fallbackColor, fallbackWidth, fallbackClosedWidth, fallbackStyle, false);
			if (stroke.points.length > 2) {
				return (
					<path
						key={opacity ? undefined : stroke.id}
						d={openLinePath(stroke.points)}
						fill={style.fill}
						stroke={style.stroke}
						strokeWidth={style.strokeWidth}
						strokeDasharray={style.strokeDasharray}
						strokeDashoffset={style.strokeDashoffset}
						strokeLinecap="round"
						strokeLinejoin="round"
						opacity={opacity}
					/>
				);
			}
			return (
				<line
					key={opacity ? undefined : stroke.id}
					x1={first.x}
					y1={first.y}
					x2={last.x}
					y2={last.y}
					fill={style.fill}
					stroke={style.stroke}
					strokeWidth={style.strokeWidth}
					strokeDasharray={style.strokeDasharray}
					strokeDashoffset={style.strokeDashoffset}
					strokeLinecap="round"
					opacity={opacity}
				/>
			);
		}
		case "rect": {
			const bbox = getBbox(stroke.points);
			if (!bbox) {
				return null;
			}
			const style = styleFor(stroke, fallbackColor, fallbackWidth, fallbackClosedWidth, fallbackStyle, true);
			return (
				<rect
					key={opacity ? undefined : stroke.id}
					x={bbox.x}
					y={bbox.y}
					width={bbox.width}
					height={bbox.height}
					fill={style.fill}
					stroke={style.stroke}
					strokeWidth={style.strokeWidth}
					strokeDasharray={style.strokeDasharray}
					strokeDashoffset={style.strokeDashoffset}
					fillOpacity={style.fillOpacity}
					transform={shapeRotationTransform(stroke, bbox)}
					opacity={opacity}
				/>
			);
		}
		case "ellipse": {
			const bbox = getBbox(stroke.points);
			if (!bbox) {
				return null;
			}
			const style = styleFor(stroke, fallbackColor, fallbackWidth, fallbackClosedWidth, fallbackStyle, true);
			return (
				<ellipse
					key={opacity ? undefined : stroke.id}
					cx={bbox.x + bbox.width / 2}
					cy={bbox.y + bbox.height / 2}
					rx={bbox.width / 2}
					ry={bbox.height / 2}
					fill={style.fill}
					stroke={style.stroke}
					strokeWidth={style.strokeWidth}
					strokeDasharray={style.strokeDasharray}
					strokeDashoffset={style.strokeDashoffset}
					fillOpacity={style.fillOpacity}
					transform={shapeRotationTransform(stroke, bbox)}
					opacity={opacity}
				/>
			);
		}
		case "polygon": {
			const style = styleFor(stroke, fallbackColor, fallbackWidth, fallbackClosedWidth, fallbackStyle, true);
			return (
				<polygon
					key={opacity ? undefined : stroke.id}
					points={pointList(stroke.points)}
					fill={style.fill}
					stroke={style.stroke}
					strokeWidth={style.strokeWidth}
					strokeDasharray={style.strokeDasharray}
					strokeDashoffset={style.strokeDashoffset}
					fillOpacity={style.fillOpacity}
					opacity={opacity}
				/>
			);
		}
		case "bezier": {
			const d = bezierPath(stroke.points);
			if (!d) {
				return null;
			}
			const style = styleFor(stroke, fallbackColor, fallbackWidth, fallbackClosedWidth, fallbackStyle, false);
			return (
				<path
					key={opacity ? undefined : stroke.id}
					d={d}
					fill={style.fill}
					stroke={style.stroke}
					strokeWidth={style.strokeWidth}
					strokeDasharray={style.strokeDasharray}
					strokeDashoffset={style.strokeDashoffset}
					strokeLinecap="round"
					strokeLinejoin="round"
					opacity={opacity}
				/>
			);
		}
		case "text":
			return <TextRenderer stroke={stroke} fallbackColor={fallbackColor} fallbackFontSize={24} />;
		case "image":
			return <ImageRenderer id={stroke.id} points={stroke.points} src={stroke.src} rotationRad={stroke.rotationRad} opacity={opacity} />;
		default:
			return assertNever(stroke);
	}
}

function isV2Stroke(stroke: RenderableStroke): stroke is DrawingStrokeV2 {
	return "schemaVersion" in stroke;
}

export function StrokeRenderer({
	stroke,
	isActive,
	fallbackColor,
	fallbackWidth,
	fallbackClosedWidth,
	fallbackDashArray,
	fallbackDashOffset,
	fallbackFillColor,
	fallbackFillOpacity,
	pressureMultiplier,
}: StrokeRendererProps): ReactElement | null {
	if (stroke.points.length === 0) {
		return null;
	}

	const opacity = isActive ? "0.7" : undefined;
	const fallbackStyle = {
		dashArray: fallbackDashArray,
		dashOffset: fallbackDashOffset,
		fillColor: fallbackFillColor,
		fillOpacity: fallbackFillOpacity,
	};
	const resolvedPressureMultiplier = normalizePressureMultiplier(pressureMultiplier);
	const rendered = isV2Stroke(stroke)
		? renderV2Stroke(stroke, fallbackColor, fallbackWidth, fallbackClosedWidth, fallbackStyle, opacity, resolvedPressureMultiplier)
		: renderV1Stroke(stroke, fallbackColor, fallbackWidth, fallbackClosedWidth, fallbackStyle, opacity, resolvedPressureMultiplier);

	if (Array.isArray(rendered)) {
		return <Fragment>{rendered}</Fragment>;
	}

	return rendered;
}
