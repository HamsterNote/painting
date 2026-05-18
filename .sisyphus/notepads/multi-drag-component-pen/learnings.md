# Multi-Drag Component Pen - Learnings

## Conventions
- Package: `@hamster-note/painting`
- Component: `DrawingSurface` (stable export name)
- Web-only runtime target
- Types: CSS-pixel coordinates relative to surface top-left

## Patterns
- Keep internal helpers DOM-free for Jest testing
- Use `<svg>` with `<polyline>` per stroke for rendering
- onChange fires once per completed stroke on AllEnd
- Tap/no-move gestures and strokes with <2 distinct points are ignored
- maxFingerCount: 1 to reject additional simultaneous pointers

## Gotchas
- No import-time DOM access
- No react-native primitives in new component path
- Controlled mode: value is source of truth, cancel transient preview on value change mid-stroke
# Task 1 Learnings - DrawingSurface Public API

## What was done
- Defined public drawing contract types: `DrawingTool`, `DrawingPoint`, `DrawingStroke`, `DrawingValue`
- Extended `DrawingSurfaceProps` with `tool`, `value`, `defaultValue`, `onChange`, `testID`
- Added runtime guard (`isDrawingToolSupported`) for unsupported tool values - degrades gracefully without throwing
- Exports added to index.ts
- Tests updated to use @testing-library/react

## Key findings

### Jest + React Native Mocking
- jest.mockRN.js maps react-native View/Text to lowercase HTML elements for jsdom
- testID prop must become data-testid attribute via the mock
- React warns about testID prop - using testid lowercase in mock, which React accepts

### Jest environment
- jest-environment-jsdom needed to be installed separately (Jest 28+)
- Changed testEnvironment from 'node' to 'jsdom' in jest.config.js

### Testing Library Setup
- @testing-library/react and @testing-library/dom added to painting package.json devDependencies
- Tests now use `render()` and `screen.getByTestId()` instead of direct function calls

### Mock Pattern
```js
const makeMockComponent = (tag) => {
  return ({ children, testID, style, ...props }) =>
    React.createElement(tag, { style, 'data-testid': testID, ...props }, children);
};
```

### TypeScript unused variable warnings
- Props like `value`, `defaultValue`, `onChange` that aren't used yet need underscore prefix: `_value`, `_defaultValue`, `_onChange`

# Task 2 Learnings - Web-First Runtime Wiring

## What was done
- Added runtime dependency `@system-ui-js/multi-drag` to `packages/painting/package.json` under `dependencies`.
- Removed `react-native` dependency from `apps/playground/package.json`; kept `react-native-web` plus Vite aliasing.
- Updated `jest.mockRN.js` platform mock to web (`Platform.OS = 'web'`, `select` prefers `web`).
- Updated `DrawingSurface` tests to rely on renderer-based assertions for both direct and package-index exports.

## Deliberate non-scope/react-native mentions kept
- `react-native` remains in `packages/painting` peerDependencies and Bob/react-native export metadata as part of existing publish/build contract; no broad Bob/tooling conversion was performed.

# Task 2 (stroke-helpers) Learnings

## What was done
- Created `stroke-helpers.ts` - internal DOM-free module for stroke lifecycle and SVG serialization
- Functions: `createStroke`, `appendPoint`, `isValidStroke`, `pointsToPolyline`, `createDrawingValue`
- Created comprehensive tests covering: stroke creation, point appending, deduping, validation, polyline serialization, tap/no-move handling

## Key findings

### DOM-free for Node Jest testing
- No `document`, `window`, or DOM APIs in stroke-helpers.ts
- Simple id generation: `Date.now().toString(36) + Math.random().toString(36).slice(2)`
- Jest runs in jsdom environment, but keeping helpers DOM-free ensures testability without DOM mocks

### Immutable pattern
- `appendPoint` returns a NEW stroke object, does not mutate input
- Original stroke remains unchanged - important for React state management

### Dedupe only consecutive identical points
- Only removes consecutive duplicates (same x, same y as last point)
- Non-consecutive duplicate points are preserved (e.g., returning to a previous position)

### SVG polyline format
- Format: "x1,y1 x2,y2 x3,y3 ..." (space-separated, comma between x,y)
- `pointsToPolyline` converts DrawingPoint[] to this string format

### isValidStroke checks distinct points
- Must have >= 2 points AND at least 2 distinct points (not identical)
- Stroke with 2 identical points is invalid (tap gesture)

# Task 3 Learnings - Web-First DrawingSurface Component

## What was done
- Replaced react-native `View`/`Text` placeholder with DOM-first `div` + `svg` + `polyline` implementation
- Host element: `<div>` with `data-testid={testID}` mapped from prop
- Internal SVG layer renders committed strokes as `<polyline>` elements using `pointsToPolyline(stroke.points)` from stroke-helpers
- Added transient active stroke preview state (empty for now, wired in Task 4)
- Implemented controlled mode (`value` prop) and uncontrolled mode (`defaultValue` prop)
- Added `getLocalCoordinates()` helper using `getBoundingClientRect()` for Task 4 pointer events
- Kept all browser/DOM access inside React effects/handlers - zero import-time DOM access
- Updated tests: host container data-testid, SVG/polyline rendering, controlled value updates, module import safety

## Key findings

### DOM element mapping from react-native
- `View` → `<div>` with inline styles for layout
- `Text` content → removed (component is now visual-only, no placeholder text)
- `testID` → `data-testid` attribute on host div (standard web testing pattern)

### SVG responsive sizing
- Use `position: absolute; width: 100%; height: 100%` inside relatively positioned host div
- No viewBox needed when using percentage sizing within a container
- `touchAction: 'none'` on host div prevents browser touch gestures from interfering with drawing

### TypeScript unused variable strategy
- `void getLocalCoordinates` suppresses `noUnusedLocals` for callbacks reserved for next task
- Use `const [state] = useState(...)` instead of `const [state, setState]` when setter isn't used yet
- Destructure only used props; access optional ones via `props.onChange` to avoid unused binding

### Controlled vs uncontrolled pattern
```tsx
const isControlled = value !== undefined;
const [internalStrokes] = useState<DrawingStroke[]>(defaultValue?.strokes ?? []);
const strokes = isControlled ? value?.strokes ?? [] : internalStrokes;
```

### Testing SVG in jsdom
- `@testing-library/react` screen queries don't work well for SVG elements without roles
- Use `container.querySelector('polyline')` and `container.querySelectorAll('polyline')` for assertions
- Polyline `points` attribute accessible via `element.getAttribute('points')`

### Preserving backward compatibility
- Kept `effectiveTool` and `isDrawingEnabled` logic from original component
- Added `data-tool` and `data-enabled` attributes on host div for testability
- All original type exports preserved (`DrawingTool`, `DrawingPoint`, `DrawingStroke`, `DrawingValue`, `DrawingSurfaceProps`)

# Task 4 Learnings - Multi-Drag Pen Bridge

## What was done
- `DrawingSurface` now creates one `Drag` instance in `useEffect` with `maxFingerCount: 1`, no-op pose read/write, and cleanup via `drag.destroy()`.
- Move callbacks keep mutable drawing state in refs while updating `activeStroke` state for SVG preview renders.
- AllEnd commits exactly once per valid stroke; controlled mode calls `onChange`, uncontrolled mode uses functional internal state updates.
- Controlled `value` replacement while drawing cancels the transient preview immediately.

## Key findings
- The workspace dependency exists in `packages/painting/package.json`, but local install lacks module declarations; a narrow ambient declaration in `packages/painting/src/multi-drag.d.ts` keeps typecheck deterministic.
- Jest should virtual-mock `@system-ui-js/multi-drag`; direct DOM gesture simulation is unnecessary for unit coverage of lifecycle and commit behavior.
- Replaying an entire finger path on every Move duplicates non-consecutive points, so the component tracks processed path length and appends only new path items.

# Task 5 Learnings - Playground Fixtures with Playwright Coverage

## What was done
- Replaced react-native `View`/`Text` in `apps/playground/src/App.tsx` with standard DOM elements (`div`, `h1`, `h2`, `pre`, `button`)
- Created two explicit demo sections side by side:
  1. **Uncontrolled demo**: `DrawingSurface` with `defaultValue` seeding and JSON preview
  2. **Controlled demo**: `DrawingSurface` with parent `value` state, JSON preview, and reset button
- Added stable `data-testid` selectors for Playwright testing
- Wrote 3 Playwright tests covering uncontrolled drawing, controlled drawing, and controlled reset

## Key findings

### Playground architecture
- Playground is a simple React DOM app (no react-native), served by Vite on port 5266
- `@hamster-note/painting` is aliased via Vite config to `packages/painting/src/index.ts`
- Playground's only dependency on painting is `DrawingSurface` component and `DrawingValue` type

### JSON preview strategy
- Uncontrolled demo: shows seed `defaultValue` only (parent cannot observe uncontrolled changes)
- Controlled demo: shows live `value` state that updates via `onChange` → `setControlledValue`
- Reset button sets controlled state back to `{ strokes: [] }`
- Preview uses `<pre>` with `JSON.stringify(value, null, 2)` for human-readable formatting

### Playwright pointer event simulation
- Use `page.mouse.move(x, y)` then `page.mouse.down()`, drag with `page.mouse.move(x2, y2)`, then `page.mouse.up()`
- Must use `await surface.boundingBox()` to get screen coordinates relative to viewport
- Stroke commit happens asynchronously via multi-drag's AllEnd listener; `page.waitForTimeout(100)` is sufficient
- `page.getByTestId()` works with `data-testid` attributes on both `div` and `pre` elements

### Test assertions
- `toContainText()` for partial string matching in JSON previews
- `JSON.parse()` + explicit property assertions for structured stroke validation
- `expect(parsed.strokes.length).toBeGreaterThanOrEqual(1)` handles both seeded and drawn strokes

# Final Verification F3 - 2026-05-15

## Results
- `yarn typecheck`: passed with no TypeScript errors.
- `yarn test`: passed 2 suites / 28 tests.
- `yarn test:ui`: passed 3 Playwright tests covering uncontrolled draw, controlled draw, and controlled reset behavior.
- `yarn build`: passed and emitted module, commonjs, and TypeScript artifacts under `packages/painting/lib`.
- `yarn pack:dry`: passed and listed 24 package files including built outputs, source files, tests, and package metadata.

## Warnings observed
- Bob build reported package export-field warnings for `exports['.'].import`, `exports['.'].require`, and `exports['.'].types` configuration.
- npm pack dry-run reported unknown npm env config warnings for version-related settings and `argv`.

## 2026-05-15 Final Verification F1 Round 3
- Plan compliance audit approved: API/export requirements, controlled/uncontrolled behavior, tap rejection, pointer rejection, DOM/React Native constraints, stable selectors, and coordinate handling verified.
- Validation run: `yarn test --runInBand` passed 30/30 Jest tests; `yarn test:ui` passed 5/5 Playwright tests.

## 2026-05-15 Final Verification F1 Round 3 Additional Validation
- Remaining plan acceptance commands passed: `yarn typecheck`, `yarn build`, and `yarn pack:dry`.
- Build emitted existing package export-shape warnings only; no command failed.
