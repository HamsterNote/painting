# input-session-viewport Specification

## Purpose

为书写与其他工具规定统一输入会话、坐标和取消行为，并约束唯一 Web viewport 与未来原生语义输入边界，避免迟到变换、掌触或工具切换造成错误笔迹。

## Requirements

### Requirement: Snapshot-based input lifecycle

系统 SHALL 以 begin/update/end/cancel 管理输入会话，落笔时记录 pointer identity、brush snapshot 和稳定 viewport revision。当前笔的颜色、宽度、不透明度与压力解析 SHALL 不受中途笔刷设置变动影响；工具改变 SHALL 取消当前未提交会话后进入新工具。

#### Scenario: Brush updates do not split a stroke

- **WHEN** 书写过程中修改颜色或宽度，再正常结束
- **THEN** 整笔使用落笔快照，新设置仅作用于下一笔

#### Scenario: Cancellation never creates a partial document object

- **WHEN** 当前笔遇到 pointercancel、组件卸载、应用后台化或工具切换
- **THEN** 未提交样本和预览被丢弃，不新增文档对象或 undo entry，迟到 end 被忽略

### Requirement: Web owns viewport and coordinates

系统 SHALL 由 Web 控制器唯一维护 viewport 及单调 revision，绘制层接收该 viewport/revision；输入 SHALL 显式区分屏幕与世界坐标，并按落笔的稳定 revision 转换。书写会话内 SHALL 冻结 viewport，忽略掌触和会引起 viewport 改动的竞争手势，不在结束后补应用这些竞争手势。

#### Scenario: Late pan cannot displace ink

- **WHEN** 书写开始后收到旧 revision 的 pan/zoom 更新或掌触移动
- **THEN** viewport 和当前笔世界坐标不变，迟到更新不移动笔迹或结束后跳动页面

#### Scenario: Zoomed input shares one transform

- **WHEN** 在平移缩放 viewport 下落笔并完成，随后正常改变 viewport
- **THEN** 活动与历史在同一世界位置对齐，只有 Web 的新 viewport 更新它们的显示

### Requirement: Source policy preserves supported drawing and semantic feedback

系统 SHALL 保留按输入策略/工具配置允许 mouse、touch、pen 绘图的能力，不强制所有平台 pen-only 或禁止所有 touch 书写；会话归属 SHALL 防止并发来源写入同一笔。选择、套索、擦除与形状工具 SHALL 获得过程中的语义轨迹反馈，不仅在 pointerup 提交最后一点。

#### Scenario: Configured mouse or touch can draw

- **WHEN** 当前输入策略允许 mouse 或 touch 自由笔
- **THEN** 对应来源可开始完整会话，压力按模式解析；书写期间另一个来源不接管该笔

#### Scenario: Non-pen tool has live progress

- **WHEN** 用户拖动套索、形状预览或橡皮擦，尚未抬起
- **THEN** 已接受轨迹驱动实时过程反馈，而不是只在结束显示最后一点

### Requirement: Future native input is semantic and non-authoritative

未来原生 adapter 的契约 SHALL 提交 pan/zoom 语义意图，由 Web 执行；原生 MUST NOT 独立变换 WebView 进行补偿或作为第二 viewport 权威。未来原生自由笔 SHALL 在结束后批量提交接受的 raw samples 到 Web 最终几何，预测点不持久化，不要求逐点书写跨桥或移植最终几何算法；该契约不表示第一期已实现原生墨迹或验证桥接 paint 性能。

#### Scenario: Native contract rejects double authority

- **WHEN** 使用模拟 adapter 测试发送 pan 意图或完成的笔迹批次
- **THEN** 只有 Web 更新 viewport/最终文档，重复批次按 commitId 去重；无 native WebView transform 补偿或预测点进入文档

### Requirement: Stroke completion is independent of input speed

对已经取得归属的自由笔，系统 SHALL 接收其有效 pointerup 并提交最终几何与一个历史事务，不因快速/稀疏移动、同一帧结束或终止事件经过导航/尺子/virtual paper 而静默丢弃。捕获从子节点交到宿主的通知 MUST NOT 取消宿主拥有的笔；真正 pointercancel、失焦及卸载仍取消未完成笔，不把取消伪装成正常提交。

#### Scenario: Fast and slow pen both survive release

- **WHEN** 用户在真实分层入口分别快速和慢速绘制 pen 笔迹并松手，包括跨已有对象的快速轨迹
- **THEN** 每笔按接受的 raw 与最终几何进入可见历史，undo/redo 每次只移除/恢复对应的一笔，viewport 不被竞争导航移动

#### Scenario: Capture loss does not terminate a live owner

- **WHEN** 活动指针的 capture 被释放或交到其他节点，但同一 window 仍收到该 owner 的 move/up，包括表面外控件阻止冒泡
- **THEN** 窗口捕获阶段接收其真实样本并一次提交，lostpointercapture 本身不当作 pointercancel；真正 cancel/后台/卸载仍丢弃未提交笔

### Requirement: Device gesture diagnostics are bounded and exportable

示例 SHALL 仅在 `diagnostics=1&traceGestures=1` 时记录最近 2048 条手势事件和累计计数。记录 SHALL 包含事件时间、pointer id/source、owner/session/commit 归属、movementX/Y、pointerrawupdate、up 时 operation/销毁状态与最后已接受样本、coalesced 数量与批次样本数、拒绝与取消原因、提交结果及历史呈现交接；保留 trusted 标志以区分合成输入。诊断 MUST NOT 保存文档文字/图片内容或逐点更新 React 状态。用户 SHALL 能在原设备查看、复制或下载 JSON，包括无 Clipboard API 的 HTTP LAN 环境。

#### Scenario: A device trace distinguishes cancellation from lost presentation

- **WHEN** 用户开启诊断复现快速丢笔并导出记录
- **THEN** JSON 保留有序的最近事件、溢出数量与累计计数，能区分 pointercancel、丢失 owner、无效批次、提交失败和已提交未交接；未开启时没有诊断面板或记录器

### Requirement: Three input modes share one selected tool

系统 SHALL 在绘图工具栏提供名称为“输入模式”的三档菜单，选项为“自动”“强制手指绘制”“强制手写笔绘制”，首次无有效偏好或显式初始化配置时默认自动。自动未检测到笔和强制手指档 SHALL 允许单指使用当前工具；自动笔优先与强制手写笔档 SHALL 让单指拖动画布、笔使用当前工具。鼠标 SHALL 始终遵循当前工具，不受三档限制；强制手指档 SHALL 仍允许笔使用当前工具，笔事件不得改变该档的手指行为。输入模式 SHALL 不改变所选工具、文档内容或 undo 历史。

#### Scenario: Fresh automatic mode draws without a stylus

- **WHEN** 用户首次打开编辑器，无保存偏好或显式初始化配置，在自由笔工具下用单指画线并抬起
- **THEN** 菜单为自动，产生一条可见笔迹和一个 undo 事务，viewport 不随单指移动

#### Scenario: Forced finger mode ignores pen influence on touch behavior

- **WHEN** 用户选择强制手指档，使用笔完成一笔后再用单指画线
- **THEN** 笔和手指各自正常提交，单指仍绘制，不因笔输入变成拖动

#### Scenario: Forced pen mode pans with one finger

- **WHEN** 用户选择强制手写笔档，先单指拖动，再用笔画线
- **THEN** 单指只改变 viewport，不产生文档对象或 undo 事务，笔正常提交笔迹

#### Scenario: Mouse follows the active tool in every mode

- **WHEN** 用户在每个档位分别用鼠标操作自由笔与平移工具
- **THEN** 自由笔绘制，平移工具拖动，切换档位本身不改工具或产生历史事务

### Requirement: Automatic pen detection is latched within the editor session

系统 SHALL 仅以画布业务区域内首次有效 `pointerType === 'pen'` 落笔检测笔，检测状态 SHALL 只保留在当前编辑器会话，不以设备能力、压力或 hover 推断。自动档检测后 SHALL 保持笔优先，抬笔、失焦、后台、切工具或等待任意时长均不得自动回退；重新打开编辑器建立新会话 SHALL 清除检测状态。强制手指档 SHALL 立即覆盖检测状态的效果，切回自动时 SHALL 恢复本会话已经锁定的笔优先状态。

#### Scenario: First pen down is not lost during detection

- **WHEN** 自动档尚未检测到笔，用户在空闲画布内用笔落下、移动并抬起
- **THEN** 该次落笔正常提交，随后单指拖动而不绘制；等待或失焦再返回仍保持笔优先

#### Scenario: Reopening resets detection but preserves selected mode

- **WHEN** 自动档已检测到笔，用户销毁该编辑器并重新打开，保存的档位仍为自动
- **THEN** 新会话初始单指可绘制，直到新的有效笔落下；旧会话检测不恢复

#### Scenario: Forced finger override is immediate and reversible

- **WHEN** 本会话已经检测到笔，用户切强制手指后开始新的单指输入，随后再切回自动
- **THEN** 强制手指下该新输入可绘制，回自动后新的单指输入恢复拖动，不需要再次检测笔

#### Scenario: Non-drawing pen signals do not latch automatic mode

- **WHEN** 自动档仅收到笔 hover、无效样本或工具栏上的笔触碰，尚无有效画布笔落下
- **THEN** 单指仍可使用绘制工具，不切换为笔优先

### Requirement: Touch pair navigation follows cancellation and preserves writing freeze

系统 SHALL 在三档均支持纸面双指平移与缩放；纸面单指 touch 工具事务中加入第二个有效纸面触点时，SHALL 先取消未提交事务并清除预览，不产生对象或 undo entry，再以两指当前位置建立导航基线。取消失败时 MUST NOT 改变 viewport。实际笔书写期间 SHALL 保持现有视口冻结和掌触抑制，不允许双指抢占当前笔，也不在笔结束后补应用被忽略触摸。双指导航与书写不得同时拥有同一输入；属于控件、尺子或选择手柄的触点不得被当作纸面第二指。

#### Scenario: A second finger cancels partial ink before navigating

- **WHEN** 自动未检测笔或强制手指档下，用户单指已画出未提交预览，再落第二指并移动双指
- **THEN** 预览消失，文档和 undo 不增加；取消完成后 viewport 才平移或缩放，两个触点抬起时不补提交笔迹

#### Scenario: All modes allow a fresh touch pair

- **WHEN** 任一档位下没有活动笔书写，用户在纸面落下两指并改变指间距离与中点
- **THEN** viewport 按双指距离缩放、按中点移动，文档和 undo 不增加

#### Scenario: Pen writing suppresses palms until contacts are drained

- **WHEN** 任一档位下实际笔正在书写，同时出现两个 touch 并移动，之后笔抬起而 touch 仍按住
- **THEN** 笔完成一次提交，viewport 保持冻结且不补执行 touch 导航；这些 touch 全部抬起后新落双指才可导航

#### Scenario: Navigation pair is fixed for its lifetime

- **WHEN** 已建立双指导航，第三指加入，原 pair 的一指抬起，剩余指继续移动
- **THEN** 第三指不替补，残留指不开始绘制或拖动；全部抬起后新的 down 才开始新手势

#### Scenario: Tool preview is cancelled consistently

- **WHEN** 单指正在纸面进行形状、套索、擦除或选择的未提交工具事务，第二个有效纸面触点加入
- **THEN** 工具预览与未提交修改取消，随后双指可导航，不产生半成品对象、删除或历史记录

### Requirement: Input mode changes cancel unfinished input without replay

系统 SHALL 对所有输入入口采用一致的模式和归属决策。用户切换输入档位时 SHALL 取消未提交工具和导航事务，保留已完成内容，并隔离切换前仍按住的触点直到其抬起；后续新的 down SHALL 立即采用新档位。自动首次有效笔落下遇到 touch 绘制时 SHALL 先取消 touch 再接受该笔，不把两种来源拼成同一笔；已有双指导航时 SHALL 保持 pair 归属，检测到笔不得劫持该手势。

#### Scenario: Switching modes does not commit partial ink

- **WHEN** 用户单指绘制未抬起时选择另一个档位，原触点之后继续移动并抬起
- **THEN** 未提交预览和样本被取消，迟到 move/up 不产生对象或 undo；下一次新 down 按新档位处理

#### Scenario: Pen detection preempts touch drawing safely

- **WHEN** 自动档正在 touch 绘制，画布收到首次有效笔落下并正常完成
- **THEN** touch 未提交笔迹被取消，笔从该 down 开始独立会话并只提交一次，viewport 不跳动

#### Scenario: A detected pen does not steal an existing navigation pair

- **WHEN** 自动档已有双指导航，画布收到有效笔 down
- **THEN** 记录本会话笔优先状态，原 pair 继续导航，该笔不接管；排空触点后下一次新笔落下可正常操作

### Requirement: Mode preference is restored before interaction with memory fallback

系统 SHALL 仅持久化用户选择的输入档位到本机，不保存笔检测状态，不写入文档或 undo。无显式初始化覆盖时，合法保存值 SHALL 在首个可交互画布与菜单出现前恢复，不允许先用错误档位接收输入再异步切换。存储读取、解析或写入失败以及存储不可用时 SHALL 使用内存状态继续工作，无合法偏好时默认自动，用户本会话选择仍有效。

#### Scenario: Saved mode is correct on first interactive frame

- **WHEN** 本机已保存强制手写笔档并重新打开编辑器，未提供初始化覆盖
- **THEN** 首个可交互菜单即为该档，第一次单指输入只拖动；从未短暂按自动绘制

#### Scenario: Storage failure preserves current session operation

- **WHEN** 本机存储访问或写入抛出异常，用户打开编辑器并切换至强制手指档
- **THEN** 未捕获异常不阻断编辑器，无合法偏好时初始自动，切换后本实例手指正常绘制；不承诺失败存储下跨新会话保存

#### Scenario: Invalid preferences and automatic detection are not restored

- **WHEN** 存储包含非法档位，或者仅之前会话曾检测到笔
- **THEN** 非法值回退自动，旧笔检测状态不使新会话单指变成拖动

### Requirement: Web touch identities remain distinct throughout their lifetime

系统 SHALL 正确区分浏览器提供的不同 touch identifier，包括负数、大整数和取模同余值；一个触点结束或取消 MUST NOT 使另一个仍存活的触点失效。合法单指、双指、多指及笔指混合输入 SHALL 不产生 “Cannot find single active touch” 或丢失 start 的伪错误提示，开发期其他真实错误仍 SHALL 正常报告。此保证 SHALL 同时适用于启用与关闭诊断的 Web 编辑器，不改变原始 pointerId 或 HAM-44 输入归属语义。

#### Scenario: Distinct contacts survive reduction to one finger

- **WHEN** 三档分别在纸面落下 identifier 为 1/21、21/41 或 -1/-2 的两指，移动后先抬任意一指，再移动并抬起另一指
- **THEN** 活动触点保持正确身份，控制台与开发提示均无单一活动触点错误；双指仅导航，残留指不补提交笔迹，全部抬起后的新输入正常

#### Scenario: Third contact and cancellation preserve subsequent input

- **WHEN** 双指导航中第三指加入，原 pair 一指抬起，随后其余触点结束或取消，并重复开始新手势至少 50 轮
- **THEN** 第三指不替补原 pair，触点状态完全释放，下一轮无旧身份串扰或 start 缺失警告，文档及历史不产生导航引起的对象

#### Scenario: Writing and ownership rules remain intact

- **WHEN** 任一档位下笔正在绘制，同时双指落下并移动，笔先抬起、触点随后排空，或一指从控件区域落下后移入纸面
- **THEN** 笔只提交一次，视口保持书写冻结且不补执行竞争触摸；控件触点维持 down-time 归属，不成为纸面第二指；无触摸历史伪错误

#### Scenario: Diagnostics and native pointer identities are independent

- **WHEN** 相同触摸序列分别在普通入口和诊断入口运行，且浏览器原始 pointerId 为负值
- **THEN** 两个入口均正常绘制或导航且无伪错误，应用原始 pointerId 与三档行为保持一致；注入无关测试错误时开发错误通道仍可见
