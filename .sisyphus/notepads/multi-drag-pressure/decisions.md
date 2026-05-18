# Decisions

## Task 1
- Pin `@system-ui-js/multi-drag` to `0.4.0` (not `^0.4.0`)
- Update local shim: add `pressure?: number` to `FingerPathItem`, `timestamp?: number` to `DragInputEvent`
- Do NOT declare `FingerOperationType` in shim (not imported by current code)

## Task 2
- `DrawingPoint` gets optional `pressure?: number`
- `createVelocityAdaptivePoints` must preserve pressure when smoothing disabled
- When interpolating, linearly interpolate pressure between endpoints
- Fallback to `1` for interpolation math when one endpoint lacks pressure
- Omit `pressure` from generated points when both endpoints lack pressure

## Task 3
- New `pressure?: boolean` prop on `DrawingSurfaceProps`
- Pressure captured only when `pressure={true}` AND `tool === 'pen'`
- Read from `pathItem.pressure` (not `pathItem.event?.pressure`)
- Defensive normalization: finite number in [0,1] returns itself, otherwise 1; valid 0 stays 0
- Pressure pen strokes render as per-segment paths with varying stroke-width
- Non-pressure pen strokes continue using single `pointsToSvgPath` path
- Historical rendering: if stroke already has pressure data, render it pressure-sensitive regardless of current prop

## Task 4
- Add checkbox with `data-testid="drawing-pressure-toggle"`
- Pass `pressure` prop to both controlled and uncontrolled DrawingSurface instances
- Playwright test uses synthetic PointerEvent with pressure values

## Task 5
- Run typecheck, targeted tests, UI tests, build
- Fix only pressure-related failures
