# Rect/Line Tools Demo Props - Learnings

## Conventions
- DrawingSurface uses `data-testid` for test hooks
- Tool is `'pen'` only currently; will expand to `'pen' | 'line' | 'rect'`
- Stroke storage is points-based for all tools (even line/rect)
- Style props (`strokeColor`, `strokeWidth`) are surface-wide, not per-stroke
- Invalid tool renders with `data-enabled="false"`
- `isValidStroke` requires >= 2 distinct points (rejects taps)
- Default style fallback: blank/invalid color → `'black'`, non-finite or < 1 width → `2`
- Playground has controlled + uncontrolled demos side by side
- Width input clamped to integer `1..24`

## File Patterns
- Component: `packages/painting/src/components/DrawingSurface.tsx`
- Helpers: `packages/painting/src/stroke-helpers.ts`
- Tests: `packages/painting/src/__tests__/DrawingSurface.test.tsx`, `packages/painting/src/__tests__/stroke-helpers.test.ts`
- Playground: `apps/playground/src/App.tsx`
- UI Tests: `tests/ui/playground.spec.ts`
- Public exports: `packages/painting/src/index.ts`

## Decisions
- Keep `DrawingStroke` shape as `{ id, tool, points }` - no discriminated union
- Render line from first and last point in `points`
- Render rect from min/max of first and last point (normalized)
- Active preview mirrors committed geometry
- One shared control bar for both playground surfaces
- Line tool active preview uses `<line>` while pen/rect use `<polyline>`/`<rect>`.
- Biome import sorting shows up as a non-blocking diagnostics hint during edits.

## useCanvas Hook Extraction - 2026-05-16
- Created `packages/painting/src/hooks/useCanvas.ts` to wrap pure `utils.ts` drawing-value operations with controlled/uncontrolled React state management.
- Hook keeps DOM and drag concerns out; it owns `internalStrokes`, `activeStroke`, derived `strokes`, and mutation helpers.
- Verified with `lsp_diagnostics` on the hook and `yarn typecheck`.
