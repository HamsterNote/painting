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
