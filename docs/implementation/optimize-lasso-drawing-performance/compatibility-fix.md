# HAM-245 P2：布尔相交兼容修复

本轮功能回归通过，但保守回退带来严重性能退化：混合1000对象/450点前缀查询p95为251.0→7634.9ms。该补丁供兼容性审核，不代表整体性能可接受；PR继续草稿，不能沿用修复前性能数字验收。

## 修复范围与提交

修复补丁：`b28f38fa5e05bed182e570c9975f58249539d2b2`。修改仅限新路径 `fastPieceIntersectsLasso`：快速包含/接触判定命中时保留原路径；快速判定返回false或无法判定时，调用未修改的 `pieceIntersectsLasso`，恢复旧布尔相交及其退化/错误处理。没有修改旧oracle、共线谓词、架构、调度预算或性能阈值。

触发原因：自交轨迹规范化后出现浮点交点，点包含/距离判定不能替代布尔相交的既有数值行为。未使用固定epsilon或仅针对本反例的几何筛选；所有快速未命中均保守回退，因此某些查询有额外开销。快速路径仍有正判定捷径，此修复和有限差分测试不构成全几何等价证明。

## 固化回归与原始输出

- 图片bounds `(31,31)–(34,34)`，7点审核轨迹 `(70,10),(20,50),(10,20),(10,60),(0,70),(10,20),(40,40)`：旧查询和新完整查询分别写死预期 `['target']`。
- 图片bounds `(40,40)–(60,60)`，6点轨迹 `(0,0),(100,0),(100,20),(20,20),(20,40),(0,40)`：保留旧共线分离误命中，两条查询均写死 `['target']`。
- 两种反例各覆盖同步会话、end早于排队查询、实时查询完成后end；验证最终选区/工具、无文档/undo增量和无残余任务。
- `lasso-compatibility-differential.test.ts`：100个网格图片、精确审核反例、seed245的LCG（1664525/1013904223，uint32）生成10,000条3–10点整数轨迹，逐条比较有序命中及错误结果；失败输出轨迹、生成器状态和序号。审核附件没有记录原PRNG、种子或命中序号，因此这个seed245是明确新增的验证序列，不冒充原审核序列；原缩减反例逐坐标保留。

命令（仓库根目录）：

```sh
pnpm exec jest --watchman=false --selectProjects core-node --runInBand --verbose --runTestsByPath packages/painting/src/__tests__/core/layered-lasso-compatibility.test.ts packages/painting/src/__tests__/core/layered-lasso-query.test.ts packages/painting/src/__tests__/core/layered-lasso-scheduling.test.ts packages/painting/src/__tests__/core/layered-tools.test.ts
pnpm exec esbuild scripts/perf/lasso-compatibility-differential.test.ts --bundle --platform=node --format=cjs --outfile=artifacts/research/lasso/compatibility-differential.cjs
node --test artifacts/research/lasso/compatibility-differential.cjs
pnpm run typecheck
pnpm run build:lib
pnpm exec eslint packages/painting/src/core/layeredObjectQuery.ts packages/painting/src/__tests__/core/layered-lasso-compatibility.test.ts scripts/perf/lasso-compatibility-differential.test.ts scripts/perf/lasso-compatibility-paired.mjs scripts/perf/lasso-compatibility-probe.ts
node scripts/perf/lasso-compatibility-paired.mjs artifacts/research/lasso/compatibility-paired
```

Jest 4套/35项通过（p2-core-tests-final.log）；Node差分测试10,000/10,000通过、零差异（p2-differential-output.log）；typecheck、库构建及相关文件lint通过。配对1008份原始查询记录；两版各9/9完整oracle有序一致；两版map源文精确匹配提交且bundle哈希一致（source-integrity.json）。库构建既有package exports警告保留在原输出。

原始日志全部随附件保留：`p2-before-regression.log`先证实新路径返回空、旧路径命中；`p2-core-tests.log`保留Watchman监视数上限错误；`p2-core-tests-retry.log`为耗时过长而中止的Jest隔离环境差分尝试，不算通过；最终结果以 `p2-core-tests-final.log`、`p2-differential-output.log` 为准。大规模用例移到仓库内Node测试，输入与断言不缩减。首次scoped lint发现条件expect，修正后以 `p2-lint-final.log` 和 `p2-perf-tool-lint-final.log` 为准。

## 修复前后查询开销

对照 `a0170de` 与修复补丁：同一诊断harness/fixture，before精确读取旧提交的query模块，其余模块相同；两个隔离页面在同一Chromium中串行交替顺序。9场景/规模×7前缀×8轮，2预热、5正式、1完整oracle诊断；所有原始记录保留，不按耗时剔除。summary用五个正式值的最近秩p95，不混入oracle诊断。

测的是prepared之后的连续查询setup＋work，不是帧率或输入→选区延迟；没有重跑UI验收矩阵，不能用它替代端到端或真机结果。正式性能运行与本轮测试/构建串行，共享主机仍可能有其他租户负载；每轮原始输出和环境随包保留。100次重复的小反例另列每次查询平均值，不将这个平均值称作单次p95。

最大绝对p95增量出现在 mixed/1000/p450：251.00→7634.90ms（+7383.90ms）。密集1000完整600点为2.10→2.60ms。下表覆盖全部63组；负差值保留但不据此声称回退使算法变快，零/微小时长受时钟分辨率、JIT/GC及共享主机干扰。

| 场景/规模/前缀 | 前p95 ms | 后p95 ms |  差值 ms |  后/前 |
| -------------- | -------: | -------: | -------: | -----: |
| local/0/3      |     0.10 |     0.10 |    +0.00 |   1.00 |
| local/0/30     |     0.10 |     0.10 |    +0.00 |   1.00 |
| local/0/150    |     0.10 |     0.20 |    +0.10 |   2.00 |
| local/0/300    |     0.80 |     0.80 |    -0.00 |   1.00 |
| local/0/450    |     0.30 |     0.30 |    +0.00 |   1.00 |
| local/0/599    |     0.40 |     1.20 |    +0.80 |   3.00 |
| local/0/600    |     1.10 |     0.30 |    -0.80 |   0.27 |
| local/100/3    |     0.10 |     0.10 |    +0.00 |   1.00 |
| local/100/30   |     0.10 |     2.10 |    +2.00 |  21.00 |
| local/100/150  |     0.20 |     0.10 |    -0.10 |   0.50 |
| local/100/300  |     0.20 |     0.20 |    +0.00 |   1.00 |
| local/100/450  |    42.20 |   607.90 |  +565.70 |  14.41 |
| local/100/599  |    25.70 |   576.40 |  +550.70 |  22.43 |
| local/100/600  |    33.30 |   736.50 |  +703.20 |  22.12 |
| local/500/3    |     2.30 |     0.20 |    -2.10 |   0.09 |
| local/500/30   |     0.20 |     0.20 |    +0.00 |   1.00 |
| local/500/150  |    35.40 |   719.40 |  +684.00 |  20.32 |
| local/500/300  |    19.30 |   375.60 |  +356.30 |  19.46 |
| local/500/450  |   125.90 |  1577.60 | +1451.70 |  12.53 |
| local/500/599  |   157.80 |  1578.70 | +1420.90 |  10.00 |
| local/500/600  |   102.70 |  1118.10 | +1015.40 |  10.89 |
| local/1000/3   |     0.20 |     0.20 |    -0.00 |   1.00 |
| local/1000/30  |     0.20 |     0.30 |    +0.10 |   1.50 |
| local/1000/150 |    17.60 |   477.30 |  +459.70 |  27.12 |
| local/1000/300 |    13.40 |   289.40 |  +276.00 |  21.60 |
| local/1000/450 |    67.80 |  1076.90 | +1009.10 |  15.88 |
| local/1000/599 |    62.40 |  1467.10 | +1404.70 |  23.51 |
| local/1000/600 |    72.20 |  1343.70 | +1271.50 |  18.61 |
| dense/100/3    |     0.00 |     0.00 |    +0.00 |      — |
| dense/100/30   |     0.10 |     0.20 |    +0.10 |   2.00 |
| dense/100/150  |    19.60 |   609.70 |  +590.10 |  31.11 |
| dense/100/300  |     1.60 |    31.90 |   +30.30 |  19.94 |
| dense/100/450  |     9.00 |    48.60 |   +39.60 |   5.40 |
| dense/100/599  |     0.70 |     1.40 |    +0.70 |   2.00 |
| dense/100/600  |     0.70 |     0.60 |    -0.10 |   0.86 |
| dense/500/3    |     0.10 |     0.10 |    +0.00 |   1.00 |
| dense/500/30   |     0.20 |     0.10 |    -0.10 |   0.50 |
| dense/500/150  |    86.90 |  1944.20 | +1857.30 |  22.37 |
| dense/500/300  |     3.10 |    54.40 |   +51.30 |  17.55 |
| dense/500/450  |     3.50 |    51.80 |   +48.30 |  14.80 |
| dense/500/599  |     1.20 |     1.60 |    +0.40 |   1.33 |
| dense/500/600  |     1.40 |     1.30 |    -0.10 |   0.93 |
| dense/1000/3   |     0.10 |     0.10 |    +0.00 |   1.00 |
| dense/1000/30  |     0.20 |     0.10 |    -0.10 |   0.50 |
| dense/1000/150 |    86.10 |  3433.60 | +3347.50 |  39.88 |
| dense/1000/300 |    10.50 |   168.40 |  +157.90 |  16.04 |
| dense/1000/450 |     9.60 |   236.50 |  +226.90 |  24.64 |
| dense/1000/599 |     3.00 |     2.60 |    -0.40 |   0.87 |
| dense/1000/600 |     2.10 |     2.60 |    +0.50 |   1.24 |
| mixed/500/3    |     0.10 |     0.00 |    -0.10 |   0.00 |
| mixed/500/30   |     0.10 |     0.10 |    -0.00 |   1.00 |
| mixed/500/150  |     2.00 |   260.40 |  +258.40 | 130.20 |
| mixed/500/300  |     0.50 |     0.20 |    -0.30 |   0.40 |
| mixed/500/450  |   331.20 |  5892.90 | +5561.70 |  17.79 |
| mixed/500/599  |   230.00 |  3903.70 | +3673.70 |  16.97 |
| mixed/500/600  |   231.50 |  4571.70 | +4340.20 |  19.75 |
| mixed/1000/3   |     0.00 |     0.10 |    +0.10 |      — |
| mixed/1000/30  |     0.30 |    26.50 |   +26.20 |  88.33 |
| mixed/1000/150 |    93.50 |  7451.60 | +7358.10 |  79.70 |
| mixed/1000/300 |    90.40 |  1410.10 | +1319.70 |  15.60 |
| mixed/1000/450 |   251.00 |  7634.90 | +7383.90 |  30.42 |
| mixed/1000/599 |   230.90 |  6695.30 | +6464.40 |  29.00 |
| mixed/1000/600 |   328.70 |  6292.10 | +5963.40 |  19.14 |

小反例的五轮“每轮100次平均耗时”（非单次p95）：

| 输入         | 前版平均值范围 ms/次 | 后版平均值范围 ms/次 | 前/后结果       |
| ------------ | -------------------: | -------------------: | --------------- |
| 审核浮点反例 |        0.4970–0.7000 |        0.9730–1.4070 | 空 / target     |
| 共线兼容     |        0.0120–0.1090 |        0.0130–0.0880 | target / target |

旧v3的34.9/79.5/224.4ms等数值来自冻结 `f4453ab` 的历史运行，不能直接代表修复版；本轮新配对用于量化回退开销。成员检查代码未改，42.5→0.1ms仍是旧冻结构建的单点证据，不冒充本轮端到端收益。原始v1六格未覆盖、100ms/2T阈值和历史111.1～182.6ms最大静默均保留。

## 索引、环境和交付边界

`compatibility-paired/environment.json`：准确SHA、模块diff、Node/Chromium/CPU/内核、命令及bundle哈希；`pairs.json`：全部配对与两个反例；`summary.json`：63组正式统计；每份before/after JSON保留setup、逐候选时间、候选数、命中数和诊断oracle结果。两版JS/maps随包保留，另附Node差分测试构件与命令原始输出，`MANIFEST.json`逐文件SHA256。

WebKit/真机本轮未运行；当前设备支线的冻结 `f4453ab` 不含本修复，后续设备结论必须注明被测SHA。PR #52继续草稿，不合入；A/B架构未实施，整体性能验收仍未通过，issue继续进行中等待审核与设备验证。
