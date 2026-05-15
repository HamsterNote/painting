# HamsterPainting GLView Project Decisions

## Architecture Decisions
1. **Gesture Adapter**: Dedicated module `packages/painting/src/gestures/normalizePointerInput.ts`
   - Converts RN responder events → `NormalizedPointerInput` for `multi-drag-core`
   - Single source of truth for pointer phase mapping

2. **Stroke State**: Dedicated module `packages/painting/src/state/strokes.ts`
   - Immutable stroke tracking
   - Tap-only strokes (no Move) are discarded
   - Cancellation terminates active stroke without counting

3. **GL Renderer**: Dedicated module `packages/painting/src/rendering/glStrokeRenderer.ts`
   - Owns shader setup, vertex buffers, clip-space conversion
   - RAF loop with cleanup
   - `gl.endFrameEXP()` after each frame

4. **Component Structure**:
   - `HamsterPainting.tsx`: New implementation
   - `DrawingSurface.tsx`: Re-export as compatibility alias
   - `index.ts`: Default export + named exports

## Props Contract
- Keep `testID?: string` for backward compatibility
- Add optional `onStrokeCountChange?: (count: number) => void` for observability

## Playground Integration
- Import default `HamsterPainting` in `apps/playground/App.tsx`
- Render stroke count with test id `hamster-painting-stroke-count`
- Render status text `Idle` / `Drawn` with test id `hamster-painting-status`

## Task 5 Component Implementation - 2026-05-14
- Implemented the real component in `HamsterPainting.tsx` and kept `DrawingSurface.tsx` as a compatibility re-export layer.
- Renderer updates are driven from committed React stroke state so GL receives finalized strokes plus the active stroke while drawing.
- Stroke count notifications fire only when the committed stroke count changes, not on mount or tap-only input.
