> 历史报告：独立剔除导致样本不对称，其中达标比例与改善判断已撤回，不用于验收。以 validation.md 的对称复测为准。

# 套索性能验证（HAM-245）

## 结论与提交

已实现优化并完成 Chromium 功能回归；性能和跨引擎验收仍有缺口，不宣称达到全部门槛。

- 基线产品代码：`81bff35d05f6e353e2d35601aa395667fb89d046`，优化前的 production export 固定在 `apps/playground/dist`。开始修改前已采集 0/100/500/1000 首轮；完整重复测量继续运行这个冻结的原版 bundle，未混入优化代码。
- 优化产品代码：`8f61622`，独立 export 到 `artifacts/research/lasso/optimized-export`。其后的改动仅为测试、统计纠错及报告，不改变被测产品代码。原版入口为 `entry-8f508cadb36a9dcbdcc5430c5d04216c.js`，优化入口为 `entry-4acf1d3c535f7ab5dbf6190eafaed49f.js`，附件保留对应 maps。
- 基线与优化版分别保留实际执行的 bundle/source map、环境、98 轮原始记录（包括 2 轮预热、5 轮正式测量）、最后一轮 14 份 CDP sampling profile 和 trace。最终 issue 附件提供原始数据；仓库不提交大型生成物。

## 根因证据与实现取舍

基线 `local-100-pair100-r6.cpuprofile` 总采样 18255.897ms：`queryObjectLasso` inclusive 13854.666ms（75.89%），其中 `pieceIntersectsLasso` 12098.453ms（66.27%）。历史 `DisplayLayer` 300.94ms（1.65%）、`PresentationCoordinator` 292.55ms（1.60%）、`layeredEditorController` 更新 57.57ms（0.32%），inclusive 项有重叠，不能相加。空画布对照 `local-0-pair100-r6` 总采样 7322.631ms，其中查询 3040.111ms（41.52%）、套索 canonicalization 3028.248ms（41.35%）。原始 profile 和 source-map 符号化结果在附件 `profiling.json`。

据此主要优化几何查询：复用 prepared 几何和文档 identity 对应 bounds BVH；对已证明简单的环跳过布尔 canonicalization，自交/接触等复杂环沿用原算法；相交谓词复用原边界容差并避免逐对象构造完整多边形交集。保留未优化的 `queryObjectLasso` 作为差分 oracle。没有文本/图层快照为主因的证据，因此不改该路径。

轨迹全样本保留，每显示帧最多发布一次，命中查询通过 MessageChannel 独立调度，按对象边界使用软 4ms 预算；同一时刻只推进一个查询，新路径积累后再查询，避免持续输入使查询饥饿。end 使用完整最终路径精确求值，session/document/path 防护避免取消后迟到写入。静态历史从 path preview 订阅中隔离，套索时跳过 SelectionOverlay 的无效同步。controller 原本已有等值 selection 去重，未为对齐方案重复修改。

优化版 `local-100-pair100-r6.cpuprofile` 总采样6755.138ms，分批 `step` inclusive689.145ms，其中 `withinLassoMargin` 539.620ms；历史路径更新扫描已归零，但边界计算仍为剩余查询热点。这是同矩阵的一轮采样证据，不消除环境差异，也不构成所有轮次通过结论。

软预算不包含不可拆的 setup 和单个对象；补充 Node 测量中 batch 最大 15.04ms，不能称为严格 4ms 上限。1000 笔局部 600 点的候选143/1000、总63.61ms；密集候选1000/1000、总8.25ms；混合候选550/550、总377.62ms。原始各批次在附件 `query-benchmark-output.log`，这是辅助几何测量，不作为 UI 帧率或实时选区 SLA 证据。

## 环境与测量口径

Ubuntu 26.04 / Linux 7.0.0-31-generic，Intel i7-8700 3.20GHz，6 个可见逻辑 CPU；Node v24.15.0，pnpm 10.28.2，Playwright 1.59.1，headless Chromium 147.0.7727.15。共享主机负载会波动，全部轮次保留；空画布控制不达标的组判环境无效。

固定 seed=245、1280×800、DPR=1。局部/密集为 0/100/500/1000 笔，混合为 0 与 500 笔+20文字+20形状+10图片，每笔64点。600 个轨迹样本按5秒绝对120Hz时间表生成，主线程繁忙时将全部到期样本通过 getCoalescedEvents 成批投递，不丢样本、不按 rAF 投递。记录 due 和实际投递 start/end，字体/图片预加载完成后开始；每组空/非空交替。

rAF 和下一帧机会是呈现代理，不能证明物理显示或真实 Apple Pencil 质量。未变化的选区不通知，因此 selection 通知延迟仅是代理，不能单独证明每次实时查询都在100ms内完成；报告将 `liveSelectionPass` 保持 null。

复核纠正了初版统计：旧 runner 的最后一次阻塞不能从 FPS 分母消失；统一使用 `drawingEnd-start`，同时统计首尾边界的掉帧，排除旧版在 up 后残留的一个 rAF callback。优化版额外记录 callback 的实际执行时间，但两版统一使用 rAF 时间戳计算帧间隔，避免因统计时钟不同引入对比偏差；不能将这种代理当作物理帧呈现。闭环最后一点可能与首点坐标相同，呈现前缀改由 DOM polyline 点数判定；未呈现样本记为无穷延迟，p95 不再只筛选已呈现样本。旧 `summary.json`/stdout 保留，正式比较使用共享 `lasso-metrics.mjs` 统一重算后的 `recomputed-summary.json`，5 项统计回归测试通过。

FPS=1000×观察帧间隔数/完整绘制时长。每个间隔 d（含边界）的 missing=max(0,round(d/T)-1)，掉帧率=missing/(observed+missing)。T 为该轮空闲前台页面的间隔中位数。相应空画布 FPS<0.9×1000/T 时该组环境无效。正式轮次逐轮值、失败项和有效性见 `comparison.json`，不挑最好一轮。

## 完整矩阵结果

下表为5轮正式测量的FPS中位数、最终延迟p95（5轮时为最大值）及有效空控制数量。仅描述本次共享主机测量，不能将无效组算作通过。逐轮FPS、掉帧率、轨迹/选区代理、输入迟到和begin/end均保留在附件JSON和CSV。

| 场景/笔数  | FPS 原版→优化 | 最终p95 ms 原版→优化 | 有效控制 原版/优化 |
| ---------- | ------------: | -------------------: | -----------------: |
| local/100  |  9.31 → 58.58 |      10520.2 → 113.6 |          0/5 / 5/5 |
| local/500  |  0.76 → 52.14 |      20009.6 → 635.9 |          2/5 / 4/5 |
| local/1000 |  0.27 → 56.93 |      16694.5 → 206.5 |          0/5 / 5/5 |
| dense/100  |  6.89 → 59.80 |        4779.7 → 35.3 |          3/5 / 5/5 |
| dense/500  |  1.34 → 53.55 |      29363.0 → 225.8 |          2/5 / 5/5 |
| dense/1000 |  0.28 → 48.23 |      35894.3 → 417.2 |          2/5 / 5/5 |
| mixed/500  |  0.19 → 59.92 |      64906.2 → 196.9 |          1/5 / 5/5 |

有效控制下，各指标通过轮数（逐轮判断，不能替代跨设备验收）：

- 原版：有效控制 10/35；framePass=0/10, previewPass=0/10, finalPass=0/10。实时选区每次完成时序未证明，liveSelectionPass=null。
- 优化：有效控制 34/35；framePass=21/34, previewPass=8/34, finalPass=11/34。实时选区每次完成时序未证明，liveSelectionPass=null。

优化版98轮路径期间历史遍历/注册扫描总计：0/0。所有轮次输入均为600个全样本（down+599），每笔64点，圈选未修改文档；数据完整性校验通过。

## 验证命令与原始输出

以下命令均在仓库根目录执行；完整 stdout/stderr 随 issue 附件交付。

```sh
# 同参数构建；基线先构建并冻结，优化版另存，避免覆盖基线。
pnpm run prepare:playground-artifacts
pnpm --filter @hamster-note/painting-playground exec expo export --platform web --source-maps
node scripts/perf/lasso-production.mjs baseline-coalesced
node scripts/perf/lasso-report.mjs artifacts/research/lasso/baseline-coalesced-chromium
pnpm run prepare:playground-artifacts
pnpm --filter @hamster-note/painting-playground exec expo export --platform web --source-maps --output-dir ../../artifacts/research/lasso/optimized-export
LASSO_EXPORT_ROOT=artifacts/research/lasso/optimized-export node scripts/perf/lasso-production.mjs optimized
node scripts/perf/lasso-report.mjs artifacts/research/lasso/optimized-chromium

pnpm exec jest --watchman=false --runInBand --selectProjects core-node legacy-web --testPathPattern 'layered-(lasso|tools|display-regression|semantic-adapter|native-contract|public-entry|presentation|freehand-regressions)'
node --test scripts/perf/lasso-metrics.test.mjs
LASSO_EXPORT_ROOT=artifacts/research/lasso/optimized-export pnpm exec playwright test tests/ui/lasso-performance-regression.spec.ts tests/ui/layered-editor.spec.ts tests/ui/page-integration.spec.ts --config=playwright.lasso.config.ts --project=chromium --grep 'lasso|mixed SVG|dot, pressure|page anchors|disabled text|read-only pages'
pnpm run typecheck
pnpm run lint
```

```text
Test Suites: 9 passed, 9 total
Tests:       72 passed, 72 total
18 passed (2.1m)   # Chromium UI
metrics: tests 5, pass 5, fail 0
typecheck: exit 0
lint: 32 problems (0 errors, 32 existing warnings), exit 0
prepare:playground-artifacts: exit 0 (painting + painting-board)
optimized production export: exit 0
```

Jest 因共享主机 Watchman/inotify 资源耗尽使用 `--watchman=false`，未改系统配置。几何差分覆盖固定种子随机轨迹、600点、边界、自交、退化环和变换的文字/图片/形状/笔画，并核对有序命中；调度回归覆盖 end-before-frame、取消、工具/文档切换及迟到回调。display 测试验证 path-only 历史 render/注册为零、DOM identity/order 不变。Chromium UI 覆盖鼠标/pen、实时轨迹与选区、取消恢复、混合对象变换/undo/redo、压力及半透明交接、页面坐标 DPR1/2/3 和只读/禁用文本接入。

WebKit：默认平台不支持 Ubuntu26.04；使用 `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 pnpm exec playwright install webkit` 下载成功，但 `webkit.launch()` exit1，报告缺少 libicu*.so.74、libxml2.so.2、libevent-2.1.so.7、libflite*、libavif.so.16、libmanette、libwoff2dec、libx264。未将不兼容平台浏览器的下载成功视为测试通过。未修改主机系统库。已增加 WebKit 白名单和 production config，受支持主机使用上面的 Playwright 命令替换为 `--project=webkit`；性能命令加 `LASSO_BROWSER=webkit`，基线仍用冻结的原版 export。

## 验收清单与后续验证

| 验收项                                   | 证据与状态                                                           |
| ---------------------------------------- | -------------------------------------------------------------------- |
| 修改前 0/100/500/1000 与混合基线         | 98轮记录、原版bundle/maps和14份trace/profile已保存；统计已纠错重算   |
| 热点依据与实现范围                       | 查询占75.89%，静态显示约1.65%；按证据优先几何/调度，未改文本图片快照 |
| 历史隔离、完整输入与选择语义             | Jest72项和Chromium18项通过，差分oracle与取消/最终路径回归见原始日志  |
| FPS≥空画布90%、掉帧增量≤5pp              | 逐轮结果见下附数据，存在无效控制和失败组，尚未验收                   |
| 轨迹p95≤2T                               | 全输入含未呈现样本统计，存在失败组，尚未验收                         |
| 实时选区p95≤100ms                        | 通知代理不足以覆盖不变结果；缺少每次查询版本的完整时序证据，未验收   |
| 最终选区p95≤100ms                        | 含抬起后呈现代理，逐轮原始数据见附件，未全部通过                     |
| WebKit、iPad Safari、iOS WebView、实体笔 | WebKit缺运行库；Linux无实体设备，均未验证                            |

在 iPad Safari 与 iOS WebView 分别运行同一 fixture：`/layered-editor?diagnostics=1&fixture=lasso&lassoCount=1000&lassoScenario=dense`，对照 lassoCount=0，另测 local、100/500及 mixed（500）。记录机型、iOS/浏览器或宿主版本、DPR、稳定刷新周期、触摸/实体笔方式、构建SHA和设备设置；使用 Safari Web Inspector Timeline 采集脚本、layout/paint/composite、GC及长任务，两轮预热、五轮记录。补充查询版本从输入到完成/显示的直接时序，核对实时反馈、抬起结果、取消恢复、选区移动/缩放/旋转和 undo/redo；逐轮满足门槛后再验收。

回退：产品优化集中在 `6bbd4f9` 与 `8f61622`，无存储格式迁移；需要回退时撤销这两次产品提交，保留 fixture、baseline 和报告用于对照。原版公共同步 query 始终保留，可继续用作 oracle。
