# Spec Delta

## ADDED Requirements

### Requirement: Scheduled lasso feedback preserves final geometry and cancellation

系统 SHALL 在套索绘制过程中持续显示轨迹并更新临时选区，允许合并中间输入的显示与查询，但 MUST 保留全部有效输入用于最终相交选择；新输入到临时选区更新 p95 SHALL 不超过 100ms。正常结束 SHALL 包含最后一批有效输入，以完整轨迹和开始时有效的文档版本计算最终结果；结果非空切换选择工具，结果为空保持套索工具。纯套索操作 MUST 不更改文档或新增 undo 事务。

#### Scenario: End arrives before queued preview update

- **WHEN** 高频输入尚有未显示的批次时正常抬起
- **THEN** 最终选区与对全部有效轨迹执行既有相交规则的结果一致，包含末批命中、保留文档顺序，随后延迟回调不覆盖最终结果

#### Scenario: Cancellation restores previous selection

- **WHEN** 套索因 Escape、pointercancel、捕获丢失、失焦、切换工具或卸载而取消
- **THEN** 在原文档版本仍有效时恢复手势前选区并清空轨迹，取消待执行工作，迟到回调不改写后续手势；文档变化时清理旧手势且不重新选中已删除对象

#### Scenario: Geometry and editing remain compatible

- **WHEN** 套索跨过变换后的笔画、形状、文字和图片，包含边界接触、自交及退化轨迹，然后移动、缩放或旋转选中对象并撤销重做
- **THEN** 选择结果遵循既有几何命中和退化处理规则，变换及撤销重做保持原有事务语义，取消和纯圈选不新增绘图事务

#### Scenario: Live selection is not deferred until release

- **WHEN** 用户按住并继续绘制有效套索而不抬起
- **THEN** 临时选区按最新有效轨迹持续更新，延迟满足 100ms 的 p95 门槛，不能通过取消绘制中的查询反馈来满足帧率指标
