# 阶段 5 验证报告：Skia 世界层/屏幕层渲染与唯一 viewport matrix

- 变更：`migrate-expo57-skia-surface`
- 任务：5.1、5.2、5.3、5.4（阶段 5 整体）
- 验证所有者：父 orchestrator
- 状态：**阶段 5 已通过，Oracle Gate 5 attempt 3 APPROVE**
- 生成时间：2026-09-24
- 写入范围：仅本报告文件（`verification/`）。未修改产品源码、依赖、lockfile、测试或 CI；未改动任务 1.4 与 4.2。

## 结论速览

| 任务 | 结论 | 证据 |
| --- | --- | --- |
| 5.1 Skia 世界层渲染（笔迹/形状/文本/图片） | ✅ 通过 | 隔离子路径 `@hamster-note/painting/skia`；8 种 V2 对象按文档顺序渲染 |
| 5.2 屏幕恒定 overlay | ✅ 通过 | `describeScreenOverlays` world/screen 语义 + descriptor 单测 |
| 5.3 唯一 viewport matrix | ✅ 通过 | 单一 world Group `Matrix3` + identity sibling overlays |
| 5.4 DIP 逻辑单位与无手工 DPR | ✅ 通过 | on-screen Canvas/几何/overlay/input 均为 DIP；fixture `onLayout` 实测 DIP |

**总体判定：阶段 5 通过（5.1–5.4）。Oracle Gate 5 attempt 3 APPROVE。**

## 5.1 Skia 世界层渲染与子路径隔离

- **隔离子路径**：Skia 渲染器只经 `@hamster-note/painting/skia` 暴露。`packages/painting/package.json` 的 `exports["./skia"]` 提供 `react-native`→`./src/skia/index.ts`、`import`→`./lib/module/skia/index.js`、`require`→`./lib/commonjs/skia/index.js`；包根 `packages/painting/src/index.ts` **不 re-export** `./skia`（根 barrel 检索不到 skia 导出），确保 Web legacy/native 根图不会被 CanvasKit 依赖污染。
- **canonical 实现**：`packages/painting/src/skia/{SkiaDrawingCanvas.tsx,descriptors.ts,types.ts,index.ts}`。`describeSkiaDocument`/`describeSkiaStroke` 将 V2 文档转为可绘制描述，`SkiaDrawingCanvas` 消费描述完成真实 Skia 绘制。
- **8 种 V2 对象**：pen、line、rect、ellipse、polygon、bezier、text、image 均按 `document.strokes` 原始顺序（后绘制者在上层）生成描述并渲染；描述顺序为 `path/path/rect/ellipse/path/cubic-bezier/text/image`。
- **文本渲染**：使用标准 `Skia.ParagraphBuilder.Make({}, fontManager)` + `Skia.TypefaceFontProvider.Make()` + `fontManager.registerFont(typeface, family)`；**不存在** 字体原型/实例 monkey patch，也不依赖未实现的系统字体查询；仅当 `fontManager`、`fontFamily` 与正宽度同时具备时才构建 Paragraph。
- **资源同步注入**：renderer 只消费调用方同步注入的已就绪 `fontManager`/`fontFamily`/`getImage(src)`；**不负责**加载、缓存、权限或重试（后置 8.x / 7.1）。缺失资源时走**可见几何回退**（文本边框 + 浅填充、图片矩形浅填充 + 描边），绝不静默 no-op。

## 5.2 屏幕恒定 overlay

- **world / screen 语义**：overlay 携带 `space: 'world' | 'screen'`。world overlay 仅把 anchor/vertices 经 viewport 投影到屏幕，线宽、marker 半径与 dash 全部保持 **screen DIP**；screen overlay 直接保留输入，viewport 变化不影响位置/方向/尺寸。
- **层级**：overlay 是 world Group 之后的 **identity sibling**，不进入世界变换矩阵；world 矩形显式投影四个顶点（不会只缩放 x/y 而遗漏其余顶点）。
- **验证方式**：`__tests__/skia/SkiaDrawingCanvas.test.tsx` 的 descriptor 测试断言：screen 描述在两组不同视口下**完全相等**；world marker 圆心随视口改变但 `radius` 恒定；world 虚线与 dash 样式（`strokeWidth`/`dashArray`/`dashOffset`）保持屏幕 DIP 不变；fill/dash 渲染 props 与语义一致。

## 5.3 唯一 viewport matrix

- **单一 affine**：world→screen 由 `createViewportAffine` 生成 `screenX=a*x+c*y+tx`、`screenY=b*x+d*y+ty`，交付 Skia 时经 `toSkiaMatrix3` 转为行主序 `[a, c, tx, b, d, ty, 0, 0, 1]`，只在**单一 world Group** 应用一次（`<Group matrix={worldMatrix}>…</Group>`）。
- **无重复变换**：overlay 是 world Group 之后的 identity sibling，不存在 CSS/SVG/对象级第二个 viewport 变换；单测断言整棵宿主树中带 `matrix` 的 Group **恰好 1 个**，其值等于 `[2,0,10,0,2,-5,0,0,1]`。
- **同一纯 affine 复用**：`canvasToScreen`/`screenToCanvas` 内部委托 `createViewportAffine`、`mapViewportAffinePoint`、`invertViewportAffine`（不可逆时明确返回 `null`）；`composeViewportAffine` 满足 `map(compose(outer,inner),p) === map(outer,map(inner,p))`。`__tests__/viewport-affine.test.ts` 覆盖 forward/inverse/composition/`toSkiaMatrix3` 映射。
- **相机重基后置**：每帧 transient camera-origin rebase 归 **6.3**，不在本阶段。

## 5.4 DIP 逻辑单位与无手工 DPR

- **on-screen DIP**：`SkiaDrawingCanvas` 的 Canvas 布局、world Group、world geometry、overlay 与 input 全部使用 DIP；应用层**不读取也不换算** `PixelRatio`/`devicePixelRatio`，backing store 由渲染后端处理。offscreen surface / `RuntimeShader` 等物理 px 契约本阶段不做。
- **fixture DIP 实测**：`SkiaFixtureSurface` 通过 `onLayout` 的 `nativeEvent.layout` 读取画布宽高（DIP），并直接作为 Canvas props；状态读数以 DIP 展示（`scale · tx · ty（DIP）`），全程无手工乘 DPR。

## 验证命令与结果

| 命令 | 结果 |
| --- | --- |
| targeted Jest（`__tests__/skia` + `viewport-affine.test.ts`） | **2 suites / 38 tests passed** |
| 全量 `pnpm test` | **43 suites / 788 tests passed** |
| `pnpm typecheck` | **通过** |
| `pnpm build` | **通过** |
| `pnpm lint` | **0 error / 8 warnings** |
| `git diff --check` | **通过（exit 0）** |
| Expo export `web` / `android` / `ios` | **通过**（android/ios 为静态导出，不构成 native 运行时证据） |

- targeted Jest 命令：`node_modules/.bin/jest --runInBand packages/painting/src/__tests__/skia packages/painting/src/__tests__/viewport-affine.test.ts`。
- 本轮 targeted Jest 未提交脚本运行确认：**2 suites / 38 tests passed**。

## 真实 Web E2E（CanvasKit）

- **命令**：

```bash
python3 /home/zhangxiao/.config/opencode/skills/webapp-testing/scripts/with_server.py \
  --server "pnpm --dir apps/playground run dev:web" \
  --port 5266 --timeout 90 \
  -- python3 /tmp/opencode/phase5_skia_fixture_e2e.py
```

- **观察结果**：
  - `/skia-drawing-fixture` 经本地 `LoadSkiaWeb({ locateFile: file => `/${file}` })` 载入后进入就绪态；`canvaskit.wasm` 为**同源 200 且 `application/wasm`**。
  - 资源就绪文案确认 **真实 glyph**（FixtureSans，TypefaceFontProvider 注册）与 **真实像素**（96×64 程序生成 PNG）；文本区域检出深蓝 glyph 像素，图片区域检出彩色非灰阶像素。
  - 8 种对象语义标记（`skia-fixture-object-*`）全部可见；缩放档位与平移控件驱动 viewport。
  - **dSF1 画布 686×420、dSF2 画布 1372×840**，随 `deviceScaleFactor` 1→2 精确翻倍。
  - scale 0.5 / 4.0 + 平移时，固定 screen 品红 marker 保持原位（位移 ≤1.5px），世界层画面随缩放/平移变化。
  - **无 console error、无 page error**。
  - **运行时有非 fatal 警告**：SkPath 相关 deprecation 警告与 GPU `ReadPixels` 警告；二者不阻断渲染与断言。

## 准确边界

- **fixture 为静态 descriptor**，位于非默认路由 `/skia-drawing-fixture`，**不表示** GestureSession/InputAdapter 已接线，也不代表默认绘制面切换。
- **Canvas 外 role legend 的 testID 不能作为 Canvas 内像素证据**：对象/角色语义标记是外层可访问文本；Canvas 内像素证据来自画布截图的 glyph/彩色像素与 marker 质心分析。
- 本阶段证据为 **真实 CanvasKit（Web）+ descriptor 单测** 的组合，**不宣称** native runtime（iOS/Android）行为；`expo export --platform android|ios` 仅静态导出。
- **不做** 阶段 6/7/8/10 的内容：共享几何/命中与空间过滤（6.x）、CanvasKit 失败回退与默认切换（7.x）、文本编辑/资源导入（8.x）、性能与三端验收门（10.x）均后置。
- **任务 1.4 与 4.2 债务不变**：Linux 环境无 iOS/Android 模拟器或真机，三端真实运行时门与 Native Adapter 真实设备证据仍缺失；本报告不改变其未完成状态。
