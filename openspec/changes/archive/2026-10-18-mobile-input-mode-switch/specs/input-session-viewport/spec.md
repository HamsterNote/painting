# Spec Delta

## ADDED Requirements

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
