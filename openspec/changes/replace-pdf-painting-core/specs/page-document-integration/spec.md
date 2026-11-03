## ADDED Requirements

### Requirement: Explicit deterministic migration

painting SHALL 提供显式 API 将旧 DrawingValue / schema 1、2 文档转换为 schema 3 EditorDocument，保持坐标、颜色、宽度、压力、顺序和支持的对象语义；不修改输入。输出 SHALL 可序列化且可再次迁移，结果幂等。未知版本或非法对象 SHALL 整次失败并返回路径，不静默省略。

#### Scenario: Repeated upgrade preserves the source

- **WHEN** 同一旧页多次迁移，并把输出再次输入
- **THEN** 得到值相等的 schema 3 文档，原数据不变

#### Scenario: Invalid data cannot overwrite saved ink

- **WHEN** 文档包含重复 ID、未知工具、未知 schema 或非有限坐标
- **THEN** API 返回失败和原始位置，不返回部分文档

#### Scenario: Tool dispatch cannot bypass common style validation

- **WHEN** 正常笔迹与公共样式字段非法的 pen、text 或 image 混合输入，即使该工具不使用该字段
- **THEN** API 整次失败并返回非法字段的原始路径，不修改源输入；合法普通 pen 仍迁移为 freehand

### Requirement: One page coordinate contract

painting SHALL 提供页面几何 API 与页面绘图表面，页面坐标长期稳定，显示和输入共享正逆仿射；宿主只传页面几何和当前变换。页面表面 SHALL 透明，由宿主管理导航，页面/几何切换取消未完成事务。

#### Scenario: Zoom scroll and rotation retain anchors

- **WHEN** 宿主更新页面矩阵、滚动容器或重新挂载页面
- **THEN** 同一页面点的输入和历史显示对齐，持久化坐标不随导航改写

#### Scenario: No cross-page partial stroke

- **WHEN** 未完成笔迹中途切换页面标识或几何
- **THEN** 不提交残笔，迟到 pointerup 不会写入新页

#### Scenario: Disabled pages retain their complete saved display

- **WHEN** 页面以 `enabled=false` 首次挂载、重新挂载或接收 controller 文档更新
- **THEN** 展示完整的已保存对象，输入监听保持禁用、事件可穿透到底层页面；切换 enabled 不销毁展示订阅，禁用仍取消未完成输入

### Requirement: Additive public release

painting SHALL 保持既有 controller/board/read API，通过 minor 正式版本导出新增能力；库不得读写 v4 blob 或提供降级投影。新增形状样式 SHALL 在 reader、controller、几何与显示路径一致保留。

#### Scenario: Existing consumers remain valid

- **WHEN** 现有 0.7 消费方不使用新增 API
- **THEN** 既有行为与公开入口测试通过
