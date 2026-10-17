# coordinate-performance spike（阶段 2.2）

本目录是 OpenSpec change `migrate-expo57-skia-surface` 阶段 2.2 的**独立、纯 Node** 实验，
用于在迁移前采集「大坐标精度」与「可见区域查询性能」两组可复现数据。

> 本 spike 与产品代码隔离：不导入 `packages/painting`、`packages/painting-board`、
> React、DOM、Skia、DrawingSurface 或任何产品依赖，也没有新增依赖。

## 复跑命令

```bash
node spikes/coordinate-performance/run.mjs
```

命令会稳定覆盖输出文件（无需先删除旧文件）：

```
openspec/changes/migrate-expo57-skia-surface/spikes/phase-2/coordinate-performance-measurements.json
```

校验 JSON 合法：

```bash
node -e "JSON.parse(require('fs').readFileSync('openspec/changes/migrate-expo57-skia-surface/spikes/phase-2/coordinate-performance-measurements.json','utf8')); console.log('ok')"
```

## 与产品 viewport 的关系（同构，非产品运行时）

`run.mjs` 内联复刻了 `packages/painting/src/viewport.ts` 的 affine 语义：

- `canvasToScreen`：`x * scale + tx`；
- `screenToCanvas`：`(x - tx) / scale`；
- `normalizeViewport` 对 scale 的 `[0.25, 8]` 夹取。

这是**与当前纯 viewport 同构的实验**，便于在迁移前独立度量同样的数学，
但**不是产品运行时**：脚本不消费产品代码，产品变更不会自动反映到本实验。

## 采集内容

### 1. 精度（`precision`）

- `float32MinStep`：对世界坐标量级 `1e3, 1e6, 1e7, 1e8, 1e9, 2^24, 2^53`，
  用 `Math.fround` 取 float32 表示，再取相邻 float32 值之差作为最小可分辨步长；
  并给出大基座 + 小偏移（1 / 0.5 / 0.1 / 0.01）是否被吞掉。
  **这是 f32 输入预算**：例如量级 `1e6` 下步长为 `0.0625`，只表示该量级坐标
  作为 float32 输入时的可分辨粒度，**不是视觉误差，也不是完整变换（affine）误差**；
  完整变换误差见下文的 `affine`。
- `float64MinStep`：对同样的世界坐标量级，用 8-byte DataView 实现 IEEE-754
  `nextUpFloat64`（正确处理 NaN、±Infinity、±0、正负有限数），再取相邻 double 之差
  作为 double ULP；每项含 `magnitude`、`float64MinStep`、`finite`。
- `cameraOriginRebase`：固定 `global=(1000000000.125, -1000000000.125)`、
  `origin=(1000000000, -1000000000)`、`scale=1`。先做 JS number（f64）减法得 `local`，
  再用 `Math.fround` 模拟 f32 local affine 得 `screen`，记录 `local`、`screen`、
  逐轴误差与 `allFinite`。这是 **f64-to-f32 输入预算示例**，
  非 CanvasKit / native / 视觉结论；重基**不能**恢复在接近 `2^53` 已丢失的
  JS number 精度（若 global 本身在 f64 层面已无法分辨某偏移，减 origin 也找不回）。
- `affine`：对 scale `0.25, 1, 8`（产品范围）与极端 `1e-6, 1e6`（越界，仅考察数学），
  平移量级 `0, 1e3, 1e6, 1e9`，比较 double 参考与全链路 float32 affine 的正变换、
  逆变换、round-trip 误差与有限性。

### 2. 性能（`performance`）

- 确定性 `mulberry32` 生成矩形文档，对象数 `1k / 10k / 100k`。
- 分别测量线性 visible-bounds 查询与候选 uniform grid 查询；
  每个场景先预热，再做 30 轮测量，输出 `p50 / p95 / max`、命中数与网格候选数。
- 网格查询会校验与线性查询命中数一致（`hitsMatchBetweenQueries`）。
- **不计时 correctness pass**：对 `buildQueryBank()` 的每个 rect，分别收集 linear 与
  grid（候选去重后精确相交）的完整命中 index ID，比较：
  - 去重 ID **集合**（`idSetMatch`）；
  - 按 index 升序恢复的**文档顺序序列**（`documentOrderMatch`）；
  - 以逗号 join 的稳定 **sequence checksum**（`checksumMatch`）。

  任一差异立即 `throw`。计时的 `measure` 热路径仍只累计 count/candidates，不引入 ID 数组分配。
  该 validation 只证明此固定生成文档与 4x4=16 固定 query bank 上两种查询一致，
  **非实际产品 / CanvasKit / native 的性能或行为结论**。

### 3. 稀疏 hash-grid 边界行为（`hashGridEdgeCases`）

由 `hash-grid-edge-cases.mjs` 提供，`run.mjs` 仅 import 其返回值并原样写入 JSON。
这是一个**非计时、合成**的逻辑等价样例（对应 JSON 的 `hashGridEdgeCases` 字段），
用于验证「未来 core 的候选空间索引」需要支持的逻辑，而**不是**产品实现、
性能 benchmark，也不构成 CanvasKit / Web GPU / native 证据：

- **稀疏 Map 网格**：`cellKey = "x,y"`（整数 cell 坐标，`Math.floor` 正确处理负坐标）；
  跨 cell 的 bbox 会注册进多个 cell bucket，查询时对 bucket 候选**去重 + 精确 AABB 相交**，
  再按文档 `order` 稳定排序。
- **`MAX_CELLS_PER_OBJECT` / overflow**：覆盖 cell 数超过该常量的 huge bbox 不逐 cell 登记，
  只进入 `overflow` bucket，避免把 huge bbox 无界复制进大量 cell；
  查询同时检查查询区域相关的 Map buckets 与 `overflow`。
- **边界对象**：初始文档至少包含负坐标 bbox、远正坐标 bbox、远负坐标 bbox 与 huge bbox；
  对覆盖这些区域的确定性 queries，比较 linear / grid 的：
  - 去重 **ID 集合**（`idSetMatch`）；
  - 按 `order` 的**序列**（`documentOrderMatch`）；
  - `ids.join(',')` **checksum**（`checksumMatch`）。
  任一差异立即 `throw`。
- **update / remove**：对一个普通对象执行 update（先按旧 bbox 注销旧 cell/overflow 注册，
  再写入新 bbox 并重新注册）后重新校验；再执行 remove 后重新校验。
- **返回结构**：`cellSize`、`maxCellsPerObject`、`initial` / `afterUpdate` / `afterRemove`
  （各含 `queryCount` 与三个布尔）、`overflow`（`used`、`objectIds`）。
  成功时所有布尔均为 `true`，且 `overflow.objectIds` 至少包含 huge 对象 ID。

这是一次**行为等价**验证，不等于产品已实现该索引；只覆盖内置固定小型文档与固定
query bank，**不能推广为实际产品 / CanvasKit / native 的性能或行为结论**。

## 明确不做的结论

- 不设定任何最终性能阈值。
- 不作 CanvasKit / native / 默认渲染器结论。
- 网格索引仅为**候选决策对照**，不代表产品已实现或选定空间索引。
- correctness pass 只覆盖固定生成文档与 16-query bank，不作实际产品行为结论。
- `hashGridEdgeCases` 是非计时、合成的逻辑等价样例，仅验证候选索引需支持负 key / overflow /
  update / remove 的行为等价，不是产品实现或性能 benchmark，也不构成 CanvasKit / Web GPU /
  native 证据；其 correctness 只覆盖内置固定小型文档与固定 query bank。

## 已知局限

- Node 端纯 JS 数学与计时不是 CanvasKit / Skia GPU 渲染路径，性能数值不可外推为端上渲染性能。
- 理论 float32 精度只描述坐标可分辨性，不能据此断言某场景一定发生渲染失效。
- `cameraOriginRebase` 是 f64-to-f32 输入预算示例（重基后 local 的 f32 输入可表示性），
  非 CanvasKit / native / 视觉结论；重基不能恢复已丢失的 JS number 精度。
- affine 精度为全链路 float32 的保守模拟，真实实现可能使用 double 或不同中间精度。
- correctness pass 只证明固定生成文档与 16-query bank 上 linear/grid 结果一致，
  非实际产品 / CanvasKit / native 的性能或行为结论。
- `hashGridEdgeCases` 为非计时、合成样例：仅验证负 key / overflow / update / remove 的
  逻辑等价，不是产品实现、性能 benchmark，也不构成 CanvasKit / Web GPU / native 证据。
- 单机单次运行，未做多机、多进程、GC 隔离或多版本 Node 对照，时序数据存在噪声。

完整的方法与局限也随结果写入 JSON 的 `method` / `limitations` 字段。
