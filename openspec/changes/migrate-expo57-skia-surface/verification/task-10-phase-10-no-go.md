# 阶段 10 验证报告（10.1 / 10.2 / 10.3）：性能与三端验收门 — **NO-GO 记录**

- 变更：`migrate-expo57-skia-surface`
- 任务：**10.1、10.2、10.3（全部保持未完成）**
- 门禁性质：**Oracle Gate 10 attempt 1/3 BLOCK**；用户在受阻后**明确选择「记录 NO-GO」**
- 验证所有者：父 orchestrator
- 生成时间：2026-09-24
- 写入范围：仅本报告文件、`.slim/deepwork/migrate-expo57-skia-surface.md` 的阶段 10 状态回填。**未修改 `tasks.md`（未勾选 10.1/10.2/10.3 或任何任务）**，**未修改任何产品源码、测试、配置、`package.json`、lockfile**，**未修改 design.md**（既有 10.5 边界已覆盖，无需改动）。

## 结论速览

| 任务 | 结论 | 说明 |
| --- | --- | --- |
| 10.1 建立性能基准与阈值 | **保持未完成（NO-GO）** | 已有真实产品 Sparse Node baseline 与正确性、以及 Web CanvasKit 局部信号，但**没有预先批准的最终性能契约**；2.3 的 `p95≤8ms/max≤16ms` 仅为同机 dense-grid 趋势预警、非 SLA，不能套用到 Sparse 或 Web/native；缺高频输入链路计时、超大坐标持续 pan/zoom/hit/clipping 计时、保存的 Web p50/p95/max 工件与 native 性能证据 |
| 10.2 三端功能对等验收 | **保持未完成（NO-GO）** | 仅有真实 Web 证据；被 1.4 / 4.2 / 6.3 / 8.1 / 8.2 / 8.5 / 9.4 阻塞；Jest / RNTL / `expo export` / Chromium **不替代原生运行时** |
| 10.3 汇总门禁并记录默认切换决策 | **保持未完成（NO-GO）** | 有效结论就是 **NO-GO**：**不默认切 Skia**，保留 legacy 可见回退；根 `/` 仍为 legacy，`/canvas-runtime` 仅隔离 smoke；**7.4 未完成** |

**总体判定：Gate 10 attempt 1/3 BLOCK，用户选择记录 NO-GO。NO-GO 不等于任务完成——10.1、10.2、10.3 全部保持未完成，不得进入任务关闭，也不得进入后续默认 Skia 切换。**

## Gate 10 裁定与阻断原因

- **Gate 10 attempt 1/3 结果：BLOCK**。阻断不是因为没有局部证据，而是因为**缺少预先批准的最终验收契约**与**真实原生/高频负载证据**。
- **10.1 阻断**：虽然已有真实产品 `SparseSpatialIndex` baseline、确定性正确性 oracle 与 Web CanvasKit 局部信号，但：
  - **没有预先批准的最终性能契约**（工作负载、阈值、复跑规则未冻结）；
  - **阶段 2 的 dense `100k / 16 query p95≤8ms / max≤16ms` 仅是同机趋势预警、不是 SLA**，**不能**套用到 **Sparse**（最新 Sparse B1 `p95≈48.956ms`）、也不能套用到 **Web / native**；
  - 缺少 **高频 pointer/touch → GestureSession → transient/frame → Skia 负载** 的端到端计时；
  - 缺少 **超大坐标持续 pan / zoom / hit / clipping** 的计时；
  - 缺少**保存的 Web `p50/p95/max` 工件**；
  - 缺少 **native 性能**证据（B8/B9 缺失）；
  - 现有 baseline JSON 只记录 `commit`（HEAD），**未来复跑必须补充记录 dirty / source patch hash**，否则无法对应实际被测源码。
- **10.2 阻断**：仅有**真实 Web**证据（B5–B7），仍被 **1.4 / 4.2 / 6.3 / 8.1 / 8.2 / 8.5 / 9.4** 阻塞；**Jest / RNTL / `expo export` / Chromium 不替代原生运行时**。B8/B9 不可获取。
- **10.3 阻断**：可记录的有效结论即为 **NO-GO**——**不默认切 Skia**、保留 legacy 可见回退；根 `/` 仍为 legacy，**7.4 未完成**；功能/性能门禁未通过，**无默认切换依据**。

## 已完成局部证据（严格按标签，不得跨层推断）

> 每条证据 MUST 携带 `[platform] [machine] [build]`。以下证据仅证明其所属平台/层，**不得**外推为其它平台、GPU、帧率、SLA 或 native 证据。

- **Node 产品 Sparse baseline**：`[platform:node][machine:Linux x64 / Intel i7-8700 @3.20GHz / 6 vCPU][build:Node v24.15]`
  - 脚本：`spikes/product-performance/run.mjs`（直接编译并加载当前产品 `packages/painting/src/core/spatialIndex.ts`，非 2.3 dense 对照）。
  - 方法：确定性 `mulberry32` 输入 + 独立 `LinearOracle` 半开 AABB 全扫描校验（key/order 逐项比对）；每操作 **5 warmup / 25 measured**；计时源 `process.hrtime.bigint()`。
  - B1（100k / 16 queries / 4096 世界 / 800×600 查询）：产品 Sparse **p50≈44.614ms、p95≈48.956ms、max≈56.495ms**；正确性 `exactOrderAndKeys: true`、`matchedRecordsAcrossQueries: 50576`。
  - **边界**：这是**纯 Node CPU 产品逻辑微基准**，**不是** Web / CanvasKit / Skia / native / GPU 帧时间，**不是任何 SLA**；数字为生成时快照、随同机负载浮动。
- **Web CanvasKit 性能信号（有界采集）**：`[platform:web-canvaskit][machine:本机 headless Chromium + Expo dev server][build:dev]`
  - 脚本：`tests/ui/skia-performance.spec.ts`。
  - 覆盖：**同源 `canvaskit.wasm` 200 `application/wasm`**、真实 scale/pan 控件有限交互、`requestAnimationFrame` 间隔采样（≥30 样本、仅断言有限且为正）、`Resource Timing` 字段存在性。
  - **边界**：rAF 间隔只是**同环境 Web 调度信号**，**不是 GPU 帧时间、不是帧率、不是绘制/合成耗时**，**不设任何性能阈值**；**不构成 native 性能**；DOM/`<canvas>` 存在不等同像素或 GPU 证据。
- **未采集（缺失）**：高频 pointer/touch → GestureSession → transient/frame → Skia 负载计时、超大坐标持续 pan/zoom/hit/clipping 计时、保存的 Web p50/p95/max 工件、native（iOS/Android）性能。

## 恢复条件（解除 NO-GO / 恢复阶段 10 的唯一路径）

只有在**同时满足**以下条件后，阶段 10 才可恢复推进（否则保持 blocked）：

1. **用户提供原生设备 / 模拟器或 EAS 流程**（用于获取 B8 iOS、B9 Android 的真实运行与性能证据；Linux 无模拟器/真机，此门不可由 export/Jest/Web 替代）。
2. **用户批准最终性能工作负载 / 阈值 / 复跑规则**（冻结 10.1 的性能契约：负载定义、目标平台、阈值、复跑与标签规则；不得套用 2.3 的 dense 同机预警值）。
3. 复跑 baseline 时**补充记录 dirty / source patch hash**（现有 JSON 仅有 HEAD commit，无法对应 dirty 工作树实际源码）。

## 开放任务重申（不因 NO-GO 而改变）

- **持续未完成**：**1.4、4.2、6.3、7.4、8.1、8.2、8.5、9.2、9.4**（真实设备 / 高级裁剪 / 默认切换 / 文本与资源 / 测试退役等债务不变）。
- **本报告不勾选**：**10.1 / 10.2 / 10.3 均保持未完成**；**不勾选任何其它任务**。

## 用户决定重申

- 用户已明确选择**延后默认 Skia 切换**：**根 `/` 保持 legacy 多 demo**；**`/canvas-runtime` 仅作隔离 smoke 验证入口**。
- **不默认切 Skia**，保留 legacy 可见回退；**7.4 未完成**。
- 本记录**不进入任务关闭**，也**不进入后续默认切换**。

## 全量验证命令与结果（父 orchestrator 已执行）

| 命令 / 范围 | 结果 |
| --- | --- |
| `pnpm test` | **52 suites / 891 tests passed** |
| `pnpm typecheck` | **通过（exit 0）** |
| `pnpm lint` | **0 errors / 8 known warnings** |
| `pnpm build` | **通过** |
| `git diff --check` | **通过（exit 0；本报告写入后复核）** |

- 已知非阻断 warning：**`painting-board` Bob exports** warning 与 **`PaintingBoard` mock `<view>`** console warning，**均为既有、非本次引入、非阻断**。
- 上述全量结果由**父 orchestrator**拥有与复核；本报告只如实转录，不新增未执行命令。

## 范围约束与禁止声明

- **不得**将 Node / Web 证据包装为平台 SLA、GPU 帧率或 native 运行时证据。
- **不得**宣称阶段 10 完成、任务关闭或默认 Skia 已切换。
- 本报告不改 `tasks.md`、产品代码、测试、配置、`package.json` 或 lockfile；仅新增本报告与 deepwork 阶段 10 状态回填。
- 验证所有者：父 orchestrator。

---

## 追加记录：当前生产性能合同执行阻断（2026-09-28，NO-GO）

> 本节为**追加的当前状态记录**，不修改上方 2026-09-24 的旧范围历史内容。
> 旧范围 NO-GO 的「原生运行/性能」条件已被 `decisions/web-only-acceptance-scope.md` supersede；
> 本节记录的是**用户已批准的 Web 性能合同**（`decisions/web-only-acceptance-scope.md` 第 4 节）
> 在**当前生产环境**下的执行阻断。**合同本轮不改动**；**10.1 / 10.2 / 10.3 保持未完成（OPEN）**。

### 合同与运行器前提

- **合同不变**：production Web export；固定视口 `1440×900`；dSF `1` 与 `2`；100k 对象；
  `120 pointer events/s × 10s`；`±(1e9 + .125)`；每 scale **5 个独立 context**；合同阈值
  `event→next-frame/commit p95 ≤ 50ms`、`rAF interval p95 ≤ 33.4ms`、无 `>100ms` 主线程长任务、
  同机冻结基线退化 `≤20%`。这是 **Web 验收预算，非 SLA、非 native**。
- **运行器**：`scripts/perf/editor-production-performance.mjs`。
- **开放环（open-loop）事件时钟修正已落地**：页面在正式派发前**一次性登记全部 1200 个绝对 120 Hz
  deadline**，回调即使迟到也照常派发，并记录 `scheduledAt / callbackAt / backlogAtCallback /
  eventId / sequence / emittedAt / pointer / phase`；adapter receipt 必须与 pending identity 匹配，
  且 `nextFrameAt >= receivedAt >= emittedAt`，禁止用同一 rAF 帧较早时间戳制造假负延迟。
  该修正**已静态核对**（运行器结构与 `spikes/phase-10/README-editor-production-performance.md`
  的开放环描述一致），但**未获得任何运行时通过证据**。

### 本轮执行结果：环境前提阻断（NO-GO）

- **产物**：`spikes/phase-10/editor-production-performance.json`
  （`generatedAt = 2026-09-28T03:45:21.262Z`）。
- **顶层判定**：`status.passed = false`、`status.verdict = "NO-GO"`、
  `status.baseline.established = false`。
- **失败阶段**：`runnerFailure.stage = "chromium-launch"`。Chromium headless-shell
  （`chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell`）
  **启动即 `SIGTRAP`**（`process did exit: exitCode=null, signal=SIGTRAP`），Playwright
  `chromium.launch` 抛错，浏览器从未成功建立。
- **两 dSF 轮次为空**：因浏览器未启动，`results['1'].rounds = []`、`results['2'].rounds = []`，
  即两档 dSF **各 0 轮、0 context、0 pointer sample**，`p50/p95/max` 全为 `null`。
- **无有效新 baseline**：`baseline.established = false`；本轮**未建立、也未替换**同机冻结基线。

### historicalNoGoArtifact：保留而非判定（不得提升为基线）

- 产物保留字段 `historicalNoGoArtifact`，为**旧的自节流（self-paced）测量**
  （其自身 `generatedAt = 2026-09-28T02:55:51.001Z`）。
- **它不符合开放环前提**：事件由上一回调返回后注册，而非预先登记的绝对 deadline。
- **它也超合同**：其 dSF1 `event→next-frame p95 ≈ 66.7ms`、dSF2 `p95 ≈ 130.3ms`，**均 > 50ms 阈值**
  （各 5 轮 / 各 5 context）。
- **它曾错误记录 `baseline.established = true`**：正因如此，必须作为
  `historicalNoGoArtifact` **保留而非判定**，**不得提升为同机冻结基线**。
- 其 `runLineage` 指向更早一次自节流运行（`generatedAt = 2026-09-28T01:50:45.680Z`），
  该次 `status = "FAIL"`、`classification = "prior invalid measurement / clock association failure"`，
  每个 dSF 有 **5,988 个负 event→next-frame 样本**（采样把较晚的 pointer receipt 与同一 rAF 帧
  较早的时间戳配对），同样**只能作为历史工件保留**。

### 阻断结论与禁令

- 当前**生产性能在环境前提上不可测**：Chrome headless-shell 在本机启动即崩溃，这属**运行环境阻断**，
  **不是产品性能结论**，也不能据此推断产品快慢。
- **10.1 / 10.2 / 10.3 全部保持未完成（OPEN）**，**不得关闭**，**不得进入后续默认 Skia 切换**。
- **不得**修改或放宽性能合同；**不得**伪造通过；**不得**用 **0 轮 / 空数据**宣称性能通过；
  **不得**把**静态代码核对**包装为**功能通过**。
- 已静态核对的只是**开放环实现代码**；**不声称**功能通过、基线通过或合同达标。

### 恢复条件（解除本轮阻断的唯一路径）

1. **修复/更换可启动的 Chromium（headless-shell）运行环境**，使 Playwright 能成功 `launch`；
2. 在该环境下用**开放环运行器**按合同重跑（每 dSF 5 个独立 context，保留原始工件）；
3. 仅当**全部轮次与前提均通过**时，才可建立初始同机冻结基线并评估退化 `≤20%`。

在此之前，阶段 10 保持 **NO-GO / blocked**；本追加记录**不勾选任何任务**，
**不改 `tasks.md`、产品代码、性能脚本、配置、`package.json` 或 lockfile**。
