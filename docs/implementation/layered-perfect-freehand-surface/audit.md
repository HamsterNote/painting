# Task 1.2 / 1.3 Skia 复用审计（固化清单）

- 来源：`.slim/deepwork/layered-perfect-freehand-surface.md` 已接收只读审计（exp-1 完整补充 + 主编排源码核对）。
- 状态：**未授权删除**。本文件仅固化 keep/remove/replace 与复审项；实际删除须经 gate 1 与主编排批准。
- 备份：`/home/zhangxiao/.cache/opencode-tmp/opencode/backups/layered-perfect-freehand-surface-20261005-153833`（349 成员，sha256 校验通过），旧 change 与新 change 均在其中。
- 旧 change：`migrate-expo57-skia-surface` 实际 **38/46** 完成，未完成 9.2、10.1/10.2/10.3、11.1/11.3/11.4、12.1；仅 6.5 删除，不伪归档。

## 1. Remove（Skia 专用，待授权）

- `packages/painting/src/skia/{descriptors,index,shapedRunProvider.web,SkiaDrawingCanvas}.ts|.tsx`、`types.ts`
- `packages/painting/src/__tests__/skia/{shapedRunProvider.skia.test.ts,SkiaDrawingCanvas.test.tsx}`
- `tests/jest/skia/canvaskit.skia.test.tsx`
- `apps/playground/src/skia/{index.ts,SkiaSmokeRoute.tsx,SkiaSmokeRoute.web.tsx,SkiaSmokeSurface.tsx}`
- `apps/playground/src/skia-fixture/{fixtureAssets.ts,fixtureContent.ts,SkiaDrawingFixtureRoute.tsx,SkiaDrawingFixtureRoute.web.tsx,SkiaFixtureSurface.tsx}`
- `apps/playground/src/canvas-runtime/{CanvasRuntimeRoute.tsx,CanvasRuntimeRoute.web.tsx}`
- `apps/playground/app/{skia-smoke.tsx,skia-drawing-fixture.tsx,canvas-runtime.tsx}`
- `apps/playground/public/canvaskit.wasm`
- 依赖者：`packages/painting/package.json` 的 `./skia` export 与 peer/dev 入口；`jest.config.js` 的 `skiaCanvasKitProject`；上述 app 路由。删除任一须同步清理这些引用，避免悬空导出。

## 2. Replace（先迁移保留功能与测试映射，非裸删）

- `apps/playground/src/editor-candidate/**`（默认 `/` 编辑入口）→ 新分层 controller/display 入口。
- `apps/playground/src/resource-editing-fixture/**` 与 `app/resource-editing-fixture.tsx`、`tests/ui/resource-editing-fixture.spec.ts`。
- `apps/playground/src/LegacyPlaygroundRoute.tsx|.web.tsx`、`app/legacy.tsx`、`src/App.tsx` 的 demo/legacy 路由。
- `app/index.tsx` 默认路由、`packages/painting/src/components/DrawingSurface.tsx`（旧单体运行时）。
- `packages/painting/src/render/{StrokeRenderer,ImageRenderer,TextRenderer}.tsx` 分支可参考，自由笔中心线/折线路径不保留。
- 约束：保留能力（绘制、导航、文字、资源）先迁至新入口并完成测试映射，再退出旧路由。

## 3. 混合文件（仅局部清理，不整文件删）

- `packages/painting/package.json`：`./skia` export、`@shopify/react-native-skia` peer/dev/meta。
- `apps/playground/package.json`：Skia 依赖、`setup:skia-web` script。
- `jest.config.js`：`skiaCanvasKitProject`。
- `apps/playground/metro.config.cjs`：`wasm` assetExts 扩展。
- `pnpm-lock.yaml`：由 `pnpm` 更新，不手抹版本。
- `apps/playground/types/react-native-compat.d.ts` Skia 兼容声明按实际引用局部处理。

## 4. Keep（平台无关 / 非 Skia）

- `.github/workflows/{ci-pr,publish}.yml`；`pnpm-workspace.yaml`；`apps/playground/{app.json,babel.config.cjs,tsconfig.json}`。
- `apps/playground/src/native-adapter/**`、`app/native-adapter-smoke.tsx`、`tests/jest/native/**`。
- `packages/painting/src/ruler/**`、VirtualPaper/Minimap、`core/resourceRegistry.ts`、`core/textEditSession.ts`（语义）。
- 可参考复用：`core/{geometry,polygonBoolean,spatialIndex,viewportTransform}.ts`、`core/gesture/{ownership,session}.ts`、`core/{document,editorDocument,selectionTransform,selectionOverlay}.ts`、`input/{web,native}/**`、`model/{image,text}.ts`。

## 5. 待复审（非确定删除，须核独占使用）

- `scripts/perf/editor-production-{performance,performance-oracle,performance-oracle.test,baseline-gate,baseline-gate.test}.mjs`、`source-identity{,.test}.mjs`、`static-spa-server.mjs`（内部成闭环，但引用旧 change phase-10 artifact）。
- `spikes/coordinate-performance/**`、`spikes/product-performance/**`（旧 change spike）。
- `apps/playground/public/fonts/**`（4 字体 + manifest.json + OFL/README）与 `apps/playground/scripts/generate-font-assets.sh`：当前宿主为 editor-candidate 替换候选，须确认新入口字体消费链后再定去留。
- `tests/ui/editor-candidate-canvas2d-pen.spec.ts` 与 `tests/ui/canvas2d-pen-pixel-helpers.ts`、Skia fixture UI tests：替换入口稳定前不删。

## 6. 复用边界（1.3，不能照搬）

- `model/strokes.ts` V2 仅含 `x/y/pressure?`，pen 继承 dash，缺 `time/phase/source/brush/transform/revisions` → **不满足新 raw 契约，必须替换**，非直接复用。
- `model/strokeMigration.ts`：V1→V2 normalize，**不建立 legacy fallback**，新模型不照搬。
- `core/editorController.ts`：直接 import `drawingFrame`/`selectionQuery` frame 查询 → **frame 耦合，须剥离后才能作为 headless controller 基础**。
- `core/selectionFrame.ts`：import `preparedDocument.prepareDrawingDocument` 全量 prepare → **frame 耦合，不复用**。
- `core/{drawingFrame,frameBudget,frameClipping,preparedDocument}.ts`：旧 Skia frame 预算链，design non-goal，不继承其结论。
- `core/textEditSession.ts`：绑定 V2 document，应**移植状态语义**（draft/composition/一次提交事务），不原样用于新模型。
- 私有 CatmullRom/velocity interpolation、旧单体 DrawingSurface/legacy-compat/中心线自由笔：不盲继承。

## 7. 非 Skia dirty 文件

- 备份时刻 35 M / 4 D 均为用户既有工作；本审计只分类，**未修改任何 dirty 文件**，禁止 reset/clean。
