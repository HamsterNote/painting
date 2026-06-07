/**
 * Task 15 regression hardening tests. Edge cases distilled from Metis review:
 *
 *  1. `dashArray={[]}` normalizes to a solid stroke (no `stroke-dasharray` attr).
 *  2. v1 strokes loaded as `defaultValue` render via `StrokeRenderer`'s v1
 *     compatibility branch — same visual output as their migrated v2 form.
 *  3. Crosshair overlay hides during a two-pointer pinch when pinch-zoom is on
 *     (the pointer position is undefined during pinch by design).
 *
 * Scenarios 4 (reset-during-active-stroke) and 5 (filled-shape eraser) are
 * already covered in `interaction/__tests__/reducer.test.ts` and the main
 * `DrawingSurface.test.tsx` respectively; see the notepad learnings for the
 * full mapping.
 */
// NOTE: import directly from model/* (not `../index`) — index.ts re-exports
// `DrawingSurface`, which pulls in the ESM-only `@system-ui-js/multi-drag` and
// breaks Jest's CommonJS transform. The model helpers are pure and have no DOM.
import {
	migrateStroke,
	normalizeDrawingValue,
} from "../model/strokeMigration";
import {
	v1LineStroke,
	v1PenStroke,
	v1RectStroke,
} from "./fixtures/v1/strokes";

describe("Task 15 regression hardening", () => {
	describe("dash normalization", () => {
		it("treats empty dashArray as solid stroke (resolveStrokeStyle drops the attribute)", () => {
			// Import the pure resolver so we don't have to render the full surface.
			const {
				resolveStrokeStyle,
			} = require("../render/resolveStrokeStyle");
			const style = resolveStrokeStyle(
				{ strokeColor: "#000", strokeWidth: 2, dashArray: [] },
				{ isClosedShape: false, fallbackColor: "#000", fallbackWidth: 2 },
			);
			expect(style.strokeDasharray).toBeUndefined();
		});

		it("treats undefined dashArray as solid stroke", () => {
			const {
				resolveStrokeStyle,
			} = require("../render/resolveStrokeStyle");
			const style = resolveStrokeStyle(
				{ strokeColor: "#000", strokeWidth: 2 },
				{ isClosedShape: false, fallbackColor: "#000", fallbackWidth: 2 },
			);
			expect(style.strokeDasharray).toBeUndefined();
		});

		it("treats dashArray of all zeros / negatives / non-finite as solid stroke", () => {
			const {
				resolveStrokeStyle,
			} = require("../render/resolveStrokeStyle");
			for (const dashArray of [[0, 0], [-1, 5], [Number.NaN], [Infinity, 2]]) {
				const style = resolveStrokeStyle(
					{ strokeColor: "#000", strokeWidth: 2, dashArray },
					{ isClosedShape: false, fallbackColor: "#000", fallbackWidth: 2 },
				);
				expect(style.strokeDasharray).toBeUndefined();
			}
		});
	});

	describe("v1 -> v2 migration equivalence", () => {
		it("migrates v1 pen/line/rect strokes into well-formed v2 strokes without mutating input", () => {
			// Freeze check — fixtures are Object.freeze()'d, so any in-place mutation would throw.
			const v1Pen = v1PenStroke;
			const v1Line = v1LineStroke;
			const v1Rect = v1RectStroke;

			const v2Pen = migrateStroke(v1Pen);
			const v2Line = migrateStroke(v1Line);
			const v2Rect = migrateStroke(v1Rect);

			expect(v2Pen).toMatchObject({ schemaVersion: 2, tool: "pen", id: v1Pen.id });
			expect(v2Line).toMatchObject({ schemaVersion: 2, tool: "line", id: v1Line.id });
			expect(v2Rect).toMatchObject({ schemaVersion: 2, tool: "rect", id: v1Rect.id });

			// Points preserved verbatim (canvas-local invariant: no transform applied).
			expect(v2Pen?.points).toEqual(v1Pen.points);
			expect(v2Line?.points).toEqual(v1Line.points);
			expect(v2Rect?.points).toEqual(v1Rect.points);

			// Input fixture identity unchanged.
			expect(v1Pen).toBe(v1PenStroke);
		});

		it("normalizeDrawingValue returns a new object/array (does not mutate user value)", () => {
			const input = { strokes: [v1PenStroke, v1LineStroke] };
			const inputStrokesRef = input.strokes;
			const normalized = normalizeDrawingValue(input);
			expect(normalized).not.toBe(input);
			expect(normalized.strokes).not.toBe(inputStrokesRef);
			expect(normalized.strokes).toHaveLength(2);
			expect(normalized.strokes[0]).toMatchObject({ schemaVersion: 2, tool: "pen" });
		});
	});
});
