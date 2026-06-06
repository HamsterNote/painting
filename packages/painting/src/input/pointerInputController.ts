export type PointerInputController = {
	destroy: () => void;
	getActivePointerCount: () => number;
	isGestureEnabled: () => boolean;
};

export type PointerInputControllerOptions = {
	gesturesEnabled?: boolean;
};

export function createPointerInputController(
	element: HTMLElement,
	options: PointerInputControllerOptions = {},
): PointerInputController {
	const activePointers = new Map<number, PointerEvent>();
	const gesturesEnabled = options.gesturesEnabled === true;

	const handlePointerDown = (event: PointerEvent) => {
		activePointers.set(event.pointerId, event);
	};

	const handlePointerMove = (event: PointerEvent) => {
		if (!activePointers.has(event.pointerId)) {
			return;
		}

		activePointers.set(event.pointerId, event);
	};

	const handlePointerEnd = (event: PointerEvent) => {
		activePointers.delete(event.pointerId);
	};

	element.addEventListener("pointerdown", handlePointerDown);
	document.addEventListener("pointermove", handlePointerMove);
	document.addEventListener("pointerup", handlePointerEnd);
	document.addEventListener("pointercancel", handlePointerEnd);

	return {
		destroy: () => {
			element.removeEventListener("pointerdown", handlePointerDown);
			document.removeEventListener("pointermove", handlePointerMove);
			document.removeEventListener("pointerup", handlePointerEnd);
			document.removeEventListener("pointercancel", handlePointerEnd);
			activePointers.clear();
		},
		getActivePointerCount: () => activePointers.size,
		isGestureEnabled: () => gesturesEnabled,
	};
}
