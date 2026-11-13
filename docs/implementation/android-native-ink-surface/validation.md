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
- All six resolved Ink artifacts (authoring, brush, strokes, geometry, rendering,
  nativeloader) are 1.0.0. The authoring AAR declares minSdk 23, minCompileSdk 35
  and minimum AGP 8.6.0. The nativeloader AAR contains `libink.so` for arm64-v8a,
  armeabi-v7a, x86 and x86_64. This is package inventory, not device compatibility.
- Generated Expo 57 / RN 0.86.3 configuration: minSdk 24, compileSdk/targetSdk 36,
  build-tools 36.0.0, AGP 8.12.0, Kotlin 2.1.20, KSP 2.1.20-2.0.1,
  NDK 27.1.12297006, Gradle 9.3.1. No baseline SDK or toolchain upgrade.
- Build host: Linux x86_64, Amazon Corretto OpenJDK 17.0.20.1.

## Local verification (2026-10-25)

Native build command (from `apps/playground/android`, with the existing JDK/SDK
paths configured):

```sh
./gradlew :app:assembleDebug --no-daemon --max-workers=2 -PreactNativeArchitectures=arm64-v8a
```

Result: **BUILD SUCCESSFUL in 3m 59s**, 475 actionable tasks (170 executed,
305 up-to-date). Kotlin module compilation, application compilation, native
linking and APK packaging passed. The APK is 90,312,794 bytes; `aapt dump badging`
confirms `com.hamsternote.paintingplayground`, minSdk 24, targetSdk 36, arm64-v8a.
The APK contains `lib/arm64-v8a/libink.so`. No install or device launch occurred.

APK SHA-256:
`dbe7866cad4ff10b71de32ee10cb5f4109e5260999feee42cd7f6755f3f80474`.

| Check                                                       | Actual result                                                             | Scope                                                                                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                            | Pass before and after module addition                                     | Six workspace projects; lockfile includes only the new workspace importer/link and generated peer metadata                             |
| Android `expo prebuild --platform android --no-install`     | Pass                                                                      | Generated project ignored; no local SDK configuration overwritten; existing expo-system-ui warning remains                             |
| `pnpm run typecheck`                                        | Pass                                                                      | Includes the new package's base and Android TS view plus the existing packages/playground                                              |
| `pnpm run lint`                                             | Pass, 32 existing warnings                                                | New route/package/test also linted separately with no warnings                                                                         |
| `pnpm test`                                                 | Pass, 1233 Jest tests and 9 responder tests                               | Existing core/Web/iOS host and bridge regressions                                                                                      |
| New probe RN tests                                          | Pass, 3 tests                                                             | Missing module/version, event recycling, per-ID retirement preserving later strokes, native ready/cancel state; native boundary mocked |
| `pnpm run test:ui --workers=2`                              | Pass, 168 Chromium tests, 5.3 minutes                                     | Existing browser input, history, controls and layout; not Android native input evidence                                                |
| `pnpm run build:all`                                        | Pass                                                                      | Library + Web build/export; ran serially before final Gradle build                                                                     |
| `pnpm run pack:dry`                                         | Pass                                                                      | Existing public library packages                                                                                                       |
| `pnpm run verify:layered`                                   | Pass                                                                      | Existing exports and retired-runtime checks                                                                                            |
| Android/iOS direct `expo export`                            | Pass                                                                      | Android 1701 / iOS 1607 modules, DOM sub-bundles included; static exports only                                                         |
| Web/iOS output inspection                                   | No `PaintingAndroidInk` or `painting-android-ink` native references found | Existing iOS external messages/host unchanged; Android implementation reached only through `.android` files                            |
| `openspec validate add-android-native-ink-surface --strict` | Pass                                                                      | Planning artifacts valid; apply still 1/21 tasks complete                                                                              |
| `node scripts/test-pencilkit-g1.mjs`                        | Failed: `spawnSync swiftc ENOENT`                                         | Apple SDK contract skipped on Linux; no Swift compiler in PATH; no Apple SDK or physical Pencil verification                           |

Native code for the final APK build: `e020b50fdbbd07340ff366b39588895f05ad3065`.
Exported JavaScript source: `a5d5453ae0ff274c8954c4398990bbb4525238ce`; the next
commit changes only the native cancellation event's non-null guard.
No native/JS source changes were made during the final build/export.
Documentation-only result updates follow these source revisions.

The initial Gradle attempts exposed missing module version metadata and a
nullable event Map value; both were corrected without changing the toolchain.
An early concurrent `build:all` also regenerated the Gradle directory during a
build; it was rerun serially. Reproduction must serialize commands that invoke
Expo prebuild and Gradle. These failed attempts are not acceptance evidence.

## Device resources observed

2026-10-25: `adb devices -l` returned an empty device list. No `/dev/kvm`.
Android SDK API 36 and build-tools 36.0.0 are installed; JDK 17 is available
outside PATH. No pressure stylus, no-stylus Android run, external 120fps footage,
or Apple toolchain/device evidence has been collected in this run.

## Gates

| Gate | Status     | Missing evidence                                                                                                                                                                   |
| ---- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A0   | Not passed | APK build passed; device startup, transparent Ink + Expo DOM/WebView hierarchy, nonblank physical rendering, density/viewport calibration and per-stroke removal remain unverified |
| A1   | Not run    | Real mixed stylus/finger/WebView routing and preserved controls, IME, three input modes, palm suppression, viewport ownership                                                      |
| A2   | Not run    | At least 120fps external video for first/continuous/long/translucent/busy/delayed strokes, no gap/double draw/incorrect removal                                                    |
| A3   | Not run    | Pressure stylus and no-stylus device matrix, recorded metrics, final build, user appearance approval and cross-platform regression                                                 |

Do not mark task 1.2 complete on prebuild or JS export alone. Do not continue
past A0 into the main bridge/editor integration without its required evidence.
