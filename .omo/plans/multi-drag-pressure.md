# Multi Drag 0.4.0 Pressure Drawing

## TL;DR
> **Summary**: Upgrade `@system-ui-js/multi-drag` to `0.4.0` and add opt-in pressure-sensitive pen drawing to `DrawingSurface`. Pressure is read from `FingerPathItem.pressure`, preserved on drawn pen points only when enabled, and rendered with per-segment SVG widths.
> **Deliverables**:
> - `@system-ui-js/multi-drag` pinned to `0.4.0` with lockfile updated
> - New public `pressure?: boolean` prop on `DrawingSurfaceProps`
> - Pen-only pressure capture, smoothing preservation/interpolation, and per-segment SVG rendering
> - Playground pressure toggle with Playwright coverage
> - Jest coverage for component behavior and stroke helper pressure handling
> **Effort**: Medium
> **Parallel**: YES - 3 waves
> **Critical Path**: Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Final Verification Wave

## Context
### Original Request
用户要求：更新 `@system-ui-js/multi-drag` 版本到 `0.4.0` 并支持压力绘制，新增 Props `pressure`，如果为 true 则 `'pen'` 模式支持压力改变线宽，压力是 0-1 的数值，直接与 Props 中的线宽相乘得到压力后的线宽并绘制。

### Interview Summary
- Test strategy: tests-after.
- Playground scope: add a `pressure` toggle and cover it with Playwright.
- Pressure behavior: default false; only new pen drawing captures pressure when `pressure={true}`.
- Segment width rule: each pen segment uses `strokeWidth * endPoint.pressure`.
- Defensive fallback: missing/non-finite/out-of-range pressure uses `1`; valid `0` stays `0`.
- Historical rendering rule: if a pen stroke already contains point-level `pressure`, render it pressure-sensitive regardless of the current prop value so committed values do not visually change when props change later.

### Metis Review (gaps addressed)
- Metis flagged pressure storage shape, zero-pressure semantics, segment-width rule, dependency lockfile scope, and 0.4.0 API validation.
- Resolved: pressure is opt-in for newly created pen points only; existing value shape remains unchanged when disabled.
- Resolved: `0` pressure is valid and produces `strokeWidth * 0`.
- Resolved: segment width uses endpoint pressure.
- Resolved: implementers must read `FingerPathItem.pressure`, not raw `event.pressure`.

## Work Objectives
### Core Objective
Implement opt-in pressure-sensitive pen drawing without changing existing line/rect behavior or existing non-pressure value shapes.

### Deliverables
- Dependency updated in `packages/painting/package.json` and `yarn.lock`.
- Public `DrawingSurfaceProps.pressure?: boolean` added and exported through existing type exports.
- `DrawingPoint` supports optional `pressure?: number`.
- Pen pressure is captured from `FingerPathItem.pressure` only when `pressure={true}` and `tool === 'pen'`.
- Smoothing preserves and interpolates optional pressure.
- Pressure pen strokes render as per-segment SVG paths with varying `stroke-width`.
- Playground exposes `drawing-pressure-toggle` and passes the prop to both controlled and uncontrolled demos.
- Jest and Playwright tests cover enabled, disabled, invalid/missing, and non-pen behavior.

### Definition of Done (verifiable conditions with commands)
- `grep`/inspection confirms `packages/painting/package.json` has `"@system-ui-js/multi-drag": "0.4.0"`.
- `grep`/inspection confirms `yarn.lock` resolves `@system-ui-js/multi-drag@0.4.0`.
- `yarn typecheck` passes.
- `yarn test --runTestsByPath packages/painting/src/__tests__/DrawingSurface.test.tsx packages/painting/src/__tests__/stroke-helpers.test.ts` passes.
- `yarn test:ui tests/ui/playground.spec.ts` passes.
- `yarn build` passes.

### Must Have
- Use `pathItem.pressure` from `FingerPathItem` as the source of truth.
- Preserve existing behavior when `pressure` is omitted or false.
- Preserve existing line and rect rendering paths.
- Preserve optional value shape: do not add `pressure: 1` to points when pressure capture is disabled.
- Keep all changes inside existing package/app/test files relevant to the feature.

### Must NOT Have
- Do not read raw `pathItem.event?.pressure` except as debug-only inspection; production behavior must use `pathItem.pressure`.
- Do not introduce canvas, WebGL, or a renderer rewrite.
- Do not apply pressure to `line` or `rect` tools.
- Do not migrate package manager or unrelated dependencies.
- Do not change public prop names other than adding `pressure`.
- Do not commit changes unless explicitly requested by the user.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: tests-after with Jest + Playwright.
- QA policy: Every task has agent-executed scenarios.
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`.

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: Task 1 dependency/type foundation.
Wave 2: Task 2 pressure point helpers and Task 3 DrawingSurface pressure rendering.
Wave 3: Task 4 playground UI and Task 5 integrated validation.

### Dependency Matrix (full, all tasks)
- Task 1 blocks Tasks 2, 3, 4, 5.
- Task 2 blocks Task 3 and Task 5.
- Task 3 blocks Task 4 and Task 5.
- Task 4 blocks Task 5.
- Task 5 blocks Final Verification Wave.

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 1 task → `quick`.
- Wave 2 → 2 tasks → `quick`, `unspecified-high`.
- Wave 3 → 2 tasks → `visual-engineering`, `unspecified-high`.
- Final Verification Wave → 4 review agents → `oracle`, `unspecified-high`, `unspecified-high`, `deep`.

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Pin Multi Drag 0.4.0 And Type Shim

  **What to do**: Run `yarn workspace @hamster-note/painting add @system-ui-js/multi-drag@0.4.0` from repo root to update `packages/painting/package.json` and `yarn.lock`. Then update `packages/painting/src/multi-drag.d.ts` so `DragInputEvent` includes `timeStamp?: number` and `FingerPathItem` includes exactly `point: { x: number; y: number }`, `timestamp?: number`, `pressure?: number`, and `event?: DragInputEvent`. Do not declare `FingerOperationType` in the local shim because current package code does not import or consume it.
  **Must NOT do**: Do not update unrelated packages, migrate Yarn, declare unused exported types, or replace the local shim with generated package types.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: bounded dependency and type declaration update.
  - Skills: `[]` - No specialized skill needed.
  - Omitted: `git-master` - No commit requested.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: Tasks 2, 3, 4, 5 | Blocked By: none

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `packages/painting/package.json:25` - current dependency declaration to replace with `0.4.0`.
  - Pattern: `packages/painting/src/multi-drag.d.ts:1` - local module shim to extend.
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx:55` - local event type currently includes `timeStamp`.
  - External: `https://github.com/SystemUI-js/multi-drag/blob/cc7fe84a3ee64109cfa57521888ac35a9b4f5c02/packages/multi-drag/src/drag/finger.ts#L9` - 0.4.0 `FingerPathItem.pressure` source.
  - External: `https://github.com/SystemUI-js/multi-drag/blob/cc7fe84a3ee64109cfa57521888ac35a9b4f5c02/packages/multi-drag/src/dom/normalize-pointer-event.ts#L10` - pressure clamped to 0..1 upstream.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `packages/painting/package.json` contains `"@system-ui-js/multi-drag": "0.4.0"`.
  - [ ] `yarn.lock` contains an entry resolving `@system-ui-js/multi-drag@0.4.0`.
  - [ ] `packages/painting/src/multi-drag.d.ts` exposes `FingerPathItem.pressure?: number`.
  - [ ] `yarn workspace @hamster-note/painting typecheck` passes or fails only on pressure feature files not yet implemented in later tasks.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Dependency resolves to 0.4.0
    Tool: Bash
    Steps: Run `node -p "require('./packages/painting/package.json').dependencies['@system-ui-js/multi-drag']"` and inspect `yarn.lock` for `0.4.0`.
    Expected: Command prints `0.4.0`; lockfile includes `@system-ui-js/multi-drag@0.4.0`.
    Evidence: .sisyphus/evidence/task-1-pin-multi-drag.txt

  Scenario: Shim exposes pressure field
    Tool: Bash
    Steps: Run `yarn workspace @hamster-note/painting typecheck` after the shim update.
    Expected: No type error about `FingerPathItem.pressure`; any later feature errors are captured explicitly and resolved by subsequent tasks.
    Evidence: .sisyphus/evidence/task-1-pin-multi-drag-typecheck.txt
  ```

  **Commit**: NO | Message: `chore(painting): pin multi-drag pressure release` | Files: `packages/painting/package.json`, `packages/painting/src/multi-drag.d.ts`, `yarn.lock`

- [x] 2. Preserve Pressure Through Stroke Helpers

  **What to do**: Extend `DrawingPoint` in `packages/painting/src/components/DrawingSurface.tsx` with optional `pressure?: number`. Update `TimedDrawingPoint` consumers in `packages/painting/src/stroke-helpers.ts` so `createVelocityAdaptivePoints` preserves optional pressure when smoothing is disabled and linearly interpolates pressure between `prev` and `curr` for generated points when either endpoint has pressure. Use fallback `1` only for interpolation math when one endpoint lacks pressure; omit `pressure` from generated points when both endpoints lack pressure. Add helper tests in `packages/painting/src/__tests__/stroke-helpers.test.ts` for preserving raw pressure, interpolating generated pressure, and omitting pressure when input has none.
  **Must NOT do**: Do not add pressure to every point by default; do not change `pointsToSvgPath` output for non-pressure points.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: localized helper/type change with focused tests.
  - Skills: `[]` - No specialized skill needed.
  - Omitted: `visual-engineering` - No UI work in this task.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: Task 3, Task 5 | Blocked By: Task 1

  **References** (executor has NO interview context - be exhaustive):
  - API/Type: `packages/painting/src/components/DrawingSurface.tsx:19` - `DrawingPoint` currently has only `x` and `y`.
  - Pattern: `packages/painting/src/stroke-helpers.ts:68` - `TimedDrawingPoint` extends `DrawingPoint`.
  - Pattern: `packages/painting/src/stroke-helpers.ts:164` - `createVelocityAdaptivePoints` currently strips extra fields.
  - Test: `packages/painting/src/__tests__/stroke-helpers.test.ts:262` - existing smoothing test style.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `DrawingPoint` accepts optional `pressure?: number`.
  - [ ] `createVelocityAdaptivePoints([{ x, y, pressure }], { enabled: false })` returns points with the same pressure values.
  - [ ] Fast movement interpolation generates pressure values between endpoint pressures.
  - [ ] Existing `pointsToSvgPath` tests still pass unchanged.
  - [ ] `yarn test --runTestsByPath packages/painting/src/__tests__/stroke-helpers.test.ts` passes.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Smoothing preserves pressure
    Tool: Bash
    Steps: Run `yarn test --runTestsByPath packages/painting/src/__tests__/stroke-helpers.test.ts` after adding a case with raw points `{ pressure: 0.2 }` and `{ pressure: 0.8 }`.
    Expected: Test asserts returned first/last pressure values equal `0.2` and `0.8`.
    Evidence: .sisyphus/evidence/task-2-stroke-helper-pressure.txt

  Scenario: Non-pressure paths stay unchanged
    Tool: Bash
    Steps: Run the same test file and verify existing `pointsToSvgPath` expectations remain exactly `M 10 20 L 30 40` and cubic path prefixes.
    Expected: No snapshot or assertion changes are required for non-pressure path serialization.
    Evidence: .sisyphus/evidence/task-2-stroke-helper-regression.txt
  ```

  **Commit**: NO | Message: `feat(painting): preserve pressure in stroke helpers` | Files: `packages/painting/src/components/DrawingSurface.tsx`, `packages/painting/src/stroke-helpers.ts`, `packages/painting/src/__tests__/stroke-helpers.test.ts`

- [x] 3. Add DrawingSurface Pressure Capture And Segment Rendering

  **What to do**: Add `pressure?: boolean` to `DrawingSurfaceProps` at `packages/painting/src/components/DrawingSurface.tsx:36`, destructure it, and keep a `pressureRef`. Extend local `DragPathItem` with `pressure?: number`. In the Move handler, when `pressureRef.current === true` and `effectiveToolRef.current === 'pen'`, set each raw point's `pressure` from `pathItem.pressure` after defensive normalization: finite number in `[0, 1]` returns itself, otherwise `1`; valid `0` returns `0`. When disabled or tool is not pen, do not include a `pressure` field on points. For rendering, create a local helper that detects `stroke.tool === 'pen' && stroke.points.some((point) => point.pressure !== undefined)`. Pressure pen strokes with 2+ points must render one child path/line per adjacent point pair, with `d="M prev.x prev.y L curr.x curr.y"`, `strokeWidth=(stroke.strokeWidth ?? resolvedWidth) * normalizePointPressure(curr.pressure)`, `strokeLinecap="round"`, and `strokeLinejoin="round"`; use stable keys `${stroke.id}-${index}` for committed strokes and `active-${index}` for active preview. Non-pressure pen strokes must continue using the existing single `pointsToSvgPath` path. Add component tests for enabled pressure widths, disabled pressure ignoring input, invalid pressure fallback, zero pressure, non-pen unaffected behavior, and committed value preservation.
  **Must NOT do**: Do not use `pathItem.event?.pressure`; do not change `isDrawingInput`; do not change `line` or `rect` JSX except as needed to keep compile formatting.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: touches data capture, rendering semantics, and component tests.
  - Skills: `[]` - No specialized skill needed.
  - Omitted: `frontend-ui-ux` - Rendering is functional, not visual redesign.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: Tasks 4, 5 | Blocked By: Tasks 1, 2

  **References** (executor has NO interview context - be exhaustive):
  - API/Type: `packages/painting/src/components/DrawingSurface.tsx:36` - public props interface.
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx:113` - `resolvedWidth` validation to reuse for base width.
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx:202` - Drag Move handler.
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx:236` - raw timed point construction.
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx:250` - pen-only smoothing.
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx:362` - existing pen path rendering.
  - Test: `packages/painting/src/__tests__/DrawingSurface.test.tsx:168` - stroke width assertion pattern.
  - Test: `packages/painting/src/__tests__/DrawingSurface.test.tsx:615` - existing prop snapshot behavior pattern.
  - External: `https://github.com/SystemUI-js/multi-drag/blob/cc7fe84a3ee64109cfa57521888ac35a9b4f5c02/packages/multi-drag/src/drag/finger.ts#L9` - pressure source is `FingerPathItem.pressure`.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `DrawingSurfaceProps` includes `pressure?: boolean`.
  - [ ] With `pressure={true}`, `tool="pen"`, `strokeWidth={10}`, and path pressures `0.2 → 0.8`, active/committed segment width for the segment ending at `0.8` is `8`.
  - [ ] With `pressure={false}` or omitted, the same pressure input commits points without `pressure` fields and renders a single path with `stroke-width="10"`.
  - [ ] With `tool="line"` or `tool="rect"`, pressure input does not change width or point shape.
  - [ ] `pressure={true}` with `pathItem.pressure=0` renders a pressure segment width of `0`.
  - [ ] Missing/`NaN`/out-of-range pressure renders width equal to base `strokeWidth`.
  - [ ] `yarn test --runTestsByPath packages/painting/src/__tests__/DrawingSurface.test.tsx` passes.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Pen pressure changes segment width
    Tool: Bash
    Steps: Run `yarn test --runTestsByPath packages/painting/src/__tests__/DrawingSurface.test.tsx` with a test rendering `pressure={true}` and mocked path items carrying `pressure: 0.2` then `pressure: 0.8`.
    Expected: The rendered pen segment ending at the second point has `stroke-width="8"`; committed points include `pressure: 0.2` and `pressure: 0.8`.
    Evidence: .sisyphus/evidence/task-3-drawing-surface-pressure.txt

  Scenario: Pressure disabled preserves old behavior
    Tool: Bash
    Steps: Run the same test file with a case omitting `pressure` while mocked path items still carry pressure.
    Expected: Rendered pen uses one `<path>` with base `stroke-width`; committed points are exactly `{ x, y }` without pressure fields.
    Evidence: .sisyphus/evidence/task-3-drawing-surface-pressure-disabled.txt
  ```

  **Commit**: NO | Message: `feat(painting): add pressure-sensitive pen strokes` | Files: `packages/painting/src/components/DrawingSurface.tsx`, `packages/painting/src/__tests__/DrawingSurface.test.tsx`

- [x] 4. Add Playground Pressure Toggle And UI Coverage

  **What to do**: In `apps/playground/src/App.tsx`, add `const [pressure, setPressure] = useState(false)`. Add a labeled checkbox with `data-testid="drawing-pressure-toggle"` near tool/color/width controls. Pass `pressure={pressure}` to both uncontrolled and controlled `DrawingSurface` instances. In `tests/ui/playground.spec.ts`, add a pressure scenario that enables the checkbox, sets width to `10`, dispatches pen `PointerEvent`s on `drawing-surface-controlled` with pressures `0.25` and `0.75`, and asserts at least one rendered pen segment has `stroke-width="7.5"`. Keep existing mouse-based tests unchanged.
  **Must NOT do**: Do not redesign playground layout; do not require real stylus hardware; do not make pressure enabled by default.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: small UI control plus browser test coverage.
  - Skills: `[]` - No extra skill required unless browser verification is run manually.
  - Omitted: `git-master` - No commit requested.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: Task 5 | Blocked By: Task 3

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `apps/playground/src/App.tsx:19` - existing control state declarations.
  - Pattern: `apps/playground/src/App.tsx:43` - existing controls row for tool/color/width.
  - Pattern: `apps/playground/src/App.tsx:86` - uncontrolled `DrawingSurface` props.
  - Pattern: `apps/playground/src/App.tsx:114` - controlled `DrawingSurface` props.
  - Test: `tests/ui/playground.spec.ts:242` - existing stroke props Playwright test.
  - Test: `tests/ui/playground.spec.ts:129` - existing PointerEvent pen dispatch pattern.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Playground has a visible checkbox with `data-testid="drawing-pressure-toggle"`.
  - [ ] Both playground surfaces receive the same `pressure` state.
  - [ ] Existing `applies stroke props` Playwright test still passes.
  - [ ] New Playwright pressure test passes using synthetic `PointerEvent` pressure values.
  - [ ] `yarn test:ui tests/ui/playground.spec.ts` passes.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Pressure toggle enables variable-width pen stroke
    Tool: Playwright
    Steps: Open `/`, check `drawing-pressure-toggle`, fill `drawing-stroke-width-input` with `10`, dispatch pen pointer events with pressure `0.25` then `0.75` on `drawing-surface-controlled`.
    Expected: Controlled surface renders a pen segment with `stroke-width="7.5"`.
    Evidence: .sisyphus/evidence/task-4-playground-pressure.png

  Scenario: Pressure toggle off keeps base width
    Tool: Playwright
    Steps: Open `/`, leave `drawing-pressure-toggle` unchecked, fill width `10`, draw with synthetic pressure values.
    Expected: Controlled surface renders a single pen path or uniform pen output with `stroke-width="10"`; no `7.5` pressure segment is required.
    Evidence: .sisyphus/evidence/task-4-playground-pressure-off.png
  ```

  **Commit**: NO | Message: `test(playground): cover pressure pen drawing` | Files: `apps/playground/src/App.tsx`, `tests/ui/playground.spec.ts`

- [x] 5. Run Integrated Validation And Fix Feature Regressions

  **What to do**: Run targeted and broad validation in this order: `yarn typecheck`, `yarn test --runTestsByPath packages/painting/src/__tests__/DrawingSurface.test.tsx packages/painting/src/__tests__/stroke-helpers.test.ts`, `yarn test:ui tests/ui/playground.spec.ts`, `yarn build`. If failures are directly caused by pressure work, fix them in the relevant files from Tasks 1-4 and rerun the failing command. If failures are unrelated pre-existing issues, document them with command output and do not broaden scope.
  **Must NOT do**: Do not run `yarn format` unless formatting is the only failing check and the repo already requires it; do not fix unrelated lint/build issues.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: cross-feature integration and regression triage.
  - Skills: `[]` - No specialized skill needed.
  - Omitted: `git-master` - No commit requested.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: Final Verification Wave | Blocked By: Tasks 1, 2, 3, 4

  **References** (executor has NO interview context - be exhaustive):
  - Command: `package.json:15` - `yarn typecheck` script.
  - Command: `package.json:17` - `yarn test` script.
  - Command: `package.json:18` - `yarn test:ui` script.
  - Command: `package.json:16` - `yarn build` script.
  - CI: `.github/workflows/ci-pr.yml` - CI runs lint/typecheck/test/ui/build/pack; use as broad validation reference if needed.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `yarn typecheck` passes.
  - [ ] Targeted Jest command passes.
  - [ ] Targeted Playwright command passes.
  - [ ] `yarn build` passes.
  - [ ] Evidence files capture command outputs or summaries.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Full pressure feature validation
    Tool: Bash
    Steps: Run `yarn typecheck && yarn test --runTestsByPath packages/painting/src/__tests__/DrawingSurface.test.tsx packages/painting/src/__tests__/stroke-helpers.test.ts && yarn build`.
    Expected: All commands exit 0.
    Evidence: .sisyphus/evidence/task-5-integrated-validation.txt

  Scenario: Browser pressure regression validation
    Tool: Bash
    Steps: Run `yarn test:ui tests/ui/playground.spec.ts`.
    Expected: All playground specs, including pressure toggle scenario, exit 0.
    Evidence: .sisyphus/evidence/task-5-playwright-validation.txt
  ```

  **Commit**: NO | Message: `chore(painting): validate pressure drawing` | Files: only files from Tasks 1-4 if fixes are required

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit — oracle [APPROVE]
- [x] F2. Code Quality Review — unspecified-high [APPROVE after fix]
- [x] F3. Real Manual QA — unspecified-high (+ playwright) [APPROVE]
- [x] F4. Scope Fidelity Check — deep [APPROVE - claims were false positives from pre-existing changes]

## Commit Strategy
- No automatic commits. User did not request a commit.
- If later requested, create one focused commit after all validation passes: `feat(painting): support pressure-sensitive pen strokes`.
- Commit should include only `packages/painting/package.json`, `yarn.lock`, `packages/painting/src/multi-drag.d.ts`, `packages/painting/src/components/DrawingSurface.tsx`, `packages/painting/src/stroke-helpers.ts`, `packages/painting/src/__tests__/DrawingSurface.test.tsx`, `packages/painting/src/__tests__/stroke-helpers.test.ts`, `apps/playground/src/App.tsx`, and `tests/ui/playground.spec.ts`.

## Success Criteria
- `@system-ui-js/multi-drag` is pinned to `0.4.0`.
- New `pressure` prop is public, optional, and default-off.
- Pressure is read from normalized `FingerPathItem.pressure`.
- Enabled pen drawing uses `strokeWidth * pressure` for rendered segment width.
- Disabled pressure drawing and non-pen tools keep existing behavior.
- Existing values without pressure render unchanged.
- New pressure values preserve visual output across controlled/uncontrolled commits.
- Jest, Playwright, typecheck, and build validations pass or unrelated pre-existing failures are documented without scope expansion.
