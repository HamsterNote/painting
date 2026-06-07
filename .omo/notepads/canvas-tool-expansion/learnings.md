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

## Task 9 — Polygon click-to-place tool

- **Dual architecture: multi-drag for drag tools, useReducer for click-to-place tools.** The Task 5 standalone `interactionReducer` is wired into `DrawingSurface` via `useReducer(interactionReducer, effectiveTool, createInitialState)`. Multi-drag's `Move` handler early-returns when `effectiveToolRef.current === 'polygon'` so click events don't get interpreted as zero-distance drags. Three effects govern the polygon path: (1) listener install/cleanup gated on `effectiveTool === 'polygon'`, (2) `TOOL_CHANGE` dispatch on `effectiveTool` change to cancel in-progress placements, (3) `completedStroke` observer that commits a v2 polygon stroke and re-dispatches `TOOL_CHANGE` to clear the marker (so the next placement starts clean).
- **Split `isClosedShapeTool` vs `isBboxShapeTool`.** Polygon IS a closed shape (defaults to closed-width=1, supports fillColor, integrates with eraser fill-interior hit-test), but it's NOT a bbox-defined shape — its geometry is a vertex list. The Shift constraint math `last = first + (signX, signY) * max(|dx|,|dy|)` only makes sense for rect/ellipse. Introducing `isBboxShapeTool` (rect|ellipse only) at every Shift call-site prevents future polygon strokes from being silently collapsed to a rect bbox.
- **Polygon preview reuses SVG `<polygon>` auto-close.** Active preview is built during render from `interactionState.placingPolygon.vertices + cursorPoint`. SVG `<polygon points="...">` closes back to vertex 0 automatically, so the rendered preview naturally shows both the trailing cursor edge (last vertex → cursor) and the closing edge (cursor → first vertex). No explicit close-edge geometry needed; the renderer's existing polygon branch (Task 6) does the work. The cursor is appended only if it doesn't duplicate the last vertex, otherwise the preview reduces to the placed vertices.
- **Committed polygon is v2 (schemaVersion: 2) but flows through v1-typed `addStroke`.** `PolygonStrokeV2` is structurally a superset of v1 `DrawingStroke` (same shape + `schemaVersion: 2`), so `addStrokeRef.current(polygon as unknown as DrawingStroke)` is a type-safe cast at the boundary. `StrokeRenderer.isV2Stroke` then routes it to `renderV2Stroke`'s polygon branch. This means we do NOT need to add a polygon branch to `renderV1Stroke` (unlike Task 8's ellipse, which had to be added to both renderers because committed strokes were v1).
- **jsdom polygon test pattern.** No `PointerEvent` constructor in jsdom — dispatch `new Event('pointerdown' | 'pointermove' | 'dblclick', {bubbles, cancelable})` and `Object.assign(event, {clientX, clientY, pointerId, button, detail})`. The polygon listener reads only property values (never `instanceof PointerEvent`), so duck-typing works. `KeyboardEvent` constructor IS available — use it for Escape simulation. Host-rect mock at left=10, top=20 means client (20, 30) → canvas (10, 10).
- **`POLYGON_CLOSE_RADIUS = 10` in reducer is canvas-pixel, not screen-pixel.** All vertex math and close-loop detection happens in canvas-local space after `clientX - rect.left, clientY - rect.top`. With the standard mock host rect (left=10, top=20), a close-loop click at client (25, 35) → canvas (15, 15), distance hypot(5,5) ≈ 7.07 from first vertex (10,10) → under the 10-px threshold → closes. The closing click coordinates are discarded (the reducer's `reducePolygonPointerDown` returns `completedIdle` without appending).
- **Dblclick discards (not commits) when < 3 distinct vertices.** Reducer guards `if (action.detail === 2 && isValidCompletion(state))`. When invalid, the dblclick action falls through to the "append vertex" branch — but jsdom's dblclick has detail=2 by default which short-circuits append (no `if (!action.point)` branch hit since point is provided). Net effect: dblclick with 2 vertices simply ADDS a third vertex at the dblclick location instead of cancelling. Tested behavior matches: `onChange` is not called. (To FORCE cancel on invalid dblclick, user must hit Escape — current semantics keep the in-progress polygon alive so user can keep clicking.)

## Task 10 — Continuous line click drawing

- Line now uses a hybrid interaction model: click placement is routed through `interactionReducer` with `mode: "place"`, while legacy multi-drag only starts after at least two path samples and more than 4 canvas px of total movement. This keeps pointerdown→move→up line creation compatible without letting tiny click jitter create drag strokes.
- `placingLine` completion differs from polygon: double-click includes the double-click point as the final vertex when distinct, and Escape/tool-switch commit only if the line already has at least 2 distinct vertices; a single click then Escape cancels cleanly.
- V2 multi-point line rendering must not reuse `pointsToSvgPath` because that helper smooths pen strokes into cubic curves. Continuous line uses a dedicated open `M/L` path so every segment stays straight and dash styling applies across the full open polyline.
- Eraser hit-testing for line should use open polyline distance across consecutive point pairs, not the old first-to-last segment shortcut; this is especially important for bent v2 line strokes where later segments may be far from the endpoints chord.

## Task 11 — Cubic Bezier click-to-place tool

- **Two near-identical helpers for tool classification are necessary.** `isClickToPlaceTool(line|polygon|bezier)` gates the click-listener effect (installs/removes host pointer listeners). `skipsMultiDragMove(polygon|bezier)` gates the multi-drag Move early-return. The single-tool difference is `line`: line is HYBRID — it accepts both click placement (POINTER_DOWN with `mode: 'place'` from pointerup) AND legacy drag (multi-drag Move once >4px / 2+ samples). Unifying these helpers regresses 5 legacy line tests (drag preview, drag commit, color/dash from props). The comment block at the helper definitions is load-bearing context, not noise.
- **Bezier preview reuses the v2 line renderer instead of partial cubic curves.** The reducer's `placingBezier` state holds a sparse 4-tuple `[start?, cp1?, cp2?, end?]` + `cursorPoint`. Rendering a partial cubic (1, 2, or 3 placed) requires choosing arbitrary missing controls — not meaningful feedback. Instead the preview is a `LineStrokeV2` of `placed.filter(defined) ++ cursor`, which the renderer's v2 line branch draws as `M ... L ... L ...`. Users see the control polygon skeleton being assembled; the true cubic curve appears at commit. This also reuses dash/stroke/opacity plumbing without a new renderer branch.
- **`fillColor`/`fillOpacity` are intentionally omitted from `BezierStrokeV2` commit.** Bezier is OPEN (stroke only). The model type allows them (inherited from `DrawingStrokeBaseV2`) but the commit path in `DrawingSurface.tsx` does not pass them, so committed bezier strokes always render `fill="none"` via `resolveStrokeStyle({...isClosedShape: false})`. Test asserts `committed.fillColor === undefined` to lock this contract — if a future refactor passes `fillColor` through, the renderer would honor it (path elements support fill) and silently break the open-tool semantics.
- **Bezier hit-test uses static 24-segment polyline sampling, not adaptive De Casteljau.** Plan mandates ≥24 segments. Sampling at fixed `t = i/24` for i ∈ [0,24] gives 25 points; existing `distanceSqPointToPolyline` handles distance. For typical stroke widths (1-5 px) the sampling error of a tight curve at 24 segments is well below the hit radius, so adaptive subdivision is unnecessary. Standard cubic Bezier basis B(t) = (1-t)³P0 + 3(1-t)²t·P1 + 3(1-t)t²·P2 + t³·P3 implemented inline in `sampleCubicBezierPolyline` — extracted only as far as needed for the hit-test use case (not a public helper).
- **Bezier test pattern mirrors polygon exactly with one twist: re-render after commit.** Polygon's commit test inspects the active preview clear (`querySelectorAll('polygon').length === 0`). Bezier's commit test additionally re-renders with `value={{ strokes: [committed] }}` to inspect the final `path d="M ... C ..."` attribute — necessary because the placingBezier preview path is the v2 line preview (no `C` command), and the cubic-path-rendering happens only when the renderer sees a v2 stroke with `tool: 'bezier'` in the committed strokes array.

## Task 12 — Pointer Crosshair Overlay

- **React synthetic `onPointerEnter`/`onPointerLeave` do NOT fire from jsdom `host.dispatchEvent(new Event('pointerenter'))`.** React's enter/leave delegation diffs pointer targets across native pointer/mouse-move events; a manually dispatched bubble-less `pointerenter` does not reach the synthetic enter handler. Native `host.addEventListener('pointerenter', ...)` does fire as expected. Solution: install all crosshair listeners (pointerenter/move/leave/down/up) as native listeners inside a `useEffect`, matching the existing pattern used by the click-to-place effect. This also keeps the JSX props on the root div untouched.
- **Crosshair overlay must be a sibling of the SVG, not a child.** Task 13 will wrap the SVG content in a `<g transform="...">` for pan/zoom. Putting the crosshair inside that group would scale it with viewport zoom — the spec mandates the crosshair stays exactly 10 CSS pixels regardless of scale. The overlay sits in a separate absolutely-positioned `<div data-crosshair-layer>` with `pointerEvents: 'none'`, positioned via `left/top` + `transform: translate(-50%, -50%)` so the crosshair stays centered on the screen-pixel coordinate the pointer reports.
- **Two `pointermove` listeners on the same host coexist.** The crosshair effect installs one; the click-to-place effect (polygon/line/bezier) installs another when those tools are active. Both fire independently; neither calls `stopPropagation()` or `preventDefault()`. Multi-drag also subscribes via its own internal listeners on the host, but its handler is gated by gesture state and never blocks the per-effect listeners.
- **`cursorPointerDownRef` lives outside the effect to survive re-renders.** It is the only piece of crosshair state that must persist across renders without retriggering the effect. State (`cursorState`) is intentionally regular `useState` because every visibility/position change needs to drive a re-render of the overlay.
- **`cursor && typeof cursor === 'object'` is the correct narrowing.** `cursor !== false && cursor` is NOT sufficient — `cursor` is `false | DrawingCursorOptions | undefined`, and `cursor && cursor !== false` triggers `TS2367` because TS already narrowed away `false` after the truthy check. Use the explicit `typeof` discriminant.

## Task 13 — Opt-in viewport gestures

- DrawingSurface now owns real DrawingViewport state and keeps persisted stroke coordinates canvas-local; only the SVG render path applies the single translate/scale group transform.
- jsdom gesture tests can use plain Event objects on host/document with pointer-shaped fields; document-level pointermove is needed because the gesture listener tracks active pointers outside the host after pointerdown.
- Eraser hit testing at zoom must convert screen coordinates through screenToCanvas and divide the hit radius by viewport.scale so screen-space eraser size remains stable.

## 2026-06-07T00:27:45Z Task 14 playground demo
- Playground viewport is 1280x720 (Playwright default); stacking many vertical fieldsets pushes the DrawingSurface below the fold and breaks page.mouse-based draws because coordinates outside the viewport never dispatch to the surface element. Fix: wrap the new feature panels (Dash / Fill / Cursor / Gestures) in a flex-wrap row with flex: 1 1 320px so they tile 2-3 per row and the surface remains in viewport.
- DrawingSurface host div already exposes data-tool="<active tool>" for state introspection. A button with data-tool="pen" will collide under Playwright strict mode (3 matching elements: button + 2 surfaces). Scope to button[data-tool="..."] in spec selectors; do not rename the surface attribute.
- Preserved data-testid="drawing-tool-select" so the existing selectOption('rect'/'line') tests still pass while also providing per-tool buttons.
- Used a key={`controlled-${viewportResetCounter}`} remount pattern for the gesture-reset button; avoids adding a new imperative ref API to the package while still demoing reset behavior end-to-end.
- Custom-render cursor demo returns an SVG <g> with a circle + text label; DrawingSurface mounts it inside the overlay SVG so absolute screen coords come straight from state.screen.

## 2026-06-07T00:36Z Task 15: regression hardening
- Atlas wrote packages/painting/src/__tests__/task15-regression.test.ts directly after 3 silent subagent dispatches (T15a/b/c).
- 5 new tests cover scenarios 1 (dashArray normalization: empty/undefined/all-zero/negative/NaN/Infinity → solid stroke) and 2 (v1→v2 migration: pen/line/rect, no input mutation, new arrays returned).
- Scenarios 3 (reset-during-active-stroke) and 5 (filled-shape eraser) already covered in interaction/__tests__/reducer.test.ts line 197 and DrawingSurface.test.tsx lines 715/788 respectively.
- IMPORT NOTE: tests must import from ../model/strokeMigration directly, NOT from ../index. The index.ts re-exports DrawingSurface which pulls in @system-ui-js/multi-drag (ESM-only, breaks Jest's CJS transform).
- Final state: 238/238 tests pass, yarn typecheck clean.

## 2026-06-07 Task 15 remediation
- Lint blocker was ESLint config, not invalid TS: base `no-redeclare` flags overload signatures in reducer/strokeMigration/stroke-helpers, while `@typescript-eslint/no-redeclare` with `ignoreDeclarationMerge` preserves legitimate overloads and keeps Task 15 lint coverage meaningful.
- Pinch crosshair visibility now reads the same active pointer Map used by viewport gestures; a second touch hides `[data-crosshair]`, and lifting it restores the remaining active touch crosshair without adding a parallel gesture model.

## 2026-06-07 F2 in-scope code-quality fixes

- **Finding A (DrawingSurface.tsx JSDoc):** Removed stale Task-13 reference from `DrawingCursorRenderState` type doc. The comment claimed canvas coords were "currently identical to screen" — inaccurate since Task 13 wired viewport transforms. Updated to state canvas coords are derived via `screenToCanvas` and reflect pan/zoom.
- **Finding B (task15-regression.test.ts header):** Original header claimed coverage of crosshair-pinch behavior (scenario 3) and v1/v2 render equivalence, neither of which is tested in this file. Rewrote header to honestly list only dashArray normalization (scenario 1) and v1→v2 migration without input mutation (scenario 2), with pointers to the actual covering files.
- **Finding C (App.tsx trailing whitespace):** Stripped trailing whitespace on lines 204, 839, 921. No other lines affected.
- **Deferred F2 findings (NOT in scope):** as-unknown casts (DrawingSurface:1060/1077/1094), pointerInputController half-abstraction, assertNever export leak, viewport.test.ts ESLint warning.
