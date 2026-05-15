# HamsterPainting GLView Project Learnings

## Project Structure
- Monorepo with `packages/painting` (library) and `apps/playground` (Expo app)
- Current `DrawingSurface` is just a placeholder rendering `<View><Text>DrawingSurface placeholder</Text></View>`
- Package exports named `DrawingSurface` only, from `packages/painting/src/index.ts`
- Jest mocking style: uses `jest.mockRN.js` for React Native mocks
- Playwright tests run against Expo Web at localhost:8081

## Current Exports
- `packages/painting/src/index.ts` exports `{ DrawingSurface }` and `DrawingSurfaceProps`
- `apps/playground/App.tsx` imports `{ DrawingSurface }` from `@hamster-note/painting`

## Testing Setup
- Jest: `jest.config.js` with React Native mocks
- Playwright: `playwright.config.ts` with Expo web server on port 8081
- UI test: `tests/ui/playground.spec.ts` checks "Playground Ready" text and surface visibility

## Key Decisions
- Use `@system-ui-js/multi-drag-core` (NOT the DOM `multi-drag` package)
- Use `expo-gl` with `onContextCreate`, RAF loop, and `gl.endFrameEXP()`
- Preserve backward compatibility: named `DrawingSurface` export stays
- Add default export `HamsterPainting` as the new primary API

## Task 4 Renderer Notes - 2026-05-14
- `gl.useProgram(...)` can be flagged by hook lint when called directly; bind it to a non-`use*` local before conditional render paths.
- Jest can test the RAF loop deterministically by queueing RAF callbacks and manually invoking one frame.
- Expo GL frame presentation is covered by asserting optional `endFrameEXP()` after drawable frames only.

## Task 5 Component Notes - 2026-05-14
- `GestureController` in installed `@system-ui-js/multi-drag-core` requires constructor options and a compute context in `process`, so the component provides drag-only features plus a measured pose.
- Component tests should select the mocked host `View` by type + `testID`; `findByProps({ testID })` can match the composite component instead of the responder host.
- React 19 `react-test-renderer` emits a deprecation warning during Jest runs, but the focused component suite still passes.

## 2026-05-14 Task 7 Playwright drag/tap
- Playwright interaction coverage now derives mouse coordinates from `drawing-surface-smoke` bounds and asserts stroke/status test IDs.
- Expo web can reuse stale port 8081 servers locally; stop stale servers before validating changed playground UI.
- The playground surface wrapper must let the painting component stretch to fill the 300x300 hit area for real mouse drags.

## 2026-05-14 Final QA Gate
- PASS: yarn lint, yarn typecheck, yarn test (25/25), yarn test:ui (3/3), yarn build, and yarn pack:dry all exited 0.
- Verified built package entrypoints expose default and named exports in lib/module/index.js, lib/commonjs/index.js, and lib/typescript/index.d.ts.

## 2026-05-14 Plan Compliance Audit
- Verdict: APPROVE. Tasks 1-8 match the hamster-painting-glview plan after source/evidence inspection.
- Verification run: yarn lint, yarn typecheck, yarn test, yarn test:ui, yarn build, and yarn pack:dry all exited 0.
- Non-blocking warnings observed: Expo package compatibility warnings during UI tests, React test renderer deprecation logs, Bob export-shape warnings, and npm env config warnings during pack dry-run.
