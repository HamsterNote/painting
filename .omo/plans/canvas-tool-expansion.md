# Canvas Tool Expansion Plan

## TL;DR
> **Summary**: Refactor the painting library around a versioned shape model, shared renderer, explicit interaction state machine, and opt-in viewport gestures, then add dashed/fill styling, Polygon, Ellipse, continuous Line, cubic Bezier, crosshair cursor, pan/zoom/reset, and Demo coverage.
> **Deliverables**:
> - Versioned discriminated-union stroke model with old-stroke migration fixtures.
> - Shared SVG render path for committed and active strokes.
> - TDD coverage in Jest and Playwright for every requested behavior.
> - Demo controls and selectors for dash/fill/new tools/crosshair/gestures.
> **Effort**: Large
> **Parallel**: YES - 5 waves
> **Critical Path**: Task 1 → Task 2 → Task 3 → Task 4 → Tasks 5-12 → Final Verification

## Context

### Original Request
- 对于非闭合的 Tool 增加 dashed 选项，可调节 dashed 参数，比如间距，参考 CSS 值设定。
- 对于闭合的 Tool 增加 dashed 选项，参数同上；支持线宽为 0（不绘制），默认线宽 1；支持 fill 选项，可输入填充颜色、透明度等。
- 新增 Polygon 和椭圆；椭圆和矩形支持按住 Shift 变成圆形和正方形。
- Line Tool 支持连续绘制。
- 支持贝塞尔曲线（2 控制点）。
- 支持显示鼠标、触摸、手写笔位置；默认 10px 十字（一横一竖交叉）；支持通过 Props 绘制。
- 支持双指放大画布、重置位置和缩放、单指移动画布；这些功能可单独开启或关闭。
- 以上功能都要体现在 Demo 上。

### Interview Summary
- 测试策略：TDD，先写/补 Jest 与 Playwright 失败用例，再实现。
- 交互复杂度：简单状态机。
  - Polygon：点击加顶点，双击 / Esc / 点击首点附近完成，少于 3 个顶点则丢弃。
  - 连续 Line：点击加点，双击 / Esc / 工具切换完成；只有 1 个点则丢弃。
  - Bezier：四点创建模型（start、cp1、cp2、end），无创建后编辑；少于 4 点则丢弃。
- 数据模型：重构优先，采用严格 discriminated union / 新架构；必须保留旧数据可解析与迁移。
- 手势能力：默认关闭，通过 props/config 单独开启，保证旧行为不变。

### Metis Review (gaps addressed)
- 增加首个 spike：验证 `@system-ui-js/multi-drag` 是否可支持两指，否则改为自管 Pointer Events 输入层。
- 新数据模型必须带 `schemaVersion: 2`、迁移函数与 golden fixture 测试；不得原地 mutate 用户传入数据。
- 坐标空间固定为 canvas-local 存储，viewport transform 只影响屏幕显示和输入换算。
- 单一 `InteractionState` reducer 管理所有 active tool 状态，禁止组件内分散 ad-hoc 状态。
- committed 与 active stroke 必须共享一个 renderer/style resolver，先消除现有重复 SVG 分支。
- 明确 scope：不做选择、移动、创建后编辑、undo/redo、图层、导出、CSS dash 字符串解析、React Native 完整 parity。

## Work Objectives

### Core Objective
在不破坏现有默认行为的前提下，为 `@hamster-note/painting` 增加新工具、新样式、新指针显示和 opt-in viewport 手势，并让 `apps/playground` 和自动化测试覆盖全部新增能力。

### Deliverables
- `packages/painting/src`：v2 stroke 类型、migration、renderer、style resolver、interaction reducer、viewport helpers、new tools。
- `apps/playground/src/App.tsx`：新增工具与样式/手势/crosshair 控件，保留现有测试选择器。
- `packages/painting/src/__tests__`：fixtures、migration、reducer、renderer/style、tool behavior、coordinate helpers 测试。
- `tests/ui/playground.spec.ts`：新增 Playwright 场景覆盖 Demo 行为。

### Definition of Done (verifiable conditions with commands)
- `yarn lint` exits 0.
- `yarn typecheck` exits 0.
- `yarn test` exits 0.
- `yarn test:ui` exits 0.
- `yarn build` exits 0.
- `yarn pack:dry` exits 0.
- `yarn ci:local` exits 0 or every constituent step above has a captured pass artifact when dependency install is intentionally skipped by executor environment.

### Must Have
- Existing public exports remain available from `packages/painting/src/index.ts`.
- Existing v1 strokes `{ id, tool, points, strokeColor?, strokeWidth? }` remain loadable and renderable through migration / normalization.
- All gesture props default off.
- `strokeWidth: 0` for closed shapes renders no stroke, not a hairline; default closed-shape stroke width is 1.
- Dash accepts numeric `dashArray?: number[]` and `dashOffset?: number`; `undefined` and `[]` normalize to solid.
- Fill defaults to none; `fillOpacity` defaults to 1 when fill exists.
- Stored geometry coordinates are canvas-local.
- Reset resets viewport only: scale=1, tx=0, ty=0; strokes unchanged.
- Crosshair renders in a non-transformed overlay so it stays 10px on screen regardless of zoom.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- No stroke selection/move/resize/delete-by-click UI.
- No post-creation vertex/control-point editing.
- No undo/redo, layer system, z-order controls, export to PNG/SVG, gradients/pattern fills, angle snap beyond requested Shift square/circle.
- No CSS dash string parser or preset system in v1; Demo can expose numeric controls only.
- No React Native parity work beyond keeping the package build and existing RN smoke demo non-breaking.
- No replacement of unrelated smoothing/pressure behavior except where render refactor requires equivalent output.
- No mutation of user-provided `value` / `defaultValue` arrays during migration.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: TDD with existing Jest + Playwright.
- QA policy: Every task includes agent-executed happy + failure/edge scenario.
- Evidence: `.omo/evidence/task-{N}-{slug}.{ext}`.
- Commands must use Yarn because the repo is Yarn Classic workspaces.

## Execution Strategy

### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: Task 1 (input spike), Task 2 (model/migration), Task 3 (viewport helpers), Task 4 (testability selectors) — foundation tasks; Task 2/3/4 may begin after Task 1 files no-op check but must not implement gesture behavior until spike result is known.
Wave 2: Task 5 (interaction reducer/input controller), Task 6 (shared renderer/style resolver) — depends on Task 2/3.
Wave 3: Task 7 (dash/fill existing tools), Task 8 (ellipse/shift), Task 9 (polygon), Task 10 (continuous line) — depends on Task 5/6.
Wave 4: Task 11 (Bezier), Task 12 (crosshair), Task 13 (pan/pinch/reset) — depends on Task 5/6; Task 13 also depends on Task 3.
Wave 5: Task 14 (Demo integration), Task 15 (regression/CI hardening) — depends on all feature tasks.

### Dependency Matrix (full, all tasks)
| Task | Depends On | Blocks |
|---|---|---|
| 1 | none | 5, 13 |
| 2 | none | 5, 6, 7, 8, 9, 10, 11 |
| 3 | none | 5, 12, 13 |
| 4 | none | Playwright assertions in 7-15 |
| 5 | 1, 2, 3 | 7, 8, 9, 10, 11, 13 |
| 6 | 2 | 7, 8, 9, 10, 11, 12 |
| 7 | 5, 6 | 14, 15 |
| 8 | 5, 6 | 14, 15 |
| 9 | 5, 6 | 14, 15 |
| 10 | 5, 6 | 14, 15 |
| 11 | 5, 6 | 14, 15 |
| 12 | 3, 6 | 14, 15 |
| 13 | 1, 3, 5 | 14, 15 |
| 14 | 7, 8, 9, 10, 11, 12, 13 | 15 |
| 15 | 14 | Final Verification |

### Agent Dispatch Summary (wave → task count → categories)
| Wave | Task Count | Categories |
|---|---:|---|
| 1 | 4 | deep, unspecified-high, quick |
| 2 | 2 | unspecified-high |
| 3 | 4 | unspecified-high, visual-engineering |
| 4 | 3 | unspecified-high, visual-engineering |
| 5 | 2 | visual-engineering, unspecified-high |

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Input Feasibility Spike: decide `multi-drag` reuse vs Pointer Events replacement

  **What to do**: Verify whether `@system-ui-js/multi-drag` can support the required combination: existing one-pointer drawing, two-finger pinch, one-finger pan when enabled, and default-off gesture behavior. Create a short implementation note in code comments/tests only if needed; final decision must be encoded as tests and an implementation path, not a separate doc. If `multi-drag` cannot expose reliable multi-pointer state, choose custom Pointer Events for the new input controller while preserving current public behavior.
  **Must NOT do**: Do not implement full pan/zoom in this task. Do not change public props except minimal test scaffolding if unavoidable. Do not remove existing tests.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: this is an architecture-blocking feasibility decision with hidden input-library risk.
  - Skills: [`webapp-testing`] - needed for browser pointer/touch verification.
  - Omitted: [`frontend-design`] - no visual design work.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 5, 13 | Blocked By: none

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx` - current `Drag` setup, `maxFingerCount: 1`, Move/AllEnd listeners, input filtering.
  - API/Type: `packages/painting/src/multi-drag.d.ts` - available external drag types.
  - Test: `packages/painting/src/__tests__/DrawingSurface.test.tsx` - existing mocked multi-drag behavior and multi-pointer rejection tests.
  - Test: `tests/ui/playground.spec.ts` - existing browser pointer tests.
  - External: https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events - Pointer Events model.
  - External: https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Pinch_zoom_gestures - pinch gesture pattern.

  **Acceptance Criteria** (agent-executable only):
  - [ ] A failing-first test demonstrates current second-pointer behavior and the selected future behavior boundary.
  - [ ] The selected path is one of: `reuse multi-drag with explicit multi-pointer support` OR `replace input internals with Pointer Events`; the decision is discoverable from test names and implementation structure.
  - [ ] `yarn test -- DrawingSurface.test.tsx` passes.
  - [ ] `yarn test:ui -- tests/ui/playground.spec.ts` passes existing pointer tests.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Existing single-pointer drawing still works
    Tool: Bash
    Steps: Run `yarn test -- DrawingSurface.test.tsx --runInBand`.
    Expected: Existing pen/line/rect and input-method tests pass with no snapshot removal.
    Evidence: .omo/evidence/task-1-input-spike.txt

  Scenario: Two-pointer feasibility is explicitly covered
    Tool: Bash
    Steps: Run the new/updated test whose name includes `two pointer` or `pinch feasibility`.
    Expected: Test passes and asserts the chosen controller boundary instead of silently relying on `maxFingerCount: 1`.
    Evidence: .omo/evidence/task-1-input-spike-two-pointer.txt
  ```

  **Commit**: YES | Message: `test(input): characterize pointer gesture feasibility` | Files: [`packages/painting/src/components/DrawingSurface.tsx`, `packages/painting/src/__tests__/DrawingSurface.test.tsx`, `packages/painting/src/multi-drag.d.ts`, `tests/ui/playground.spec.ts`]

- [x] 2. Versioned Stroke Model: introduce discriminated union with v1 migration fixtures

  **What to do**: Create or extract shared type definitions for v2 strokes. Use a strict discriminated union keyed by `tool` and `schemaVersion: 2`. Required variants: `pen`, `line`, `rect`, `ellipse`, `polygon`, `bezier`; keep `eraser` as a tool mode, not a persisted stroke. Add `migrateStroke` / `normalizeDrawingValue` helpers that convert old v1 strokes into v2 without mutating inputs. Add golden fixtures under `packages/painting/src/__tests__/fixtures/v1/` and `packages/painting/src/__tests__/fixtures/v2/`.
  **Must NOT do**: Do not remove old public type exports abruptly. Do not mutate `value` / `defaultValue`. Do not implement rendering for new tools in this task.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: broad TypeScript type refactor with compatibility constraints.
  - Skills: [`vercel-react-best-practices`] - useful for stable React API and compatibility thinking.
  - Omitted: [`webapp-testing`] - no browser UI behavior yet.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 5, 6, 7, 8, 9, 10, 11 | Blocked By: none

  **References**:
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx` - current inline `DrawingPoint`, `DrawingStroke`, `DrawingValue`, `DrawingTool` definitions.
  - Pattern: `packages/painting/src/hooks/useCanvas.ts` - controlled/uncontrolled value flow must normalize without mutating.
  - Pattern: `packages/painting/src/utils.ts` - CRUD helpers depend on stroke shape.
  - Pattern: `packages/painting/src/index.ts` - public exports must remain additive.
  - Test: `packages/painting/src/__tests__/utils.test.ts` - CRUD and pick tests to extend.
  - Test: `packages/painting/src/__tests__/DrawingSurface.test.tsx` - old-value rendering compatibility.

  **Acceptance Criteria**:
  - [ ] `schemaVersion: 2` appears on every new persisted stroke variant.
  - [ ] v1 fixture strokes for `pen`, `line`, and `rect` normalize to expected v2 fixtures.
  - [ ] `normalizeDrawingValue` returns new arrays/objects and never mutates frozen v1 fixture input.
  - [ ] TypeScript exhaustiveness helper `assertNever` is available for later render/reducer switches.
  - [ ] `yarn typecheck` and `yarn test -- utils.test.ts stroke-helpers.test.ts` pass.

  **QA Scenarios**:
  ```
  Scenario: Old JSON loads into v2 model
    Tool: Bash
    Steps: Run `yarn test -- utils.test.ts --runInBand` after adding frozen v1 fixture migration tests.
    Expected: v1 pen/line/rect fixtures produce exact v2 fixture objects and original fixtures remain deeply equal to their pre-call snapshots.
    Evidence: .omo/evidence/task-2-model-migration.txt

  Scenario: Unknown future tool is safe
    Tool: Bash
    Steps: Run a migration test with `{ tool: 'future-tool' }` fixture.
    Expected: Normalizer ignores or marks invalid stroke without throwing; `DrawingSurface` can render remaining valid strokes.
    Evidence: .omo/evidence/task-2-model-unknown-tool.txt
  ```

  **Commit**: YES | Message: `refactor(model): add versioned drawing stroke schema` | Files: [`packages/painting/src/**/*.ts`, `packages/painting/src/__tests__/fixtures/**`, `packages/painting/src/__tests__/*.test.ts`, `packages/painting/src/index.ts`]

- [x] 3. Viewport Coordinate Helpers: define canvas-local invariant and transform math

  **What to do**: Add a small viewport helper module with `DrawingViewport = { scale: number; tx: number; ty: number }`, defaults `{ scale: 1, tx: 0, ty: 0 }`, clamp range `[0.25, 8]`, `screenToCanvas`, `canvasToScreen`, `clampScale`, `resetViewport`, and pinch-midpoint zoom math. Document invariant in exported type comments: persisted stroke points are canvas-local, never screen-transformed.
  **Must NOT do**: Do not wire gestures into `DrawingSurface` yet. Do not transform existing saved points.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: geometry utility with high downstream risk.
  - Skills: [] - no special skill required.
  - Omitted: [`frontend-design`] - no UI.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 5, 12, 13 | Blocked By: none

  **References**:
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx` - current local coordinate conversion from `getBoundingClientRect()`.
  - Pattern: `packages/painting/src/utils.ts` - geometry math style and pure helper tests.
  - Test: `packages/painting/src/__tests__/utils.test.ts` - pure math testing conventions.
  - External: https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Pinch_zoom_gestures - pinch midpoint model.

  **Acceptance Criteria**:
  - [ ] `screenToCanvas(canvasToScreen(point, viewport), viewport)` round-trips within `0.001` for default, translated, scaled, and translated+scaled viewports.
  - [ ] Scale clamps silently to `[0.25, 8]`.
  - [ ] Reset returns exactly `{ scale: 1, tx: 0, ty: 0 }`.
  - [ ] Pinch zoom around midpoint keeps the midpoint stable in screen space within `0.5px`.
  - [ ] `yarn test -- utils.test.ts --runInBand` passes.

  **QA Scenarios**:
  ```
  Scenario: Coordinate round-trip stays stable
    Tool: Bash
    Steps: Run viewport helper unit tests covering scale=2 and tx/ty offsets.
    Expected: Every point round-trips within tolerance and no persisted point is rewritten.
    Evidence: .omo/evidence/task-3-viewport-roundtrip.txt

  Scenario: Zoom clamp prevents invalid transforms
    Tool: Bash
    Steps: Run tests for requested scale 0, 0.1, 9, Infinity, NaN.
    Expected: Invalid values normalize to safe defaults or clamp range with no NaN in output.
    Evidence: .omo/evidence/task-3-viewport-clamp.txt
  ```

  **Commit**: YES | Message: `feat(viewport): add canvas coordinate transform helpers` | Files: [`packages/painting/src/**/*.ts`, `packages/painting/src/__tests__/*.test.ts`, `packages/painting/src/index.ts`]

- [x] 4. Testability Selectors: add stable data attributes without changing layout

  **What to do**: Add stable selectors needed by Playwright: surface root, SVG, committed stroke count, active tool, viewport scale/tx/ty, crosshair, reset viewport button placeholder when enabled later, and per-tool demo controls. Preserve all current selectors used in `tests/ui/playground.spec.ts`.
  **Must NOT do**: Do not redesign Demo. Do not rename/remove existing `data-testid` or visible labels.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: small testability addition with low product risk.
  - Skills: [`webapp-testing`] - selectors must be browser-test friendly.
  - Omitted: [`frontend-design`] - no aesthetic work.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: Playwright assertions in 7-15 | Blocked By: none

  **References**:
  - Pattern: `apps/playground/src/App.tsx` - current demo controls and test IDs.
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx` - surface DOM/SVG root.
  - Test: `tests/ui/playground.spec.ts` - existing selectors must remain stable.

  **Acceptance Criteria**:
  - [ ] Existing Playwright tests pass unchanged.
  - [ ] Surface exposes `data-stroke-count`, `data-active-tool`, `data-scale`, `data-tx`, `data-ty` with default values `0`, current tool, `1`, `0`, `0`.
  - [ ] No existing selector used in `tests/ui/playground.spec.ts` is removed.
  - [ ] `yarn test:ui -- tests/ui/playground.spec.ts` passes.

  **QA Scenarios**:
  ```
  Scenario: Existing playground tests still pass
    Tool: Bash
    Steps: Run `yarn test:ui -- tests/ui/playground.spec.ts`.
    Expected: All existing specs pass without edits that weaken assertions.
    Evidence: .omo/evidence/task-4-selectors-existing-e2e.txt

  Scenario: New selectors expose default state
    Tool: Playwright
    Steps: Open playground, locate drawing surface root, read `data-stroke-count`, `data-scale`, `data-tx`, `data-ty`.
    Expected: Defaults are `0`, `1`, `0`, `0`; values update only when existing drawing changes stroke count.
    Evidence: .omo/evidence/task-4-selectors-defaults.png
  ```

  **Commit**: YES | Message: `test(playground): add stable drawing selectors` | Files: [`packages/painting/src/components/DrawingSurface.tsx`, `apps/playground/src/App.tsx`, `tests/ui/playground.spec.ts`]

- [x] 5. Interaction State Reducer: centralize drawing, vertex placement, cancel/commit rules

  **What to do**: Add a reducer/controller that owns tool state transitions: `idle`, `drawingPen`, `drawingDragShape`, `placingPolygon`, `placingLine`, `placingBezier`, `panning`, `pinching`. Use canvas-local points from Task 3. Encode rules: tool switch cancels in-progress uncommitted stroke; Esc cancels current in-progress stroke except continuous line/polygon with valid minimum commits only on explicit finish; window blur cancels; reset while drawing cancels then resets viewport. Bezier four-click model stores start/cp1/cp2/end; preview rubber-band is active stroke only.
  **Must NOT do**: Do not implement final rendering for new shapes. Do not add post-creation editing. Do not make gestures default on.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: complex state machine that affects all tools.
  - Skills: [`vercel-react-best-practices`] - reducer/state stability in React.
  - Omitted: [`frontend-design`] - no design work.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 7, 8, 9, 10, 11, 13 | Blocked By: 1, 2, 3

  **References**:
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx` - existing Move/AllEnd lifecycle and eraser special path.
  - Pattern: `packages/painting/src/hooks/useCanvas.ts` - activeStroke lifecycle and controlled/uncontrolled update style.
  - Pattern: `packages/painting/src/stroke-helpers.ts` - `createStroke`, `appendPoint`, `isValidStroke` behavior to preserve where applicable.
  - Test: `packages/painting/src/__tests__/DrawingSurface.test.tsx` - current gesture tests and mock multi-drag setup.

  **Acceptance Criteria**:
  - [ ] Reducer transition table tests cover every state entry/exit for pen, drag shape, polygon, continuous line, Bezier, pan, pinch, cancel, commit.
  - [ ] Tool switch cancels in-progress polygon/Bezier with no committed stroke when invalid.
  - [ ] Polygon requires at least 3 distinct vertices; continuous line requires at least 2; Bezier requires exactly 4 points.
  - [ ] Existing pen/line/rect/eraser Jest tests still pass.
  - [ ] `yarn test -- DrawingSurface.test.tsx --runInBand` passes.

  **QA Scenarios**:
  ```
  Scenario: Tool switch cancels invalid in-progress geometry
    Tool: Bash
    Steps: Run reducer test: start polygon with two vertices, dispatch TOOL_CHANGE to pen.
    Expected: State becomes idle and no stroke is committed.
    Evidence: .omo/evidence/task-5-state-tool-switch.txt

  Scenario: Existing pen drawing behavior survives reducer refactor
    Tool: Bash
    Steps: Run `yarn test -- DrawingSurface.test.tsx --runInBand`.
    Expected: Existing pen stroke creates same point count/callback behavior as before.
    Evidence: .omo/evidence/task-5-state-existing-pen.txt
  ```

  **Commit**: YES | Message: `refactor(input): centralize drawing interaction state` | Files: [`packages/painting/src/components/DrawingSurface.tsx`, `packages/painting/src/hooks/useCanvas.ts`, `packages/painting/src/**/*.ts`, `packages/painting/src/__tests__/*.test.tsx`, `packages/painting/src/__tests__/*.test.ts`]

- [x] 6. Shared Stroke Renderer: extract exhaustive SVG renderer and style resolver

  **What to do**: Replace duplicated committed/active SVG branches with shared `renderStroke` / `StrokeRenderer` and `resolveStrokeStyle`. Use `assertNever` for every v2 stroke variant. Preserve visual output for existing pen, line, rect, pressure segments, smoothing paths, and active preview opacity. Establish style fields: `strokeColor`, `strokeWidth`, `dashArray`, `dashOffset`, `fillColor`, `fillOpacity`; closed shapes can fill, open tools use `fill="none"`.
  **Must NOT do**: Do not add new tool interaction. Do not change Demo controls yet. Do not implement pan/zoom transform in this task.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: high-regression render refactor.
  - Skills: [`vercel-react-best-practices`] - component extraction and stable rendering.
  - Omitted: [`frontend-design`] - no new visual design.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 7, 8, 9, 10, 11, 12 | Blocked By: 2

  **References**:
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx` - current SVG branches around committed and active strokes.
  - Pattern: `packages/painting/src/stroke-helpers.ts` - `pointsToSvgPath` for pen paths.
  - Test: `packages/painting/src/__tests__/DrawingSurface.test.tsx` - asserts DOM output for line/rect/pen/pressure.
  - External: https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/stroke-dasharray - SVG dash attribute behavior.

  **Acceptance Criteria**:
  - [ ] A single renderer path is used for both committed and active strokes; no duplicated per-tool JSX branches remain in `DrawingSurface.tsx`.
  - [ ] `assertNever` or equivalent makes adding a stroke variant without render support a TypeScript failure.
  - [ ] Existing pen/line/rect SVG attributes remain equivalent in tests.
  - [ ] Active preview still uses 0.7 opacity or existing equivalent.
  - [ ] `yarn test -- DrawingSurface.test.tsx --runInBand` and `yarn typecheck` pass.

  **QA Scenarios**:
  ```
  Scenario: Existing shape DOM remains equivalent
    Tool: Bash
    Steps: Run DrawingSurface tests covering pen, line, rect, pressure rendering.
    Expected: Path/line/rect elements and stroke attributes match pre-refactor expectations.
    Evidence: .omo/evidence/task-6-render-existing.txt

  Scenario: Exhaustive renderer catches missing variants
    Tool: Bash
    Steps: Run `yarn typecheck`.
    Expected: Typecheck passes with all current variants covered; renderer switch contains no default silent fallback.
    Evidence: .omo/evidence/task-6-render-exhaustive.txt
  ```

  **Commit**: YES | Message: `refactor(render): share exhaustive stroke renderer` | Files: [`packages/painting/src/components/DrawingSurface.tsx`, `packages/painting/src/**/*.tsx`, `packages/painting/src/**/*.ts`, `packages/painting/src/__tests__/*.test.tsx`]

- [x] 7. Dash and Fill Styling: implement open/closed style semantics with strokeWidth 0

  **What to do**: Add props/config and stroke fields for `dashArray?: number[]`, `dashOffset?: number`, `fillColor?: string`, `fillOpacity?: number`. Normalize `undefined`, `[]`, `[0]`, non-finite values safely. For open tools (`pen`, `line`, `bezier`) apply dash only to stroke and always `fill="none"`. For closed tools (`rect`, `ellipse`, `polygon`) apply dash to stroke; `strokeWidth: 0` renders `stroke="none"` / no stroke; fill renders when `fillColor` is provided and not `none`.
  **Must NOT do**: Do not parse CSS dash strings. Do not add gradients/patterns. Do not make `strokeWidth: 0` legal for pen/line unless existing behavior already permits it; open tools should keep safe minimum visual stroke.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: public style API and renderer/test changes.
  - Skills: []
  - Omitted: [`frontend-design`] - Demo controls are later.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: 14, 15 | Blocked By: 5, 6

  **References**:
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx` - existing `strokeColor` and `strokeWidth` prop resolution; note current `< 1` clamp must change for closed shapes.
  - Pattern: `packages/painting/src/__tests__/DrawingSurface.test.tsx` - current stroke props tests.
  - External: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/setLineDash - numeric dash arrays.
  - External: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/lineDashOffset - dash offset.
  - External: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/fillStyle - fill color semantics.

  **Acceptance Criteria**:
  - [ ] Open pen/line strokes can render `stroke-dasharray="5 2"` and `stroke-dashoffset="1"` from numeric props.
  - [ ] Rect with `strokeWidth: 0` and `fillColor="#ff0000"` renders fill and no stroke.
  - [ ] Closed shape default strokeWidth is 1 when not provided.
  - [ ] `dashArray: []`, `undefined`, `[0]`, and invalid values normalize to solid without throwing.
  - [ ] Clicking inside a fill-only rect with `strokeWidth: 0` deletes that stroke through eraser hit testing.
  - [ ] `yarn test -- DrawingSurface.test.tsx utils.test.ts --runInBand` passes.

  **QA Scenarios**:
  ```
  Scenario: Dashed open line renders expected SVG attributes
    Tool: Bash
    Steps: Run Jest test rendering line with `dashArray={[5,2]}` and `dashOffset={1}`.
    Expected: Rendered line has `stroke-dasharray="5 2"`, `stroke-dashoffset="1"`, and `fill="none"`.
    Evidence: .omo/evidence/task-7-dash-open.txt

  Scenario: Fill-only closed rect is visible and erasable
    Tool: Bash
    Steps: Run Jest test with rect `strokeWidth={0}` and fill color, then eraser pick inside rect.
    Expected: SVG has fill color, no stroke, and pick/eraser selects the rect by interior hit.
    Evidence: .omo/evidence/task-7-fill-only-closed.txt
  ```

  **Commit**: YES | Message: `feat(style): support dashed strokes and filled shapes` | Files: [`packages/painting/src/**/*.ts`, `packages/painting/src/**/*.tsx`, `packages/painting/src/__tests__/*.test.tsx`, `packages/painting/src/__tests__/*.test.ts`]

- [x] 8. Ellipse Tool and Shift Constraints: add ellipse plus rect square/circle behavior

  **What to do**: Add `ellipse` stroke variant and tool support. Encode ellipse geometry as two canvas-local bounding-box corners (`start`, `end`) to match current rect drag semantics and simplify migration mental model. Renderer converts bbox to SVG `<ellipse cx cy rx ry>`. Shift constraint applies live during drag: rect becomes square and ellipse becomes circle based on the larger absolute delta while preserving drag direction; releasing Shift reverts to unconstrained preview before commit unless Shift is held at commit. Add keydown/keyup handling scoped to active drawing.
  **Must NOT do**: Do not add ellipse rotation. Do not constrain line angles. Do not introduce center-first ellipse UX.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: UI-visible SVG geometry and keyboard interaction.
  - Skills: [`webapp-testing`] - shift + browser behavior needs E2E.
  - Omitted: [`frontend-design`] - no styling redesign.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: 14, 15 | Blocked By: 5, 6

  **References**:
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx` - current rect normalization from first/last point.
  - Pattern: `packages/painting/src/__tests__/DrawingSurface.test.tsx` - rect tests and normalized dimensions.
  - Test: `tests/ui/playground.spec.ts` - current rect E2E pattern.
  - External: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/ellipse - ellipse API semantics, even though renderer is SVG.

  **Acceptance Criteria**:
  - [ ] Ellipse tool exists in `DrawingTool`/new tool union and renders committed + active preview.
  - [ ] Dragging ellipse from any direction creates non-negative `rx`/`ry` and correct `cx`/`cy`.
  - [ ] Holding Shift while committing ellipse produces `rx === ry` within 0.5px in Playwright.
  - [ ] Holding Shift while committing rect produces equal width/height within 0.5px.
  - [ ] Shift key state resets on blur/cancel.
  - [ ] `yarn test -- DrawingSurface.test.tsx --runInBand` and targeted Playwright ellipse/rect tests pass.

  **QA Scenarios**:
  ```
  Scenario: Ellipse renders from drag bbox
    Tool: Bash
    Steps: Run Jest test simulating ellipse drag from (10,20) to (110,70).
    Expected: SVG ellipse has cx=60, cy=45, rx=50, ry=25 and committed stroke count 1.
    Evidence: .omo/evidence/task-8-ellipse-bbox.txt

  Scenario: Shift constrains ellipse and rect
    Tool: Playwright
    Steps: In playground select ellipse, hold Shift, drag 100x50, release pointer; repeat for rect.
    Expected: Ellipse `rx` equals `ry` within 0.5px; rect width equals height within 0.5px.
    Evidence: .omo/evidence/task-8-shift-constraints.png
  ```

  **Commit**: YES | Message: `feat(tools): add ellipse and shift constraints` | Files: [`packages/painting/src/**/*.ts`, `packages/painting/src/**/*.tsx`, `packages/painting/src/__tests__/*.test.tsx`, `tests/ui/playground.spec.ts`]

- [x] 9. Polygon Tool: click-to-add closed shape with fill/dash support

  **What to do**: Add `polygon` stroke variant with ordered canvas-local vertices. Interaction: click adds vertex; moving pointer previews edge from last vertex to cursor; double-click, Esc, or click within 10 canvas px of first vertex finishes if at least 3 distinct vertices; fewer vertices discard. Render committed polygon as SVG `<polygon>` or `<path>` closed path using shared style resolver. Preview shows current vertices plus cursor edge and optional closing edge when near first vertex.
  **Must NOT do**: Do not add vertex editing, regular polygon mode, snap-to-grid, or polygon open/closed toggle. Polygon is always closed when committed.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: visible multi-click drawing behavior.
  - Skills: [`webapp-testing`] - requires Playwright interaction verification.
  - Omitted: [`frontend-design`] - no new art direction.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: 14, 15 | Blocked By: 5, 6

  **References**:
  - Pattern: `packages/painting/src/utils.ts` - geometry helpers and hit-test style.
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx` - existing active preview stroke pattern.
  - Test: `packages/painting/src/__tests__/DrawingSurface.test.tsx` - pointer simulation helpers.
  - Test: `tests/ui/playground.spec.ts` - drawing interaction E2E style.

  **Acceptance Criteria**:
  - [ ] Three or more distinct vertices commit exactly one polygon stroke.
  - [ ] Two vertices then double-click/Esc commits no stroke.
  - [ ] Duplicate zero-length final vertex is ignored.
  - [ ] Filled polygon can be erased by clicking inside fill; unfilled polygon can be erased by edge hit.
  - [ ] Polygon supports dash/fill/strokeWidth 0 closed-shape semantics from Task 7.
  - [ ] Playwright can draw a 4-vertex polygon and assert `data-stroke-count="1"`.

  **QA Scenarios**:
  ```
  Scenario: Four-click polygon commits closed shape
    Tool: Playwright
    Steps: Select polygon, click four points on the SVG, double-click to finish.
    Expected: One polygon/path exists with closed geometry and `data-stroke-count="1"`.
    Evidence: .omo/evidence/task-9-polygon-happy.png

  Scenario: Degenerate polygon is discarded
    Tool: Bash
    Steps: Run Jest reducer/component test with two vertices then finish.
    Expected: No stroke committed and active state returns idle.
    Evidence: .omo/evidence/task-9-polygon-degenerate.txt
  ```

  **Commit**: YES | Message: `feat(tools): add polygon drawing tool` | Files: [`packages/painting/src/**/*.ts`, `packages/painting/src/**/*.tsx`, `packages/painting/src/__tests__/*.test.tsx`, `packages/painting/src/__tests__/*.test.ts`, `tests/ui/playground.spec.ts`]

- [x] 10. Continuous Line Tool: convert line into multi-segment click drawing mode

  **What to do**: Extend `line` stroke variant to support multiple ordered vertices while preserving migration of old v1 two-point line strokes. Interaction for line tool becomes continuous click-add mode: first click starts line, each subsequent click adds a segment endpoint, pointer move previews next segment, double-click/Esc/tool switch commits if at least 2 distinct points. Existing drag-to-line behavior must remain supported if tests/users perform pointerdown-move-up; implement it as a two-point line shortcut or keep compatibility path.
  **Must NOT do**: Do not add angle snapping, arrowheads, polyline editing, or automatic close.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: changes existing tool semantics while preserving backward compatibility.
  - Skills: [`webapp-testing`] - E2E must prove old and new line UX.
  - Omitted: [`frontend-design`] - no visual redesign.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: 14, 15 | Blocked By: 5, 6

  **References**:
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx` - current line renders first-to-last point only.
  - Pattern: `packages/painting/src/utils.ts` - `distanceSqPointToSegment`; extend to polyline for continuous line hit-test.
  - Test: `packages/painting/src/__tests__/DrawingSurface.test.tsx` - existing line tests must remain green or intentionally updated for compatible output.
  - Test: `tests/ui/playground.spec.ts` - existing tool switching and line/rect tests.

  **Acceptance Criteria**:
  - [ ] Click-click-click-dblclick creates one multi-segment line stroke with all distinct vertices.
  - [ ] Single click then Esc commits no stroke.
  - [ ] Existing drag line gesture still creates a two-point line stroke.
  - [ ] Dashed line works across all segments.
  - [ ] Eraser hit-test works on every segment.
  - [ ] `yarn test -- DrawingSurface.test.tsx utils.test.ts --runInBand` passes.

  **QA Scenarios**:
  ```
  Scenario: Continuous line creates multi-segment polyline
    Tool: Playwright
    Steps: Select line, click (20,20), (80,20), (80,80), double-click (120,80).
    Expected: One line/polyline/path stroke exists with at least 4 vertices and stroke count 1.
    Evidence: .omo/evidence/task-10-line-continuous.png

  Scenario: Legacy drag line remains supported
    Tool: Bash
    Steps: Run existing line drag Jest test.
    Expected: Two-point line stroke still commits and renders visually equivalent to previous behavior.
    Evidence: .omo/evidence/task-10-line-legacy-drag.txt
  ```

  **Commit**: YES | Message: `feat(tools): support continuous line drawing` | Files: [`packages/painting/src/**/*.ts`, `packages/painting/src/**/*.tsx`, `packages/painting/src/__tests__/*.test.tsx`, `packages/painting/src/__tests__/*.test.ts`, `tests/ui/playground.spec.ts`]

- [x] 11. Cubic Bezier Tool: add four-click 2-control-point curve

  **What to do**: Add `bezier` stroke variant storing `start`, `control1`, `control2`, `end` in canvas-local coordinates. Interaction: click start, click cp1, click cp2, click end commits; pointer move previews current pending segment/control guide. Render as SVG `<path d="M start C cp1 cp2 end">` with open-tool style semantics (stroke only, dash allowed, no fill). Esc before four points discards. Tool switch cancels if incomplete.
  **Must NOT do**: Do not add quadratic curves, multi-segment Bezier paths, editable handles, or smoothing integration.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: visible path geometry and preview behavior.
  - Skills: [`webapp-testing`] - browser click sequence verification.
  - Omitted: [`frontend-design`] - no demo styling yet.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: 14, 15 | Blocked By: 5, 6

  **References**:
  - Pattern: `packages/painting/src/stroke-helpers.ts` - existing generated cubic path string style from Catmull-Rom, but do not reuse smoothing as explicit Bezier controls.
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx` - path rendering and active preview patterns.
  - External: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/bezierCurveTo - cubic Bezier parameter semantics.

  **Acceptance Criteria**:
  - [ ] Four clicks commit exactly one Bezier stroke with start/cp1/cp2/end.
  - [ ] SVG path `d` uses one `C` command with the exact control/end coordinates.
  - [ ] Esc or tool switch before four clicks commits no stroke.
  - [ ] Dash applies to Bezier stroke; fill remains none.
  - [ ] Hit testing/eraser can select the Bezier curve using deterministic curve sampling with at least 24 segments per cubic curve and the same hit-radius policy as line segments.
  - [ ] `yarn test -- DrawingSurface.test.tsx utils.test.ts --runInBand` passes.

  **QA Scenarios**:
  ```
  Scenario: Four-click Bezier renders cubic path
    Tool: Playwright
    Steps: Select bezier, click start/cp1/cp2/end at known coordinates.
    Expected: One SVG path contains `M` and `C` coordinates matching clicks within 1px; stroke count is 1.
    Evidence: .omo/evidence/task-11-bezier-happy.png

  Scenario: Incomplete Bezier cancels cleanly
    Tool: Bash
    Steps: Run reducer/component test: click start and cp1, dispatch Escape.
    Expected: No committed stroke; active state idle; no console error.
    Evidence: .omo/evidence/task-11-bezier-cancel.txt
  ```

  **Commit**: YES | Message: `feat(tools): add cubic bezier drawing tool` | Files: [`packages/painting/src/**/*.ts`, `packages/painting/src/**/*.tsx`, `packages/painting/src/__tests__/*.test.tsx`, `packages/painting/src/__tests__/*.test.ts`, `tests/ui/playground.spec.ts`]

- [x] 12. Pointer Crosshair Overlay: default 10px cursor and custom render prop

  **What to do**: Add crosshair props to `DrawingSurface`, default enabled unless explicitly disabled: `cursor?: false | { size?: number; color?: string; render?: (state) => React.ReactNode }` or equivalent documented prop. Default renders a 10px horizontal + vertical cross centered at current pointer in a non-transformed overlay above SVG. State passed to custom render includes screen coordinates, canvas coordinates, pointerType (`mouse`/`touch`/`pen`), active tool, and visibility. Mouse/pen hover shows crosshair; touch shows only while pointer is down; hide during pinch because no single pointer position is meaningful.
  **Must NOT do**: Do not scale crosshair with zoom. Do not add animation. Do not replace native pointer handling for unrelated behavior.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: UI overlay and input visibility behavior.
  - Skills: [`webapp-testing`, `frontend-design`] - precise overlay QA and simple visual polish.
  - Omitted: [`high-end-visual-design`] - small functional cursor, not a full redesign.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: 14, 15 | Blocked By: 3, 6

  **References**:
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx` - host div/SVG layering and pointer coordinate extraction.
  - Pattern: `apps/playground/src/App.tsx` - expose prop controls in Demo later.
  - Test: `tests/ui/playground.spec.ts` - browser pointer movement assertions.
  - External: https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events - pointerType and hover behavior.

  **Acceptance Criteria**:
  - [ ] Default crosshair exists with `data-crosshair` and visual size 10px by 10px in screen CSS pixels.
  - [ ] `cursor={false}` hides crosshair.
  - [ ] Custom render prop receives screen + canvas coords and pointerType and can replace default rendering.
  - [ ] Crosshair remains 10px after viewport scale changes.
  - [ ] Touch crosshair appears only during active touch; pinch hides it.
  - [ ] `yarn test -- DrawingSurface.test.tsx --runInBand` and targeted Playwright crosshair test pass.

  **QA Scenarios**:
  ```
  Scenario: Mouse hover shows 10px crosshair
    Tool: Playwright
    Steps: Move mouse to known point over surface and inspect `[data-crosshair]` bounding box.
    Expected: Crosshair center is within ±2px of pointer; width and height are 10px ±1px.
    Evidence: .omo/evidence/task-12-crosshair-default.png

  Scenario: Crosshair can be disabled and custom rendered
    Tool: Bash
    Steps: Run Jest tests rendering `cursor={false}` and custom render prop.
    Expected: Disabled mode has no `[data-crosshair]`; custom render receives pointer state and renders test marker.
    Evidence: .omo/evidence/task-12-crosshair-props.txt
  ```

  **Commit**: YES | Message: `feat(cursor): add pointer crosshair overlay` | Files: [`packages/painting/src/components/DrawingSurface.tsx`, `packages/painting/src/**/*.ts`, `packages/painting/src/__tests__/*.test.tsx`, `tests/ui/playground.spec.ts`]

- [ ] 13. Opt-in Viewport Gestures: pan, pinch zoom, reset controls

  **What to do**: Add `gestures?: { pan?: boolean; pinchZoom?: boolean; reset?: boolean; minScale?: number; maxScale?: number }` or equivalent prop. Defaults: all booleans false, min/max `[0.25, 8]`. When enabled, two active pointers enter pinch mode and zoom around their centroid; one-finger pan on empty canvas when `pan` is true and drawing is not active; reset restores viewport only. Apply transform via a single SVG `<g transform>` or equivalent central render group so stored points remain canvas-local. Update hit testing/eraser radius using inverse scale.
  **Must NOT do**: Do not add rotation gestures, bounds clamping to content, inertial scrolling, or default-on behavior. Do not clear strokes on reset.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: cross-cutting input, coordinate, rendering, and tests.
  - Skills: [`webapp-testing`] - Playwright gesture verification required.
  - Omitted: [`frontend-design`] - functional controls only.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: 14, 15 | Blocked By: 1, 3, 5

  **References**:
  - Pattern: `packages/painting/src/components/DrawingSurface.tsx` - SVG root and input listeners.
  - Pattern: viewport helpers from Task 3.
  - Pattern: interaction reducer from Task 5.
  - Test: `tests/ui/playground.spec.ts` - Playwright can use `page.evaluate()` for synthetic PointerEvents where needed.
  - External: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action - set `touch-action: none` where app handles gestures.
  - External: https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Pinch_zoom_gestures - two-pointer pinch algorithm.

  **Acceptance Criteria**:
  - [ ] With default props, one-finger/touch drawing behavior remains unchanged and `data-scale="1" data-tx="0" data-ty="0"`.
  - [ ] With `pinchZoom` enabled, synthetic/touch two-pointer pinch changes scale and clamps to `[0.25, 8]`.
  - [ ] With `pan` enabled, one-finger drag on empty canvas changes `tx/ty`; with a drawing tool active and pointerdown classified as `drawing*` by the Task 5 reducer, drawing wins over pan and commits the expected stroke.
  - [ ] Reset restores viewport to scale=1/tx=0/ty=0 and leaves stroke count + first stroke geometry unchanged.
  - [ ] Eraser and drawing coordinates work correctly at scale=2.
  - [ ] `yarn test -- DrawingSurface.test.tsx utils.test.ts --runInBand` and targeted Playwright gesture tests pass.

  **QA Scenarios**:
  ```
  Scenario: Pinch zoom enabled changes scale, default disabled does not
    Tool: Playwright
    Steps: In default demo dispatch two-pointer pinch and read `data-scale`; then enable pinch and repeat.
    Expected: Default remains `1`; enabled scale changes within clamp range and no stroke is committed.
    Evidence: .omo/evidence/task-13-pinch-toggle.png

  Scenario: Reset viewport preserves strokes
    Tool: Playwright
    Steps: Draw one stroke, enable pan/zoom, change viewport, click reset viewport.
    Expected: `data-scale="1" data-tx="0" data-ty="0"`; `data-stroke-count` remains `1`; first stroke JSON coordinates unchanged.
    Evidence: .omo/evidence/task-13-reset-preserves-strokes.png
  ```

  **Commit**: YES | Message: `feat(viewport): add opt-in pan and pinch zoom` | Files: [`packages/painting/src/components/DrawingSurface.tsx`, `packages/painting/src/**/*.ts`, `packages/painting/src/__tests__/*.test.tsx`, `packages/painting/src/__tests__/*.test.ts`, `tests/ui/playground.spec.ts`]

- [ ] 14. Playground Demo Integration: expose every requested feature without breaking existing E2E

  **What to do**: Update `apps/playground/src/App.tsx` to expose all features: tool selector includes pen/line/rect/ellipse/polygon/bezier/eraser; dash controls for dash length/gap/offset; closed-shape fill color/opacity/strokeWidth 0 control; Shift instruction text; continuous line/Polygon/Bezier instructions; crosshair enable/custom demo; gestures panel with independent pan/pinch/reset toggles and reset button. Group controls by feature panels to avoid Demo bloat. Preserve existing controlled/uncontrolled demo and JSON previews.
  **Must NOT do**: Do not remove current controls for color/width/pressure/input methods/sampling/smoothing. Do not rename existing labels/selectors used by tests. Do not add Storybook.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: demo UI integration and test selectors.
  - Skills: [`frontend-design`, `webapp-testing`] - functional, understandable demo with E2E.
  - Omitted: [`high-end-visual-design`] - avoid redesigning beyond grouped controls.

  **Parallelization**: Can Parallel: NO | Wave 5 | Blocks: 15 | Blocked By: 7, 8, 9, 10, 11, 12, 13

  **References**:
  - Pattern: `apps/playground/src/App.tsx` - current control layout and JSON preview.
  - Pattern: `apps/playground/vite.config.ts` - demo environment.
  - Test: `tests/ui/playground.spec.ts` - all existing specs; extend rather than replace.

  **Acceptance Criteria**:
  - [ ] Every requested feature has an obvious Demo control or instruction.
  - [ ] Existing Playwright specs remain green.
  - [ ] New controls have stable selectors: `[data-tool="polygon"]`, `[data-tool="ellipse"]`, `[data-tool="bezier"]`, dash/fill/gesture/crosshair controls.
  - [ ] Controlled and uncontrolled surfaces both support new props where applicable.
  - [ ] Demo JSON preview displays v2 stroke shape fields for new tools.
  - [ ] `yarn test:ui -- tests/ui/playground.spec.ts` passes.

  **QA Scenarios**:
  ```
  Scenario: Demo exposes all new tools and controls
    Tool: Playwright
    Steps: Open playground and assert visibility of tool buttons/options for ellipse, polygon, bezier plus dash/fill/crosshair/gesture controls.
    Expected: All controls visible and selectable; existing controls still visible.
    Evidence: .omo/evidence/task-14-demo-controls.png

  Scenario: Demo can draw one example of each new tool
    Tool: Playwright
    Steps: Draw ellipse, polygon, continuous line, and Bezier using demo controls.
    Expected: Stroke count increments for each committed tool and JSON preview includes matching `tool` values.
    Evidence: .omo/evidence/task-14-demo-new-tools.png
  ```

  **Commit**: YES | Message: `feat(playground): demo expanded drawing tools` | Files: [`apps/playground/src/App.tsx`, `tests/ui/playground.spec.ts`]

- [ ] 15. Regression and CI Hardening: full suite, docs comments, RN smoke non-breakage

  **What to do**: Run full local verification, tighten tests that were too broad, add concise API comments for new public props/types, ensure package build emits declarations, and verify existing RN smoke app still imports/mounts with unchanged basics. Add any missing edge-case tests from Metis: dash normalization, reset during active stroke, crosshair hidden during pinch, old value rendering equivalence, and filled-shape eraser behavior.
  **Must NOT do**: Do not add new features in hardening. Do not weaken tests to make CI pass. Do not commit generated reports unless repo already tracks them.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: cross-suite verification and regression cleanup.
  - Skills: [`webapp-testing`, `vercel-react-best-practices`] - browser verification and public API polish.
  - Omitted: [`frontend-design`] - feature UI already done.

  **Parallelization**: Can Parallel: NO | Wave 5 | Blocks: Final Verification | Blocked By: 14

  **References**:
  - Pattern: `package.json` - root scripts `lint`, `typecheck`, `test`, `test:ui`, `build`, `pack:dry`, `ci:local`.
  - Pattern: `.github/workflows/ci-pr.yml` - CI order and required checks.
  - Pattern: `packages/painting/package.json` - package build/declaration output.
  - Pattern: `apps/playground/App.tsx` - React Native smoke demo.

  **Acceptance Criteria**:
  - [ ] `yarn lint` passes.
  - [ ] `yarn typecheck` passes.
  - [ ] `yarn test` passes.
  - [ ] `yarn test:ui` passes.
  - [ ] `yarn build` passes.
  - [ ] `yarn pack:dry` passes.
  - [ ] Public API comments describe dash/fill/cursor/gesture props and coordinate-space invariant.
  - [ ] Existing RN smoke app import path still typechecks/builds or is explicitly covered by package build.

  **QA Scenarios**:
  ```
  Scenario: Full CI mirror passes
    Tool: Bash
    Steps: Run `yarn lint && yarn typecheck && yarn test && yarn test:ui && yarn build && yarn pack:dry`.
    Expected: All commands exit 0; no ignored failing tests.
    Evidence: .omo/evidence/task-15-full-ci.txt

  Scenario: Edge regressions are covered
    Tool: Bash
    Steps: Run targeted Jest tests for dash normalization, old-value migration, reset-during-active-stroke, filled-shape eraser, viewport round-trip.
    Expected: Every edge-case test passes and corresponds to a named behavior from this plan.
    Evidence: .omo/evidence/task-15-edge-regressions.txt
  ```

  **Commit**: YES | Message: `test(ci): harden drawing feature regressions` | Files: [`packages/painting/src/**/*.ts`, `packages/painting/src/**/*.tsx`, `packages/painting/src/__tests__/**`, `apps/playground/**`, `tests/ui/playground.spec.ts`, `package.json`]

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [ ] F4. Scope Fidelity Check — deep

## Commit Strategy
- Commit per completed task when tests for that task pass.
- Use conventional messages listed in each task.
- Never commit `.omo/evidence/` unless project convention explicitly allows evidence artifacts; keep evidence local for review.

## Success Criteria
- All 15 tasks checked complete with evidence files.
- Final Verification F1-F4 all approve.
- User explicitly approves final verification summary.
- Existing behavior for pen/line/rect/eraser, controlled/uncontrolled mode, pressure, smoothing, sampling, and old demo tests remains green.
