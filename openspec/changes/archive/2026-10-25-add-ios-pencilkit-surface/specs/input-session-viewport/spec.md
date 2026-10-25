# Spec Delta

## MODIFIED Requirements

### Requirement: Future native input is semantic and non-authoritative

原生 adapter SHALL 提交 pan/zoom 语义意图，由 Web 执行；原生 MUST NOT 独立变换 WebView 进行补偿或作为第二 viewport 权威。iOS 原生自由笔 SHALL 在 begin 获得 controller 会话归属并锁定 brush、viewport 与布局版本，在结束后批量提交接受的 raw samples 到 Web 最终几何；预测点不持久化，不要求逐点书写跨桥或移植最终几何算法。旧版本/失效会话 SHALL 被拒绝，真实桥和物理呈现性能 SHALL 单独通过设备验收，不得以模拟合约结果替代。

#### Scenario: Native contract rejects double authority

- **WHEN** adapter 发送 pan 意图或完成的笔迹批次
- **THEN** 只有 Web 更新 viewport/最终文档，重复批次按 commitId 去重；无 native WebView transform 补偿或预测点进入文档

#### Scenario: Native begin locks one coordinate mapping

- **WHEN** 原生 begin 使用过期的 viewport/layout 版本，或已接受的一笔书写期间收到竞争导航意图
- **THEN** 过期 begin 不提交，已接受的一笔按锁定的 world DIP 映射完成，竞争导航不移动当前笔或在抬笔后补执行

### Requirement: Automatic pen detection is latched within the editor session

系统 SHALL 仅以画布业务区域内首次有效 pen 落笔检测笔：Web 为 `pointerType === 'pen'`，iOS 原生通道为经同一 controller 接受的实际 Pencil down；两通道 SHALL 共享同一检测状态和输入归属。检测状态 SHALL 只保留在当前编辑器会话，不以设备能力、压力或 hover 推断。自动档检测后 SHALL 保持笔优先，抬笔、失焦、后台、切工具或等待任意时长均不得自动回退；重新打开编辑器建立新会话 SHALL 清除检测状态。强制手指档 SHALL 立即覆盖检测状态的效果，切回自动时 SHALL 恢复本会话已经锁定的笔优先状态。

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

#### Scenario: Native Pencil detection agrees with the Web mode

- **WHEN** iOS 原生 Pencil 的第一次有效 begin 被接受，之后手指从 Web 通道开始新手势，或者重复 begin-request 到达
- **THEN** 自动模式只锁定一次且手指使用已更新的笔优先规则，不出现两份检测状态或重复中断
