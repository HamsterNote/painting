## Local validation — 2026-11-03

| Check | Result |
| --- | --- |
| `pnpm test` | 95 suites / 1266 tests, plus 9 responder tests passed |
| `pnpm exec playwright test tests/ui/page-integration.spec.ts --workers=1` | 3 passed, Chromium DPR 1 / 2 / 3 |
| `pnpm typecheck` | painting, painting-board and playground passed |
| `pnpm lint` | 0 errors; 32 pre-existing jest/expect-expect warnings |
| `pnpm build` | Both packages and Expo Web demo passed |
| `pnpm verify:layered` | Public files, ESM/CJS core imports, retired-runtime exclusion passed |
| `npm pack --dry-run --json` in both packages | 0.8.0 artifacts and new runtime/type files present |
| `openspec validate replace-pdf-painting-core --strict` | Passed |

Migration fixtures include the byte-preserved reader v4 file and data produced by the actual published painting 0.4.0 normalizer. Tests cover all tool types, color/width aliases, pressure, resource IDs, optional legacy styles, deterministic IDs, invalid inputs, input immutability and repeated migration/serialization.

Page tests cover scale 0.1–16, scroll during a stroke, crop/rotation matrices, fractional CSS dimensions, ancestor axis-aligned CSS zoom, coalesced samples, disabled input, second-finger cancellation, page/geometry changes and reopening saved IDs. Browser tests check actual active Canvas alpha pixels, stable persisted samples, historical SVG screen anchors within 1 CSS px, color and switching/restoring pages at DPR 1/2/3.

The fixture simulates PDF page geometry. Real pdf.js integration, reader save/ack behavior and native pen/palm/WebView behavior still need reader/device acceptance; synthetic events do not establish those results. The complete pre-existing browser suite was not run.

## 0.8.0 release history

Lockstep public release: `@hamster-note/painting@0.8.0` and `@hamster-note/painting-board@0.8.0`.

- PR: https://github.com/HamsterNote/painting/pull/40
- Release source: `v0.8.0` → `3ed1d04d6227d23ea2399b95889b32f8c144a62f`
- Publish workflow triggered: https://github.com/HamsterNote/painting/actions/runs/41580309081

The first workflow finished with failure at the final public-registry verification: both trusted-publishing steps reported success (`+ @hamster-note/painting@0.8.0` and `+ @hamster-note/painting-board@0.8.0`), but the immediately following registry query returned E404. The registry subsequently exposed 0.8.0, as independently confirmed in the HAM-131 thread; this version and its tag remain unchanged. Review then found that ordinary pen migration bypassed common style validation, so reader integration now requires the 0.8.1 patch.

## 0.8.1 patch validation — 2026-11-03

- Common `rotationRad`, `fillColor`, `fillOpacity` and `dashOffset` checks run before tool dispatch. Invalid fields fail the whole mixed document with the original field path, without modifying input. Valid pen input retains its freehand result.
- Added 14 tests: 12 invalid mixed-document cases across pen/text/image and 2 valid pen cases (absent or all-zero dash array). Before the fix, 10 of these failed; after the fix, both migration/page suites passed (46 tests).
- Full Jest run: 93 suites / 1278 tests passed, 2 existing native UI tests exceeded the default 5-second timeout during concurrent builds. Isolated rerun of the 2 affected suites: 19/19 passed without code changes or an increased timeout. All 1280 tests are covered by the full run plus that rerun. Responder tests: 9/9 passed.
- Typecheck, lint (0 errors, 32 existing warnings), both package builds, Expo Web build, layered delivery/export verification, both package dry-run packs and OpenSpec strict validation passed. Browser DPR tests were not rerun for this migration-only patch.
- Release source: `v0.8.1` → `30e959300d67aaabe598379d541cf733b2290f3d`.
- Workflow: https://github.com/HamsterNote/painting/actions/runs/41584520899.
- Both publish steps received HTTP 202 and reported that npm was processing the packages; the immediate post-publish query returned E404. This workflow did not create a GitHub Release. The public npm packages subsequently became available; verification below completes task 3.2 without republishing or moving either release tag.

## 0.8.1 public package verification — 2026-11-03 05:40 UTC

- `npm view @hamster-note/painting@0.8.1 version dependencies dist-tags --registry=https://registry.npmjs.org --prefer-online --json` and the equivalent painting-board command both returned version/latest `0.8.1`. Board depends on exact `@hamster-note/painting: 0.8.1`.
- `npm pack` downloaded both exact versions from the public registry. The downloaded tarballs' SHA-512 integrity matches the independent consumer lockfile entries.
- A fresh private consumer installed both exact versions using `npm install --ignore-scripts --legacy-peer-deps --no-audit --no-fund --registry=https://registry.npmjs.org --prefer-online`. Both lockfile entries resolve to registry URLs, with no git/file/link/workspace replacement.
- All declared export targets exist in both installed packages. The layered declarations expose migration, page surface/props, geometry, reader/serializer and controller APIs.
- Both ESM `import('@hamster-note/painting/core')` and CJS `require('@hamster-note/painting/core')` expose the expected functions. In each format, mixed pen inputs with `dashOffset: 'broken'`, `fillOpacity: 2` and `rotationRad: 'broken'` return the exact `invalid-document` field path without changing the source; valid pen migration/serialization and page geometry round-trip pass.

The published P2 fix is verified. Reader integration should pin exact `@hamster-note/painting@0.8.1`; the overall HAM-131 reader/device acceptance remains outside this package delivery.

## 0.8.2 read-only surface patch — 2026-11-03

Reader integration found that `enabled=false` on the first mount skipped the presentation coordinator as well as input initialization. Presentation now follows its controller/trace lifetime independently. Disabling input cancels unfinished gestures and removes listeners, while saved content remains mounted and subscribed. Read-only SVG objects and interactive overlays cannot intercept underlying page events.

- Two new component regressions failed before the fix (missing history layer). They now cover all saved object types from the real 0.4.0 fixture, StrictMode, geometry/page/full remounts, disabled document updates, controller replacement and enable/disable cycles with active-input cancellation.
- Targeted surface tests: 3 suites / 34 tests passed. Full Jest: 95 suites / 1282 tests passed; responder: 9/9 passed.
- Typecheck, lint (0 errors / 32 existing warnings), both package builds, Expo Web build and layered export verification passed.
- Chromium against the built Expo Web app: 6/6 tests passed across DPR 1/2/3, covering read-only saved pen/shape/text/image display, remounts, event pass-through and unchanged document data, plus existing input/Canvas/SVG alignment across zoom, scrolling and rotation. A dedicated local static server was used; no existing service was reused.
- Version metadata and board's exact dependency are 0.8.2; previous release tags remain unchanged.
- PR: https://github.com/HamsterNote/painting/pull/41; release source `v0.8.2` → `368ec760d7b4a5b3771962e4f0463ddd99fa6163`.
- Workflow https://github.com/HamsterNote/painting/actions/runs/41587615290 received HTTP 202 for both publishes and npm's processing notice. Its immediate registry check returned E404; independent queries at 06:06 UTC also returned E404. The packages subsequently became public, and the checks below complete task 4.2. No version was republished and no tag was moved; the initial workflow did not create a GitHub Release.

## 0.8.2 public package verification — 2026-11-03 06:20 UTC

- Public `npm view` returned version/latest `0.8.2` for painting and painting-board, with board depending on exact painting `0.8.2`.
- Both exact-version `npm pack` downloads and a fresh registry-only consumer installation succeeded. Lockfile URLs point to registry.npmjs.org, with no git/file/link/workspace replacement; downloaded tarball SHA-512 values match the installed lockfile integrity.
- All declared export targets and layered declarations exist. ESM/CJS core runtime checks passed, including the three 0.8.1 migration regressions, source immutability, valid pen serialization and page-coordinate round-trip.
- An independent browser bundle imports the published root, layered and painting-board entries and asserts their public page/migration exports. It contains no local painting implementation.
- Chromium consumer tests: **3/3 passed**, one each at DPR 1/2/3. Initial `enabled=false` displays saved freehand, shape, text and image objects; page/geometry remounts and enable/disable transitions preserve their display; hit testing passes through to the underlying page; document snapshots remain unchanged.

Reader can pin exact `@hamster-note/painting@0.8.2` and continue its integration acceptance. Real pdf.js/host persistence and device WebView verification remain reader-side work.

## 0.8.3 disabled text editing patch — 2026-11-03

Review found that an active text editor survived disabling input: Ctrl+Enter could still create an object and the editor intercepted page events. Text requests now belong to a controller and render only while input is enabled. Disabling input or replacing the controller clears the request; invalid geometry and page/full remounts cancel the editor. The editor's layout effect owns its session, cancels it synchronously on cleanup and creates a new one during StrictMode replay. Both direct and IME persistence check current session identity before writing.

- Seven added component cases cover disable, invalid geometry, page/geometry remount, controller replacement, full unmount, fresh edits after enabling and pending IME edits of saved text under StrictMode. Before the fix, three failed: disabled drafts committed, controller replacement retained the editor, and StrictMode could not commit fresh text. All seven now pass.
- Targeted component validation: 4 suites / 30 tests passed. Full Jest: **96 suites / 1289 tests passed**; responder: **9/9 passed**.
- Chromium against built Expo Web: **9/9 passed** at DPR 1/2/3. Each DPR checks disabled keyboard/button/IME completion, removal of the editing area, actual clicks through to the underlying page, and a fresh edit after enabling. Existing read-only archive/remount and zoom/scroll/rotation alignment tests also pass.
- Typecheck, lint (0 errors / 32 existing warnings), both package builds, Expo Web build, layered export verification, both package dry packs and OpenSpec strict validation passed.
- painting and painting-board metadata, exact board dependency and lockfile are 0.8.3. Public package verification below completes task 5.2; previous release tags remain unchanged.
- PR: https://github.com/HamsterNote/painting/pull/42. Release source `v0.8.3` → `2cce871fa21672af3558ac61e4f71cf62d5e33bd`; workflow: https://github.com/HamsterNote/painting/actions/runs/41591264040. The immediate verification returned E404 at 06:40:38 UTC, before the packages became visible; no GitHub Release was created. The tag was pushed once and no package was republished.

## 0.8.3 public package verification — 2026-11-03 06:44 UTC

- Public `npm view` returned version/latest `0.8.3` for both packages. Board depends on exact painting `0.8.3`; registry `time.modified` is `2026-11-03T06:42:36.197Z` for painting and `2026-11-03T06:41:53.315Z` for board.
- Both `npm pack` downloads and a fresh exact-version registry installation succeeded. SHA-512 checks match the downloaded tarballs and installed lockfile integrity; both installed packages resolve to registry.npmjs.org without git/file/link/workspace replacements.
- Tarball comparison is byte-for-byte identical: painting's 206 source/configuration files match release commit `2cce871`, its 880 generated files match the local build from those unchanged sources, and board's 12 files match the release commit. The publish workflow's `headSha` is the same release commit.
- All export targets and layered declarations exist. ESM/CJS core exports, three invalid-field migration regressions, source immutability, valid pen serialization and page geometry round-trip passed.
- The independent consumer bundles the published root/layered/board entry points without local painting implementation. Chromium **9/9 tests passed** at DPR 1/2/3: disabled keyboard/button/IME submissions cannot save text drafts; the editing area is removed and actual clicks reach the underlying page; enabling permits a fresh successful edit. Read-only complete archive/remount and zoom/scroll/rotation positioning regressions also pass.

Reader can pin exact `@hamster-note/painting@0.8.3` and run its assigned persistence regression. The scheduled verification wakeup was disabled because this run completed its work. Overall reader/host/device acceptance remains outside this package delivery.
