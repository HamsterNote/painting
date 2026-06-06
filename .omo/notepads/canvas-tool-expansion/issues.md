## 2026-06-06T15:00:07Z Task: 2

- Required `sg --pattern 'export type $TYPE = $$$' --lang typescript packages/painting/src/components/DrawingSurface.tsx` could not run because `sg` is not installed in this environment (`zsh:1: command not found: sg`). Equivalent direct file reads confirmed the current public v1 type exports at the top of `DrawingSurface.tsx`.

## 2026-06-06T16:10:00Z Task: 6

- Required AST search for `stroke.tool === $X` was attempted with the available `ast_grep_search` tool, but the tool returned `Not connected`. Direct file reads confirmed the duplicate SVG render branches and the extraction target at `DrawingSurface.tsx:480-626`.

## 2026-06-07 Task: 7

- No new task-specific tool or implementation issues. Targeted tests, full Jest, typecheck, and build all completed successfully; build emitted only the existing bob package exports warnings.

## Task 13 — Opt-in viewport gestures

- No unresolved Task 13 implementation issues. Verification passed with the existing bob package exports warnings during build; build still exited 0.
