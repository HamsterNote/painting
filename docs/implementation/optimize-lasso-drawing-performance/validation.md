> 最新段级预筛、数值边界回退及原版81bff35对照见 narrow-fallback-validation.md。本页保留历史冻结版本读数，不作为最新修复版性能结论。

> 本报告测量对象为冻结f4453ab，不包含后续P2兼容修复。修复的独立性能开销与回归证据见compatibility-fix.md；本报告的性能读数不能直接用于修复版验收。

# HAM-245：成员检查单项优化与真实查询时序

本轮只优化文档成员验证：将K次文档`.some()`改为当前文档的一次ID Set构建和K次查找，复杂度O(N+K)，空选区清除不扫描文档。没有改边界/准备算法、4ms调度预算、采样、查询选择规则或阈值。PR #52仍为草稿，不合入。

## 构建、样本与覆盖边界

测试埋点提交`d73ea7a93fbe0239d40aeb76a2b1dc1a9fc85a3e`，成员检查提交`0a411b8`，本轮线性化后冻结产品`f4453abf74cadd3c00bac95ad92c12cfdf8df338`。前后两版都带相同的query/input/selection测试标记；该标记仅由runner或显式`lassoPerf=1`的测试观察入口启用。普通路径不读取计时器、不生成performance mark。标记观察器出错不会取消手势。

冻结导出为`membership-before-export`与`membership-after-export`，实际JS及SHA256见配对包`bundles`与`environment.json`，补充maps见`supplementary-maps`；校验结果见`integrity.json`和`source-integrity.json`。`git diff d73ea7a f4453ab -- packages/painting/src/core`可确认核心算法差异只有成员检查。测试入口变化不改变查询或调度行为。

首次导出漏加`--source-maps`，因此正式测量bundle只有JS。随后分别从上述准确提交补导出maps到独立目录，原测JS未覆盖；仅去除末尾sourceMappingURL/debugId注释与尾空白后，两版重建执行内容均与原测JS逐字节相同，map中controller源文也逐字节匹配git提交。证明、各原始哈希和两份JS见`source-integrity.json`及`supplementary-maps`，补导出命令/源码恢复日志随包保留。独立UI诊断trace使用带maps的等价执行代码，不进入正式统计。

本轮`baseline`指**已有套索优化v2＋测试埋点**，`optimized`指它再加线性成员验证；不是最早的原始v1。原始v1的历史对照口径保留如下，不被本轮新对照填补：

| 原始v1→套索v2场景 | 共同有效正式轮/版 | 覆盖结论                                      |
| ----------------- | ----------------: | --------------------------------------------- |
| local/100         |               5/5 | 有完整配对；旧轮最终114.9ms及轨迹超2T事实保留 |
| local/500         |               0/5 | 未覆盖，不算失败或通过                        |
| local/1000        |               3/5 | 未覆盖，不算失败或通过                        |
| dense/100         |               0/5 | 未覆盖，不算失败或通过                        |
| dense/500         |               2/5 | 未覆盖，不算失败或通过                        |
| dense/1000        |               4/5 | 未覆盖，不算失败或通过                        |
| mixed/500         |               1/5 | 未覆盖，不算失败或通过                        |

不得把这些状态混入一个达标率。旧不对称“24/34”等结论已撤回。旧对称数据和静默证据保留在`validation-v2-historical.md`及上一轮附件。

新配对协议仍为7场景×7轮（2预热、5正式），每轮两版各有空/非空控制，共49组四元记录、196份原始JSON；seed245、1280×800、DPR1、每笔64点、600点/5秒/120Hz源计划时刻表，过期样本合批但不丢点。轮换版本和空/非空先后；任一版空控制FPS低于0.9×1000/T则共同剔除，不按有内容性能剔除、不补采。每场景完整五对前仍标未覆盖。按轮启动新浏览器，前两轮暖采集管线/主机资源，不宣称同进程V8稳态。共享主机的空控制本身包含套索工作，失败不统称环境噪声。

测试mark本身有开销，两版同样启用；本轮数字不能直接与上轮未埋点UI数字作因果比较。成员检查的前后差异来自本轮冻结的同口径构建，原版覆盖缺口仍保留。

| 场景/笔数  | 共同保留/版 | 原始v1基线           | 全程实际提交p95 前/后 ms | 全程实际机会p95 前/后 ms |  实时截止提交p95 前/后 ms |  实时截止机会p95 前/后 ms | 查询墙钟p95 前/后 ms |
| ---------- | ----------: | -------------------- | -----------------------: | -----------------------: | ------------------------: | ------------------------: | -------------------: |
| local/100  |         5/5 | v2历史记录有完整五对 |           87.90 / 166.00 |           94.60 / 167.40 |            88.90 / 182.00 |            97.30 / 187.30 |        33.60 / 23.30 |
| local/500  |         5/5 | 未覆盖               |          147.20 / 197.30 |          156.80 / 203.30 |           167.50 / 235.60 |           174.30 / 245.90 |        59.70 / 61.10 |
| local/1000 |         5/5 | 未覆盖               |          445.10 / 580.10 |          467.70 / 581.10 |      ∞/无有限p95 / 613.50 |      ∞/无有限p95 / 614.00 |       75.10 / 107.50 |
| dense/100  |         5/5 | 未覆盖               |          134.40 / 104.50 |          144.20 / 109.00 |           134.90 / 105.10 |           146.00 / 114.90 |        42.40 / 37.10 |
| dense/500  |         5/5 | 未覆盖               |          250.90 / 225.30 |          258.30 / 232.40 |           261.70 / 233.30 |           268.70 / 238.80 |        97.90 / 64.40 |
| dense/1000 |         5/5 | 未覆盖               |          636.80 / 668.60 |          637.40 / 674.60 |           636.80 / 684.00 |           637.40 / 685.30 |       144.00 / 93.10 |
| mixed/500  |         5/5 | 未覆盖               |        1283.10 / 1547.40 |        1284.10 / 1617.50 | ∞/无有限p95 / ∞/无有限p95 | ∞/无有限p95 / ∞/无有限p95 |        45.20 / 85.10 |

全程实际值包含最终提交并保留其final阶段标签；实时截止值仅统计up前反馈，缺失输入以Infinity留在分母，不能将截止前未完成误说为实际永不完成。最终结果不补实时指标。

## 逐条验收读数（后版）

下表每格保留五个有效正式轮；FPS取最小比值、掉帧取最大增量，轨迹取相对同轮2T最差的一轮，最终反馈五次的最近秩p95为最大值。分别按≥90%、≤5pp、≤2T、≤100ms核对；实时选区的≤100ms另见逐输入表，不由这里推断。任一原始轮超标均不能宣称验收通过，原始v1六个缺完整配对场景仍为未覆盖。

| 后版场景/笔数 | 最低FPS/空控制 | 最大掉帧增量 pp | 最坏轨迹p95 / 同轮2T ms | 五次最终反馈p95 ms |
| ------------- | -------------: | --------------: | ----------------------: | -----------------: |
| local/100     |         98.36% |            1.67 |           34.90 / 33.40 |              32.00 |
| local/500     |         98.99% |            1.00 |           34.10 / 33.40 |              80.10 |
| local/1000    |         97.75% |            2.66 |           36.50 / 33.40 |             128.40 |
| dense/100     |         99.52% |            0.33 |           34.30 / 33.40 |              65.60 |
| dense/500     |         99.63% |            0.33 |           33.10 / 33.40 |              61.80 |
| dense/1000    |         99.33% |            0.67 |           34.10 / 33.40 |              85.30 |
| mixed/500     |         77.91% |           21.93 |           50.60 / 33.40 |            1028.20 |

## 保留原100ms实时要求，补齐可观测性

`layeredToolSession`在接受输入、固化查询前缀、实际查询完成以及`setSelection`返回后发出测试事件。查询保存自己的`session/version/pointCount`，不能用完成时最新输入索引倒推。每个输入映射至**首个成功且包含该输入前缀的实时查询**，再取同一版本的实际提交及后续rAF机会；首两个退化点、未完成输入、缺失反馈均留在600个输入的分母中，缺失延迟视Infinity，JSON汇总为null。抬起后的最终结果不补实时缺口；等值选区无notification也仍计实际提交。

每份`.query-timing.json`包含逐输入的投递时刻、源计划时刻、所匹配查询版本/前缀、实际完成、提交和呈现机会时间，以及全部query span。`query-causality-examples.json`列出在途旧查询完成时已有新输入、但新输入被正确匹配到后续查询的实际样本。工具回归专门覆盖该误归属、缺失分母、up后的结果、等值选区与缺失标记拒绝。

同时给出`actual*`完整可观测延迟：允许对应的实际结果在up后完成，并保留final标签。它只解释实际等了多久，不替代临时更新要求。up前实时截止指标另列；其Infinity表示截止前不足95%输入获得实时结果，不能说系统实际永不完成，更不能删掉未完成输入重算较小的p95。

主表分别报告完整实际区间与up前实时截止区间；CSV同时披露源计划时刻→呈现机会（含合批前排队）、输入→实际查询完成、提交次数与覆盖分母。`source due`是合成源时刻表，不能冒充实体Pencil硬件时间戳。rAF是呈现机会代理，不能冒充物理paint；真实设备需按清单另附Timeline。

表格仅为便于阅读而四舍五入；判断使用原始时间戳，未引入额外容差。每轮输入p95独立计算，不将多轮合并以稀释长尾；汇总的“最坏轮次p95”取五轮p95最大值。

原实时选区p95≤100ms要求不替换。gap/silence仅补充披露，旧局部100最大静默111.1～182.6ms仍保留，旧gap替代方案已被明确否决。本轮实际gap/静默见下表与原始记录，不据gap合格推断输入新鲜度。

| 场景/规模/轮（后版） | 共同控制 | 实时/全程提交覆盖 | 全程实际完成/提交/机会 p95 ms | up前实时提交/机会 p95 | 源时刻→实际机会 p95 | 查询墙钟p95 / 2T | gap p95 / 最大静默 |
| -------------------- | -------- | ----------------: | ----------------------------: | --------------------: | ------------------: | ---------------: | -----------------: |
| local/100/r2         | 有效     |  590/600（共600） |         62.20 / 62.20 / 70.50 |         66.10 / 74.70 |               76.93 |    23.30 / 33.40 |     28.00 / 146.60 |
| local/100/r3         | 有效     |  592/600（共600） |      165.90 / 166.00 / 167.40 |       182.00 / 187.30 |              175.85 |    18.20 / 33.40 |     19.50 / 171.20 |
| local/100/r4         | 有效     |  598/600（共600） |        91.80 / 92.00 / 103.80 |        95.20 / 108.90 |              114.69 |    22.30 / 33.40 |     26.20 / 146.50 |
| local/100/r5         | 有效     |  599/600（共600） |         26.40 / 26.50 / 36.80 |         26.60 / 37.00 |               45.61 |    16.70 / 33.40 |      17.40 / 71.10 |
| local/100/r6         | 有效     |  594/600（共600） |         38.10 / 38.20 / 43.10 |         39.10 / 43.30 |               52.27 |    17.70 / 33.20 |      18.30 / 60.70 |
| local/500/r2         | 有效     |  588/600（共600） |      197.20 / 197.30 / 203.30 |       235.60 / 245.90 |              213.92 |    53.30 / 33.40 |     56.40 / 189.90 |
| local/500/r3         | 有效     |  590/600（共600） |      131.90 / 132.00 / 143.80 |       145.90 / 165.20 |              157.14 |    61.10 / 33.40 |     64.70 / 139.10 |
| local/500/r4         | 有效     |  590/600（共600） |         82.70 / 82.70 / 90.60 |         88.70 / 97.30 |               97.51 |    37.00 / 33.40 |      40.40 / 81.70 |
| local/500/r5         | 有效     |  594/600（共600） |      111.20 / 111.40 / 120.90 |       122.50 / 138.40 |              132.96 |    53.30 / 33.40 |     54.60 / 136.40 |
| local/500/r6         | 有效     |  595/600（共600） |      104.90 / 104.90 / 110.40 |       106.50 / 118.90 |              118.77 |    48.60 / 33.40 |      49.00 / 88.60 |
| local/1000/r2        | 有效     |  576/600（共600） |      220.40 / 220.60 / 228.90 |       243.00 / 243.20 |              237.97 |   107.50 / 33.40 |    110.70 / 157.10 |
| local/1000/r3        | 有效     |  588/600（共600） |      580.00 / 580.10 / 581.10 |       613.50 / 614.00 |              591.40 |    66.50 / 33.40 |     66.70 / 374.70 |
| local/1000/r4        | 有效     |  594/600（共600） |         83.70 / 83.80 / 93.90 |         87.40 / 99.20 |              104.32 |    49.50 / 33.40 |     51.20 / 109.20 |
| local/1000/r5        | 有效     |  585/600（共600） |      178.80 / 178.80 / 206.50 |       213.00 / 271.20 |              212.74 |    66.40 / 33.40 |     68.40 / 154.30 |
| local/1000/r6        | 有效     |  590/600（共600） |      140.20 / 140.20 / 148.10 |       161.20 / 172.00 |              151.79 |    61.60 / 33.40 |     65.30 / 159.20 |
| dense/100/r2         | 有效     |  599/600（共600） |        97.50 / 97.60 / 107.80 |        97.60 / 109.90 |              116.31 |    31.50 / 33.40 |     33.10 / 153.80 |
| dense/100/r3         | 有效     |  599/600（共600） |         89.00 / 91.10 / 97.40 |         91.70 / 98.50 |              104.85 |    31.90 / 33.40 |      33.30 / 87.10 |
| dense/100/r4         | 有效     |  599/600（共600） |      103.00 / 103.00 / 109.00 |       105.10 / 109.00 |              120.43 |    37.10 / 33.40 |     42.50 / 118.10 |
| dense/100/r5         | 有效     |  599/600（共600） |      104.50 / 104.50 / 107.40 |       104.80 / 114.90 |              115.48 |    35.00 / 33.40 |      36.20 / 97.90 |
| dense/100/r6         | 有效     |  599/600（共600） |         84.10 / 84.20 / 91.90 |         84.20 / 92.60 |              103.13 |    35.50 / 33.40 |      35.80 / 89.60 |
| dense/500/r2         | 有效     |  599/600（共600） |      224.70 / 224.80 / 232.40 |       233.30 / 238.80 |              243.35 |    64.40 / 33.40 |     64.90 / 186.70 |
| dense/500/r3         | 有效     |  599/600（共600） |      143.20 / 143.30 / 147.30 |       143.30 / 147.30 |              154.54 |    47.60 / 33.40 |     49.40 / 120.70 |
| dense/500/r4         | 有效     |  599/600（共600） |      201.90 / 202.10 / 206.90 |       203.20 / 207.20 |              213.17 |    48.80 / 33.40 |     49.50 / 156.00 |
| dense/500/r5         | 有效     |  599/600（共600） |      111.50 / 111.60 / 122.60 |       111.60 / 122.90 |              126.00 |    44.50 / 33.40 |      44.60 / 81.20 |
| dense/500/r6         | 有效     |  599/600（共600） |      225.10 / 225.30 / 232.10 |       228.90 / 238.50 |              240.38 |    53.00 / 33.40 |     53.40 / 179.10 |
| dense/1000/r2        | 有效     |  599/600（共600） |      266.00 / 266.20 / 276.50 |       266.20 / 277.70 |              280.14 |    82.80 / 33.40 |     86.60 / 185.50 |
| dense/1000/r3        | 有效     |  599/600（共600） |      235.00 / 235.30 / 244.30 |       239.20 / 244.40 |              252.24 |    61.30 / 33.40 |     59.50 / 170.50 |
| dense/1000/r4        | 有效     |  599/600（共600） |      423.20 / 423.30 / 425.20 |       423.30 / 435.30 |              435.26 |    93.10 / 33.40 |     93.70 / 294.70 |
| dense/1000/r5        | 有效     |  598/600（共600） |      668.50 / 668.60 / 674.60 |       684.00 / 685.30 |              686.24 |    59.80 / 33.40 |     50.20 / 466.50 |
| dense/1000/r6        | 有效     |  599/600（共600） |      404.50 / 404.60 / 413.70 |       404.60 / 419.70 |              420.97 |    75.90 / 33.40 |     76.20 / 320.30 |
| mixed/500/r2         | 有效     |  499/600（共600） |   1547.40 / 1547.40 / 1617.50 |                 ∞ / ∞ |             1637.40 |    52.10 / 33.40 |    57.00 / 1197.90 |
| mixed/500/r3         | 有效     |  491/600（共600） |     981.50 / 981.90 / 1039.40 |                 ∞ / ∞ |             1049.79 |    37.00 / 33.40 |     45.70 / 615.40 |
| mixed/500/r4         | 有效     |  575/600（共600） |      444.60 / 444.70 / 455.50 |       533.40 / 540.90 |              466.43 |    51.10 / 33.40 |     60.10 / 349.80 |
| mixed/500/r5         | 有效     |  576/600（共600） |      291.60 / 291.80 / 296.60 |       324.00 / 333.00 |              305.33 |    85.10 / 33.40 |     85.50 / 185.30 |
| mixed/500/r6         | 有效     |  559/600（共600） |      508.10 / 508.20 / 524.10 |                 ∞ / ∞ |              531.87 |    18.60 / 33.40 |     34.40 / 390.40 |

## 仅成员验证优化的量化结果

独立minified浏览器harness在两版相同源码下各测63种前缀组合（2预热＋5正式），第八轮profile/oracle单独保存、不进入正式计时。输入几何、候选排序与原始query oracle不变；构建源码diff校验、准确bundle/maps和环境随包保留。setSelection计时无UI订阅者，区别于配对UI中包含订阅者的完整提交耗时。

mixed/1000是额外诊断负载，不替代mixed/500＋50对象的正式场景。两版查询源码没有变化，几何计时差异仍可能来自抢占、JIT或GC，不将其归为成员验证的优化收益。

0ms读数表示低于当前计时分辨率，不表示零成本；probe环境文件记录最小可观察时钟步长。逐step计时和记录循环有开销，连续查询同时保存step和与整个循环墙钟，不冒充未插桩的纯CPU下限。

| 场景/规模/前缀 | 候选/命中 | 等值setSelection p95 前→后 ms | 连续几何查询p95 前→后 ms | 后版setup / 最长step p95 ms |
| -------------- | --------: | ----------------------------: | -----------------------: | --------------------------: |
| dense/100/600  |   100/100 |                   0.20 → 0.00 |              4.30 → 0.60 |                 0.30 / 0.20 |
| dense/1000/150 |    269/18 |                   0.30 → 0.10 |           245.70 → 79.50 |                 0.20 / 0.50 |
| dense/1000/600 | 1000/1000 |                  42.50 → 0.10 |              2.00 → 1.80 |                 0.70 / 0.20 |
| dense/500/600  |   500/500 |                  12.10 → 0.10 |              3.20 → 1.40 |                 0.50 / 0.20 |
| local/0/600    |       0/0 |                   0.00 → 0.10 |              0.30 → 0.30 |                 0.30 / 0.00 |
| local/100/600  |     26/14 |                   0.30 → 0.10 |            40.00 → 13.60 |                 0.30 / 1.30 |
| local/1000/150 |     42/16 |                   0.50 → 0.00 |            17.40 → 10.60 |                 0.20 / 1.90 |
| local/1000/600 |   143/116 |                   2.10 → 0.10 |            54.50 → 31.60 |                 0.30 / 1.40 |
| local/500/600  |   143/116 |                   2.30 → 0.10 |            80.90 → 59.40 |                 0.30 / 4.20 |
| mixed/1000/150 |    248/79 |                   3.30 → 0.10 |           120.10 → 55.40 |                 0.20 / 2.40 |
| mixed/1000/600 |  1050/858 |                  32.50 → 0.20 |          471.70 → 215.80 |                 0.60 / 3.70 |
| mixed/500/600  |   550/435 |                   8.70 → 0.10 |          314.10 → 122.40 |                 0.50 / 1.30 |

两版完整query oracle各9/9有序一致；每版315次正式前缀计时，无按耗时剔除。全63组原始统计在probe-report.json/.csv。

配对UI实际setSelection调用（含同步订阅者），下列为各五轮p95的最大值：

| 场景/笔数  | 前版→后版 ms |
| ---------- | -----------: |
| local/100  |    0.1 → 0.1 |
| local/500  |    1.6 → 0.2 |
| local/1000 |    3.1 → 0.4 |
| dense/100  |    3.4 → 0.1 |
| dense/500  |   14.2 → 0.2 |
| dense/1000 |   35.8 → 0.4 |
| mixed/500  |    2.1 → 0.1 |

1000个ID全命中时，旧成员验证精确执行1+…+1000=500,500次对象ID比较；新版一次遍历N个文档对象、K次Set查找，为2000次访问量级，不缓存跨文档状态。正常选择、重复ID顺序、编辑、撤销重做后的有效性与失败原子性由回归覆盖。

查询耗时需要单独看：UI中查询墙钟含排队/yield，独立harness测已prepared后的连续查询工作；两者都不是每帧预览延迟。与同轮2T对照的实际读数如下，不以最短一轮替代p95，不将成员检查改善冒充几何改善。

输入p95按600个输入加权，查询p95按实际查询次数计算；少数长查询可能影响很多输入。因此查询p95较小，也不能据此推导输入→选区p95达标。

| 1000笔场景/前缀 | 后版连续查询 min / median / p95 ms | 辅助2T参照                     | 后版等值提交p95 ms |
| --------------- | ---------------------------------: | ------------------------------ | -----------------: |
| local/600       |              29.60 / 30.10 / 31.60 | 本机UI约33.4ms（逐轮2T见上表） |               0.10 |
| local/599       |              29.80 / 30.50 / 34.90 | 本机UI约33.4ms（逐轮2T见上表） |               0.10 |
| dense/600       |                 1.60 / 1.80 / 1.80 | 本机UI约33.4ms（逐轮2T见上表） |               0.10 |
| dense/150       |              78.70 / 79.00 / 79.50 | 本机UI约33.4ms（逐轮2T见上表） |               0.10 |
| mixed/600       |           205.10 / 207.90 / 215.80 | 本机UI约33.4ms（逐轮2T见上表） |               0.20 |
| mixed/450       |           219.90 / 222.10 / 224.40 | 本机UI约33.4ms（逐轮2T见上表） |               0.20 |

结论：成员验证单项收益与几何查询分别报告。1000笔是否超2T以上表为准；任何超出的轨迹仍保留原阈值，不据此自动降级或宣称不可兼得。

对应最重前缀的额外r7实际query work窗口采样（不含后续oracle与selection；profile轮不参与正式计时）：

- local/1000/p599：窗口29.895ms，前3个self采样位置：`../../../../packages/painting/src/core/layeredObjectQuery.ts:1280 withinLassoMargin` 22.168ms; `../../../../packages/painting/src/core/layeredObjectQuery.ts:1333 fastPointInMulti` 5.427ms; `../../../../packages/painting/src/core/layeredObjectQuery.ts:1392 fastPieceIntersectsLasso` 2.155ms。
- dense/1000/p150：窗口79.017ms，前3个self采样位置：`../../../../packages/painting/src/core/layeredObjectQuery.ts:163 allRings` 59.198ms; `../../../../packages/painting/src/core/layeredObjectQuery.ts:1392 fastPieceIntersectsLasso` 8.951ms; `../../../../packages/painting/src/core/layeredObjectQuery.ts:1333 fastPointInMulti` 4.444ms。
- mixed/1000/p450：窗口220.869ms，前3个self采样位置：`../../../../packages/painting/src/core/layeredObjectQuery.ts:163 allRings` 167.004ms; `../../../../packages/painting/src/core/layeredObjectQuery.ts:1392 fastPieceIntersectsLasso` 38.713ms; `../../../../packages/painting/src/core/layeredObjectQuery.ts:1333 fastPointInMulti` 8.890ms。

映射位置是minified/JIT采样的源码位置，可能含内联归属；例如allRings位置不能单独证明数组展开本身消耗了全部时间。采样按绝对时间排序修正V8负timeDelta，区间不重叠；小窗口和边缘归因有采样误差，墙钟含抢占/GC，不能把单个长step当成对象固有计算下限。下一步应继续分解实测最重前缀的边界工作；本轮保持单项改动以便归因。

4ms预算仍不能抢占setup、单个对象和提交。本轮没有修改其余两处，也不以本机最短耗时宣称物理下限/架构不可兼得；若读数仍超2T，下一优化对象需依据当前profile与前缀分布选择，阈值不变。旧635.9ms（local500/r3最终反馈）和66.44ms（local500/r6源输入→轨迹代理）的时序归属保持原报告解释，不能混成1000笔查询耗时。

## 实际验证、命令与输出索引

| 实际命令（仓库根目录，环境变量详见environment.json）                                                                                                                                                                                                                                                                                                                     | 原始输出日志                                                                                       | 结果                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `git diff d73ea7a f4453ab -- packages/painting/src/core`                                                                                                                                                                                                                                                                                                                 | `v3-core-product-diff.log`                                                                         | 核心算法仅成员检查变化                                                           |
| `pnpm run build:lib`；`pnpm --filter @hamster-note/painting-playground exec expo export --platform web --output-dir ../../artifacts/research/lasso/membership-<before或after>-export`                                                                                                                                                                                    | `v3-before-lib-build.log`、`v3-before-export.log`、`v3-after-lib-build.log`、`v3-after-export.log` | 两个库及两版production导出成功                                                   |
| `LASSO_PROBE_SHA=d73ea7a node scripts/perf/lasso-query-probe.mjs artifacts/research/lasso/membership-before-probe`                                                                                                                                                                                                                                                       | `v3-before-probe-output.log`                                                                       | 504记录、315正式计时、9 oracle一致                                               |
| `LASSO_QUERY_MARKS=1 LASSO_BUILDS='<environment.json中的两个冻结build>' node scripts/perf/lasso-paired.mjs artifacts/research/lasso/membership-paired-v3`                                                                                                                                                                                                                | `v3-paired-output.log`                                                                             | 49组四元、196记录                                                                |
| `python3 build-lasso-v3-maps.py`（工作目录中，脚本随tools交付）                                                                                                                                                                                                                                                                                                          | `v3-map-rebuild-output.log`及两版map-lib-build/map-export日志                                      | 从准确提交补导出maps，恢复原源码字节                                             |
| `node scripts/perf/lasso-verify-membership-builds.mjs`                                                                                                                                                                                                                                                                                                                   | `v3-source-integrity-output.log`                                                                   | 真实执行内容及map源码逐字节校验通过                                              |
| `node scripts/perf/lasso-verify-paired.mjs artifacts/research/lasso/membership-paired-v3`                                                                                                                                                                                                                                                                                | `v3-integrity-output.log`                                                                          | 600源输入/64点笔画/最终有序ID/hash校验通过                                       |
| `LASSO_PROBE_SHA=f4453ab node scripts/perf/lasso-query-probe.mjs artifacts/research/lasso/membership-after-probe`                                                                                                                                                                                                                                                        | `v3-after-probe-output.log`                                                                        | 504记录、315正式计时、9 oracle一致                                               |
| `node scripts/perf/lasso-query-probe-report.mjs <before或after-probe目录>`                                                                                                                                                                                                                                                                                               | `v3-before-probe-report.log`、`v3-after-probe-report.log`                                          | 各63组，不按性能剔除                                                             |
| `node scripts/perf/lasso-probe-profile.mjs <before或after-probe目录> all`                                                                                                                                                                                                                                                                                                | `v3-before-profile-output.log`、`v3-after-profile-output.log`                                      | 各126个setup/work窗口                                                            |
| `node scripts/perf/lasso-membership-report.mjs`                                                                                                                                                                                                                                                                                                                          | `v3-membership-report-output.log`                                                                  | 同版本输入前缀统一重算，逐轮CSV与因果样本索引                                    |
| `LASSO_QUERY_MARKS=1 LASSO_PROFILE=1 LASSO_ROUNDS=1 LASSO_ROUND_OFFSET=6 LASSO_SCENARIOS=dense LASSO_COUNTS=1000 LASSO_PRODUCT_SHA=f4453abf74cadd3c00bac95ad92c12cfdf8df338 LASSO_EXPORT_ROOT=artifacts/research/lasso/membership-after-map-export LASSO_OUTPUT=artifacts/research/lasso/membership-ui-trace-v3 node scripts/perf/lasso-production.mjs membership-after` | `v3-ui-trace-output.log`                                                                           | 额外UI trace/profile，不计正式统计                                               |
| `pnpm exec jest --selectProjects core-node --runInBand --runTestsByPath packages/painting/src/__tests__/core/layered-lasso-scheduling.test.ts packages/painting/src/__tests__/core/layered-editor-controller.test.ts packages/painting/src/__tests__/core/layered-lasso-query.test.ts packages/painting/src/__tests__/core/layered-tools.test.ts`                        | `v3-core-test-output.log`                                                                          | 4 suites / 78项通过                                                              |
| `pnpm exec jest --watchman=false --runInBand --selectProjects legacy-web --testPathPattern 'layered-(display-regression                                                                                                                                                                                                                                                  | semantic-adapter                                                                                   | public-entry                                                                     | presentation | freehand-regressions)'` | `v3-adapter-test-output.log` | 3 suites / 26项通过 |
| `node --test scripts/perf/lasso-query-timing.test.mjs scripts/perf/lasso-paired-result.test.mjs scripts/perf/lasso-observability.test.mjs scripts/perf/lasso-metrics.test.mjs`                                                                                                                                                                                           | `v3-tools-test-output.log`                                                                         | 20项通过                                                                         |
| `pnpm run typecheck`                                                                                                                                                                                                                                                                                                                                                     | `v3-typecheck-output.log`                                                                          | 成功                                                                             |
| `pnpm run lint`                                                                                                                                                                                                                                                                                                                                                          | `v3-lint-output.log`                                                                               | 0错误 / 32条既有警告；后续新增分析工具的scoped lint见v3-analysis-lint-output.log |
| `LASSO_EXPORT_ROOT=artifacts/research/lasso/membership-after-export pnpm exec playwright test tests/ui/lasso-performance-regression.spec.ts tests/ui/layered-editor.spec.ts tests/ui/page-integration.spec.ts --config=playwright.lasso.config.ts --project=chromium --grep 'lasso                                                                                       | mixed SVG                                                                                          | dot, pressure                                                                    | page anchors | disabled text           | read-only pages'`            | `v3-ui-output.log`  | 18项通过 |

环境：Ubuntu26.04 / Linux7.0.0-31-generic、i7-8700/6可见CPU、Node24.15.0、pnpm10.28.2、Playwright1.59.1、Chromium147.0.7727.15，1280×800/DPR1。UI正式测量关闭profile，两版测试mark一致；before probe、UI矩阵、after probe及UI诊断trace串行，未与本轮测试/构建并发。共享主机没有独占CPU保证，保持原控制判据。

原始索引：

- `HAM-245-membership-v3.zip`内`membership-paired-v3/raw-index.json`、`rounds.csv`、`membership-report.json`、`query-causality-examples.json`和`integrity.json`；每轮每版本目录保存control/drawing JSON、逐输入query-timing、stdout/stderr、summary和environment；`bundles`保存原测UI JS，`supplementary-maps`保存经执行内容校验的补导出JS/maps；完整冻结站点在包内两个export目录。
- `HAM-245-query-v3.zip`内`membership-before-probe`、`membership-after-probe`保存504份/版原始诊断、63组统计、9组profile/trace和probe.js/maps；`membership-ui-trace-v3`保存额外UI profile轮的原始记录与标记，不计入正式性能统计。
- `membership-paired-v3/run-commands.json`补充准确argv/env；两包`logs`包含下表命令原始输出，`MANIFEST.json`逐文件SHA256；`delivery-v3.json`记最终交付提交。完整设备操作见独立附件`HAM-245-device-verification.md`和仓库同名清单；包括实体输入录制脚本。

WebKit因既有系统运行库缺口仍待验，本轮不重复下载或宣称通过；iPad Safari/iOS WKWebView/实体笔触摸均待验。OpenSpec仍8/11，4.1/4.3/4.4不勾选；设备清单完成不等于设备验证通过。PR #52保持草稿，issue进入验证中供证据与后续范围评审。
