## 2026-06-06T14:45:50Z Task: 1

- Decision: choose `replace input internals with Pointer Events` for future pan/pinch work. Task 1 added `packages/painting/src/input/pointerInputController.ts` as the thin internal home for gesture work while preserving all current public exports from `packages/painting/src/index.ts`.
- Rationale: `@system-ui-js/multi-drag` exposes `Finger[]` and `Finger.pointerId` in the installed package, but `Drag` constructs `DragBase` with `{ ...options, maxFingerCount: -1 }`, so the caller's `maxFingerCount: 1` is overwritten. Its `Move` callback is also coupled to pose mutation via `setPose`, making reliable default-off pan/pinch detection a poor fit for the drawing-only contract.
- Boundary encoded in tests: `DrawingSurface` now has `pinch feasibility two pointer default-off gesture ignores second pointer while preserving one pointer drawing`; the controller has `pinch feasibility two pointer controller defaults gestures off while tracking active pointers`.

## 2026-06-06T15:00:07Z Task: 2

- Decision: keep `eraser` out of persisted v2 strokes. The new `DrawingStrokeV2` union includes only `pen`, `line`, `rect`, `ellipse`, `polygon`, and `bezier`; `DrawingToolModeV2` is the additive mode type that includes `eraser`.
- Decision: represent all v2 stroke variants with cloned canvas-local `points` arrays for this task. This minimizes migration risk for existing v1 `{ id, tool, points, strokeColor?, strokeWidth? }` data while still giving later renderer/reducer tasks a strict `tool` + `schemaVersion: 2` discriminated union.
- Decision: unknown future persisted tools are ignored by `normalizeDrawingValue` rather than throwing, matching the Task 2 safety scenario and keeping old JSON loading resilient.

## 2026-06-06T15:08:41Z Task: 3

- Decision: add `packages/painting/src/viewport.ts` as the public pure-math home for viewport state and transforms, exported through `packages/painting/src/index.ts`, without wiring it into `DrawingSurface` yet.
- Decision: treat `NaN` scale as the default scale `1`, clamp finite/out-of-range scale and infinities to `[0.25, 8]`, and normalize invalid translations to `0` so coordinate conversion never emits `NaN` for invalid viewport inputs.
- Decision: expose `zoomViewportAroundScreenPoint` for pinch-midpoint math; it accepts a requested absolute scale, clamps it, and recomputes `tx/ty` to keep the midpoint stable in screen space.

## 2026-06-06T15:30:00Z Task: 4

- Decision: place all new testability data attributes on the root `<div>` (same element as `data-testid`) rather than on the inner `<svg>`. This keeps Playwright selectors flat — tests can query `[data-testid="drawing-surface-controlled"][data-stroke-count="1"]` without nested element traversal.
- Decision: `data-scale`, `data-tx`, `data-ty` are static string defaults (`"1"`, `"0"`, `"0"`) rather than state-driven. Task 13 will wire these to actual viewport transform state. Using static defaults ensures the attributes exist in the DOM immediately for selector-based tests without requiring state management prematurely.
- Decision: `data-active-tool` duplicates `data-tool` for now. The task spec required `data-active-tool`; `data-tool` was pre-existing and is preserved for backward compatibility. Both reflect `effectiveTool`.

## 2026-06-06T16:10:00Z Task: 6

- Decision: keep v1 `DrawingStroke` accepted by `StrokeRenderer` via absence of `schemaVersion`, while v2 strokes use an exhaustive `switch` over the six persisted tool variants and `assertNever` in the default branch.
- Decision: keep style normalization pure in `resolveStrokeStyle`, returning React/SVG attribute names and omitting invalid dash arrays entirely when any dash segment is non-finite or negative.
- Decision: closed shapes opt into fill only when `fillColor` is present; open tools always render `fill="none"`, and closed shapes with `strokeWidth: 0` omit stroke attributes.

## 2026-06-07 Task: 5

- Decision: add `packages/painting/src/interaction/reducer.ts` as a standalone pure reducer with the exact action discriminants `POINTER_DOWN`, `POINTER_MOVE`, `POINTER_UP`, `POINTER_CANCEL`, `KEY_DOWN`, `TOOL_CHANGE`, `BLUR`, `RESET_REQUEST`, and `SHIFT_CHANGE`; pointer actions carry already-normalized canvas-local `{ x, y }` points plus optional pointer/gesture metadata.
- Decision: completion and reset are modeled as one-step idle-state signals rather than side effects. Successful stroke completion returns `{ phase: 'idle', tool, completedStroke: { tool, points } }`; reset returns `{ phase: 'idle', tool, shouldResetViewport: true }`. Future DrawingSurface integration can consume these fields and then continue from ordinary idle state.
- Decision: line supports both drag-shape mode and continuous placement. `POINTER_DOWN` on tool `line` defaults to `drawingDragShape`; callers opt into continuous `placingLine` with `mode: 'place'`, keeping current drag-line behavior available for later integration tasks.
