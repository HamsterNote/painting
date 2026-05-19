# Rect/Line Tools Demo Props - Decisions

## Architectural
- Points-based stroke model preserved for all tools
- No per-stroke style persistence
- No fill, selection, resize handles
- Shared controls in playground (not per-demo)
- Style props affect next stroke only (snapshot at drag start)

## Task Order
- Wave 1: Task 1 (contract + helpers)
- Wave 2: Task 2 (line), Task 3 (rect), Task 4 (playground controls) - parallel
- Wave 3: Task 5 (Playwright + full verification)
