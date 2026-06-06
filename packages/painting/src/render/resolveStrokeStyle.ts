export type StrokeStyleFields = {
	strokeColor?: string;
	strokeWidth?: number;
	dashArray?: number[];
	dashOffset?: number;
	fillColor?: string;
	fillOpacity?: number;
};

export type ResolveStrokeStyleOptions = {
	isClosedShape?: boolean;
	fallbackColor: string;
	fallbackWidth: number;
};

export type ResolvedStrokeStyle = {
	stroke?: string;
	strokeWidth?: number;
	strokeDasharray?: string;
	strokeDashoffset?: number;
	fill: string;
	fillOpacity?: number;
};

function isFiniteNonNegative(value: number): boolean {
	return Number.isFinite(value) && value >= 0;
}

function normalizeDashArray(dashArray: number[] | undefined): string | undefined {
	if (!dashArray || dashArray.length === 0) {
		return undefined;
	}

	if (!dashArray.every(isFiniteNonNegative)) {
		return undefined;
	}

	return dashArray.some((value) => value > 0) ? dashArray.join(" ") : undefined;
}

function normalizeFillColor(fillColor: string | undefined): string {
	return fillColor !== undefined && fillColor !== "none" ? fillColor : "none";
}

export function resolveStrokeStyle(
	style: StrokeStyleFields,
	options: ResolveStrokeStyleOptions,
): ResolvedStrokeStyle {
	const strokeWidth = style.strokeWidth ?? options.fallbackWidth;
	const shouldOmitStroke =
		options.isClosedShape === true && strokeWidth === 0;
	const fill =
		options.isClosedShape === true ? normalizeFillColor(style.fillColor) : "none";
	const strokeDasharray = normalizeDashArray(style.dashArray);
	const strokeDashoffset =
		style.dashOffset !== undefined && Number.isFinite(style.dashOffset)
			? style.dashOffset
			: undefined;

	return {
		stroke: shouldOmitStroke ? undefined : (style.strokeColor ?? options.fallbackColor),
		strokeWidth: shouldOmitStroke ? undefined : strokeWidth,
		strokeDasharray,
		strokeDashoffset,
		fill,
		fillOpacity:
			fill !== "none" ? (style.fillOpacity ?? 1) : undefined,
	};
}
