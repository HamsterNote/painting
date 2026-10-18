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

### Requirement: Bezier creation uses a line and two control placements

贝塞尔工具 SHALL 首先以按下、拖动、松手确定起点和终点，预览为直线；随后两次点击依次指定第一、第二控制点。移动轨迹 MUST NOT 被当作控制点采样。最后一次确认前只有临时预览，完成后存储 `[起点, 控制点1, 控制点2, 终点]` 并形成一个可逆事务；Escape、pointercancel、失焦、卸载或切换工具取消整个未完成草稿。

#### Scenario: Drag endpoints then place both controls

- **WHEN** 用户拖出 A 到 D 的直线并松手，随后点击 B 和 C
- **THEN** 第一次松手及第一次点击不新增历史，第二次点击完成一个 points 为 `[A,B,C,D]` 的贝塞尔，撤销/重做为一次操作

### Requirement: Polygon creation places vertices and closes on double click

多边形工具 SHALL 按逐次点击追加顶点并连线，指针移动仅更新下一段预览，不将拖动轨迹写为顶点；至少三个顶点后双击闭合。双击确认 MUST NOT 重复追加相同终点，完成前不写历史，完成为一个可逆事务；取消整个草稿不留对象。

#### Scenario: Click vertices then double click to close

- **WHEN** 用户依次点击多个顶点，在最后一个顶点双击
- **THEN** 历史中出现一个闭合多边形，只包含点击确认的不同连续顶点，无移动采样点或重复终点，undo/redo 一次移除/恢复整个对象

### Requirement: Minimap background follows virtual paper visibility

小地图 SHALL 与主编辑器的虚拟纸张显示状态一致；关闭纸张时背景为纯白且不渲染纸张矩形，开启时才显示纸张及其周围底色。背景开关 MUST NOT 隐藏文档对象或另建 viewport 状态。

#### Scenario: Turning paper off removes it from the minimap

- **WHEN** 用户通过真实工具栏开启、再关闭虚拟纸张
- **THEN** 主画布和小地图同步显示/移除纸张，关闭后小地图空白区域为纯白，文档对象与历史不变

### Requirement: Virtual paper starts horizontally centered

虚拟纸张在进入页面后的首次呈现时 SHALL 默认横向居中，使用唯一 controller viewport 的 `tx = (可绘制宽度 - 794 × zoom) / 2`（默认纸张世界宽度 794，zoom 即 viewport scale），保持原 ty 和 scale。主图、活动层、历史层、小地图 viewport SHALL 同步使用此变换，不另加 CSS 平移。此初始化 SHALL 每个挂载的 controller/placement 只成功应用一次，后续 resize、平移缩放与纸张隐藏/重显不覆盖用户位置。显式 top-left 与完整 center 配置 SHALL 保留。

#### Scenario: Zoom and narrow surfaces use the same initial placement

- **WHEN** 用户在不同宽度和 zoom 下首次开启纸张
- **THEN** 两侧间距相等（纸宽超过屏幕时允许负间距），ty 不变，小地图指示区域的 x 等于 `-tx / scale`，后续调整 viewport 不重新居中

#### Scenario: Resize and visibility changes preserve the initialized viewport

- **WHEN** 默认纸张首次在宽 1280、zoom=1 的可绘制区呈现，随后改变窗口尺寸、缩放或隐藏再显示纸张
- **THEN** 初始 tx=243、ty 不变；后续仅执行相应 resize/导航/显示操作，不再次应用居中公式或重置当前 viewport
