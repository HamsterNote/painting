# 任务 6.3 验证报告（Web-only）：安全几何 FrameGeometryProgram

- 变更：`migrate-expo57-skia-surface`
- 任务：**6.3**（坐标策略落地 + 安全几何支持）
- 验证所有者：父 orchestrator
- 门禁：**Gate 6.3 专项 attempt 3/3 APPROVE**（父 orchestrator 为验证所有者）
- 状态：**在正式 Web-only 验收范围内关闭 6.3**
- 生成时间：2026-09-25
- 写入范围：仅本报告文件、`tasks.md` 的 6.3 勾选与本节链接、`.slim/deepwork/migrate-expo57-skia-surface.md` 状态回填。
  未修改产品源码、测试、依赖、`package.json`、lockfile、CI 或任何其它 OpenSpec 工件。

## 1. 范围声明（Web-only；明确不代表 native）

- 本验收遵循 `decisions/web-only-acceptance-scope.md`：正式产品验收面为 **Web**；
  原生 iOS/Android **只保留 `compat-static` 静态兼容门**。
- 6.3 的关闭**仅**表示：在 **Web-only** 范围内，canonical、预算安全的
  **FrameGeometryProgram** 已完成并通过专项门禁。
- **明确不代表**：
  - **native / 全平台运行**（`getShapedLines` 等 shaped-run 能力**仅 Web**；原生不做 shaped run 验收）；
  - **legacy SVG 整体迁移**（legacy 绘制面与回退仍在，删除归 11.1，且需先完成 7.4）；
  - **默认 Skia 切换 7.4**（根 `/` 仍为 legacy 多 demo，`/canvas-runtime` 仅隔离 smoke）；
  - **性能门 10.x**（Web 性能合同尚未执行，10.1/10.2/10.3 仍 OPEN）；
  - **绝对视觉 / 逐像素等价**（几何近似、f32 预算与 cap 均带来**有界非零误差**，本报告不作“无误差”声明）。
- 原「缺 iOS/Android 真实运行证据」要求已 `CANCELLED`，不再阻塞 6.3；
  但 `expo export`、Node/Jest 与 Web CanvasKit **均不得**被包装为原生运行时证据。

## 2. 结论速览

| 能力 | 结论 | 主要证据 |
| --- | --- | --- |
| partial cubic / ellipse 安全裁剪 | ✅ 通过 | `frameClipping.test.ts` 的 cubic/ellipse 用例；contour cap 提升后安全收敛 |
| 复杂 / 自交闭合路径的显式 nonzero compound fill | ✅ 通过 | `polygonBoolean.test.ts` nonzero 环绕 + `frameClipping.test.ts` concave/self-intersect compound 用例 |
| contour cap（含 > 65,536 段的历史 cap） | ✅ 通过 | `frameClipping.test.ts` 超过旧 65,536 contour cap 与旧 1024 段 cap 的用例 |
| 巨大 partial image | ✅ 通过 | `frameClipping.test.ts` huge partial image 仍可渲染；`frameBudget.test.ts` resource 预算 gate |
| 巨大 partial shaped-run text | ✅ 通过 | `shapedRunProvider.skia.test.ts` 超预算 paragraph 用例；`frameBudget.test.ts` fontReady + opaque handle gate |
| render / hit 只接受同份通过最终预算的 frame program | ✅ 通过 | `frameBudget.test.ts` / `drawingFrame.test.ts`；render/hit 共用 `renderableEntries` |

**总体判定：在 Web-only 范围内，canonical、预算安全的 FrameGeometryProgram 已完成，Gate 6.3 专项 attempt 3/3 APPROVE，6.3 关闭。**

## 3. FrameGeometryProgram 关键契约

- **对象级 program**：每帧每个可见对象产出恰好一个只读 / 冻结的几何程序，
  内含 canonical 来源引用、frameOrigin、安全裁剪后的几何、fill/stroke 计数、偏差预算与
  diagnostics；**随帧重建、不持久化、不进 document / history / `onChange`**。
- **canonical nonzero fill**：`frameClipping.ts` 的 fill region 固定 `fillRule: 'nonzero'`，
  与 Skia / SVG 默认一致；render 与 hit **共用同一 fill 规则**，消除「渲染 nonzero、命中 even-odd」分歧。
- **compound fill 一次 paint**：自交 / 非凸（concave）闭合路径转入 compound program，
  以 nonzero 环绕**一次成面**；`polygonBoolean` 对自交做 canonical 化并返回**复合矩形交集**，
  而不是退化为 empty fallback。
- **stroke 与 clip 边分离**：裁剪产生的边界仅用于 fill/clip 限定，**绝不**进入 stroke 集合，
  不 stroke 人工 clip edge（`frameClipping.test.ts` 显式断言旋转矩形 fill 语义不产生人工描边）。
- **完整 f32 预算（全链路）**：覆盖 local 坐标、matrix（a/b/c/d）、linear product
  （`a*x` / `c*y` / `b*x` / `d*y`）、translation（tx/ty）、screen 坐标，以及
  style / text / image 输入数值；任一环节越界即 unsafe，需裁剪或诊断，**不静默截断**。
  裁剪 / 分段在 translate 前（或等价地）于 global 空间完成，**绝不 clamp 持久顶点、绝不跳过对象**。
- **render / hit 同源**：`SkiaDrawingCanvas` 与 `hitTestDrawingFrame` 只消费同一份
  `frame.renderableEntries`，render/hit **只接受通过最终 local / screen / font / style / resource
  预算的同一份 frame program**；pending / unsafe / unresolved **同时**退出 render 与 hit。

## 4. 文本 shaping 与预算边界（关键回归）

- **超预算 paragraph `4_000_000 -> layoutInput 1_000_000`**：
  `shapedRunProvider.skia.test.ts` 断言 paragraph factory **绝不**以超预算宽度（`paragraphWidth: 4_000_000`）
  被调用；provider 使用安全 `layoutInput`（`paragraphLayoutWidth: 1_000_000`）完成 shaping，
  并在检测到额外 soft wrap（多行 `getLineMetrics`）时返回
  `unsupported('unsafe-layout')`，**不假装成功**。核心语义是**绝不把超预算宽度当作 shaping/渲染输入**。
- **LTR / start no-wrap verification**：
  `canUseParagraphWindow(request, { getLineMetrics ... })` 只有在行度量证明
  **原点宽度下 no soft-wrap 且 start alignment**（`width` 与原始宽度一致、`left === 0`、单行）时才返回 true；
  `left !== 0` 或多行均返回 false。该证明保证从 canonical global 到 frame-local 的重基**只做平移**、
  **不改变 shaping 结果**，且**禁止 substring 重新 layout**。
- **fontReady + nonnull opaque handle gate**：
  `frameBudget.test.ts` 断言 shaped run 进入 render/hit **必须同时**满足
  `fontReady === true` **且** `font` 为非空 opaque handle；`fontReady: false` 的既有拒绝语义不被削弱，
  `fontReady: true` 但 `font: null` / `font: undefined` **同样被预算拒绝**，
  不能仅凭 `fontReady` 放行；`drawingFrame.test.ts` 参数化覆盖 `font: null` 与 `font: undefined`
  均**同时移出 render 与 hit**。
- **pending / empty 同退**：
  - 巨大 partial text 在 shaped program 未就绪时可为 `pending` 且**无可命中 program**，
    绝不暴露 resource-box hit（`frameClipping.test.ts` 「keeps huge partial text pending without a program」）；
  - 空文本 / 纯空白 / 无可见 glyph 产出 `empty-text`，**既无 render 也无 hit**；
  - `pending` **不是永久 fallback**，必须有就绪 / 失败 / 超时路径；`empty` 为终态诊断，不被 `pending` 掩盖；
  - `pending` 与 `empty` 均与 `unsafe` 一样**同时**退出 render 与 hit，避免 render/hit 分歧。

## 5. 验收证据

### 5.1 core / Skia targeted 测试（含 font null/undefined）

- `packages/painting/src/__tests__/core/` 与 `__tests__/skia/` 的针对性套件覆盖：
  partial cubic/ellipse、contour cap、复杂 / 自交 compound nonzero fill、
  huge partial image、huge partial shaped-run text、resource 预算、fontReady + opaque handle gate、
  `font: null` / `font: undefined`、pending/empty 同退。
- 关键文件：`frameClipping.test.ts`、`frameBudget.test.ts`、`drawingFrame.test.ts`、
  `polygonBoolean.test.ts`、`shapedRunProvider.skia.test.ts`、`SkiaDrawingCanvas.test.tsx`、
  `preparedDocument.test.ts`、`spatialIndex.test.ts`。

### 5.2 持久 skia fixture Web E2E（5 条；dSF1 / dSF2）

`tests/ui/skia-drawing-fixture.spec.ts`（`/skia-drawing-fixture`）现有 **5 条**持久 Web E2E：

1. 本地 CanvasKit **同源加载**（`canvaskit.wasm` 200 `application/wasm`）、DOM 结构与图例语义、无产品错误；
2. 缩放至 4 / 右移 / 下移 / 回中的状态文本，跳转远端与 `1e9` 后 frame origin 改变；
3. 几何 program 场景：图例 / 诊断语义、program 汇总随缩放更新、安全裁剪诚实文案、无产品错误；
4. P0-1：**dSF=1/2** 的真实 CanvasKit screenshot **像素簇**与**同 program hit**；
5. P0-2：**dSF=1/2** 的真实 CanvasKit **text-shaping** 状态、**局部像素簇**与**同 program hit**。

覆盖：**dSF1 / dSF2**、同源 `canvaskit.wasm`、真实 CanvasKit **渲染颜色像素**、
**命中探针**（同 program hit）与**预算契约**（安全裁剪 / diagnostics 诚实呈现）。

### 5.3 全量验证（父 orchestrator）

- `pnpm test`：**55 suites / 941 tests passed**；
- `pnpm typecheck`：通过（exit 0）；
- `pnpm lint`：**0 error / 8 known warnings**；
- `pnpm build`：通过；
- `git diff --check`：通过。

## 6. 证据边界（明确有限）

- **CanvasKit / Web 证据有限**：Web CanvasKit 与 Node 测试**只**证明 Web 路径下的可观察行为
  （像素信号、命中探针、diagnostics、dSF1/2 比例稳定），**不能**反推 core 算术的绝对正确性，
  **不构成 GPU / 帧率 / native 性能证据**。
- **非 native 证据**：本报告所有证据均来自 Web 与纯 Node，**不表示** iOS / Android 运行。
- **非逐像素等价**：近似 contour、f32 预算与 cap 均带来**有界非零误差**，本报告**不作**“无视觉误差”声明。
- **非性能门**：`2.3` 的 Node 阈值仅为同机回归预警、非 SLA；正式 Web 性能合同（10.1）尚未执行。

## 7. 开放项与边界保持

- 本报告**不**声称全变更完成；以下 Web-only scope 内任务**保持 OPEN**：
  **7.4**（默认 Skia 切换）、**8.1 / 8.2 / 8.5**（Web 临时编辑、组合/多行/emoji、Web shell importer）、
  **9.2 / 9.4**（legacy DOM/SVG 等价覆盖、正式 Web 编辑面 E2E）、
  **10.1 / 10.2 / 10.3**（Web 性能合同、Web 功能验收、Web 默认切换门）以及 **11 / 12**。
- **`compat-static` 表述保持**：原生只保留根 typecheck、`expo export --platform ios|android`、
  native Jest/RNTL 最小挂载；**1.4 / 4.2** 按已修订 scope 的既有状态保持，
  **不重新解释为 runtime 通过**。
- **旧范围历史不改写**：`verification/task-6-phase-6-geometry-indexing.md` 与
  `verification/task-10-phase-10-no-go.md` 作为历史记录保留，其原生条件由
  `decisions/web-only-acceptance-scope.md` supersede。

## 8. 验证方式

- 复跑 2.2 spike 用例回归 + 本节 core/Skia targeted 套件 + 持久 Web E2E（dSF1/2）；
- 渲染与命中只接受**同一份**通过最终 local / screen / font / style / resource 预算的 frame program；
- 精度与性能满足 `decisions/task-2.3-coordinate-indexing.md` 所设阈值（Web-only 口径）。
