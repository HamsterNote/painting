import {
	createGestureAdapter,
	type GestureAdapterInput,
	type GestureAdapterResult,
} from "../gestureAdapter";

const gestureInput = (overrides: Partial<GestureAdapterInput>): GestureAdapterInput => ({
	pointerId: 1,
	phase: "start",
	point: { x: 0, y: 0 },
	timestamp: 0,
	pointerType: "touch",
	pressure: 0.5,
	isPrimary: true,
	...overrides,
});

const expectPointClose = (
	actual: GestureAdapterResult["center"] | GestureAdapterResult["centerDelta"],
	expected: { x: number; y: number },
) => {
	expect(actual).toBeDefined();
	expect(actual?.x).toBeCloseTo(expected.x, 3);
	expect(actual?.y).toBeCloseTo(expected.y, 3);
};

describe("createGestureAdapter", () => {
	it("emits single-move path entries for one pointer without requestedScale", () => {
		const adapter = createGestureAdapter({ initialScale: 3 });
		const start = gestureInput({ timestamp: 10 });
		const move = gestureInput({ phase: "move", point: { x: 4, y: 6 }, timestamp: 20 });

		adapter.process(start);
		const result = adapter.process(move);

		expect(result.kind).toBe("single-move");
		expect(result.activePointerCount).toBe(1);
		expect(result.path).toEqual([start, move]);
		expect(result).not.toHaveProperty("requestedScale");
	});

	it("emits multi-start once then multi-move with center, delta, and absolute scale", () => {
		const adapter = createGestureAdapter({ initialScale: 2 });
		const firstStart = gestureInput({ pointerId: 1, point: { x: 0, y: 0 }, timestamp: 10 });
		const secondStart = gestureInput({ pointerId: 2, point: { x: 10, y: 0 }, timestamp: 20 });
		const firstMove = gestureInput({ pointerId: 1, phase: "move", point: { x: 0, y: 10 }, timestamp: 30 });
		const secondMove = gestureInput({ pointerId: 2, phase: "move", point: { x: 20, y: 10 }, timestamp: 40 });

		adapter.process(firstStart);
		const multiStart = adapter.process(secondStart);
		const firstMoveResult = adapter.process(firstMove);
		const secondMoveResult = adapter.process(secondMove);

		expect(multiStart.kind).toBe("multi-start");
		expect(multiStart.activePointerCount).toBe(2);
		expectPointClose(multiStart.center, { x: 5, y: 0 });
		expect(firstMoveResult.kind).toBe("multi-move");
		expectPointClose(firstMoveResult.center, { x: 5, y: 5 });
		expectPointClose(firstMoveResult.centerDelta, { x: 0, y: 5 });
		expect(firstMoveResult.requestedScale).toBeCloseTo(2 * Math.SQRT2, 3);
		expect(secondMoveResult.kind).toBe("multi-move");
		expectPointClose(secondMoveResult.center, { x: 10, y: 10 });
		expectPointClose(secondMoveResult.centerDelta, { x: 5, y: 5 });
		expect(secondMoveResult.requestedScale).toBeCloseTo(4, 3);
	});

	it("switches to multi-start when a second pointer arrives during a single gesture", () => {
		const adapter = createGestureAdapter({ initialScale: 1 });
		const firstStart = gestureInput({ pointerId: 1, timestamp: 10 });
		const singleMove = gestureInput({ pointerId: 1, phase: "move", point: { x: 8, y: 4 }, timestamp: 20 });
		const secondStart = gestureInput({ pointerId: 2, point: { x: 18, y: 4 }, timestamp: 30 });

		adapter.process(firstStart);
		expect(adapter.process(singleMove).kind).toBe("single-move");
		const result = adapter.process(secondStart);

		expect(result.kind).toBe("multi-start");
		expect(result.activePointerCount).toBe(2);
		expectPointClose(result.center, { x: 13, y: 4 });
	});

	it("does not resume drawing when a multi gesture drops back to one pointer", () => {
		const adapter = createGestureAdapter({ initialScale: 1 });
		const firstStart = gestureInput({ pointerId: 1, point: { x: 0, y: 0 }, timestamp: 10 });
		const secondStart = gestureInput({ pointerId: 2, point: { x: 10, y: 0 }, timestamp: 20 });
		const secondEnd = gestureInput({ pointerId: 2, phase: "end", point: { x: 10, y: 0 }, timestamp: 30 });
		const remainingMove = gestureInput({ pointerId: 1, phase: "move", point: { x: 5, y: 0 }, timestamp: 40 });

		adapter.process(firstStart);
		adapter.process(secondStart);
		const endResult = adapter.process(secondEnd);
		const remainingResult = adapter.process(remainingMove);

		expect(endResult.kind).toBe("single-end");
		expect(endResult.activePointerCount).toBe(1);
		expect(remainingResult.kind).toBe("idle");
		expect(remainingResult.activePointerCount).toBe(1);
		expect(remainingResult.path).toBeUndefined();
	});

	it("emits cancel, clears path state, and treats an unrelated pointer as fresh", () => {
		const adapter = createGestureAdapter({ initialScale: 1 });
		const start = gestureInput({ pointerId: 1, timestamp: 10 });
		const move = gestureInput({ pointerId: 1, phase: "move", point: { x: 3, y: 4 }, timestamp: 20 });
		const cancel = gestureInput({ pointerId: 1, phase: "cancel", point: { x: 3, y: 4 }, timestamp: 30 });
		const freshStart = gestureInput({ pointerId: 9, point: { x: 20, y: 20 }, timestamp: 40 });
		const freshMove = gestureInput({ pointerId: 9, phase: "move", point: { x: 21, y: 22 }, timestamp: 50 });

		adapter.process(start);
		adapter.process(move);
		const cancelResult = adapter.process(cancel);
		adapter.process(freshStart);
		const freshResult = adapter.process(freshMove);

		expect(cancelResult.kind).toBe("cancel");
		expect(cancelResult.activePointerCount).toBe(0);
		expect(cancelResult.path).toBeUndefined();
		expect(freshResult.kind).toBe("single-move");
		expect(freshResult.path).toEqual([freshStart, freshMove]);
	});

	it("reset returns the adapter to idle identity for the next fresh start", () => {
		const adapter = createGestureAdapter({ initialScale: 5 });
		adapter.process(gestureInput({ pointerId: 1, timestamp: 10 }));
		adapter.process(gestureInput({ pointerId: 1, phase: "move", point: { x: 6, y: 6 }, timestamp: 20 }));

		adapter.reset();
		const result = adapter.process(gestureInput({ pointerId: 7, point: { x: 30, y: 40 }, timestamp: 30 }));

		expect(result.kind).toBe("idle");
		expect(result.activePointerCount).toBe(1);
		expect(result.path).toBeUndefined();
		expect(result).not.toHaveProperty("requestedScale");
	});
});
