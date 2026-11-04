# Spec Delta

## Purpose

为 painting 的绘图工具栏定义面向用户的分组、视觉状态、工具可达性与交互边界，使参考图中的底部悬浮胶囊在浏览器和 Expo DOM 承载场景下具有一致、可验收的操作体验，并保留既有绘图、导航和撤销行为。

## ADDED Requirements

### Requirement: Floating toolbar has ordered groups and clear states

画板默认工具栏 SHALL 在所属画板底部居中悬浮，依次显示撤销/重做、缩放比例、统一工具菜单、笔宽、设置/选择/橡皮擦/套索/移动/清空画布独立组、调色板；统一工具入口 SHALL 显示当前工具名称，选择/橡皮擦/套索/移动选中时仅对应独立按钮高亮。工具栏 SHALL 使用浅灰底、圆角胶囊、分组细竖线与紫底白字选中态，普通、悬停、按下、禁用、焦点和选中态 SHALL 可区分。默认激活工具与颜色 SHALL 来自当前编辑器状态，不为匹配示意图强制切换。

#### Scenario: Wide board presents the reference structure

- **WHEN** 以1280或1440 CSS px宽度打开画板，工具栏展开
- **THEN** 全部分组按上述顺序呈现为单行，胶囊高60px、外圆角30px、底边距16px加底部安全区，背景为#F5F6F8，边框为#E2E5EA，主操作间距4px，组边缘至1px宽分隔线间距8px

#### Scenario: Selecting text distinguishes selection from focus

- **WHEN** 用户激活文字，再通过键盘移动焦点到另一个控件
- **THEN** 统一工具入口显示文字并保持#7163D9底和#FFFFFF图文，其他工具按钮不选中；新焦点有独立2px紫色焦点环，既有历史禁用状态仍正确

### Requirement: All existing tools and settings remain reachable

工具栏 SHALL 保留自由笔、直线、矩形、椭圆、多边形、贝塞尔、文字、图片、选择、套索、橡皮擦、平移十二种工具及原有语义。首层 SHALL 提供统一工具菜单（画笔、直线、矩形、椭圆、多边形、贝塞尔、图片、文字），画笔 SHALL 为首项且映射原freehand；选择、橡皮擦 SHALL 移出菜单，和设置、套索、移动、清空画布 SHALL 在独立组直接可达，移动映射既有平移工具。设置 SHALL 包含原三档输入模式、尺子、虚拟纸张、小地图及适用工具的自定义颜色、不透明度、压力或线型；不得用菜单化删除既有能力。

#### Scenario: Secondary tools can be selected without changing their semantics

- **WHEN** 用户从统一工具菜单激活椭圆，随后点击套索，再从统一菜单进入文字
- **THEN** 当前工具依次为椭圆、套索、文字，对应入口显示当前工具并高亮，已有对象与历史不因入口变化而改变

#### Scenario: Settings remain available outside freehand

- **WHEN** 用户处于文字、平移或选择工具，点击独立设置按钮并切换输入模式、尺子、纸张或小地图
- **THEN** 三档输入模式原名称/选项及导航开关仍可用，不强制切换所选工具；仅更新相应输入或导航状态，不新增文档撤销事务

#### Scenario: Tool families retain independent settings

- **WHEN** 用户设置形状虚线后切自由笔，在独立笔宽组修改笔宽、在设置面板修改不透明度、压力和自定义颜色，再切回形状
- **THEN** 自由笔没有线型控件，形状虚线与原形状参数保留；自由笔配置独立保存，任意有效自定义颜色不被六色预设限制

### Requirement: Completed lasso switches to selection

套索 SHALL 在完成有效路径且命中对象后自动切换到选择工具，保留全部命中选区并清理预览，不产生文档或历史事务。拖动期间、取消、空/退化路径或失效手势 SHALL 不自动切换。

#### Scenario: Lasso selection can be moved immediately

- **WHEN** 用户套住一个或多个对象并抬笔，再直接拖动命中选区
- **THEN** 抬笔后选择按钮激活、工具为selection、选区不丢失，下一拖动可移动对象并形成一次可撤销事务

#### Scenario: Empty and cancelled lasso keep the lasso tool

- **WHEN** 用户完成无命中的套索或取消已有命中的套索预览
- **THEN** 仍在套索工具，取消恢复原选区，文档与历史不变

### Requirement: History and zoom use authoritative editor state

撤销/重做 SHALL 根据已有历史可用性禁用或启用，并保持一次既有事务的撤销语义。缩放入口 SHALL 显示当前权威比例，打开后提供25–800%、步长25的滑动条与百分比读数，不提供缩放数值输入。滑动条 SHALL 以所属绘图可视区域中心为锚点，同时更新scale/tx/ty，保持该中心对应的世界内容位置不变；锚点 SHALL 按每次输入时的实际绘图可视区域计算，不以纸张左上角为基准。非法命令 SHALL 不提交；状态过期或书写冻结导致拒绝时 SHALL 恢复当前有效比例，不绕过输入会话或建立独立视口。

#### Scenario: External zoom and undo are reflected

- **WHEN** 已提交一笔后用户撤销并重做，之后画布通过合法导航变成125%
- **THEN** 同一笔仅被移除/恢复一次，按钮可用性与历史一致，比例显示125%，工具栏没有自己的独立缩放状态

#### Scenario: Slider zoom keeps visible center content fixed

- **WHEN** 已平移且缩放的画板中，用户拖动缩放条，随后改变画板尺寸并再次缩放
- **THEN** 每次变换前视口可见中心下的世界点仍投影在同一屏幕位置，scale改变且tx/ty相应改变；文档与历史不变，不将纸张原点固定

#### Scenario: Invalid or rejected zoom cannot move ink

- **WHEN** 用户拖动滑动条时版本过期或处于书写冻结期间
- **THEN** 不应用非法或被拒绝的缩放，控件恢复当前有效比例，文档与当前笔位置不变，不在笔结束后补执行

### Requirement: Palette updates only supported drawing styles

调色板 SHALL 按黑#2D2D2D、蓝#7FA3C3、绿#8FBA8D、黄#D5B984、粉#CD9BAA、紫#AB9CC2顺序显示六点。每点 SHALL 有24px色面和约30.67×44px不重叠命中区域，色面留白约6.67px（原20px的1/3），选中项 SHALL 同时有与该预设色一致的环和勾号及可访问选中状态。自由笔或线/形状下选色 SHALL 只更新当前工具族后续绘制设置，不重涂已有对象；其他工具下 SHALL 禁用并说明用途。非预设当前色 SHALL 不伪造某预设选中。新编辑器的自由笔与形状 SHALL 默认黑色，不覆盖现有快照。最右 SHALL 提供自由取色环，内部多色，仅当前色不匹配预设且工具支持颜色时active并显示当前色外轮廓，非active时无外轮廓；匹配预设时仅相应预设active，键盘焦点提示独立保留，选择任意有效颜色只更新当前工具族；不支持颜色的工具下该控件也禁用。

#### Scenario: Freehand and shape colors remain independent

- **WHEN** 用户在自由笔下选蓝，切矩形选黑，再回自由笔
- **THEN** 自由笔为蓝、形状为黑，调色板正确反映当前工具族，已有对象颜色和历史不变

#### Scenario: Text and custom colors are represented honestly

- **WHEN** 用户进入文字工具，之后回到已设置非预设自定义颜色的自由笔
- **THEN** 文字模式六点禁用且说明用于绘图或形状；自由笔模式六点均未选中，自定义色仍保留并由最右取色环外轮廓表示，可直接编辑

#### Scenario: Preset and custom outlines are mutually exclusive

- **WHEN** 用户依次选择预设蓝色、非预设自定义色、预设黑色并切换工具族
- **THEN** 蓝色激活环为蓝色；自定义色时仅自由取色环有当前色轮廓；黑色时仅黑色有黑色激活环，自由取色无轮廓；工具族切换后状态由该族颜色派生

### Requirement: Collapse uses an independent circular control

工具栏 SHALL 默认展开。收起/展开 SHALL 使用位于胶囊上方、间隔8px的独立44×44px圆形按钮，不进入胶囊滚动区域。收起 SHALL 隐藏胶囊与弹层，仅保留展开按钮；展开 SHALL 保留工具、参数并恢复焦点。展示状态 SHALL 仅属于本次挂载，不写文档、历史或输入偏好。

#### Scenario: Collapse preserves state and focus

- **WHEN** 用户收起并展开工具栏，随后卸载重新挂载
- **THEN** 收起时仅圆形展开按钮可见，展开后焦点在收起按钮；重新挂载默认展开，工具/设置/文档/历史/输入偏好不变

### Requirement: Clear canvas is one reversible operation

清空画布 SHALL 通过当前document revision的一次对象编辑删除全部对象，空画布 SHALL 禁用；成功后清理预览和失效选择，不改变当前工具与样式。活动书写或版本冲突时 SHALL 遵循控制器拒绝，不排队、不重试。

#### Scenario: Clear can be undone once

- **WHEN** 画布已有多个对象，用户清空并撤销
- **THEN** 清空后对象为零且清空按钮禁用，一次撤销恢复全部对象，重做再次清空

#### Scenario: Active writing is preserved

- **WHEN** 已有对象且正在书写时触发清空
- **THEN** 对象、历史和活动笔保持不变，结束后不补执行清空

### Requirement: Narrow layouts and keyboard operation preserve access

工具栏 SHALL 限于所属画板宽度、左右至少留16px，内容超宽时内部单行横向滚动，分组不拆分且一般触控目标不小于44×44px，紧凑调色板采用上述约30.67×44px尺寸，不使画板或宿主页面横向溢出。键盘聚焦 SHALL 将目标滚入可见区域。菜单与设置面板 SHALL 在可见区域内可操作，支持键盘选项导航、Escape关闭并返回触发器，以及可访问名称/展开状态。

#### Scenario: Small board retains every control

- **WHEN** 在320/390/768/1024px宽度或浏览器200%缩放下展开工具栏并按Tab遍历
- **THEN** 内容超宽时可在胶囊内部滚到所有分组，焦点目标可见；组顺序和按钮尺寸不变，宿主无新增横向溢出，弹层不被裁成不可操作

### Requirement: Toolbar keeps host and input boundaries

工具栏 SHALL 同时支持浏览器与 Expo DOM/WebView 宿主；不宣称其DOM实现可直接作为原生RN控件。现有隐藏工具栏参数和独立使用入口 SHALL 保持可用。覆盖层空白区域 SHALL 允许画布正常输入，真实控件与弹层 SHALL 保持安全交互边界。静态标签 SHALL 禁选，数值/文本输入 SHALL 保留原生编辑。工具栏 SHALL 延续原有首次输入偏好恢复与画布手势跨界防误触契约，且不得因显示状态改变重置视口或文档。

#### Scenario: Floating controls do not steal canvas input

- **WHEN** 笔从画布空白区域落下、经过悬浮工具栏并结束，之后用户主动点击工具按钮
- **THEN** 空白覆盖区域不阻断起笔，跨界不误执行命令或选择标签，笔按既有会话契约结束且不重复提交，后续主动首击立即有效

#### Scenario: Embedded board and standalone usage remain usable

- **WHEN** 在Web或Expo DOM中分别打开两个画板、隐藏其中一个工具栏，或独立使用工具栏
- **THEN** 浮动工具栏仅定位于各自画板，隐藏参数有效，独立入口仍可操作；输入模式按原初始化约束就绪，不影响另一个画板

#### Scenario: Inputs remain editable after remount

- **WHEN** 用户在面板中选择替换笔宽数字并键盘调节缩放滑动条，关闭或卸载后重新挂载并操作
- **THEN** 原生选择、焦点与编辑可用，静态标签仍禁选，不残留交互锁或吞掉首击

### Requirement: Zoom readout width is stable

比例入口 SHALL 固定72px宽，使用等宽数字，缩放变化 SHALL 不改变胶囊宽度、内容滚动宽度和后续组位置。

#### Scenario: Percent changes do not shift the toolbar

- **WHEN** 在1280/390/320px宽度依次显示100%、125%、200%、25%、800%
- **THEN** 比例按钮宽度、胶囊宽度及scrollWidth完全一致，组位置不抖动，窄屏仍可横滚

### Requirement: Stroke width is a primary tool parameter

笔宽 SHALL 从设置面板移到紧跟统一工具菜单的独立常驻组，使用64×44px数值输入，范围0.5–200、步长0.5。值 SHALL 来自当前工具族权威参数并调用原控制器设置命令，无额外持久化复本；自由笔与形状独立，其他工具显示禁用占位。设置面板 SHALL 不再包含笔宽。

#### Scenario: Width follows tool families and external updates

- **WHEN** 自由笔笔宽设为12，形状笔宽设为3，切换工具或外部更新当前参数
- **THEN** 首层输入反映当前族参数，其他工具禁用，切回时各族值保留，不产生文档历史或重涂旧对象

#### Scenario: Width survives committed object undo and reload

- **WHEN** 分别用不同笔宽绘制对象并撤销/重做，再序列化并重载文档
- **THEN** 各对象原始笔刷/形状宽度保持一致，主栏参数继续遵循原控制器语义，拖尾等展示状态不写入文档

### Requirement: Eraser trail is transient feedback

有效擦除输入 SHALL 在独立、事件透传的SVG叠加层显示12px圆头淡紫轨迹，每段从采样时起线性渐隐并在2000ms完全消失；新段 SHALL 不延长旧段寿命。轨迹 SHALL 跟随既有viewport，不进入文档、preview或撤销栈；无拖尾时 SHALL 无动画或计时循环，不使用常驻RAF。

#### Scenario: Eraser feedback fades without changing saved history

- **WHEN** 用户擦除并抬笔
- **THEN** 中间帧仍可见渐隐轨迹，擦除事务按原语义只提交一次，每段2秒后移除，文档/history不因渐隐改变，空闲没有RAF

#### Scenario: Lifecycle transitions clear all feedback

- **WHEN** 拖尾仍可见时切工具、取消输入、清空画布、撤销/重做、失焦、页面隐藏/离开或卸载
- **THEN** 轨迹节点和到期计时器立即清理，未完成擦除沿用原取消语义，重新进入不残留旧拖尾
