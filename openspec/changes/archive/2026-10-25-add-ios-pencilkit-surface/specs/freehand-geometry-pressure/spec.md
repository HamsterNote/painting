# Spec Delta

## MODIFIED Requirements

### Requirement: Shared deterministic filled geometry

系统 SHALL 以同一自由笔几何规则生成最终填充轮廓，Web 活动预览 SHALL 使用同一规则，由共享几何算法独占该路径平滑，不使用旧逐段中心线 fallback。iOS 原生 Pencil 自由笔 SHALL 允许仅在临时活动预览使用系统近似墨迹，不要求其与最终轮廓像素一致；该预览不得作为最终几何或持久化事实，其向最终轮廓收敛的可见差异 SHALL 纳入设备验收。模拟压力 SHALL 基于点间距离而非真实时间速度；相同样本和笔刷快照 SHALL 生成相同最终轮廓，活动与最终收尾状态 SHALL 显式区分。

#### Scenario: Tap and short stroke converge

- **WHEN** 单点落笔或极短笔迹结束
- **THEN** 活动预览和最终填充笔迹均可见，最终采用结束状态生成并形成有效圆润收尾，不丢笔或回退到线段

#### Scenario: Simulation ignores timestamp speed

- **WHEN** 两笔具有相同坐标顺序和笔刷但时间间隔不同，使用 simulated
- **THEN** 最终轮廓一致；时间仍保存在原始样本中而不驱动模拟宽度

#### Scenario: Native preview does not replace final geometry

- **WHEN** iOS 原生墨迹完成并保存文档，再在 Web 重放相同 raw 和快照
- **THEN** 两端最终轮廓使用同一共享规则，存档无原生预览路径；抬笔时外观差异有设备对照记录，不声称原生预览与最终轮廓相同
