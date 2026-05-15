# HamsterPainting GLView Drawing

## TL;DR
> **Summary**: Replace the placeholder `DrawingSurface` with a real GL-backed painting component, export it as default `HamsterPainting`, and keep `DrawingSurface` as a named compatibility alias. Use `expo-gl` for rendering and `@system-ui-js/multi-drag-core` for gesture computation through a dedicated React Native input-normalization layer.
> **Deliverables**:
> - default export `HamsterPainting` plus named alias `DrawingSurface`
> - `expo-gl` integration with deterministic RAF + cleanup lifecycle
> - `@system-ui-js/multi-drag-core` integration through RN event normalization
> - Jest + Playwright coverage proving drag-to-draw behavior and compatibility
> **Effort**: Medium
> **Parallel**: YES - 2 waves
> **Critical Path**: 1 → 3 → 5 → 8 → Final Verification

## Context
### Original Request
- Install `@system-ui-js/multi-drag` and `expo-gl`.
- Expose a React Native component named `HamsterPainting` as the default export.
- Use `GLView` from `expo-gl`.
- Draw inside the `GLView` via mouse dragging.

### Interview Summary
- The implementation target is `packages/painting`.
- The current library only exports named `DrawingSurface` from `packages/painting/src/index.ts:1`.
- The new API should export default `HamsterPainting` and preserve named `DrawingSurface` as a compatibility alias.
- Validation should follow the existing repo flow with tests added after implementation.
- The drag/event layer should be delegated to the `multi-drag` library family instead of hand-rolled gesture logic.
- The exact requested package `@system-ui-js/multi-drag` is DOM-oriented, so the RN plan targets `@system-ui-js/multi-drag-core` for real gesture computation.

### Metis Review (gaps addressed)
- Compatibility is defined at the export and prop-contract level, not only by symbol presence.
- The plan adds a single RN input-normalization boundary instead of scattering event mapping across rendering code.
- The plan requires a deterministic observable drawing signal for Playwright instead of relying on surface visibility alone.
- The plan hard-blocks advanced painting scope such as undo/redo, pressure, persistence, or multitouch tooling beyond what `multi-drag-core` already computes.
- The plan requires explicit GL cleanup to prevent `requestAnimationFrame` leaks and post-unmount rendering.

## Work Objectives
### Core Objective
- Deliver a minimal but real painting surface that turns drag input into visible strokes inside `GLView`, while preserving current named-import compatibility and fitting the existing package + CI structure.

### Deliverables
- `packages/painting/src/index.ts` exports default `HamsterPainting` and named `DrawingSurface`.
- `packages/painting/src/components/DrawingSurface.tsx` hosts the real implementation or delegates to the new implementation module.
- A dedicated gesture adapter normalizes React Native events into `NormalizedPointerInput` for `GestureController` from `@system-ui-js/multi-drag-core`.
- A dedicated GL renderer module owns context init, stroke redraw, frame presentation, and cleanup.
- Unit tests verify export compatibility, input normalization, renderer lifecycle, and component behavior.
- Playground integration exposes an observable stroke/status signal for Playwright drag assertions.

### Definition of Done (verifiable conditions with commands)
- `yarn lint` exits `0` from repo root.
- `yarn typecheck` exits `0` from repo root.
- `yarn test` exits `0` from repo root.
- `yarn test:ui` exits `0` from repo root.
- `yarn build` exits `0` from repo root.
- `yarn pack:dry` exits `0` from repo root.
- Default import and named import both resolve to the same component implementation in Jest.
- A Playwright drag on the playground changes a deterministic drawing signal from its initial value.

### Must Have
- Use `expo-gl` `GLView` lifecycle via `onContextCreate`, `requestAnimationFrame`, and `gl.endFrameEXP()`.
- Use `@system-ui-js/multi-drag-core`, not the DOM wrapper package, for gesture computation.
- Keep the public props backward-compatible with the current `testID?: string` contract.
- Add any new observability as optional props or internal playground wiring without breaking existing consumers.
- Centralize pointer-phase mapping and coordinate normalization in one adapter module.
- Cancel RAF and reset gesture controller state on unmount or cancellation paths.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- Must NOT import or instantiate `@system-ui-js/multi-drag` DOM classes in RN code.
- Must NOT add undo/redo, persistence, color palettes, pressure sensitivity, or brush customization in this change.
- Must NOT rely on manual visual inspection as the primary verification signal.
- Must NOT break existing named `DrawingSurface` imports.
- Must NOT leave GL rendering loops alive after unmount.
- Must NOT spread event normalization logic across component, playground, and tests.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: tests-after using existing Jest + Playwright setup.
- QA policy: every implementation task includes executable happy-path and failure/edge scenarios.
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`.
- Deterministic observability: the implementation must expose at least one machine-verifiable signal such as stroke count or drawing state, and the playground must render that signal in DOM-visible text for Playwright.

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: foundation + contract tasks (`1`, `2`, `3`, `4`, `5`)
Wave 2: integration + verification tasks (`6`, `7`, `8`)

### Dependency Matrix (full, all tasks)
- `1` blocks `5`, `6`, `8`
- `2` blocks `5`, `7`
- `3` blocks `5`, `7`
- `4` blocks `5`, `7`
- `5` blocks `6`, `7`, `8`
- `6` blocks `7`, `8`
- `7` blocks `8`
- `8` depends on `1` through `7`

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 5 tasks → `quick`, `unspecified-low`, `unspecified-high`
- Wave 2 → 3 tasks → `unspecified-low`, `visual-engineering`, `unspecified-high`

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Update dependency and export contracts

  **What to do**: Add `@system-ui-js/multi-drag-core` to `packages/painting/package.json` as a runtime dependency. Add `expo-gl` to `packages/painting/package.json` as a peer dependency plus local dev dependency for typing/build, and add `expo-gl` to `apps/playground/package.json` so the Expo playground runtime can resolve `GLView`. Update `packages/painting/src/index.ts` so the package default-exports `HamsterPainting` while keeping `DrawingSurface` as a named export alias pointing to the same implementation. Keep the existing `DrawingSurfaceProps` name exported for compatibility, even if it aliases a new `HamsterPaintingProps` type internally.
  **Must NOT do**: Do not add the DOM package `@system-ui-js/multi-drag`. Do not remove the existing named `DrawingSurface` export. Do not change the workspace root scripts.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: manifest and entrypoint reshaping is scoped and mechanical.
  - Skills: `[]` - no extra skill required.
  - Omitted: `review-work` - too early; use only after implementation is complete.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: `5`, `6`, `8` | Blocked By: none

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `packages/painting/src/index.ts:1` - current public surface uses named exports only.
  - Pattern: `packages/painting/package.json:21` - current package scripts and dependency buckets.
  - Pattern: `package.json:11` - root verification commands that must remain valid.
  - Pattern: `apps/playground/App.tsx:1` - current consumer import site that will need default-import migration.
  - External: `https://github.com/SystemUI-js/multi-drag` - upstream monorepo showing `multi-drag-core` as the non-DOM package.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `packages/painting/package.json` declares `@system-ui-js/multi-drag-core` and `expo-gl` in the correct dependency buckets.
  - [ ] `packages/painting/src/index.ts` exposes both `default` and named `DrawingSurface`, and both resolve to the same implementation target.
  - [ ] `yarn typecheck` exits `0` after the manifest and export updates.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Export surface compiles after dependency changes
    Tool: Bash
    Steps: Run `yarn typecheck` from repo root.
    Expected: Exit code `0`; no unresolved module or export-map errors.
    Evidence: .sisyphus/evidence/task-1-dependency-export-contracts.log

  Scenario: Pack/build contract still resolves
    Tool: Bash
    Steps: Run `yarn build && yarn pack:dry` from repo root.
    Expected: Exit code `0`; build artifacts and npm pack dry-run succeed with the updated export surface.
    Evidence: .sisyphus/evidence/task-1-dependency-export-contracts-pack.log
  ```

  **Commit**: NO | Message: `feat(painting): add gl and gesture dependencies` | Files: `packages/painting/package.json`, `packages/painting/src/index.ts`, `apps/playground/package.json`

- [x] 2. Add RN pointer normalization adapter

  **What to do**: Create a dedicated adapter module such as `packages/painting/src/gestures/normalizePointerInput.ts` that converts React Native responder events into `NormalizedPointerInput` for `@system-ui-js/multi-drag-core`. Standardize these mappings: `onResponderGrant` → `PointerPhase.Start`, `onResponderMove` → `PointerPhase.Move`, `onResponderRelease` → `PointerPhase.End`, `onResponderTerminate` → `PointerPhase.Cancel`. Use `nativeEvent.locationX/locationY` as the primary coordinates, fall back to layout-relative math only if a target runtime omits them, use `nativeEvent.identifier ?? 0` for `pointerId`, and set `pointerType` from `nativeEvent.pointerType` when available, otherwise `'mouse'` on web and `'touch'` elsewhere.
  **Must NOT do**: Do not normalize events inline inside the component. Do not derive drawing coordinates from `pageX/pageY` when `locationX/locationY` is available. Do not create multiple normalization helpers for different call sites.

  **Recommended Agent Profile**:
  - Category: `unspecified-low` - Reason: logic is small but benefits from careful type-level coverage.
  - Skills: `[]` - no extra skill required.
  - Omitted: `visual-engineering` - not a UI/styling task.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: `5`, `7` | Blocked By: none

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `jest.mockRN.js:1` - existing RN mocking style that tests should extend instead of replacing.
  - Test: `packages/painting/src/__tests__/DrawingSurface.test.tsx:1` - current test location and import style.
  - External: `https://github.com/SystemUI-js/multi-drag/blob/b65cf1c10a37e2fd4e24007c9cd051b80752a9ea/packages/multi-drag-core/src/types.ts` - `NormalizedPointerInput` and `PointerPhase` contract.
  - External: `https://github.com/SystemUI-js/multi-drag/blob/b65cf1c10a37e2fd4e24007c9cd051b80752a9ea/packages/multi-drag-core/src/controller.ts` - `GestureController.process()` lifecycle expectations.

  **Acceptance Criteria** (agent-executable only):
  - [ ] A dedicated adapter module exists and is the only place that maps RN events into `NormalizedPointerInput`.
  - [ ] Jest covers `Start`, `Move`, `End`, and `Cancel` mappings with concrete coordinate and pointer-id assertions.
  - [ ] Zero TypeScript errors are introduced by the adapter APIs.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Pointer phase mapping is deterministic
    Tool: Bash
    Steps: Run `yarn test -- DrawingSurface` or the new gesture-adapter Jest spec filtered to the adapter file.
    Expected: Assertions pass for `grant`, `move`, `release`, and `terminate` mapping to `PointerPhase.Start|Move|End|Cancel` with expected coordinates.
    Evidence: .sisyphus/evidence/task-2-normalize-pointer-input.log

  Scenario: Missing optional event fields degrade safely
    Tool: Bash
    Steps: Run the same targeted Jest spec case where `pointerType` and `identifier` are omitted from the mock native event.
    Expected: Adapter returns a valid `NormalizedPointerInput` using fallback `pointerId` and platform-derived `pointerType` without throwing.
    Evidence: .sisyphus/evidence/task-2-normalize-pointer-input-fallback.log
  ```

  **Commit**: NO | Message: `feat(painting): normalize responder input for gestures` | Files: `packages/painting/src/gestures/*`, `packages/painting/src/__tests__/*`, `jest.mockRN.js`

- [x] 3. Build stroke-state helpers around drag phases

  **What to do**: Create a small drawing-state module such as `packages/painting/src/state/strokes.ts` that owns active-stroke creation, point appending, commit/discard logic, and immutable stroke counting. Represent strokes as ordered point arrays keyed by stroke id. Start tracking on `PointerPhase.Start`, append points on `Move`, finalize on `End`, and discard tap-only strokes that never receive a move so the "click without drag" path does not count as a drawing. Add explicit cancellation handling that terminates the active stroke without appending further points.
  **Must NOT do**: Do not put stroke mutation directly into React render code. Do not create a stroke for a pure down/up tap. Do not keep canceled strokes marked as successful drawings.

  **Recommended Agent Profile**:
  - Category: `unspecified-low` - Reason: isolated state logic with precise edge conditions.
  - Skills: `[]` - no extra skill required.
  - Omitted: `artistry` - this is deterministic state handling, not creative problem solving.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: `5`, `7` | Blocked By: none

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx:3` - current public prop shape is tiny, so state logic should live outside the component.
  - External: `https://github.com/SystemUI-js/multi-drag/blob/b65cf1c10a37e2fd4e24007c9cd051b80752a9ea/packages/multi-drag-core/src/types.ts` - pointer phases that drive stroke lifecycle.
  - External: `https://github.com/SystemUI-js/multi-drag/blob/b65cf1c10a37e2fd4e24007c9cd051b80752a9ea/packages/multi-drag-core/src/controller.ts` - gesture lifecycle semantics that should align with stroke start/move/end/cancel transitions.

  **Acceptance Criteria** (agent-executable only):
  - [ ] A dedicated stroke-state module exists with tests for drag, tap-only, and cancel flows.
  - [ ] Stroke count increments only after a real drag path receives at least one move.
  - [ ] Canceled strokes stop accepting new points and are not reported as completed drawings.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Drag produces one committed stroke
    Tool: Bash
    Steps: Run the targeted Jest spec for the stroke-state module with a sequence Start → Move → Move → End.
    Expected: The resulting state contains exactly one committed stroke with ordered points and stroke count `1`.
    Evidence: .sisyphus/evidence/task-3-stroke-state.log

  Scenario: Tap and cancel do not create false drawings
    Tool: Bash
    Steps: Run targeted Jest cases for Start → End without Move and Start → Move → Cancel.
    Expected: Tap-only produces stroke count `0`; cancel path does not keep an active stroke or append points after cancellation.
    Evidence: .sisyphus/evidence/task-3-stroke-state-edge.log
  ```

  **Commit**: NO | Message: `feat(painting): add stroke state helpers` | Files: `packages/painting/src/state/*`, `packages/painting/src/__tests__/*`

- [x] 4. Implement GL stroke renderer lifecycle

  **What to do**: Create a renderer module such as `packages/painting/src/rendering/glStrokeRenderer.ts` that owns shader setup, vertex-buffer uploads, clip-space conversion, surface clearing, line drawing, and frame presentation. The renderer must redraw the full stroke list each frame using `requestAnimationFrame`, call `gl.endFrameEXP()` after each rendered frame, and expose cleanup hooks that cancel RAF and make post-unmount rendering a no-op. Normalize point coordinates from view-local pixels into clip-space using the measured surface width/height, and skip rendering until both dimensions are non-zero.
  **Must NOT do**: Do not call `setTimeout` for the render loop. Do not read GL state every frame through unsupported introspection APIs. Do not render when the surface has zero width or height.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: GL lifecycle and cleanup correctness matter more than code volume.
  - Skills: `[]` - no extra skill required.
  - Omitted: `visual-engineering` - rendering correctness is more important than stylistic UI work here.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: `5`, `7` | Blocked By: none

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx:7` - current placeholder is the implementation slot to replace or delegate from.
  - External: `https://docs.expo.dev/versions/latest/sdk/gl-view/` - `GLView`, `onContextCreate`, `gl.endFrameEXP()`, and lifecycle caveats.
  - External: `https://github.com/expo/expo/blob/main/apps/native-component-list/src/screens/GL/GLCameraScreen.tsx` - official RAF render-loop pattern with cleanup.
  - External: `https://github.com/expo/expo/blob/main/apps/native-component-list/src/screens/GL/GLReanimatedExample.tsx` - official continuous-rendering hook shape showing cleanup and context ownership.

  **Acceptance Criteria** (agent-executable only):
  - [ ] A dedicated renderer module exists and can draw line-strip stroke geometry from view-local points.
  - [ ] Jest can mock the GL context and verify `gl.endFrameEXP()` is called during rendering.
  - [ ] Cleanup cancels RAF and prevents further rendering work after unmount/stop.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Render loop presents frames correctly
    Tool: Bash
    Steps: Run the targeted Jest spec for the GL renderer with a mocked Expo WebGL context and a non-empty stroke list.
    Expected: The renderer schedules RAF, issues draw calls, and invokes `gl.endFrameEXP()` at least once.
    Evidence: .sisyphus/evidence/task-4-gl-renderer.log

  Scenario: Cleanup stops post-unmount rendering
    Tool: Bash
    Steps: Run the renderer Jest case that starts the loop, calls the renderer cleanup API, and then advances any mocked RAF timers.
    Expected: No further draw or `gl.endFrameEXP()` calls occur after cleanup; the test passes without leaked timers.
    Evidence: .sisyphus/evidence/task-4-gl-renderer-cleanup.log
  ```

  **Commit**: NO | Message: `feat(painting): add gl stroke renderer` | Files: `packages/painting/src/rendering/*`, `packages/painting/src/__tests__/*`, `jest.mockRN.js`

- [x] 5. Integrate `HamsterPainting` component and compatibility alias

  **What to do**: Replace the placeholder implementation in `packages/painting/src/components/DrawingSurface.tsx` with the real component or make that file re-export a new implementation module such as `HamsterPainting.tsx`. The component must render a measured wrapper `View`, set `collapsable={false}` on the GL host wrapper to avoid view-flattening context loss, mount `GLView`, register responder callbacks on the wrapper, feed normalized events into a persistent `GestureController` configured for drag-only features, update stroke state from accepted drag phases, and pass the latest committed + active strokes into the renderer. Keep `testID?: string` intact and add only optional compatibility-safe observability props if needed, with `onStrokeCountChange?: (count: number) => void` as the preferred addition for playground integration.
  **Must NOT do**: Do not break `DrawingSurface({ testID })` call sites. Do not recreate `GestureController` on every render. Do not compute gesture normalization or GL draw calls directly inline inside JSX.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: this task wires every foundation module into the public component contract.
  - Skills: `[]` - no extra skill required.
  - Omitted: `quick` - too much coordination across state, GL, and exports.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: `6`, `7`, `8` | Blocked By: `1`, `2`, `3`, `4`

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx:1` - current placeholder entrypoint that must become the compatibility alias surface.
  - Pattern: `packages/painting/src/index.ts:1` - public export surface that must add a default export.
  - Test: `packages/painting/src/__tests__/DrawingSurface.test.tsx:11` - existing compatibility smoke-test location to expand instead of replacing with unrelated coverage.
  - External: `https://docs.expo.dev/versions/latest/sdk/gl-view/` - GLView lifecycle and `gl.endFrameEXP()` requirement.
  - External: `https://github.com/expo/expo/issues/37725` - `collapsable={false}` workaround for GL context loss under the new architecture.
  - External: `https://github.com/SystemUI-js/multi-drag/blob/b65cf1c10a37e2fd4e24007c9cd051b80752a9ea/packages/multi-drag-core/src/controller.ts` - `GestureController` API contract.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Default import `HamsterPainting` and named import `DrawingSurface` are both defined and refer to the same implementation in Jest.
  - [ ] The component responds to responder drag phases by increasing stroke count only after a real drag sequence.
  - [ ] Unmount cleanup resets the gesture controller and stops the renderer without test leaks.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Default export and alias remain compatible
    Tool: Bash
    Steps: Run the targeted Jest spec covering default import from `@hamster-note/painting`, named import `DrawingSurface`, and direct render of the component with `testID` only.
    Expected: Both imports are functions/components, alias the same implementation, and render without prop contract breakage.
    Evidence: .sisyphus/evidence/task-5-component-exports.log

  Scenario: Unmount during active draw does not leak work
    Tool: Bash
    Steps: Run the component Jest case that simulates Start → Move, unmounts immediately, and advances mocked RAF/event cleanup paths.
    Expected: No post-unmount render calls occur; no active controller state remains; test exits cleanly.
    Evidence: .sisyphus/evidence/task-5-component-cleanup.log
  ```

  **Commit**: NO | Message: `feat(painting): implement hamster painting component` | Files: `packages/painting/src/components/*`, `packages/painting/src/index.ts`, `packages/painting/src/__tests__/*`

- [x] 6. Wire playground observability harness

  **What to do**: Update `apps/playground/App.tsx` to import the default `HamsterPainting`, preserve the existing smoke wrapper slot, and render deterministic status text around the component. Maintain a local `strokeCount` state driven by `onStrokeCountChange`, render a visible text node like `Stroke Count: 0` with a stable test id such as `hamster-painting-stroke-count`, and optionally render a derived status text like `Idle` / `Drawn` with `hamster-painting-status`. Ensure the surface container remains sized so `GLView` can render on web.
  **Must NOT do**: Do not remove the existing `Playground Ready` signal. Do not hide the stroke/status text in a way that Playwright cannot read. Do not put drawing logic into the playground.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: this is user-visible wiring plus testability-focused UI instrumentation.
  - Skills: `[]` - no extra skill required.
  - Omitted: `artistry` - no broad redesign needed.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: `7`, `8` | Blocked By: `1`, `5`

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `apps/playground/App.tsx:4` - current consumer app and surface slot.
  - Test: `tests/ui/playground.spec.ts:3` - current UI smoke spec to evolve instead of duplicating.
  - Pattern: `playwright.config.ts:21` - Expo web server used by UI tests.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Playground still shows `Playground Ready` and mounts the painting component.
  - [ ] Playground renders a deterministic stroke-count text initialized to `0`.
  - [ ] A successful drawing updates the rendered stroke-count or status signal without manual inspection.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Playground exposes deterministic drawing state
    Tool: Bash
    Steps: Run `yarn typecheck` from repo root after updating `apps/playground/App.tsx`.
    Expected: The app compiles with the new default import and observable text hooks; exit code `0`.
    Evidence: .sisyphus/evidence/task-6-playground-wiring.log

  Scenario: Initial render stays in non-drawn state
    Tool: Playwright
    Steps: Launch the configured Expo Web playground, open `/`, and assert that `hamster-painting-stroke-count` is visible with text `Stroke Count: 0` before any mouse interaction.
    Expected: The initial rendered state remains non-drawn and machine-readable before interaction.
    Evidence: .sisyphus/evidence/task-6-playground-initial-state.log
  ```

  **Commit**: NO | Message: `feat(playground): expose painting status for tests` | Files: `apps/playground/App.tsx`

- [x] 7. Expand automated UI verification for drag drawing

  **What to do**: Replace the current surface-visible-only Playwright smoke test with interaction-aware coverage in `tests/ui/playground.spec.ts`. Keep the initial ready/surface assertions, then perform a concrete mouse drag across the painting surface using exact coordinates derived from the surface bounding box, and assert the stroke-count/status text changes from its initial value. Add a second edge test that performs a click/tap without movement and verifies the stroke count remains `0`.
  **Must NOT do**: Do not assert on raw canvas/WebGL pixels. Do not use vague selectors like text fragments without stable test ids when a test id is available. Do not depend on manual waiting beyond bounded Playwright expectations.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: interaction testing needs precision and deterministic assertions.
  - Skills: `[]` - no extra skill required.
  - Omitted: `playwright` - only if the execution environment requires that command skill separately later.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: `8` | Blocked By: `2`, `3`, `4`, `5`, `6`

  **References** (executor has NO interview context - be exhaustive):
  - Test: `tests/ui/playground.spec.ts:1` - current spec file to evolve.
  - Pattern: `playwright.config.ts:5` - timeout, retries, and baseURL already configured.
  - Pattern: `apps/playground/App.tsx:6` - app layout used by the web test.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Playwright verifies the app loads, the surface is visible, and a drag changes the observable drawing signal.
  - [ ] Playwright verifies a click/tap without movement does not increment stroke count.
  - [ ] `yarn test:ui` exits `0` locally with the updated assertions.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Mouse drag creates a drawing
    Tool: Bash
    Steps: Run `yarn test:ui --grep "drag paints stroke"` after updating the spec to drag from near the upper-left quadrant of `hamster-painting-surface` to the lower-right quadrant.
    Expected: Playwright reports pass; `hamster-painting-stroke-count` changes from `0` to `1` or greater.
    Evidence: .sisyphus/evidence/task-7-playwright-drag.log

  Scenario: Click without movement does not create a stroke
    Tool: Bash
    Steps: Run `yarn test:ui --grep "tap does not paint"` against the updated playground spec.
    Expected: Playwright reports pass; `hamster-painting-stroke-count` remains `0` after the click/tap interaction.
    Evidence: .sisyphus/evidence/task-7-playwright-tap.log
  ```

  **Commit**: NO | Message: `test(ui): verify drag painting behavior` | Files: `tests/ui/playground.spec.ts`, `apps/playground/App.tsx`

- [x] 8. Run full repo verification and packaging audit

  **What to do**: After all implementation work lands, run the full root verification sequence in repo order: `yarn lint`, `yarn typecheck`, `yarn test`, `yarn test:ui`, `yarn build`, `yarn pack:dry`. If build emits generated typings or module artifacts, inspect them to confirm default export and named alias survive transpilation. Confirm the package dry-run includes the source/build outputs needed by consumers.
  **Must NOT do**: Do not skip failing steps. Do not silently rewrite unrelated code to make global lint/test noise disappear. Do not claim completion if `test:ui` only checks visibility instead of drawing behavior.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: this is the final correctness gate across the whole workspace.
  - Skills: `[]` - no extra skill required.
  - Omitted: `quick` - the sequence spans the full repo pipeline.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: none | Blocked By: `1`, `2`, `3`, `4`, `5`, `6`, `7`

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `package.json:11` - canonical root verification commands.
  - Pattern: `.github/workflows/ci-pr.yml:16` - CI order that local verification should mirror.
  - Pattern: `jest.config.js:1` - unit test roots and module aliases.
  - Pattern: `playwright.config.ts:21` - UI test server contract.
  - Pattern: `packages/painting/package.json:5` - generated package entrypoints (`main`, `module`, `types`, `react-native`).

  **Acceptance Criteria** (agent-executable only):
  - [ ] `yarn lint`, `yarn typecheck`, `yarn test`, `yarn test:ui`, `yarn build`, and `yarn pack:dry` all exit `0`.
  - [ ] Built output preserves default export `HamsterPainting` and named alias `DrawingSurface` in generated JS/types.
  - [ ] No task-specific observability hook is required outside the shipped component + playground harness.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Full repo verification passes
    Tool: Bash
    Steps: Run `yarn lint && yarn typecheck && yarn test && yarn test:ui && yarn build && yarn pack:dry` from repo root.
    Expected: Every command exits `0` in sequence; no skipped stages; generated reports only appear on failure.
    Evidence: .sisyphus/evidence/task-8-full-verification.log

  Scenario: Published package contract remains correct
    Tool: Bash
    Steps: After `yarn build`, inspect the generated declaration/entry files under `packages/painting/lib/` and run `yarn pack:dry`.
    Expected: Built JS/types expose default `HamsterPainting` and named `DrawingSurface`; npm pack dry-run includes the expected outputs.
    Evidence: .sisyphus/evidence/task-8-packaging-audit.log
  ```

  **Commit**: NO | Message: `chore(painting): verify release contract` | Files: `packages/painting/lib/*`, `package.json`, `.github/workflows/ci-pr.yml`

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [x] F4. Scope Fidelity Check — deep

## Commit Strategy
- Do not create commits unless the user explicitly asks for them.
- If the user later requests commits, group Wave 1 foundations and Wave 2 integration separately to keep history reviewable.

## Success Criteria
- Consumers can `import HamsterPainting from '@hamster-note/painting'` and `import { DrawingSurface } from '@hamster-note/painting'` without breakage.
- Dragging over the surface produces a reproducible, test-observable stroke update.
- Component mount/unmount, tap-only input, and gesture cancellation do not leave stale drawing activity.
- Repository CI commands remain green with the new dependency + export surface.
