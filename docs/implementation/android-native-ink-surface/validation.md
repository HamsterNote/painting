# Android native ink validation

## Approved baseline

- Issue: HAM-65, `01a1537f-aa83-74cf-a4fe-8d7094e7d4be`.
- Proposal: `add-android-native-ink-surface` (spec-driven).
- User approval: comment `01a17136-c049-715c-83d2-6c197203d243`,
  2026-10-25T03:59:36Z, "评审通过", in the D1/D2/D4 review thread
  `01a17135-c291-70a0-a959-0c7589b0c158`.
- Apply handoff: `01a17136-f557-7e2e-931d-313ba2d752ee`.
- Approved: D1-A Jetpack Ink; D2 native stylus freehand only; D4 shared
  platform-neutral semantics, controller document/history authority.
- No change to the approved scope or stop gates. No device acceptance inferred
  from approval. The proposal's pending-review wording describes its creation.

## Current implementation boundary

`packages/painting-android-ink/` and `/android-ink-probe` are a standalone A0
build/render probe. This is not the `androidInk=1` editor integration, a raw
sampler, or a WebView routing implementation. It neither commits a document nor
changes the existing editor or iOS bridge. A transparent Ink view accepts stylus
preview strokes, retains at most four, and exposes explicit per-stroke retirement.
The probe uses a fixed half-transparent brush and pixel coordinates; density
scales its nominal width only. World/viewport calibration remains unverified.

## Dependency selection

- Direct artifacts: `androidx.ink:ink-authoring:1.0.0`,
  `androidx.ink:ink-brush:1.0.0`, `androidx.ink:ink-strokes:1.0.0`.
- Stable version; no dynamic dependency selector and no Compose dependency.
- License: Apache-2.0, as declared by the published Maven POMs and source JARs.
- Release: https://developer.android.com/jetpack/androidx/releases/ink#1.0.0
- Published source checked for `startStroke`, `addToStroke`, `finishStroke`,
  `cancelStroke`, `removeFinishedStrokes(Set<InProgressStrokeId>)` and the
  finished-strokes listener. API availability is not physical presentation proof.
- SDK/toolchain/ABI and actual build results will be recorded after Gradle runs.

## Device resources observed

2026-10-25: `adb devices -l` returned an empty device list. No `/dev/kvm`.
Android SDK API 36 and build-tools 36.0.0 are installed; JDK 17 is available
outside PATH. No pressure stylus, no-stylus Android run, external 120fps footage,
or Apple toolchain/device evidence has been collected in this run.

## Gates

| Gate | Status     | Missing evidence                                                                                                                                   |
| ---- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| A0   | Not passed | Actual build/start; transparent Ink + Expo DOM/WebView hierarchy, nonblank physical rendering, density/viewport calibration and per-stroke removal |
| A1   | Not run    | Real mixed stylus/finger/WebView routing and preserved controls, IME, three input modes, palm suppression, viewport ownership                      |
| A2   | Not run    | At least 120fps external video for first/continuous/long/translucent/busy/delayed strokes, no gap/double draw/incorrect removal                    |
| A3   | Not run    | Pressure stylus and no-stylus device matrix, recorded metrics, final build, user appearance approval and cross-platform regression                 |

Do not mark task 1.2 complete on prebuild or JS export alone. Do not continue
past A0 into the main bridge/editor integration without its required evidence.
