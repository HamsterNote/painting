# Validation

## Acceptance and closeout (2026-10-18)

修勾 2026-10-18 文字确认验证通过。

- User comment: `01a14f29-e771-789d-ac8c-bf2f41191246`, 2026-10-18 13:18:28 UTC, exact text: 「验证通过」.
- Follow-up `01a14f2b-9933-7cc6-a36e-6a22dc74eeeb` identifies this as iPad device acceptance and authorizes archive, push and PR. This is user-reported acceptance, not agent-observed hardware input.
- Accepted candidate branch head: `0d20f65`; application code served at `dc253b9`. Later candidate changes refined tests and records only.
- No device/pen model, iPadOS/Safari version, screenshot, video, per-scenario results, round counts or event trace was provided. None is inferred from the confirmation.
- Task 4.2 is accepted on this textual confirmation. Tasks 4.1 and 4.3 remain unchecked because their metadata/visual-evidence requirements are incomplete. Archive is explicitly authorized despite these documentation gaps.
- PR #26 merged as `0496c2c`; this branch was rebased with `git rebase --onto origin/main 9834cec`. Rebased application/test candidate: `107b4e8` (application commit `6669e6e`). No application code was changed during closeout.
- Post-rebase verification, append-only spec checks and completed service shutdown are recorded below. The initial delivery evidence below remains historical.

## Post-rebase checks

- Base: `origin/main` at `0496c2c5c85941e6dd20650712736eee242ae3f1`.
- `git range-diff 9834cec..0d20f65 origin/main..107b4e8`: both commits have identical patches after rebase.
- `pnpm install --frozen-lockfile`: passed; dependency files and RNW patches unchanged relative to main.
- `pnpm test`: 87 suites / 1,156 tests passed; installed RNW responder tests 9/9 passed.
- `pnpm typecheck`: passed.
- `pnpm lint`: 0 errors, 32 existing assertion warnings.
- `pnpm build:all`: passed (library build and Expo web export).
- `openspec validate --all --strict --no-interactive`: 5/5 specs passed after archive.
- Full Chromium suite: 166 passed, 0 failed (6.8 minutes), using `pnpm exec playwright test --project=chromium --workers=1 --retries=0`.
- Full configured WebKit suite: 117 passed, 2 skipped, 0 failed (4.4 minutes), using `pnpm exec playwright test --config=playwright.webkit.config.ts --project=webkit --workers=1 --retries=0` inside the existing `localhost/ham40-webkit:noble` Ubuntu 24.04 Podman image because the Ubuntu 26 host lacks its runtime libraries. The two skips require Chromium CDP touch arbitration and do not execute on WebKit.
- Saved HTML reports: `ham55-closeout-chromium-report.tar.gz` and `ham55-closeout-webkit-report.tar.gz`, attached to the closeout issue comment. These are desktop browser evidence, not device footage.
- Archive: `openspec/changes/archive/2026-10-18-fix-ipad-pencil-text-selection/`, generated with `openspec archive fix-ipad-pencil-text-selection --yes --json` under this turn's explicit archive authorization.
- Byte checks against main: all 7,579 existing bytes of `document-object-interaction/spec.md` are unchanged; 2,232 bytes appended. Existing prefix SHA-256: `77d5298137ced8b506f2a574a4f417abdab20533047c150a68ece786da73f3d2`. The appended requirement matches the delta byte for byte. The other four existing spec files (including HAM-44/HAM-50 input-session clauses) are byte-identical to main.
- Tasks: 8/10 checked; missing device/version metadata (4.1) and screenshot/video (4.3) remain explicit documentary gaps. No missing data was manufactured to complete the checklist.

## Service shutdown (2026-10-18)

- After both browser suites completed, ran `node ham55-services.mjs stop baseline` and `node ham55-services.mjs stop candidate`. The helper checks the Multica daemon PID and recorded process identity before stopping the owned groups `1870322` (baseline) and `1888820` (candidate).
- `ss -ltnp '( sport = :5266 or sport = :5267 )'`: no listeners.
- Independently bound and closed a Node TCP server on each port with host `::` (IPv6 dual-stack): both 5266 and 5267 succeeded. Both acceptance ports are released; the historical LAN entries below are no longer running.

## Initial baseline and evidence

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
| iPad Safari + physical pen | At initial delivery, the comparison was pending. Current user-reported acceptance and its limits are recorded above. |

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

## Initial candidate checks

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
- Initial handoff progress: 7/10. At that point the three device acceptance tasks were open and no PR had been opened. Current closeout is recorded above.

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

## Initial device acceptance handoff (historical)

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
