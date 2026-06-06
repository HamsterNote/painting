## 2026-06-06T14:45:50Z Task: 1

- Installed `@system-ui-js/multi-drag@0.4.0` has richer generated types than `packages/painting/src/multi-drag.d.ts`, including `Finger.pointerId`, `getFingers()`, and `getCurrentOperationType()`, but its exported `Drag` wrapper forces unlimited fingers by passing `maxFingerCount: -1` after caller options.
- Current `DrawingSurface` second-pointer behavior is owned by local `fingers.length` checks, not by `maxFingerCount: 1`. The old `Move` branch cleared the active stroke when `fingers.length > 1`, so a second pointer could cancel an in-progress one-pointer drawing.
- `yarn workspace @hamster-note/painting test -- DrawingSurface.test.tsx --runInBand` is currently not runnable because the package has no `test` script; root `yarn test DrawingSurface.test.tsx --runInBand` is the available Jest entry. Keep this command mismatch visible in evidence until the workspace script is added or the plan command is updated.
- Jest/jsdom in this repo does not define `PointerEvent`; controller tests should use local `Event` objects with `pointerId`/`pointerType` properties instead of assuming a global PointerEvent constructor.

## 2026-06-06T15:00:07Z Task: 2

- Current v1 public types remain inline in `packages/painting/src/components/DrawingSurface.tsx`; Task 2 added separate additive v2 model files under `packages/painting/src/model/` instead of changing renderer behavior.
- `normalizeDrawingValue` preserves extra drawing value fields by spreading the source value, then replacing `schemaVersion` and `strokes` with cloned v2 data. This keeps existing `selectedId`-style payloads from tests intact while avoiding input mutation.
- Frozen v1 and v2 migration fixtures now live under `packages/painting/src/__tests__/fixtures/v1/` and `packages/painting/src/__tests__/fixtures/v2/`, with nested `Object.freeze()` calls on values, strokes, point arrays, and points.

## 2026-06-06T15:08:41Z Task: 3

- `packages/painting/src/components/DrawingSurface.tsx` still converts browser coordinates to canvas-local points with `clientX/clientY - getBoundingClientRect().left/top`; Task 3 keeps that persisted canvas-local invariant in a standalone pure helper instead of changing renderer behavior.
- Viewport scale inputs need defensive normalization at helper boundaries because downstream gesture tasks may pass `0`, out-of-range values, `Infinity`, or `NaN`; transform helpers now clamp or default these without producing `NaN` coordinates.
- Pinch midpoint stability can be proven by converting the screen midpoint to canvas space before scale change, then solving `tx/ty` so that same canvas point maps back to the original screen midpoint.

## 2026-06-06T15:30:00Z Task: 4

- `DrawingSurface` root div already had `data-testid`, `data-tool`, and `data-enabled`. Added `data-stroke-count` (bound to `strokes.length` from `useCanvas`), `data-active-tool` (bound to `effectiveTool`), and static defaults `data-scale="1"`, `data-tx="0"`, `data-ty="0"` for future Task 13 viewport transform integration.
- `data-stroke-count` updates reactively when strokes are added or removed since `strokes` comes from the `useCanvas` hook which responds to controlled `value` or internal state changes.
- No existing `data-testid` attributes were removed or renamed in either `DrawingSurface.tsx` or `App.tsx`.
- All 12 existing Playwright tests pass unchanged after adding the new attributes — zero regressions.

## 2026-06-06T16:10:00Z Task: 6

- `DrawingSurface` committed strokes are still v1-shaped and now flow through `StrokeRenderer` unchanged; schema-version detection happens inside the renderer, so no migration is needed during rendering.
- Existing pen pressure behavior depends on per-segment `<line>` elements keyed by stroke id/index for committed strokes and `active-${index}` for previews; preserving this keeps the DrawingSurface pressure DOM assertions green.
- `pointsToSvgPath` remains the path source for non-pressure pen strokes, so smoothing-path output is preserved while rect/line/ellipse/polygon/bezier geometry lives in `packages/painting/src/render/StrokeRenderer.tsx`.
- Full Jest coverage after renderer extraction is 147 passing tests, including new render tests and unchanged DrawingSurface DOM assertions.

## 2026-06-07 Task: 5

- Polygon close clicks use a 10 canvas-pixel radius around the first vertex and commit only after at least 3 distinct vertices; an early close attempt with two vertices is kept as another vertex so the user can continue drawing instead of silently losing input.
- Continuous line completion is explicit: double-click (`POINTER_DOWN` with `detail: 2`) commits only when at least 2 distinct vertices exist; Escape, blur, tool change, pointer cancel, and reset all cancel without `completedStroke`.
- Bezier placement uses a fixed `[start, cp1, cp2, end]` tuple with `pendingPointIndex`; the fourth canvas-local click immediately emits the idle `completedStroke`, while partial Bezier previews remain active state only.
- The reducer intentionally stores `shiftHeld` in drawable in-progress phases, but leaves idle/pan/pinch untouched; future integration can apply snapping without adding extra global state.

## 2026-06-07 Task: 7

- `DrawingSurfaceProps` now accepts `dashArray`, `dashOffset`, `fillColor`, and `fillOpacity`; new active strokes snapshot those fields, while existing controlled strokes can still render with component-level fallback style props.
- `resolveStrokeStyle` is the single normalization point for rendering: open tools always resolve `fill: "none"`, closed tools omit stroke attrs when `strokeWidth === 0`, all-zero dash arrays such as `[0]` are solid, and `fillColor: "none"` disables fill opacity.
- Closed-shape rendering uses fallback stroke width `1` independently from open pen/line fallback width `2`, so pen/line keep the existing `< 1` clamp while rect/ellipse/polygon can be fill-only with `strokeWidth: 0`.
- Eraser hit-testing now supports filled closed-shape interiors for rect, ellipse, and polygon in addition to stroke-distance picking; fill-only rect deletion is covered through both `utils.pick` and `DrawingSurface` tests.

## Task 8 — Ellipse + Shift constraints

- **`renderV1Stroke` was the silent gap.** Adding `'ellipse'` to `DrawingTool` made v1 strokes with `tool='ellipse'` legal, but `renderV1Stroke` only handled rect/line/pen — preview rendered nothing while commit succeeded. v2 `renderV2Stroke` already had ellipse from Task 6, but the active stroke is plain v1 `DrawingStroke` (no `schemaVersion`). Lesson: any new tool requires renderer coverage in BOTH `renderV1Stroke` and `renderV2Stroke` until the active-stroke path migrates to v2.
- **multi-drag `DragInputEvent` does not expose `shiftKey`.** Confirmed by reading `packages/painting/src/multi-drag.d.ts`. Used `window.addEventListener('keydown'|'keyup'|'blur', ...)` inside the existing setup `useEffect` with a `shiftPressedRef`. The listeners are always active (not gated to active drag) which is fine because the ref is only consumed inside processPoints/AllEnd while drawing.
- **Two-track preview (raw + constrained).** `currentActiveStroke` stores the raw drag points; the constrained version is recomputed on each Move and on keydown/keyup. This lets releasing Shift mid-drag revert to unconstrained preview without re-deriving original points from a snapshot. Mutating `currentActiveStroke` in place would lose that property.
- **Shift constraint math.** `size = max(|dx|,|dy|)`, then `last = first + (sign(dx), sign(dy)) * size`. Sign preserves drag direction; size adopts the larger axis. Edge case: when `dx==0` use `signX=1` (and similarly for `dy`) — `Math.sign(0)===0` would collapse the shape. Guarded by `size===0` early return for zero-length drags.
- **Test gotcha — host rect offset.** `mockHostRect` puts the host at `left=10, top=20`. Tests must use client coords `(20, 40)` to get local `(10, 20)`. Same offset must be applied when computing expected SVG attribute values. For Shift+rect at local (10,20)→(110,70), constrained last is (110,120), bbox `{x:10, y:20, w:100, h:100}` — y stays at 20 because dy is positive (size grows downward, not centered on start).
- **Eraser already supports ellipse.** `pickStroke` in `utils.ts` was extended in Task 7's interior hit-test work; verified by passing eraser-on-filled-ellipse test without code changes.
