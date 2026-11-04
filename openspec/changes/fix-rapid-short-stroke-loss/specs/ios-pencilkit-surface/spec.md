# Spec Delta

## MODIFIED Requirements

### Requirement: Bridge commits are authoritative and idempotent

原生输入 SHALL 使用版本化且带编辑器世代、会话、commitId 和锁定 viewport/layout 版本的协议。只有被 controller 接受的 begin 才能完成提交，真实样本在原生收集后批量传输，系统不要求逐点跨桥。系统 SHALL 在改变文档前验证完整批次；同 commitId 同 payload 重试不得重复新增文档或历史，不同 payload SHALL 明确拒绝。样本、字节及待处理队列 SHALL 有限，超限或协议失败 SHALL 报告原因而非截断成功。在已公布资源容量内，前笔已结束但尚未退休预览 SHALL 不阻止下一笔取得独立归属；连续短笔不得因 begin 回复晚于 up 或与前笔交接交错而静默丢失、复用前笔或交替拒绝。

#### Scenario: Begin reply arrives after release

- **WHEN** 用户快速 down/up，正常 begin 回复晚于原生 end 到达
- **THEN** 原生批次等待权威回复；接受后只提交一次，拒绝则清理未提交预览且文档/history 不变

#### Scenario: Retry and conflicting duplicate are distinguished

- **WHEN** 已成功提交的批次因回复丢失而重发，之后同 commitId 收到修改后的 payload
- **THEN** 第一次重发返回 duplicate 且不新增历史，修改后的批次返回 conflict 且不改变原文档

#### Scenario: Invalid revision or oversized batch cannot partly commit

- **WHEN** 批次使用失效的 viewport/layout 版本、非法/不完整样本或超过公布的资源限额
- **THEN** 整笔拒绝并报告可诊断原因，不生成部分对象或 undo entry，不使用过期坐标显示最终笔迹

#### Scenario: Short strokes survive earlier preview retirement

- **WHEN** 显式开启且已就绪的 PencilKit 入口中，上一笔 raw end 已完成、预览仍待退休，用户在容量内连续完成下一笔，期间 begin 回复晚于该笔 up，旧退休回执交错到达
- **THEN** 每笔使用独立身份并各提交一次，raw 首尾样本保持完整，旧回执不删除新笔或复用旧预览，空闲交接完成后队列和待退休状态收敛

#### Scenario: Native short and long strokes share the completion guarantee

- **WHEN** 容量内以相同起笔频率和接触时长分别完成连续短笔及长笔，随后按统一历史逐笔 undo/redo，并在 PencilKit 关闭的同设备 DOM 入口进行对照
- **THEN** 两入口的每个有效完成笔均对应一个对象和一个历史事务，最终笔迹可见；原生和 DOM 结果分开记录，合成输入结果不得替代实体 Pencil 采样与交接验收

#### Scenario: Capacity rejection remains explicit and recoverable

- **WHEN** 测试故意延迟退休直至达到公布容量，随后释放积压并开始新的 Pencil 笔
- **THEN** 超限明确报告且不截断成功、不生成部分历史，既有完成笔保留，积压清理后新笔正常；不得用该故障注入结果代替容量内连续短笔验收
