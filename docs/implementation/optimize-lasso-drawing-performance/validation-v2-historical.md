> 历史对称复测报告。gap替代方案随后被否决，现已补实际查询埋点；原始六场景未覆盖及静默证据保留。最新结论见validation.md。

# HAM-245：对称复测、实时反馈可观测性与尾部归因

本报告替代上一轮的单版「24/34达标」等判断。旧轮次因版本独立剔除、样本集合不同，不用于验收，也不用于计算改善幅度；原始文件不删除，只有明确索引的旧尾部样本继续用于时序诊断。PR #52 保持草稿，不合入。所有原规范阈值保持不变。

## 1. 对称复测协议

命令：`node scripts/perf/lasso-paired.mjs`，再运行 `node scripts/perf/lasso-paired-report.mjs`。

被测产品始终是冻结的 production export：原版 `81bff35d05f6e353e2d35601aa395667fb89d046`（`apps/playground/dist`）与优化版 `8f6162249c15119e1234857f3db5fd37915e2809`（`artifacts/research/lasso/optimized-export`）。`bundles/baseline`、`bundles/optimized` 保留实际 JS/maps，`environment.json` 包含逐文件 SHA256。性能产品代码没有因本轮采集而修改。

固定7个场景/规模组合：local与dense分别100/500/1000，mixed为500笔加20文字/20形状/10图片。每组固定两轮预热、五轮正式测量，且每轮每版本都有独立0笔控制，总计49组四元记录、两版各98轮。seed245、1280×800、DPR1、每笔64点、600点/5秒的120Hz源时刻表、同一合批投递代码；实际合批/输入迟到记录为输出，不按实际合批分布分别选择版本样本。

每版本每轮新启动同配置 Chromium，轮换两版先后顺序，空/非空顺序也随轮次一起轮换。同一时刻只运行一个测量浏览器。为清除上一轮长会话状态而按轮重启浏览器，前两轮预热的是采集管线/主机资源，不保留同一V8进程的JIT状态；正式记录仍包含新页面首次手势的成本，不宣称长会话稳态性能。本轮UI采集两版均禁用CPU profiler/trace；几何诊断的profile在之后独立执行，避免采样开销混入帧率比较。

唯一共同保留判据：**两版各自的空控制均满足 FPS≥0.9×1000/T**（T为该轮空闲rAF间隔中位数）。任一版本失败，即同时剔除这一对的两版结果；不按有内容时的FPS/延迟剔除、不补采、不将一版的好轮次拼到另一版。每个场景须保留完整五对，才提供该场景的改善比值；不足五对直接标记不可判，不从残余样本凑比值。

空控制是在画布上实际运行套索，不是纯环境空闲探针。旧trace中空画布仍有约3028ms canonicalization采样，因此空控制不达标也可能包含产品自己的工作，不能一概叫“环境噪声”。我们保留既定有效性判据，不擅自放宽以保留原版。`observability.json`另外列出同轮空控制的空闲FPS与绘制FPS，供区分该口径的含义，不将空闲FPS改用作新的保留判据。

| 场景/笔数  | 尝试数/版 | 共同保留数/版 | FPS中位数 原版/优化 | 最终p95 ms 原版/优化 | 改善倍数（仅完整5对） |
| ---------- | --------: | ------------: | ------------------: | -------------------: | --------------------: |
| local/100  |         5 |             5 |       30.82 / 59.57 |     2139.80 / 114.90 |                  1.94 |
| local/500  |         5 |             0 |     不可判 / 不可判 |      不可判 / 不可判 |                不可判 |
| local/1000 |         5 |             3 |     不可判 / 不可判 |      不可判 / 不可判 |                不可判 |
| dense/100  |         5 |             0 |     不可判 / 不可判 |      不可判 / 不可判 |                不可判 |
| dense/500  |         5 |             2 |     不可判 / 不可判 |      不可判 / 不可判 |                不可判 |
| dense/1000 |         5 |             4 |     不可判 / 不可判 |      不可判 / 不可判 |                不可判 |
| mixed/500  |         5 |             1 |     不可判 / 不可判 |      不可判 / 不可判 |                不可判 |

完整共同控制场景的优化版逐轮验收读数（原版与全部未完整场景仍见原始CSV）：

| 场景/轮      | FPS/自身控制（≥0.9） | 掉帧增量pp（≤5） | 轨迹p95 / 2T ms | 最终 ms（≤100） |
| ------------ | -------------------: | ---------------: | --------------: | --------------: |
| local/100/r2 |               1.0041 |           -0.337 |   33.50 / 33.40 |           60.10 |
| local/100/r3 |               0.9974 |            0.333 |   34.00 / 33.40 |           47.20 |
| local/100/r4 |               0.9944 |            0.664 |   33.80 / 33.40 |          114.90 |
| local/100/r5 |               0.9959 |            0.333 |   32.20 / 33.40 |           44.30 |
| local/100/r6 |               1.0022 |            0.000 |   32.30 / 33.40 |           25.10 |

读数口径：原始JSON包含全部输入、rAF、发布与通知时刻；统计统一使用 `lasso-metrics.mjs`，包括最后阻塞的完整绘制时长、首尾掉帧、未呈现样本。缺失呈现进入p95时以null表示无穷/不可给有限延迟，不将其从输入分母剔除。五个正式轮次的“p95”按最近秩为最大值；不能据五轮声称统计总体的确定上限。

原始输出索引（相对于 `HAM-245-paired-v2.zip`）：

- `paired-v2/raw-index.json`：每个版本、场景、轮次的control/drawing文件名。
- `paired-v2/pairs.json`：全部49组四元记录，包括预热、共同保留标记和逐条剔除原因。
- `paired-v2/rounds.csv`：每轮FPS/掉帧/轨迹/最终时序和反馈间隔。
- `paired-v2/<scenario>-<count>-r<round>/<baseline|optimized>/stdout.log`、`stderr.log`、`environment.json`、`summary.json`及两份原始JSON。
- `paired-v2/environment.json`：冻结构建与hash、运行命令、协议和工具提交。

## 2. 实时选区：明确不可观测的量与可直接测的替代

**原“输入到其对应查询完成/呈现的p95”在当前保存的产物中不可观测。** 异步查询的path version/start没有输出，完成时的current input index可能已属于更新路径；不能把它当成该查询的输入时刻。旧CPU sampling profile也不能补出跨多个MessageChannel任务的准确查询版本。因此明确标记 `observable:false`，不再用 selection 通知延迟冒充该指标。

可立即观测的替代候选：**持续输入期间，成功查询结果提交调用的实际间隔分布**。现有runner包装了每一次 `setSelection` 调用，即使等值选区没有发出notification也会记录。报告同时给出提交间隔p95、首/尾静默窗口纳入后的gap p95、最大静默、调用次数，以及真正发生变化的selection通知间隔。抬起后的最终提交另算，不混入实时样本。

建议候选判据为：同一固定轨迹下，包含首尾静默窗口的提交gap p95≤100ms，同时必须有实时提交，最大静默单独披露。**这是反馈频率判据，不能等价证明输入新鲜度，尚未替换规范、也未获接受**；`proposedAlternative.accepted=false`。若仍要求原始输入→查询完成SLA，下一步必须增加查询版本/开始/完成观测点，而非继续从通知猜测。

| 场景/版              | 正式轮 | 共同保留 | 提交次数 | gap p95 ms | 最大静默 ms |
| -------------------- | -----: | -------- | -------: | ---------: | ----------: |
| local/100/baseline   |      2 | 是       |      220 |      23.90 |      626.00 |
| local/100/optimized  |      2 | 是       |      397 |      35.50 |      182.60 |
| local/100/baseline   |      3 | 是       |      159 |      37.80 |      861.30 |
| local/100/optimized  |      3 | 是       |      392 |      37.00 |      160.70 |
| local/100/baseline   |      4 | 是       |      177 |      39.70 |      648.40 |
| local/100/optimized  |      4 | 是       |      402 |      37.90 |      142.40 |
| local/100/baseline   |      5 | 是       |      195 |      30.80 |      806.40 |
| local/100/optimized  |      5 | 是       |      430 |      35.70 |      112.90 |
| local/100/baseline   |      6 | 是       |      286 |      26.30 |      603.00 |
| local/100/optimized  |      6 | 是       |      486 |      17.20 |      111.10 |
| local/1000/baseline  |      2 | 是       |        8 |    2878.80 |     2878.80 |
| local/1000/optimized |      2 | 是       |      210 |      76.60 |      216.80 |
| local/1000/baseline  |      3 | 是       |        6 |    3361.40 |     3361.40 |
| local/1000/optimized |      3 | 是       |      260 |      49.10 |       68.80 |
| local/1000/baseline  |      4 | 是       |        6 |    7321.80 |     7321.80 |
| local/1000/optimized |      4 | 是       |      110 |     124.80 |      241.30 |
| dense/500/baseline   |      2 | 是       |       14 |    7926.90 |     7926.90 |
| dense/500/optimized  |      2 | 是       |      183 |      93.20 |      248.70 |
| dense/500/baseline   |      5 | 是       |       18 |    6465.40 |     6465.40 |
| dense/500/optimized  |      5 | 是       |      200 |      74.40 |      342.80 |
| dense/1000/baseline  |      2 | 是       |        8 |    9912.80 |     9912.80 |
| dense/1000/optimized |      2 | 是       |      118 |     153.90 |      932.30 |
| dense/1000/baseline  |      4 | 是       |        5 |   11475.00 |    11475.00 |
| dense/1000/optimized |      4 | 是       |      175 |     141.20 |      265.70 |
| dense/1000/baseline  |      5 | 是       |       10 |   10277.60 |    10277.60 |
| dense/1000/optimized |      5 | 是       |      139 |     131.60 |      466.30 |
| dense/1000/baseline  |      6 | 是       |        7 |   13651.00 |    13651.00 |
| dense/1000/optimized |      6 | 是       |       75 |     384.20 |      913.50 |
| mixed/500/baseline   |      5 | 是       |       11 |   16703.60 |    16703.60 |
| mixed/500/optimized  |      5 | 是       |      186 |      51.70 |      542.60 |

原始输出：`paired-v2/observability.json`，每条都带版本/场景/轮次、共同保留标记及原始JSON文件名；该候选指标在不完整共同样本的场景仅提供原始记录，不作前后验收判断。

另记录轨迹的“输入→预览发布”与“发布→后续rAF机会”两个阶段。当前预览本来就按rAF发布，而呈现代理又等待后续rAF，代理本身会增加一帧机会；这解释了测量口径的时序结构，但**不据此修改2T阈值**。仅已发布样本的阶段拆解不是替代SLA，原全输入指标仍保留未呈现样本，物理paint不可观测。

## 3. 旧尾部先定位，不把所有尾部归给边界

| 旧场景/笔数/轮 | 最终总 ms | up→提交 ms | 提交调用 ms | dispatch后→呈现代理 ms |
| -------------- | --------: | ---------: | ----------: | ---------------------: |
| local/500/r3   |    635.90 |     546.20 |       16.10 |                  73.10 |
| dense/1000/r4  |    417.20 |      14.20 |      130.10 |                 272.30 |
| local/500/r5   |    282.80 |     211.30 |        5.10 |                  65.80 |
| dense/500/r2   |    225.80 |       6.70 |       30.00 |                 182.60 |
| dense/1000/r2  |    214.70 |       1.90 |       69.90 |                 142.40 |
| local/1000/r5  |    206.50 |     128.90 |        3.90 |                  73.00 |
| mixed/500/r2   |    196.90 |     149.00 |        5.40 |                  42.10 |

这些是事件和调用的时间包络：up→setSelection包含路由、轨迹处理和最终求值，不能把整个包络都当成几何函数；setSelection含同步订阅者；dispatch之后的等待也不全等于paint。旧最慢r3没有该轮CPU profile，不能拿r6采样假装精确解释r3。

“约66ms”可定位到500笔/local/r6的 `sourcePreviewP95=66.43889759140075ms`（r2/r5分别65.97896436936571/65.64490798956467ms）。它测源生成时刻due→呈现代理，包含输入排队；同一r6的实际投递后preview p95为46.9ms，输入迟到p95为29.67ms，三个分位数不能相加减。它不是1000笔单次查询耗时。索引：`tails-v2/local-500-pair500-r6.json`及 `old-recomputed-summary.json`。

另一个旧Node辅助记录为63.609619ms，索引为 `tails-v2/old-query-benchmark-output.log` 中 local/1000/600点、候选143。那是Node几何辅助测量，不是UI/真机延迟，也不能与635.9ms直接视为同一种统计量。

密集1000的同类r6旧profile另有源级线索：`documentHasObject` self714.94ms，内部object回调91.577ms，controller inclusive838.559ms。`setSelectionInternal`对每个选择ID调用整文档 `.some()`，即使下一步发现选区相同，也先做所有成员验证。1000个对象全部命中时，精确比较次数是1+…+1000=500,500；不是只有边界计算要处理。

原始索引：`tails-v2/old-tail-timings.json`保存35个正式旧样本包络及旧压缩包内的原文件路径；本次附上35份正式旧原始JSON、dense/1000/r6的实际trace/profile和 `dense-1000-old-symbolicated-profile.json`，完整旧trace/profile仍在上一轮 `HAM-245-optimized.zip`。

## 4. 当前1000笔的原子工作量与实测范围

命令：`node scripts/perf/lasso-query-probe.mjs`。该独立minified浏览器harness校验其core/geometry/model/fixture源码与冻结优化版一致；不修改产品算法或调度。对0/100/500/1000及混合500/1000测量3/30/150/300/450/599/600点前缀。每组两轮预热、五轮正式，额外第八轮单独profile/trace与完整query oracle对照，profile轮不进入计时统计。

拆分项目：冷prepared几何（每cell首次）、每查询canonicalization/候选准备、每个对象step（budget=0，每次恰好推进一个候选）、候选/顶点数量、总对象step墙钟时间、无UI订阅者的实际setSelection调用。首个step也可能包含lasso点索引的惰性建立，不把它全归给某个对象本身。旁路Set成员验证只用于验证优化空间，不是已应用的产品实现或完整setSelection等价计时。所有墙钟以environment中的计时分辨率为准，0不代表零成本；逐step计时及记录循环有开销，故同时保留step时长之和与整个step循环墙钟，不把诊断harness当作未插桩的产品耗时。

| 场景/笔数/点数 | 候选/命中 | 查询 min / median / p95 ms | setup p95 | 最大原子step p95 | 等值setSelection p95 |
| -------------- | --------: | -------------------------: | --------: | ---------------: | -------------------: |
| dense/100/600  |   100/100 |         0.40 / 0.60 / 0.70 |      0.40 |             0.30 |                 0.30 |
| dense/1000/150 |    269/18 |    95.60 / 171.90 / 481.20 |      0.30 |            15.30 |                 2.90 |
| dense/1000/600 | 1000/1000 |        1.70 / 1.90 / 10.90 |      1.00 |             9.00 |                59.80 |
| dense/500/600  |   500/500 |         1.00 / 1.20 / 3.00 |      0.50 |             1.80 |                34.90 |
| local/0/600    |       0/0 |         0.30 / 0.30 / 0.70 |      0.70 |             0.00 |                 0.00 |
| local/100/600  |     26/14 |     34.10 / 92.70 / 123.00 |      0.70 |            19.90 |                 3.20 |
| local/1000/150 |     42/16 |       8.80 / 25.10 / 43.80 |      0.10 |             9.50 |                 0.50 |
| local/1000/600 |   143/116 |     48.30 / 61.20 / 125.40 |      0.80 |            18.10 |                 2.00 |
| local/500/600  |   143/116 |     30.80 / 85.20 / 147.50 |      0.70 |            14.20 |                 7.10 |
| mixed/1000/150 |    248/79 |     53.40 / 55.20 / 103.10 |      0.20 |             7.00 |                 3.00 |
| mixed/1000/600 |  1050/858 |   208.40 / 213.80 / 283.70 |      0.80 |             9.50 |                18.10 |
| mixed/500/600  |   550/435 |   128.00 / 144.10 / 241.10 |      0.40 |             9.20 |                14.80 |

完整oracle：9/9有序结果一致。

实际trace窗口内的额外r7采样（仅诊断，已排除oracle和结果提交；按绝对时间排序修正V8负timeDelta，窗口边缘归因受采样分辨率限制）：

| 场景/1000/600点 | work窗口 ms | withinLassoMargin self ms | 占窗口约比 |
| --------------- | ----------: | ------------------------: | ---------: |
| dense           |       1.222 |                     0.000 |       0.0% |
| local           |      59.763 |                    51.895 |      86.8% |
| mixed           |     333.040 |                   251.785 |      75.6% |

局部/混合的该窗口主要是边界判断，密集全命中可直接包含判定，不应将同一热点结论推广到所有轨迹。原始阶段采样见 `query-probe-v2/profile-phases.json`。

不可抢占原子step的具体长样本：

| 规模/场景/点数 | 最长step ms | 对象    | 原始记录                  |
| -------------- | ----------: | ------- | ------------------------- |
| 1000/dense/150 |       15.30 | ink-904 | `dense-1000-p150-r3.json` |
| 1000/dense/600 |        9.00 | ink-877 | `dense-1000-p600-r5.json` |
| 1000/local/150 |        9.50 | ink-288 | `local-1000-p150-r6.json` |
| 1000/local/600 |       18.10 | ink-411 | `local-1000-p600-r5.json` |
| 1000/mixed/150 |        7.00 | ink-798 | `mixed-1000-p150-r2.json` |
| 1000/mixed/600 |        9.50 | ink-4   | `mixed-1000-p600-r2.json` |

这些是墙钟时间，包含抢占/GC可能性；不能把最慢step断言为对象固有计算下限。冷prepared构建每cell只采一次（非分位数）：

- local/1000: 653.40ms；该完整600点查询的成员验证比较数 29078，旁路Set为 1116 次访问。
- dense/1000: 192.40ms；该完整600点查询的成员验证比较数 500500，旁路Set为 2000 次访问。
- mixed/1000: 105.10ms；该完整600点查询的成员验证比较数 468784，旁路Set为 1908 次访问。

冷prepared构建是首次建立几何和索引的成本，不是每次查询重做；上述查询计时从prepared已就绪开始。

关于“下限/上限”的严格边界：当前精确查询至少要读P个轨迹点并处理C个候选（完整命中还要输出K个ID），操作数下限为Ω(P+C+K)。边界成对检查在本实现的最坏量级可达O(P×候选顶点总数)，记录的pair upper bound是潜在边对数上界，不是实际执行次数。Set验证方案把成员检查从Σ(position+1)降为N+K，但尚未改产品。

最短实测只是本机观察值，**不是数学耗时下限、硬实时上限或架构不可兼得证明**；墙钟还含计时开销、抢占和GC。4ms预算只在对象之间检查，不能抢占setup、一个对象或结果提交。总查询耗时超过2T，不等于按帧发布的预览必然超过2T。当前仍存在可消除的二次扫描和可细分的原子工作，证据不足以认定“1000笔只能放宽阈值或降级”。

建议保持现阈值，先将文档成员检查线性化并核对边界/共享准备的不可抢占时段，再在目标设备按同协议复测；是否接受替代实时判据、是否继续此优化方向，交由评审确认。本轮没有降低阈值、没有切换1000笔降级策略、没有合入PR。

原始输出（相对于 `HAM-245-query-probe-v2.zip`）：`query-probe-v2/<scenario>-<count>-p<prefix>-r<round>.json`包含每对象index/time与对应ID/kind/geometry；`<scenario>-<count>.trace.json`、`.cpuprofile`保存额外诊断轮；`probe.js`、`probe.js.map`保存实际诊断构建与源码；`environment.json`记产品revision、source diff校验、hash、环境与命令。`probe-report.json`/`.csv`保留每种前缀的最短/中位数/p95/最大原子步骤，不能以最佳一轮替代全量分布。

## 验证与环境

环境沿用Ubuntu26.04 / Linux7.0.0-31-generic，i7-8700（6个可见CPU），Node24.15.0、pnpm10.28.2、Playwright1.59.1、Chromium147.0.7727.15。共享主机，未修改系统调度、CPU governor或阈值。无iPad/iOS WebView/实体笔；这轮不补作真机或跨引擎通过结论。

本轮query诊断runner提交：05e9abcce98fe0a682863f8459a5833ba11c7492；配对采集工具提交261139c；阶段分析修正及最终报告提交以 issue 回评所列 SHA 为准。

| 实际命令                                                                                                                              | 原始输出                             | 结果                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------- |
| `node scripts/perf/lasso-paired.mjs`                                                                                                  | `logs/paired-v2-output.log`          | 49组四元记录，196份原始记录                                       |
| `node scripts/perf/lasso-verify-paired.mjs`                                                                                           | `logs/paired-integrity-output.log`   | 输入/对象数/最终ID一致性/冻结产物hash检查通过，详见integrity.json |
| `node scripts/perf/lasso-paired-report.mjs`                                                                                           | `logs/paired-report-output.log`      | 完整矩阵统一统计，按共同mask保留                                  |
| `node scripts/perf/lasso-tail-report.mjs`                                                                                             | `logs/tail-report-output.log`        | 35份旧正式样本诊断索引                                            |
| `node scripts/perf/lasso-query-probe.mjs`                                                                                             | `logs/query-probe-v2-output.log`     | 63种前缀组合×8轮，9组完整oracle一致                               |
| `node scripts/perf/lasso-query-probe-report.mjs`                                                                                      | `logs/query-probe-report-output.log` | 63组各5轮正式计时，无剔除                                         |
| `node scripts/perf/lasso-probe-profile.mjs`                                                                                           | `logs/probe-profile-output.log`      | 18个实际query阶段采样窗口，排除后续oracle                         |
| `node --test scripts/perf/lasso-paired-result.test.mjs scripts/perf/lasso-observability.test.mjs scripts/perf/lasso-metrics.test.mjs` | `logs/v2-test-output.log`            | 15通过、0失败                                                     |
| `pnpm exec eslint scripts/perf/lasso-*.mjs scripts/perf/lasso-query-probe.ts`                                                         | `logs/v2-final-lint-output.log`      | 0 errors，0 warnings（React自动检测提示见stderr）                 |

本轮只改采集/分析工具与文档。上一轮产品检查72项Jest、18项Chromium、typecheck、lint和库构建的输出仍是历史证据，不描述为本轮重跑通过；WebKit及真机缺口保持公开。

本轮输出和分析不代替未运行的检查。OpenSpec保留性能/跨引擎/真机验收任务未完成；性能数值只在有效共同控制的完整场景中比较，不以其他场景的结果填补缺口。
