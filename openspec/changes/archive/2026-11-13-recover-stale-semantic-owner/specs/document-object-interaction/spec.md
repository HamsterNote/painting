## MODIFIED Requirements

### Requirement: Rotated selection frame obeys transaction and cancellation semantics

系统 SHALL 将选框会话方向作为临时交互状态，不写入持久化文档、不单独增加历史。一次实际移动、缩放或旋转 SHALL 仍只提交一个可逆文档事务；无变化点击不提交。取消未完成变换 SHALL 同时撤销对象及选框预览，恢复操作前仍有效的会话方向；若既有行为已清除选择则结束会话。pointercancel、Escape、失焦、页面隐藏、卸载、工具或输入模式切换 SHALL 遵守既有取消与归属规则，迟到事件不得提交或恢复旧方向。捕获丢失 SHALL 只改变事件路由，不取消活动手势或预览；owner SHALL 保留到真正的 up/cancel、生命周期中断或下述新同类主指针 down 恢复，正常 up 仍仅提交一次。历史撤销/重做或外部文档替换后，若选择仍有效，系统 SHALL 根据当前文档重新建立正交选框；若选择无效则清除，不能残留旧框或旧命中区。

#### Scenario: Cancel restores the previous orientation

- **WHEN** 当前会话已提交 30°，继续旋转预览至 60°，分别以 pointercancel、Escape、失焦或页面隐藏取消，再发送迟到 move/up
- **THEN** 无第二次旋转事务，仍有效选择的图形与选框恢复 30°，迟到事件不改变文档或框；新合法手势可正常开始

#### Scenario: Termination clears obsolete geometry

- **WHEN** 旋转预览中切换工具、输入模式或卸载编辑器，之后结束旧指针或重新挂载
- **THEN** 未完成操作不提交，旧预览、归属和命中区被清理，不复用上次挂载的会话状态

#### Scenario: History and external replacement reconcile the frame

- **WHEN** 完成一次旋转并撤销、重做，或从外部替换所选对象的文档内容
- **THEN** 文档按既有事务语义恢复；仍有效的选择重新得到当前几何的正交框，无效选择被清除，无额外选框历史、陈旧角度或不可见命中区

#### Scenario: Capture loss retains the rotated owner until release

- **WHEN** 选框已有30°已提交方向，继续旋转预览至60°，在正常up前或后丢失捕获
- **THEN** 捕获丢失本身不回滚预览或清除owner；正常up只提交一次60°方向，若收到真正取消则恢复30°且迟到up不提交

#### Scenario: A fresh primary down recovers a missing terminal event

- **WHEN** 单指针语义手势未收到终止事件，新的有效主按键 down 与旧 owner 同属 mouse，或同属 pen/touch 且新旧指针都明确为 primary
- **THEN** 系统 SHALL 先取消旧会话并确认清理成功，再以新 down 开始独立会话；旧轨迹不提交，新手势正常结束仅提交一次。捕获丢失与 buttons=0 move 本身均不触发恢复

#### Scenario: Secondary contacts retain existing arbitration

- **WHEN** 笔手势期间落下手指或次级笔，或触摸手势期间落下非 primary 第二指
- **THEN** 系统 MUST NOT 将旧 owner 判为陈旧；笔手势继续抑制手掌，双触摸按既有规则取消单触摸工具并接管导航，活动双指会话不被恢复规则替换。缺少 primary 信息的 pen/touch 输入不得推测主指针身份

### Requirement: Scheduled lasso feedback preserves final geometry and cancellation

系统 SHALL 在套索绘制过程中只显示轨迹并保留手势前选区；begin/update MUST NOT 准备几何、执行几何查询或提交临时选区。允许合并中间输入的显示，但 MUST 保留全部有效输入用于正常结束时的一次最终相交选择。正常结束 SHALL 包含最后一批有效输入，以完整轨迹和开始时有效的文档版本计算最终结果；结果非空切换选择工具，结果为空保持套索工具。纯套索操作 MUST 不更改文档或新增 undo 事务。

#### Scenario: End arrives before queued preview update

- **WHEN** 高频输入尚有未显示的批次时正常抬起
- **THEN** 最终选区与对全部有效轨迹执行既有相交规则的结果一致，包含末批命中、保留文档顺序，随后延迟回调不覆盖最终结果

#### Scenario: Cancellation restores previous selection

- **WHEN** 套索因 Escape、pointercancel、失焦、页面隐藏、切换工具或卸载而取消
- **THEN** 在原文档版本仍有效时恢复手势前选区并清空轨迹，取消待执行工作，迟到回调不改写后续手势；文档变化时清理旧手势且不重新选中已删除对象

#### Scenario: Geometry and editing remain compatible

- **WHEN** 套索跨过变换后的笔画、形状、文字和图片，包含边界接触、自交及退化轨迹，然后移动、缩放或旋转选中对象并撤销重做
- **THEN** 选择结果遵循既有几何命中和退化处理规则，变换及撤销重做保持原有事务语义，取消和纯圈选不新增绘图事务

#### Scenario: Selection is computed once on release

- **WHEN** 用户按住并继续绘制有效套索而不抬起
- **THEN** 持续更新轨迹，几何准备和查询次数保持为零；正常抬起后按完整轨迹查询一次并提交最终结果。此契约由 2026-11-13 用户决定替代原实时选区要求，不表示原实时指标已通过

#### Scenario: Native touch release commits the final selection

- **WHEN** 浏览器以真实触摸输入完成有效套索，并正常发出 pointerup/touchend，指针捕获可能在正常松手之前或之后释放
- **THEN** MUST 执行一次最终查询并将成功结果写入选区，捕获丢失只改变路由而不得误取消当前手势或在途查询；保留owner直到up、真正取消、生命周期中断或下述新同类主指针 down 恢复，重复up不重复提交；文档与历史不变。MUST 分开记录触摸与鼠标证据，CDP 触摸或桌面 WebKit 结果不得替代已报告故障设备的复验

#### Scenario: Touch interruption does not submit a stale selection

- **WHEN** 活动触摸套索收到取消、被双指缩放接管或用户切换工具
- **THEN** MUST 取消旧手势、保留有效原选区及文档和历史，不提交迟到结果，并允许下一次触摸圈选正常完成

#### Scenario: Pending final selection is visible and cancellable

- **WHEN** 松手后的最终查询尚未完成
- **THEN** 保留完整套索轨迹并显示正在选择的反馈；分批执行准备和精算，结果到达时以最终选框替换轨迹。等待期间的新手势、取消、文档更新、工具切换与销毁使旧结果失效，不恢复已删除对象

#### Scenario: Final selection performance gate

- **WHEN** 在桌面Chromium生产构建中以6×CPU降频，分别对500和1000笔完成连续套索手势
- **THEN** 松手到可见选区的延迟分别不超过150ms和400ms，全手势到选区呈现期间不存在超过200ms的主线程任务；冷态、热态分别报告，失败轮次不可删除或以CI通过替代

#### Scenario: Idle preparation precedes the first real lasso

- **WHEN** 首屏已显示或编辑完成，主线程有空闲时间且没有真实手势进行
- **THEN** 可以执行一次小型合成套索预热，并分批准备当前冻结文档的几何索引；预热不改变选区、工具、文档、历史或轨迹。输入开始或销毁取消排队预热，文档更改使旧准备失效。首次真实套索仍单列为冷态，预热自身成本、未完成预热的情况及长任务必须公开报告

#### Scenario: Performance comparisons reject host contention

- **WHEN** 比较两版套索查询性能
- **THEN** MUST 记录每轮前后load与空闲CPU；一分钟load超过可用核数一半时废弃整对并重跑。两版MUST在同一时段相邻交替AB/BA执行，以同线程查询边界CPU时钟及候选数、段对检查数、独立分配采样和GC次数为主证据。CPU时钟缺失不得以墙钟替代；内核首次查询不得冒充首次真实UI手势；原冷态150/400ms及零>200ms长任务门槛不变，真机验证单列

#### Scenario: A fresh primary down recovers a missing terminal event

- **WHEN** 单指针语义手势未收到终止事件，新的有效主按键 down 与旧 owner 同属 mouse，或同属 pen/touch 且新旧指针都明确为 primary
- **THEN** 系统 SHALL 先取消旧会话并确认清理成功，再以新 down 开始独立会话；旧轨迹不提交，新手势正常结束仅提交一次。捕获丢失与 buttons=0 move 本身均不触发恢复

#### Scenario: Secondary contacts retain existing arbitration

- **WHEN** 笔手势期间落下手指或次级笔，或触摸手势期间落下非 primary 第二指
- **THEN** 系统 MUST NOT 将旧 owner 判为陈旧；笔手势继续抑制手掌，双触摸按既有规则取消单触摸工具并接管导航，活动双指会话不被恢复规则替换。缺少 primary 信息的 pen/touch 输入不得推测主指针身份
