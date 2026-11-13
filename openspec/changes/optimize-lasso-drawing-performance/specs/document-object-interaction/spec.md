# Spec Delta

## ADDED Requirements

### Requirement: Scheduled lasso feedback preserves final geometry and cancellation

系统 SHALL 在套索绘制过程中只显示轨迹并保留手势前选区；begin/update MUST NOT 准备几何、执行几何查询或提交临时选区。允许合并中间输入的显示，但 MUST 保留全部有效输入用于正常结束时的一次最终相交选择。正常结束 SHALL 包含最后一批有效输入，以完整轨迹和开始时有效的文档版本计算最终结果；结果非空切换选择工具，结果为空保持套索工具。纯套索操作 MUST 不更改文档或新增 undo 事务。

#### Scenario: End arrives before queued preview update

- **WHEN** 高频输入尚有未显示的批次时正常抬起
- **THEN** 最终选区与对全部有效轨迹执行既有相交规则的结果一致，包含末批命中、保留文档顺序，随后延迟回调不覆盖最终结果

#### Scenario: Cancellation restores previous selection

- **WHEN** 套索因 Escape、pointercancel、捕获丢失、失焦、切换工具或卸载而取消
- **THEN** 在原文档版本仍有效时恢复手势前选区并清空轨迹，取消待执行工作，迟到回调不改写后续手势；文档变化时清理旧手势且不重新选中已删除对象

#### Scenario: Geometry and editing remain compatible

- **WHEN** 套索跨过变换后的笔画、形状、文字和图片，包含边界接触、自交及退化轨迹，然后移动、缩放或旋转选中对象并撤销重做
- **THEN** 选择结果遵循既有几何命中和退化处理规则，变换及撤销重做保持原有事务语义，取消和纯圈选不新增绘图事务

#### Scenario: Selection is computed once on release

- **WHEN** 用户按住并继续绘制有效套索而不抬起
- **THEN** 持续更新轨迹，几何准备和查询次数保持为零；正常抬起后按完整轨迹查询一次并提交最终结果。此契约由 2026-11-13 用户决定替代原实时选区要求，不表示原实时指标已通过
