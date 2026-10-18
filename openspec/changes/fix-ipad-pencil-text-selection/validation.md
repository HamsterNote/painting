# Validation

## Baseline and evidence

- Baseline: `9834cec61b641c7f5041a14280d8c56322390e68`.
- Branch: `agent/agent/aca3a0e3fdf9-ham55`, created directly from that commit.
- `pnpm install --frozen-lockfile`: passed, pnpm 10.28.2.
- `pnpm test:responder`: 9/9 passed against installed RNW src/dist/dist-cjs modules.
- `git diff 9834cec -- patches/ package.json pnpm-lock.yaml`: empty.

| Evidence | Status and limits |
| --- | --- |
| User report | Rapid physical pen strokes on iPad trigger text selection. Device/software versions and event sequence are unspecified. |
| Static inspection | Surface has touch-action but no selection/callout policy; displayed HTML text is inside SVG foreignObject; textarea is a real editing control. |
| DOM PointerEvent / composition dispatch | Chromium: blank/mixed paper, 12 rapid strokes each, unique objects, +12 document revisions, 12 undo/redo steps, no editor opened; isTrusted=false. Synthetic composition commit/cancel and return to drawing pass. These do not prove native pen selection or system IME behavior. |
| Browser mouse / keyboard | Chromium and WebKit: native double click/drag over displayed text creates no new selection; existing outside selection survives; outside text remains selectable; textarea native word selection/replacement and number input focus pass. Captured mouse dblclick isTrusted=true. Native polygon completion preserves three vertices and one undo/redo transaction. |
| CDP pen | Not executed for this change. HAM-50 evidence is not evidence for this symptom. |
| iPad Safari + physical pen | Pending mandatory baseline/candidate comparison. No claim of reproduction on the patched baseline or accepted fix. |

The proposed dblclick chain is a hypothesis, not an established root cause.

## Implementation decisions

Selection/callout styles are local to DrawingSurface and displayed text. The
editor container, textarea and number input explicitly restore native editing.
Consumer style precedence is verified in the React mounting test (layout/color
still merge, selection policy remains enforced); actual computed styles and
native selection boundaries are verified in the browser test. No playground
fixture option or public API was added just to inject consumer styles.

In tested desktop native input paths, styles plus existing gesture ownership
are sufficient: double click and drag create no non-editing selection, editor
selection works, and native polygon completion works. No new dblclick,
selectstart or contextmenu interception, global selection clearing, timer,
responder change or interactionOwnership change was justified. This is not a
claim that iPad physical pen behavior has been verified.

WebKit exposes the prefixed `-webkit-user-select` computed property; the browser
assertion checks the supported standard/prefixed property. Desktop engines do
not necessarily support `-webkit-touch-callout`; computed callout checks are
conditional on CSS.supports. Actual iPad menus remain part of device acceptance.

## Automated checks

- Tested application code: `dc253b96a4b9b950bb3b4b30e2f4495e456b59c3` (later changes only refine test assertions and this record).
- Chromium command: `pnpm exec playwright test tests/ui/interaction-feedback.spec.ts tests/ui/mobile-input-mode.spec.ts tests/ui/layered-editor.spec.ts --project=chromium --workers=1`: 69/69 passed.
- Browser versions: Chromium `147.0.7727.15`; WebKit `26.4` (Playwright 1.59.1). After the prefixed-property assertion adjustment, the 8 Chromium interaction tests also pass again.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed, 0 errors and 32 pre-existing test assertion warnings.
- `pnpm test`: 87 suites / 1,156 tests passed, plus 9/9 responder tests. First cold run timed out in the unchanged native smoke mount; full rerun passed with no timeout/configuration changes.
- `pnpm build:all`: passed (library build and Expo web export).
- `openspec validate fix-ipad-pencil-text-selection --strict --no-interactive`: passed.
- WebKit full rerun: 69/69 passed. Direct host launch is unavailable on Ubuntu 26 (missing ICU74 and other system libraries). Tests ran with the existing `localhost/ham40-webkit:noble` rootless Podman image and browser cache. The first container run had two failures caused by unprefixed computed-style assertions; after correcting those assertions, the complete run passed with no application changes. This remains desktop WebKit evidence, not iPad acceptance.
- Reports: `playwright-report/index.html` (Chromium) and `playwright-report/webkit/index.html` (WebKit), including screenshots and native-input evidence. Delivered in the verification archive with service logs/cleanup helper.
- Final task progress: 7/10. The three device acceptance tasks remain open. No PR was opened; only the implementation branch is to be pushed for acceptance.

WebKit command (using the existing independent candidate server on port 5266):

```sh
podman run --rm --name ham55-webkit-final --network host \
  -v "$PWD:$PWD" -w "$PWD" \
  -v /home/zhangxiao/.cache/ms-playwright:/ms-playwright:ro \
  -v /home/zhangxiao/.nvm/versions/node/v24.15.0:/node:ro \
  -v /home/zhangxiao/.cache/node/corepack:/corepack:ro \
  -e PATH=/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  -e COREPACK_HOME=/corepack -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -e PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 \
  localhost/ham40-webkit:noble \
  pnpm exec playwright test tests/ui/interaction-feedback.spec.ts \
    tests/ui/mobile-input-mode.spec.ts tests/ui/layered-editor.spec.ts \
    --config=playwright.webkit.config.ts --project=webkit --workers=1 --retries=0
```

## Device acceptance (pending)

Both independently running Expo Dev Servers responded over LAN with HTTP 200
and rendered the editor. The baseline surface computes user-select=auto;
candidate computes user-select=none; both retain touch-action=none.

| Version | Commit containing application code | LAN entry |
| --- | --- | --- |
| HAM-50 patched baseline | `9834cec` | `http://192.168.0.145:5267/layered-editor` |
| Candidate | `dc253b9` | `http://192.168.0.145:5266/layered-editor` |

Append `?diagnostics=1&traceGestures=1` for trace mode; append `&fixture=mixed`
there for the mixed document, or use `?fixture=mixed` on the ordinary route.
Use Safari on the same LAN. Device model, physical pen model, iPadOS/Safari
versions and physical results are still unrecorded; tasks 4.1-4.3 stay unchecked.

Services are detached with persistent logs and PID records, without a
supervisor: survival is best-effort. Baseline process group: `1870322`;
candidate process group: `1888820`. In the task workdir, stop using
`node ham55-services.mjs stop baseline` / `node ham55-services.mjs stop candidate`.
The stop helper checks Multica daemon status and the recorded PID command
before terminating only the owned service group. Logs: `.ham55-services/baseline.log`
and `.ham55-services/candidate.log` (included in the verification attachment).

Record baseline/candidate commits, iPad and pen model, iPadOS/Safari versions,
input mode, route, steps, and recording/screenshots. Compare ordinary
`/layered-editor` and `?diagnostics=1&traceGestures=1`, blank and text-filled
paper, auto (before/after first pen), pen, and finger modes. Repeat rapid short
and long strokes and adjacent releases/downs; count strokes and undo entries.

If the baseline does not reproduce the reported issue, close this change and
do not deliver the candidate. If it reproduces, accept the candidate only when
selection/callout disappears and text editing, native copy/paste, Chinese IME,
commit/cancel, polygon completion, object manipulation and finger navigation
all pass on that same device. Desktop automation cannot complete these tasks.
