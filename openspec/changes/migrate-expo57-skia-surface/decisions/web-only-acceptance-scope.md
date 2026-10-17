# 范围决定：正式产品验收改为 Web-only（移动端保留 `compat-static` 静态兼容门）

- 变更：`migrate-expo57-skia-surface`
- 决定类型：**范围修订决定（scope decision）**，可审计、可追溯
- 决定时间：2026-09-25
- 验证所有者：父 orchestrator
- 状态：**已记录（recorded）；范围一致性复核进行中；6.3 Web-only 关闭已同步；7.4 Web 默认面已关闭（当前状态 supersession，2026-09-27）；8.1/8.2/8.5 及阶段 8 全部 Web-only 义务已关闭（当前状态 supersession，2026-09-28）；9.4 正式根 Web 编辑面 E2E 已关闭（当前状态 supersession，2026-09-28）；10.x Web 性能合同执行受阻（chromium-launch 环境阻断，NO-GO，当前状态 supersession，2026-09-28）**

> 本决定是当前 change 的**规范性范围来源**，与 `proposal.md`、`design.md`、`tasks.md`、
> `specs/*/spec.md` 及 `.slim/deepwork/migrate-expo57-skia-surface.md` 必须保持一致。
> 本决定 **supersedes（取代）** 旧的「iOS/Android 真实运行 / 真实性能 / 真实 E2E 为验收 MUST」
> 一类规范性要求，但 **不篡改、不重写、不删除任何历史验证报告**。
> 历史报告（含 `verification/task-10-phase-10-no-go.md`）继续作为**旧范围的历史事实**保留，
> 其原生条件的规范性效力由本决定覆盖。
> **当前状态 supersession（2026-09-26）**：Gate 6.3 专项 attempt 3/3 已由父 orchestrator
> APPROVE，任务 6.3 已在**正式 Web-only 范围**内关闭，证据为
> `verification/task-6.3-web-safe-geometry.md`。本注记取代本决定中任何将 6.3 表述为当前
> `OPEN` 的状态结论；那些表述保留为本决定写入时的历史范围事实。此关闭**不外推** native/
> 全平台运行、7.4、8.x、9.4、10.x 或整个 change 完成。
> **当前状态 supersession（2026-09-27）**：Oracle **Gate 7.4 Web-only APPROVE**（父 orchestrator
> 为验证所有者），任务 **7.4 已在正式 Web-only 范围关闭**：根 `/` 已切换为候选 Web Skia 编辑面
> （`/editor-candidate` 兼容别名、`/legacy` 保留旧多 demo），证据为
> `verification/task-7.4-web-default-editor.md`。本注记取代本决定中任何将 7.4 表述为当前
> `OPEN`／「默认切换不实施」的状态结论；那些表述保留为本决定写入时的历史范围事实。
> 此关闭**仅表示 Web 默认面切换**，**不代表 Gate 10**、**不代表 native/全平台运行**，也**不表示
> change 完成**；当前仍开放的是 Web-only **8.1 / 8.2 / 8.5、9.2 / 9.4、10.1 / 10.2 / 10.3
> 以及 11.x、12.1**（legacy 退役、文档与移交）。
> **当前状态 supersession（2026-09-28）**：**Gate 8 Web-only 最终批准**（父 orchestrator 为验证所有者）
> 关闭任务 **8.1、8.2、8.5**；结合此前 Gate 8 attempt 2/3 已关闭的 **8.3、8.4**，**阶段 8 的全部
> Web-only 义务闭合**。证据为 `verification/task-8-web-editor-closeout.md`。本注记取代本决定中任何将
> 8.1/8.2/8.5 表述为当前 `OPEN` 的状态结论；那些表述保留为本决定写入时的历史范围事实。
> 此关闭**仅表示 Web-only 义务完成**（正式 Web Skia 编辑面的临时文本层、组合输入、Web shell 导入），
> **不代表系统 IME/caret、native 运行/Picker、绝对像素字体等价/GPU/性能**，也**不代表 Gate 10 或
> change 完成**；当前仍开放的是 **9.2 / 9.4、10.1 / 10.2 / 10.3 以及 11.x、12.1**。
> **当前状态 supersession（2026-09-28，9.4）**：任务 **9.4 已在正式 Web-only 范围关闭**（父 orchestrator
> 为验证所有者）：根 `/` 的 `tests/ui/editor-candidate.spec.ts --workers=1 --trace=off` **57/57 Chromium
> 通过**，覆盖同源 CanvasKit、10 工具、绘制/selection/ruler/navigation/text/image/font tiers/frame query
> 与正式根/兼容别名/WASM failure canary；证据 `verification/task-9.4-web-e2e-closeout.md`。本注记取代本
> 决定中任何将 9.4 表述为当前 `OPEN` 的状态结论；那些表述保留为本决定写入时的历史范围事实。**该证据为
> Chromium Web**，主要为 DOM/state/diagnostic 与**有限 Canvas 信号**，**不代表** iOS/Android、全浏览器、
> 绝对像素/GPU/性能、**Gate 10 或 change 完成**；**不得**用 `/editor-candidate` 兼容别名替代正式根证据。
> 当前仍开放的是 **9.2、10.1 / 10.2 / 10.3 以及 11.x、12.1**；其中 **9.2** 与 **11.1** 绑定（在同一变更中
> 先替代后退役）。
> **当前状态 supersession（2026-09-28，10.x 合同执行阻断）**：**已批准 Web 性能合同本轮仍未执行成功**——
> 开放环运行器已修正事件时钟（静态核对通过），但 Chromium headless-shell 在本机**启动即 `SIGTRAP`**，
> 生产性能运行器输出 `status.verdict="NO-GO"`、`runnerFailure.stage="chromium-launch"`，两档 dSF
> **各 0 轮**、**无有效新 baseline**；旧**自节流**测量虽超合同（dSF1 p95 ≈ 66.7ms、dSF2 p95 ≈ 130.3ms，
> 均 > 50ms）且不符合开放环前提，已作为 `historicalNoGoArtifact` **保留而非提升为基线**。此为**环境前提
> 阻断、非产品性能结论**；**10.1 / 10.2 / 10.3 保持 `OPEN`**，本注记**不改第 4 节合同**，也**不声称**
> 合同通过、功能通过或阶段 10 完成。本节对应追加记录见
> `verification/task-10-phase-10-no-go.md`。当前仍开放的是 **9.2、10.1 / 10.2 / 10.3 以及 11.x、12.1**。

## 1. 用户最终范围决定（不得误读）

1. **正式产品验收改为 Web-only**：产品功能、性能、E2E 的正式验收面为 **Web**。
2. **原生界面/Adapter/路由/依赖必须保留并继续开发**：现有 Expo/RN 原生界面、InputAdapter、
   路由与依赖 **MUST NOT 删除**；但原生侧 **不再要求、也不再自动验收** 真实启动、触控、手势、
   Skia 渲染、IME/picker/权限、性能与 E2E。
3. **原生只保留静态兼容门（`compat-static`）**：根 `pnpm typecheck`、Expo
   `expo export --platform ios|android` 静态导出成功、native Jest/RNTL 最小挂载成功；
   三者 **MUST 明确标注为 `compat-static`**，**不是运行通过、不是功能通过**。
   **禁止**据此声称安装、启动、RNGH、Skia 渲染、IME、picker 或性能已验证。
4. **Web 最终默认切换不变，且已落地**：根/当前继续 legacy 只是**过渡**；Web MUST 最终默认切换到
   正式 Skia 编辑面。**当前状态（2026-09-27）**：任务 **7.4 已关闭**（根 `/` 现为候选 Web Skia
   编辑面，见本文件开头「当前状态 supersession」）。本条原文「7.4 仍 OPEN」为**历史范围事实**，
   已被 2026-09-27 supersession 取代；此落地**仅限 Web**，不外推 native。
5. **6.3 Web-only 安全几何已关闭**：partial curve/ellipse、复杂或自交闭合路径、contour cap
   与完整预算安全 `FrameGeometryProgram` 已在正式 **Web-only** 验收面完成；Gate 6.3 专项
   attempt 3/3 **APPROVE**，证据为 `verification/task-6.3-web-safe-geometry.md`。原生运行要求
   **CANCELLED**，且该结论**不得外推**为 native/全平台运行通过。
6. **7.4 首发范围约束（已满足）**：首发交付为**完整正式 Web Skia 编辑器**；selection resize
   仅 **move / rotate / uniform scale**，**无 shear**，未扩展 schema 或 affine 模型。该约束现为
   **已满足的实现约束**；其满足**不表示** 8.x、9.4 或 10.x 已实施或关闭。
7. **阶段 10 Web 性能合同已获批准**（见第 4 节），但其是 **Web 验收预算，非对外 SLA、非 native**；
   **未执行**，故 **10.1/10.2/10.3 仍 OPEN**，合同不能让尚未完成的 10.1 直接勾选。

## 2. 状态语义（PASS / CANCELLED / REPLACED / OPEN）

| 状态 | 含义 |
| --- | --- |
| `PASS` | 在**新范围**下（Web 正式验收或 `compat-static` 静态门）已有证据、可复核通过 |
| `CANCELLED` | 旧范围下要求的**原生真实运行/触控/手势/Skia/IME/picker/权限/性能/E2E** 验收被**取消**，不再作为验收 MUST |
| `REPLACED` | 旧原生验收要求被**新的 Web 验收或 `compat-static` 静态门**替代 |
| `OPEN` | 仍待完成，**不得**视为通过 |

**铁律**：被 CANCELLED 的原生运行任务 **绝不能** 显示为「原生 PASS」。
`compat-static` 的 PASS 只能标注为**静态兼容通过**，不得包装为运行时/功能通过。

## 3. 任务处置矩阵（原生取消/替代保留审计语义）

| 任务 | 旧范围 | 新范围处置 | 新状态 |
| --- | --- | --- | --- |
| 1.4 | 原生 iOS/Android 可交互启动（未完成债务） | 原生运行验收 **CANCELLED**；**REPLACED** 为 iOS/Android `compat-static` 手机目标兼容检查（根 typecheck + `expo export --platform ios/android`），已有证据 **PASS（静态，非运行）** | `CANCELLED` + `REPLACED` → 静态 PASS |
| 4.2 | Native Adapter 真机手势运行（未完成债务） | 真手势运行验收 **CANCELLED**；**REPLACED** 为 Native Adapter 保留的静态模块 + 最小 RNTL mount 兼容检查，已有证据 **PASS（非真手势）** | `CANCELLED` + `REPLACED` → 静态 PASS |
| 6.3 | 坐标/裁剪 + 原生运行证据（OPEN） | 原生运行证据要求 **CANCELLED**；安全几何支持已在正式 **Web-only** 范围由 Gate 6.3 专项 attempt 3/3 **APPROVE** 关闭，证据 `verification/task-6.3-web-safe-geometry.md`；**不外推 native/全平台运行** | Web-only 完成；原生运行 `CANCELLED` |
| 7.4 | 所有平台默认 Skia（OPEN） | 保留并改为 **Web 默认正式 Skia 编辑面**；**已在正式 Web-only 范围关闭**（Gate 7.4 Web-only APPROVE，证据 `verification/task-7.4-web-default-editor.md`）；原文 `OPEN` 为历史范围事实，已被 2026-09-27 supersession 取代；**不表示 Gate 10 / native 运行 / change 完成** | Web-only 完成（当前） |
| 8.1 | 文本临时编辑层 + 原生运行（OPEN） | 原生运行验收 **CANCELLED**；**REPLACED** 为 **Web 临时文本编辑层** 验收面；**已在正式 Web-only 范围关闭**（Gate 8 Web-only 最终批准，证据 `verification/task-8-web-editor-closeout.md`）；原文 `OPEN` 为历史范围事实，已被 2026-09-28 supersession 取代 | Web-only 完成（当前） |
| 8.2 | 原生 IME/组合输入（OPEN） | 原生 IME 验收 **CANCELLED**；**REPLACED** 为 **Web 组合/多行/emoji** 验收面；**已在正式 Web-only 范围关闭**（Gate 8 Web-only 最终批准，证据 `verification/task-8-web-editor-closeout.md`）；原文 `OPEN` 为历史范围事实 | Web-only 完成（当前） |
| 8.5 | 原生 picker/权限 + app shell 导入（OPEN） | 原生 picker/权限验收 **CANCELLED**；**REPLACED** 为 **Web shell importer** 验收面；**已在正式 Web-only 范围关闭**（Gate 8 Web-only 最终批准，证据 `verification/task-8-web-editor-closeout.md`）；原文 `OPEN` 为历史范围事实 | Web-only 完成（当前） |
| 9.2 | legacy 测试先替代后退役（OPEN） | 退役 **MUST** 与 **11.1** legacy 实现的稳定期退役在**同一变更**发生；`@system-ui-js/multi-drag` 运行时/测试 mock 已由 **4.4 完成**；9.2 的开放理由是等待 **11.1** 与 legacy-only 测试覆盖映射，**保持 OPEN** | `OPEN` |
| 9.4 | 三端 E2E（OPEN） | 原生三端 E2E 验收 **CANCELLED**；**REPLACED** 为 **Web E2E**；**已在正式 Web-only 范围关闭**（正式根 `/` Chromium E2E **57/57**，证据 `verification/task-9.4-web-e2e-closeout.md`）；原文 `OPEN` 为历史范围事实，已被 2026-09-28 supersession 取代；**仅 Chromium Web**，不代表 native/全浏览器/绝对像素/GPU/性能、Gate 10 或 change 完成 | Web-only 完成（当前） |
| 10.1 | 性能基准 + 原生性能（NO-GO/OPEN） | 原生性能要求 **CANCELLED**；**REPLACED** 为**已批准的 Web 性能合同**（第 4 节），尚未执行，**保持 OPEN** | `OPEN` |
| 10.2 | 三端功能对等（NO-GO/OPEN） | 三端对等验收 **CANCELLED**；**REPLACED** 为 **Web 功能验收**，**保持 OPEN** | `OPEN` |
| 10.3 | 汇总门禁 + 默认切换（NO-GO/OPEN） | native 条件由本决定 **superseded**；**REPLACED** 为 **Web 默认切换门**（依赖 7.4），**保持 OPEN** | `OPEN` |
| 11.1 | 稳定期后删除 legacy（OPEN） | **仅当 7.4 完成（Web 默认 Skia）后**才涉及 legacy 删除；**保持 OPEN** | `OPEN` |
| 11.3 | 三端迁移文档（OPEN） | **REPLACED** 为 **Web 交付 + 移动 `compat-static` 兼容**文档；**保持 OPEN** | `OPEN` |
| 11.4 | 三端 CI（OPEN） | **REPLACED** 为 **Web 交付 + 移动 `compat-static` 兼容** CI；**保持 OPEN** | `OPEN` |
| 12.1 | 三端验收移交（OPEN） | **REPLACED** 为 **Web 正式验收 + 移动 `compat-static`** 移交；**保持 OPEN** | `OPEN` |

> 本矩阵中 **`PASS` 仅适用于 1.4 / 4.2 的 `compat-static` 静态门**；**6.3、7.4、8.1 / 8.2 / 8.5
> （含已关闭的 8.3 / 8.4）与 9.4 为 Web-only 完成**，不等同于 native PASS；**9.1 / 9.3 亦已在
> 正式 Web-only 范围关闭**；其余列为 `OPEN`。
> 1.4 / 4.2 的 `tasks.md` 勾选 **只表示「旧原生运行要求已取消并替换、静态兼容门已有证据」**，
> **不表示**原生运行、真手势、Skia/IME/picker/性能任何运行通过。

## 4. 阶段 10 Web 性能验收合同（用户已批准；仍是 Web 预算）

- **平台/构建**：**production Web export**（非 dev server）；固定视口 **1440×900**；**dSF 1 与 2**。
- **负载**：**100k 对象**；**120 pointer events/s 连续 10 秒**；坐标量级 **`±(1e9 + .125)`**。
- **测量**：**5 次独立测量**；**每次正确性必须通过**。
- **预算**（在以上负载/配置下）：
  - `event → next-frame/commit` **p95 ≤ 50ms**；
  - `rAF interval` **p95 ≤ 33.4ms**；
  - **无 > 100ms 主线程长任务**；
  - 同机**冻结基线退化 ≤ 20%**。
- **记录要求**：每条结果 MUST 记录 **OS / CPU / Chromium 版本 / commit + dirty + source patch hash / 样本**。
- **性质**：这是 **Web 验收预算**，**非对外 SLA**，**不适用于 native**；
  合同冻结**不代表**执行完成，**10.1 仍 OPEN**，不得据此直接勾选。

## 5. 历史报告与 supersede 边界

- 历史验证报告继续有效作为**自身时间点的事实记录**，本决定**不修改**它们。
- `verification/task-10-phase-10-no-go.md` 继续作为**旧范围状态历史**保留；
  其「需要原生设备/性能契约才能解除」的原生条件**已被本决定在原生侧覆盖**
  （原生运行/性能不再是产品验收 MUST）。
- 本决定**不**声称 change 完成，**不**声称任何阶段整体完成。
- 6.3 的 Web-only 关闭**不**声称 native/全平台运行完成，也**不**关闭 7.4、8.x、9.4、10.x 或整个
  change；当前开放 Web 工作仍包括 7.4、8.1、8.2、8.5、9.4、10.1、10.2、10.3。
- **当前状态（2026-09-27）**：上述「仍包括 7.4」为**历史范围事实**；7.4 已于 Oracle Gate 7.4
  Web-only APPROVE 后关闭（证据 `verification/task-7.4-web-default-editor.md`），**不外推**
  native/全平台运行、Gate 10 或整个 change 完成。当前仍开放的 Web 工作为
  **8.1 / 8.2 / 8.5、9.2 / 9.4、10.1 / 10.2 / 10.3 以及 11.x、12.1**。
- **当前状态（2026-09-28）**：上述「仍包括 8.1 / 8.2 / 8.5」为**历史范围事实**；**Gate 8 Web-only
  最终批准**后，8.1 / 8.2 / 8.5（连同已关闭的 8.3 / 8.4）已关闭，证据
  `verification/task-8-web-editor-closeout.md`，**阶段 8 的全部 Web-only 义务闭合**。
  **不外推** native/全平台运行、Gate 10 或整个 change 完成。当前仍开放的 Web 工作为
  **9.2 / 9.4、10.1 / 10.2 / 10.3 以及 11.x、12.1**。
- **当前状态（2026-09-28，9.4）**：上述「仍包括 9.4」为**历史范围事实**；**9.4 已在正式 Web-only
  范围关闭**（正式根 `/` Chromium E2E **57/57**，证据 `verification/task-9.4-web-e2e-closeout.md`），
  **仅 Chromium Web**，**不外推** native/全平台运行、全浏览器、绝对像素/GPU/性能、Gate 10 或整个
  change 完成。当前仍开放的 Web 工作为 **9.2、10.1 / 10.2 / 10.3 以及 11.x、12.1**；其中 **9.2**
  与 **11.1** 绑定（在同一变更中先替代后退役）。
