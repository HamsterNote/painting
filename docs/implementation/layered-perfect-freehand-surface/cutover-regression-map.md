# 分层入口的回归迁移

## 公开入口切换

根 `DrawingSurface` / `PaintingBoard` 是新分层组件的同一函数别名，必须传 controller；`/core` 只暴露 schema3 控制器、会话、查询与共享几何。新增 `layered-public-entry.test.tsx` 检查实际公开挂载、旧 API 不可见；原 core 边界测试保留私有 V2 数学闭包检查，新增 schema3 运行时闭包检查（TypeScript AST 排除 type-only imports）。旧纯函数/手势测试仍运行，不通过旧运行路由绕回旧文档。

删除范围：app 的 `legacy`、`editor-candidate`、`resource-editing-fixture`、`canvas-runtime`、`skia-smoke`、`skia-drawing-fixture` 六条路由及其专用 `src` 实现、旧 ExternalPropsDemo。候选目录中未被 Jest 收集的八份 unit 文件是旧 frame/Skia/折线性能实验，不转记为通过；其中保留的输入/事务/正确性行为迁至已收集的分层 core、Canvas、文本、图片与浏览器回归，性能门转入人工设备预算。`canvas-runtime.spec.ts` 的正常/失败切换测试迁为默认分层运行、阻断 WASM 仍可绘制/undo/redo、零 CanvasKit 请求与零 pageerror；WASM retry/back 模式随对应运行时退役。

实跑：`pnpm typecheck` exit 0；全量 `pnpm test` 93 suites / 1502 tests PASS（旧组件回归此批仍完整运行）；分层+playground Chromium 21/21 PASS；运行时迁移 Chromium 2/2 PASS。6.3 已完成，Skia 包源、依赖与旧组件物理退出留下一批。

## 组件回归搬迁（第三批）

旧 DrawingSurface、Minimap、TextDrawingSurface 的保留语义通过真实分层组件重新执行：`layered-surface-regression.test.tsx` 覆盖 dot/raw/up=0、五类形状实时预览/取消、brush 快照、竞争掌触、冻结 viewport、五种生命周期取消和 mouse policy；`layered-minimap.test.tsx` 覆盖开关/混合对象、拖动唯一 viewport、极远/变换对象的有限投影；`layered-text-regression.test.tsx` 覆盖多语言既有文字修改、顺序/图片不变、无修改退出、清空删除、过期修订拒绝及混合文字/图片 move/resize/rotate 预览取消与可逆事务。迁移时修复了未修改文字也产生 history 的问题。

实跑 `pnpm exec jest --runInBand --testPathPattern 'layered-(surface-regression|minimap|text-regression|text-editor)'`：4 suites / 25 tests PASS；五个受影响源文件 ESLint exit 0、Prettier 完成。旧 API 参数/DOM 结构不再作为回归契约，保留语义对应本表和上述新套件；当前批尚未删除旧实现。

## 首批迁移（2026-10-18）

本批先迁调用方与测试，尚未执行 Skia/旧目录删除。`packages/painting-board` 的 `PaintingBoard` 现在直接使用 `LayeredPaintingBoard`，必须传入唯一 controller；`apps/playground/src/App.tsx` 使用同一 Expo DOM 路由。旧 value/ref/pressureMultiplier 不再是公开 board 契约。

| 保留行为                                                                               | 新入口中的可执行回归                                                                                                                   |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| board 满尺寸、初始文档、导航开关/范围、工具/历史唯一真源                               | `packages/painting-board/src/__tests__/{PaintingBoard,LayeredPaintingBoard}.test.tsx`                                                  |
| 原始样本、release=0、提交/undo/redo、取消、工具切换取消、并发来源和 viewport 冻结      | `tests/ui/playground.spec.ts`，`core/layered-freehand-session.test.ts`                                                                 |
| 五档笔宽、六色与自定义颜色、套索隐藏样式控件                                           | `tests/ui/painting-controller-{width,color}.spec.ts`                                                                                   |
| 五类形状的过程反馈/取消/undo、套索/多选移动缩放旋转、raw 不变、快速半径擦除、dash 隔离 | `tests/ui/layered-editor.spec.ts`，`core/layered-tools.test.ts`                                                                        |
| 尺子的无限裁切/刻度、屏幕坐标、普通鼠标绘制、Alt 旋转与反馈                            | `tests/ui/ruler-test.spec.ts`，`input/web/__tests__/rulerGestureController.test.ts`                                                    |
| 触控尺子角度与中线投影、无文字误选                                                     | `tests/ui/touch-ruler-feedback.spec.ts`                                                                                                |
| 鼠标与双指缩放百分比、浮层位置/自动消失、textarea 原生选区与替换                       | `tests/ui/interaction-feedback.spec.ts`；迁移时补齐了分层缩放浮层，`layered-zoom-feedback.test.ts` 验证跨输入源过期 timer 不清除新反馈 |
| touch 导航固定 pair/拒绝第三指、显式 touch 绘制/掌触隔离、取消与 blur 后恢复           | `tests/ui/touch-drawing-arbitration.spec.ts`，`layered-navigation.test.ts`                                                             |
| 真实文本连续两会话逐次撤销与取消、mouse/pen/touch 尺边绘制                             | 前批已迁移的 `resource-editing-fixture.spec.ts`、`ruler-edge-inputs.spec.ts`                                                           |

旧回归中的 V1 controlled/uncontrolled props、DOM 属性/菜单形状、采样率、自由笔 dash/pressureMultiplier、点击序列式形状、中心线分段宽度断言属于被明确替换的 API/算法，不能照搬为新 API 的断言。保留的文档/历史/输入/工具行为在表中通过 schema3 和真实分层 DOM 验证。原 tap 不成笔断言按新规范改为 filled dot。

## 已运行

- `pnpm exec jest --runInBand --testPathPattern 'layered-|painting-board/src/__tests__'`：24 suites / 343 tests PASS，含 native Expo DOM host 最小挂载。
- `pnpm test:ui tests/ui/playground.spec.ts tests/ui/ruler-test.spec.ts tests/ui/touch-drawing-arbitration.spec.ts tests/ui/painting-controller-color.spec.ts tests/ui/painting-controller-width.spec.ts tests/ui/interaction-feedback.spec.ts tests/ui/touch-ruler-feedback.spec.ts --workers=1 --trace=off`：Chromium 17/17 PASS。

这不是全套 UI 或最终 cutover 验收。候选编辑器/Skia 专用回归、公开根入口与旧运行路由尚待核对；不据此勾选 6.3、7.1、7.2 或 7.9。

## 第二批迁移

`editor-candidate.spec.ts` 的保留行为已改为分层回归：单 Canvas 生命周期、文档/导航/history 隔离、多语言/换行 IME、既有文字再次打开/取消、选区预览取消与无位移 noop、删除选中文字后 undo/redo 不恢复失效选区、无 files/cancel/无效 MIME、真实解码 8193×1 图片拒绝。五类形状、选择变换、尺子、资源连续编辑等已由首批表格中的回归承接，不重复依赖旧候选路由。

`editor-candidate-canvas2d-pen.spec.ts` 已迁成 DPR 1/2 的 raw append、历史零逐点 reconcile、取消和 Canvas/SVG 最终像素回归；只附宿主 rAF 观测，不沿用旧 100k 折线 append 的性能阈值。目标设备预算列入 `manual-acceptance.md`。

明确退役的旧断言：CanvasKit/WASM 的加载/失败/重试/互斥 fallback；Skia frame/font tier/provider/descriptor 和 glyph registry 计数；diagStage 分段导入；旧折线 append/no-fullReplay/Skia frame budget。这些专用门不存在于新的架构中，不能保留为假失败，也不把其旧通过结果转记为分层通过。文字内容/真实 HTML 顺序、图片存活与撤销、文档事务和命中能力继续由分层 UI 与 schema3 单元测试覆盖。

抢救批次复验并已推送：`pnpm test` 89 suites / 1472 tests PASS；`pnpm typecheck` exit 0；十份分层 Chromium 文件 38/38 PASS；原独立 WebKit 三文件 21/21 PASS。`13fa7e9` 为普通 fast-forward 推送，未推本地 WIP。

第二批 `pnpm test:ui tests/ui/editor-candidate.spec.ts tests/ui/editor-candidate-canvas2d-pen.spec.ts --workers=1 --trace=off` Chromium 9/9 PASS。`pnpm exec playwright test --config=playwright.webkit.config.ts --workers=1 --trace=off` 在同一受支持容器/宿主服务上运行，十二份分层文件 WebKit 47/47 PASS。改动的三个测试/配置文件 ESLint exit 0，Prettier 通过。

## 解除旧组件的类型耦合

退役前逐项对照原 Minimap 测试，恢复鼠标八个边缘/角落缩放手柄、以中心为锚点缩放、pen/touch 手柄只平移、单 pointer ownership 与取消；NavigationOverlay 支持缺少 ResizeObserver 的宿主。`pnpm exec jest --runInBand --testPathPattern layered-minimap` 7/7 PASS；`pnpm typecheck` exit 0；分层 Chromium 16/16 PASS。新地图拟合同时包含可见 viewport，因此极远 viewport 的指示框可达；schema3 reader 拒绝无效几何，不再沿用 V1 运行时过滤点的入口。

`utils`、selectionResize/Rotation、image 数学和历史 helper 的输入类型移至私有 `model/geometryTypes.ts`，不再通过旧 DrawingSurface 组件导入。已审计的旧纯数学/手势测试改为引用私有 `core/internal.ts`，为公开 `/core` 切换 schema3 做准备；新入口没有引入 V1/V2 文档转换。私有模块不在 package exports 中。

selection/viewport 手势控制器与全部原测试从 `legacy-compat` 完整搬到 `input/web`，旧 DrawingSurface 的临时内部调用方同步使用新位置。没有删减其测试。相关文件统一格式。

- `pnpm typecheck` exit 0。
- `pnpm exec jest --runInBand --testPathPattern 'GestureController|core/|utils|selectionRotation|usePaintingHistory'`：44 suites / 715 tests PASS。
- 改路径后完整 `pnpm test`：89 suites / 1472 tests PASS（测试数未减少）；`pnpm lint` exit 0，仍为 0 errors / 36 warnings。
