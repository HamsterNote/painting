# Design: Expo Component Library Initialization

## Context

- **Original Request**: Initialize project with TS + Expo, ESLint, Prettier, yarn, `.gitignore`, Jest, Playwright
- **Workspace Topology**: Locked to Yarn classic workspaces (`yarn@1.22.22`) to match `chameleon` and minimize config overhead
- **Package-name imports**: From the example app, with `yarn pack --dry-run` verifying publishability separately
- **Excluded**: Vite, Storybook, Changesets, native E2E, and drawing-feature implementation to keep bootstrap scope tight

## Goals / Non-Goals

### Goals
- Convert empty repo into minimal workspace-first, publishable React Native component library project
- Expo Web example app for smoke-testing through Playwright
- Jest unit/component smoke coverage and Playwright Expo Web smoke E2E
- PR CI and publish workflow skeletons adapted from `chameleon`

### Non-Goals
- No drawing logic, canvas logic, pointer gesture handling, pressure/tilt support, or event API design
- No Storybook, Changesets, Turbo, semantic-release, docs site, Vite, or native iOS/Android E2E
- No relative source imports from example app into `packages/painting/src`
- No multi-package expansion beyond one publishable library package and one Expo example app
- No placeholder feature work beyond the minimum export skeleton needed for build/test/smoke coverage

## Decisions

### Decision 1: Yarn Classic Workspaces
- **Decision**: Use `yarn@1.22.22` with classic workspaces (`workspaces: ["apps/*", "packages/*"]`)
- **Reason**: Match `chameleon` reference and minimize config overhead
- **Alternatives considered**: pnpm, bun, npm workspaces, Yarn Berry
- **Why rejected**: All other options create scaffold drift from the reference pattern

### Decision 2: Package-name Imports Only
- **Decision**: Example app consumes library via `@hamster-note/painting` package name, not relative paths
- **Reason**: Ensures publishability verification and proper workspace symlink resolution
- **Alternatives considered**: Relative imports into `packages/painting/src`
- **Why rejected**: Would bypass package publishability checks and break monorepo isolation

### Decision 3: Expo Web for E2E
- **Decision**: Use Expo Web with fixed port `8081` for Playwright testing
- **Reason**: Playwright requires web runtime; Expo Web provides deterministic bundling
- **Alternatives considered**: Vite, separate web bundler
- **Why rejected**: Vite not needed for Expo workspace; adding second bundler increases complexity

### Decision 4: Test Strategy - Tests After
- **Decision**: Use `jest-expo` for unit/component smoke coverage and Playwright for Expo Web E2E
- **Reason**: Zero human intervention verification - all verification is agent-executed
- **Alternatives considered**: Test-driven development, manual testing
- **Why rejected**: Bootstrap scope requires deterministic automated verification

### Decision 5: CI Order Mirror
- **Decision**: CI order: install → lint → test → Playwright → build → pack dry-run
- **Reason**: Local `ci:local` and `.github/workflows/ci-pr.yml` must be identical
- **Alternatives considered**: Different order for CI vs local
- **Why rejected**: Consistency requirement for reproducible verification

## Risks / Trade-offs

### Risk 1: Metro Monorepo Configuration
- **Risk**: Expo SDK 52+ Metro resolution behavior changes with monorepo workspaces
- **Mitigation**: Keep `metro.config.js` minimal (`getDefaultConfig(__dirname)`) to centralize resolution

### Risk 2: TypeScript Configuration Ambiguity
- **Risk**: Bob build TS2209 "project root is ambiguous" error
- **Mitigation**: Add `"rootDir": "src"` to library `tsconfig.json`

### Risk 3: ESM/CommonJS Interop
- **Risk**: `package.json` has `"type": "module"` making `.js` files ES modules
- **Mitigation**: Rename `babel.config.js` to `babel.config.cjs` for Jest CommonJS mode

### Risk 4: React/RN Version Conflicts
- **Risk**: `react-test-renderer@19` has issues with React 18.3.1
- **Mitigation**: Use `react-test-renderer@18.3.1`

### Risk 5: Expo CLI Interactive Mode
- **Risk**: `--non-interactive` flag not in final `playground:web` script
- **Mitigation**: Use `CI=1` env var for non-interactive startup on port 8081

## Migration Plan

N/A - Initial project bootstrap, no migration required

## Execution Summary

### Wave 1 (Tasks 1-5)
- Task 1: Establish root workspace contract
- Task 2: Scaffold Expo example app workbench
- Task 3: Scaffold the publishable library package
- Task 4: Wire package-name consumption across the workspace
- Task 5: Add shared lint, format, and ignore policies

### Wave 2 (Tasks 6-10)
- Task 6: Standardize build, typecheck, and pack automation
- Task 7: Add Jest smoke coverage for the library package
- Task 8: Add Playwright Expo Web smoke E2E
- Task 9: Add PR CI workflow adapted from chameleon
- Task 10: Add publish workflow skeleton for the library package

### Final Verification Wave (F1-F4)
- F1: Plan Compliance Audit
- F2: Code Quality Review
- F3: Real Manual QA
- F4: Scope Fidelity Check

All tasks completed successfully. Final verification passed with full verification chain completing.