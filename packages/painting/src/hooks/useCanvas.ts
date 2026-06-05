import { useCallback, useMemo, useState } from "react";
import type {
	DrawingPoint,
	DrawingStroke,
	DrawingValue,
} from "../components/DrawingSurface";
import {
	addStroke as addStrokeToValue,
	clearStrokes as clearStrokesFromValue,
	pick as pickStroke,
	removeStroke as removeStrokeFromValue,
	updateStroke as updateStrokeInValue,
} from "../utils";

export type UseCanvasOptions = {
	value?: DrawingValue;
	defaultValue?: DrawingValue;
	onChange?: (value: DrawingValue) => void;
};

export type UseCanvasReturn = {
	strokes: DrawingStroke[];
	activeStroke: DrawingStroke | null;
	setActiveStroke: (stroke: DrawingStroke | null) => void;
	addStroke: (stroke: DrawingStroke) => void;
	removeStroke: (strokeId: string) => void;
	updateStroke: (stroke: DrawingStroke) => void;
	clearStrokes: () => void;
	pick: (point: DrawingPoint, maxDistance?: number) => DrawingStroke | null;
};

const emptyDrawingValue: DrawingValue = { strokes: [] };

export function useCanvas(options: UseCanvasOptions = {}): UseCanvasReturn {
	const { value, defaultValue, onChange } = options;
	const isControlled = value !== undefined;
	const [internalStrokes, setInternalStrokes] = useState<DrawingStroke[]>(
		() => defaultValue?.strokes ?? [],
	);
	const [activeStroke, setActiveStroke] = useState<DrawingStroke | null>(null);

	const strokes = useMemo(
		() => (isControlled ? (value?.strokes ?? []) : internalStrokes),
		[isControlled, internalStrokes, value?.strokes],
	);

	const updateValue = useCallback(
		(getNextValue: (currentValue: DrawingValue) => DrawingValue) => {
			if (isControlled) {
				onChange?.(getNextValue(value ?? emptyDrawingValue));
				return;
			}

			setInternalStrokes((currentStrokes) => {
				const nextValue = getNextValue({ strokes: currentStrokes });
				onChange?.(nextValue);
				return nextValue.strokes;
			});
		},
		[isControlled, onChange, value],
	);

	const addStroke = useCallback(
		(stroke: DrawingStroke) => {
			updateValue((currentValue) => addStrokeToValue(currentValue, stroke));
		},
		[updateValue],
	);

	const removeStroke = useCallback(
		(strokeId: string) => {
			updateValue((currentValue) => removeStrokeFromValue(currentValue, strokeId));
		},
		[updateValue],
	);

	const updateStroke = useCallback(
		(stroke: DrawingStroke) => {
			updateValue((currentValue) => updateStrokeInValue(currentValue, stroke));
		},
		[updateValue],
	);

	const clearStrokes = useCallback(() => {
		updateValue(clearStrokesFromValue);
	}, [updateValue]);

	const pick = useCallback(
		(point: DrawingPoint, maxDistance?: number) => pickStroke(point, strokes, maxDistance),
		[strokes],
	);

	return {
		strokes,
		activeStroke,
		setActiveStroke,
		addStroke,
		removeStroke,
		updateStroke,
		clearStrokes,
		pick,
	};
}
