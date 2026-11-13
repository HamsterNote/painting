# HAM-245：松手选择与完整输入 trace

本轮完成“按下/拖动只记录并显示轨迹，松手一次查询”，保留现有几何、历史层隔离、成员检查和候选优化。**不能据此宣称 iPad 手感已改善或性能目标全部通过。** 6× Chromium 的实测仍有最终查询长停顿；共享机器的空白对照也不稳定。

## 测量结论先于代码修改

起点是 `main` 的 `5ee092524d49ef2be7e5a301b1cff29387517a3e`，包含已合入的 PR #52。使用同一 production 构建参数，先录 main 的输入/渲染 trace，再修改产品代码。历史组件在所有完成的圈选中 display/object render 增量均为 0，但这不意味着浏览器 Paint/Commit 为 0。

旧查询微基准不能解释完整交互；同时“真机没改善，所以瓶颈不在查询”也不成立。主线程采样中仍有显著几何成本，图层提交和绘制也占用时间。正式保留的同机诊断 `main-final/local-500-r1`（第二次手势）在按下至抬起的浏览器输入时间窗口内：

| 工作                                     | main 耗时证据                   | 松手选择版同场景 r1            |
| ---------------------------------------- | ------------------------------- | ------------------------------ |
| 几何/查询 CPU 采样（含其后代）           | 1276.4ms；7 次非 final 查询启动 | **0ms；0 次非 final 查询启动** |
| React CPU 采样（剩余未归入查询的调用栈） | 168.4ms                         | 219.8ms                        |
| 手势/session CPU 采样（剩余调用栈）      | 见 report.json                  | 见 report.json                 |
| 主线程 Paint 区间并集                    | 182.5ms                         | 383.0ms                        |
| 主线程 Commit 区间并集                   | 559.3ms                         | 1194.7ms                       |
| 历史 display/object render 增量          | 0 / 0                           | 0 / 0                          |

各行不是可以相加的互斥 CPU 账单：profile 是采样，timeline 是 wall-time 区间；FunctionCall/RunTask 等父子事件相互包含，报告按事件名称取区间并集。V8 `(program)` 等未归因部分保留在 `other JS/native/idle`，没有强行算给渲染。Paint/Commit 总量也受实际帧数影响，不能把新版总量增加直接解释为单帧退化。可确认的是：当前优化没有取消每次手势中的反复几何工作；移除它之后仍保留浏览器渲染成本，历史 React 重渲染不是这份 trace 的主要问题。真机根因的最终排序仍需 Safari Timeline。

## 输入与环境

- Ubuntu / Linux 7.0.0-31-generic，Intel i7-8700，Node 24.15.0，Chromium 147.0.7727.15，1280×900，DPR 1，CDP CPU throttle 6。
- 为访问 controller/render 诊断入口启用 `diagnostics=1`，页面底部输入诊断每250ms更新一次，其布局/渲染成本也在trace内；没有把这部分开销当作普通用户页面的必然成本。
- `headless:false`，本地 Xvfb 虚拟显示；完整 production 页面、SVG、React、paint、compositor 都运行。不是物理屏幕或人手，不模拟 Apple Pencil/iPad GPU。
- 使用已有 seed245 fixture：每笔64点，0/500笔，local/dense。载入确定性历史笔画；不把造500笔的时间纳入套索。
- 600 点/5秒由 Node 主机时钟经 `Input.dispatchMouseEvent` 投递，不等待 rAF，不用 `dispatchEvent` 伪造移动。保存实际浏览器事件及 `isTrusted`、coalesced 后输入版本/点数、DOM points 更新、帧时间、查询标记、截图、CPU profile 和 Chromium trace。
- 每场景保留两次手势，第一轮用于观察冷成本，第二轮用于观察后续成本；**这不是原规范的两轮预热＋五轮验收矩阵**。若首轮取消，第二轮仍可能是首次几何准备。

先做了一轮包含高频 performance.mark 的探索诊断，发现埋点本身有明显成本，随后改为内存记录、只保留 down/up trace mark。第二轮诊断与本地测试发生过时间重叠，不作正式比较。附件中的 `main-final` / `release-final` 是在本轮测试/构建结束后串行采集、同一轻量埋点的最终保留数据；没有基于结果补采择优。外部共享机器负载仍不可控制。

分析发现 surface 的 pointerup capture listener 可以晚于祖先输入适配器的最终查询，直接按该回调时间切窗会错误地把松手计算算进拖动。本报告统一按浏览器事件 `timeStamp`，由 trace mark 的 time origin 转换至 trace/profile 时钟；原始 callback time 仍保留以便复核。`selectedBeforeUp` 是旧 surface 观察字段，不用于结论。最后查询耗时由 final query-start→selection-submit 算；release→submit 由 pointerup.timeStamp→selection-submit 算，**不是物理呈现延迟**。

## 全部保留轮次

下表 FPS 是 rAF 代理，p95 是本轮帧间隔，不能当作输入→轨迹呈现 p95。数值用于暴露限制，不作设备性能承诺。

| 场景/轮        | main FPS / 帧间隔p95 ms | 新版 FPS / 帧间隔p95 ms | 有效性                                 |
| -------------- | ----------------------- | ----------------------- | -------------------------------------- |
| local 0 / r0   | 55.2 / 33.3             | 23.3 / 116.6            | 新版空白对照明显慢                     |
| local 0 / r1   | 53.6 / 33.3             | 55.2 / 33.3             | main 空白低于约60Hz的90%               |
| local 500 / r0 | 53.8 / 16.8             | 59.0 / 16.7             | **两版手势均取消，均无最终提交；无效** |
| local 500 / r1 | 15.0 / 133.3            | 52.6 / 33.4             | 手势完成，但对应空白对照不足以做验收   |
| dense 0 / r0   | 26.4 / 83.4             | 59.4 / 16.7             | main 空白明显慢                        |
| dense 0 / r1   | 22.6 / 100.0            | 10.2 / 316.7            | 两版空白都明显慢                       |
| dense 500 / r0 | 9.1 / 250.0             | 5.2 / 416.7             | 手势完成，但对照无效                   |
| dense 500 / r1 | 14.6 / 150.0            | 11.4 / 300.0            | 手势完成，但对照无效                   |

**没有完整有效的性能验收配对，不报告提速倍数/达标率。** local500/r0 的取消原因未完成归因；它发生在两版，不算作流畅手势。所有原始数据保留，取消轮由 `validGesture:false` 显式排除通过结论。

新版所有7次成功手势均无拖动查询、无实时 selection-submit，正常结束各有且仅有一次 final 查询。三个有效500笔 local/dense 轮次的有序最终ID与基线相同（local116个、dense500个），文档身份不变；取消轮无最终提交。新版 cold dense500/r0 最终查询431.9ms，下一次 dense500/r1 为46.1ms；local500/r1 为1042.3ms（r0取消，**这是首次最终几何准备**），release→submit1054.9ms。不能把这组数字当作同冷/热条件的退化倍数，更不能宣称100ms最终呈现目标通过。

## 实现与验证

产品改动仅 `packages/painting/src/core/layeredToolSession.ts`：

- 采样阶段取消 prepared 几何准备、实时 query work 和临时选择提交；轨迹保留完整样本，按现有 scheduler 合并显示。
- end 复用原同步完整查询，首次需要时准备几何，提交一次最终结果；删除不再需要的 in-flight/completed/evaluatedVersion 状态。
- 保留手势对象身份、document revision、destroyed 防护及 pathVersion/perfSession 诊断关联；取消帧/旧会话不能迟到覆盖。最终计算前后检查失效，覆盖 observer 重入取消、切工具、文档编辑和销毁。
- 既有查询实现、margin、P2兼容回退、历史显示隔离和成员检查未改，未安装新产品依赖。

验证输出随包交付：

| 检查                                                                                                                                                             | 结果                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec jest --runInBand --testPathPatterns='layered-(lasso\|tools\|display-regression)'`                                                                     | 本机 Jest29 没按该复数参数筛选，实际运行了**全部109套/1440项，通过**；不是只跑受影响测试                               |
| 随后新增“未显示末批输入改变最终命中集合”测试，`--selectProjects core-node --runTestsByPath ...layered-lasso-scheduling.test.ts`                                  | 该套16项通过；全量1440计数不包含后来这1项，不虚报已重跑全量                                                            |
| `pnpm exec playwright test --config=playwright.lasso.config.ts --project=chromium tests/ui/lasso-performance-regression.spec.ts tests/ui/layered-editor.spec.ts` | production Chromium **27项通过**；包括取消、末批输入、变换/undo/redo、历史/半透明交接和页面视口                        |
| 相同 UI 范围 `--project=webkit`                                                                                                                                  | **浏览器无法启动**：缺 libicu74、libxml2.so.2、libevent、libflite 等运行库；27项均在 launch 前失败，不计产品回归或通过 |
| `pnpm run typecheck`                                                                                                                                             | 通过                                                                                                                   |
| `pnpm run lint`，末次工具/新增测试 scoped eslint                                                                                                                 | 通过；全仓0错误、32条既有警告                                                                                          |
| `pnpm run build:lib`、`pnpm --filter @hamster-note/painting-playground exec expo export --platform web --source-maps`                                            | 两版均通过                                                                                                             |
| `openspec validate optimize-lasso-drawing-performance --strict`                                                                                                  | 通过                                                                                                                   |
| 新旧执行bundle的 source map 与对应工具会话源码逐字节核验                                                                                                         | 两版均一致，见 source-integrity.json；测量目录的 environment.sha 是 runner checkout，冻结站点以该核验为准              |

OpenSpec 已根据2026-11-13明确产品决定取消实时选区要求；原4.1/4.3/4.4保持未完成，不归档。Safari/iOS WebView、物理触摸/Pencil和真实手感仍待验。几何库调查见 `geometry-library-comparison.md`，没有做替换。

## 重跑与证据

生产构建后，在可用桌面 DISPLAY（本机使用临时Xvfb）运行：

```sh
LASSO_EXPORT_ROOT=path/to/frozen/main/site node scripts/perf/lasso-pointer-trace.mjs main-final
LASSO_EXPORT_ROOT=apps/playground/dist node scripts/perf/lasso-pointer-trace.mjs release-final
node scripts/perf/lasso-pointer-report.mjs artifacts/research/lasso-release/main-final
node scripts/perf/lasso-pointer-report.mjs artifacts/research/lasso-release/release-final
```

采集脚本自行启动/关闭静态服务器和浏览器；本轮所有临时X显示与采集进程均已回收，没有交付驻留服务。证据包包含这两版各8份原始记录、trace、cpuprofile、截图及实际bundle/maps，报告脚本、库探针/锁文件/许可证/metadata、完整验证日志、源码核验与SHA256清单。回退只需还原本轮工具会话变更；文档无需迁移，main上的此前优化可保留。
