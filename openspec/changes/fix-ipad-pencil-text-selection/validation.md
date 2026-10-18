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
| DOM PointerEvent / composition dispatch | Pending automation. Such events have isTrusted=false and do not prove native pen selection or system IME behavior. |
| Browser mouse / keyboard | Pending automation. Will check default selection and editable exceptions in desktop Chromium/WebKit. |
| CDP pen | Not executed for this change. HAM-50 evidence is not evidence for this symptom. |
| iPad Safari + physical pen | Pending mandatory baseline/candidate comparison. No claim of reproduction on the patched baseline or accepted fix. |

The proposed dblclick chain is a hypothesis, not an established root cause.

## Device acceptance (pending)

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
