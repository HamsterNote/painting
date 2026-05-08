# learnings.md

## Root workspace setup (2026-05-08)

### Pattern: Yarn classic workspace root
- `private: true` - root must be private
- `packageManager: "yarn@1.22.22"` - pins Yarn version
- `workspaces: ["apps/*", "packages/*"]` - classic Yarn globs

### Reference from chameleon
- Script naming: `lint`, `format`, `test`, `test:ui`, `dev`, `build`
- CI order: install → lint → test → playwright → build → pack dry-run
- Dev deps include: eslint, prettier, typescript, jest, @playwright/test

### Scripts defined
- `lint`: `eslint .` - works across workspaces
- `format:check`: `prettier --check .`
- `format`: `prettier --write .`
- `typecheck`: `yarn workspaces run typecheck`
- `build`: `yarn workspaces run build`
- `test`: `jest --runInBand`
- `test:ui`: `playwright test --config=playwright.config.ts`
- `ci:local`: `yarn install && yarn lint && yarn test && yarn test:ui && yarn build && yarn pack:dry`
- `pack:dry`: `cd packages/painting && npm pack --dry-run`
- `playground:web`: `yarn workspace @hamster-note/painting-playground expo start --web --port 8081`

### Note
- @hamster-note/painting = library package
- @hamster-note/painting-playground = example app
- Both will live under workspaces but not created in this task

## Painting package scaffold (2026-05-08)

### Package metadata pattern
- Publishable package at `packages/painting` uses explicit `main`, `module`, `types`, and `react-native` fields.
- `exports["."]` maps `import`, `require`, `types`, and `react-native` for RN-friendly resolution.
- `files` includes `lib` and `src` so build artifacts and RN source entry are both shippable.

### Build tooling pattern
- `react-native-builder-bob` configured in `package.json` with `source: "src"`, `output: "lib"`, targets `commonjs`, `module`, `typescript`.
- Library scripts kept minimal: `build` and `typecheck` only.

### Skeleton component pattern
- `DrawingSurface` is intentionally inert and only verifies package wiring for the example app.
- Component accepts `testID` and renders `View` + `Text` without any drawing or gesture logic.

## Root lint/format/ignore config (2026-05-08)

### Files created
- `.gitignore` - ignores node_modules, .expo, coverage, playwright-report, test-results, packages/painting/lib, dist, build, .DS_Store, *.log, .idea, .vscode, yarn-error.log, .metro-health-check*
- `eslint.config.js` - flat config with @eslint/js, typescript-eslint, eslint-plugin-react, eslint-plugin-react-hooks, eslint-plugin-jest, eslint-config-prettier
- `.prettierrc` - semi:true, singleQuote:true, trailingComma:"es5", printWidth:100, tabWidth:2

### package.json updates
- Added `"type": "module"` for ESM support (required by eslint.config.js)
- Added `eslint-plugin-react: ^7.37.2`
- Added `eslint-plugin-react-hooks: ^5`

### ESLint config pattern
- Uses flat config format (eslint.config.js)
- Ignores node_modules, .expo, lib, dist, build, coverage, playwright-report, test-results, .vscode, .idea
- Custom rule: `@typescript-eslint/no-unused-vars` with `argsIgnorePattern: '^_'` and `varsIgnorePattern: '^_'`
- Prettier integration via `eslint-config-prettier` to disable conflicting rules (NOT eslint-plugin-prettier which makes Prettier act as linter)

### Reference from chameleon
- Same rule strictness style (recommended rules + unused-vars pattern)
- Same devDependencies pattern for ESLint/Prettier
## Expo Playground App Setup (2026-05-08)

### Files created in apps/playground/
- `package.json` - Expo 52, react-native 0.76.5, react-native-web 0.19
- `app.json` - Expo config with web bundler set to metro
- `App.tsx` - Smoke screen with "Playground Ready" text + testID="drawing-surface-smoke"
- `index.js` - Entry point using registerRootComponent
- `tsconfig.json` - Extends expo/tsconfig.base
- `metro.config.js` - Monorepo support with watchFolders = ['../../']
- `babel.config.js` - Standard expo babel preset
- `assets/` - Placeholder PNGs (icon, splash, adaptive-icon, favicon)

### App.tsx imports
- Uses `PaintingCanvas` from `@hamster-note/painting` (will fail until library is created)
- This is intentional per requirements - import exists for later integration

### Metro monorepo config
- `config.watchFolders = ['../../']` - ensures Metro watches root workspace
- Required for @hamster-note/painting imports to resolve in dev

## Workspace package-name wiring (2026-05-08)

### Dependency declaration pattern
- Playground must declare `"@hamster-note/painting": "*"` in `apps/playground/package.json` for workspace symlink resolution.

### Expo SDK 52 monorepo Metro pattern
- With `expo/metro-config` on SDK 52+, custom `watchFolders` is unnecessary; keep `metro.config.js` minimal (`getDefaultConfig(__dirname)`) to centralize resolution behavior.

### Type resolution gotcha
- `packages/painting/package.json` `types` and `exports["."].types` must point to `lib/typescript/index.d.ts` (not `lib/typescript/src/index.d.ts`) so downstream app typecheck resolves.

## Playwright Expo Web smoke E2E (2026-05-08)

### Files created
- `playwright.config.ts` at repo root with CI-safe config, webServer for `yarn playground:web`, baseURL `http://127.0.0.1:8081`
- `tests/ui/playground.spec.ts` with single smoke test verifying "Playground Ready" text and `data-testid="drawing-surface-smoke"`

### Config highlights
- `testDir: 'tests/ui'`
- `forbidOnly: isCI`, `retries: isCI ? 2 : 0`, `workers: isCI ? 1 : undefined`
- `webServer.command: 'yarn playground:web'` (not `yarn dev:vite` like chameleon)
- `webServer.reuseExistingServer: !isCI` - allows reuse in dev but forces fresh in CI
- `PLAYWRIGHT_BASE_URL` env var override supported
- Chromium-only project (no multi-browser yet)

### Test design
- Simple smoke: navigate to `/`, assert text "Playground Ready", assert `getByTestId('drawing-surface-smoke')` visible
- No drawing interactions, pointer pressure, or touch gestures (scope limitation per task)

## Build and typecheck standardization (2026-05-08)

### Root package.json script changes
- `typecheck`: Changed from `yarn workspaces run typecheck` to explicit workspace chain:
  - `yarn workspace @hamster-note/painting typecheck && yarn workspace @hamster-note/painting-playground tsc --noEmit`
  - This ensures the publishable library builds first, then the example app
- `build`: Changed from `yarn workspaces run build` to `yarn workspace @hamster-note/painting build`
  - Only builds the publishable library, not the example app (which uses Expo's dev server)

### Playground package.json changes
- Added `typecheck: "tsc --noEmit"` script to enable root `typecheck` to pass

### Library package.json changes
- Added `@types/jest: ^29.5.12` to devDependencies for bob build's typescript target

### Library tsconfig.json changes
- Added `"rootDir": "src"` to resolve bob build TS2209 error ("project root is ambiguous")
- Added `"jest"` to types array to resolve TS2593 errors ("Cannot find name 'describe'")

### Verification
- All commands work: `yarn typecheck`, `yarn build`, `yarn pack:dry`, `yarn ci:local`
- Script existence check passes: `node -e "const s=require('./package.json').scripts; process.exit(s.build&&s.typecheck&&s['pack:dry']&&s['ci:local'] ? 0 : 1)"` exits 0

### Command order in ci:local
- Order matches ci-pr.yml: `install → lint → test → test:ui → build → pack:dry`
- This ensures CI and local runs are consistent

## Jest smoke coverage setup (2026-05-08)

### Files created
- `jest.config.js` - Jest configuration using babel-jest transformer
- `babel.config.cjs` - Babel config for Jest transforms (CommonJS for ESM compatibility)
- `jest.setup.js` - Minimal setup file (just imports react)
- `jest.mockRN.js` - React Native mock for testing
- `tsconfig.json` - Root TypeScript config for Jest
- `packages/painting/src/__tests__/DrawingSurface.test.tsx` - Smoke tests

### Jest configuration highlights
- Uses `babel-jest` with `@babel/preset-env`, `@babel/preset-react`, `@babel/preset-typescript`
- `moduleNameMapper` maps `react-native` to `jest.mockRN.js` and `@hamster-note/painting` to library source
- `testPathIgnorePatterns` excludes `/node_modules/`, `/dist/`, `/lib/`, `/apps/`, `/tests/ui/`
- `roots` set to `['<rootDir>/packages']` to only run tests in the packages directory

### Important gotchas
- `package.json` has `"type": "module"` which makes all `.js` files ES modules
- `babel.config.js` must be renamed to `babel.config.cjs` because Jest runs in CommonJS mode
- `react-test-renderer@19` has issues with React 18.3.1 installed in workspace - use `react-test-renderer@18.3.1`
- `react-test-renderer` doesn't properly render React Native components - tests verify component is callable rather than rendered output
- `@testing-library/react-native` has version conflicts with React 19 - not used in final setup

### DevDependencies added for Jest
- `@babel/preset-env: ^7.24.0`
- `@babel/preset-react: ^7.24.0`
- `@babel/preset-typescript: ^7.24.0`
- `babel-jest: ^29.7.0`
- `react-test-renderer: ^18.3.1`

### Test structure
- 4 smoke tests verifying DrawingSurface:
  1. Is a function (exported correctly from component file)
  2. Is a function when imported from index (public package entry)
  3. Accepts testID prop
  4. Renders without props

### Verification
- `test -f jest.config.js` exits 0
- `yarn test --runInBand` exits 0 with all 4 tests passing
- `tests/ui/` is properly excluded from Jest discovery

## CI Workflow (PR CI) - 2026-05-08

Created `.github/workflows/ci-pr.yml` modeled from chameleon with adaptations:
- Uses `yarn pack:dry` instead of `npm pack --dry-run` to match root `package.json` script
- All other structure identical: Node 20, cache: yarn, corepack, frozen-lockfile
- Playwright artifact uploads on failure only (install-playwright or run-playwright-ui-tests step failure)
- Concurrency cancellation enabled with `group: pr-${{ github.event.pull_request.head.sha }}`
- Workflow order matches `ci:local` script: install → lint → test → Playwright → build → pack dry-run

## Publish Workflow (version branches) - 2026-05-08

Created `.github/workflows/publish.yml` modeled from chameleon with repo-specific adaptations:
- Trigger: `push` to `version/*` branches only
- Reads package metadata from `packages/painting/package.json` (not root)
- Builds at root with `yarn build` (root script targets the library workspace)
- Publishes only from `packages/painting` directory (root is `private: true`)
- Dist-tag logic: `-dev` suffix → `dev`, `-beta` suffix → `beta`, else `latest`
- Includes version-already-published guard to avoid duplicate publishes
- Includes pre-release dist-tag ensure step for dev/beta
- Uses `secrets.NPM_TOKEN` placeholder (no hardcoded credentials)

### Key differences from chameleon reference
- All `package.json` reads use `packages/painting/package.json` path
- Publish step does `cd packages/painting && npm publish` instead of root-level publish
- Root workspace `@hamster-note/painting-workspace` stays private and is never published

### Verification
- `test -f .github/workflows/publish.yml` exits 0
- Required keys check passes: `version/`, `npm publish`, `NPM_TOKEN`, `packages/painting`

## F4 Scope Fidelity Check - 2026-05-08
- Result: APPROVE. Targeted searches found no drawing/canvas/pointer logic, no Vite/Storybook/Changesets/Turbo/native E2E tooling, no forbidden drawing-related dependencies, and only the planned bootstrap workspace/app/library smoke surface.
- 2026-05-08: F2 review approved: PR CI now runs `yarn typecheck`; root scripts are clear; ESLint config has no blocking duplication.

## F1 Plan Compliance Audit - 2026-05-08
- PASS: `expo export -p web`, `yarn test --runInBand`, fixed-port `CI=1 yarn playground:web`, frozen install, full verification chain, CI workflow key/order checks, and app package-name import guard all passed.
- Note: Expo CLI is verified without `--non-interactive`; `CI=1` works for non-interactive startup on port 8081.
- Non-blocking: Bob build emits export-map warnings, but exits 0 and dry pack includes built JS plus typings.
