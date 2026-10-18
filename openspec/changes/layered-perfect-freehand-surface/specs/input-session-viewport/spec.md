# Spec Delta

## Purpose

为书写与其他工具规定统一输入会话、坐标和取消行为，并约束唯一 Web viewport 与未来原生语义输入边界，避免迟到变换、掌触或工具切换造成错误笔迹。

## ADDED Requirements

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
