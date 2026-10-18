# Down-time pointer ownership review fix

Date: 2026-10-18. Starting commit: `6892a481c3b0656554d4210713917cd209bc8282`.

## Implementation

`packages/painting/src/core/layeredInputArbitration.ts:162` retains each contact's
down-time `targetRole` while accepting its latest sample. Pointer capture may
retarget a selection-handle move to the paper host; this must not make that
contact eligible for a paper touch pair. A paper contact also keeps its original
role when crossing a selection handle, ruler, or control.

This changes only contact updating. Reset reasons, ruler cancellation, coordinate
conversion, signed pointer identities, mode policy, and pen latching are unchanged.
The fix does not alter `openspec/`, the archived tasks, or the main specifications.

## Regression Coverage

- Strengthened `controls and ruler do not mix with paper; selection handles retain
their owner`: selection down now includes the missing paper-target move before
  the second down; the original pointer retains its transaction through its up.
- Added `paper contact crossing %s retains its down role and still forms a paper
pair` for selection, ruler, and safe-control roles. It verifies the retained
  role, cancellation handshake, pair creation, and navigation routing.
- Added `%s captured selection handle keeps its resize transaction when a paper
finger arrives` for auto/finger, using real arbiter, semantic adapter, navigation
  adapter, and controller. Negative touch IDs start on a resize handle and then
  move on the host. The second paper finger cannot clear or modify the preview,
  document, history, or viewport. The owning up commits the exact expected resize
  once; the second up does nothing; undo/redo confirms the history transaction.
- Added `down-role-ownership: %s captured resize handle excludes a paper second
finger` for auto/finger in both browser configurations. Down targets the actual
  rendered resize handle; subsequent host-target events simulate capture
  retargeting. Assertions cover preview, committed objects, revision, history,
  selection, viewport, undo, and redo. Existing paper-start selection tests remain.

## Failure and Rollback Evidence

Targeted Jest command (existing projects):

```sh
pnpm exec jest --runInBand --runTestsByPath packages/painting/src/__tests__/core/layered-input-arbitration.test.ts packages/painting/src/__tests__/layered-semantic-adapter.test.ts
```

The unmodified implementation with the new tests produced **6 failed / 27 passed**.
The two composed failures were actual preview removal after the paper finger's
move. Applying the contact-role fix produced **33 passed**. Temporarily reverting
only that implementation change produced **6 failed / 27 passed** again. The fix
was then restored before final validation.

```sh
CI=true pnpm exec playwright test tests/ui/mobile-input-mode.spec.ts --project=chromium --grep down-role-ownership --workers=1 --retries=0 --trace=off
```

On the original implementation this produced **2 failed** at preview equality,
after down on the actual handle and subsequent host-target move. Both cases pass
in the final full Chromium run. No assertions were relaxed and no skips added.

## Final Validation

| Command                                                                                    | Result                          |
| ------------------------------------------------------------------------------------------ | ------------------------------- |
| `pnpm run test`                                                                            | 87 suites / 1155 tests passed   |
| `pnpm run typecheck`                                                                       | Passed                          |
| `pnpm run lint`                                                                            | 0 errors / 32 existing warnings |
| `CI=true pnpm exec playwright test --project=chromium --workers=1 --retries=0 --trace=off` | 117 passed, no skips            |
| `openspec validate --all --strict --no-interactive`                                        | 5 passed / 0 failed             |

Podman full WebKit (`--trace=retain-on-failure`): **112 passed / 2 existing skips /
0 failed**.

The first WebKit full run returned **111 passed / 2 existing skips / 1 failed**.
The existing `adapter-matrix: finger controls and ruler contacts never become a
paper second finger` case timed out in `openLayeredEditor`, before sending any
input: `layered-drawing` was absent for 5000 ms and the screenshot was blank.
The first run had tracing disabled; it does not establish a startup root cause.
Without implementation, timeout, assertion, or configuration changes, the same
case passed **5/5** with `--grep 'adapter-matrix: finger controls and ruler contacts'
--repeat-each=5 --workers=1 --retries=0 --trace=retain-on-failure` inside Podman.
The second full run enabled `--trace=retain-on-failure` for further diagnosis and
finished with **112 passed / 2 existing skips / 0 failed**. Both handle regression
cases passed in both full runs. The existing skips are Chromium-only CDP diagnostic
experiments. No automatic retry was enabled; the one-off startup timeout remains
unexplained and is not presented as a product behavior failure or a proven
environment issue.

WebKit runs sequentially after Chromium, in the supported Ubuntu 24 Podman image:

```sh
podman run --rm --name ham44-webkit-ownership-check --network host \
  -v "$PWD:$PWD" -w "$PWD" \
  -v /home/zhangxiao/.cache/ms-playwright:/ms-playwright:ro \
  -v /home/zhangxiao/.nvm/versions/node/v24.15.0:/node:ro \
  -v /home/zhangxiao/.cache/node/corepack:/corepack:ro \
  -e PATH=/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  -e COREPACK_HOME=/corepack -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -e PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 -e CI=true \
  localhost/ham40-webkit:noble \
  pnpm exec playwright test --config=playwright.webkit.config.ts --workers=1 --retries=0 --trace=off
```

The second full command is identical except for `--trace=retain-on-failure`.
`git diff --check`, formatting checks for the changed files, and
`git diff --exit-code 6892a481c3b0656554d4210713917cd209bc8282 -- openspec` passed.

## Verification Boundary

The browser handle cases use synthetic events to reproduce target changes;
existing Chromium CDP touch/pen regressions remain part of the full suite. These
do not establish physical-device quality. No new physical iPad/Safari, pressure,
hardware palm rejection, native shell, or long-stroke performance/memory/refresh
budget validation was performed. Earlier physical-device results are not expanded.
GitHub CI is left to the coordinator after the normal branch push.
