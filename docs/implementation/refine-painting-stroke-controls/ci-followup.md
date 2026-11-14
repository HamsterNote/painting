# CI follow-up (2026-11-14)

PR #56 at 4b9026d failed `Test and Build` in the unit-test step (exit 1):
113 suites, 111 passed / 2 failed; 1510 tests, 1505 passed / 5 failed.
The two missed migration sites were `layered-pencilkit-host.test.tsx` (four
parameterized cases) and `LayeredPaintingBoard.test.tsx` (one case). They still
opened general settings before requesting color or pressure controls.

Both now use the stroke dialog. Board coverage also asserts pressure is absent
from general settings. Native-host coverage preserves undo/redo, committed and
pre-existing object comparisons, and adds explicit new-ink color snapshots for
both freehand (`brushSnapshot`) and shapes (`style`). Product code is unchanged.

Environment: Linux, Node 24.15.0, pnpm 10.28.2.

Final `pnpm test`: raw exit **0**. Jest **113 suites / 1510 tests passed**;
responder **9 passed**; native configuration **4 passed**. Full output:
`logs/ci-unit-followup.log`. Prettier check and `git diff --check` both exit 0.
New CI execution will be triggered by the push; no CI result is assumed.
