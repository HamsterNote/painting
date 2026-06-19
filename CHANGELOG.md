# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1-beta.2] - 2026-06-13

### Fixed
- Resolve workspace dependency for @hamster-note/painting (`fix: resolve workspace dependency for @hamster-note/painting`)

## [0.1.1] - 2026-06-13

### Changed
- Version bump for npm publish

## [0.1.0] - 2026-06-13

### Added
- Cubic bezier drawing tool (`feat(tools): add cubic bezier drawing tool`)
- Polygon drawing tool (`feat(tools): add polygon drawing tool`)
- Ellipse tool with shift constraints (`feat(tools): add ellipse and shift constraints`)
- Continuous line drawing support (`feat(tools): support continuous line drawing`)
- Dashed strokes and filled shapes styling (`feat(style): support dashed strokes and filled shapes`)
- Pointer crosshair overlay (`feat(cursor): add pointer crosshair overlay`)
- Opt-in pan and pinch zoom viewport (`feat(viewport): add opt-in pan and pinch zoom`)
- Expanded drawing tools demo (`feat(playground): demo expanded drawing tools`)
- Bezier 3-drag model with rendered-width eraser and pressure multiplier (`feat(painting): bezier 3-drag model, rendered-width eraser, pressure multiplier`)
- Build scripts and tag-based release CI (`feat(ci): add build scripts and switch to tag-based release`)

### Changed
- Replace multi-drag with native pointer input and add eraser sweep collision (`refactor(painting): replace multi-drag with native pointer input and add eraser sweep collision`)
- Centralize drawing interaction state (`refactor(input): centralize drawing interaction state`)
- Share exhaustive stroke renderer (`refactor(render): share exhaustive stroke renderer`)
- Migrate from .sisyphus to .omo and add openspec (`chore(tools): migrate from .sisyphus to .omo and add openspec`)

### Fixed
- Resolve overload redeclare and hide crosshair during pinch (`fix(lint,cursor): resolve overload redeclare and hide crosshair during pinch`)
- Exclude stroke fixture files from jest discovery (`fix(test): exclude stroke fixture files from jest discovery`)

### Other
- Clean stale docs and whitespace (`chore(painting,playground): clean stale docs and whitespace`)
- Mark canvas-tool-expansion final wave approved (`docs(plan): mark canvas-tool-expansion final wave approved`)
- Add .omo to gitignore (`chore: add .omo to gitignore`)
- Harden drawing feature regressions (`test(ci): harden drawing feature regressions`)
