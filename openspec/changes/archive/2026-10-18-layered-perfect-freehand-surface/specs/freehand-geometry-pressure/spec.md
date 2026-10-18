# Spec Delta

## Purpose

定义自由笔在各平台共享的原始输入记录、压力模式与几何输出契约，使重放、编辑和活动转历史保持一致，并明确排除旧中心线与自有插值兼容路径。

## ADDED Requirements

### Requirement: Raw sample document fidelity

系统 SHALL 只持久化实际接受的输入坐标、来源压力、时间、阶段等原始样本，以及落笔 brush snapshot 和 resolved pressure mode；坐标允许 screen-to-world 转换，真实硬件 coalesced 样本允许接收，私有平滑插值、预测点和派生轮廓 MUST NOT 写入文档。

#### Scenario: Raw batch persists without invented samples

- **WHEN** 一笔接收主 pointer event、真实 coalesced 样本及预测预览点后提交
- **THEN** 文档按输入顺序仅包含接受的真实样本及快照，不包含预测点、生成的中间点或轮廓

#### Scenario: Release pressure remains raw

- **WHEN** 有效接触压力后收到 up 阶段压力为零的真实样本
- **THEN** 文档保留该原始零压力及阶段，最终几何以最后有效接触压力收尾，不修改原始记录或中途切模式

### Requirement: Pressure mode locks at stroke begin

系统 SHALL 支持 auto、real、simulated、constant，默认 auto；auto SHALL 在落笔时按 pointerSource 和 adapter capability 解析并锁定，报告压力的 pen 使用 real，mouse/touch 及明确不可报告压力的原生 pen 使用 simulated。系统 MUST NOT 根据压力是否大于零、恒为 0.5 或是否变化推断/中途切换模式；显式 real MUST 不模拟，constant MUST 不因压力改变宽度。

#### Scenario: Auto source routing is stable

- **WHEN** 压力能力可用的 pen 以恒定 0.5 开始书写，或者 mouse/touch 以正压力开始书写
- **THEN** pen 全笔解析为 real，mouse/touch 全笔解析为 simulated，后续压力变化不改变结果

#### Scenario: Unavailable pressure and explicit modes

- **WHEN** adapter 明确声明原生 pen 不报告压力，或用户显式选择 real、simulated、constant
- **THEN** auto 选择 simulated；显式模式保持用户选择，real 不使用模拟，constant 的宽度不随输入压力改变

### Requirement: Shared deterministic filled geometry

系统 SHALL 以同一自由笔几何规则生成活动与最终填充轮廓，由几何算法独占平滑，不使用旧逐段中心线 fallback。模拟压力 SHALL 基于点间距离而非真实时间速度；相同样本和笔刷快照 SHALL 生成相同最终轮廓，活动与最终收尾状态 SHALL 显式区分。

#### Scenario: Tap and short stroke converge

- **WHEN** 单点落笔或极短笔迹结束
- **THEN** 活动预览和最终填充笔迹均可见，最终采用结束状态生成并形成有效圆润收尾，不丢笔或回退到线段

#### Scenario: Simulation ignores timestamp speed

- **WHEN** 两笔具有相同坐标顺序和笔刷但时间间隔不同，使用 simulated
- **THEN** 最终轮廓一致；时间仍保存在原始样本中而不驱动模拟宽度

### Requirement: Revisions invalidate derived geometry

系统 SHALL 将轮廓视为可丢弃缓存，不作为持久事实；样本、笔刷或几何规则版本改变 MUST 失效相应缓存。对象移动/缩放/旋转 SHALL 使用对象变换而不改写原始样本；撤销/重做 SHALL 恢复样本、笔刷和变换的正确版本。

#### Scenario: Edit and replay cannot reuse stale geometry

- **WHEN** 修改笔宽或样本后重绘，随后撤销与重做
- **THEN** 每个版本显示对应轮廓，不复用旧笔刷/样本缓存；保存数据没有派生轮廓

#### Scenario: Transform preserves raw input

- **WHEN** 自由笔对象被移动、缩放和旋转
- **THEN** 原始样本与落笔快照不变，对象变换与显示/命中同步更新且可以撤销
