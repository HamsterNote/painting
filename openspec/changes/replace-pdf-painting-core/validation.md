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

## Release verification

Lockstep public release: `@hamster-note/painting@0.8.0` and `@hamster-note/painting-board@0.8.0`.

- PR: https://github.com/HamsterNote/painting/pull/40
- Release source: `v0.8.0` → `3ed1d04d6227d23ea2399b95889b32f8c144a62f`
- Publish workflow triggered: https://github.com/HamsterNote/painting/actions/runs/41580309081

The first workflow finished with failure at the final public-registry verification: both trusted-publishing steps reported success (`+ @hamster-note/painting@0.8.0` and `+ @hamster-note/painting-board@0.8.0`), but the immediately following registry query returned E404. A fresh consumer install and a forced-online metadata query also could not resolve the version. This does not establish an authentication error or a completed public release; no GitHub Release was created. A persisted follow-up is scheduled to inspect registry availability and complete consumer verification before any retry of publishing.

Task 3.2 stays open until both are publicly downloadable and consumed by a fresh registry-only project. Local build, dry-run packaging and a pushed tag alone do not prove publication.
