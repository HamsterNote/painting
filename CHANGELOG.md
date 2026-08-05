# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0-beta.1] - 2026-08-05

### Added

- 新增自定义颜色列表配置链路：`PaintingBoard.colors` → `PaintingController.presetColors` → `PaintingStrokeColorControl.presetColors`，消费方可为底栏颜色控件指定预设颜色列表（`feat(painting): 添加自定义颜色列表配置链路`）
- 新增公共类型 `PaintingColorOption`（`{ name: string; color: string }`），颜色列表字段均只读
- 未传入颜色列表时保持原有 6 色默认值（Black/Blue/Red/Green/Orange/Purple），向后兼容

### Test

- PaintingBoard 全链路测试：验证自定义颜色替换默认列表、选择后回调与按钮颜色更新（`feat(painting): 添加自定义颜色列表配置链路`）

## [0.4.0] - 2026-07-31

### Added

- 文字与图片笔触支持，笔触属性控件（颜色、宽度）及撤销历史（`feat(painting): 文字/图片笔触支持 + 撤销历史 + 笔触属性控件`）
- 套索选区旋转手柄，围绕选区中心旋转且 rect/ellipse 保持本地宽高；选区缩放支持旋转后的本地坐标系（`feat(painting): 套索选区旋转 + 提取 PaintingController 组件`）
- 提取 `PaintingController` 独立受控组件，可共享控制多个画板
- 选区变换回调（`feat(painting): 选区变换回调 + 文档完善`）
- 交互反馈组件：触屏绘制反馈、缩放百分比锚点反馈等（`feat(painting): add interaction feedback component and expand test coverage`）
- Virtual-Paper 开启时 `DrawingSurface` 根 SVG 与容器默认 `overflow: visible`（`feat(painting): Virtual-Paper 开启时默认 overflow visible`）
- Minimap 增加 `backdrop-filter` 毛玻璃效果

### Changed

- 尺子改为宿主裁剪的屏幕空间无限长条，显示 1/5/10 mm 物理刻度且不显示文字；画布平移和缩放不改变尺子的屏幕几何。
- 尺子在 Minimap 下方显示上下对称的双侧刻度，并支持 Ctrl/Command + 左键平移以及从尺子命中区内使用 Alt + 左键绕宿主可视中心旋转。
- 双指手势通过 `@system-ui-js/multi-drag` 同时平移和旋转尺子；鼠标与触屏旋转均吸附到 45° 的倍数。
- PaintingBoard 底栏新增尺子开关，支持受控/非受控可见性并保留既有尺子配置。
- `DrawingRulerState` 新增可选的顺时针弧度 `rotationRad`；省略时保持与旧版中心状态相同的零角度语义。
- `DrawingStroke` 新增 `rotationRad` 字段，附带 `strokeMigration` 迁移。

### Fixed

- PaintingBoard 受控 `value` 模式：value 独立传入时不再写入 history；`usePaintingHistory` 使用 ref 追踪最新值，避免 batch 内多画板更新互相覆盖（`fix(painting): 受控 value + batch-safe 历史更新`）
- 使用 `useMemo` 缓存 viewport，避免选区浮层循环通知（`fix(painting): 使用 useMemo 缓存 viewport 避免选区浮层循环通知`）
- 修复底部工具栏 CI 交互（`fix(painting): 修复底部工具栏 CI 交互`）
- 触屏尺子角度标签跟随双指中点实时投影，鼠标旋转反馈保持手势起始枢轴（`fix(painting): stabilize touch ruler label, zoom feedback, and SVG selection`）
- SVG 表面禁用原生文本选择（`user-select: none`），文本编辑器显式恢复 `user-select: text`
- 缩放百分比反馈使用稳定的单一锚点，消除靠近宿主边缘时的垂直跳动

### Test

- 交互反馈组件测试覆盖（`feat(painting): add interaction feedback component and expand test coverage`）
- 触屏尺子反馈测试对齐（`fix(painting): align touch ruler feedback test`）
- 尺子边缘输入、控制器颜色/宽度、触屏绘制仲裁等 UI 测试扩展

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
