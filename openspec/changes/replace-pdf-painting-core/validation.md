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
