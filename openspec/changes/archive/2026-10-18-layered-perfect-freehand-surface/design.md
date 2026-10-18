# Design

## Context

动机见 `proposal.md`。现有 `packages/painting/src/components/DrawingSurface.tsx` 约 4100 行，合并输入、活动笔迹、历史与编辑状态；`render/StrokeRenderer.tsx` 自由笔按线段渲染，文字使用 foreignObject/textarea，`render/ImageRenderer.tsx` 使用 SVG image。`utils`、`selectionResize.ts`、`core` 和 `input` 已有或包含未提交的几何/会话实现，必须逐项审计，不能因为文件存在或旧 Skia 测试通过就视为本设计验收。

根 workspace 提供 Jest、Playwright、lint/typecheck/build；playground 已使用 Expo 57，原生承载保留。当前未完成的 `migrate-expo57-skia-surface` 被本方案取代，而不是既有 capability；`openspec list --specs` 返回空。本轮仅写规划，不修改 package、业务代码或旧 change。

验证 lane 已确认根 Jest 当前有四个 projects，Web project roots 限于 packages 且忽略 apps，因此 `apps/playground/*.unit.test` 当前不被根 `pnpm test` 收集。新增测试必须放入被收集的路径或在实施时显式接入测试工程，使用 `pnpm exec jest --listTests` 证明收集并留下实际执行报告。现有 Playwright 只运行 Chromium/5266；foreignObject 叠放不能仅凭该配置声称 Safari/WebKit 通过。Expo Android/iOS export 仅为静态导出证据，不等于原生运行或真机验收。

## Goals / Non-Goals

**Goals:**

- 用一个 headless 文档/交互真源和可替换平台入口组织渲染，活动更新与历史订阅隔离。
- 用原始样本 + 不可变笔刷快照重建自由笔，Canvas/SVG 共享几何，持久文档不依赖渲染器缓存。
- 将坐标、输入所有权、取消、提交/呈现交接、文字焦点和连续几何查询变成可测试契约。
- 为三平台共同 Web 实现建立基线；未来原生输入替换不改变文档与最终几何模型。

**Non-Goals:**

- 本期不实现 native ink、逐点 bridge handwriting、原生 PF 移植或双 viewport 补偿。
- 不保留旧中心线、自由笔虚线、legacy V1/V2、旧 API/文档的兼容迁移路径；不添加 PNG/SVG 导出。
- 不构建通用 tile cache，不照搬 Skia descriptors、frame budget 或绝对“同帧跨进程 paint”承诺。
- 不取消所有 mouse/touch 绘图；pen-only 只是可能的输入配置而非全平台强制规则。

## Decisions

### 1. Headless controller and independently subscribed layers

组合根负责实例化 EditorController、独立 Toolbar、DrawingLayer、DisplayLayer。控制器拥有有序文档、undo/redo 事务、工具与各工具设置、selection、输入会话、唯一 viewport/revision；不直接操作 DOM/Canvas。DisplayLayer 订阅文档及显示相关状态，DrawingLayer 接收 viewport/revision 和会话命令，Toolbar 订阅工具设置并发出意图。文字编辑器/选框可位于 DisplayLayer 的交互子层，但状态机仍归控制器/独立会话模块。

活动样本 append 到 adapter/session buffer，按需调度一次 rAF 命令式重绘；不逐点调用 React state/props 或触发全历史 reconciliation。React 只处理开始/结束、文档事务和必要工具 UI 状态。连续非自由笔工具同样提交语义 update/batch，让形状预览、套索和擦除有过程反馈，不能把所有工具都改成 up-only。

append 是原始样本 buffer 的输入方式，不表示 PF outline 可增量追加：每次活动重绘可能重算整笔轮廓并 replay 当前活动路径，不能沿用旧折线 append 实现的“不 fullReplay”承诺。确定保证仅为历史不逐点 reconcile；长笔 PF CPU/内存和活动绘制耗时需要单独测量并建立当前平台预算。render 计数须通过历史层/对象 instrumentation 证明，稳定 DOM 身份或截图不是零 reconcile 的充分证据。

替代方案：继续在 DrawingSurface 中拆几段 JSX 不能真正隔离真源；将控制器全部塞进 DisplayLayer 会使原生替换和测试仍耦合。复用现有 `core/editorController*`、`core/textEditSession.ts`、`input` 前，先确认其不依赖 Skia descriptors/遗留平滑。

### 2. Raw document model and ordered object transforms

文档是有稳定 objectId 的有序对象数组/树，freehand、shape、image、text 共用对象变换和顺序。自由笔保存：

```ts
// 仅为实施契约草图，不表示本轮新增了业务类型。
type FreehandRecord = {
  id: string;
  commitId: string;
  samples: AcceptedRawSample[]; // 世界坐标；含原始 pressure/time/phase/source
  brushSnapshot: BrushSnapshot; // color / nominalSize / opacity / pressureMode / 几何 preset 版本
  resolvedPressureMode: 'real' | 'simulated' | 'constant';
  samplesRevision: number;
  brushRevision: number;
  transform: ObjectTransform;
  transformRevision: number;
};
```

落笔快照对当前笔不可变。后续若支持编辑笔刷，替换对象的笔刷快照并增加 brushRevision，而不是改变活动笔；undo/redo 保留对应不可变版本。持久样本是实际接受点转换后的世界坐标；screen 坐标、预测点、私有插值点、PF strokePoints/outline 不作为持久事实。真实 coalesced events 保持时间顺序，避免主 event 与 coalesced 同一个样本重复追加；不通过距离阈值自造或重采样点。无效输入拒绝原因需可测，不“补点”掩盖。

移动/缩放/旋转统一修改对象 transform，不改写自由笔原始 samples；自由笔局部坐标轮廓与整个 SVG/Canvas 对象一起变换，笔宽也随对象缩放。viewport 是独立 world-to-screen 变换。命中将轨迹/半径映射到对象局部坐标（非等比缩放使用保守距离边界再细判），世界 bounds 由 transformRevision 失效。如此可保持原始输入审计与撤销一致。

替代方案：烘焙变换进 samples 会破坏“原始输入”语义，重复编辑易累积误差；保留旧 V1/V2 与插值中心线转换增加维护负担，未上线无需采用。

### 3. Shared perfect-freehand geometry with explicit options

perfect-freehand 是纯几何库，无需 Skia。共享几何模块接受 raw samples 的只读派生视图、brush snapshot 和 active/final 状态，生成 polygon；共享转换器把 polygon 转为闭合 path commands，Canvas Path2D 与 SVG `d` 使用同一命令序列。首期使用直接闭合轮廓转换，不再给轮廓加自有平滑或中心线算法；若调整 path 表达必须两端共同验证，不能 Canvas/SVG 各自拟合。

不依赖库默认值，初始 preset 显式设置：`size = nominalSize`、`thinning = 0.5`、`smoothing = 0.5`、`streamline = 0.5`、`easing = t => t`、`start/end.cap = true`、`start/end.taper = 0`，活动 `last = false`，最终 `last = true`。constant 显式 `thinning = 0`、taper 为 0；real `simulatePressure = false`，simulated `simulatePressure = true`，constant 也显式关闭模拟。PF 的 thinning/smoothing/streamline 是内部 preset，不上初期工具栏；旧 pressureMultiplier 不盲目映射 thinning。这是待真机调参的初始值，不保证最佳手感。版本选择在实施时核对官方文档/类型与锁定源行为，README 对 last 的差异不改变显式传参决定。

auto 在 begin 使用来源与 capability 解析：Web pen 走报告压力，mouse/touch 走 simulated，未来 native adapter 明确 pressure unavailable 才在 auto 走 simulated。不能从 `p > 0`、恒 0.5 或变化率推断能力。显式 real 保持真实输入，即使设备能力不可用也不偷偷模拟；缺失压力的派生输入用固定中性值 0.5，原始缺失字段仍保留，不写回。超出合法范围的 pressure 仅在几何视图中归一化到 [0,1]。模式全笔锁定。

up 阶段的零压力真实保存；PF 派生视图在 release 收尾点使用最后有效接触压力（没有接触值时使用中性 0.5），不把正常零压力接触点一律改写、不按点换模拟模式。simulated 的压感根据距离而非真实 timestamp 速度；不同浏览器采样密度仍可能影响手感，需要真机验证。单点、短笔、零位移、真实 up=0、active/final 收敛都建 fixture。

几何 cache key 为 objectId + samplesRevision + brushRevision + 几何 preset/算法 revision + active/final；含刷色/opacity 的呈现缓存也依赖 brushRevision。对象 transform 不重算局部 PF outline，但使 transformed bounds/命中/呈现失效；文档替换、删除、undo/redo 清理或按版本更新索引与缓存。缓存从不进入保存数据。

替代方案：逐段 SVG line 与 Canvas 自有插值不能统一压感轮廓；持久化 outline 会导致刷子编辑、库更新和原始样本失真。基于真实时间自行模拟压感与 PF 行为不同，首期不额外引入。

### 4. Canvas active overlay and ordered SVG history

DisplayLayer 使用一个有序 SVG 对象树，每个 freehand 为一个 filled path；shape path、SVG image、foreignObject HTML text 按数组顺序任意交错，不能将全部文字额外提升为最上层。文字编辑 textarea/HTML 节点保持真实 DOM focus/input/keyboard；编辑态装饰可以单独交互层显示，但完成文字对象回到文档顺序。新笔追加顶层，活动 Canvas 位于历史之上，与提交后的顺序一致，不支持直接在文字下书写。

DrawingLayer 的 Canvas 根据 DPR 管理 backing store，只承担当前自由笔与等待交接的最终笔迹，按 Web viewport 和对象变换绘制；历史不重复 rasterize 到它。Canvas 清理/resize 要保留重绘所需的活动与待交接内存；rAF 合并绘制允许，不合并/插值持久 raw input。DisplayLayer 的交互层与活动 Canvas 按工具配置 pointer-events，非笔工具走统一 input adapter，不靠 overlay 天然穿透保证文字点击。

替代方案：历史全部 Canvas 失去直接 DOM 文字与对象事件；按类型分多 SVG 层破坏任意 interleave；每点 React 更新与全历史重绘不适合该职责分离。

### 5. Commit coordinator and single presentation ownership

生命周期为 `collecting → finalizing → awaiting-history-render → presented`，取消只用于尚未提交 collecting；正常 end 冻结 raw batch，生成 final PF，控制器用 commitId 幂等提交一次文档/undo 事务。提交错误保持可恢复状态，不悄悄丢笔。控制器记录 commitId 与文档 revision；不同会话 pending commits 可共存，不能一个全局“清 Canvas”清掉下一笔。

显示侧维护非持久 presentation ownership：pending commit 由 Canvas 展示最终几何；SVG 已挂载相应历史对象但先隐藏该对象，避免半透明两份同时画。历史渲染确认至少包含 objectId/commitId、document revision、geometry revision，并检查匹配 path 已写入真实 SVG 节点；不是 setState 返回、仅 props 抵达或 rAF 次数 ACK。

匹配确认后，协调器在同一 Web JS 交接任务将该历史节点从隐藏变为可见，并从 Canvas presentation 集合移除该 commit/repaint，保留其他 pending 与当前 stroke。两侧变更尽可能在浏览器 paint 前同步完成，默认不 crossfade。过期 revision、重复 ACK、已删除/撤销对象 ACK 和另一会话 ACK 不可清当前活动内容。卸载后释放 presentation 资源但不回滚已成功提交文档；重挂按文档重建。撤销 pending commit 同时撤销文档和它的 presentation entry。

pending 自由笔按文档顺序保存在呈现队列，交接只推进已就绪的有序前缀；后提交笔的 ACK 不能越过旧 pending 笔先显示在底层 SVG，否则旧 Canvas 笔会错误盖住新笔。当前笔始终绘在 pending 队列之后。切到会追加顶层对象或变换/删除 pending 对象的其他工具时，先协调已有呈现交接，必要时由统一交接任务直接确认这些已就绪历史节点；不能直接插入一个新 SVG 顶层对象后仍留下更旧 Canvas 在其上。文档修订变化使对应 ACK token 重发/失效，并从当前文档重建队列，避免固定等待旧 document revision 而永久卡住。

这里“render acknowledgement”是节点和几何就绪的内部保证，不是物理像素已经显示。Canvas/SVG 合成、后台 tab、WebView 跨进程调度不能直接保证绝对同帧 atomic paint。测试用延迟挂载、半透明 pixel 检查、帧录制和真实设备观察确认无可见空白/双影；若发现问题必须调整 Web 内部呈现交接，不把 props ACK 当证明。未来 native ink 的 clear 同样只能在真实 paint 同步与桥延迟验收后确定，首期不交付这项能力。

替代方案：end 后立刻 clear 会有空窗，history 先显示再留 Canvas 会半透明变深；默认 crossfade 不等于正确所有权。等待固定两帧也不能证明物理 paint，不能替代版本匹配和验收。

### 6. Input session, authoritative viewport and future native boundary

adapter 归一化 begin/update/end/cancel，标注 source、pointerId、phase、pressure capability、screen/world space、viewportRevision、sequence/sessionId。Web 所有 screen 样本按捕获的 viewport revision 反变换为世界点；会话开始前 controller 原子读取最新已接受 viewport，书写期冻结并丢弃竞争 pan/zoom/掌触意图，结束不补应用。旧 revision 输入/意图不能重新定位当前笔。pointer capture 用于保证会话连续，捕获目标不是当前 hover 对象。

brush 设置变化只更新下一笔快照；切换工具取消当前未提交会话。pointercancel、unmount、background 释放捕获并丢弃当前未提交 raw buffer；迟到 update/end、不同 pointer/source 无法接管。pointerup 后已成功提交的笔不因 later background 被撤销。输入策略保留可配置 mouse/touch/pen 路由，touch 书写允许时与触摸 pan 明确互斥，掌触/第二接触点不接管书写。

Web、iOS、Android 三个 DrawingLayer 入口首期都委托同一 Web DrawingLayer；iOS/Android 通过 Expo DOM/WebView 承载整个 Web controller/display/input，不通过 React Native props 桥逐点转发。未来替换入口可以使用 native 近似墨迹/预测预览，但最终 end 批量提交接受的 raw samples + brush + locked viewport revision + commitId；Web PF 生成 final，不移植 PF。未来 pan/zoom 仅传 semantic intent 由 Web 更新 viewport，禁止 native transform WebView 后补偿。

非自由笔工具的未来 adapter 发送 begin/update/end/cancel 或合理语义轨迹 batch，擦除和套索保留完整路径，不能只传 lastPoint。输入 overlay 命中调用同一 controller query，不 dispatch 假 DOM pointer event 来获取 browser hit。文字需显式 enter/exit/focus/keyboard ownership 接口，native overlay 按工具退出捕获或路由焦点；真实桥性能、native clear ACK 与焦点同步后续单独验收。

### 7. Geometry-driven interactions and isolated styles

普通 Web hover/click 可以使用 SVG event delegation 和 `closest` 的 object/stroke id，保留真实 DOM 点选体验。pointer capture、连续工具和未来 overlay 必须用同一平台无关 query。橡皮擦以 `previous → current` 的扫掠 capsule（半径含工具半径）查询 bbox 候选/可选空间索引，再按对象几何细判，删除整对象。不能只检查当前点、DOM mouseover 或最上层 target，几何被遮挡不让 sweep 查询失效。

自由笔首期允许 raw centerline 加 nominal width/保守 bounds 的近似细判，确保明确的半径与快速跨越用例，不强制 full-outline Boolean；压感、非等比变换边界的近似误差记录为风险，用 fixtures 固定预期。shape 用现有几何，image/text 使用变换后的 bounds/对象几何。持续擦除可先显示被命中对象预览，end 合并为一次 undo 事务，cancel 恢复；套索和选择变换也使用可取消 transient 状态。

形状列表保留 line/rect/ellipse/polygon/bezier，图片资源与 DOM text 编辑不能因重构缩水；selection move/resize/rotate 与 object transform 统一。笔刷设置与 shape dash 独立，pen 不显示/执行 dash，切回 shape 不丢旧配置；工具栏不暴露 PF 算法滑块。

现有 ruler、virtual paper、minimap 属保留能力，不新增功能或移除既有导航辅助；它们的 viewport 意图仍由唯一 Web controller 处理。文字 composition/IME 过程不得被提前当成已完成编辑事务，需覆盖 compositionstart/update/end 与取消/焦点行为。保留测试映射必须包括 ruler/virtualpaper/minimap/IME/history/selection/erase。混排 foreignObject 在 Chromium 与 WebKit 做真实像素顺序验证，并在 Safari/iOS WebView 记录实际结果；PF dot、压力宽度和半透明交接也要像素证据，不只验证 path 存在。

## Risks / Trade-offs

- [WebView/Canvas/SVG physical paint 无直接原子保证] → 内部版本匹配与单一呈现所有权；延迟交接/pixel/录帧测试加真实设备验收，native paint 协调不在首期完成声明里。
- [每次活动更新可能重算 PF 全笔轮廓及 replay，长笔 CPU 昂贵] → rAF 合并、raw append buffer、已提交轮廓缓存；测 PF/绘制耗时、样本长度与内存，建立实测平台预算后局部优化，不沿用旧折线 append 的性能结论。
- [SVG 历史数量/foreignObject WebKit/WebView 支持差异] → 历史 render 计数与 Chromium/WebKit 像素顺序验证，加 Safari/真机 DOM 文字/图片、焦点/IME/键盘验收；不将桌面 Chromium 通过等同三平台通过。
- [模拟压力受采样密度影响、初始 preset 未经真机调参] → 明确 source/mode，固定单点/短笔/真实压力夹具，真机比较 pen/mouse/touch，调参更新 preset revision。
- [中心线近似橡皮擦存在边缘误差] → 扫掠半径+bbox+变换测试覆盖，记录近似范围，首期不承诺轮廓精确 cut。
- [dirty tree 和旧 change 退出误删用户工作] → 删除前做逐文件来源/依赖清单和可恢复备份/隔离，混合文件仅局部编辑；不得 reset/clean blanket。
- [未提交 core/input 存在 Skia 或旧平滑隐性耦合] → 每个复用模块有独立审计与测试，不因“平台无关”命名而直接照搬；不把旧测试结果当新契约证明。

## Migration Plan

1. 仅在实施开始后记录 `git status`、tracked/untracked 来源及可恢复备份/隔离位置；审计所有 Skia 引用及混合文件，建立 keep/remove/replace 清单。此规划阶段不删除旧 change。
2. 添加 PF 依赖及测试模型，建立 raw document/pressure/transform/cache 契约；渐进替换开发中的内部接口，不保留对外 legacy fallback。
3. 组装 controller + Canvas active + SVG mixed display、commit coordinator 与输入/文字/query 契约，将 playground/board 迁至唯一新入口，三平台复用 Web。
4. 确认新入口覆盖所有保留能力后，仅移除明确 Skia 实现、exports、dependencies、fixtures、专用 test/scripts/doc（包含适用的 Skia CONTEXT）与旧未归档 change；旧任务不得伪完成归档。混合 Expo/测试配置只移除 Skia 部分。
5. 用 pnpm 更新锁文件，再以 `pnpm install --frozen-lockfile` 验证可复现；保留 Expo 与无关工具链。playground Web 入口遵循 `expo start --web --lan --no-open`，保留 Playwright 依赖的 5266 端口，不借此换整个构建栈。
6. 执行单元/UI/typecheck/lint/build/pack 与三平台设备验收，更新 README/CHANGELOG/示例为中文描述；删除前后清单、测试失败基线及未完成硬件验证单独记录。

未上线，不设计旧数据自动迁移或双运行时发布切换。实施失败时依靠明确备份或隔离工作区撤回本次自己的修改，不重置用户工作、不把旧中心线留为产品 fallback。删除旧 change 前由主编排再次审核边界和未完成状态。

## Open Questions

- 初始 brush preset 在哪些具体 iOS/Android 压感设备上微调，及由哪组样本形成最终手感基线？这不改变已锁定的四模式和原始样本契约。
- 真实设备上的 Canvas/SVG 合成和 Expo WebView DOM keyboard 边界需要怎样的局部修正？必须以实施验收证据回答；future native paint/桥延迟另行验收，不把该未知项升级为第一期 native 实现范围。
