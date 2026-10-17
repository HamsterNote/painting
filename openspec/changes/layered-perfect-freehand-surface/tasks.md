# Tasks

本清单已进入实施阶段。勾选项以 `docs/implementation/layered-perfect-freehand-surface/` 中的实际证据为准；规划 artifacts 完成不表示业务实现或真机验收完成。缺少实际证据的项目保持未完成。

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
- [ ] 3.3 实现 DisplayLayer 有序 SVG 树，freehand 单笔 filled path、shape/image/foreignObject text 任意混排；通过结构与 Chromium/WebKit 真实像素顺序测试及后续 Safari 观察验证 document order=paint order，新笔顶层及文字不会被统一提升成最上层。
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
- [ ] 5.5 接入 foreignObject HTML text 的真实 focus/input/keyboard/IME composition、完成/取消与工具路由；通过 composition 单元/UI 测试和后续设备观察验证文字编辑不被 Canvas 捕获遮挡、中间组合不提前提交、完成一次事务、取消不改内容，明确原生 overlay 不天然穿透。
- [ ] 5.6 保留 ruler、virtual paper 与 minimap 接入，以既有 ruler/导航 fixture 和集成测试验证其能力、显示/命中对齐与唯一 viewport 意图路由，没有因分层而缩水或形成第二变换真源。

## 6. Three-platform Web Integration and Skia Retirement

- [ ] 6.1 建立 Web/iOS/Android 三个可替换 DrawingLayer 平台入口，第一期均委托 Web 实现，保留 Expo DOM/WebView 承载整个 Web 编辑器；通过平台解析/构建 smoke 和设备启动验证无本期 native ink 或逐点 RN props bridge。
- [x] 6.2 写未来 native semantic adapter 契约与 mock 合约测试（批量 raw+commitId、pan/zoom intent、非笔轨迹、text focus/keyboard），不实现原生墨迹；验证 Web 唯一 viewport、无 native WebView transform 补偿、预测不持久化、mock ACK 不被称为真实 paint/桥性能验收。（本次：`layered-native-contract.test.ts` 3 tests PASS，纳入 `pnpm test` 85 suites / 1462 tests PASS；契约见 `native-semantic-contract.md`，命令见 `ham40-verification.md`。）
- [ ] 6.3 将 playground/board 示例迁至唯一分层入口，移除确认的 legacy V1/V2 运行路由与自由笔虚线 fallback；通过 UI 导航/公开入口检查验证所有保留能力可用且未新增 PNG/SVG 导出。
- [ ] 6.4 按已审核清单移除 Skia rendering/exports/peer/dev/app 依赖、专用 fixtures/test/scripts/setup/CONTEXT/doc，混合配置仅局部清理并保留 Expo/native 测试；验证活动代码/依赖/构建资源无 Skia 引用，剩余规划中退休说明属于预期文本，删除前后无关 dirty 改动一致。
- [ ] 6.5 在主编排再次核对未完成旧任务与备份后移除 `migrate-expo57-skia-surface` 未归档 change，不归档或标记完成；验证新 proposal 的 supersedes 记录保留、旧目录退出且无范围外文档误删。
- [ ] 6.6 用 pnpm 更新并审核锁文件，移除仅为 Skia 引入且无其他使用方的依赖/资源；运行 `pnpm install --frozen-lockfile` 验证可复现，保留非 Skia Expo/工具链内容。
- [ ] 6.7 在保留 5266 测试端口的前提下对齐 Expo Web 启动参数 `expo start --web --lan --no-open`，不换无关构建基础设施；启动服务验证 LAN 可访问且不自动开浏览器、Playwright webServer 配置仍可使用。

## 7. Integrated Verification and Delivery Evidence

- [ ] 7.1 实施时把新增 unit tests 放入被收集路径或显式接入测试工程，运行 `pnpm exec jest --listTests` 将每个新增测试文件与收集结果比对，再运行 `pnpm test` 保存实际执行报告；核实 web/core-node/native 覆盖、Skia 工程退出及 ruler/virtualpaper/minimap/IME/history/selection/erase 映射，不将未收集的 playground unit tests 当通过，不靠删除失败测试假通过。
- [ ] 7.2 运行 `pnpm run test:ui`（现有真实 Playwright Chromium、5266、prepare artifacts 流程），保留或替换 playground/ruler/virtualpaper/minimap/IME/history/selection/erase/touch regression 并添加分层 fixture；保存 PF dot/压力/半透明交接真实像素、混排、过程反馈、快速半径擦除、工具设置隔离及历史 render 计数证据，区分合成输入与真实硬件证据。
- [ ] 7.3 运行 `pnpm run typecheck`、`pnpm run lint`、受影响文件格式检查、`pnpm run build` 和 `pnpm run pack:dry`；验证两个发布包/Expo Web 产物无 Skia exports/运行时引用，记录失败原因而非泛化声称通过。
- [x] 7.4 使用当前 `pnpm --filter @hamster-note/painting-playground build:android` 以及实施时核对的 Expo iOS 导出入口（如 `pnpm --filter @hamster-note/painting-playground exec expo export --platform ios`）验证静态打包/依赖解析；保存记录并明确 Android/iOS `expo export` 不是原生构建运行、模拟器或真机证据，不能代替设备压感、文字键盘或 WebView physical paint 验收。（本次：上述 Android 与 iOS 命令均 exit 0，均实际生成 LayeredEditorDom www.bundle；`[evidence:compat-static][target:android|ios][executor:linux]`；见 `ham40-verification.md`。）
- [ ] 7.5 在 Web 实际 pen 设备、iOS 和 Android 真机执行单点/短笔/长笔、real/auto/simulated/constant、up=0、书写掌触/viewport、DOM 文字键盘、图像、选择/擦除和交接观察；保存设备/输入来源/录帧与问题清单，未获得设备则明确标为未验证且不勾选完成。
- [ ] 7.6 测量不同长度活动笔的 PF 全轮廓重算/Canvas replay CPU、内存和 rAF 耗时，以及大量历史对象的实际 render/reconcile 计数和 WebView 交接；依据实测设备建立并验证长笔预算，不继承旧折线 append/no-fullReplay 或 Skia frame budget 结论，交付方法/结果与超预算处理记录；仅保证非逐点历史 reconcile，future native bridge latency/physical paint 同步留后续验收。
- [ ] 7.7 更新中文 README/CHANGELOG/示例说明，记录 BREAKING、四压力模式/初始 preset、无 pen dash、三平台 Web 实现、剩余设备风险和 future native 边界；验证无旧 API/中心线保底迁移承诺或新增导出需求。
- [ ] 7.8 在实施阶段接入或提供独立 WebKit 测试运行配置，执行 foreignObject 与 shape/image/freehand interleave 的真实像素顺序、focus/IME/viewport 用例，并记录 Safari/iOS WebView 实际观察；验证 WebKit 运行证据独立于默认 Chromium 项目，自动化 WebKit 通过不冒充 Safari 真机验收，无法运行则保留未验证状态。
- [ ] 7.9 主编排完整审核 capability→实现→测试证据映射及用户决策保真，运行 `openspec validate layered-perfect-freehand-surface --strict` 并核对任务真实完成状态；交付删除清单、测试报告和未验证风险，不以规划 artifacts done 声称实现完成。
- [ ] 7.10 承接被取代 change 11.4：更新 CI 覆盖分层 Web 交付/打包、iOS/Android Expo 静态导出及 native 最小挂载，移除 CanvasKit 专用门；验证配置已提交并记录实际 CI 结果，静态导出不冒充设备运行。（覆盖关系见 `docs/implementation/layered-perfect-freehand-surface/skia-supersession.md`。）
