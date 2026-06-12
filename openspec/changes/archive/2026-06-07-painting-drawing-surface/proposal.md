# Proposal: Painting Drawing Surface Component Library

## Why

This project bootstrapped a publishable React Native component library (`@hamster-note/painting`) with an Expo Web example app, then iteratively built a Web-first `DrawingSurface` component with pen drawing, pressure sensitivity, and shape tools (rect/line).

### Background

The repository started empty (only `LICENSE`). The goal was to create a workspace-first, publishable React Native component library that could be developed and smoke-tested through an Expo Web example app. After bootstrap, the focus shifted to implementing a drawing surface using `@system-ui-js/multi-drag` for gesture handling.

### Problems Addressed

- **Empty repo → Workspace bootstrap**: Needed Yarn workspaces, TypeScript, ESLint, Prettier, Jest, Playwright, and CI adapted from the `chameleon` reference repo.
- **Placeholder component → Real drawing surface**: The initial `DrawingSurface` was a smoke fixture; it needed to become a functional Web drawing component.
- **Pen-only → Multi-tool support**: Phase 1 supported only pen; later phases added rect and line tools.
- **Uniform strokes → Pressure-sensitive drawing**: Added opt-in pressure capture from `FingerPathItem.pressure` for variable-width pen strokes.

## What Changes

### Phase 1: Workspace Bootstrap (expo-component-library-init)
- Root Yarn workspace with `apps/*` and `packages/*` globs
- Publishable library package at `packages/painting`
- Expo example app at `apps/playground` with web runtime
- Shared ESLint, Prettier, Jest, Playwright configuration
- PR CI and publish workflow skeletons

### Phase 2: Pen Drawing (multi-drag-component-pen)
- Replaced placeholder with Web-first `DrawingSurface` using `@system-ui-js/multi-drag`
- Added public drawing types: `DrawingTool`, `DrawingPoint`, `DrawingStroke`, `DrawingValue`
- Implemented controlled and uncontrolled drawing value contracts
- Added SVG polyline rendering for pen strokes
- Playground demos for both modes with Playwright coverage

### Phase 3: Rect/Line Tools (rect-line-tools-demo-props)
- Extended `DrawingTool` to `'pen' | 'line' | 'rect'`
- Added `strokeColor` and `strokeWidth` surface-level props
- Implemented normalized rectangle rendering from drag bounds
- Added shared playground controls for tool, color, and width

### Phase 4: Pressure Sensitivity (multi-drag-pressure)
- Upgraded `@system-ui-js/multi-drag` to `0.4.0`
- Added `pressure?: boolean` prop to `DrawingSurfaceProps`
- Captured pressure from `FingerPathItem.pressure` for pen strokes
- Implemented per-segment SVG rendering with varying `stroke-width`
- Playground pressure toggle with Playwright coverage

## Capabilities

- [x] Web-first drawing surface with drag gesture support
- [x] Pen, line, and rectangle drawing tools
- [x] Controlled and uncontrolled drawing value APIs
- [x] Pressure-sensitive pen strokes (opt-in)
- [x] SVG-based rendering with responsive sizing
- [x] Playground demo with tool switching, color, width, and pressure controls
- [x] Jest unit tests for component and helper logic
- [x] Playwright E2E tests for drawing interactions
- [x] CI/CD with PR validation and publish workflow
- [x] Publishable package with TypeScript declarations

## Impact

- **Packages**: `packages/painting` is the primary deliverable
- **Apps**: `apps/playground` serves as the example app and QA fixture
- **Tooling**: Root-level ESLint, Prettier, Jest, Playwright, and CI workflows
- **Dependencies**: `@system-ui-js/multi-drag` for gesture handling, React 18/19, Expo 52
- **Breaking Changes**: None (backward-compatible API expansion)
