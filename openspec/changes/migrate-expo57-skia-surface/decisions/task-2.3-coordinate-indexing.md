# 任务 2.3 决策：坐标策略、空间索引与性能阈值

- 变更：`migrate-expo57-skia-surface`
- 任务：2.3「依据 spike 决定坐标策略、空间索引结构与性能阈值并记录决策」
- 验证所有者：父 orchestrator
- 状态：**已批准（Oracle Gate 2 APPROVE）**
- 生成时间：2026-09-23
- 写入范围：仅本决策文件。未修改产品源码、依赖、lockfile、CI 或其它工件。

## 依据（本决策引用并依赖的既有工件）

| 依据 | 路径 | 作用 |
| --- | --- | --- |
| 任务 2.1 CanvasKit 本地加载证据报告 | `openspec/changes/migrate-expo57-skia-surface/verification/task-2.1-canvaskit-local.md` | CanvasKit 本地静态资源发布与加载方案的事实依据（本地加载、无外部 CDN 运行时依赖） |
| 阶段 2.2 Node spike README | `spikes/coordinate-performance/README.md` | spike 目的、复跑命令、方法边界与“明确不做的结论” |
| 阶段 2.2 数据 JSON | `openspec/changes/migrate-expo57-skia-surface/spikes/phase-2/coordinate-performance-measurements.json` | 精度与性能**权威数据源**（数值以该 JSON 为准，本文引用可能随运行漂移） |
| 阶段 2.2 稀疏 hash-grid 边界样例 | `spikes/coordinate-performance/hash-grid-edge-cases.mjs` | 未来 core 候选索引需支持的逻辑等价（跨 cell / 去重 / 负 key / overflow / update / remove） |

> 说明：本决策不导入、不修改上述 spike 代码；引用仅作事实来源。spike 本身已明确声明其不是产品运行时，也不构成 CanvasKit / native / 视觉结论。

## 决策一：V1/V2 document 持久点保持绝对 global DIP f64

- V1/V2 document 的持久化坐标**继续为**有限 JS f64 `number` **absolute global DIP x/y**。
  - 不引入 origin（相对原点）。
  - 不引入 chunk（分块）。
  - 不 clamp、不重写、不持久化任何局部重基点（rebase）后的坐标。
  - V1→V2 的语义保留：读时仍按既有 `migrateStroke` 语义升级，绝不因坐标策略改变而误解或改写历史数据。
- **将来若需要分块**：必须引入新的 `schemaVersion` 并配套**显式 migration**；不得把重基/分块偷偷塞进既有 V1/V2 语义。换言之，重基是实现期瞬态手段，不是持久化格式的一部分。

## 决策二：f64 ULP 证据（为何持久层必须是 f64、重基不能“找回”信息）

来自权威 JSON 的 `precision.float64MinStep`：

| 世界坐标量级 | float64 ULP（最小可分辨步长） | 等价表示 |
| --- | --- | --- |
| `1e9` | `1.1920928955078125e-7` | `2^-23` |
| `2^53` = `9007199254740992` | `2` | `2` |

结论（硬约束）：

- 在 `1e9` 量级，f64 仍能分辨约 `2^-23` DIP 的差异；而在 `2^53` 量级，f64 步长已退化到 `2` DIP。
- **重基不能恢复已经丢失的信息**：若某偏移在 f64 层面（global 自身）已无法分辨，那么先做 `global - frameOrigin` 也无法把它找回来。这正是必须把持久值保持在 f64 absolute global 的原因——重基只是把“仍可分辨”的信息搬到更小的数量级上交给 f32 输入，而不是提升精度。
- 该 ULP 表是**坐标可分辨性**证据，不是渲染失效断言；真实失效还取决于渲染管线、变换层级与绘制实现（见 JSON `limitations`）。

## 决策三：6.3 实施——每帧瞬态单一 camera-origin rebasing

后续任务 **6.3** 的实施策略为**每帧瞬态（transient）、单一 camera-origin rebasing**，把 absolute global 几何在交给 Skia 前搬到相机原点附近的局部坐标：

```
local            = global - frameOrigin
localTranslation = globalTranslation + frameOrigin * scale
screen           = local * scale + localTranslation
```

准确语义（不得弱化）：

- `global → local` 的减法与 `localTranslation` 的合成都在 **f64** 中完成；只有 `local * scale + localTranslation` 这一步进入 f32 输入预算域。
- `frameOrigin` 是**每帧瞬态**：MUST NOT 进入持久 document、MUST NOT 进入 history、MUST NOT 触发 `onChange`；它**不是第二 viewport**。
- **render 与 hit 同帧同 origin**：同一帧内渲染与命中测试使用同一个 `frameOrigin`，保证几何一致。
- 最终只保留**单一最终 viewport affine**（即上文 `screen` 合成结果），不叠加第二套换算。

## 决策四：1e6 / 0.0625 DIP 是 f32 输入预算，不是视觉误差

- JSON 中“量级 `1e6`、float32 最小步长 `0.0625` DIP”是 **f32 输入预算**（输入坐标作为 f32 时的可分辨粒度），**不是**视觉误差、**不是** CanvasKit 真实误差、**也不是**完整 affine 误差（完整 affine 误差见 JSON `precision.affine`）。
- 实施契约：交给 Skia 的 local geometry、乘积（`local * scale`）、矩阵平移（`localTranslation = globalTranslation + frameOrigin * scale`，在 `screen = local * scale + localTranslation` 中作为平移项，与 `local = global - frameOrigin` 配套）、以及最终结果均必须 **finite** 且满足上述输入预算。
- **超大几何**：采用**裁剪 / 分段**处理，**绝不 clamp 持久顶点**。持久顶点保持 f64 absolute global 原值不变。

## 决策五：future core 采用 sparse spatial hash（256 DIP 为可配置初值）

- 未来 core 的候选空间索引选用 **sparse spatial hash**，`cellSize = 256 DIP` 作为**可配置初值**（非硬编码常量）。
- 必须支持的行为（来自 `hash-grid-edge-cases.mjs` 的逻辑等价样例）：
  1. **跨 cell**：bbox 覆盖的多个 cell 都注册为候选。
  2. **dedup + 精确 predicate**：候选先去重，再做精确 AABB 相交判定。
  3. **负 keys**：`Math.floor` 正确处理负坐标的 cell key（形如 `x,y`）。
  4. **update / remove**：update 先注销旧 cell / overflow 再注册新 bbox；remove 后不残留可命中的候选。
  5. **huge overflow bucket**：覆盖 cell 数超过上限（样例 `MAX_CELLS_PER_OBJECT = 64`）的 huge bbox 只进入 `overflow` bucket，查询同时检查相关 Map bucket 与 overflow，避免无界复制。
  6. **document / z-order**：同一查询结果按文档 `order` 稳定排序。
  7. **render / hit 共用 bbox**：渲染与命中测试共用同一 bbox 与几何来源。
- **性能证据的边界（必须随决策理解）**：JSON 中的性能数据来自 **dense fixed 16x16 uniform grid**，仅作**对照（control）**；sparse spatial hash 在阶段 2 **只测了逻辑边例（非计时、合成样例）**，**尚未做性能基准**。因此本决策不把 dense grid 的耗时数字外推为 sparse 索引的性能承诺。

## 决策六：local Node 回归预警阈值与后置验证

- **local Node regression alert**（本地 Node 回归预警，同机可比口径）：
  - 场景：`100k` 对象、`16` 个查询、确定性生成器、同一台机器。
  - 预警线：indexed `p95 <= 8ms`，`max <= 16ms`。
- **生成时快照（非 latest；权威数据见 measurements.json，每次运行会浮动）**：
  - baseline（linear）`p95 = 21.837766ms`
  - indexed（candidate grid）`p95 = 1.636005ms`
  - ratio ≈ `0.0749`
  - 以上为某次 `node spikes/coordinate-performance/run.mjs` 生成时的快照，重跑会浮动；这**不是 SLA**，也**不是 latest**。凡引用数值必须以 JSON 源文件 `spikes/phase-2/coordinate-performance-measurements.json` 为权威。
- **后置到任务 10.1** 才补齐的验证项（本阶段不做结论）：
  - 索引的 build / update / remove / memory
  - skew（偏斜分布）、dense、huge bbox、cell size 调参
  - Web Skia frames（真实帧耗时）
  - native devices（真机）
  - 真实 CanvasKit 路径
- 阈值只作为**本地回归预警**，真正的性能门禁数值在 10.1 依据真实路径重测后确定。

## 决策七：CanvasKit 本地加载策略（承接 2.1，引用 2.1 报告）

现有已事实成立的流水线（**2.1 报告已证**）：

```
setup-skia-web → public/canvaskit.wasm
              → Expo export dist/canvaskit.wasm
              → LoadSkiaWeb({ locateFile: file => `/${file}` })
```

- **升级时必须重跑**：`setup-skia-web`、资源 hash 核验、`expo export`、以及浏览器证据，确认流水线仍成立。
- **部署假设**：当前按 **root deployment**（站点根 `/canvaskit.wasm`）成立；**child path（子路径部署）的 base-aware 解析留待后续**，本阶段不实现。
- **可见失败 / 重试**归任务 **7.1**（门禁通过前不得宣称默认就绪；失败必须可见且可重试）。
- 事实依据见 `openspec/changes/migrate-expo57-skia-surface/verification/task-2.1-canvaskit-local.md`。

## 决策对下游任务的直接引用关系

- **6.3** 直接落地“absolute f64 + 每帧瞬态 rebase + 单一最终 affine”；其验证需**复用 2.2 的 spike 用例**，并补**真实 Web / native** 证据。
- **10.1** 承接本决策六的后置验证清单，建立真实性能门禁。
- **7.1** 承接本决策七的可见失败 / 重试。

## 边界与不做的结论（与 spike 一致）

- 本决策的精度数值是 Node 端纯 JS 数学与 ULP 证据，**不是** CanvasKit / Skia GPU 真实渲染结论；真实失效与误差以实际实现为准。
- sparse spatial hash 在阶段 2 只有**逻辑等价样例**（非计时、合成），**没有性能基准**。
- 本决策**不**作 CanvasKit / native / 默认渲染器结论；这些属于任务 10 及真实设备验证。
