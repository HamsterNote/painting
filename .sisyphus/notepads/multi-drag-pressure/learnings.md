# Multi-Drag Pressure Feature - Learnings

## Codebase Conventions
- Package: `@hamster-note/painting` at `packages/painting/`
- Uses yarn workspaces
- TypeScript with `tsc --noEmit` for typecheck
- Jest for unit tests, Playwright for UI tests
- Local type shim at `packages/painting/src/multi-drag.d.ts`
- DrawingSurface uses `@system-ui-js/multi-drag` Drag class with Move/AllEnd events

## Current State
- `multi-drag` dependency is `"*"` in package.json
- `DrawingPoint` only has `x, y` (no pressure)
- `TimedDrawingPoint` extends `DrawingPoint` with `timestamp?: number`
- `createVelocityAdaptivePoints` strips all extra fields, only keeps `x, y`
- Pen strokes render as single `<path>` via `pointsToSvgPath`
- Line and rect tools render as `<line>` and `<rect>` respectively
- Playground has tool, color, width controls; no pressure toggle

## Key Patterns
- Ref pattern: all props have corresponding refs (e.g., `effectiveToolRef`)
- Raw points constructed from `pathItem.event?.clientX/Y` or `pathItem.point`
- Smoothing only applies to pen tool
- `isDrawingInput` checks for pen pointerType or mouse button 0
- Tests mock `@system-ui-js/multi-drag` with virtual module

## Task 3 Findings
- Pressure capture belongs in `DrawingSurface` raw timed point construction before smoothing so smoothing can preserve/interpolate pressure.
- Controlled-mode active previews clear on `AllEnd`; tests that inspect preview SVG must assert before emitting `AllEnd`.
- Biome flags direct array-index key expressions, so exact segment key strings can be assigned to local variables before JSX.

## F3 Manual QA
- 2026-05-16: `yarn typecheck`, targeted Jest tests, `yarn test:ui tests/ui/playground.spec.ts`, and `yarn build` all passed; `@system-ui-js/multi-drag` is pinned and locked to `0.4.0`, and the local type shim includes optional pressure.

## useCanvas Refactor
- `DrawingSurface` can delegate committed-stroke state to `useCanvas`, but must snapshot `defaultValue` stroke color/width at mount to preserve uncontrolled rendering semantics across prop changes.
- Drag handlers still need a per-Drag-session active stroke draft and refs for latest hook actions so the Drag instance does not need to be recreated on each stroke update.
