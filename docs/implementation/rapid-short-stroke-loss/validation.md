# HAM-111: rapid short stroke reproduction evidence

## Outcome

2026-10-26: the reported alternating loss is **not reproduced** in the tested
Web path. No product implementation has been changed. There is no failing stroke
trace, confirmed root cause, or before/after fix claim. Tasks 1.3 and 2.x remain
pending: task 1.2 explicitly prohibits product changes before failure evidence.

The OpenSpec planning files were restored from the HAM-111 proposal attachment.
The proposal's `/layered` URL returns Expo's Unmatched Route on this revision;
the existing application and tests use `/layered-editor`. All drawing results
below use that actual route. The URL in the active task/design is corrected.

## Environment And Boundaries

- Product baseline: `2f0a3f2851d0f6cf890e7b8933f2dc64c546586c` (`main`).
- Ubuntu 26.04 x86_64, Linux 7.0.0-31-generic, Node 24.15.0, pnpm 10.28.2.
- Playwright 1.59.1, HeadlessChrome 147.0.7727.15, DPR 1, viewport 1500 x 1100.
- DOM surface is 1500 x 911 with diagnostics. Default freehand brush/mode
  (`auto`); default viewport scale 1; native PencilKit disabled/not connected.
- Core matrix disables virtual paper and minimap to isolate white background
  pixels. The browser pen control uses the default application configuration.
- No user's device/system, physical pen, actual entry or PencilKit setting has
  been supplied. No iPad/UIKit/physical paint/recording acceptance was performed.
- Synthetic DOM inputs use `isTrusted=false`. CDP pen inputs reach the actual
  browser hit-testing/capture path and report `isTrusted=true`, but **remain
  automation**, not physical Pencil sampling or iOS evidence.

## Core Matrix

`tests/ui/layered-editor.spec.ts`, describe `rapid stroke evidence matrix`:
18 cells, each on a fresh page/document with 100 nonoverlapping strokes. No move
events, real release pressure 0, first 50 strokes reuse pointerId 41, the next 50
use independent IDs. DOM hit testing selects the event target. Each cell checks
every object's two raw endpoints, one object per attempt, no residual active
session/candidate, 100 visible SVG objects and colored pixels in all 100 regions.
It then checks each of 100 undo and 100 redo steps, exact restored objects/raw
samples/order, and acceptance of a 101st stroke. No ACK delay is injected.

Trace exports every 10 strokes retain complete per-stroke entries before the
2048-entry ring can overwrite them. `input-trace.json` and `counts.json` are
Playwright attachments, alongside the final surface PNG and video.

All rows have attempts/down/up/begin/end/commit/objects/pixel regions = **100**,
and undo/redo steps = **100/100**. Timing below is measured from raw event
`timeStamp`, in milliseconds; intervals and durations are actual scheduler
results, not exact promises of the requested 20/80 ms duration.

| Length px | Target Hz | Target contact ms | Mean down interval ms | Mean contact ms | Result  |
| --------- | --------- | ----------------- | --------------------- | --------------- | ------- |
| 0         | 2         | 20                | 499.98                | 23.41           | 100/100 |
| 0         | 2         | 80                | 499.96                | 83.74           | 100/100 |
| 0         | 5         | 20                | 199.91                | 23.05           | 100/100 |
| 0         | 5         | 80                | 199.99                | 83.57           | 100/100 |
| 0         | 8         | 20                | 124.99                | 23.61           | 100/100 |
| 0         | 8         | 80                | 124.99                | 83.80           | 100/100 |
| 8         | 2         | 20                | 499.94                | 23.71           | 100/100 |
| 8         | 2         | 80                | 500.00                | 83.68           | 100/100 |
| 8         | 5         | 20                | 200.00                | 23.20           | 100/100 |
| 8         | 5         | 80                | 200.00                | 83.32           | 100/100 |
| 8         | 8         | 20                | 124.96                | 23.51           | 100/100 |
| 8         | 8         | 80                | 124.93                | 83.71           | 100/100 |
| 160       | 2         | 20                | 499.99                | 23.21           | 100/100 |
| 160       | 2         | 80                | 499.96                | 83.09           | 100/100 |
| 160       | 5         | 20                | 199.99                | 22.64           | 100/100 |
| 160       | 5         | 80                | 199.99                | 83.39           | 100/100 |
| 160       | 8         | 20                | 124.99                | 23.70           | 100/100 |
| 160       | 8         | 80                | 124.99                | 83.73           | 100/100 |

Across all cells raw down intervals range from 117.6 to 505.6 ms, target-20 ms
contact ranges from 19.5 to 28.3 ms, target-80 ms contact from 79.6 to 85.9 ms.
Generated `matrix.json` contains individual counts and timing min/mean/max.

## Browser Pen Control

CDP `Input.dispatchMouseEvent` with `pointerType=pen`, press force 0.5 and release
force 0, 100 independent down/up pairs per case, no move. Inputs are routed by
the browser, including actual pointer capture, rather than dispatched on a
preselected surface node. All four cases have 100 objects, 100 visible final
paths, colored pixels at all 100 positions, and 200 trusted pen boundary events.

| Length px | Diagnostics | Mean down interval ms | Mean contact ms | Result  |
| --------- | ----------- | --------------------- | --------------- | ------- |
| 8         | on          | 199.82                | 29.54           | 100/100 |
| 160       | on          | 200.01                | 30.53           | 100/100 |
| 8         | off         | 200.05                | 33.01           | 100/100 |
| 160       | off         | 200.05                | 31.49           | 100/100 |

Enabled diagnostics also show exactly 100 accepted begin/end/commit and 100
presentation-visible entries. With diagnostics off, no diagnostic controller or
trace global is used; only event observation, DOM and pixels are inspected.
CDP latency makes observed contact longer than the requested 20 ms.

## Focused Regression Coverage

- `freehandWebAdapter.test.ts`: 36 new combinations (pen/mouse/touch x 0/8/160 px
  x no/single/coalesced/empty-coalesced moves), 100 strokes each. Uses the actual
  arbiter, adapter, controller, session and geometry. Each stroke finishes
  synchronously without a frame; timestamps within a stroke are equal. Checks
  raw endpoint/pressure/source/sequence retention, no owner left behind, unique
  commit IDs, and each undo/redo. This is jsdom, not pixel or wall-clock evidence.
- `layered-presentation.test.ts`: three completed pending strokes while a fourth
  is active; reordered/duplicate/incorrect-identity ACKs; undo of the latest
  pending stroke, late ACK rejection, redo and ordered convergence. Existing
  tests retain capture/cancel, stale token and synchronous handoff coverage.
- Existing `pencilkitDemoBridge.test.ts` is a regression control only. It cannot
  prove asynchronous UIKit/PencilKit behavior or physical preview retirement.
- Existing dot/half-opacity delayed handoff browser test passed on Chromium.
  This tests one pending stroke; the new three-pending-stroke test is a unit
  check, not a claim of a 300 ms three-stroke physical paint verification.

## Hypothesis And Scenario Status

| Area                 | Evidence / limit                                                                        | Implementation decision                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| H1 routing/ownership | All tested valid down/up pairs accepted, including real browser capture and reused IDs  | No routing patch justified                                                                                 |
| H3 end/commit        | Raw endpoints/pressure retained, per-attempt document increment and reversible history  | No end/commit patch justified                                                                              |
| H2 geometry/handoff  | Nonempty final geometry, 100 visible pixel regions/cell, ordered ACK unit controls pass | No display patch justified; multiple delayed half-opacity/mixed-object physical handoff remains unverified |
| H4 native lifecycle  | Existing bridge control passes; no native entry/device trace                            | Unresolved, not excluded; no native patch or default-enable change                                         |

| Delta scenario                                       | Status / evidence                                                                                                |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Fast/slow pen and equal-frequency short/long strokes | Chromium matrix and CDP controls pass in tested range; no physical device result                                 |
| Capture loss retains owner                           | Existing adapter regression control; browser CDP normal capture passes                                           |
| Sparse/same-frame endpoints                          | Matrix and new adapter combinations pass                                                                         |
| Reversible 100-stroke history                        | Every core matrix cell and adapter combination passes                                                            |
| Cancellation does not contaminate next stroke        | Existing adapter cancellation controls; mode/palm browser controls recorded separately                           |
| Delayed render preserves ink                         | Existing Chromium dot/half-opacity delayed test passes; three-stroke 300 ms pixel sequence pending               |
| Duplicate commit / stale ACK                         | Existing adapter retry controls and presentation tests pass                                                      |
| Several strokes before first handoff                 | Three-pending/fourth-active unit check passes; continuous browser frame/opacity verification pending             |
| Reordered/duplicate translucent mixed ink            | Identity/order unit checks pass; mixed text/image/shape + half-opacity + reordered ACK pixel combination pending |
| Undo before handoff                                  | New unit check passes; no physical paint claim                                                                   |
| All six PencilKit delta scenarios                    | No device result. Existing bridge suite is a control, not acceptance of the new native sequences                 |

## Commands And Results

- `pnpm install --frozen-lockfile`: exit 0; lockfile unchanged.
- Focused Jest (adapter, presentation, native bridge): exit 0; 3 suites, 162 tests
  passed, including the 38 new regression cases.
- Chromium `--grep 'rapid stroke evidence matrix' --workers=3`: exit 0, 18 passed.
- Chromium `--grep 'browser pen'`: two diagnostic-on cases passed, then two
  diagnostic-off cases could not navigate because a concurrent Playwright run
  owned and closed the shared dev server. Re-ran diagnostic-off alone: exit 0,
  2 passed. This was test infrastructure interruption, not dropped strokes.
- Initial core matrix attempt: exit 1 before drawing, because `/layered` is not
  a route. Corrected to the existing `/layered-editor`; complete rerun above.
- WebKit (18 matrix + delayed handoff): exit 1 before any page/gesture, missing
  `libicudata.so.74`. `playwright install-deps webkit --dry-run` reports that
  Playwright 1.59.1 cannot install dependencies for Ubuntu 26.04. Not passed.
- `pnpm typecheck`: exit 0 (painting, painting-board, playground).
- Chromium existing controls: exit 0, 10 passed (three input modes with signed
  pointer identities, palm/forced-mode/cancel recovery, mixed object pixel order,
  mouse over text, plain Web continuation and delayed half-opacity dot). The
  0.5/1/2 viewport matrix in task 3.4 was not executed; that task remains open.
- Changed TypeScript files: ESLint exit 0; Prettier check exit 0.
- An additional standalone `tsc` invocation on the UI test file exited 2 because
  it omitted the app's Window declarations and Node type context used by this
  existing file. It is not a passing UI-test typecheck; the repository's supported
  typecheck above passes. No tsconfig/dependency changes were made for that probe.

Reproduce the focused commands from the repository root:

```sh
pnpm exec jest --selectProjects legacy-web core-node --runInBand --runTestsByPath packages/painting/src/input/web/__tests__/freehandWebAdapter.test.ts packages/painting/src/__tests__/core/layered-presentation.test.ts packages/painting/src/input/native/__tests__/pencilkitDemoBridge.test.ts
pnpm exec playwright test tests/ui/layered-editor.spec.ts --grep 'rapid stroke evidence matrix' --workers=3
pnpm exec playwright test tests/ui/layered-editor.spec.ts --grep 'browser pen' --workers=1
pnpm exec playwright test --config=playwright.webkit.config.ts tests/ui/layered-editor.spec.ts --grep 'rapid stroke evidence matrix|dot, pressure' --workers=3
```

Run browser commands sequentially: a second command reusing a Playwright-owned
server can lose it when the owning command exits.

## Next Required Evidence

Obtain the affected device/system, input device, actual route, input mode,
PencilKit switch and matching JS/native build. On that entry export trace in
small batches with `?diagnostics=1&traceGestures=1`, preserving attempts and raw
down/up as well as per-commit results. If PencilKit is enabled, capture same-ID
raw/tool/begin/reply/commit/retirement and queue depths. This will select H1-H4
and permit task 1.3's failing regression before any product patch.

Physical device tasks 4.1/4.2, the untested scenario combinations above and the
root-cause/fix deliverable remain open. Planning completion, test evidence and
product/device acceptance are separate states.
