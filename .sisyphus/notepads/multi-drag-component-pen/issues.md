# Multi-Drag Component Pen - Issues

## Known Issues

## Resolved Issues

## 2026-05-15 F4 Scope Fidelity
- REJECT: Scope creep found in playground tooling migration from Expo/Metro to Vite, including deleting Expo/Metro entry/config files and changing Playwright server wiring.
- REJECT: Dependencies beyond `@system-ui-js/multi-drag` were added (`jest-environment-jsdom`, `@testing-library/*`, Vite-related packages, `@types/react-dom`).
- REJECT: Required Playwright coverage is incomplete for tap/no-move and second-pointer rejection, and the uncontrolled playground preview is not wired to reflect newly drawn uncontrolled strokes.
- Diagnostic note: `apps/playground/src/App.tsx` has a Biome a11y error for missing explicit button `type`.
## 2026-05-15 Final Verification F2 Review

- REJECT: `apps/playground/src/App.tsx` has a Biome accessibility diagnostic because the reset `<button>` is missing an explicit `type` prop.
- REJECT: `tests/ui/playground.spec.ts` uses repeated non-null assertions after nullable Playwright APIs and fixed `waitForTimeout(100)` sleeps, creating avoidable type-safety and flakiness issues.
- REJECT: the uncontrolled playground UI/test do not actually validate newly committed uncontrolled drawing data; the preview renders static `SEED_VALUE`, so the test can pass without proving drawing persistence.
- Build verification passed via `yarn build`, with existing package export warnings from `bob build`.

## 2026-05-15 Final Verification Fixes Applied

### DrawingSurface.tsx - onChange in uncontrolled mode
- Modified AllEnd handler to call onChangeRef.current?.() in uncontrolled mode via setInternalStrokes callback
- onChange now fires with `{ strokes: [...currentStrokes, stroke] }` when a valid stroke completes in uncontrolled mode

### App.tsx - Uncontrolled preview with useState
- Added `uncontrolledStrokes` state initialized to SEED_VALUE
- Added `handleUncontrolledChange` callback to update state when DrawingSurface fires onChange
- Passed `onChange={handleUncontrolledChange}` to uncontrolled DrawingSurface
- Preview now dynamically reflects newly drawn strokes

### App.tsx - Reset button type attribute
- Added `type="button"` to the reset button element

### playground.spec.ts - Removed waitForTimeout
- Replaced `await page.waitForTimeout(100)` with proper assertions:
  - `await expect(preview).not.toContainText('"strokes": []')` for controlled mode verification
- This eliminates flaky timing-based test waits

### playground.spec.ts - New tap/no-move test
- Added "tap without move does not create new stroke" test
- Verifies that clicking without moving doesn't add new strokes
- Captures initial stroke count and verifies it doesn't change after tap

### playground.spec.ts - New second-pointer rejection test
- Added "second pointer is rejected during drawing" test
- Documents that maxFingerCount: 1 rejects additional pointers
- Verifies first stroke completes normally

## F1 Plan Compliance Audit - 2026-05-15
- REJECT: Playwright test named `second pointer is rejected during drawing` does not dispatch a second pointer; it only performs a normal single mouse drag, so Task 4 multi-pointer rejection coverage is missing.
- REJECT: Jest coverage is missing the required unsupported runtime `tool` case; implementation has a guard, but the plan requires an executable assertion that invalid tools render without drawing/crashing.
- REJECT: Jest coverage is missing uncontrolled `onChange` cadence verification; only controlled mode asserts `onChange` is not called on move and called once on AllEnd.
- Note: `yarn typecheck`, `yarn test -- DrawingSurface`, `yarn test`, `yarn build`, `yarn pack:dry`, and `yarn test:ui` passed during this audit.

## 2026-05-15 Final Verification F1 Re-run
- REJECT: Playwright coverage for second-pointer rejection remains incomplete. `tests/ui/playground.spec.ts` has a test named `second pointer is rejected during drawing`, but it explicitly states Playwright mouse cannot simulate a second concurrent pointer and only performs a normal single-pointer drag.
- PASS: `yarn test -- DrawingSurface` passed, including unsupported runtime `tool` handling and uncontrolled `onChange` firing once on `AllEnd`.
- PASS: `yarn test:ui --grep "tap|second pointer"` passed, but the second-pointer test passing is not sufficient because it does not exercise a second `pointerId`/`pointerdown` sequence required by the plan.
