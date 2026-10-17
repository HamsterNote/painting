# Spec Delta

## Purpose

明确分层改造后继续提供的文档编辑能力、工具配置隔离及几何命中行为，让文字输入、选择变换和整对象擦除在 DOM 与未来语义输入渠道下使用一致的对象模型。

## ADDED Requirements

### Requirement: Preserve object editing and undo semantics
系统 SHALL 保留直线、矩形、椭圆、多边形、贝塞尔、文字和图片，以及选择/套索、移动/缩放/旋转、撤销/重做。一次完成的绘制或编辑操作 SHALL 形成可逆文档事务；取消过程预览 MUST 不提交部分事务。

#### Scenario: Mixed editing survives undo and redo
- **WHEN** 用户创建上述类型对象、套索选中其中多个并移动/缩放/旋转，然后撤销与重做
- **THEN** 各对象内容、变换和文档顺序按事务恢复，显示及命中区域一致

### Requirement: Preserve navigation aids and IME composition
系统 SHALL 保留现有 ruler、virtual paper 与 minimap 功能，并通过唯一 Web viewport 执行其导航意图。HTML 文字输入 SHALL 保留 IME composition 行为，不将未完成 composition 提前提交为已完成文字事务。

#### Scenario: Existing navigation aids share viewport
- **WHEN** 用户使用现有 ruler、virtual paper 平移缩放或 minimap 导航
- **THEN** 其既有能力保持可用，历史与活动显示对齐于同一 Web viewport，而非新增独立变换权威

#### Scenario: Composition commits only accepted text
- **WHEN** 用户通过 IME 组合输入文字并确认，或在组合过程中取消文字编辑
- **THEN** 确认后提交最终文字而非重复中间 composition 内容，取消不将未完成组合写入文档

### Requirement: Separate freehand and shape styles
自由笔工具栏 SHALL 只提供颜色、标称笔宽、不透明度和压力模式，不显示或执行自由笔 dash，也不保留虚线 fallback 或算法滑块。直线/形状 SHALL 保留独立 dash 配置；切换自由笔 MUST 不清除形状 dash 设置或将旧 pressureMultiplier 直接解释为新几何参数。

#### Scenario: Dash does not leak across tools
- **WHEN** 设置形状虚线后切到自由笔，再切回形状
- **THEN** 自由笔为实心连续笔迹且无 dash 控件，形状仍使用此前独立虚线配置

### Requirement: Continuous whole-object erasure
橡皮擦 SHALL 基于相邻输入位置之间的连续扫掠及擦除半径查询候选对象几何，并删除整笔或整对象，不执行局部切割/pixel 擦除。系统 MUST 不仅依赖 DOM mouseover、单个终点或 DOM 被遮挡与否决定命中；未来 overlay 语义输入 SHALL 调用同一几何查询，而非伪造 DOM 事件。首期自由笔命中允许中心线加笔宽的近似，不要求轮廓布尔运算。

#### Scenario: Fast sweep and radius hit are not skipped
- **WHEN** 一次橡皮擦更新从对象一侧跨到另一侧，两个端点均在对象之外但扫掠半径与它相交
- **THEN** 对象整笔/整体被擦除，不因采样间隔或没有 mouseover 漏掉，撤销可恢复

#### Scenario: DOM occlusion is not the query source
- **WHEN** 对象被其他对象或输入 overlay 遮挡，橡皮擦语义扫掠经过其几何
- **THEN** 文档几何查询仍返回被扫掠候选，结果不依赖合成 hover/click 或浏览器元素命中

### Requirement: Point hit and DOM text focus are explicit
Web 普通 hover/click SHALL 支持从实际 DOM 目标定位对象；pointer capture 后的连续输入 MUST 使用轨迹几何查询而非把 captured target 当作当前位置命中。HTML 文字 SHALL 保留真实焦点、输入和键盘处理接口；原生承载/未来 overlay MUST 不声称天然穿透即可保证文字输入。

#### Scenario: Capture does not pin eraser target
- **WHEN** pointer 被活动层 capture 后移动至不同对象
- **THEN** 几何轨迹决定当前命中而非 capture 元素，普通未 capture 的点击仍能识别对象

#### Scenario: Hosted text editing owns focus
- **WHEN** 用户在 Web 或 Expo WebView 中进入文字编辑，输入并完成或取消
- **THEN** 真实 DOM 编辑器取得焦点并处理键盘，完成生成一次文档事务，取消不改写内容
