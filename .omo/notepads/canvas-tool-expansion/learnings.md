## 2026-06-06T14:45:50Z Task: 1

- Installed `@system-ui-js/multi-drag@0.4.0` has richer generated types than `packages/painting/src/multi-drag.d.ts`, including `Finger.pointerId`, `getFingers()`, and `getCurrentOperationType()`, but its exported `Drag` wrapper forces unlimited fingers by passing `maxFingerCount: -1` after caller options.
- Current `DrawingSurface` second-pointer behavior is owned by local `fingers.length` checks, not by `maxFingerCount: 1`. The old `Move` branch cleared the active stroke when `fingers.length > 1`, so a second pointer could cancel an in-progress one-pointer drawing.
- `yarn workspace @hamster-note/painting test -- DrawingSurface.test.tsx --runInBand` is currently not runnable because the package has no `test` script; root `yarn test DrawingSurface.test.tsx --runInBand` is the available Jest entry. Keep this command mismatch visible in evidence until the workspace script is added or the plan command is updated.
- Jest/jsdom in this repo does not define `PointerEvent`; controller tests should use local `Event` objects with `pointerId`/`pointerType` properties instead of assuming a global PointerEvent constructor.

## 2026-06-06T15:00:07Z Task: 2

- Current v1 public types remain inline in `packages/painting/src/components/DrawingSurface.tsx`; Task 2 added separate additive v2 model files under `packages/painting/src/model/` instead of changing renderer behavior.
- `normalizeDrawingValue` preserves extra drawing value fields by spreading the source value, then replacing `schemaVersion` and `strokes` with cloned v2 data. This keeps existing `selectedId`-style payloads from tests intact while avoiding input mutation.
- Frozen v1 and v2 migration fixtures now live under `packages/painting/src/__tests__/fixtures/v1/` and `packages/painting/src/__tests__/fixtures/v2/`, with nested `Object.freeze()` calls on values, strokes, point arrays, and points.

## 2026-06-06T15:30:00Z Task: 4

- `DrawingSurface` root div already had `data-testid`, `data-tool`, and `data-enabled`. Added `data-stroke-count` (bound to `strokes.length` from `useCanvas`), `data-active-tool` (bound to `effectiveTool`), and static defaults `data-scale="1"`, `data-tx="0"`, `data-ty="0"` for future Task 13 viewport transform integration.
- `data-stroke-count` updates reactively when strokes are added or removed since `strokes` comes from the `useCanvas` hook which responds to controlled `value` or internal state changes.
- No existing `data-testid` attributes were removed or renamed in either `DrawingSurface.tsx` or `App.tsx`.
- All 12 existing Playwright tests pass unchanged after adding the new attributes — zero regressions.
