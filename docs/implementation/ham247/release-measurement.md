# HAM-247 第 2 条测量口径（2026-11-14 修订）

本次仅修改测量工具及文档，未改产品算法，未运行正式性能采集。

## 计时边界与原始字段

沿用 `scripts/perf/lasso-final-ui.mjs` 的生产静态页面、真实 CDP 鼠标输入、
600 点轨迹、6× CPU 降频和 trace。原脚本的主判据为松手到 Paint，现改为
**pointerup 事件时间戳 → 同一次最终 `selection-submit` 时刻**。

产品已有埋点，无须修改运行时代码：`layeredToolSession.ts` 在
`controller.setSelection(selected)` 返回后发出 `selection-submit`。这是控制器
完成选区/选框状态提交和同步通知的边界；DOM 提交与 Paint 是后续显示诊断。
不能用 query-complete 或等待选框 DOM 出现代替提交完成：空选区也会成功提交，
但不会生成选框 DOM。新版等待成功提交，因此 0 笔不再因缺少选框而超时。

每个原始 JSON 保留 events、marks、timeOrigin、档位、repeat、cold、rate，新增
`releaseTiming`：

| 字段                                                   | 含义                                                            |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| pointerupTimestamp                                     | 事件时间戳，必要时从 epoch 转到 performance.now 同一时基        |
| pointerupObservedAt                                    | 捕获监听器实际执行时刻，不能代替输入时刻                        |
| session / version / pointCount                         | 最终已接受输入的身份，精确匹配 start、complete、submit 三种标记 |
| queryStartedAt / queryCompletedAt                      | 对应最终查询边界                                                |
| submissionCompletedAt                                  | `setSelection` 返回后的标记时间                                 |
| releaseToSubmitMs                                      | 新主指标                                                        |
| releaseToQueryStartMs / queryMs / completionToSubmitMs | 相加等于主指标的三段耗时                                        |
| ok / reason                                            | 匹配是否有效；缺失、重复、失败、取消或时序错误不能记为成功      |

pointerup 的 adapter 会追加最后一个采样点，因此身份取完整记录中的最后一条
accepted input，不使用较早捕获监听器看到的旧前缀。旧 session/version/pointCount
的回调不能补全新输入。原始事件同时保留 rawTimestamp、pointerId 与 trusted。

## 档位、冷态与汇总

- 原默认档位 500/1000 改为 **0/100/500/1000**；原 local/dense 场景保留。
- 默认 5 次 repeat，每次每档创建新的 browser context/page，只画首个套索。
  `LASSO_ROUNDS` 默认从 3 改为 1；如显式增加轮数，热态保留在原始数据中，
  不进入冷态 p95。这里冷态指新页面的首次真实套索，不是清除 OS/浏览器磁盘缓存。
- 产品自己的空闲预热保留，成本和完成情况沿用原字段记录。显式关闭预热的
  诊断轮不进入验收汇总；没有人为等待预热完成后才发首个手势。
- **0/100/500：冷态 p95 ≤150ms**，最近秩算法；默认 5 个样本时为最大值。
- **1000：仅读数，无阈值，pass=null**，不沿用旧 400ms 判定。
- `release-summary.json` 按场景/档位列出预期和有效冷态样本数、缺失/无效数、
  p95、阈值与判定。缺失提交、污染主机和缺失档位留在分母，不以热态补位；
  完整有效样本未齐不能判通过。
- 同场景、同 repeat 的 1000−500 输出总延迟差及三段增量；同时保留准备、规范化、
  候选、精算、回退耗时差及精算对象数差。阶段耗时在查询耗时之内，回退又在精算
  之内，不能重复相加。未凑齐两档时明确 available=false。
- 原 DOM/Paint、预热、GC、长任务和拖动查询计数保留；长任务判据独立输出，
  不冒充本次第 2 条的延迟终点。正常采样阶段仍必须零查询、文档不变。

## 统一启动预检（后续补齐）

`scripts/perf/lasso-preflight.mjs` 统一三个测量入口的启动等待：

当前采样实现已进一步修订为 3 秒窗口、独立 before/after、首帧后有界 settle；
依据曲线、全部拒绝记录及两次正式尝试见 [采样修订记录](./sampling-2026-11-14.md)。

- `lasso-prefix-paired.mjs`：第 1 条逐前缀内核矩阵；第 3 条回退耗时插桩位于
  同一入口的 `round === 7`，共用启动预检。
- `lasso-final-ui.mjs`：第 2 条松手到最终提交测量。
- `lasso-clean-pair.mjs`：CPU/操作/分配配对测量。

首检立即执行，**每 60 秒预检一次、最多 20 次**；间隔从每次采样开始计算，
扣除采样和存档耗时。复用原 `sampleHost` / `hostVerdict`，load≤3 / idle≥50%
门限不变。每次尝试先落盘并打印，再决定通过或等待；第 20 次仍不满足时退出，
不再等待，也不启动浏览器/性能查询。连续拒绝共有 19 次等待，约 19 分钟加最后
一次采样和存档耗时。生产入口没有缩短预检次数或间隔的参数。

内核的所有预检记录保存在 `attempts.json`，CPU 配对入口保存在原结果文件的
`attempts` 数组；UI 新增 `host-preflight-attempts.json` 保存完整记录，同时保持
`host-preflight.json` 为最近一次主机读数。轮内前后负载检查和污染样本废弃不变；
后续正式窗口按新指令将内核入口改为首次污染即停。`LASSO_MAX_ATTEMPTS` 仍只
控制独立 CPU 配对工具的样本重试，该工具未用于本次第 1～3 条正式窗口。

`--verify-only` 是不作性能判定的功能模式，仍只记录一次负载；
`lasso-fallback-geometry.mjs` 是离线几何解释，不计时，均不进入启动等待。

短样例与原门禁测试：

```sh
node --test scripts/perf/lasso-preflight.test.mjs scripts/perf/lasso-host-gate.test.mjs
```

8/8 通过。样例用虚拟时钟、合成 load=4 / idle=80%（六核），经原门禁判定
连续拒绝 20 次；采样开始时刻为 0、60000、…、1140000ms，等待 19 次，返回
`eligible=false`。每次模拟采样 500ms、存档 25ms，所以各次请求等待 59475ms，
虚拟总时长 1140525ms。另覆盖第 3 次恢复、首检通过和采样/存档错误传播。
这只是等待控制流验证，没有实际等待 19 分钟，也不是性能数据。

## 下次采集

口径与预检对齐轮仅做功能验证。随后协调者开启了正式窗口；该轮在第一个
预热轮的轮前门禁失败后停止，见 [窗口记录](./quiet-window-2026-11-14.md)。
之后修正采样控制又做了两次尝试，均未通过 settle，已按上限停止。
后续测量条件由人选择；各入口会自行完成上述启动预检。

在同一冻结 production 构建上准备好 Xvfb/DISPLAY 后运行（**本轮未执行**）：

```sh
LASSO_COUNTS=0,100,500,1000 LASSO_REPEATS=5 LASSO_ROUNDS=1 \
  node scripts/perf/lasso-final-ui.mjs artifacts/research/ham247/release-cold
```

如需混合场景，原 `LASSO_SCENARIOS=local,dense,mixed` 参数继续有效；mixed 的
档位表示笔数，另有 50 个混合对象，以原始 objectCount 字段为准。

本轮已执行的验证：

```sh
node --test scripts/perf/lasso-release-timing.test.mjs scripts/perf/lasso-query-timing.test.mjs
node --check scripts/perf/lasso-final-ui.mjs
pnpm exec eslint scripts/perf/lasso-final-ui.mjs scripts/perf/lasso-release-timing.mjs scripts/perf/lasso-release-timing.test.mjs
```

12 项计时逻辑测试通过，覆盖空选区、末批身份、旧回调、缺失/取消/失败、冷/热
分离、150ms 边界、1000 无阈值和增量拆分。仅为人工构造事件数据的功能验证，
没有新性能读数，也没有新增浏览器端到端或真机通过声明。PR #57 保持草稿。
