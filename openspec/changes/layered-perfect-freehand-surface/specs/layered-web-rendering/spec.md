# Spec Delta

## Purpose

定义活动输入与历史显示分层、文档有序混排和幂等提交的可观察契约，确保历史文字与图形共同绘制并避免活动笔迹逐点更新导致全历史重建或错误清屏。

## ADDED Requirements

### Requirement: Independent controls and rendering responsibilities
系统 SHALL 分离独立工具栏、无界面编辑控制器、活动绘制层与历史显示交互层；控制器统一拥有文档、history、工具、selection、输入会话和 viewport，不将全部状态逻辑塞入显示组件。活动输入 SHALL 增量接收样本，不因每个 pointer 样本驱动全体历史对象重新 reconcile。

#### Scenario: Active input does not replace history
- **WHEN** 连续向活动笔迹追加多个 pointer 样本且文档未改变
- **THEN** 历史对象身份与显示保持稳定，追加不作为全历史逐点 props/state 更新

### Requirement: Ordered mixed document display
系统 SHALL 按文档顺序绘制历史自由笔、形状、图片和 HTML 文字，任意类型可以交错，document order 等于 paint order；每个自由笔历史对象 SHALL 为单笔填充轮廓而非分段线集合。新笔 SHALL 添加到文档顶层，不提供直接在现有文字之下书写或任意层插入。

#### Scenario: Interleaved types keep paint order
- **WHEN** 文档顺序为自由笔、文字、图片、形状、另一笔自由笔
- **THEN** 显示按同一顺序叠放，文字保留真实 DOM 编辑能力，两笔分别为单笔填充对象

#### Scenario: New ink covers earlier text
- **WHEN** 用户在已有文字覆盖区域开始并完成新笔
- **THEN** 新笔追加顶层，活动预览和历史最终位置均不被错误插到文字之下

### Requirement: Idempotent commit and acknowledged render handoff
系统 SHALL 用 session 关联的 commitId 将原始批次转换成最终几何并只提交一次；活动覆盖 SHALL 在对应历史对象挂载且最终渲染内容确认后移交，不得仅设置状态就清空。交接 SHALL 防止丢失笔迹、无历史时的空白和可观察的半透明双重叠加，不默认用 crossfade 掩盖；迟到/重复确认 MUST 不清除下一笔。该确认只证明 Web 内部渲染交接，不声称浏览器或跨进程 physical paint 原子同步。

#### Scenario: Delayed history render preserves active ink
- **WHEN** pointerup 已提交但历史挂载/渲染确认被延迟
- **THEN** 活动最终笔迹仍保留，收到匹配确认后只显示一份最终笔迹，半透明颜色不因两份同时可见而变深

#### Scenario: Duplicate commit and stale acknowledgement
- **WHEN** 同一 commitId 重发，且旧确认在下一笔开始后到达
- **THEN** 文档和 undo history 仅新增一次，旧确认不能清空新笔或重复提交
