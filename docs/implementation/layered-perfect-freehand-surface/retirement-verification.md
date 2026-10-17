# 退役与验证记录（2026-10-18）

本批从已推送的 `6e2721d` 开始，工作树干净。按最新授权完成切换，既有失败树仍仅在本地 WIP 分支，不参与 PR。

## 保留能力与测试搬迁

- 原 DrawingSurface / Minimap / TextDrawingSurface 文件现在直接执行分层组件；前一批新增的 layered-* 回归搬回这些原测试路径。raw/压力/取消/所有权、五类形状预览、文字/图片混合变换与单事务 undo、地图鼠标缩放和 pen/touch 平移均保留。
- 原 renderer 的形状样式/混排/变换语义迁到 `layered-display-regression.test.tsx`；PF 自由笔 filled outline 取代旧平滑中心线/分段压力/pressureMultiplier/dash 断言。
- 原 VirtualPaperSurfaceFrame 的展示开关、唯一矩阵、无监听器和有限值防护迁到 `VirtualPaper.test.tsx` 与 controller/viewport 数学测试；新版在 controller 拒绝非法更新，不能用渲染 fallback 修补非法状态。
- board/controller/color 组件的保留语义已由 board 包两套组件测试、`layered-toolbar.test.tsx`、公开入口测试和已迁移 UI 文件承接；V1 value/ref、菜单 DOM、旧 prop/layout 注入、侧边文字重排参数不再是 schema3 API，统一对象 transform 契约有三类可逆变换测试。
- 样式解析器与其整个原测试从 render 搬至 model；三个 ruler/selection/viewport 手势控制器及原测试全部在 `input/web`，私有纯数学、history、selectionResize/Rotation 与资源会话原回归保留。
- Skia renderer/provider/mock/CanvasKit suites 与专用 WASM/font/frame 断言随运行时退役；原 UI 的文字/图片/混排/命中/撤销行为已由分层浏览器像素与 core 查询覆盖。旧硬件/长笔预算没有转记为通过，仍在人工清单。

因此全量测试由上一批 93 suites / 1502 tests 变为 82 suites / 1065 tests，减少来自已退役的 API/DOM/算法和 Skia 专用断言。此数字不代表保留所有旧断言，更不作为设备验收证据。能力映射见 `cutover-regression-map.md`，逐项测试文件仍可在 Git 历史复核。

## 依赖与资源审计

`pnpm install --lockfile-only` 仅删锁文件 80 行：Skia、CanvasKit、其独占 @webgpu/types、四个 native Skia 二进制包、react-reconciler 0.31 / scheduler 0.25。无无关升级；Expo 57、RN 0.86、native adapter/最小挂载保留。随后 `pnpm install --frozen-lockfile` exit 0（移除 9 packages）。

新编辑器使用 HTML/system sans-serif，没有旧 font manifest 消费者，因此删除四个专用字体、manifest/许可/README 和生成/校验脚本；未删除系统字体。混合配置只移除 wasm 扩展、Skia setup/peer/dev/meta/export/Jest project 和绝对填充兼容补丁。

旧浏览器性能 runner 依赖已退役候选路由，退出；纯 JSON/provenance/oracle 工具与全部原测试继续保留（55 tests PASS），不再参与当前产品预算。两个独立数学 spike 输出改到 `artifacts/research/`，避免重建旧 change。

## 实跑结果

- `pnpm test`：82 suites / 1065 tests PASS，web/core-node/native 三工程。
- `pnpm exec jest --listTests --runInBand --json`：82 文件；逐个对比 packages 与 native 下 82 个实际测试，missing=[]；没有 Skia project，未把未收集的旧 playground 实验算通过。
- `pnpm typecheck`、`pnpm build`、`pnpm pack:dry`：exit 0。
- `pnpm verify:layered`：exit 0，逐个核对两包 exports 产物存在、源码旧入口不存在、锁文件与包/Expo JS 不含退役 Skia runtime。
- `pnpm lint`：exit 0，0 errors / 32 warnings。
- `pnpm test:ui --workers=1 --trace=off`：完整 Chromium 49/49 PASS。
- `node --test scripts/perf/*.test.mjs`：55/55 PASS，仅纯工具。

## 本批删除清单

- `apps/playground/public/canvaskit.wasm`
- `apps/playground/public/fonts/OFL-1.1.txt`
- `apps/playground/public/fonts/README.md`
- `apps/playground/public/fonts/arabic/hamsternote-web-arabic-regular.ttf`
- `apps/playground/public/fonts/cjk/hamsternote-web-cjk-sc-fixed-3500.otf`
- `apps/playground/public/fonts/emoji/hamsternote-web-emoji-family.ttf`
- `apps/playground/public/fonts/latin/hamsternote-web-latin-regular.ttf`
- `apps/playground/public/fonts/manifest.json`
- `apps/playground/scripts/generate-font-assets.sh`
- `apps/playground/types/react-native-compat.d.ts`
- `packages/painting/src/VirtualPaperSurfaceFrame.tsx`
- `packages/painting/src/__tests__/TextDrawingSurfaceSelection.test.tsx`
- `packages/painting/src/__tests__/VirtualPaperSurfaceFrame.test.tsx`
- `packages/painting/src/__tests__/layered-minimap.test.tsx`
- `packages/painting/src/__tests__/layered-surface-regression.test.tsx`
- `packages/painting/src/__tests__/layered-text-regression.test.tsx`
- `packages/painting/src/__tests__/skia/SkiaDrawingCanvas.test.tsx`
- `packages/painting/src/__tests__/skia/shapedRunProvider.skia.test.ts`
- `packages/painting/src/components/DrawingSurface.tsx`
- `packages/painting/src/components/InteractionFeedback.tsx`
- `packages/painting/src/components/Minimap.tsx`
- `packages/painting/src/components/PaintingBoard.tsx`
- `packages/painting/src/components/PaintingController.tsx`
- `packages/painting/src/components/PaintingFontSizeControl.tsx`
- `packages/painting/src/components/PaintingStrokeColorControl.tsx`
- `packages/painting/src/components/PaintingStrokeWidthControl.tsx`
- `packages/painting/src/components/__tests__/PaintingBoard.test.tsx`
- `packages/painting/src/components/__tests__/PaintingController.relative.test.tsx`
- `packages/painting/src/components/__tests__/PaintingController.test.tsx`
- `packages/painting/src/components/__tests__/PaintingStrokeColorControl.test.tsx`
- `packages/painting/src/hooks/useCanvas.ts`
- `packages/painting/src/legacy-compat/rulerGestureController.ts`
- `packages/painting/src/render/ImageRenderer.tsx`
- `packages/painting/src/render/StrokeRenderer.tsx`
- `packages/painting/src/render/TextRenderer.tsx`
- `packages/painting/src/render/__tests__/StrokeRenderer.test.tsx`
- `packages/painting/src/render/__tests__/resolveStrokeStyle.test.ts`
- `packages/painting/src/render/resolveStrokeStyle.ts`
- `packages/painting/src/skia/SkiaDrawingCanvas.tsx`
- `packages/painting/src/skia/descriptors.ts`
- `packages/painting/src/skia/index.ts`
- `packages/painting/src/skia/shapedRunProvider.web.ts`
- `packages/painting/src/skia/types.ts`
- `packages/painting/testUtils/textDrawingSurface.tsx`
- `scripts/perf/editor-production-performance.mjs`
- `tests/jest/skia/canvaskit.skia.test.tsx`
- `tests/ui/legacy-path.ts`
- `tests/ui/skia-drawing-fixture.spec.ts`
- `tests/ui/skia-performance.spec.ts`

旧 change 的 33 文件不在本批删除；6.5 会在八项义务及 Git 备份复核后单独执行。最终 7.9/7.10 后还须重跑 strict 和完整测试。
