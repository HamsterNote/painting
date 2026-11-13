# Spec Delta

## MODIFIED Requirements

### Requirement: Shared deterministic filled geometry

系统 SHALL 以同一共享自由笔规则生成 Web 活动与所有平台最终填充轮廓，由几何算法独占最终平滑，不使用旧逐段中心线 fallback。显式启用的 iOS/Android 原生自由笔 SHALL 允许临时近似预览，但最终仍使用同一接受样本、笔刷快照与共享确定性几何，不将原生渲染路径持久化。模拟压力 SHALL 基于点间距离而非真实时间速度；相同样本和笔刷快照 SHALL 生成相同最终轮廓，活动与最终收尾状态 SHALL 显式区分。原生到最终外观收敛 SHALL 提供设备对照并由用户确认。

#### Scenario: Tap and short stroke converge

- **WHEN** 单点落笔或极短笔迹结束
- **THEN** 活动预览和最终填充笔迹均可见，最终采用结束状态生成并形成有效圆润收尾，不丢笔或回退到线段

#### Scenario: Simulation ignores timestamp speed

- **WHEN** 两笔具有相同坐标顺序和笔刷但时间间隔不同，使用 simulated
- **THEN** 最终轮廓一致；时间仍保存在原始样本中而不驱动模拟宽度

#### Scenario: Native preview does not become a second geometry authority

- **WHEN** iOS 或 Android 显式原生通道结束一笔并在 Web 重放其文档
- **THEN** 最终轮廓由共享规则产生且可确定性重放，不从原生平滑/预测路径补造样本，不要求临时预览逐像素等于最终形状
