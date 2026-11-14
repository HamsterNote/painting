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

## 下次采集

本轮按指令不启动正式测量或预检等待。安静窗口由已登记的唤醒轮进入：
**每 60 秒预检一次、最多 20 次**，load≤3 / idle≥50% 不变。通过后才启动以下
命令；入口原有开跑、页面前和手势后的负载检查仍保留。这里的连续等待是下一
测量轮的操作要求，本次没有改第 1 条内核 runner 的预检循环。

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
