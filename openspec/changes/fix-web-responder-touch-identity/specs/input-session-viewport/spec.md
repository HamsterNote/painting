# Spec Delta

## ADDED Requirements

### Requirement: Web touch identities remain distinct throughout their lifetime

系统 SHALL 正确区分浏览器提供的不同 touch identifier，包括负数、大整数和取模同余值；一个触点结束或取消 MUST NOT 使另一个仍存活的触点失效。合法单指、双指、多指及笔指混合输入 SHALL 不产生 “Cannot find single active touch” 或丢失 start 的伪错误提示，开发期其他真实错误仍 SHALL 正常报告。此保证 SHALL 同时适用于启用与关闭诊断的 Web 编辑器，不改变原始 pointerId 或 HAM-44 输入归属语义。

#### Scenario: Distinct contacts survive reduction to one finger

- **WHEN** 三档分别在纸面落下 identifier 为 1/21、21/41 或 -1/-2 的两指，移动后先抬任意一指，再移动并抬起另一指
- **THEN** 活动触点保持正确身份，控制台与开发提示均无单一活动触点错误；双指仅导航，残留指不补提交笔迹，全部抬起后的新输入正常

#### Scenario: Third contact and cancellation preserve subsequent input

- **WHEN** 双指导航中第三指加入，原 pair 一指抬起，随后其余触点结束或取消，并重复开始新手势至少 50 轮
- **THEN** 第三指不替补原 pair，触点状态完全释放，下一轮无旧身份串扰或 start 缺失警告，文档及历史不产生导航引起的对象

#### Scenario: Writing and ownership rules remain intact

- **WHEN** 任一档位下笔正在绘制，同时双指落下并移动，笔先抬起、触点随后排空，或一指从控件区域落下后移入纸面
- **THEN** 笔只提交一次，视口保持书写冻结且不补执行竞争触摸；控件触点维持 down-time 归属，不成为纸面第二指；无触摸历史伪错误

#### Scenario: Diagnostics and native pointer identities are independent

- **WHEN** 相同触摸序列分别在普通入口和诊断入口运行，且浏览器原始 pointerId 为负值
- **THEN** 两个入口均正常绘制或导航且无伪错误，应用原始 pointerId 与三档行为保持一致；注入无关测试错误时开发错误通道仍可见
