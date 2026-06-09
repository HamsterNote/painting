import type { GestureSnapshot, NormalizedPointerInput } from "@system-ui-js/multi-drag-core";
import { GestureController, PointerPhase } from "@system-ui-js/multi-drag-core";

export type GestureAdapterInput = {
	pointerId: number;
	phase: "start" | "move" | "end" | "cancel";
	point: { x: number; y: number };
	timestamp: number;
	pointerType?: string;
	pressure?: number;
	isPrimary?: boolean;
};

export type GestureAdapterResult = {
	kind: "single-move" | "single-end" | "multi-start" | "multi-move" | "cancel" | "idle";
	activePointerCount: number;
	path?: GestureAdapterInput[];
	center?: { x: number; y: number };
	centerDelta?: { x: number; y: number };
	requestedScale?: number;
};

type TrackedPointer = {
	latest: GestureAdapterInput;
	path: GestureAdapterInput[];
};

type GestureContext = {
	pose: {
		position: { x: number; y: number };
		width: number;
		height: number;
		scale: number;
	};
	anchorCenter: { x: number; y: number };
	features: { drag: true; rotate: false; scale: true };
};

const features = { drag: true, rotate: false, scale: true } as const;

const phaseMap: Record<GestureAdapterInput["phase"], PointerPhase> = {
	start: PointerPhase.Start,
	move: PointerPhase.Move,
	end: PointerPhase.End,
	cancel: PointerPhase.Cancel,
};

const zeroPoint = { x: 0, y: 0 };

const clonePoint = (point: { x: number; y: number }) => ({ x: point.x, y: point.y });

const getCenter = (pointers: Iterable<TrackedPointer>): { x: number; y: number } => {
	let x = 0;
	let y = 0;
	let count = 0;

	for (const pointer of pointers) {
		x += pointer.latest.point.x;
		y += pointer.latest.point.y;
		count += 1;
	}

	if (count === 0) {
		return clonePoint(zeroPoint);
	}

	return { x: x / count, y: y / count };
};

const toNormalizedInput = (input: GestureAdapterInput): NormalizedPointerInput => ({
	pointerId: input.pointerId,
	phase: phaseMap[input.phase],
	point: { x: input.point.x, y: input.point.y },
	pointerType: input.pointerType,
	pressure: input.pressure,
	isPrimary: input.isPrimary,
	timestamp: input.timestamp,
});

const createIdleResult = (activePointerCount: number): GestureAdapterResult => ({
	kind: "idle",
	activePointerCount,
});

export function createGestureAdapter({ initialScale }: { initialScale: number }): {
	process(input: GestureAdapterInput): GestureAdapterResult;
	setScale(scale: number): void;
	reset(): void;
} {
	let controller = new GestureController({ features });
	const activePointers = new Map<number, TrackedPointer>();
	let baseScale = initialScale;
	let currentPose = {
		position: clonePoint(zeroPoint),
		width: 0,
		height: 0,
		scale: baseScale,
	};
	let multiStartCenter: { x: number; y: number } | undefined;
	let lastMultiCenter: { x: number; y: number } | undefined;
	let multiGestureActive = false;
	let singleTrackingDisabledUntilReset = false;

	const resetState = () => {
		controller = new GestureController({ features });
		activePointers.clear();
		currentPose = {
			position: clonePoint(zeroPoint),
			width: 0,
			height: 0,
			scale: baseScale,
		};
		multiStartCenter = undefined;
		lastMultiCenter = undefined;
		multiGestureActive = false;
		singleTrackingDisabledUntilReset = false;
	};

	const buildContext = (): GestureContext => {
		const anchorCenter = activePointers.size > 0 ? getCenter(activePointers.values()) : clonePoint(zeroPoint);

		return {
			pose: currentPose,
			anchorCenter,
			features,
		};
	};

	const applySnapshot = (snapshot: GestureSnapshot) => {
		currentPose = {
			position: clonePoint(snapshot.pose.position),
			width: snapshot.pose.width,
			height: snapshot.pose.height,
			scale: snapshot.pose.scale ?? currentPose.scale,
		};
	};

	const updateTrackedPointers = (input: GestureAdapterInput) => {
		if (input.phase === "start") {
			activePointers.set(input.pointerId, { latest: input, path: [input] });
			return;
		}

		const tracked = activePointers.get(input.pointerId);

		if (!tracked) {
			return;
		}

		tracked.latest = input;
		tracked.path.push(input);

		if (input.phase === "end" || input.phase === "cancel") {
			activePointers.delete(input.pointerId);
		}
	};

	return {
		process(input) {
			const normalizedInput = toNormalizedInput(input);
			const snapshot = controller.process(normalizedInput, buildContext());

			updateTrackedPointers(input);
			applySnapshot(snapshot);

			if (input.phase === "cancel") {
				resetState();
				return { kind: "cancel", activePointerCount: 0 };
			}

			if (activePointers.size >= 2) {
				const center = getCenter(activePointers.values());

				if (!multiGestureActive) {
					multiGestureActive = true;
					multiStartCenter = center;
					lastMultiCenter = center;

					return {
						kind: "multi-start",
						activePointerCount: activePointers.size,
						center,
					};
				}

				const previousCenter = lastMultiCenter ?? multiStartCenter ?? center;
				lastMultiCenter = center;

				return {
					kind: "multi-move",
					activePointerCount: activePointers.size,
					center,
					centerDelta: { x: center.x - previousCenter.x, y: center.y - previousCenter.y },
					requestedScale: snapshot.pose.scale,
				};
			}

			if (multiGestureActive) {
				multiGestureActive = false;
				multiStartCenter = undefined;
				lastMultiCenter = undefined;
				singleTrackingDisabledUntilReset = activePointers.size === 1;
			}

			if (input.phase === "end") {
				return { kind: "single-end", activePointerCount: activePointers.size };
			}

			if (activePointers.size === 1) {
				const tracked = activePointers.values().next().value;

				if (!tracked) {
					return createIdleResult(activePointers.size);
				}

				currentPose = {
					position: clonePoint(tracked.latest.point),
					width: 0,
					height: 0,
					scale: currentPose.scale,
				};

				if (!singleTrackingDisabledUntilReset && input.phase === "move") {
					return {
						kind: "single-move",
						activePointerCount: 1,
						path: tracked.path,
					};
				}
			}

			return createIdleResult(activePointers.size);
		},
		setScale(scale) {
			if (!Number.isFinite(scale) || scale <= 0) {
				return;
			}

			baseScale = scale;
			// 新一轮双指缩放开始时，同步到外部视口的当前缩放，
			// 避免控制器继续沿用创建/上次 reset 时的 scale=1 作为基准。
			currentPose = {
				...currentPose,
				scale,
			};
		},
		reset() {
			resetState();
		},
	};
}
