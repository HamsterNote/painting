## 2026-06-06T14:45:50Z Task: 1

- Decision: choose `replace input internals with Pointer Events` for future pan/pinch work. Task 1 added `packages/painting/src/input/pointerInputController.ts` as the thin internal home for gesture work while preserving all current public exports from `packages/painting/src/index.ts`.
- Rationale: `@system-ui-js/multi-drag` exposes `Finger[]` and `Finger.pointerId` in the installed package, but `Drag` constructs `DragBase` with `{ ...options, maxFingerCount: -1 }`, so the caller's `maxFingerCount: 1` is overwritten. Its `Move` callback is also coupled to pose mutation via `setPose`, making reliable default-off pan/pinch detection a poor fit for the drawing-only contract.
- Boundary encoded in tests: `DrawingSurface` now has `pinch feasibility two pointer default-off gesture ignores second pointer while preserving one pointer drawing`; the controller has `pinch feasibility two pointer controller defaults gestures off while tracking active pointers`.

## 2026-06-06T15:00:07Z Task: 2

- Decision: keep `eraser` out of persisted v2 strokes. The new `DrawingStrokeV2` union includes only `pen`, `line`, `rect`, `ellipse`, `polygon`, and `bezier`; `DrawingToolModeV2` is the additive mode type that includes `eraser`.
- Decision: represent all v2 stroke variants with cloned canvas-local `points` arrays for this task. This minimizes migration risk for existing v1 `{ id, tool, points, strokeColor?, strokeWidth? }` data while still giving later renderer/reducer tasks a strict `tool` + `schemaVersion: 2` discriminated union.
- Decision: unknown future persisted tools are ignored by `normalizeDrawingValue` rather than throwing, matching the Task 2 safety scenario and keeping old JSON loading resilient.
