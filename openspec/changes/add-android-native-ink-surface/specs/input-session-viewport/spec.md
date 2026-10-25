# Spec Delta

## MODIFIED Requirements

### Requirement: Future native input is semantic and non-authoritative

原生 adapter 的契约 SHALL 提交 pan/zoom 语义意图，由 Web 执行；原生 MUST NOT 独立变换 WebView 进行补偿或作为第二 viewport 权威。启用的 iOS/Android 原生自由笔 SHALL 先由同一 controller 接受 begin lease 并锁定上下文，再在结束后批量提交接受的 raw samples 到 Web 最终几何，预测点不持久化，不要求逐点书写跨桥或移植最终几何算法。跨平台桥 SHALL 统一世代隔离、会话、提交去重、取消及历史归属，不要求某平台专有硬件字段。该契约及桥 ACK MUST NOT 被视为已验证物理呈现性能。

#### Scenario: Native contract rejects double authority

- **WHEN** 使用 adapter 测试发送 pan 意图或完成的笔迹批次
- **THEN** 只有 Web 更新 viewport/最终文档，重复批次按 commitId 去重；无 native WebView transform 补偿或预测点进入文档

#### Scenario: Native session snapshots cannot outlive their context

- **WHEN** 原生 begin 后 viewport/布局或编辑器世代失效，随后收到旧 end 或旧退休回执
- **THEN** 未提交笔取消，旧消息不新增历史或清除新预览，已提交文档保持

### Requirement: Automatic pen detection is latched within the editor session

系统 SHALL 仅以画布业务区域内首次有效 DOM `pointerType === 'pen'` down，或启用原生通道报告的实际有效 stylus down 检测笔；检测状态 SHALL 只保留在当前编辑器会话，不以设备能力、压力或 hover 推断。原生重传 MUST NOT 重复触发检测或取消；无效、画布外或旧世代请求不检测笔。自动档检测后 SHALL 保持笔优先，抬笔、失焦、后台、切工具或等待任意时长均不得自动回退；重新打开编辑器建立新会话 SHALL 清除检测状态。强制手指档 SHALL 立即覆盖检测状态的效果，切回自动时 SHALL 恢复本会话已经锁定的笔优先状态。检测不改变既有输入归属：已有双指导航仍保持 pair，touch 绘制按原规则先取消再接受新笔。

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

#### Scenario: Native detection is idempotent and preserves navigation

- **WHEN** Android 或 iOS 原生报告有效 stylus down 并重传同一 begin，或该 down 到达时已有双指导航
- **THEN** 检测仅锁定一次，空闲时首笔正常接受，已有导航 pair 不被抢占；旧 epoch 重传不改变新会话检测状态
