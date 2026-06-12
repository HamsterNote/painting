# Design: Painting Drawing Surface

## Context

This project is a React Native component library with a Web-first drawing surface. The runtime target is Web only, using SVG for rendering and `@system-ui-js/multi-drag` for drag gesture handling. The package name is `@hamster-note/painting`, and the main component is `DrawingSurface`.

Key conventions:
- Coordinates are CSS-pixel positions relative to the surface top-left
- All browser/DOM access happens inside React effects or event handlers (no import-time DOM access)
- Internal helpers are DOM-free for Jest testing in Node
- `testID` prop maps to `data-testid` attribute on the host div

## Goals

- Deliver a production-usable Web drawing surface
- Support pen, line, and rectangle tools
- Provide controlled and uncontrolled APIs
- Add opt-in pressure-sensitive pen drawing
- Maintain backward compatibility across API expansions

## Non-Goals

- Native iOS/Android drawing (Web-only)
- Canvas/WebGL rendering (SVG only)
- Undo/redo, smoothing, eraser, selection, persistence
- Toolbar icon system or design-system refactor
- Per-stroke style persistence
- Fill color, resize handles, editing affordances

## Decisions

### Workspace Bootstrap
- **Yarn classic workspaces** (`yarn@1.22.22`) chosen to match `chameleon` reference and minimize config overhead
- **Root package is private** to prevent accidental publishing
- **Package-name imports** from example app with `yarn pack --dry-run` verifying publishability
- **ESLint flat config** with Prettier as formatter only (not a second linter)
- **Jest with `jest-expo`** for unit/component smoke coverage
- **Playwright with fixed port** (`http://127.0.0.1:8081`) for Expo Web E2E

### Drawing Architecture
- **SVG rendering** with `<polyline>`, `<line>`, and `<rect>` elements
- **Points-based stroke model** preserved for all tools (even line/rect)
- **Immutable stroke updates** — `appendPoint` returns a NEW stroke object
- **Stroke ID generation**: `Date.now().toString(36) + Math.random().toString(36).slice(2)`
- **Tap/no-move rejection**: Strokes with < 2 distinct points are ignored
- **maxFingerCount: 1** to reject additional simultaneous pointers

### Pen Drawing
- **onChange fires once per completed stroke** on `AllEnd`, not per move
- **Controlled mode**: `value` is source of truth, cancel transient preview on value change mid-stroke
- **Uncontrolled mode**: `defaultValue` seeds initial state, `onChange` fires with committed strokes
- **Runtime guard**: Unsupported `tool` values degrade to non-drawing behavior without throwing

### Rect/Line Tools
- **Line rendering**: Uses `points[0]` and `points[points.length - 1]` as `<line>`
- **Rect rendering**: Derives `x`, `y`, `width`, `height` from min/max of first/last point
- **Reverse-drag normalization**: Negative width/height never reach the DOM
- **Style props** (`strokeColor`, `strokeWidth`) are surface-wide, not per-stroke

### Pressure Sensitivity
- **Opt-in**: `pressure={true}` required; default is false
- **Source**: `FingerPathItem.pressure` (not `pathItem.event?.pressure`)
- **Normalization**: Finite number in [0,1] returns itself; otherwise 1; valid 0 stays 0
- **Segment rendering**: Pressure pen strokes render as per-segment paths with `strokeWidth = baseWidth * pressure`
- **Interpolation**: `createVelocityAdaptivePoints` linearly interpolates pressure between endpoints when smoothing is enabled
- **Historical rendering**: If stroke already has pressure data, render it pressure-sensitive regardless of current prop

### Tooling Decisions
- **Vite** for playground (not Expo dev server in later iterations)
- **`react-native-builder-bob`** for library builds (commonjs, module, typescript targets)
- **`@testing-library/react`** for Jest component tests
- **Virtual mock** for `@system-ui-js/multi-drag` in Jest

## Risks / Trade-offs

### Known Issues
- **Expo export PNG CRC error**: `expo export -p web` fails with PNG CRC error during asset processing (noted in F1 audit)
- **ESLint parsing errors**: Initial setup had parsing errors across TS/TSX, Node config, generated lib, and test files (resolved in later iterations)
- **Bob export warnings**: Build emits warnings about `exports['.'].import` and `exports['.'].require` configuration
- **Second-pointer rejection**: Playwright cannot simulate concurrent pointers; coverage is limited to unit tests

### Scope Creep Incidents
- **Vite migration**: Playground migrated from Expo/Metro to Vite (flagged as scope creep in F4, but retained)
- **Testing library additions**: `jest-environment-jsdom` and `@testing-library/*` added beyond original bootstrap scope

### Trade-offs
- **SVG vs Canvas**: SVG chosen for simpler React integration and testability; may limit performance for very complex drawings
- **Points-based model**: Simplifies storage but requires geometry derivation for line/rect rendering
- **Single-finger only**: `maxFingerCount: 1` simplifies state management but prevents multi-touch features

## Migration Plan

N/A — This is a greenfield project with no prior versions to migrate from.
