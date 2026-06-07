# Expo Component Library Initialization

## TL;DR
> **Summary**: Bootstrap this empty repository as a publishable React Native component library workspace with one Expo example app, Yarn workspaces, TypeScript, ESLint, Prettier, Jest, Playwright, and CI adapted from the `chameleon` reference repo.
> **Deliverables**:
> - Root Yarn workspace and shared tooling config
> - Publishable library package in `packages/painting`
> - Expo example app in `apps/playground` with web runtime
> - Jest unit/component smoke coverage and Playwright Expo Web smoke E2E
> - PR CI and publish workflow skeletons adapted from `chameleon`
> **Effort**: Medium
> **Parallel**: YES - 2 waves
> **Critical Path**: 1 → 2/3 → 4 → 6/7 → 9/10

## Context
### Original Request
- 初始化项目：TS + Expo、ESLint、Prettier、yarn、`.gitignore`、Jest、Playwright。

### Interview Summary
- Current repo is effectively empty: only `LICENSE` and `.sisyphus` planning artifacts exist.
- This is not an application bootstrap; it is a React Native component library bootstrap.
- The repo must expose a publishable library skeleton now, while deferring actual drawing/pointer implementation.
- The repo shape must be `library scaffold + example app`, not a single Expo package.
- Expo Web is required because Playwright will be used for web E2E.
- CI should be included and modeled selectively on `/home/zhangxiao/frontend/SysUI/chameleon`.

### Metis Review (gaps addressed)
- Locked workspace topology explicitly to avoid scaffold drift.
- Chose Yarn classic workspaces (`yarn@1.22.22`) to match `chameleon` and minimize config overhead.
- Chose package-name imports from the example app, with `yarn pack --dry-run` verifying publishability separately.
- Excluded Vite, Storybook, Changesets, native E2E, and drawing-feature implementation to keep bootstrap scope tight.

## Work Objectives
### Core Objective
- Convert this empty repo into a minimal workspace-first, publishable React Native component library project that can be developed and smoke-tested through an Expo Web example app.

### Deliverables
- Root workspace config with `packageManager`, workspaces, shared scripts, and `.gitignore`.
- Library package at `packages/painting` using React Native-compatible packaging and typed exports.
- Expo example app at `apps/playground` that consumes the library by package name only.
- Shared ESLint, Prettier, Jest, and Playwright configuration.
- `.github/workflows/ci-pr.yml` and `.github/workflows/publish.yml` adapted from `chameleon` patterns.

### Definition of Done (verifiable conditions with commands)
- `corepack enable && yarn install --frozen-lockfile` exits `0` from repo root.
- `yarn lint && yarn format:check && yarn typecheck && yarn build && yarn test && yarn test:ui` exits `0` from repo root.
- `yarn playground:web` starts a deterministic Expo Web server on `http://127.0.0.1:8081` for Playwright.
- `yarn pack:dry` proves only the library package is publishable and includes built artifacts plus typings.
- `! rg '\.\./\.\./packages|packages/painting/src' apps/playground` exits `0`, proving the example app does not reach into library source via relative paths.

### Must Have
- `apps/playground` Expo example app with web support.
- `packages/painting` publishable package skeleton.
- Shared root scripts: `lint`, `format:check`, `typecheck`, `build`, `test`, `test:ui`, `ci:local`, `pack:dry`, `playground:web`.
- Jest configured for RN/Expo-compatible unit smoke tests.
- Playwright configured for Expo Web smoke E2E with Chromium in CI.
- CI order aligned with `chameleon`: install → lint → test → Playwright → build → pack dry-run.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- No drawing logic, canvas logic, pointer gesture handling, pressure/tilt support, or event API design.
- No Storybook, Changesets, Turbo, semantic-release, docs site, Vite, or native iOS/Android E2E.
- No relative source imports from example app into `packages/painting/src`.
- No multi-package expansion beyond one publishable library package and one Expo example app.
- No placeholder feature work beyond the minimum export skeleton needed for build/test/smoke coverage.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: tests-after using `jest-expo` for unit/component smoke coverage and Playwright for Expo Web E2E.
- QA policy: Every task below includes a happy path and a failure/edge path.
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: Tasks 1-5 (workspace foundation, Expo app scaffold, library scaffold, workspace wiring, shared code-quality baseline)

Wave 2: Tasks 6-10 (build/typecheck scripts, Jest, Playwright, PR CI, publish workflow)

### Dependency Matrix (full, all tasks)
- 1 blocks 2, 3, 5, 6, 9, 10
- 2 blocks 4, 7, 8
- 3 blocks 4, 6, 7, 10
- 4 blocks 6, 7, 8, 9
- 5 blocks 9
- 6 blocks 9, 10
- 7 blocks 9
- 8 blocks 9
- 9 depends on 1, 4, 5, 6, 7, 8
- 10 depends on 1, 3, 6

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 5 tasks → `quick`, `unspecified-low`
- Wave 2 → 5 tasks → `quick`, `unspecified-low`, `writing`

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Establish root workspace contract

  **What to do**: Create the root `package.json` as a private Yarn classic workspace root pinned to `yarn@1.22.22`. Define workspace globs as `apps/*` and `packages/*`. Add the root scripts `lint`, `format:check`, `typecheck`, `build`, `test`, `test:ui`, `ci:local`, `pack:dry`, and `playground:web`. Ensure `ci:local` runs the same command order as CI: install precondition → lint → test → Playwright → build → pack dry-run.
  **Must NOT do**: Do not add `pnpm`, `bun`, `npm workspaces`, Yarn Berry, or extra workspace packages.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: focused repo bootstrap with a small set of config files.
  - Skills: `[]` - No extra skill is required.
  - Omitted: `['/frontend-ui-ux']` - No UI design work is involved.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 2, 3, 5, 6, 9, 10 | Blocked By: none

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `/home/zhangxiao/frontend/SysUI/chameleon/package.json` - Reuse Yarn/corepack pinning and root script naming style.
  - Pattern: `/home/zhangxiao/frontend/SysUI/chameleon/.github/workflows/ci-pr.yml` - Reuse CI command order at script level.
  - External: `https://classic.yarnpkg.com/lang/en/docs/workspaces/` - Use Yarn classic workspace behavior, not Berry.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `node -e "const pkg=require('./package.json'); process.exit(pkg.private===true && pkg.packageManager==='yarn@1.22.22' && Array.isArray(pkg.workspaces) && pkg.workspaces.includes('apps/*') && pkg.workspaces.includes('packages/*') ? 0 : 1)"`
  - [ ] `node -e "const s=require('./package.json').scripts; const keys=['lint','format:check','typecheck','build','test','test:ui','ci:local','pack:dry','playground:web']; process.exit(keys.every(k=>s&&s[k]) ? 0 : 1)"`

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Root workspace contract is valid
    Tool: Bash
    Steps: Run `corepack enable && yarn install --frozen-lockfile` from repo root.
    Expected: Install exits 0 and Yarn recognizes the root workspace.
    Evidence: .sisyphus/evidence/task-1-root-workspace.txt

  Scenario: Root package cannot be published accidentally
    Tool: Bash
    Steps: Run `node -e "const pkg=require('./package.json'); process.exit(pkg.private===true ? 0 : 1)"`.
    Expected: Command exits 0 only when the root package is private.
    Evidence: .sisyphus/evidence/task-1-root-private.txt
  ```

  **Commit**: NO | Message: `chore(root): define workspace contract` | Files: `package.json`, `yarn.lock`

- [x] 2. Scaffold Expo example app workbench

  **What to do**: Create `apps/playground` as the single Expo example app using the lightest practical Expo + TypeScript template. Enable Expo Web and standardize the web dev command to `expo start --web --port 8081 --non-interactive`, surfaced through the root script `yarn playground:web`. Add a minimal smoke screen with static text `Playground Ready` and a rendered library-host slot so Playwright has a deterministic landing page.
  **Must NOT do**: Do not add Expo Router, navigation stacks, app tabs, native build customizations, or demo UX beyond one smoke screen.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: isolated scaffold task with limited surface area.
  - Skills: `[]` - No extra skill is required.
  - Omitted: `['/frontend-ui-ux']` - The screen is only a smoke fixture, not product UI.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 4, 7, 8 | Blocked By: 1

  **References** (executor has NO interview context - be exhaustive):
  - External: `https://docs.expo.dev/more/create-expo/` - Use Expo’s standard project bootstrap guidance.
  - External: `https://docs.expo.dev/workflow/web/` - Keep web runtime on Expo Web rather than adding a second bundler.
  - Pattern: `/home/zhangxiao/frontend/SysUI/chameleon/playwright.config.ts` - Follow the fixed-port web server pattern for E2E readiness.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `test -f apps/playground/package.json && (test -f apps/playground/app.json || test -f apps/playground/app.config.js || test -f apps/playground/app.config.ts)`
  - [ ] `yarn playground:web >/tmp/painting-playground.log 2>&1 & pid=$!; sleep 25; curl -I http://127.0.0.1:8081; status=$?; kill $pid; wait $pid 2>/dev/null; exit $status`

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Expo Web smoke app boots on the fixed port
    Tool: Bash
    Steps: Start `yarn playground:web`, wait for server readiness, then request `http://127.0.0.1:8081`.
    Expected: The server responds successfully and serves the Expo Web app.
    Evidence: .sisyphus/evidence/task-2-playground-web.txt

  Scenario: Smoke screen remains intentionally minimal
    Tool: Bash
    Steps: Run `! rg 'expo-router|@react-navigation|Tabs|Stack' apps/playground`.
    Expected: No matches are returned.
    Evidence: .sisyphus/evidence/task-2-playground-minimal.txt
  ```

  **Commit**: NO | Message: `chore(playground): scaffold expo example app` | Files: `apps/playground/**`

- [x] 3. Scaffold the publishable library package

  **What to do**: Create `packages/painting` as the only publishable package. Configure React Native-compatible package metadata with explicit `main`, `module`, `types`, `react-native`, and `exports` entries. Use `react-native-builder-bob` for library builds and declarations, and add only the minimum public export skeleton needed for smoke testing: `src/index.ts` plus one placeholder component file rendered by the example app. Keep the component behavior inert; it should exist only to validate package wiring.
  **Must NOT do**: Do not implement drawing behavior, pointer APIs, pressure/tilt handling, gesture abstractions, or any native module.

  **Recommended Agent Profile**:
  - Category: `unspecified-low` - Reason: package metadata plus library build setup is broader than a single-file tweak.
  - Skills: `[]` - No extra skill is required.
  - Omitted: `['/frontend-ui-ux']` - This is package infrastructure, not UI design.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 4, 6, 7, 10 | Blocked By: 1

  **References** (executor has NO interview context - be exhaustive):
  - External: `https://callstack.github.io/react-native-builder-bob/create` - Follow the standard React Native library build layout.
  - External: `https://docs.expo.dev/config-plugins/development-for-libraries/` - Preserve Expo compatibility expectations for libraries, while skipping config-plugin work for now.
  - Pattern: `/home/zhangxiao/frontend/SysUI/chameleon/package.json` - Reuse script naming discipline and package metadata cleanliness.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `test -f packages/painting/package.json && test -f packages/painting/src/index.ts`
  - [ ] `node -e "const pkg=require('./packages/painting/package.json'); const exp=pkg.exports&&pkg.exports['.']; process.exit(pkg.private!==true && pkg.main && pkg.module && pkg.types && pkg['react-native'] && exp ? 0 : 1)"`

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Library package builds distributable artifacts
    Tool: Bash
    Steps: Run `yarn workspace @hamster-note/painting build && rg --files packages/painting/lib && rg --files packages/painting/lib | rg '\.d\.ts$'`.
    Expected: Build exits 0 and `packages/painting/lib` contains JS output plus at least one `.d.ts` file.
    Evidence: .sisyphus/evidence/task-3-library-build.txt

  Scenario: Public package metadata is fully wired
    Tool: Bash
    Steps: Run `node -e "const pkg=require('./packages/painting/package.json'); const exp=pkg.exports&&pkg.exports['.']; process.exit(pkg.private!==true && pkg.main && pkg.module && pkg.types && pkg['react-native'] && exp ? 0 : 1)"`.
    Expected: Command exits 0 only when the package is publishable and has an export map.
    Evidence: .sisyphus/evidence/task-3-library-metadata.txt
  ```

  **Commit**: NO | Message: `chore(lib): scaffold publishable painting package` | Files: `packages/painting/**`

- [x] 4. Wire package-name consumption across the workspace

  **What to do**: Ensure `apps/playground` consumes the library strictly via the package name `@hamster-note/painting`. Align Metro/Expo, TypeScript, Jest, and package manifests so workspace symlinks resolve consistently without direct relative imports into `packages/painting/src`. Add the minimum alias or transpilation settings needed for Expo monorepo compatibility, but keep resolution centralized and documented in config.
  **Must NOT do**: Do not use relative imports into `packages/painting/src`, duplicate aliases in multiple places without reason, or introduce a second bundler.

  **Recommended Agent Profile**:
  - Category: `unspecified-low` - Reason: multi-config integration across package, Expo, and test layers.
  - Skills: `[]` - No extra skill is required.
  - Omitted: `['/frontend-ui-ux']` - No visual design changes are needed.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 6, 7, 8, 9 | Blocked By: 2, 3

  **References** (executor has NO interview context - be exhaustive):
  - External: `https://docs.expo.dev/guides/monorepos/` - Follow Expo’s monorepo/workspace integration guidance.
  - Pattern: `/home/zhangxiao/frontend/SysUI/chameleon/jest.config.ts` - Mirror its alias-discipline mentality, adapted to Expo instead of Vite.
  - Pattern: `/home/zhangxiao/frontend/SysUI/chameleon/playwright.config.ts` - Keep one canonical app URL and one canonical app entry path.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `node -e "const deps=require('./apps/playground/package.json').dependencies||{}; process.exit(deps['@hamster-note/painting'] ? 0 : 1)"`
  - [ ] `! rg '\.\./\.\./packages|packages/painting/src' apps/playground`

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Example app imports the library by package name only
    Tool: Bash
    Steps: Run `rg '@hamster-note/painting' apps/playground && ! rg '\.\./\.\./packages|packages/painting/src' apps/playground`.
    Expected: Package-name imports exist and relative source imports do not.
    Evidence: .sisyphus/evidence/task-4-package-resolution.txt

  Scenario: Expo monorepo wiring is deterministic
    Tool: Bash
    Steps: Run `yarn workspace @hamster-note/painting-playground expo export -p web`.
    Expected: Expo Web export exits 0, proving the example app can bundle the workspace library for web without relative source hacks.
    Evidence: .sisyphus/evidence/task-4-resolution-web.txt
  ```

  **Commit**: NO | Message: `chore(workspace): wire package consumption` | Files: `apps/playground/**`, `packages/painting/**`, root config files

- [x] 5. Add shared lint, format, and ignore policies

  **What to do**: Add root-level `.gitignore`, ESLint, and Prettier configuration shared across both workspaces. Configure ESLint for TypeScript + React Native/Expo sources and tests, and configure Prettier only as a formatter, not as a second linter. Ensure generated artifacts and runtime outputs are ignored: `node_modules`, `.expo`, `coverage`, `playwright-report`, `test-results`, and `packages/painting/lib`.
  **Must NOT do**: Do not add duplicate package-local lint configs unless a tool requires it, and do not add Stylelint or extra formatting tools.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: root config work with clear file boundaries.
  - Skills: `[]` - No extra skill is required.
  - Omitted: `['/frontend-ui-ux']` - Not a UI concern.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 9 | Blocked By: 1

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `/home/zhangxiao/frontend/SysUI/chameleon/eslint.config.js` - Reuse rule strictness style and unused-variable hygiene.
  - Pattern: `/home/zhangxiao/frontend/SysUI/chameleon/package.json` - Reuse root script naming for lint/format.
  - External: `https://prettier.io/docs/en/configuration.html` - Keep Prettier configuration minimal and standard.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `test -f .gitignore && test -f eslint.config.js && (test -f .prettierrc || test -f .prettierrc.json || test -f prettier.config.js)`
  - [ ] `yarn lint && yarn format:check`

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Shared code-quality commands pass from repo root
    Tool: Bash
    Steps: Run `yarn lint && yarn format:check`.
    Expected: Both commands exit 0 from the root without per-package manual setup.
    Evidence: .sisyphus/evidence/task-5-quality.txt

  Scenario: Ignore rules cover generated and runtime outputs
    Tool: Bash
    Steps: Run `rg 'node_modules|\.expo|coverage|playwright-report|test-results|packages/painting/lib' .gitignore`.
    Expected: All listed entries are present in `.gitignore`.
    Evidence: .sisyphus/evidence/task-5-ignore.txt
  ```

  **Commit**: NO | Message: `chore(tooling): add lint-format-ignore baseline` | Files: `.gitignore`, `eslint.config.js`, Prettier config, `package.json`

- [x] 6. Standardize build, typecheck, and pack automation

  **What to do**: Add one root command for each verification lane: `typecheck`, `build`, `pack:dry`, and `ci:local`. Ensure `build` invokes the publishable library build, `typecheck` covers both the library and the example app, and `pack:dry` runs an npm dry-run for `packages/painting` only. Keep command order identical between `ci:local` and `.github/workflows/ci-pr.yml`.
  **Must NOT do**: Do not make the example app publishable, do not add separate build commands with overlapping responsibilities, and do not require manual directory changes before running scripts.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: root script orchestration with straightforward verification.
  - Skills: `[]` - No extra skill is required.
  - Omitted: `['/frontend-ui-ux']` - No visual work involved.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 9, 10 | Blocked By: 1, 3, 4

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `/home/zhangxiao/frontend/SysUI/chameleon/package.json` - Reuse concise root script naming.
  - Pattern: `/home/zhangxiao/frontend/SysUI/chameleon/.github/workflows/ci-pr.yml` - Mirror the exact verification order locally.
  - External: `https://docs.npmjs.com/cli/v10/commands/npm-pack` - Use package dry-run semantics to verify publish output.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `node -e "const s=require('./package.json').scripts; process.exit(s.build&&s.typecheck&&s['pack:dry']&&s['ci:local'] ? 0 : 1)"`
  - [ ] `yarn typecheck && yarn build && yarn pack:dry`

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Local automation matches the final verification path
    Tool: Bash
    Steps: Run `yarn ci:local`.
    Expected: The command exits 0 and covers lint, unit tests, Playwright, build, and pack dry-run in a single root entrypoint.
    Evidence: .sisyphus/evidence/task-6-ci-local.txt

  Scenario: Only the library package is packable
    Tool: Bash
    Steps: Run `yarn pack:dry` and then `node -e "const root=require('./package.json'); const lib=require('./packages/painting/package.json'); process.exit(root.private===true && lib.private!==true ? 0 : 1)"`.
    Expected: Dry-run succeeds for `packages/painting` and the root package remains private.
    Evidence: .sisyphus/evidence/task-6-pack-dry.txt
  ```

  **Commit**: NO | Message: `chore(scripts): standardize verification commands` | Files: `package.json`, package build configs

- [x] 7. Add Jest smoke coverage for the library package

  **What to do**: Configure Jest with `jest-expo` (or an Expo-compatible preset that resolves Expo/RN packages cleanly) at the root or shared workspace level. Add at least one library smoke test that mounts the placeholder exported component and asserts it renders without props, plus one export-surface smoke test that imports the public package entry instead of deep file paths. Keep UI E2E tests excluded from Jest discovery.
  **Must NOT do**: Do not add snapshot-heavy tests, browser-only assertions, or tests against unimplemented pointer behavior.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: bounded test harness setup with a tiny test surface.
  - Skills: `[]` - No extra skill is required.
  - Omitted: `['/playwright']` - This task is unit/component-level, not browser automation.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 9 | Blocked By: 2, 3, 4

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `/home/zhangxiao/frontend/SysUI/chameleon/jest.config.ts` - Reuse test-path exclusion discipline and setup-file structure.
  - External: `https://docs.expo.dev/develop/unit-testing/` - Use Expo-compatible Jest guidance.
  - External: `https://callstack.github.io/react-native-testing-library/` - Use RN testing utilities instead of browser DOM helpers.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `test -f jest.config.js -o -f jest.config.ts`
  - [ ] `yarn test --runInBand`

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Placeholder component renders through the public package entry
    Tool: Bash
    Steps: Run `yarn test --runInBand --testPathPattern=painting`.
    Expected: Jest exits 0 and includes at least one smoke test covering the public package export.
    Evidence: .sisyphus/evidence/task-7-jest-smoke.txt

  Scenario: Playwright tests stay out of Jest discovery
    Tool: Bash
    Steps: Run `rg 'tests/ui' jest.config.*`.
    Expected: The Jest config explicitly ignores the Playwright test directory.
    Evidence: .sisyphus/evidence/task-7-jest-ignore-ui.txt
  ```

  **Commit**: NO | Message: `test(jest): add library smoke coverage` | Files: `jest.config.*`, `jest.setup.*`, `packages/painting/**/__tests__/**`

- [x] 8. Add Playwright Expo Web smoke E2E

  **What to do**: Configure Playwright at the repo root with `testDir` under `tests/ui`, a fixed `baseURL` of `http://127.0.0.1:8081`, CI-safe retries/workers, and `webServer` pointing to `yarn playground:web`. Start with Chromium in CI. Add one smoke test that opens the Expo Web app, asserts the text `Playground Ready`, and locates the placeholder component by `data-testid="drawing-surface-smoke"`.
  **Must NOT do**: Do not test actual drawing interactions, pointer pressure, touch gestures, or multiple browsers yet.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: small browser-harness setup with one deterministic scenario.
  - Skills: `[]` - No extra skill is required.
  - Omitted: `['/frontend-ui-ux']` - This is smoke automation, not interface design.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 9 | Blocked By: 2, 4

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `/home/zhangxiao/frontend/SysUI/chameleon/playwright.config.ts` - Reuse fixed-port web server, CI retries, and failure-artifact expectations.
  - External: `https://playwright.dev/docs/test-webserver` - Use `webServer` rather than ad-hoc shell orchestration.
  - External: `https://docs.expo.dev/workflow/web/` - Keep the target on Expo Web.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `test -f playwright.config.ts && test -f tests/ui/playground.spec.ts`
  - [ ] `yarn test:ui`

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Expo Web smoke page is exercised by Playwright
    Tool: Bash
    Steps: Run `yarn test:ui`.
    Expected: Playwright exits 0 after asserting `Playground Ready` and `[data-testid="drawing-surface-smoke"]` on the Expo Web page.
    Evidence: .sisyphus/evidence/task-8-playwright-smoke.txt

  Scenario: Broken base URL fails loudly
    Tool: Bash
    Steps: Run `PLAYWRIGHT_BASE_URL=http://127.0.0.1:9999 npx playwright test --config=playwright.config.ts` after implementing config support for `PLAYWRIGHT_BASE_URL` override.
    Expected: The run fails with a connection/readiness error rather than hanging silently.
    Evidence: .sisyphus/evidence/task-8-playwright-failure.txt
  ```

  **Commit**: NO | Message: `test(playwright): add expo web smoke e2e` | Files: `playwright.config.ts`, `tests/ui/**`, `package.json`

- [x] 9. Add PR CI workflow adapted from chameleon

  **What to do**: Create `.github/workflows/ci-pr.yml` modeled on `chameleon` but adapted to this workspace. Use Node 20, `actions/setup-node@v4` with `cache: yarn`, `corepack enable`, `yarn install --frozen-lockfile`, then run `yarn lint`, `yarn test`, `npx playwright install --with-deps chromium`, `yarn test:ui`, `yarn build`, and `yarn pack:dry`. Upload Playwright artifacts on failure and keep concurrency cancellation enabled for PR updates.
  **Must NOT do**: Do not copy irrelevant repo-specific jobs from `chameleon`, and do not add native mobile jobs, docs jobs, or release jobs into the PR workflow.

  **Recommended Agent Profile**:
  - Category: `writing` - Reason: workflow authoring is mostly declarative and reference-driven.
  - Skills: `[]` - No extra skill is required.
  - Omitted: `['/git-master']` - No git-history operation is needed.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: Final verification wave | Blocked By: 1, 4, 5, 6, 7, 8

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `/home/zhangxiao/frontend/SysUI/chameleon/.github/workflows/ci-pr.yml` - Primary structural reference.
  - Pattern: `/home/zhangxiao/frontend/SysUI/chameleon/playwright.config.ts` - Match artifact/debug expectations.
  - External: `https://playwright.dev/docs/ci-intro` - Keep CI browser installation aligned with Playwright guidance.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `test -f .github/workflows/ci-pr.yml`
  - [ ] `node -e "const fs=require('fs'); const s=fs.readFileSync('.github/workflows/ci-pr.yml','utf8'); const keys=['cache: yarn','corepack enable','yarn install --frozen-lockfile','yarn lint','yarn test','playwright install --with-deps chromium','yarn test:ui','yarn build','yarn pack:dry']; process.exit(keys.every(k=>s.includes(k)) ? 0 : 1)"`

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: PR workflow mirrors local verification order
    Tool: Bash
    Steps: Run `node -e "const fs=require('fs'); const s=fs.readFileSync('.github/workflows/ci-pr.yml','utf8'); const keys=['yarn lint','yarn test','yarn test:ui','yarn build','yarn pack:dry']; const ok=keys.every(k=>s.includes(k)) && keys.every((k,i)=>i===0 || s.indexOf(keys[i-1]) < s.indexOf(k)); process.exit(ok ? 0 : 1)"`.
    Expected: Workflow contains the same ordered stages as `yarn ci:local`.
    Evidence: .sisyphus/evidence/task-9-ci-pr-order.txt

  Scenario: Failure artifacts are preserved for browser debugging
    Tool: Bash
    Steps: Run `node -e "const fs=require('fs'); const s=fs.readFileSync('.github/workflows/ci-pr.yml','utf8'); const keys=['upload-artifact','playwright-report','test-results']; process.exit(keys.every(k=>s.includes(k)) ? 0 : 1)"`.
    Expected: Workflow uploads Playwright failure artifacts instead of dropping them.
    Evidence: .sisyphus/evidence/task-9-ci-pr-artifacts.txt
  ```

  **Commit**: NO | Message: `ci(pr): add bootstrap verification workflow` | Files: `.github/workflows/ci-pr.yml`

- [x] 10. Add publish workflow skeleton for the library package

  **What to do**: Create `.github/workflows/publish.yml` modeled on `chameleon` but scoped to this repo. Trigger on the chosen release branch convention (reuse `version/*` unless the user later changes branch policy). Publish only `packages/painting`, keep the root private, and include tag/provenance placeholders without hardcoding credentials. Reuse the same build and pack assumptions proven locally.
  **Must NOT do**: Do not publish the example app, do not wire real secrets into the repo, and do not add multi-registry release logic.

  **Recommended Agent Profile**:
  - Category: `writing` - Reason: declarative workflow setup following an existing reference.
  - Skills: `[]` - No extra skill is required.
  - Omitted: `['/git-master']` - No repository-history work is involved.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: Final verification wave | Blocked By: 1, 3, 6

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `/home/zhangxiao/frontend/SysUI/chameleon/.github/workflows/publish.yml` - Primary publishing reference.
  - Pattern: `/home/zhangxiao/frontend/SysUI/chameleon/package.json` - Reuse publish-script discipline where applicable.
  - External: `https://docs.github.com/actions/publishing-packages/publishing-nodejs-packages` - Keep workflow aligned with GitHub Actions package publishing guidance.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `test -f .github/workflows/publish.yml`
  - [ ] `node -e "const fs=require('fs'); const s=fs.readFileSync('.github/workflows/publish.yml','utf8'); const keys=['version/','npm publish','NPM_TOKEN','packages/painting']; process.exit(keys.every(k=>s.includes(k)) ? 0 : 1)"`

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Publish workflow is scoped to the library package
    Tool: Bash
    Steps: Run `node -e "const fs=require('fs'); const s=fs.readFileSync('.github/workflows/publish.yml','utf8'); const root=require('./package.json'); const lib=require('./packages/painting/package.json'); const ok=s.includes('packages/painting') && s.includes('npm publish') && root.private===true && lib.private!==true; process.exit(ok ? 0 : 1)"`.
    Expected: The workflow targets only the library package and the root package remains private.
    Evidence: .sisyphus/evidence/task-10-publish-scope.txt

  Scenario: Release workflow follows the agreed branch convention
    Tool: Bash
    Steps: Run `rg 'version/\*' .github/workflows/publish.yml`.
    Expected: The workflow only triggers on the release-branch pattern chosen in the plan.
    Evidence: .sisyphus/evidence/task-10-publish-branch.txt
  ```

  **Commit**: NO | Message: `ci(release): add library publish workflow` | Files: `.github/workflows/publish.yml`

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit — oracle

  **What to do**: Launch an `oracle` review against the implementation diff plus this plan file. The review must verify that Tasks 1-10 were completed, no mandatory deliverable is missing, and the implemented scripts/config paths still match this plan’s decisions.
  **Must NOT do**: Do not accept partial completion, inferred completion, or “close enough” substitutions for missing tasks.

  **Recommended Agent Profile**:
  - Agent: `oracle` - Reason: strict goal/constraint verification against the approved plan.
  - Skills: `[]` - No extra skill is required.
  - Omitted: `['/frontend-ui-ux']` - This is a conformance audit, not design review.

  **Parallelization**: Can Parallel: YES | Wave Final | Blocks: completion | Blocked By: 1-10

  **Acceptance Criteria** (agent-executable only):
  - [ ] Oracle returns an explicit PASS/APPROVE result against `.sisyphus/plans/expo-component-library-init.md`.
  - [ ] Any failed task number reported by Oracle is fixed and the audit is re-run before completion.

  **QA Scenarios**:
  ```
  Scenario: Plan compliance passes
    Tool: task(oracle)
    Steps: Ask Oracle to compare the implemented diff, generated files, and root scripts against `.sisyphus/plans/expo-component-library-init.md`, returning PASS/FAIL per task 1-10.
    Expected: Oracle returns PASS/APPROVE with no unaddressed task gaps.
    Evidence: .sisyphus/evidence/f1-plan-compliance.md

  Scenario: Plan compliance fails safely
    Tool: task(oracle)
    Steps: If Oracle reports any missing or divergent task, mark F1 incomplete, reopen the referenced implementation tasks, apply fixes, and rerun the same Oracle audit.
    Expected: Work is not marked complete until the rerun returns PASS/APPROVE.
    Evidence: .sisyphus/evidence/f1-plan-compliance-rerun.md
  ```

- [x] F2. Code Quality Review — oracle

  **What to do**: Launch a hands-on code-quality review covering config clarity, script ergonomics, duplication, and unnecessary complexity across root, library, example app, and workflow files.
  **Must NOT do**: Do not treat passing tests as sufficient evidence of maintainability.

  **Recommended Agent Profile**:
  - Agent: `oracle` - Reason: cross-file review with explicit reasoning over maintainability and bootstrap quality.
  - Skills: `[]` - No extra skill is required.
  - Omitted: `['/playwright']` - This review is broader than browser automation.

  **Parallelization**: Can Parallel: YES | Wave Final | Blocks: completion | Blocked By: 1-10

  **Acceptance Criteria** (agent-executable only):
  - [ ] Reviewer returns APPROVE or an empty blocker list for code-quality concerns.
  - [ ] Any blocker about duplication, dead config, or unclear scripts is fixed and re-reviewed.

  **QA Scenarios**:
  ```
  Scenario: Code quality review passes
    Tool: task(subagent_type="oracle")
    Steps: Review the changed root config, `apps/playground`, `packages/painting`, and `.github/workflows/*` for unnecessary complexity, config duplication, and script clarity.
    Expected: Reviewer returns APPROVE or no blocking issues.
    Evidence: .sisyphus/evidence/f2-code-quality.md

  Scenario: Code quality blockers are recycled through review
    Tool: task(subagent_type="oracle")
    Steps: If review reports blockers, fix them, then rerun the same review scope until APPROVE/no blockers is returned.
    Expected: Final review output contains no remaining blocking quality issues.
    Evidence: .sisyphus/evidence/f2-code-quality-rerun.md
  ```

- [x] F3. Real Manual QA — unspecified-high (+ playwright if UI)

  **What to do**: Execute the real verification commands end-to-end from a clean working tree: install, lint, format check, typecheck, build, Jest, Playwright, and package dry-run. Capture the exact command outputs and Playwright artifacts.
  **Must NOT do**: Do not replace execution with static inspection or skip failing commands.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: this is an execution-heavy validation pass.
  - Skills: `[]` - No extra skill is required.
  - Omitted: `['/frontend-ui-ux']` - The goal is functional verification, not UI polish.

  **Parallelization**: Can Parallel: YES | Wave Final | Blocks: completion | Blocked By: 1-10

  **Acceptance Criteria** (agent-executable only):
  - [ ] `corepack enable && yarn install --frozen-lockfile && yarn lint && yarn format:check && yarn typecheck && yarn build && yarn test && yarn test:ui && yarn pack:dry` exits `0`.
  - [ ] Playwright evidence and command logs are saved under `.sisyphus/evidence/`.

  **QA Scenarios**:
  ```
  Scenario: Full root verification passes
    Tool: Bash
    Steps: Run `corepack enable && yarn install --frozen-lockfile && yarn lint && yarn format:check && yarn typecheck && yarn build && yarn test && yarn test:ui && yarn pack:dry`.
    Expected: Entire sequence exits 0 without manual intervention.
    Evidence: .sisyphus/evidence/f3-full-verification.txt

  Scenario: Verification failure is surfaced, fixed, and rerun
    Tool: Bash
    Steps: If any command in the verification chain fails, stop the wave, fix the failure, and rerun the full chain from the beginning.
    Expected: Completion remains blocked until a full clean rerun exits 0.
    Evidence: .sisyphus/evidence/f3-full-verification-rerun.txt
  ```

- [x] F4. Scope Fidelity Check — oracle

  **What to do**: Launch a `general` review focused only on scope fidelity: confirm the repo contains bootstrap/tooling work only, and did not drift into drawing implementation, pointer-event API design, extra packages, or extra app/product work.
  **Must NOT do**: Do not approve if feature logic, extra tooling, or unsupported platforms slipped in during implementation.

  **Recommended Agent Profile**:
  - Agent: `oracle` - Reason: broad cross-check of delivered scope versus requested scope.
  - Skills: `[]` - No extra skill is required.
  - Omitted: `['/frontend-ui-ux']` - This is a scope check, not a product critique.

  **Parallelization**: Can Parallel: YES | Wave Final | Blocks: completion | Blocked By: 1-10

  **Acceptance Criteria** (agent-executable only):
  - [ ] Reviewer confirms no drawing implementation, no pointer behavior work, and no forbidden tooling/platform additions.
  - [ ] Any detected scope leak is removed and the scope-fidelity review is rerun.

  **QA Scenarios**:
  ```
  Scenario: Scope fidelity passes
    Tool: task(subagent_type="oracle")
    Steps: Review the implementation diff for forbidden additions: drawing logic, pointer/touch/pen behavior work, Vite, Storybook, native E2E, extra packages, or product UI beyond the smoke screen.
    Expected: Reviewer confirms the delivered work stays within bootstrap scope.
    Evidence: .sisyphus/evidence/f4-scope-fidelity.md

  Scenario: Scope leak is rejected and corrected
    Tool: task(subagent_type="oracle")
    Steps: If review finds feature or tooling scope creep, remove the out-of-scope work and rerun the same scope-fidelity review.
    Expected: No scope-leak findings remain in the final review output.
    Evidence: .sisyphus/evidence/f4-scope-fidelity-rerun.md
  ```

## Commit Strategy
- Produce one final commit after the user approves the final verification wave.
- Use a single scoped message: `chore(init): bootstrap expo component library workspace`.
- Do not create intermediate commits during bootstrap unless the user explicitly asks.

## Success Criteria
- A fresh clone can install with Yarn from the repo root and run all root verification scripts successfully.
- The example app runs on Expo Web and consumes the library via package-name imports only.
- The library package builds, typechecks, tests, and passes `yarn pack:dry`.
- CI workflows mirror the local command order and do not depend on undocumented manual steps.
