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

Planned lockstep public release: `@hamster-note/painting@0.8.0` and `@hamster-note/painting-board@0.8.0`. Task 3.2 stays open until both are publicly downloadable and consumed by a fresh registry-only project. Local build and dry-run packaging alone do not prove publication.
