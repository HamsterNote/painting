# Tasks: Expo Component Library Initialization

## Tasks

### Plan: expo-component-library-init

- [x] 1. Establish root workspace contract
  - Create root `package.json` as private Yarn classic workspace root pinned to `yarn@1.22.22`
  - Define workspace globs as `apps/*` and `packages/*`
  - Add root scripts: `lint`, `format:check`, `typecheck`, `build`, `test`, `test:ui`, `ci:local`, `pack:dry`, `playground:web`
  - Ensure `ci:local` runs same command order as CI

- [x] 2. Scaffold Expo example app workbench
  - Create `apps/playground` as single Expo example app with Expo + TypeScript template
  - Enable Expo Web with `yarn playground:web` command on port 8081
  - Add minimal smoke screen with "Playground Ready" text and `data-testid="drawing-surface-smoke"`

- [x] 3. Scaffold the publishable library package
  - Create `packages/painting` as publishable package
  - Configure React Native-compatible metadata: `main`, `module`, `types`, `react-native`, `exports`
  - Use `react-native-builder-bob` for library builds
  - Add minimum public export skeleton: `src/index.ts` + placeholder component

- [x] 4. Wire package-name consumption across the workspace
  - Ensure `apps/playground` consumes library via `@hamster-note/painting` package name only
  - No relative imports into `packages/painting/src`
  - Align Metro/Expo, TypeScript, Jest, and package manifests

- [x] 5. Add shared lint, format, and ignore policies
  - Add root-level `.gitignore`, ESLint, and Prettier configuration
  - Configure ESLint for TypeScript + React Native/Expo sources and tests
  - Ignore generated artifacts: `node_modules`, `.expo`, `coverage`, `playwright-report`, `test-results`, `packages/painting/lib`

- [x] 6. Standardize build, typecheck, and pack automation
  - Add root commands: `typecheck`, `build`, `pack:dry`, `ci:local`
  - `build` invokes library build
  - `pack:dry` runs npm dry-run for `packages/painting` only
  - Command order identical between `ci:local` and `ci-pr.yml`

- [x] 7. Add Jest smoke coverage for the library package
  - Configure Jest with `jest-expo` or Expo-compatible preset
  - Add library smoke tests: mount placeholder component, assert renders without props
  - Add export-surface smoke test using public package entry
  - Exclude Playwright tests from Jest discovery

- [x] 8. Add Playwright Expo Web smoke E2E
  - Configure Playwright at repo root with `testDir` under `tests/ui`
  - Fixed `baseURL` `http://127.0.0.1:8081`, CI-safe retries/workers
  - `webServer` pointing to `yarn playground:web`
  - Chromium-only in CI
  - One smoke test: opens Expo Web app, asserts "Playground Ready" and `data-testid="drawing-surface-smoke"`

- [x] 9. Add PR CI workflow adapted from chameleon
  - Create `.github/workflows/ci-pr.yml` modeled on `chameleon`
  - Node 20, `actions/setup-node@v4` with `cache: yarn`, `corepack enable`, `yarn install --frozen-lockfile`
  - Order: install → lint → test → Playwright install/test → build → pack dry-run
  - Upload Playwright artifacts on failure
  - Concurrency cancellation enabled

- [x] 10. Add publish workflow skeleton for the library package
  - Create `.github/workflows/publish.yml` modeled on `chameleon`
  - Trigger on `version/*` branches
  - Publish only `packages/painting`, root stays private
  - Tag/provenance placeholders without hardcoded credentials

### Final Verification Wave

- [x] F1. Plan Compliance Audit
  - Verify Tasks 1-10 completed
  - No missing mandatory deliverables
  - Implemented scripts/config paths match plan decisions

- [x] F2. Code Quality Review
  - Config clarity, script ergonomics, duplication, unnecessary complexity
  - Cross-file review: root, library, example app, workflow files

- [x] F3. Real Manual QA
  - Execute full verification chain end-to-end from clean working tree
  - Capture exact command outputs and Playwright artifacts

- [x] F4. Scope Fidelity Check
  - Confirm repo contains bootstrap/tooling work only
  - No drawing implementation, pointer-event API design, extra packages, or extra app/product work