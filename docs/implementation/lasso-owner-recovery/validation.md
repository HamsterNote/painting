# HAM-245 stale-owner recovery

Repair base: `f4a8b7548e68ae29be6f51ca5b9d8c681afbcb25`. PR #53 stays on that head; this repair is delivered on `agent/linus/ham245-stale-owner` for a second independent review. No merge or geometry optimization is included.

## Predicate and ownership boundary

A valid primary-button down supersedes an existing **single** owner iff device types match and either the type is mouse, or both pen/touch downs explicitly have `isPrimary === true`. A browser has at most one primary pointer of each type. A fresh mouse primary down therefore begins a new cycle, even when its ID is reused. The primary identity is retained from down, never overwritten by move metadata.

Neither capture loss, `buttons=0` movement, elapsed time, nor a different device implies staleness. Missing primary metadata is unknown. In particular, the reviewer's Event-based pen reproducer omits `isPrimary`; the regression supplies `true` on its primary pen downs, as actual browser primary events do. Treating missing metadata as primary would silently misclassify synthetic secondary fingers/pens.

Recovery cancels the old tool transaction, retires its arbitration contact/ownership only after a successful cancellation ACK, then processes the new down. A failed ACK blocks movement/release (including reused IDs) until a fresh primary down retries or lifecycle cancellation clears the state. Other live contacts remain suppressed. Old distinct-ID up cannot finish the new gesture.

Production DrawingSurface uses `layeredInputArbiter` and `navigationWebAdapter`, **not** the legacy `viewportGestureController.activePointerIds`/pair controller. Both direct semantic dispatch and the production arbitration gate are covered. Pen + finger keeps the pen owner. A non-primary second paper touch retains the existing cancel-tool-then-start-pair navigation contract; it is not stale-owner recovery. An active pair is not replaced by this rule. Native pencil guards and the legacy viewport/ruler capture-cancel bindings are unchanged.

## Reproduction and validation

Run the new regressions and previous capture-order regressions together:

```sh
pnpm exec jest --runInBand --runTestsByPath packages/painting/src/__tests__/layered-stale-owner.test.ts packages/painting/src/__tests__/layered-lasso-capture.test.ts packages/painting/src/__tests__/core/layered-input-arbitration.test.ts
```

Result: **45/45**. The direct and production stale-owner cases assert begin=2, exactly one final query/complete/submit, one cancellation of the abandoned gesture, and ordered IDs `second,first` equal to the unchanged oracle. Includes mouse ID reuse, primary pen/touch recovery, secondary touch/pen preservation, navigation pairing, old terminal rejection, failed cancellation ACK and missing primary metadata. Existing lost→up, up→lost, duplicate up, pointercancel, blur, hidden and destroy tests remain.

| Check                                                 | Result                                                                                                         | Raw output                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `pnpm exec jest --runInBand`                          | 112 suites / 1507 tests pass, including P2/collinear cases, session/version/document cancellation and rotation | `jest-all-final.log`             |
| Fixed seed 245, 10,000 differential cases             | 10,000/10,000, zero differences                                                                                | `differential.log`               |
| `pnpm run typecheck`                                  | Pass                                                                                                           | `typecheck-final.log`            |
| `pnpm run lint`                                       | Pass, 0 errors / 32 existing warnings                                                                          | `lint-final.log`                 |
| `pnpm run build:lib`                                  | Pass                                                                                                           | `build-lib-final.log`            |
| Expo web production export with source maps           | Pass                                                                                                           | `build-production-final.log`     |
| Chrome 156 production UI                              | 252/252 pass (8.6m), including trusted touch cancel/pinch/tool paths                                           | `production-ui156.log`           |
| Required OpenSpec all/strict + repair-file formatting | All/strict passes; repair files formatted; full repository has 36 unchanged baseline failures below            | `openspec-all.log`, `format.log` |

Differential command:

```sh
pnpm exec esbuild scripts/perf/lasso-compatibility-differential.test.ts --bundle --platform=node --format=cjs --outfile=artifacts/research/lasso-owner/differential.cjs
node --test artifacts/research/lasso-owner/differential.cjs
```

Production build/UI commands (Chrome path is the official 156.0.8078.80 binary already downloaded for HAM-245):

```sh
pnpm --filter @hamster-note/painting-playground exec expo export --platform web --source-maps --output-dir ../../artifacts/research/lasso-owner/site
LASSO_EXPORT_ROOT=artifacts/research/lasso-owner/site LASSO_CHROMIUM_EXECUTABLE="$PWD/artifacts/research/lasso-capture/browser/chrome-linux64/chrome" pnpm exec playwright test --config=playwright.lasso.config.ts --project=chromium --grep-invert 'unrelated console errors still reach Expo development LogBox'
```

The excluded test requires Expo development LogBox and is not one of the requested 252 production-applicable cases.

## Chrome 156 raw evidence

Same exported product resources served on port 6276:

```sh
LASSO_EXPECT_FIXED=1 LASSO_X_DISPLAY=:253 node scripts/perf/lasso-capture-browser.mjs http://127.0.0.1:6276 artifacts/research/lasso-owner/native156
LASSO_EXPECT_FIXED=1 node scripts/perf/lasso-recording-replay.mjs http://127.0.0.1:6276 artifacts/research/lasso-owner/replay156
node scripts/perf/lasso-owner-browser.mjs http://127.0.0.1:6276 artifacts/research/lasso-owner/recovery156
```

- Headed trusted CDP on **156.0.8078.80**: normal, explicit mid-drag capture release, zero-buttons movement, capture transfer all pass. Each selects 115 IDs; drag queries=0; query-start/complete/submit=1; cancel=0. Native capture events remain trusted. Output `native156.log` and `native156/*.json`.
- Exact recorded geometry replay (headless Chrome156, DOM/coalesced samples): **8/8 ordered ID equality**; original failed four select **116 / 50 / 97 / 28**; all start/complete/submit=1, cancel=0. Original document movement/revision between gestures is restored. Output `replay156.log` and `replay156/*.json`.
- Additional trusted CDP mouse/pen/touch recovery: **3/3**, each selected115 equal to oracle, 2 primary downs, one discarded-terminal cancellation, start/complete/submit=1. This harness deliberately intercepts one actual pointerup before the app to simulate a missing terminal; the capture loss and all input geometry are browser-generated. It does not claim the UA spontaneously dropped up. Output `recovery156.log` and `recovery156/*.json`.

## Preserved failures and limitations

The pre-fix red regression records 8 failing recovery cases and 6 passing secondary-contact cases (`jest-red.log`). Initial full Jest had 3 failures: its touch shim defaulted **both concurrent fingers to primary=true**. Only those secondary down fixtures were corrected to false; cancellation/navigation assertions remain. The final full suite passes. Initial lint flagged conditional expectations in the new test; assertions were moved outside branches without weakening them. Original logs are included. Full-repository `pnpm run format:check` reports 36 existing failures. Each of those files is byte-for-byte unchanged from f4a8b75 and also fails the same Prettier check on that base (36/36 verified; `format-prearchive.log`, `format-baseline.json`). This repair does not claim that repository-wide format is green; all repair files are checked separately.

The bounded predicate does not reconstruct unknown-primary input or an abandoned multi-touch pair. Escape, real cancellation, blur/hidden/unmount and tool/input/document changes retain their existing recovery paths. Real-device feel is still for 修勾 to confirm; Chromium evidence does not establish iPad performance. Existing cold-lasso thresholds remain tracked in HAM-247, with no new performance claim here.

## Specification and review handoff

The original `2026-11-13-optimize-lasso-drawing-performance` archive remains unchanged. Follow-up `recover-stale-semantic-owner` updates both rotated-selection and scheduled-lasso capture clauses with the fresh-primary-down exception and secondary-contact boundaries, then syncs and archives independently.

Preview: `http://192.168.0.145:6276/layered-editor?fixture=lasso&lassoCount=500&touchDraw=1` (normal editor: same path without query). This is a tmux-backed static service with best-effort survival, not a daemon TTL environment. Session `ham245-owner-6276`; recorded PID in `artifacts/research/lasso-owner/server.pid`; durable server/access logs alongside it. Stop only this session with `tmux kill-session -t ham245-owner-6276`. Prior 6273/6274/6275 services are preserved.
