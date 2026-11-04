# Spec Delta

## MODIFIED Requirements

### Requirement: Stroke completion is independent of input speed

对已经取得归属的自由笔，系统 SHALL 接收其有效 pointerup 并提交最终几何与一个历史事务，不因快速/稀疏移动、同一帧结束或终止事件经过导航/尺子/virtual paper 而静默丢弃。捕获从子节点交到宿主的通知 MUST NOT 取消宿主拥有的笔；真正 pointercancel、失焦及卸载仍取消未完成笔，不把取消伪装成正常提交。正常可绘制且无取消/资源超限的连续独立 down/up SHALL 逐笔取得归属并完成，不要求最短位移、最短接触时长、至少一次 move 或等待上一笔显示；前笔结束后复用 pointerId SHALL 开始新的独立会话。每个完成笔 SHALL 对应一个文档对象、一个 undo 事务及一份可见最终笔迹。

#### Scenario: Fast and slow pen both survive release

- **WHEN** 用户在真实分层入口分别快速和慢速绘制 pen 笔迹并松手，包括跨已有对象的快速轨迹
- **THEN** 每笔按接受的 raw 与最终几何进入可见历史，undo/redo 每次只移除/恢复对应的一笔，viewport 不被竞争导航移动

#### Scenario: Capture loss does not terminate a live owner

- **WHEN** 活动指针的 capture 被释放或交到其他节点，但同一 window 仍收到该 owner 的 move/up，包括表面外控件阻止冒泡
- **THEN** 窗口捕获阶段接收其真实样本并一次提交，lostpointercapture 本身不当作 pointercancel；真正 cancel/后台/卸载仍丢弃未提交笔

#### Scenario: Consecutive short strokes match equal-frequency long strokes

- **WHEN** 在相同输入来源、笔刷、viewport、接触时长和样本数下，分别以 2/5/8 Hz 起笔频率、20/80 ms 接触时长，连续完成 100 笔位移 8 CSS px 的短笔和 100 笔位移 160 CSS px 的长笔，输入有效且无取消或超限
- **THEN** 每组新增 100 个独立文档对象、100 个 undo 事务及 100 笔可见最终笔迹，无交替丢失、合笔或重复提交；短笔与长笔的完成率均为 100%

#### Scenario: Sparse and same-frame endpoints are sufficient

- **WHEN** 允许绘图的来源连续完成无 move 的 down/up，包括原地 tap、真实 up 零压力、同一显示帧内完成，以及前笔结束后复用 pointerId
- **THEN** 每笔保留真实首尾样本并独立提交、可见，不增加伪造移动或压力，不等待下一次 move 才释放前笔归属

#### Scenario: Rapid stroke history is reversible one stroke at a time

- **WHEN** 连续 100 笔短笔完成并显示后，用户逐次 undo 100 次，再逐次 redo 100 次，最后再完成一笔
- **THEN** 每次只移除/恢复对应的一笔，撤销至基线且重做后顺序、样本及外观恢复；新笔正常新增一个事务，没有幽灵预览或残留归属

#### Scenario: Cancellation does not contaminate the next stroke

- **WHEN** 快速连续绘制中一笔真实取消或因模式切换取消，旧 move/up 随后到达，之后有效新 down 正常完成
- **THEN** 被取消笔不新增对象或历史，旧事件不提交或清除新笔，后续有效笔独立提交一次；按输入策略不可绘制的 touch 仍只导航
