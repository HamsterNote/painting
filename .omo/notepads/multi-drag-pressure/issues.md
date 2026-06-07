# Issues

## 2025-05-16T04:00:00Z - F2 Review: Synthetic pressure on undefined input
**Issue**: When `pressure={true}` and `pathItem.pressure` is `undefined` (e.g., mouse input), `normalizePointPressure(undefined)` returned `1`, causing `hasPressureData` to incorrectly detect pressure data and force segment rendering.

**Fix**: Added `pathItem.pressure !== undefined` check before calling `normalizePointPressure` in the Move handler at `DrawingSurface.tsx:279`.

**Verification**: Added test "does not set pressure when pathItem.pressure is undefined even with pressure prop enabled". All 73 tests pass.

## 2025-05-16T04:00:00Z - F4 Review: False positive scope creep claims
**Claim 1**: `.sisyphus/boulder.json` modified outside scope.
**Response**: This is the work tracking file managed by the session system. Expected to be modified.

**Claim 2**: `strokeSmoothing` added to public API.
**Response**: `strokeSmoothing` was already present in `DrawingSurfaceProps` at the start of this session (added by previous completed plan `rect-line-tools-demo-props`). Not scope creep.

**Claim 3**: Non-pressure pen rendering changed from `polyline` to `path`.
**Response**: This change was made by the previous completed plan `rect-line-tools-demo-props` (which added stroke smoothing requiring SVG path for Catmull-Rom curves). The current plan only added the pressure segment rendering path.

**Verdict**: F4 claims are invalid. No scope creep detected.
