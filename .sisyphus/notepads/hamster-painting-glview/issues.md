# HamsterPainting GLView Project Issues

## Known Issues / Blockers
- None yet

## Potential Risks
1. Expo GL on web might have different behavior than native
2. `multi-drag-core` API might differ from expected
3. RAF cleanup needs careful handling to prevent leaks

## Workarounds
- `collapsable={false}` on GL wrapper to prevent view-flattening context loss
- Mock GL context in Jest tests

## Task 5 Observations - 2026-05-14
- LSP diagnostics reported only Biome organize-import informational hints after cleanup; TypeScript typecheck and package build passed.
- Bob build still emits pre-existing package export-shape warnings about `exports['.']` fields and disabled ESM option.

## 2026-05-14 Final QA Gate
- Non-blocking warnings observed: react-test-renderer deprecation during Jest, Expo dependency compatibility warnings during Playwright web server startup, bob package export configuration warnings during build, and npm unknown env config warnings during pack dry-run. Commands still exited 0.

## Code Quality Review - 2026-05-14

- Verdict: REJECT. Targeted TypeScript checks passed, but Prettier failed on reviewed files and renderer error/resource handling has quality gaps.
- Issues: missing shader/program compile/link validation; GL cleanup cancels RAF but does not delete WebGL buffer/program/shaders; unnecessary eslint-disable comments in implementation files.
