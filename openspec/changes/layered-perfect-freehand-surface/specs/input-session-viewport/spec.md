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
