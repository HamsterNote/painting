# Tasks

本 change 按修勾 2026-10-18 的决定归档：**47/52 项完成，5 项设备验收本期范围外/延后、未验证**。勾选项以 `docs/implementation/layered-perfect-freehand-surface/` 中的实际证据为准；未验证设备项保留未勾选，归档不代表这些项目通过。

验收依据（HAM-40 评论）：

- `01a14cf3-db14-7479-a422-6067646395a7`，2026-10-18 03:00:12Z：修勾在原 macOS + Edge + 鼠标复验后确认「已经无法复现丢笔」，据此结案 8.1。已证实修复 capture 释放误取消 owner 的路径；未证明它是原设备唯一根因，保留诊断入口。
- `01a14d04-68e0-7cbf-bdd0-60f8f016c881`，2026-10-18 03:18:17Z：修勾确认设备验收「本期不做」、居中只管进入页面默认且窗口变化不管，并授权归档。缺少所需真机/真笔及设备观测，3.3/6.1/7.5/7.6/7.8 的设备部分延后，完整移交见 `manual-acceptance.md`。
- 归档后的验证与交付记录见 `docs/implementation/layered-perfect-freehand-surface/archive-verification.md`。以下各轮命令和计数均为历史证据，不覆盖此处最终状态。

## 1. Safety Baseline and Reuse Audit

- [x] 1.1 记录 tracked/untracked dirty tree 并建立可恢复备份或隔离工作区，按文件区分用户工作与 Skia 专用/混合内容；验证备份清单可恢复且无 blanket reset/clean。
- [x] 1.2 盘点 Skia 依赖、exports、实现、fixtures、测试、脚本、锁文件、CONTEXT/文档及旧 change，列 keep/remove/replace 清单；验证每个删除项均能说明 Skia 专用性，旧 change 仍记录未完成而非归档。
- [x] 1.3 审计 `core`、`input`、`utils`、`selectionResize.ts`、textEditSession 和现有 history/资源逻辑，标记可复用与替换边界；验证复用清单排除 Skia descriptors、frame budget 盲复制及私有平滑/插值持久化。
- [x] 1.4 在有保护的实施工作区记录现有 Jest/Playwright/typecheck/build 基线及前置失败，使用 `pnpm exec jest --listTests` 核对实际收集路径与四 projects；记录 `apps/playground/*.unit.test` 当前未被根测试收集的缺口，验证现有失败与新增回归分开，不将旧 Skia 测试通过等同新契约验收。

## 2. Raw Document and Shared Freehand Geometry

- [x] 2.1 实施时添加并锁定 perfect-freehand，核对选定版本类型和官方源码选项；验证依赖安装可复现且尚未引入额外渲染器或不必要平台包。
- [x] 2.2 建立 accepted raw sample、immutable brush snapshot、resolved mode、object transform/revisions 文档模型及 round-trip 测试；验证只保存真实样本/快照，不保存私有插值、预测、PF outline/strokePoints。
- [x] 2.3 实现 begin 时 auto 来源/能力解析及显式 real/simulated/constant 模式锁定；以恒 0.5 pen、正压力 mouse/touch、pressure unavailable adapter、显式 real/constant fixture 验证不通过 p>0 或变化率中途切模式。
- [x] 2.4 实现 raw-to-PF 只读派生视图和显式 preset（0.5 thinning/smoothing/streamline、identity easing、圆帽、taper 0、active last=false/final true），real 关闭模拟、simulated 开启、constant thinning=0；验证单点、短笔、零位移、release pressure=0 收尾及 timestamp 不影响模拟几何。
- [x] 2.5 建立共享 polygon-to-closed-path 转换供 Canvas/SVG 使用，不加自有平滑；验证相同样本/快照最终 commands 一致，正常点与收尾 raw pressure 未被写回修改，旧中心线不作为 fallback。
- [x] 2.6 实现 brush/samples/algorithm revision 几何缓存及 transform/bounds 呈现缓存失效；用文档替换、删除、undo/redo、样本/笔刷版本替换测试验证不复用 stale outline，变换不改写 raw samples 且缓存不进入保存数据。

## 3. Controller and Layer Composition

- [x] 3.1 抽离 headless EditorController，拥有文档、事务 history、工具设置、selection、会话与唯一 viewport；通过无 DOM 的单元测试验证绘制/取消/撤销重做，检查控制器不依赖 Canvas/SVG/Skia。
- [x] 3.2 拆出独立 Toolbar 与工具设置订阅，只提供自由笔颜色、标称宽度、不透明度、压力模式；用组件/UI 测试验证自由笔无 dash/算法滑块，shape dash 来回切换不丢失且不映射旧 pressureMultiplier。（本次验证：`pnpm exec jest --runInBand --testPathPattern 'layered-(toolbar|canvas|presentation)'`，3 suites / 7 tests PASS；详见 `docs/implementation/layered-perfect-freehand-surface/layers-and-handoff.md`。）
- [ ] 3.3 **[本期范围外/延后，设备部分未验证]** 实现 DisplayLayer 有序 SVG 树，freehand 单笔 filled path、shape/image/foreignObject text 任意混排；通过结构与 Chromium/WebKit 真实像素顺序测试及后续 Safari 观察验证 document order=paint order，新笔顶层及文字不会被统一提升成最上层。
- [x] 3.4 实现命令式 Web Canvas DrawingLayer 的 raw append buffer、rAF、DPR 与 viewport 对齐，活动及 pending final 可恢复重绘；用 append/resize/zoom 测试及历史层/对象 render 计数验证样本不逐点 React state/props 驱动历史 reconcile，历史节点身份稳定且不重复绘入活动 Canvas；明确 PF 活动 outline 可能全笔重算/replay，不承诺折线式纯增量绘制。（本次验证：同上 Jest 命令，3 suites / 7 tests PASS；`pnpm --filter @hamster-note/painting typecheck` exit 0；证据见 `layers-and-handoff.md`。）
- [x] 3.5 组装新的 DrawingSurface/board 入口与 controller 分层订阅；通过 playground 和 `packages/painting-board` 集成测试验证历史/输入/工具无第二状态真源。（本次：`pnpm test` 85 suites / 1462 tests PASS，含 LayeredPaintingBoard；Chromium 分层 4/4 PASS；见 `docs/implementation/layered-perfect-freehand-surface/ham40-verification.md`。）

## 4. Input Session and Commit Handoff

- [x] 4.1 实现 Web begin/update/end/cancel、pointer/source ownership、真实 coalesced 样本顺序与去重；用 adapter 单元测试验证预测不持久化、并发来源不接管、没有自造插值样本。
- [x] 4.2 实现 screen/world 坐标与落笔 viewport revision 快照，书写期冻结并丢弃竞争 pan/zoom/掌触；用非单位缩放、迟到 revision、第二触点测试验证不漂移且结束不补跳。
- [x] 4.3 实现 brush begin snapshot、工具切换取消、pointercancel/unmount/background 取消和迟到 end 拒绝；验证当前笔中途改色不变、取消无文档/undo entry，已提交笔不因后续 background 被撤销。
- [x] 4.4 实现 commitId raw batch→final geometry→幂等文档/history 事务及错误恢复；用重复提交、乱序 batch 测试验证仅一对象/undo entry，提交失败不静默丢笔。
- [x] 4.5 实现 pending presentation ownership、有序前缀交接队列、隐藏历史对象挂载确认和匹配 revision 的同步 Web 交接，禁止 setState 后直接 clear 或默认 crossfade；用人为延迟历史节点、重复/旧/乱序 ACK、连续两笔、切换工具追加对象、文档更新和撤销 pending commit 测试验证不逆转 paint order、不等待失效 revision、不清下一笔。（本次验证：同上 Jest 命令，3 suites / 7 tests PASS；证据见 `layers-and-handoff.md`；内部 ACK 不代表 physical paint。）
- [x] 4.6 添加 PF 单点 dot、短笔/压力宽度和半透明交接的真实浏览器 pixel/截图与帧录制 UI 用例，覆盖 active/final/history 收敛及延迟挂载；验证 dot 可见、压力模式像素宽度符合 fixture、无可观察空窗/双重变深，记录内部 render ACK 不证明浏览器 physical paint，更不证明未来跨桥 atomic paint。（本次：`pnpm test:ui tests/ui/layered-editor.spec.ts --workers=1 --trace=off` 最终 Chromium 5/5 PASS；25fps 录屏 123 帧，dot 出现后 104 帧中心像素无空白/双深；命令与观察边界见 `ham40-verification.md`。）
- [x] 4.7 保留可配置 mouse/touch/pen 输入策略，并为 shape/lasso/eraser/selection 提供过程语义 update/batch；用工具拖动过程测试验证不是 pen-only 全局禁用，也不是所有工具仅 up 或 lastPoint 反馈。（本次：`pnpm test` 85 suites / 1462 tests PASS；语义 adapter/工具过程测试及 Chromium 4/4 PASS；见 `ham40-verification.md`。）

## 5. Document Editing and Geometric Queries

- [x] 5.1 接入 line/rect/ellipse/polygon/bezier 与 image/text 创建编辑，不依赖旧中心线或 Skia 资源描述符；通过各类型 fixture 和 undo/redo 测试验证内容、文档顺序与取消事务。（本次：`pnpm test` 86 suites / 1467 tests PASS，形状各类型预览/取消/undo/redo、文字会话及图片异步取消/过期；`pnpm test:ui tests/ui/layered-editor.spec.ts --workers=1 --trace=off` Chromium 5/5 PASS，含实际文件解码、SVG 蓝色像素及图片 undo/redo；见 `ham40-verification.md`。）
- [x] 5.2 实现统一对象 transform 的 selection/lasso/move/resize/rotate 与 transient preview；用混合对象、多选、缩放旋转后命中、撤销重做测试验证原始 samples 未改写且渲染/几何 bounds 一致。（本次：`pnpm test` 85 suites / 1462 tests PASS；`layered-tools.test.ts` 覆盖三类变换、lasso、多选、raw identity、变换后 query 与 undo/redo；见 `ham40-verification.md`。）
- [x] 5.3 接入普通 SVG hover/click delegation 与 object id 解析，持续输入绕过 captured target 使用同一几何 query；通过 capture 后跨对象移动测试验证不会固定命中旧元素。（本次：`pnpm exec jest --runInBand --testPathPattern 'layered-(semantic-adapter|tools)'` 2 suites / 12 tests PASS，后续完整 Jest 85/1462 PASS；见 `ham40-verification.md`。）
- [x] 5.4 实现 previous-current+radius 扫掠、bbox 候选/按需索引与整对象擦除（首期自由笔允许中心线加宽近似），结束合并 undo 事务、取消恢复；验证端点均在对象外的快速跨越、半径擦边、遮挡对象、变换对象和语义 overlay mock 不漏擦，不伪造 DOM dispatch 获取命中。（本次：同上专项 2 suites / 12 tests PASS；完整 `pnpm test` 85/1462 PASS，含 native semantic mock；见 `ham40-verification.md`。）
- [x] 5.5 接入 foreignObject HTML text 的真实 focus/input/keyboard/IME composition、完成/取消与工具路由；通过 composition 单元/UI 测试验证文字编辑不被 Canvas 捕获遮挡、中间组合不提前提交、完成一次事务、取消不改内容，明确原生 overlay 不天然穿透。（本轮：`pnpm exec jest --runInBand --testPathPattern 'layered-navigation|layered-text-editor'` 2 suites / 5 tests PASS；`pnpm test:ui tests/ui/layered-editor.spec.ts --workers=1 --trace=off` Chromium 7/7 PASS，含真实 focus、composition、Escape 取消与 Ctrl+Enter 单事务。设备键盘/真实输入法观察另列 7.5 待人工验收，不以合成 composition 代替。）
- [x] 5.6 保留 ruler、virtual paper 与 minimap 接入，以既有 ruler/导航 fixture 和集成测试验证其能力、显示/命中对齐与唯一 viewport 意图路由，没有因分层而缩水或形成第二变换真源。（本轮：`pnpm test` 88 suites / 1472 tests PASS，含原 ruler gesture、geometry/ticks、viewport 数学与新增导航选项/固定双指/掌触/raw ruler round-trip/cache；`pnpm test:ui tests/ui/layered-editor.spec.ts --workers=1 --trace=off` Chromium 15/15 PASS，覆盖纸张/SVG transform 一致与实际小地图点击；保留逐项映射见 `navigation-verification.md`。）

## 6. Three-platform Web Integration and Skia Retirement

- [ ] 6.1 **[本期范围外/延后，设备部分未验证]** 建立 Web/iOS/Android 三个可替换 DrawingLayer 平台入口，第一期均委托 Web 实现，保留 Expo DOM/WebView 承载整个 Web 编辑器；通过平台解析/构建 smoke 和设备启动验证无本期 native ink 或逐点 RN props bridge。
- [x] 6.2 写未来 native semantic adapter 契约与 mock 合约测试（批量 raw+commitId、pan/zoom intent、非笔轨迹、text focus/keyboard），不实现原生墨迹；验证 Web 唯一 viewport、无 native WebView transform 补偿、预测不持久化、mock ACK 不被称为真实 paint/桥性能验收。（本次：`layered-native-contract.test.ts` 3 tests PASS，纳入 `pnpm test` 85 suites / 1462 tests PASS；契约见 `native-semantic-contract.md`，命令见 `ham40-verification.md`。）
- [x] 6.3 将 playground/board 示例迁至唯一分层入口，移除确认的 legacy V1/V2 运行路由与自由笔虚线 fallback；通过 UI 导航/公开入口检查验证所有保留能力可用且未新增 PNG/SVG 导出。（2026-10-18：根入口与 `/core` 切换 schema3，移除六条旧 app 路由及其候选/资源/Skia 示例实现；board、根 App 和 `/` 均进入分层编辑器。`pnpm typecheck` exit 0；`pnpm test` 93 suites / 1502 tests PASS；`pnpm test:ui tests/ui/layered-editor.spec.ts tests/ui/playground.spec.ts --workers=1 --trace=off` Chromium 21/21 PASS；迁移后的 `canvas-runtime.spec.ts` Chromium 2/2 PASS。公开别名/无旧 API/headless 闭包均有回归，无新增导出功能。Skia 包级源与依赖继续由 6.4 完整退出。）
- [x] 6.4 按已审核清单移除 Skia rendering/exports/peer/dev/app 依赖、专用 fixtures/test/scripts/setup/CONTEXT/doc，混合配置仅局部清理并保留 Expo/native 测试；验证活动代码/依赖/构建资源无 Skia 引用，剩余规划中退休说明属于预期文本，删除前后无关 dirty 改动一致。（2026-10-18：源/exports/依赖/CanvasKit WASM/专用字体/旧 runner 与兼容补丁退出；保留独立数学/provenance 工具及其原回归。`pnpm test` 82 suites / 1065 tests PASS，三 projects 含 native；`pnpm typecheck`、`pnpm build`、`pnpm pack:dry`、`pnpm verify:layered` 均 exit 0；完整 `pnpm test:ui --workers=1 --trace=off` Chromium 49/49 PASS；`pnpm lint` 0 errors / 32 warnings；纯 Node 辅助工具 55/55 PASS。删除与测试语义迁移见 `retirement-verification.md`。开始本批时工作树干净，无范围外改动。）
- [x] 6.5 在主编排再次核对未完成旧任务与备份后移除 `migrate-expo57-skia-surface` 未归档 change，不归档或标记完成；验证新 proposal 的 supersedes 记录保留、旧目录退出且无范围外文档误删。（2026-10-18：从已推 Git 历史复读八项未完成义务，逐项承接/明确不沿用旧 Skia 预算；完整 33 文件退出，未归档、未伪造完成。`openspec list --json` 仅当前 change；`openspec validate layered-perfect-freehand-surface --strict` exit 0。引用及可恢复提交核对见 `skia-supersession.md`。）
- [x] 6.6 用 pnpm 更新并审核锁文件，移除仅为 Skia 引入且无其他使用方的依赖/资源；运行 `pnpm install --frozen-lockfile` 验证可复现，保留非 Skia Expo/工具链内容。（2026-10-18：`git show 73431a4 --numstat -- pnpm-lock.yaml` 为 0 additions / 80 deletions，仅退出 Skia 及独占依赖，无版本升级；`pnpm install --frozen-lockfile` exit 0，resolution skipped / Already up to date；`pnpm verify:layered` exit 0，发布包与 Expo Web 构建不含退役入口或资源。资源删除明细见 `retirement-verification.md`。）
- [x] 6.7 在保留 5266 测试端口的前提下对齐 Expo Web 启动参数，不换无关构建基础设施；启动服务验证 LAN 可访问且不自动开浏览器、Playwright webServer 配置仍可使用。（Expo 57 不接受 `--no-open`，采用 CLI 官方支持的 `BROWSER=none` 等效方案，`scripts/start-web.mjs` 保留 `expo start --web --lan --port 5266`。本轮上述 Chromium 15/15 PASS，webServer 使用真实 `pnpm dev`，`default route ... responds over LAN` 实测本机非 loopback IPv4:5266 HTTP 200；无持久验证服务。此替代不覆盖设备可达性与防火墙外网路由。）

## 7. Integrated Verification and Delivery Evidence

- [x] 7.1 实施时把新增 unit tests 放入被收集路径或显式接入测试工程，运行 `pnpm exec jest --listTests` 将每个新增测试文件与收集结果比对，再运行 `pnpm test` 保存实际执行报告；核实 web/core-node/native 覆盖、Skia 工程退出及 ruler/virtualpaper/minimap/IME/history/selection/erase 映射，不将未收集的 playground unit tests 当通过，不靠删除失败测试假通过。（2026-10-18：7.10 配置修改后实际重跑 `pnpm exec jest --listTests --runInBand --json`，将 packages/tests/jest 下全部 82 个真实测试路径逐个比对：collected=82 / testFiles=82 / missing=[]；`pnpm test` 82 suites / 1065 tests PASS，三个 projects 含 Expo DOM host 最小挂载。测试迁移与专用断言退役理由见 `cutover-regression-map.md`、`retirement-verification.md`，不把退出的 Skia 工程或未收集实验记为通过。）
- [x] 7.2 运行 `pnpm run test:ui`（现有真实 Playwright Chromium、5266、prepare artifacts 流程），保留或替换 playground/ruler/virtualpaper/minimap/IME/history/selection/erase/touch regression 并添加分层 fixture；保存 PF dot/压力/半透明交接真实像素、混排、过程反馈、快速半径擦除、工具设置隔离及历史 render 计数证据，区分合成输入与真实硬件证据。（2026-10-18：`pnpm test:ui --workers=1 --trace=off` 完整 Chromium 49/49 PASS，实际由 Playwright 启动 prepare artifacts + 5266 Expo Web；覆盖默认入口/WASM 阻断、DPR1/2、dot/压力/半透明交接像素、混排与新笔覆盖文字、过程反馈/扫掠擦除、工具隔离、历史非逐点 reconcile 及全部保留 UI 文件。具体映射见 `capability-audit.md`；是真实浏览器像素、合成输入，不冒充硬件压感/系统 IME/physical paint 验收。）
- [x] 7.3 运行 `pnpm run typecheck`、`pnpm run lint`、受影响文件格式检查、`pnpm run build` 和 `pnpm run pack:dry`；验证两个发布包/Expo Web 产物无 Skia exports/运行时引用，记录失败原因而非泛化声称通过。（2026-10-18：格式整理后 `pnpm typecheck` exit 0；`pnpm lint` exit 0，0 errors / 32 warnings；265 个受影响手写源码/配置/文档 Prettier check PASS，生成锁文件/构建产物/原始备份不重排。`pnpm build` → `pnpm pack:dry` → `pnpm verify:layered` 串行均 exit 0，公开 exports 与两个包/Expo Web 无退役运行引用。两次并行检查的共享产物竞争及正确串行复跑结果均记录于 `final-verification.md`，没有隐藏前置失败。）
- [x] 7.4 使用当前 `pnpm --filter @hamster-note/painting-playground build:android` 以及实施时核对的 Expo iOS 导出入口（如 `pnpm --filter @hamster-note/painting-playground exec expo export --platform ios`）验证静态打包/依赖解析；保存记录并明确 Android/iOS `expo export` 不是原生构建运行、模拟器或真机证据，不能代替设备压感、文字键盘或 WebView physical paint 验收。（本次：上述 Android 与 iOS 命令均 exit 0，均实际生成 LayeredEditorDom www.bundle；`[evidence:compat-static][target:android|ios][executor:linux]`；见 `ham40-verification.md`。）
- [ ] 7.5 **[本期范围外/延后，设备部分未验证]** 在 Web 实际 pen 设备、iOS 和 Android 真机执行单点/短笔/长笔、real/auto/simulated/constant、up=0、书写掌触/viewport、DOM 文字键盘、图像、选择/擦除和交接观察；保存设备/输入来源/录帧与问题清单，未获得设备则明确标为未验证且不勾选完成。
- [ ] 7.6 **[本期范围外/延后，设备部分未验证]** 测量不同长度活动笔的 PF 全轮廓重算/Canvas replay CPU、内存和 rAF 耗时，以及大量历史对象的实际 render/reconcile 计数和 WebView 交接；依据实测设备建立并验证长笔预算，不继承旧折线 append/no-fullReplay 或 Skia frame budget 结论，交付方法/结果与超预算处理记录；仅保证非逐点历史 reconcile，future native bridge latency/physical paint 同步留后续验收。
- [x] 7.7 更新中文 README/CHANGELOG/示例说明，记录 BREAKING、四压力模式/初始 preset、无 pen dash、三平台 Web 实现、剩余设备风险和 future native 边界；验证无旧 API/中心线保底迁移承诺或新增导出需求。（2026-10-18：新增根 README、重写 board README 与 Unreleased 中文发布说明，示例为稳定 `createEditor()` + 必传 controller，链接实际 Expo DOM 宿主；逐项对照公开 exports、props、documentReader 与 pressure preset 源码。`pnpm exec prettier --check README.md packages/painting-board/README.md CHANGELOG.md .github/workflows/ci-pr.yml` exit 0；未把旧 API 当现行用法，也未承诺自动迁移或新增图片导出。）
- [ ] 7.8 **[本期范围外/延后，设备部分未验证]** 在实施阶段接入或提供独立 WebKit 测试运行配置，执行 foreignObject 与 shape/image/freehand interleave 的真实像素顺序、focus/IME/viewport 用例，并记录 Safari/iOS WebView 实际观察；验证 WebKit 运行证据独立于默认 Chromium 项目，自动化 WebKit 通过不冒充 Safari 真机验收，无法运行则保留未验证状态。
- [x] 7.9 主编排完整审核 capability→实现→测试证据映射及用户决策保真，运行 `openspec validate layered-perfect-freehand-surface --strict` 并核对任务真实完成状态；交付删除清单、测试报告和未验证风险，不以规划 artifacts done 声称实现完成。（2026-10-18：复读五份 spec 共 19 条 requirement，逐项映射见 `capability-audit.md`；完整删除明细及 82/1065 测试数量变化见 `retirement-verification.md`，旧 change 八项义务/33 文件退出见 `skia-supersession.md`。`openspec validate layered-perfect-freehand-surface --strict` exit 0；3.3/6.1/7.5/7.6/7.8 的设备部分明确保留原 checkbox，移入人工验收。最终 CI/命令记录继续按实测更新，不以 artifact done 充当设备通过。）
- [x] 7.10 承接被取代 change 11.4：更新 CI 覆盖分层 Web 交付/打包、iOS/Android Expo 静态导出及 native 最小挂载，移除 CanvasKit 专用门；验证配置已提交并记录实际 CI 结果，静态导出不冒充设备运行。（2026-10-18：`.github/workflows/ci-pr.yml` 固定 ubuntu-24.04 / Node 24.15.0，覆盖完整 Jest/native host、纯工具、strict、Chromium + 独立 WebKit、build/pack/无 Skia 产物检查、Android/iOS 静态导出。实际 `gh pr checks 24 --watch --interval 20` exit 0；`e9f4356` 的 [Test and Build](https://github.com/HamsterNote/painting/actions/runs/39053474621) 全步骤成功，用时 7m8s；CodeQL 三项也全部 PASS。没有 CanvasKit 专用门，未将静态导出描述为真机启动。覆盖关系见 `skia-supersession.md`；本记录后续仅证据文字提交会正常触发 CI 重跑，不冒称该新 SHA 已跑完。）

## 8. Acceptance Regression Fixes

- [x] 8.1 修复快速自由笔松手消失：任何速度的有效 pen up 均提交最终几何到历史，owner 的终止不被导航/尺子/捕获交接抢走；在真实分层入口用快/慢两档 pen 检查历史条目、最终可见性和 undo/redo，并记录实跑结果。（2026-10-18：修勾原 macOS + Edge + 鼠标复验「已经无法复现丢笔」，评论 `01a14cf3-db14-7479-a422-6067646395a7`，据此结案。浏览器真实释放 capture 的对照从 adapter cancel=1/历史=0 变为 commit=1/visible=1/历史=1，证明该路径修复，不等于证明原设备唯一根因；`?diagnostics=1&traceGestures=1` 保留。快慢笔及 capture 回归、取消不提交契约均保留，详见 `device-gesture-followup.md`。）
- [x] 8.2 恢复贝塞尔三阶段交互：按下拖动松手确定直线两端，随后两次点击分别确定两个控制点；中间仅预览，最后形成一个事务，取消不写历史；补真实入口手势序列回归并记录实跑结果。（`pnpm test:ui tests/ui/acceptance-feedback.spec.ts --workers=1 --trace=off` 7/7 PASS，含精确端点/控制点、单次 undo/redo 与取消；`pnpm test` 82/1065 PASS；见 `acceptance-feedback.md`。）
- [x] 8.3 恢复多边形逐点交互：每次点击追加一个顶点并连线，移动仅预览、双击闭合且不重复终点；完成前不写历史、完成后一次 undo/redo；补真实入口回归并记录实跑结果。（`pnpm test:ui tests/ui/acceptance-feedback.spec.ts --workers=1 --trace=off` 7/7 PASS，含拖动采样排除、带偏移双击、精确顶点/闭合 path 与取消；`pnpm test` 82/1065 PASS；见 `acceptance-feedback.md`。）
- [x] 8.4 修复小地图背景：虚拟纸张关闭时纯白背景且不绘制纸张矩形，开启时与主画布一致；通过真实入口切换工具栏并断言渲染树/像素，记录实跑结果。五项设备人工验收保持不动。（`pnpm test:ui tests/ui/acceptance-feedback.spec.ts --workers=1 --trace=off` 7/7 PASS，实际 toolbar 切换后主纸张/地图纸张均退出、背景 CSS 纯白；`pnpm typecheck` / `pnpm lint` exit 0，lint 0 errors / 32 warnings；见 `acceptance-feedback.md`。）

- [x] 8.5 增加设备可导出的手势诊断：仅 `?diagnostics=1&traceGestures=1` 开启，保留最近 2048 条有序记录及累计计数，包含 pointer identity、owner、coalesced 批次、拒绝/取消原因、commit 与呈现交接；在 HTTP LAN 上也能查看/复制/下载，不逐点触发 React render，补实际入口回归。（Chromium 诊断专项 5/5 PASS；相关 Jest 3 suites / 81 tests PASS；修复前 capture release 回归历史数为 0，修复后为 1。证据与设备限制见 `device-gesture-followup.md`。）
- [x] 8.6 虚拟纸张首次显示时默认横向居中，按纸宽与当前 zoom 计算唯一 viewport 的 tx，纵向位置不动；后续平移缩放、resize 和显示开关不重复初始化，保留显式 top-left/center 选项，补非单位 zoom、窄屏、主图与小地图坐标回归。（纸张专项 Chromium 27/27 PASS，含宽屏/窄屏和 zoom 四组入口用例；完整 Jest 82 suites / 1070 tests PASS；修复前新增三组单测均失败。见 `device-gesture-followup.md`。）
- [x] 8.7 区分捕获交接与真正取消：捕获释放后仍由同一 owner 的 window capture move/up 收尾，越界与子节点阻止冒泡不丢样本；pointercancel/失焦/卸载保持不提交，用浏览器真实捕获事件和 touch pan 正反对照留下 trace 证据。（Chromium 诊断专项 5/5 PASS；相关 Jest 3 suites / 81 tests PASS；修复前 capture release 回归历史数为 0，修复后为 1。证据与设备限制见 `device-gesture-followup.md`。）

## 本轮抢救与分批续做证据

- 2026-10-18 桌面追查轮：用户补充 macOS / Edge / 鼠标，8.1 重新打开等待原设备 trace；8.5/8.6/8.7 完成，当前 **46/52**，原五项人工验收不变。最终 `pnpm test` 82 suites / 1070 tests PASS；typecheck/lint（0 errors / 32 warnings）PASS；Chromium 65/65 PASS，独立 Ubuntu 24.04 Podman WebKit 63 PASS / 2 CDP-only skipped；串行 build/pack:dry/verify:layered、受影响文件格式、strict 均 PASS。捕获释放前后真实浏览器 trace、触摸正反对照、纸张 zoom/viewport 回归与诊断导出说明见 `device-gesture-followup.md`。正常推送 `96dd2e1`、`dba660b`、`d18cbb3`，无 rebase/force-push；尚不能断言原设备快速丢笔已修复。

- 2026-10-18 验收缺陷轮：8.1–8.4 已各自补入口回归、spec 契约与实跑证据；`pnpm test` 82 suites / 1065 tests PASS，`pnpm typecheck` exit 0，`pnpm lint` 0 errors / 32 warnings；全量 `pnpm test:ui --workers=1 --trace=off` Chromium 56/56 PASS，独立 `pnpm exec playwright test --config=playwright.webkit.config.ts --workers=1 --trace=off` 在 Ubuntu 24.04 Podman 中 WebKit 56/56 PASS；串行 `pnpm build` / `pnpm pack:dry` / `pnpm verify:layered` 均 exit 0，strict PASS。修复提交 `9751a57` 已普通推送；捕获转交复现及真实 pen 限制详见 `acceptance-feedback.md`。当前 44/49，原五项人工验收未改，5266 临时服务已停。

- 2026-10-18 首批 cutover：board 的公开组件与 playground App 调用方迁到分层入口；七份旧 UI 文件按保留行为迁移，补齐鼠标/双指缩放百分比浮层及过期 timer 归属。`pnpm exec jest --runInBand --testPathPattern 'layered-|painting-board/src/__tests__'` 24 suites / 343 tests PASS；七文件专项 `pnpm test:ui ... --workers=1 --trace=off` Chromium 17/17 PASS。完整命令和逐类迁移映射见 `cutover-regression-map.md`。尚未删除 Skia/旧目录，6.3 / 7.1 / 7.2 / 7.9 保持未完成。
- `1bc78e7` 抢救复验：`pnpm test` 89 suites / 1472 tests PASS；`pnpm typecheck` exit 0；十份分层 UI 文件的 Chromium 38/38 PASS；`pnpm exec playwright test --config=playwright.webkit.config.ts --workers=1 --trace=off` 在 Ubuntu 24.04 Podman + 宿主 HTTP 200 服务运行，WebKit 21/21 PASS。已普通推送 `13fa7e9`（含生成的 board 声明同步），未推本地 WIP。

## 本期范围外/延后的设备验收（均未验证）

第二批迁移验证：`pnpm test:ui tests/ui/editor-candidate.spec.ts tests/ui/editor-candidate-canvas2d-pen.spec.ts --workers=1 --trace=off` Chromium 9/9 PASS；独立 `pnpm exec playwright test --config=playwright.webkit.config.ts --workers=1 --trace=off` WebKit 47/47 PASS（十二份分层文件）。候选路由的保留行为已迁移，专用 Skia 诊断断言退出理由见 `cutover-regression-map.md`；实现目录尚未删除。

以下五项的设备验收转入 `docs/implementation/layered-perfect-freehand-surface/manual-acceptance.md`，保留原 checkbox 未勾选；不能把自动化或静态导出冒充任务全部完成。修勾于 2026-10-18 明确这些设备验收「本期不做」并授权归档；当前缺少所需真机/真笔证据，延后移交，不作为本期未完成开发或已验证项目。

- 3.3：有序 SVG/foreignObject 混排实现与 Chromium/WebKit 像素已通过；Safari/iOS WebView 的实际合成仍需真实设备观察。
- 6.1：三平台 DrawingLayer 均委托 Web，native Jest 的整个 Expo DOM host 最小挂载已通过；Android/iOS 静态导出已有证据，但没有真机启动证据。
- 7.5：真笔四压力模式、up=0、掌触、viewport 冻结、高刷新率交接，以及系统 IME/软键盘/焦点必须由真机/真笔执行，合成事件不具备证明力。
- 7.6：目标设备长笔 PF/Canvas CPU、内存、rAF、历史 reconcile 与 WebView 交接预算尚未建立。宿主合成输入/rAF 附件只作开发观测，方法与待填测量字段见人工清单。
- 7.8：独立 WebKit 自动化已实际通过，配置继续扩展迁移回归；Safari/iOS WebView 的系统输入法、焦点、键盘和 viewport 实测仍未完成。

- 抢救：失败树保存为仅本地 `agent/ham40-wip-failed-run` / `97ccfac`，功能分支恢复 `d78159a` 后复验。`pnpm test` 88 suites / 1472 tests PASS；`pnpm typecheck` 首次发现 board 缺少 `/layered` 源码路径映射，修正后完整 exit 0；Chromium 分层 15/15 PASS。可用提交及修复已普通推送至原 PR 分支 `7e74637`，WIP 不推。详见 `rescue-verification.md`。
- 3.3 / 7.8：新增真实鼠标覆盖已有 HTML 文字的 active/final 像素回归；独立 WebKit 配置修正 Chromium 专用参数继承。`pnpm exec playwright test --config=playwright.webkit.config.ts --workers=1 --trace=off` 在受支持的 Ubuntu 24.04 Podman 环境实际 WebKit 16/16 PASS；Chromium 同套件 16/16 PASS。宿主 Ubuntu 26 不受支持，用容器等效验证；不覆盖 Safari/iOS WebView 真机，因此这两项保持未完成。
- 5.6 回归修正：按 CONTEXT 以可视裁切段中点旋转、角度反馈投影到尺子中线，恢复尺子/纸张触点独立归属并发。`pnpm exec jest --runInBand --testPathPattern 'rulerGestureController|layered-navigation'` 2 suites / 10 tests PASS；`pnpm typecheck` exit 0。
- 6.3 / 7.1 / 7.2 分批迁移：原尺子控制器测试完整搬入 `input/web/__tests__`，旧 DrawingSurface 改为直接引用该实现；资源编辑 2 个与尺边 mouse/pen/touch 3 个 UI 回归改在新入口执行。`pnpm test:ui tests/ui/resource-editing-fixture.spec.ts --workers=1 --trace=off` 2/2 PASS；对应 `ruler-edge-inputs.spec.ts` 3/3 PASS。其他旧路由/调用方/测试尚待迁移，这三项不勾选，未提前退役旧目录。
- 待人工验收：Safari/iOS WebView 混排与焦点/中文 IME/软键盘；iOS/Android 真机启动；Web 实际 pen 四压力模式、up=0、掌触与高刷新率交接；目标设备长笔 CPU/内存/rAF/历史 reconcile 与 WebView 预算。3.3 / 6.1 / 7.5 / 7.6 / 7.8 相关设备部分未验证。完整边界见 `docs/implementation/layered-perfect-freehand-surface/webkit-verification.md`。
- 合并后实际复核：`pnpm test:ui tests/ui/layered-editor.spec.ts tests/ui/resource-editing-fixture.spec.ts tests/ui/ruler-edge-inputs.spec.ts --workers=1 --trace=off` Chromium 21/21 PASS；独立 WebKit 同三文件 21/21 PASS。`pnpm exec jest --listTests --runInBand --json` 收集 88 文件，包含 22 个分层测试文件及迁移后的尺子测试；`pnpm test` 88 suites / 1474 tests PASS。`pnpm lint` 首次 124 errors，修正五份新测试的条件断言后 exit 0（0 errors / 36 warnings），未禁用规则。`pnpm build`、`pnpm pack:dry` exit 0，但仍有待退役 Skia 资源，7.3 不勾选。Android/iOS 两个静态导出命令再次 exit 0（非真机证据）。`openspec validate layered-perfect-freehand-surface --strict` PASS。当前完整完成数仍为 30/45；本轮无未完成项被误勾。
