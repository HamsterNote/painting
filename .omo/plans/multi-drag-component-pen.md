# Web Pen DrawingSurface via Multi-Drag

## TL;DR
> **Summary**: Replace the placeholder `DrawingSurface` with a Web-first drawing surface powered by `@system-ui-js/multi-drag`, keep the `DrawingSurface` export stable, add `tool` with phase-1 `'pen'`, and expose drawing data through controlled and uncontrolled APIs.
> **Deliverables**:
> - Web-first `DrawingSurface` implementation with pen drag drawing
> - Public drawing types and `tool` prop
> - Controlled + uncontrolled drawing value contract
> - Playground demos for both modes with stable QA selectors
> - Jest + Playwright coverage plus build/package verification
> **Effort**: Medium
> **Parallel**: YES - 2 waves
> **Critical Path**: 1 → 2 → 3 → 4 → 5

## Context
### Original Request
- Use `@system-ui-js/multi-drag` instead of the old core concept.
- Support drawing inside the component through drag gestures.
- Extend the exposed component props with `tool`.
- `tool` must be an enum; phase 1 supports only `'pen'`.

### Interview Summary
- Runtime target is Web only.
- Keep the public `DrawingSurface` entry stable; swap internals rather than renaming the component.
- Expose drawing results through both controlled and uncontrolled APIs.
- Use tests-after, with automated QA required.

### Metis Review (gaps addressed)
- Locked a canonical public value shape so implementers do not invent one mid-flight.
- Locked callback timing to avoid controlled-mode ambiguity and rerender thrash.
- Scoped Web-only cleanup to touched package/runtime paths, not a whole-workspace rebuild.
- Added explicit edge-case handling for tap/no-move, second pointer rejection, and controlled-value replacement during idle state.

## Work Objectives
### Core Objective
- Deliver a production-usable, Web-first `DrawingSurface` that captures freehand pen strokes by drag, exports a stable typed value model, and verifies behavior through automated unit and UI tests.

### Deliverables
- `DrawingSurface` supports `tool?: DrawingTool` with default `'pen'`.
- Public types exported from `@hamster-note/painting`: `DrawingTool`, `DrawingPoint`, `DrawingStroke`, `DrawingValue`, `DrawingSurfaceProps`.
- Public value contract is canonicalized as:
  - `type DrawingTool = 'pen'`
  - `type DrawingPoint = { x: number; y: number }`
  - `type DrawingStroke = { id: string; tool: 'pen'; points: DrawingPoint[] }`
  - `type DrawingValue = { strokes: DrawingStroke[] }`
- Controlled props: `value?: DrawingValue`, `onChange?: (nextValue: DrawingValue) => void`
- Uncontrolled prop: `defaultValue?: DrawingValue`
- `onChange` fires once per completed stroke on `AllEnd`; it does not emit per move.
- Tap/no-move gestures and strokes with fewer than 2 distinct points are ignored.
- Additional simultaneous pointers are rejected by `maxFingerCount: 1`.

### Definition of Done (verifiable conditions with commands)
- `yarn typecheck` passes.
- `yarn test` passes.
- `yarn test:ui` passes.
- `yarn build` passes.
- `yarn pack:dry` passes.

### Must Have
- No import-time DOM access outside React effect/event lifecycle.
- No `react-native` primitives inside the new `DrawingSurface` implementation path.
- Stable DOM selectors for UI automation.
- Local point coordinates measured in CSS pixels relative to the surface top-left.
- Controlled mode treats `value` as the committed-strokes source of truth while rendering an internal in-progress stroke preview until stroke completion.
- If the parent provides a new controlled `value` during an active stroke, the component cancels the transient preview immediately and re-renders the incoming controlled value without merging local points.

### Must NOT Have
- No extra tools beyond `'pen'`.
- No toolbar, undo/redo, smoothing, pressure, eraser, selection, or persistence helpers.
- No generic editor abstraction layer.
- No whole-repo migration away from current build tooling unless directly required for this feature.
- No runtime crash when unsupported `tool` values arrive from untyped JS callers; degrade to non-drawing behavior.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: tests-after using Jest for pure logic/static rendering and Playwright for interaction.
- QA policy: Every implementation task includes executable happy-path and failure/edge-case scenarios.
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. Shared contracts land first so later tasks can proceed without reinterpretation.

Wave 1: Task 1 contract/export, Task 2 stroke utilities/state, Task 6 package/runtime cleanup
Wave 2: Task 3 component rendering shell, Task 4 multi-drag bridge, Task 5 playground + automated interaction QA

### Dependency Matrix (full, all tasks)
- Task 1 → blocks Tasks 2, 3, 5
- Task 2 → blocks Tasks 3, 4, 5
- Task 3 → blocks Tasks 4, 5
- Task 4 → blocks Task 5
- Task 6 → can start after Task 1 and must finish before final verification
- Task 5 → last feature task before final verification

### Agent Dispatch Summary
- Wave 1 → 3 tasks → `quick`, `unspecified-low`
- Wave 2 → 3 tasks → `visual-engineering`, `visual-engineering`, `unspecified-high`
- Final Verification → 4 review tasks in parallel

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Freeze public drawing contract and exports

  **What to do**: Create the canonical public API for phase 1 before any gesture code lands. Add/export `DrawingTool`, `DrawingPoint`, `DrawingStroke`, `DrawingValue`, and extend `DrawingSurfaceProps` with `tool?: DrawingTool`, `value?: DrawingValue`, `defaultValue?: DrawingValue`, `onChange?: (nextValue: DrawingValue) => void`, and `testID?: string`. Make `tool` default to `'pen'`. Define `DrawingValue` coordinates as CSS-pixel positions relative to the surface top-left. Define `onChange` cadence as stroke-commit only: emit once when the active stroke ends and has at least 2 distinct points. Ignore tap/no-move gestures. Add a runtime guard so unsupported `tool` values from untyped callers disable drawing rather than throwing.
  **Must NOT do**: Do not add undo/redo, pressure, smoothing, timestamps, rotation/scale APIs, or future tool placeholders beyond the `'pen'` union.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: Mostly public typing and export-surface work with low algorithmic risk.
  - Skills: `[]` - No specialized skill required.
  - Omitted: `review-work` - Not needed until implementation is complete.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 2, 3, 5, 6 | Blocked By: none

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx:3` - Current prop surface is tiny and must be expanded carefully.
  - Pattern: `packages/painting/src/index.ts:1` - Preserve the stable named export entry point.
  - Pattern: `packages/painting/src/__tests__/DrawingSurface.test.tsx:20` - Existing prop smoke-test location to replace with real API assertions.
  - API/Type: `packages/painting/package.json:8` - Source entry currently points at `src/index.ts`; exported types must flow through this path.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `yarn typecheck` passes after adding the new public types and props.
  - [ ] `yarn test -- DrawingSurface` passes with updated API-level tests covering default `'pen'`, `defaultValue` seeding, and runtime-safe unsupported tool handling.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Public API compiles and renders with default tool
    Tool: Bash
    Steps: Run `yarn typecheck` and `yarn test -- DrawingSurface` after updating the public types and prop tests.
    Expected: Both commands exit 0; tests confirm `DrawingSurface` accepts `testID`, defaults `tool` to `'pen'`, and renders without crashing.
    Evidence: .sisyphus/evidence/task-1-contract.txt

  Scenario: Unsupported tool does not crash untyped callers
    Tool: Bash
    Steps: Add a Jest case that passes an invalid runtime `tool` via `as unknown as DrawingTool` and run `yarn test -- DrawingSurface`.
    Expected: Test passes by asserting the component renders but does not enable drawing behavior or throw.
    Evidence: .sisyphus/evidence/task-1-contract-error.txt
  ```

  **Commit**: NO | Message: `feat(painting): freeze drawing surface api` | Files: `packages/painting/src/index.ts`, `packages/painting/src/components/DrawingSurface.tsx`, `packages/painting/src/__tests__/DrawingSurface.test.tsx`

- [x] 2. Build stroke model and SVG serialization helpers

  **What to do**: Add internal helpers for stroke lifecycle and SVG output. Create a small internal module that can: create a new `'pen'` stroke with a generated id, append local points, dedupe consecutive identical points, reject strokes with fewer than 2 distinct points, and convert committed strokes into SVG-friendly data. Render strategy is fixed: use `<svg>` with one `<polyline>` per stroke rather than canvas or complex path smoothing. Keep this module DOM-free so Jest can test it in Node.
  **Must NOT do**: Do not add timestamps to the public value, Bézier smoothing, path simplification, or generalized shape abstractions.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: Pure logic/utilities with straightforward deterministic tests.
  - Skills: `[]` - No specialized skill required.
  - Omitted: `visual-engineering` - Styling is not the core concern here.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 3, 4, 5 | Blocked By: 1

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `packages/painting/src/__tests__/DrawingSurface.test.tsx:11` - Current test file can host or inspire helper-level cases.
  - Pattern: `playwright.config.ts:12` - UI QA already expects browser-driven verification; helper logic must stay unit-testable outside the browser.
  - External: `https://github.com/SystemUI-js/multi-drag` - `Finger.getPath()` retains raw movement history; helper logic should transform this path into local `DrawingPoint[]` data.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `yarn test -- DrawingSurface` passes with helper cases for point dedupe, minimum-stroke rejection, and polyline serialization.
  - [ ] `yarn typecheck` passes with helper types imported by the component.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Helper logic commits a valid pen stroke
    Tool: Bash
    Steps: Add Jest cases for creating a stroke, appending 3 distinct local points, and serializing to SVG polyline-friendly output; run `yarn test -- DrawingSurface`.
    Expected: Tests pass and committed stroke output retains the input point order with one stroke id.
    Evidence: .sisyphus/evidence/task-2-stroke-helpers.txt

  Scenario: Helper logic rejects tap/no-move input
    Tool: Bash
    Steps: Add a Jest case with repeated identical or single-point input and run `yarn test -- DrawingSurface`.
    Expected: Test passes by asserting no committed stroke is produced.
    Evidence: .sisyphus/evidence/task-2-stroke-helpers-error.txt
  ```

  **Commit**: NO | Message: `feat(painting): add pen stroke helpers` | Files: `packages/painting/src/**`

- [x] 3. Replace placeholder with Web drawing shell

  **What to do**: Rebuild `DrawingSurface` as a Web-first React component that renders a DOM host element and an internal `<svg>` layer. Map `testID` to `data-testid` on the host element. Preserve the stable `DrawingSurface` export name. Render committed strokes plus one transient active stroke preview. Keep local coordinate calculation relative to `getBoundingClientRect()` for the host. Ensure no direct `document` or window access happens during module evaluation; all browser wiring must happen inside React effects or event handlers.
  **Must NOT do**: Do not keep `react-native` `View`/`Text` primitives in the new component path, and do not render a placeholder label once real drawing UI exists.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: DOM/SVG component composition and surface presentation are the main work.
  - Skills: `[]` - No additional skill required.
  - Omitted: `artistry` - The rendering is intentionally minimal and functional.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 4, 5 | Blocked By: 1, 2

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx:7` - Replace the placeholder component in place rather than renaming it.
  - Pattern: `packages/painting/src/index.ts:1` - Keep export wiring stable.
  - Pattern: `apps/playground/src/App.tsx:8` - Current playground already allocates a 300x300 slot; the new surface should continue fitting container sizing.
  - Pattern: `apps/playground/vite.config.ts:29` - Playground resolves package source directly; DOM code must build cleanly in Vite.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `yarn test -- DrawingSurface` passes with rendering assertions for host container, `data-testid`, and committed/transient stroke markup.
  - [ ] `yarn build` passes after replacing the placeholder implementation.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Surface renders as a real SVG-backed host
    Tool: Bash
    Steps: Add renderer-based tests for a `DrawingSurface` with `testID="drawing-surface-shell"` and a seeded `defaultValue`; run `yarn test -- DrawingSurface`.
    Expected: Tests pass by asserting one host element exposes `data-testid="drawing-surface-shell"` and seeded strokes render into SVG/polyline output.
    Evidence: .sisyphus/evidence/task-3-shell.txt

  Scenario: Module import stays safe in non-DOM Jest
    Tool: Bash
    Steps: Run `yarn test -- DrawingSurface` with a case that imports the component in the current Node test environment.
    Expected: Tests pass without `document is not defined` or module-load failures.
    Evidence: .sisyphus/evidence/task-3-shell-error.txt
  ```

  **Commit**: NO | Message: `feat(painting): replace placeholder drawing surface` | Files: `packages/painting/src/components/DrawingSurface.tsx`, `packages/painting/src/__tests__/DrawingSurface.test.tsx`

- [x] 4. Attach multi-drag pen interaction bridge

  **What to do**: Instantiate `@system-ui-js/multi-drag` from a React effect against the surface host ref, using event-only integration for pen drawing. Configure `maxFingerCount: 1`, disable any pose-writing side effects with no-op pose setters/getters if needed, and listen for movement plus `AllEnd` to translate `Finger.getPath()` into local `DrawingPoint[]`. Filter to primary drawing inputs (`pointerType === 'pen'` or left-button mouse), reject secondary pointers, and ensure `destroy()` runs on unmount. Controlled mode rule is fixed: render `value` as the committed source of truth, keep only the active preview locally, emit `onChange(nextValue)` once on stroke completion, replace committed strokes immediately when `value` changes while idle, and cancel the active preview immediately if a new controlled `value` arrives mid-stroke.
  **Must NOT do**: Do not emit `onChange` for every move, do not enable rotate/scale/multi-tool behavior, and do not leave dangling document listeners after unmount.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: This is the highest-risk integration point involving external gesture APIs and React lifecycle cleanup.
  - Skills: `[]` - No extra skill required.
  - Omitted: `oracle` - Planning is already complete; executor should implement directly.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 5 | Blocked By: 2, 3

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx:1` - This file owns the component lifecycle and host ref.
  - External: `https://github.com/SystemUI-js/multi-drag` - Use `Finger.getPath()`, `maxFingerCount`, `destroy()`, and `AllEnd` semantics.
  - Pattern: `jest.config.js:2` - Avoid import-time DOM access because Jest runs in Node.
  - Pattern: `playwright.config.ts:21` - Browser-side integration will be exercised through the running playground server.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `yarn test` passes with logic/render tests covering stroke commit, controlled replacement while idle, and ignored no-move gestures.
  - [ ] `yarn test:ui --grep "drawing surface"` passes after Playwright cases cover stroke commit and second-pointer rejection.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Pen drag commits one stroke on release
    Tool: Playwright
    Steps: In the playground, press on the uncontrolled surface at `(40,40)`, drag through `(120,120)` and `(180,160)`, then release.
    Expected: Exactly one stroke preview is committed on release, and the JSON preview shows one stroke with `points.length >= 3`.
    Evidence: .sisyphus/evidence/task-4-multi-drag.png

  Scenario: Tap/no-move gesture is ignored
    Tool: Playwright
    Steps: Click once inside the uncontrolled surface without moving.
    Expected: No new stroke appears and the JSON preview remains unchanged.
    Evidence: .sisyphus/evidence/task-4-multi-drag-error.png

  Scenario: Second pointer is rejected while first stroke is active
    Tool: Playwright
    Steps: Start a stroke on the uncontrolled surface, then dispatch a second `pointerdown`/`pointermove` sequence with a different `pointerId` onto the same element before releasing the first pointer.
    Expected: Only the original stroke is tracked; no second concurrent stroke or extra committed stroke appears in the preview JSON.
    Evidence: .sisyphus/evidence/task-4-multi-drag-multitouch.png
  ```

  **Commit**: NO | Message: `feat(painting): wire drawing surface to multi-drag` | Files: `packages/painting/src/components/DrawingSurface.tsx`, `packages/painting/src/**`

- [x] 5. Build controlled and uncontrolled playground fixtures

  **What to do**: Replace the current smoke-only playground with two explicit demos: one uncontrolled surface seeded by `defaultValue`, and one controlled surface driven by parent `value` state. Add visible JSON previews and stable selectors for both surfaces and previews, plus a reset button for the controlled demo so QA can verify external-state replacement. Keep the public component name unchanged. Update Playwright coverage to assert drawing behavior, committed stroke counts, preview JSON changes, and reset behavior.
  **Must NOT do**: Do not turn the playground into a production editor UI or add extra demo features unrelated to pen verification.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: This task is mostly UI fixture design plus automation-friendly affordances.
  - Skills: `[]` - No additional skill required.
  - Omitted: `deep` - Scope is bounded to verification fixtures.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: none | Blocked By: 1, 2, 3, 4

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `apps/playground/src/App.tsx:4` - Replace the current single-slot smoke demo in place.
  - Pattern: `tests/ui/playground.spec.ts:3` - Existing UI smoke spec should be expanded rather than duplicated.
  - Pattern: `playwright.config.ts:13` - Tests run against `http://127.0.0.1:5266` and can rely on screenshot-on-failure.
  - Pattern: `apps/playground/vite.config.ts:32` - Current package aliasing must continue working after the playground changes.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `yarn test:ui` passes with assertions for uncontrolled draw, controlled draw, and controlled reset.
  - [ ] `yarn build` passes with the new playground fixture code in place.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Uncontrolled demo shows committed stroke data
    Tool: Playwright
    Steps: Open `/`, draw one stroke on `[data-testid="drawing-surface-uncontrolled"]`, then read `[data-testid="drawing-preview-uncontrolled"]`.
    Expected: Preview JSON contains exactly one stroke object with `tool:"pen"` and multiple points.
    Evidence: .sisyphus/evidence/task-5-playground.png

  Scenario: Controlled demo resets from parent state
    Tool: Playwright
    Steps: Draw one stroke on `[data-testid="drawing-surface-controlled"]`, verify `[data-testid="drawing-preview-controlled"]` updates, click `[data-testid="drawing-reset-controlled"]`.
    Expected: Preview JSON resets to zero strokes and the controlled surface clears visibly.
    Evidence: .sisyphus/evidence/task-5-playground-error.png
  ```

  **Commit**: NO | Message: `test(playground): add drawing surface verification fixtures` | Files: `apps/playground/src/App.tsx`, `tests/ui/playground.spec.ts`

- [x] 6. Align package and runtime wiring with Web-first behavior

  **What to do**: Add `@system-ui-js/multi-drag` to the painting package, remove RN-only runtime assumptions from touched source and playground code, and update package/runtime metadata only where required for this feature to build and publish cleanly. Preserve the existing package name and export entry. If a manifest field still mentions `react-native` but does not block Web-only drawing, document it as deliberate non-scope rather than expanding into a full packaging migration. Ensure tests no longer rely on calling a hook-based component as a plain function.
  **Must NOT do**: Do not undertake a broad workspace conversion away from current Bob/Vite tooling unless the feature fails without it.

  **Recommended Agent Profile**:
  - Category: `unspecified-low` - Reason: This is mostly dependency and build wiring cleanup with bounded scope.
  - Skills: `[]` - No additional skill required.
  - Omitted: `git-master` - No git work is requested.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: Final verification only | Blocked By: 1

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `packages/painting/package.json:21` - Add the new dependency and adjust package wiring only as needed.
  - Pattern: `packages/painting/babel.config.js:1` - Current build preset is RN-oriented; keep it unless it blocks the feature.
  - Pattern: `apps/playground/package.json:12` - Playground dependencies still include `react-native`/`react-native-web`; clean up only if the updated fixture code no longer needs them.
  - Pattern: `apps/playground/vite.config.ts:32` - Alias handling may need adjustment if source no longer imports `react-native`.
  - Pattern: `.github/workflows/ci-pr.yml:36` - Final command set must stay compatible with CI.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `yarn build` passes after dependency and runtime wiring changes.
  - [ ] `yarn pack:dry` passes and the package still exports the expected build artifacts.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Workspace builds with multi-drag installed
    Tool: Bash
    Steps: Run `yarn build` and `yarn pack:dry` after adding `@system-ui-js/multi-drag` and updating touched manifests/configs.
    Expected: Both commands exit 0 and the dry-run package still includes built outputs and source/type entries.
    Evidence: .sisyphus/evidence/task-6-runtime.txt

  Scenario: Test harness no longer depends on direct function invocation of a hook-based component
    Tool: Bash
    Steps: Replace old smoke tests with renderer-based or helper-based assertions, then run `yarn test`.
    Expected: Jest passes without invalid hook call patterns.
    Evidence: .sisyphus/evidence/task-6-runtime-error.txt
  ```

  **Commit**: NO | Message: `chore(painting): align package wiring for web drawing` | Files: `packages/painting/package.json`, `apps/playground/package.json`, `apps/playground/vite.config.ts`, `packages/painting/src/__tests__/DrawingSurface.test.tsx`

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [x] F4. Scope Fidelity Check — deep

## Commit Strategy
- Use a single feature commit after all implementation tasks and final verification approvals pass.
- Recommended message: `feat(painting): add web pen drawing surface with multi-drag`

## Success Criteria
- `DrawingSurface` is no longer a placeholder and can draw a pen stroke inside the surface.
- Consumers can read/write drawing state through `value`, `defaultValue`, and `onChange`.
- `tool` is typed, exported, and limited to `'pen'` in phase 1.
- Web-only drawing behavior is verified by Playwright against the playground.
- Packaging and CI commands remain green.
