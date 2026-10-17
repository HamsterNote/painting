# 阶段 2 验证报告：CanvasKit 本地加载与超大坐标/性能 spike

- 变更：`migrate-expo57-skia-surface`
- 任务：2.1、2.2、2.3、2.4（阶段 2 整体）
- 验证所有者：父 orchestrator
- 状态：**阶段 2 已通过，Oracle Gate 2 APPROVE**
- 生成时间：2026-09-23
- 写入范围：仅本报告文件（`verification/`）。未修改产品源码、依赖、lockfile、CI 或其它工件。

## 结论速览

| 任务 | 结论 | 证据 |
| --- | --- | --- |
| 2.1 CanvasKit 本地资源方案 | ✅ 通过 | `verification/task-2.1-canvaskit-local.md` |
| 2.2 大坐标 + 性能 spike | ✅ 通过 | `spikes/coordinate-performance/README.md` + `spikes/phase-2/coordinate-performance-measurements.json` |
| 2.3 坐标 / 索引 / 阈值决策 | ✅ 通过 | `decisions/task-2.3-coordinate-indexing.md` |
| 2.4 设计回填 | ✅ 通过 | `design.md` 第 10 节与风险表已回填 |

**总体判定：阶段 2 通过。Oracle Gate 2 APPROVE。**

## 2.1 既有证据（本地 CanvasKit 加载）

- 事实来源：`openspec/changes/migrate-expo57-skia-surface/verification/task-2.1-canvaskit-local.md`。
- 结论：现有实现 `public/canvaskit.wasm` + `SkiaSmokeRoute.web.tsx` 的 `locateFile: file => `/${file}`` 已构成满足 2.1 的**最小可加载工件**。
- 关键事实：`expo export --platform web` 会把本地 `canvaskit.wasm`（8,076,553 字节，sha256 `eb68c7a7…f9dc4`）原样复制到 `dist/`，浏览器从同源 `/canvaskit.wasm` 以 200、`application/wasm` 加载成功；在阻断所有非本机 5266 的 http(s) 请求的强约束下 smoke surface 仍出现，产品 0 console error；dist 中无 `cdn.jsdelivr` / `unpkg.com` / `skia.org` 文本引用，无运行时 CanvasKit CDN 地址。
- 2.1 已明确的边界（沿用，不得被本报告抹去）：非真实断网、非生产 CDN/MIME、native 不可由 Web 推断、grep 检索的天然局限。

## 2.2 spike 验证

### 复跑命令

```bash
node spikes/coordinate-performance/run.mjs
```

- 稳定覆盖输出：`openspec/changes/migrate-expo57-skia-surface/spikes/phase-2/coordinate-performance-measurements.json`。
- 纯 Node、零新增依赖，不导入 `packages/painting` / React / DOM / Skia / DrawingSurface 或任何产品依赖。

### 覆盖项

1. **f64 ULP**（`precision.float64MinStep`）：量级 `1e9` 的 double ULP = `1.1920928955078125e-7` = `2^-23`；`2^53` 的 double ULP = `2`。每项均 `finite: true`。
2. **camera-origin rebase**（`precision.cameraOriginRebase`）：固定 `global=(1000000000.125, -1000000000.125)`、`origin=(1000000000, -1000000000)`、`scale=1`，先做 JS number（f64）减法得 `local=(0.125, -0.125)`，再以 `Math.fround` 模拟 f32 local affine 得 `screen`，逐轴误差为 `0`、`allFinite: true`。
   - 边界：这是 f64-to-f32 输入预算示例，非 CanvasKit / native / 视觉结论；**重基不能恢复在接近 2^53 已丢失的 JS number 精度**。
3. **affine 精度**（`precision.affine`）：产品 scale `0.25 / 1 / 8`（越界 `1e-6 / 1e6` 仅考察数学）与平移 `0 / 1e3 / 1e6 / 1e9` 下，double 参考与全链路 f32 的正 / 逆 / round-trip 误差与有限性；所有组合 `anyNonFinite: false`。f32 精度是保守模拟，真实实现可能使用 double 或不同中间精度。
4. **dense 对照 ID 相等**（`performance[*].correctness`）：对固定生成文档与 4x4=16 query bank，linear 与 dense uniform grid（候选去重后精确相交）的 `idSetMatch` / `documentOrderMatch` / `checksumMatch` 均为 true，`hitsMatchBetweenQueries: true`。
5. **sparse hash-grid 边例**（`hashGridEdgeCases`，来自 `hash-grid-edge-cases.mjs`）：稀疏 Map 网格、跨 cell、候选去重 + 精确相交 + `order` 排序、`MAX_CELLS_PER_OBJECT=64` 超限 huge bbox 进入 `overflow`、负坐标 / 远正 / 远负、update（先注销旧 cell/overflow 再注册）、remove 后重新校验；`initial` / `afterUpdate` / `afterRemove` 的 `idSetMatch` / `documentOrderMatch` / `checksumMatch` 全 true，`overflow.used: true` 且 `objectIds: [4]`。
   - 边界：这是**非计时、合成**的逻辑等价样例，只覆盖内置固定小型文档与固定 9-query bank，**不是产品实现、性能 benchmark**，也不构成 CanvasKit / Web GPU / native 证据。

### 生成时快照数据（同机，来自 JSON；非 latest，权威数据见 measurements.json，每次运行会浮动）

| 对象数 | linear p95 | candidateGrid p95 | hits/round | correctness |
| --- | --- | --- | --- | --- |
| 1000 | 0.120101ms | 0.0253ms | 506 | 全部 true |
| 10000 | 2.197606ms | 0.1505ms | 5107 | 全部 true |
| 100000 | 21.837766ms | 1.636005ms | 50930 | 全部 true |

- 100k 档 ratio ≈ `1.636005 / 21.837766` ≈ `0.0749`。
- 以上为某次 `node spikes/coordinate-performance/run.mjs` 生成时的快照，**不是 latest**；每次运行会浮动，复现以重新运行该命令为准。
- 环境：Node `v24.15.0`、linux x64、Intel i7-8700、`process.hrtime.bigint()`。
- **这些数值不是 SLA**；对运行环境敏感，凡引用必须以 JSON 源文件 `spikes/phase-2/coordinate-performance-measurements.json` 为权威。

### 限制（随证据一并理解）

- Node 端纯 JS 数学与计时不是 CanvasKit / Skia GPU 渲染路径，性能数值不能外推为端上渲染性能。
- 理论 float32 精度只描述可分辨性，不能据此断言渲染失效。
- affine 为全链路 f32 保守模拟，真实实现可能用 double 或不同中间精度。
- dense uniform grid 是候选决策对照；sparse 只测逻辑边例，**尚未性能基准**。
- 单机单次运行，未做多机 / 多进程 / GC 隔离 / 多版本 Node 对照。
- **本 spike 不设定最终性能阈值，也不作 CanvasKit / native / 默认渲染器结论。**

## 2.3 决策验证

- 决策工件：`decisions/task-2.3-coordinate-indexing.md`。
- 已记录：absolute global f64 持久点（不引 origin/chunk、不 clamp/重写/持久化 rebase；V1→V2 语义保留；将来分块需新 `schemaVersion` + 显式 migration）；f64 ULP 证据（`1e9=2^-23`、`2^53=2`）；6.3 每帧瞬态单一 camera-origin rebasing 公式与语义；`1e6 / 0.0625 DIP` 为 f32 输入预算；sparse spatial hash（256 DIP 可配置初值）及 dense 对照 / sparse 仅逻辑边例的边界；local Node 回归预警（100k/16 queries/同机：indexed p95<=8ms、max<=16ms）与 10.1 后置清单；CanvasKit 流水线与 root deployment 假设、7.1 可见失败/重试。
- 被 6.3、10.1 直接引用。

## 2.4 设计回填验证

- `design.md` 第 10 节已替换为当前策略：absolute global f64 持久点 + 每帧瞬态 camera-origin rebase + 单一最终 affine，并链接新 decision 与阶段 2 spike。
- `design.md` 风险表“精度问题”一行已改为当前策略、f64/f32 各自边界、real verification 后置。
- `tasks.md` 6.3 示例已消除“相对局部原点存储”表述，替换为 absolute f64 + transient rebase + single final affine。

## 门禁结论与不在本阶段范围内的项

- **Oracle Gate 2 APPROVE：阶段 2 批准通过。**
- 明确**不在本阶段结论内**：
  - 真实 **CanvasKit / Web Skia frames** 与 **native devices** 的行为与性能。
  - **任务 10**（性能与三端验收门）的阈值判定与默认渲染器结论。
  - sparse spatial hash 的性能基准、build / update / remove / memory / skew / dense / huge / cell size 调参。
- 这些项由 6.3、7.1、10.1 承接，需要真实运行环境证据。
- 本阶段不改变任务 **1.4** 的外部证据债务状态（Linux 无 iOS/Android 模拟器/真机）。
