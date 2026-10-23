# Design

## Context

动机见 proposal.md。以下为当前源码观察，不是已实现的原生能力：

- `LayeredEditorRoute.tsx` 仅挂载 `'use dom'` 的 `LayeredEditorDom.tsx`，controller 在 DOM 内创建；`layered/DrawingLayer.ios.tsx` 仍 re-export Web。
- `input/native/layeredSemanticContract.ts` 只有消息类型，未实现桥、begin lease 或设备墨迹。`nativeInputAdapter.ts` 的 RNGH 冒烟链路不提供 schema 3 产品绘制、压力或完整硬件采样。
- `core/layeredEditorController.ts` 已提供 begin/update/end/cancel、幂等 commit、统一 history 和 presentation identity。`model/document.ts` 的 schema 3 支持 `source: 'native'`、可选 pressure、落笔快照，不保存 PKDrawing。
- `PresentationCoordinator.ts` 只协调 Web 内部呈现，注释明确不证明 physical paint。不能直接把它的 ACK 当作 native 清屏条件。
- 当前规格规定活动与最终共用几何、三端 Web 活动层，以及自动模式只认 DOM pen down；本提案显式修改这些约束，不静默绕过。
- HAM-64 已获用户整体验证通过；设备型号、系统及逐项截图未留档，不能外推为 PencilKit 验证。当前 Linux 环境不具备 iOS 编译/设备验收能力。

## Goals / Non-Goals

**Goals:**

- 在 RN host 放置原生临时墨迹层，继续由 DOM controller 决定是否接受输入、最终文档、历史和 viewport。
- 原生逐点收集、结束后批量跨桥；保证输入和提交可取消、可重试、可按编辑器世代隔离。
- 提供真机可观察的 raw、分流、压力、撤销、文字焦点和交接验收门槛。

**Non-Goals:**

- 不把 PKStrokePath 控制点称为硬件 raw，不用 PKDrawing 重建/替代全部历史对象，不恢复已取消笔。
- 不迁移 controller 到 RN，不维护第二份长期文档/undo 栈，不移植 PF 到 Swift，不提供原生工具选择器。
- 不承诺 PencilKit 与 PF 像素一致、零延迟或跨进程同帧原子交换；可见回弹与交接须由设备证据评估。

## Decisions

### D1. 文档与 PencilKit 如何映射（已确认 A）

| 选项 | 结果与代价 |
| --- | --- |
| A，推荐：真实 UIKit 采样 + PencilKit 临时预览 + schema 3/PF 最终轮廓 | 保留跨端重放、原始样本与现有对象工具；抬笔时可能从原生外观收敛到 PF |
| B：持久化 PKDrawing / PKStroke 作为新文档事实 | 能保留 PencilKit 原貌，但需要新 schema、跨端显示/编辑与历史方案，超出本期 |
| C：从 PKStrokePath 导出点并当 raw | 无法据此证明真实原始样本，违背当前 raw 契约，不推荐 |

以下设计与 specs 按 A 编写。修勾在 HAM-66 评论 `01a154b5-a92b-7f0f-9d50-44c3038e5bd6` 回复“同意采用”，确认 D1-A / D2-A / D3-A。若后续要求保存 PencilKit 原貌，应先修改本提案范围与规格，不能在 apply 中暗改数据模型。

采样映射：

| Native 事实 | schema 3 / controller 映射 |
| --- | --- |
| 实际 Pencil down/move/up 与真实 coalesced touches | `AcceptedSample`，按接受次序从 0 连续 sequence；首 down、末 up、中间 move，保留同坐标和真实零压力 |
| view-local UIKit point | 去掉 host/画布布局偏移后，以落笔 viewport 做逆变换，转为 world DIP；不乘屏幕像素密度，不烘焙对象 transform |
| `UITouch.force / maximumPossibleForce` | 能力明确可用且分母有效时映射为 pressure；不以压力是否变化判断能力，不 clamp；缺失保持缺失 |
| UIKit 单调时间戳 | 统一为同一原生时间基准的毫秒；不混用 JS Date.now，不按时间重排采样 |
| 工具栏当前 brush / capability | DOM 在 begin 锁定完整 `BrushSnapshot`、`resolvedPressureMode`；source 固定 native，auto 仅在 capability available 时解析 real |
| PKInkingTool | 仅使用可映射的 pen 预览，颜色/宽度/opacity 来源于快照；宽度按 viewport scale 映射，避免 alpha 重复相乘；不承诺所有压力模式与 PF 外观相同 |
| PKDrawing、PKStrokePath、预测/插值、倾角 | 仅允许临时预览/内部处理，不进入 document、commit payload 或存档 |

使用公开 UIKit 触摸/手势接口旁路采集真实触点，并与 PKCanvasView 同时工作。PKCanvasView delegate 的 drawing-change 通知不足以证明 raw 采样；不能通过枚举 PKStrokePath、私有子视图或私有 API 补造 raw。主事件与 coalesced 可能重叠，按事件身份避免同一实际样本重复接收，不能按坐标去重；tap 必须来自真实 down/up。

**可行性门槛 G1：** apply 的第一段实验必须在实体 Pencil 上证明采样完整且不抢占 PencilKit 手势；记录 down/up、快速短笔、coalesced、压力、estimated touch 更新处理方式。提交后不允许迟到估计值悄悄改写已存 raw；以提交时接受的值为准。若公开 API 不能满足，暂停后续接入并回到 D1 评审，不用 PK 路径近似顶替。

### D2. 输入范围（已确认 A）

| 选项 | 结果与代价 |
| --- | --- |
| A，推荐：PencilKit 只接自由笔 Pencil；手指及其他工具留 Web | 保留现有工具与三档语义，但需要可靠的 UIKit/WebView 输入分流 |
| B：PencilKit 同时接自由笔 Pencil 与手指；其他工具留 Web | 扩大采样、掌触、双指取消与原生导航桥工作，仍不能交给 PencilKit 自行滚动 |
| C：本期 iOS 整体只允许 Pencil 绘制 | 缩小功能但破坏现有手指输入模式，不推荐，需要明确产品变更 |

按 A：PKCanvasView 使用 pencilOnly 策略，关闭自身滚动/缩放与 PKToolPicker。**pencilOnly 不等于触摸穿透**。原生仅接管 DOM 报告的画布区域，工具栏、安全控件、文字编辑区和尺子等命中区域不得被挡住。

G2 原型修订（2026-10-23，尚待真机验证）：同级覆盖层依赖初始 hitTest 的 UIEvent.allTouches 判别类型，真机回执 `no-touch-metadata`，没有进入原生采样。候选改为 PKCanvasView 承载真实 Expo DOM 后代，hitTest 只做几何定位；公开 drawingGestureRecognizer 在实际 UITouch 到达后按类型/区域过滤，旁路观察器只采真实 Pencil。运行时检查绘制识别器是否确为 DOM 的祖先；若 Web 收到应归原生的自由笔 Pencil 则阻止落墨并报告故障。手指、其他工具与控件继续使用真实 Web 输入。此修订仅用于重测 G2/G3，不推进 3.x，也不将层级挂载或消息回执视为门槛通过；若 PencilKit 的实际识别器层级/delegate 不支持候选组合，停止构建并回到 D2 评审。

输入归属仍由同一 controller 决定：native 的有效 Pencil down 具有与 DOM pen down 相同的自动检测语义；自动初始/强制手指允许手指 Web 绘制，自动检测笔后/强制笔允许手指 Web 导航；强制手指仍允许 Pencil。双指取消、掌触隔离、模式切换遵守原规格，不能两端各自检测后独立锁定。

非自由笔工具、ruler 约束书写本期使用 Web 输入；不能在 PK 临时墨迹中假装实现 ruler 投影。进入文字显式取消未完成原生笔，停用其命中并交还 DOM 焦点/键盘。Pencil 双击或系统橡皮切换不启用 PK 擦除；若映射工具命令则只能走现有 controller 语义，本期可不映射。

**可行性门槛 G2：** 在 PKCanvasView 与 WKWebView 的真实宿主层级验证按触摸类型/工具分流，连续手指轨迹不可由伪造 DOM PointerEvent 补回。若公开 API 无法把手指可靠交还 Web，暂停并提交 D2-B 的范围变更，不牺牲三档功能。工具切换后新的 Pencil down 能到达 Web，文字键盘/IME 和画布外控件须现场验证。

### D3. 撤销与重做归属（已确认 A）

| 选项 | 结果与代价 |
| --- | --- |
| A，推荐：中心化 controller 独占 history | Pencil 笔与文字/形状事务保持同一顺序；原生只持有可丢弃预览 |
| B：PencilKit 独立 history + Web history | 撤销跨对象顺序不确定，容易复活已删笔，不推荐 |
| C：双栈同步镜像 | 需处理工具混排、重试、删除及重载一致性，复杂度高且本期无必要 |

按 A：一个 accepted end 对应至多一个 controller 事务。工具栏 undo/redo、键盘及系统撤销入口如可用都路由到 controller；禁用或隔离 PK 本地 undo 注册，不从 PKDrawing diff 推断文档变化。程序化清理预览不得触发新 raw-commit。undo/redo 前先取消 collecting 笔并处理已提交待交接预览，保持文档 revision 单调和混排事务顺序。不持久化跨重启 undo history。

### D4. RN host、Expo Module 与 DOM 桥

建议模块落点 `packages/painting-pencilkit/`，包含 module config、podspec、Swift Expo View（拥有 PKCanvasView/采样器）、TS view props/事件/命令。由 playground 显式依赖以验证 autolinking。最低系统沿用 iOS 16.4，不为该功能扩大升级 Expo/RN 范围。Web/Android 入口不导入该原生运行时；Android 路由保持原 DOM host。

在 RN 的 `LayeredEditorRoute` iOS 组合原生 view 与 DOM component；DOM 内保持一个 controller。跨边界仅传可序列化消息；使用 Expo DOM 支持的回调/action 通道，apply 时验证实际 SDK 接口与大小限制，不假定普通 ref 能跨 WebView。`DrawingLayer.ios.tsx` 的接口调整用于声明/组合能力，不能在 DOM bundle 内实例化原生 view。替代方案“整个 controller 移到 RN”涉及全部工具桥和状态订阅，不采用。

建议协议 v1（新增，不声称现有类型已经支持）：每条消息包含 `protocolVersion`、`editorEpoch`、请求关联 id；采样会话另带 `sessionId`、`commitId`、`viewportRevision`、`layoutRevision` 和 brush 锁定信息。

| 方向 | 消息 | 责任 |
| --- | --- | --- |
| DOM → host/native | ready / arm-state | 发布画布 DIP frame、命中排除区、工具、输入模式、压力能力协商结果、viewport/brush 状态；未 ready 不接受笔 |
| native → DOM → native | begin-request / accepted-or-rejected | 原生 down 本地开始暂存/临时预览，DOM 校验空闲/模式/版本，发放权威 lease 与快照并调用 beginFreehand；拒绝立即取消预览 |
| native → DOM | raw-commit | 收到有效 begin lease 后，end 批量送真实 world raw 和锁定快照；无需逐点跨桥。若 end 先于 begin 回复则暂存等待，拒绝则丢弃 |
| 任一方向 | cancel / invalidation | 工具/模式/布局切换、后台、卸载、WebView 重载使 collecting lease 失效；迟到 end 不提交 |
| DOM → native | commit-result | committed / duplicate / rejected 加具体原因与 presentation identity；表示文档结果，非清屏授权 |
| 双向 | history-ready / preview-retired / visible | 按 epoch、commitId 和 presentation identity 协调呈现，单独跟踪，不混入 schema 3 |

DOM 从权威快照校验 begin-request 的缓存 revision；等待 begin 期间 host 保持本地输入互斥，DOM 到达更早的合法导航若已修改 revision 则拒绝旧 begin。viewport collecting 期间冻结，不补发竞争导航。有效原生 down 只触发一次自动检测，不因请求重发重复取消或切档。

batch 接收器先完整验证 lease、样本、快照和大小，再用已有 begin/update/end/commit 语义将真实剩余样本送 controller，不能重复首 down；拒绝时取消临时 session，不写半个对象。`commitId` 同 payload 重发幂等，异 payload 报冲突；保留 pending candidate 的原子重试语义。已 committed 的结果重查不能被简单视作过期 lease 而重复提交。epoch 重建后不自动重放旧内存消息。

建议初始工程限额（待实现用设备数据校准，但不得无界）：每笔最多 100,000 个样本、组装后 16 MiB、最多 4 笔等待交接；超过限额拒绝整笔并报告原因，不截断后成功。单条桥消息若受限，可按同一个 commitId 分块 transport，完整组装验证前不进入文档。端到端无进展 5 秒进入显式可恢复故障：停止新 native 输入，查询权威结果并清理未接受会话，保留已提交文档；不按超时假装 ACK。重试不生成新 commitId。

### D5. 呈现交接与失败状态

PKCanvasView 透明、位于历史上方，仅拥有当前及有限待交接预览。新笔追加文档顶层，历史仍由 Web 按 mixed object order 显示；不让 PK 长期重复绘制已提交历史。

候选交接：DOM 在匹配最终 PF 轮廓准备好时先保持其隐藏，再通知 host；host 按单笔身份移除临时墨迹并返回 preview-retired，DOM 再显示对应历史。保留队列顺序与后续笔，不用 `drawing = empty` 清掉全部新墨迹。该协议可避免有意双显，但跨进程可能产生空窗，**本身不是通过验收的方案**。

**可行性门槛 G3：** 用至少 120fps 外部录影（设备录屏为补充）验证空白首笔、连续快速笔、长笔、半透明、延迟与 Web 忙碌。可见双重变深或空窗即不通过；不能改用固定帧数/超时清屏或 crossfade 宣称解决。若公开合成接口不能通过，暂停生产启用并回到交接设计评审；不能把“已有 ACK”当作设备成功。PencilKit→PF 的形状收敛由修勾另行按实际对比确认，不能自动认定外观可接受。

提交被拒只删除对应未提交预览；commit 已成功但 ACK 丢失时先查权威结果，不回滚或重复新增文档。后台、旋转/布局变化与重载取消 collecting；已提交对象不能因清理被删除。旧 epoch 的任何结果均不得清除新笔。组件 destroy 解除 delegate、订阅、手势与定时器，程序化 redraw 带来源标识防止回流事件。

## Risks / Trade-offs

- [公开接口无法同步获取完整真实触点或正确分流] → G1/G2 必须先于主集成，失败停止并提交具体设备证据与方案修订。
- [原生预览与 PF 在压力/笔宽/透明度上明显不同] → 本期只用 pen 预览，提供真实对照，修勾确认可接受后继续，不能声称保留 PencilKit 原貌。
- [native/DOM 跨进程无法无可见瑕疵交接] → G3 阻止启用；仅 Web ACK、mock 与 bundle export 不足以验收。
- [长笔与多笔积压导致内存/桥阻塞] → 约束样本、字节和队列；故障可见并可恢复；真机记录峰值及延迟，不承诺未测 frame budget。
- [局部坐标、safe area、键盘/旋转使 overlay 错位] → host frame + layout revision，布局失效取消当前笔；在 0.5/1/2 倍 viewport 检查对齐，原生不补偿 WebView transform。
- [构建链或 native 模块污染 Web/Android] → 平台入口隔离、iOS 重建 dev client、Web 和 Android bundle 回归。

## Migration Plan

1. 修勾已确认 D1-A / D2-A / D3-A，确认记录见 D1；后续执行者可按此方案进入 apply。本轮仅更新提案与交接记录，不分派后续工程师。
2. 由后续执行者运行 G1/G2/G3 可行性实验并保存设备/构建/采样/视频证据，再进行可发布集成；任一失败先修订方案。
3. 新构建的 iOS dev client 在明确的 PencilKit 验证配置中启用，未通过验收不得改为 iOS 默认路径；Web 与 Android 不进入该路径。
4. 按 specs 和 tasks 完成完整链路、自动化回归及实体 Pencil 验收，修勾确认外观与性能观察后才允许 iOS 默认启用。
5. 回滚使用受控关闭 native 输入配置并回到既有 DOM 绘制；先取消当前 lease/清理预览，已提交 schema 3 文档原样保留。模块不可用时显示构建/重建提示，不静默假装 PencilKit 已启用；不引入 legacy/Skia fallback。

## Open Questions

- 设备验收的具体 iPad / Apple Pencil 型号和 OS，以及可录制高帧率对照的设备，实施安排时补齐；至少一套真实支持 PencilKit 的实体 Pencil 组合是验收前提。
- 完整验收日志/视频的仓库内归档目录建议为 `docs/implementation/ios-pencilkit-surface/`；最终命名可随团队文档惯例调整。

D1-D3 已由用户确认，不属于可推迟到实现中自行改变的 open question。G1-G3 是明确的实现验收门槛，当前没有已执行或通过的证据；方案确认不代替设备证据或后续外观验收。
