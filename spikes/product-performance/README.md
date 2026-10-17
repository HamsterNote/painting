# Product Performance Spike (Phase 10)

此目录是任务 10.1 的纯 Node 产品逻辑基准。它直接加载当前
`packages/painting/src/core/spatialIndex.ts` 中的 `SparseSpatialIndex`，而非阶段 2.3 的
dense fixed grid 对照实现。

验证所有者：父 orchestrator。JSON 的 `verificationOwner` 同步记录该责任边界。

## 运行

```bash
node --expose-gc spikes/product-performance/run.mjs
```

输出会覆盖：

```text
artifacts/research/product-performance/product-performance-measurements.json
```

`--expose-gc` 不是计时正确性的前提，但它使 B2 内存快照可在采集前主动执行 GC。若省略，
JSON 会记录 `memory.gcAvailable: false`。

JSON 结构校验：

```bash
node -e "JSON.parse(require('node:fs').readFileSync('artifacts/research/product-performance/product-performance-measurements.json','utf8')); console.log('valid JSON')"
```

## 方法

- 每次运行使用已安装的 TypeScript CLI，将唯一产品文件编译到 OS 临时目录后直接导入；不修改
  `packages/` 源码或现有构建产物，也不导入 `spikes/coordinate-performance`。
- 输入由确定性 `mulberry32` 生成。输出记录公共 seed、每场景 seed 和 FNV-1a 输入 fingerprint。
- 每个场景在计时前通过独立 `LinearOracle` 全扫描验证。oracle 自行实现半开 AABB，按 `order`
  排序，并逐项比对产品 query 的 `key` 和 `order`。oracle 不进入计时热路径。
- 每个操作先做 5 次 warmup、再做 25 次 measured round。每轮完整跑完 query bank，记录
  `p50Ms`、`p95Ms`、`maxMs`、`minMs`、`meanMs`。
- JSON 记录 Node、CPU、架构、内存、commit、seed、实际复跑命令和计时来源。

## 覆盖范围

| 区块 | 场景 | 范围 |
| --- | --- | --- |
| B1 | comparable normal | 100k records、16 queries、4096 DIP world、800x600 query，复用 2.3 的输入形状；测当前 sparse 产品索引与线性扫描基线。 |
| B2 | lifecycle + memory | 100k records 的 build、5k update、5k remove、16-query；含构建、更新、删除前后的 `process.memoryUsage()` 快照。 |
| B3 | sparse normal | 50k records 分布于 1,000,000 DIP 世界的局部查询。 |
| B3 | skew/dense | 90% 的 50k records 集中在 1024 DIP 区域。 |
| B3 | huge/overflow | 30k normal + 250 个跨 1,000,000 DIP 的 huge bbox，超过 `maxCellsPerObject=64`。 |
| B3 | cell-size sweep | 相同 sparse-normal 输入，扫描 64、128、256、512、1024 DIP cell。 |
| B3 | large-query fallback | 30k sparse records、64,000x64,000 DIP query，覆盖约 62,500 个默认 cell，超过 `maxCellsPerQuery=4096`，触发产品全 records fallback。 |

## 与阶段 2.3 的关系

2.3 的 100k / 16 查询数据来自 dense fixed 16x16 uniform grid，决策文件已经明确它只是 control，
不能外推为 sparse spatial hash 的性能。本 spike 的 B1 只复用该规模和生成形状，并实际运行
`SparseSpatialIndex`。任何性能判断均应以本 JSON 记录的当前机器、当前 commit 数据为准。

## 局限

- 数值只适合**同机**趋势和回归观察，不是跨机或跨 Node/V8 版本比较基准。
- Node CPU 微基准不是 Web、CanvasKit、Skia、native 或 GPU 帧时间，也不是任何 SLA。
- 线性基线只做 AABB 命中累加，产品 API 需要产出已排序结果数组；用于趋势对照，不表示端到端 UI 成本。
- 内存快照是进程级近似值，包含 V8/Node 分配与其他驻留对象，不是精确的单索引占用。
- 合成 bbox 场景不覆盖真实绘制、手势、React、序列化、Web Skia、CanvasKit 或真机。
- 报告只保留实测基线，不新增或硬编码任何未批准的百分比回归门限。
