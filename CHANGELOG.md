# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- 尺子改为宿主裁剪的屏幕空间无限长条，显示 1/5/10 mm 物理刻度且不显示文字；画布平移和缩放不改变尺子的屏幕几何。
- 尺子在 Minimap 下方显示上下对称的双侧刻度，并支持 Ctrl/Command + 左键平移以及从尺子命中区内使用 Alt + 左键绕宿主可视中心旋转。
- 双指手势通过 `@system-ui-js/multi-drag` 同时平移和旋转尺子；鼠标与触屏旋转均吸附到 45° 的倍数。
- PaintingBoard 底栏新增尺子开关，支持受控/非受控可见性并保留既有尺子配置。
- `DrawingRulerState` 新增可选的顺时针弧度 `rotationRad`；省略时保持与旧版中心状态相同的零角度语义。

## [0.3.0] - 2026-07-21

### Added

- 添加小地图（Minimap）画布导航和预览功能（`feat(painting): add lasso resize handles, controlled viewport, and minimap`）

### Changed

- 将小地图作为 DrawingSurface 内部 Overlay 集成，完善生命周期管理（`refactor(painting): integrate minimap as internal DrawingSurface overlay`）

### Fixed

- 加固小地图生命周期、边界条件及视口输入处理（`fix(painting): harden minimap lifecycle and bounds`, `fix(painting): harden minimap and viewport inputs`）

### Test

- 小地图单元测试（`test(painting): add minimap test coverage`）
- 避免小地图在套索拖拽场景中产生干扰（`test(ui): avoid minimap in lasso drag scenario`）

## [0.2.0] - 2026-07-12

### Added

- Virtual-paper integration with gesture ownership system (`feat(painting): integrate virtual-paper with gesture ownership system`)
- Configurable `eventTarget` and `overflow` props for `DrawingSurface`, with exported `DrawingEventTarget` and `DrawingEventTargetRef` types (`feat(painting): add eventTarget and overflow props with playground demo`)
- Ruler overlay support with playground controls and regression coverage (`feat(ruler): add non-exclusive ruler overlay`, `feat(playground): add ruler demo toggle`, `test(ruler): verify ruler overlay behavior`)
- Crosshair center circle and improved cursor sizing for drawing tools (`feat(painting): improve crosshair size and add center circle`)
- Enhanced crosshair and eraser cursor behavior (`feat(painting): enhance crosshair and eraser cursor behavior`)
- Snap endpoints and lines functionality (`feat(painting): add snap endpoints and lines functionality`)

### Changed

- Added the `@system-ui-js/multi-drag` dependency used by ruler overlay gestures (`build(deps): add multi-drag for ruler overlay`)

### Fixed

- Export runtime helpers, fix renderMode enum, unblock touch/pen ruler bridge (`fix(painting): export runtime helpers, fix renderMode enum, unblock touch/pen ruler bridge`)
- Align multi-drag callback types (`fix(painting): align multi-drag callback types`)
- Include virtual paper ambient types (`fix(painting): include virtual paper ambient types`)
- Preserve ruler's public projection contract (`fix(ruler): preserve public projection contract`)
- Ruler interaction: mouse modifier keys, snap edge correction, touch conflict fix (`fix(ruler): 优化尺子交互：鼠标修饰键支持、吸附边缘修正、触摸冲突修复`)
- Replace global isNaN with Number.isNaN in snap radius input (`fix(painting): replace global isNaN with Number.isNaN in snap radius input`)

### Test

- Ruler overlay behavior verification (`test(ruler): verify ruler overlay behavior`)
- Ruler modifier drag regression coverage for Ctrl move and Alt rotate (`test(painting): add ruler modifier drag regression coverage (Ctrl move, Alt rotate)`)

## [0.1.1-beta-4] - 2026-06-25

### Added

- Selection box visualization for lasso selection (`feat(painting): add selection box visualization`)
- Compute selection bounding box from selected strokes (`feat(painting): compute selection box from selected strokes`)

### Fixed

- Expand pointerdown selector to cover data-interactive elements (`fix(painting): expand pointerdown selector to cover data-interactive elements`)
- Pin @hamster-note/painting dependency to match workspace version (`fix(workspace): pin @hamster-note/painting dependency to match workspace version`)

### Changed

- Improve lasso selection interactions (`feat(painting): improve lasso selection interactions`)

## [0.1.1-beta-3] - 2026-06-19

### Added

- Lasso selection tool with move and delete support (`feat(painting): add lasso selection tool with move and delete support`)

### Changed

- Stabilize document pointer lifecycle and remove gesture remnants (`refactor(painting): stabilize document pointer lifecycle and remove gesture remnants`)
- Remove gesture adapter and touch/mouse/zoom gestures from DrawingSurface (`refactor(painting): remove gesture adapter and touch/mouse/zoom gestures from DrawingSurface`)

### Fixed

- Keep lasso out of space pan (`fix(painting): keep lasso out of space pan`)
- Correct lasso selection geometry (`fix(painting): correct lasso selection geometry`)
- Harden tag release metadata (`fix(ci): harden tag release metadata`)
- Restore workspace install compatibility (`fix(ci): restore workspace install compatibility`)
- Add repository field and provenance support for npm publish (`fix: add repository field and provenance support for npm publish`)

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
