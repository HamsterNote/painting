# Add Rect/Line Tools, Demo Controls, and Stroke Props

## TL;DR
> **Summary**: Extend `DrawingSurface` beyond pen-only drawing by adding `rect` and `line`, expose surface-level `strokeColor` / `strokeWidth` props, and wire a shared control bar into the playground so both demos can switch tools and styles.
> **Deliverables**:
> - `DrawingSurface` supports `pen`, `line`, and `rect`
> - `DrawingSurfaceProps` exposes configurable stroke color and width
> - Playground demo has shared controls for tool, color, and width
> - Jest + Playwright coverage proves new tools, styling, and regressions
> **Effort**: Medium
> **Parallel**: YES - 3 waves
> **Critical Path**: Task 1 → Task 2 / Task 3 / Task 4 → Task 5

## Context
### Original Request
Add `'rect'` / `'line'` tools, support switching tools in the Demo, and support props for line width and color.

### Interview Summary
- Demo choice: fully adjustable controls in the playground
- Test choice: `tests-after`
- Planning defaults applied to remove ambiguity:
  - Keep `DrawingStroke` points-based for all tools in this change
  - Render `line` / `rect` from the first and last point in `points`
  - Use one shared control set for both playground surfaces
  - Treat `strokeColor` / `strokeWidth` as surface-wide render props, not per-stroke persisted data
  - Snapshot the active tool at drag start; prop changes affect the next stroke only
  - Clamp demo width input to integer `1..24`, with component fallback `2`

### Metis Review (gaps addressed)
- Resolved data-model ambiguity by keeping the serialized `points` contract instead of introducing a discriminated-union breaking change
- Constrained scope to shape drawing only: no fill, selection, editing handles, undo/redo, or per-stroke style persistence
- Added explicit guardrails for reverse-drag rectangle normalization and mid-drag tool changes
- Required stable test IDs for all new controls and executable acceptance commands for both Jest and Playwright

## Work Objectives
### Core Objective
Ship a backwards-compatible expansion of `DrawingSurface` that adds `line` and `rect` drawing, configurable surface styling props, and a demo that can exercise the new API end-to-end.

### Deliverables
- Public type updates for `DrawingTool`, `DrawingStroke`, and `DrawingSurfaceProps`
- Shape-aware stroke creation, validation, and SVG rendering in `DrawingSurface`
- Shared playground controls for tool, stroke color, and stroke width
- Unit tests for helpers and component behavior
- Playwright specs for tool switching, stroke props, and normalized rectangles

### Definition of Done (verifiable conditions with commands)
- `yarn test packages/painting/src/__tests__/stroke-helpers.test.ts packages/painting/src/__tests__/DrawingSurface.test.tsx` exits `0`
- `yarn test:ui --grep "switches drawing tools|applies stroke props|draws normalized rectangle"` exits `0`
- `yarn typecheck` exits `0`
- `yarn build` exits `0`
- `yarn pack:dry` exits `0`

### Must Have
- Existing pen behavior remains supported by the same `DrawingValue` structure
- `DrawingSurface` accepts `tool="pen" | "line" | "rect"`
- `DrawingSurface` accepts `strokeColor?: string` and `strokeWidth?: number`
- Committed shapes and active preview both respect the style props
- Playground controls expose stable `data-testid` hooks
- Rectangle rendering normalizes reverse-direction drags into positive width/height

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- No persisted per-stroke style payloads
- No fill color, selection, resize handles, or editing affordances
- No toolbar icon system or design-system refactor
- No CI/workflow changes beyond tests consuming existing scripts
- No broad drawing-engine abstraction layer beyond the minimal helpers required here

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: `tests-after` with existing Jest + Playwright infrastructure
- QA policy: Every task includes agent-executed happy-path and failure/edge-case scenarios
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: Task 1 (public contract + helper rules + helper tests)
Wave 2: Task 2 (line rendering + line tests), Task 3 (rect rendering + rect tests), Task 4 (playground controls + style-prop tests)
Wave 3: Task 5 (Playwright coverage + command verification)

### Dependency Matrix (full, all tasks)
- Task 1: blocked by none; blocks Tasks 2, 3, 4, 5
- Task 2: blocked by Task 1; blocks Task 5
- Task 3: blocked by Task 1; blocks Task 5
- Task 4: blocked by Task 1; blocks Task 5
- Task 5: blocked by Tasks 1, 2, 3, 4; blocks Final Verification

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 1 task → `quick`
- Wave 2 → 3 tasks → `quick`, `unspecified-low`
- Wave 3 → 1 task → `unspecified-low`

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Expand the public drawing contract without breaking pen serialization

  **What to do**: Update `DrawingTool` to `'pen' | 'line' | 'rect'`, widen `DrawingStroke.tool` to `DrawingTool` while keeping the existing `{ id, tool, points }` shape, add `strokeColor?: string` and `strokeWidth?: number` to `DrawingSurfaceProps`, and introduce a shared normalization rule that treats invalid/empty color as `'black'` and non-finite or `< 1` width as `2`. Keep helper APIs points-based so `createStroke()` still returns an empty `points` array for every tool.
  **Must NOT do**: Do not convert `DrawingStroke` to a discriminated union, do not persist color/width inside `DrawingValue`, and do not remove the existing invalid-tool disable behavior.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: bounded API/type update across a few files
  - Skills: `[]` - no special skill required
  - Omitted: [`review-work`] - not needed until implementation finishes

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 2, 3, 4, 5 | Blocked By: none

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx:8` - current `DrawingTool` is pen-only and must be widened here first
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx:15` - current `DrawingStroke` shape already uses `points`; preserve this structure
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx:25` - prop surface lives here; add `strokeColor` and `strokeWidth`
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx:54` - unsupported tool guard must still reject unknown strings
  - Pattern: `packages/painting/src/stroke-helpers.ts:7` - `createStroke()` currently assumes a shared shape and should stay that way
  - Pattern: `packages/painting/src/index.ts:1` - public export surface must remain aligned with component types
  - Test: `packages/painting/src/__tests__/stroke-helpers.test.ts:3` - helper test style and assertions belong here
  - External: `package.json:15` - `yarn typecheck` already validates both package and playground consumers

  **Acceptance Criteria** (agent-executable only):
  - [ ] `DrawingSurfaceProps` exposes `strokeColor` and `strokeWidth` and the package re-exports the updated types
  - [ ] `createStroke('line')` and `createStroke('rect')` produce empty `points` arrays with the expected `tool` value
  - [ ] Invalid `tool` props still render with `data-enabled="false"`
  - [ ] `yarn test packages/painting/src/__tests__/stroke-helpers.test.ts` exits `0`
  - [ ] `yarn typecheck` exits `0`

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Helper contract accepts new tools
    Tool: Bash
    Steps: Run `yarn test packages/painting/src/__tests__/stroke-helpers.test.ts`; verify new cases assert `createStroke('line')` and `createStroke('rect')` return empty `points` arrays and valid `tool` strings.
    Expected: Jest exits `0`; helper tests prove the points-based contract remains intact.
    Evidence: .sisyphus/evidence/task-1-contract-jest.txt

  Scenario: Invalid API values fall back safely
    Tool: Bash
    Steps: Run `yarn test packages/painting/src/__tests__/DrawingSurface.test.tsx --runInBand`; verify a case passes invalid `tool`, invalid `strokeWidth`, and blank `strokeColor`.
    Expected: Component keeps `data-enabled="false"` for unknown tool and falls back to default style values without throwing.
    Evidence: .sisyphus/evidence/task-1-contract-fallbacks.txt
  ```

  **Commit**: NO | Message: `feat(painting): widen drawing contract` | Files: `packages/painting/src/components/DrawingSurface.tsx`, `packages/painting/src/stroke-helpers.ts`, `packages/painting/src/index.ts`, `packages/painting/src/__tests__/stroke-helpers.test.ts`, `packages/painting/src/__tests__/DrawingSurface.test.tsx`

- [x] 2. Implement `line` rendering and commit behavior from first/last points

  **What to do**: Keep `appendPoint()` collecting local points exactly as today, but render strokes with `tool === 'line'` as SVG `<line>` using `points[0]` and `points[points.length - 1]`. Update active-preview rendering to use the same geometry and style props. Ensure `isValidStroke()` still rejects taps/no-move input by requiring at least two distinct points.
  **Must NOT do**: Do not introduce intermediate line segment arrays, do not special-case line storage away from `points`, and do not break pen polyline rendering.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: focused component/helper change with colocated unit tests
  - Skills: `[]` - no special skill required
  - Omitted: [`playwright`] - browser automation is unnecessary for this unit-focused task

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 5 | Blocked By: 1

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx:164` - active stroke starts here and snapshots `effectiveToolRef.current`
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx:172` - point collection stays centralized here
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx:237` - committed-stroke SVG rendering currently assumes `polyline`
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx:249` - active preview rendering must mirror committed geometry
  - Pattern: `packages/painting/src/stroke-helpers.ts:15` - append behavior should remain generic across tools
  - Pattern: `packages/painting/src/stroke-helpers.ts:31` - validity rules are shared and must still reject no-move strokes
  - Test: `packages/painting/src/__tests__/DrawingSurface.test.tsx:137` - current commit-flow test shows how drag + `AllEnd` assertions are structured
  - Test: `packages/painting/src/__tests__/DrawingSurface.test.tsx:169` - value/defaultValue rendering assertions belong in this file

  **Acceptance Criteria** (agent-executable only):
  - [ ] Controlled and uncontrolled `line` strokes render as SVG `<line>` instead of `<polyline>`
  - [ ] Active line preview respects `strokeColor`, `strokeWidth`, and `opacity="0.7"`
  - [ ] Completed line strokes commit with `tool: 'line'` and a `points` array containing at least the distinct start/end points
  - [ ] Pen rendering tests still pass unchanged
  - [ ] `yarn test packages/painting/src/__tests__/DrawingSurface.test.tsx --runInBand` exits `0`

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Line drag commits first/last-point geometry
    Tool: Bash
    Steps: Run `yarn test packages/painting/src/__tests__/DrawingSurface.test.tsx --runInBand`; verify a drag case with `tool="line"` asserts committed JSON has `tool: 'line'`, `points[0]` equals the drag start, `points[points.length - 1]` equals the drag end, and rendered SVG uses a `line` element.
    Expected: Jest exits `0`; no `polyline` is rendered for the line stroke case.
    Evidence: .sisyphus/evidence/task-2-line-jest.txt

  Scenario: Tap/no-move still rejected for line tool
    Tool: Bash
    Steps: Run the same Jest command; verify a case with only one distinct point under `tool="line"` does not call `onChange` on `AllEnd`.
    Expected: No stroke is committed and existing pen tap-rejection tests still pass.
    Evidence: .sisyphus/evidence/task-2-line-edge.txt
  ```

  **Commit**: NO | Message: `feat(painting): add line drawing support` | Files: `packages/painting/src/components/DrawingSurface.tsx`, `packages/painting/src/stroke-helpers.ts`, `packages/painting/src/__tests__/DrawingSurface.test.tsx`

- [x] 3. Implement normalized `rect` rendering from drag bounds

  **What to do**: Reuse the shared `points` collection, but render `tool === 'rect'` as SVG `<rect>` whose `x`, `y`, `width`, and `height` are derived from the min/max of the first and last point. Apply the same logic to the active preview, and keep stroke-only rendering (`fill="none"`). Add unit tests for forward and reverse drags so negative width/height never reach the DOM.
  **Must NOT do**: Do not store extra corner fields, do not emit negative `width`/`height`, and do not add fill/resize behavior.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: isolated geometry/rendering change with deterministic tests
  - Skills: `[]` - no special skill required
  - Omitted: [`playwright`] - not needed until the playground task lands

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 5 | Blocked By: 1

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx:237` - insert rect-specific committed rendering alongside existing map output
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx:249` - preview rendering needs rect geometry too
  - Pattern: `packages/painting/src/stroke-helpers.ts:31` - validity still depends on two distinct points, not rect area heuristics
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx:102` - local coordinate conversion already supplies the numbers needed for bounds math
  - Test: `packages/painting/src/__tests__/DrawingSurface.test.tsx:197` - controlled value rendering pattern for asserting SVG output
  - Test: `packages/painting/src/__tests__/DrawingSurface.test.tsx:263` - uncontrolled commit assertions can be copied for rect coverage

  **Acceptance Criteria** (agent-executable only):
  - [ ] Controlled and uncontrolled `rect` strokes render as SVG `<rect>` with positive `width` and `height`
  - [ ] Reverse-direction drags normalize to the same visual box instead of negative dimensions
  - [ ] Active rect preview respects `strokeColor`, `strokeWidth`, `fill="none"`, and `opacity="0.7"`
  - [ ] `yarn test packages/painting/src/__tests__/DrawingSurface.test.tsx --runInBand` exits `0`

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Forward drag renders normalized rectangle
    Tool: Bash
    Steps: Run `yarn test packages/painting/src/__tests__/DrawingSurface.test.tsx --runInBand`; verify a `tool="rect"` case asserts the committed SVG contains one `rect` with `fill="none"` and positive `width`/`height` attributes.
    Expected: Jest exits `0`; the stored stroke remains points-based while the DOM uses rect geometry.
    Evidence: .sisyphus/evidence/task-3-rect-jest.txt

  Scenario: Reverse drag does not emit negative dimensions
    Tool: Bash
    Steps: Run the same Jest command; verify a drag starting bottom-right and ending top-left produces `x`/`y` at the normalized min corner and positive `width`/`height`.
    Expected: No negative dimensions appear in the rendered `rect` attributes.
    Evidence: .sisyphus/evidence/task-3-rect-edge.txt
  ```

  **Commit**: NO | Message: `feat(painting): add rect drawing support` | Files: `packages/painting/src/components/DrawingSurface.tsx`, `packages/painting/src/__tests__/DrawingSurface.test.tsx`

- [x] 4. Add shared playground controls and prove style props through the demo

  **What to do**: In `apps/playground/src/App.tsx`, add one shared control bar above both demos with stable test IDs for tool select, color input, and width input. Drive both controlled and uncontrolled `DrawingSurface` instances from the same local state so switching the controls updates both surfaces consistently. Preserve the existing reset button semantics for the controlled demo only. Add component-level unit tests that assert committed and active shapes honor `strokeColor` / `strokeWidth`, and add/update a playground seed/default expectation if needed.
  **Must NOT do**: Do not create separate control sets per demo, do not remove the controlled reset button, and do not persist tool/color/width inside preview JSON.

  **Recommended Agent Profile**:
  - Category: `unspecified-low` - Reason: touches playground UI and component tests together
  - Skills: `[]` - no special skill required
  - Omitted: [`frontend-ui-ux`] - functional controls are enough; no design pass needed

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 5 | Blocked By: 1

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `apps/playground/src/App.tsx:19` - current stateful playground owner lives here; add shared control state near these hooks
  - Pattern: `apps/playground/src/App.tsx:41` - existing two-column layout should remain intact
  - Pattern: `apps/playground/src/App.tsx:45` - uncontrolled `DrawingSurface` call site needs shared props
  - Pattern: `apps/playground/src/App.tsx:70` - controlled `DrawingSurface` call site needs the same shared props
  - Pattern: `apps/playground/src/App.tsx:76` - reset button must stay scoped to the controlled demo
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx:75` - consume the new props here so playground wiring has a target API
  - Test: `packages/painting/src/__tests__/DrawingSurface.test.tsx:99` - base rendering tests already live in the component test file
  - Test: `tests/ui/playground.spec.ts:8` - Playwright already relies on `data-testid` hooks in the playground

  **Acceptance Criteria** (agent-executable only):
  - [ ] Playground exposes `drawing-tool-select`, `drawing-stroke-color-input`, and `drawing-stroke-width-input`
  - [ ] Changing the shared controls updates both drawing surfaces without altering the preview JSON shape
  - [ ] Component unit tests prove committed and active SVG elements use the resolved `strokeColor` and `strokeWidth`
  - [ ] Controlled reset still clears only the controlled preview state
  - [ ] `yarn test packages/painting/src/__tests__/DrawingSurface.test.tsx --runInBand` exits `0`
  - [ ] `yarn workspace @hamster-note/painting-playground tsc --noEmit` exits `0`

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Style props apply to committed and active shapes
    Tool: Bash
    Steps: Run `yarn test packages/painting/src/__tests__/DrawingSurface.test.tsx --runInBand`; verify cases render committed `line` / `rect` strokes plus an active preview under `strokeColor="#ff0000"` and `strokeWidth={7}`.
    Expected: SVG elements expose `stroke="#ff0000"`, `stroke-width="7"`, and active preview keeps `opacity="0.7"`.
    Evidence: .sisyphus/evidence/task-4-style-jest.txt

  Scenario: Controlled reset remains isolated from shared controls
    Tool: Bash
    Steps: Run the same Jest command; verify a test or component rerender case shows resetting the controlled value clears its strokes while shared tool/color/width state continues to render into both surfaces.
    Expected: Reset affects controlled strokes only and does not remove the shared control state.
    Evidence: .sisyphus/evidence/task-4-reset-edge.txt

  Scenario: Playground control wiring compiles cleanly
    Tool: Bash
    Steps: Run `yarn workspace @hamster-note/painting-playground tsc --noEmit` after wiring `drawing-tool-select`, `drawing-stroke-color-input`, and `drawing-stroke-width-input` into `apps/playground/src/App.tsx`.
    Expected: TypeScript exits `0`; both `DrawingSurface` call sites accept the new props and shared state without type errors.
    Evidence: .sisyphus/evidence/task-4-playground-tsc.txt
  ```

  **Commit**: NO | Message: `feat(playground): add shared drawing controls` | Files: `apps/playground/src/App.tsx`, `packages/painting/src/components/DrawingSurface.tsx`, `packages/painting/src/__tests__/DrawingSurface.test.tsx`

- [x] 5. Extend Playwright coverage and run the full non-interactive verification chain

  **What to do**: Expand `tests/ui/playground.spec.ts` with named cases for tool switching, stroke-prop styling, and normalized rectangles, using the new shared control test IDs and the existing controlled/uncontrolled surfaces. Then run the targeted UI specs followed by the repo verification chain (`lint`, `typecheck`, `test`, `test:ui`, `build`, `pack:dry`). Keep the original regression cases for pen, reset, tap rejection, and multi-pointer rejection intact.
  **Must NOT do**: Do not replace existing regression tests with looser assertions, do not require manual inspection, and do not introduce flaky selectors outside `data-testid`.

  **Recommended Agent Profile**:
  - Category: `unspecified-low` - Reason: UI automation plus command verification across the repo
  - Skills: `[]` - no special skill required
  - Omitted: [`dev-browser`] - Playwright coverage is file-based and already configured in-repo

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: Final Verification | Blocked By: 1, 2, 3, 4

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `tests/ui/playground.spec.ts:3` - keep new tests inside the existing `DrawingSurface playground` describe block
  - Pattern: `tests/ui/playground.spec.ts:8` - uncontrolled drawing flow and preview JSON parsing pattern
  - Pattern: `tests/ui/playground.spec.ts:37` - controlled drawing flow and preview JSON parsing pattern
  - Pattern: `tests/ui/playground.spec.ts:68` - reset regression must remain covered
  - Pattern: `tests/ui/playground.spec.ts:101` - tap rejection regression must remain covered
  - Pattern: `tests/ui/playground.spec.ts:129` - second-pointer rejection regression must remain covered
  - Pattern: `playwright.config.ts:5` - existing config already boots the playground at `http://127.0.0.1:5266`
  - Pattern: `.github/workflows/ci-pr.yml:36` - final command chain must stay aligned with CI
  - External: `package.json:12` - canonical root scripts for lint/test/ui/build/pack dry-run

  **Acceptance Criteria** (agent-executable only):
  - [ ] `yarn test:ui --grep "switches drawing tools"` exits `0` and proves selecting `line` updates preview JSON to `"tool": "line"` and renders an SVG `line`
  - [ ] `yarn test:ui --grep "applies stroke props"` exits `0` and proves setting `#ff0000` + `7` updates rendered SVG stroke attributes
  - [ ] `yarn test:ui --grep "draws normalized rectangle"` exits `0` and proves reverse drag renders a `rect` with positive `width` and `height`
  - [ ] Existing Playwright regression cases for reset, tap rejection, and second pointer still pass
  - [ ] `yarn lint && yarn typecheck && yarn test && yarn test:ui && yarn build && yarn pack:dry` exits `0`

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Tool switching and prop styling pass in the real playground
    Tool: Bash
    Steps: Run `yarn test:ui --grep "switches drawing tools|applies stroke props"`; use `drawing-tool-select`, `drawing-stroke-color-input`, `drawing-stroke-width-input`, `drawing-surface-controlled`, and `drawing-preview-controlled` in the spec.
    Expected: Playwright exits `0`; JSON previews and SVG attributes match the selected tool/color/width.
    Evidence: .sisyphus/evidence/task-5-playwright-tools.txt

  Scenario: Reverse-drag rectangle and regression suite stay green
    Tool: Bash
    Steps: Run `yarn test:ui --grep "draws normalized rectangle|controlled demo resets from parent state|tap without move does not create new stroke|second pointer is rejected during drawing"` and then `yarn lint && yarn typecheck && yarn test && yarn test:ui && yarn build && yarn pack:dry`.
    Expected: All commands exit `0`; rectangle test proves positive dimensions and the prior regressions still pass.
    Evidence: .sisyphus/evidence/task-5-full-verification.txt
  ```

  **Commit**: NO | Message: `test(playground): cover drawing tools and stroke props` | Files: `tests/ui/playground.spec.ts`

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit — oracle ✅
- [x] F2. Code Quality Review — unspecified-high ✅
- [x] F3. Real Manual QA — unspecified-high (+ playwright if UI) ✅
- [x] F4. Scope Fidelity Check — deep ✅

## Commit Strategy
- Use one feature commit after all tests pass: `feat(painting): add rect and line drawing tools`
- If implementation naturally splits cleanly, allow two commits max:
  - `feat(painting): add rect and line drawing support`
  - `test(playground): cover tool switching and stroke props`
- Do not commit partial API changes without matching tests

## Success Criteria
- Consumers can pass `tool="line"` and `tool="rect"` without runtime fallback to disabled drawing
- Consumers can set `strokeColor` and `strokeWidth` and see both preview and committed output update accordingly
- Playground demonstrates the API with one shared control set and preserved controlled/uncontrolled examples
- Existing pen/reset/tap/multi-pointer behaviors still pass under Jest and Playwright
