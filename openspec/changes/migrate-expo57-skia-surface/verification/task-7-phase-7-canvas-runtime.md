# 阶段 7 验证报告（7.1 / 7.2 / 7.3）：Web CanvasKit 加载/回退、单画布与隔离入口

- 变更：`migrate-expo57-skia-surface`
- 任务：**7.1、7.2、7.3**（本报告只覆盖这三项安全子集；**7.4 明确未勾选**，用户已选择延后默认 Skia 切换）
- 验证所有者：父 orchestrator
- 状态：**例外/安全子集 Gate 7 attempt 2、attempt 3 Oracle APPROVE，批准关闭 7.1、7.2、7.3**
- 生成时间：2026-09-24
- 写入范围：仅本报告文件与 `tasks.md` 的 7.1/7.2/7.3 勾选、`.slim/deepwork/migrate-expo57-skia-surface.md` 状态回填。未修改任何产品源码、依赖、lockfile、测试或 CI；未改动任务 1.4、4.2、6.3 的未完成状态，也未改动任何阶段 6 任务状态。

## 结论速览

| 任务 | 结论 | 主要证据 |
| --- | --- | --- |
| 7.1 Web CanvasKit 本地加载、就绪标记、失败可见反馈与用户重试 | ✅ 通过 | 本地 `LoadSkiaWeb({locateFile:file=>`/${file}`})`；error 态可见无自动 fallback；retry = sessionStorage one-shot 标记 + reload |
| 7.2 任一时刻至多一个活跃生产画布，切换先卸载旧画布 | ✅ 通过 | `mode legacy\|loading\|skia\|error` 互斥条件渲染；持久 E2E 断言切换后仅 1 个 `<canvas>`、legacy 卸载 |
| 7.3 提供有限期且可见的 legacy SVG 回退，仅在门禁通过前可用 | ✅ 通过 | `/canvas-runtime` 默认 legacy 且可见；Skia/error 态可手动 back；无自动回退 |

**总体判定：在 Gate 7 attempt 2/3 Oracle APPROVE 下，7.1、7.2、7.3 通过并关闭。7.4（默认切换）及其余阶段 7 能力未关闭。**

## Gate 7 裁定

- Gate 7 **attempt 2** 与 **attempt 3** 均 Oracle **APPROVE**，批准关闭 **7.1、7.2、7.3**。
- 该批准**仅覆盖 7.1 / 7.2 / 7.3 安全子集**，**不表示**阶段 7 整体完成，也**不表示**默认 Skia 切换（7.4）已完成。
- **7.4 保持未勾选**：根 `/` 仍为 legacy 多 demo；`/canvas-runtime` 是**隔离的 Skia smoke 验证入口**，功能/性能门禁未通过，用户明确选择延后默认 Skia 切换。

## 实现范围（隔离入口，非默认路由）

- **薄入口**：`apps/playground/app/canvas-runtime.tsx` 为平台无关薄入口，不含任何顶层平台专用依赖（无 Skia/CanvasKit/DOM/CSS），交由 Metro 按平台选择实现：
  - **web 实现**：`apps/playground/src/canvas-runtime/CanvasRuntimeRoute.web.tsx`
  - **native 基名**：`apps/playground/src/canvas-runtime/CanvasRuntimeRoute.tsx`（静态 Skia smoke，非本报告 7.1/7.2/7.3 的 CanvasKit 加载路径）
- **web 路由模式**：`mode: 'legacy' | 'loading' | 'skia' | 'error'` 四态**互斥**（条件渲染结构保证）。
  - 初始为**单一真实 legacy `DrawingSurface`**（`/canvas-runtime` 默认 legacy）。
  - 用户显式点击「切换到 Skia」→ `mode=loading`，**先卸载 legacy**，再本地 `LoadSkiaWeb({ locateFile: (file) => `/${file}` })`（仅从 `public/canvaskit.wasm` 同源加载，无外部 CDN）；**成功后才动态 `import('../skia/SkiaSmokeSurface')`**。
  - **error 可见、无自动 fallback**：失败进入 `error` 态并显示错误信息；可由用户手动 back 回 legacy；绝不自动回退。
  - **可手动 back**：`返回 legacy 画布` 仅在 `skia`/`error` 态出现，由用户触发。
- **范围限定**：`/canvas-runtime` 为**隔离的 Skia smoke 验证入口**，`SkiaSmokeSurface` 是验证画布而非完整生产编辑画布；根 `/` 默认画布未改变，仍为 legacy 多 demo。

## retry 原 P0 的修复（一次性标记 + reload）

- **问题**：Skia 2.6.2 的 `LoadSkiaWeb` 失败 promise 会被缓存，仅重置 state 重调不会真正重试。
- **修复**：`sessionStorage` 一次性 key **`canvas-runtime:retry-skia`**。
  - retry 先**写入标记**，再 `window.location.reload()` 整页刷新。
  - reload 后 `useState` **惰性初始化**同步 `consumeRetryMarker()`（读取即清除）：存在标记时**初始模式直接为 `loading`**，因此 **legacy 从第一帧起不挂载、不闪现 legacy**，并重新加载 CanvasKit。
  - 失败仍进入 `error`，`retry` / `back` 仍可用。
  - **back 清标记**（`clearRetryMarker`），确保之后不会意外自动加载 Skia。
  - 存储/SSR 异常一律安全回落 legacy，不让路由崩溃。

## 持久 E2E（`tests/ui/canvas-runtime.spec.ts`，4 用例通过）

1. **正常切换 / 返回**：默认 legacy 可见；点击切 Skia 后 legacy 立即卸载、进入 loading 或 skia；Skia smoke 挂载后仅 **1 个 `<canvas>`** 且 legacy 不在 DOM；手动 back 后 Skia 卸载、legacy 恢复；无产品级 console/page error。
2. **WASM 失败回 legacy**：`page.route('**/canvaskit.wasm', abort)` 阻断后切换，进入**可见 error**；retry/back 可见可用；legacy **不自动回来**；移除 Expo dev error overlay 后点 back，error 消失、legacy 恢复。
3. **一次性失败解除后 retry**：解除阻断后 retry 写 sessionStorage 并 reload，初始直接进入 loading/skia，**legacy 不出现**；等待同源 `canvaskit.wasm` 返回 **200 `application/wasm`**；Skia 挂载后仅 **1 个 `<canvas>`**，legacy 计数 0。
4. **持续失败 retry**：保持阻断，retry reload 后仍进入 **error**，retry/back 仍可用，legacy/skia 计数均为 0。

- 用例 3、4 的 `click({ force: true })` **仅穿透 Expo 开发期 `#error-overlay`**（WASM 失败时注入的开发覆盖层），**不改变产品事件路径与产品行为**；正常路径用例不做 force click。

## 全量验证命令与结果

| 命令 | 结果 |
| --- | --- |
| 持久 E2E `tests/ui/canvas-runtime.spec.ts` | **4 tests passed** |
| 全量 `pnpm test` | **47 suites / 871 tests passed** |
| `pnpm typecheck` | **通过（exit 0）** |
| `pnpm lint` | **0 error / 8 known warnings** |
| `pnpm build` | **通过（painting-board Bob exports 既有 warning）** |
| `git diff --check` | **通过（exit 0）** |
| Expo Web export | **1670 modules**（静态导出） |
| Expo Android / iOS export | 仅**静态 bundle**，**不构成运行证据** |

- `pnpm test` 的唯一噪声为 **PaintingBoard mock 的 `<view>` console warning**（既有、非阻断）。
- `pnpm lint` 的 8 个 warning 为既有非阻断项（测试 `jest/expect-expect` 与 `DrawingSurface` ref cleanup `react-hooks/exhaustive-deps`），与本阶段变更无关。

## 准确边界（禁止扩张声明）

- **不表示根 `/` 或默认 Skia**：根 `/` 仍为 legacy 多 demo，默认画布未切换；`/canvas-runtime` 是隔离验证入口。
- **不表示生产编辑器**：`SkiaSmokeSurface` 是 smoke 验证画布，不是完整生产编辑画布。
- **不表示 native 运行**：Android/iOS export 仅为**静态 bundle**，**不构成真实 iOS/Android 运行时证据**；本报告的 CanvasKit 加载路径为 **Web** 证据。
- **不表示功能/性能门禁通过**：7.4 默认切换需等待后续功能/性能门禁（阶段 10），本报告不作声明。
- **不表示 legacy 删除**：legacy SVG 绘制面与回退路径仍在；删除归 11.1。
- **retry 局限**：retry 依赖整页 reload 规避 Skia 2.6.2 的 rejected-promise 缓存，不是同一页面内的热重试。

## 任务状态与开放项（精确）

- **已关闭**：7.1、7.2、7.3（本报告）。
- **7.4 保持未勾选**：默认 Skia 切换延后，功能/性能门禁未通过；根 `/` 仍为 legacy 多 demo。
- **1.4 保持未勾选**：Linux 环境无 iOS/Android 模拟器/真机，缺真实原生交互运行时证据。
- **4.2 保持未勾选**：缺真正「native input → Native Adapter → core GestureSession → 可观察绘制/导航」真实设备证据。
- **6.3 保持未勾选**：部分高级裁剪仍 unresolved（`partial-curve-or-ellipse`、复杂自交/非凸 closed path、`contour-deviation-not-met`、`partial-resource-box` 等），且缺 iOS/Android 真实运行证据。
- **阶段 6 各任务状态不变**，本报告与本次回填不修改阶段 6 任何勾选，也不宣称阶段 6 关闭。

## 后续边界

- 阶段 7 **整体不闭合**：仅 **7.1 / 7.2 / 7.3 在 Gate 7 attempt 2/3 Oracle APPROVE 下关闭**；**7.4 仍开放**。
- 后续只可处理 **7.4 默认切换（待功能/性能门禁）** 或记录真实 native 运行债务/阻塞；不得据此宣称阶段 7 完成，也不得扩张到生产编辑器、legacy 删除等其他阶段范围。
