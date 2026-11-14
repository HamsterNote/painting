# painting-toolbar Specification

## Purpose

为 painting 的绘图工具栏定义面向用户的分组、视觉状态、工具可达性与交互边界，使参考图中的底部悬浮胶囊在浏览器和 Expo DOM 承载场景下具有一致、可验收的操作体验，并保留既有绘图、导航和撤销行为。

## Requirements

### Requirement: Floating toolbar has ordered groups and clear states

画板默认工具栏 SHALL 在所属画板底部居中悬浮，依次显示撤销/重做、可选文件入口、缩放比例、统一工具菜单、笔触设置按钮、设置/选择/橡皮擦/套索/移动/清空画布独立组；统一工具入口 SHALL 显示当前工具名称，选择/橡皮擦/套索/移动选中时仅对应独立按钮高亮。工具栏 SHALL 使用浅灰底、圆角胶囊、分组细竖线与紫底白字选中态，普通、悬停、按下、禁用、焦点和选中态 SHALL 可区分。默认激活工具与颜色 SHALL 来自当前编辑器状态，不为匹配示意图强制切换。底部原调色板位置 SHALL 不留占位或替代功能，删除多余尾部分隔线，胶囊按剩余内容自然收窄。

#### Scenario: Wide board presents the reference structure

- **WHEN** 以1280或1440 CSS px宽度打开画板，工具栏展开
- **THEN** 全部分组按上述顺序呈现为单行，胶囊高60px、外圆角30px、底部基础间距8px，未提供受控布局时加有效底部安全区（默认取宿主安全区，宿主可显式覆盖）；受控bottom布局使用8px加显式bottom inset，显式0不回退宿主安全区，背景为#F5F6F8，边框为#E2E5EA，主操作间距4px，组边缘至1px宽分隔线间距8px

#### Scenario: Selecting text distinguishes selection from focus

- **WHEN** 用户激活文字，再通过键盘移动焦点到另一个控件
- **THEN** 统一工具入口显示文字并保持#7163D9底和#FFFFFF图文，其他工具按钮不选中；新焦点有独立2px紫色焦点环，既有历史禁用状态仍正确

#### Scenario: Migrated palette leaves no empty toolbar group

- **WHEN** 用户打开默认工具栏并点击笔触设置按钮
- **THEN** 首层没有笔宽数字输入或调色板，末尾为画布操作组，无空颜色组或多余分隔线；笔触菜单内可找到全部颜色入口

### Requirement: All existing tools and settings remain reachable

工具栏 SHALL 保留自由笔、直线、矩形、椭圆、多边形、贝塞尔、文字、图片、选择、套索、橡皮擦、平移十二种工具及原有语义。首层 SHALL 提供统一工具菜单（画笔、直线、矩形、椭圆、多边形、贝塞尔、图片、文字），画笔 SHALL 为首项且映射原freehand；选择、橡皮擦 SHALL 移出菜单，和设置、套索、移动、清空画布 SHALL 在独立组直接可达，移动映射既有平移工具。一般设置 SHALL 保留原三档输入模式、尺子、虚拟纸张、小地图；笔宽、六色预设、自由取色、自定义颜色、不透明度及适用工具的压力或线型 SHALL 集中到笔触菜单，一般设置不再重复这些控件；不得用菜单化删除既有能力。笔触菜单 SHALL 为包含表单的可访问 dialog，支持键盘打开、Tab 编辑和 Escape 关闭返回触发器，与缩放、工具、一般设置及文件弹层互斥。

#### Scenario: Secondary tools can be selected without changing their semantics

- **WHEN** 用户从统一工具菜单激活椭圆，随后点击套索，再从统一菜单进入文字
- **THEN** 当前工具依次为椭圆、套索、文字，对应入口显示当前工具并高亮，已有对象与历史不因入口变化而改变

#### Scenario: Settings remain available outside freehand

- **WHEN** 用户处于文字、平移或选择工具，点击独立设置按钮并切换输入模式、尺子、纸张或小地图
- **THEN** 三档输入模式原名称/选项及导航开关仍可用，不强制切换所选工具；仅更新相应输入或导航状态，不新增文档撤销事务

#### Scenario: Tool families retain independent settings

- **WHEN** 用户设置形状虚线后切自由笔，在笔触菜单修改笔宽、不透明度、压力和自定义颜色，再切回形状
- **THEN** 自由笔没有线型控件，形状虚线与原形状参数保留；自由笔配置独立保存，任意有效自定义颜色不被六色预设限制

#### Scenario: Stroke dialog exposes all relevant settings

- **WHEN** 自由笔下打开笔触菜单，再切到形状并重新打开
- **THEN** 菜单依次提供笔宽、颜色、不透明度及压力／线型；笔宽标签、滑条与右侧数字输入同一行，颜色标签与色板同一行，笔宽／颜色／不透明度／压力标签左边缘同列对齐，色板下不出现独立「自定义颜色」行；自由笔压力保留自动、真实、模拟、恒定四种，形状提供实线／虚线且无压力项；一般设置不再重复笔触项，切换不改压力算法或原有绘制语义

#### Scenario: Stroke dialog closes and restores focus

- **WHEN** 用户用 Enter 或 Space 打开笔触菜单，Tab 到输入框编辑，再按 Escape；随后重开并收起工具栏
- **THEN** 输入可以原生选择替换，Escape 后焦点返回笔触按钮；收起关闭弹层，展开参数不变；打开其他弹层时笔触菜单关闭

### Requirement: Completed lasso switches to selection

套索 SHALL 在完成有效路径且命中对象后自动切换到选择工具，保留全部命中选区并清理预览，不产生文档或历史事务。拖动期间、取消、空/退化路径或失效手势 SHALL 不自动切换。

#### Scenario: Lasso selection can be moved immediately

- **WHEN** 用户套住一个或多个对象并抬笔，再直接拖动命中选区
- **THEN** 抬笔后选择按钮激活、工具为selection、选区不丢失，下一拖动可移动对象并形成一次可撤销事务

#### Scenario: Empty and cancelled lasso keep the lasso tool

- **WHEN** 用户完成无命中的套索或取消已有命中的套索预览
- **THEN** 仍在套索工具，取消恢复原选区，文档与历史不变

### Requirement: History and zoom use authoritative editor state

撤销/重做 SHALL 根据已有历史可用性禁用或启用，并保持一次既有事务的撤销语义。缩放入口 SHALL 显示当前权威比例，打开后提供25–800%、步长25的滑动条与百分比读数，不提供缩放数值输入。滑条 SHALL 使用6px高圆角轨道（未填充 #E2E5EA、已填充 #7163D9）、18px白色圆形滑块及2px紫色边框，交互区高至少44px，焦点使用独立2px紫色环并有2px偏移；轨道填充 SHALL 随当前有效比例变化。悬停、按下、禁用和焦点状态 SHALL 可区分，在浏览器及 Expo DOM/WebView 中不显示截图中的默认黑轨蓝柄外观。滑动条 SHALL 以所属绘图可视区域中心为锚点，同时更新scale/tx/ty，保持该中心对应的世界内容位置不变；锚点 SHALL 按每次输入时的实际绘图可视区域计算，不以纸张左上角为基准。非法命令 SHALL 不提交；状态过期或书写冻结导致拒绝时 SHALL 恢复当前有效比例，不绕过输入会话或建立独立视口。

#### Scenario: External zoom and undo are reflected

- **WHEN** 已提交一笔后用户撤销并重做，之后画布通过合法导航变成125%
- **THEN** 同一笔仅被移除/恢复一次，按钮可用性与历史一致，比例显示125%，工具栏没有自己的独立缩放状态

#### Scenario: Slider zoom keeps visible center content fixed

- **WHEN** 已平移且缩放的画板中，用户拖动缩放条，随后改变画板尺寸并再次缩放
- **THEN** 每次变换前视口可见中心下的世界点仍投影在同一屏幕位置，scale改变且tx/ty相应改变；文档与历史不变，不将纸张原点固定

#### Scenario: Invalid or rejected zoom cannot move ink

- **WHEN** 用户拖动滑动条时版本过期或处于书写冻结期间
- **THEN** 不应用非法或被拒绝的缩放，控件恢复当前有效比例，文档与当前笔位置不变，不在笔结束后补执行

#### Scenario: Styled zoom retains keyboard behavior

- **WHEN** 用户在1280、390或320px宽画板打开缩放，用鼠标或触控拖动，并用方向键、Home、End调节
- **THEN** 滑条为规定灰轨紫色填充和白色紫边滑块，值域25–800%、步长25；读数来自有效比例，填充比例为(当前比例−25)/(800−25)，焦点可见；72px比例入口及后续组位置不因数值改变而抖动

### Requirement: Palette updates only supported drawing styles

调色板 SHALL 整体位于笔触菜单的颜色分区，可见「颜色」标签 SHALL 与色板同一行并作为色板的可访问名称；底部栏不再提供调色板或自由取色副本，色板下 SHALL 不出现独立「自定义颜色」行或重复的原生色块。调色板 SHALL 按黑#2D2D2D、蓝#7FA3C3、绿#8FBA8D、黄#D5B984、粉#CD9BAA、紫#AB9CC2顺序显示六点。每点 SHALL 有24px色面和约30.67×44px不重叠命中区域，色面留白约6.67px（原20px的1/3），选中项 SHALL 同时有与该预设色一致的环和勾号及可访问选中状态。自由笔或线/形状下选色 SHALL 只更新当前工具族后续绘制设置，不重涂已有对象；其他工具下笔触入口 SHALL 禁用并说明用于绘图或形状，不强制切换工具。非预设当前色 SHALL 不伪造某预设选中。新编辑器的自由笔与形状 SHALL 默认黑色，不覆盖现有快照。最右 SHALL 提供自由取色环，内部多色，仅当前色不匹配预设且工具支持颜色时active并显示当前色外轮廓，非active时无外轮廓；匹配预设时仅相应预设active，键盘焦点提示独立保留，选择任意有效颜色只更新当前工具族；不支持颜色的工具下该控件也禁用。inlinePickers 的十六进制颜色输入 SHALL 并入该颜色分区，保留 `[data-toolbar-color-field]` 可聚焦入口及原有键盘桥接，不新增独立「自定义颜色」文案行。

#### Scenario: Freehand and shape colors remain independent

- **WHEN** 用户在自由笔下选蓝，切矩形选黑，再回自由笔
- **THEN** 自由笔为蓝、形状为黑，调色板正确反映当前工具族，已有对象颜色和历史不变

#### Scenario: Text and custom colors are represented honestly

- **WHEN** 用户进入文字工具，之后回到已设置非预设自定义颜色的自由笔
- **THEN** 文字模式笔触入口禁用且说明用于绘图或形状；自由笔模式六点均未选中，自定义色仍保留并由最右取色环外轮廓表示，可直接编辑

#### Scenario: Preset and custom outlines are mutually exclusive

- **WHEN** 用户依次选择预设蓝色、非预设自定义色、预设黑色并切换工具族
- **THEN** 蓝色激活环为蓝色；自定义色时仅自由取色环有当前色轮廓；黑色时仅黑色有黑色激活环，自由取色无轮廓；工具族切换后状态由该族颜色派生

#### Scenario: New editor starts with the first black preset

- **WHEN** 无显式工具设置的新编辑器首次打开，用户查看笔触菜单，分别用自由笔和形状绘制
- **THEN** 两族默认颜色均为#2D2D2D，菜单第一项黑色选中，S曲线预览为黑色，新对象实际颜色为黑色；已有对象或宿主显式颜色在挂载／重挂载时不被覆盖

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

首层笔宽 SHALL 使用紧跟统一工具菜单的笔触设置按钮，尺寸至少44×44px；按钮内 SHALL 为圆头S型曲线，颜色来自当前工具族，有界的预览粗细随真实笔宽严格单调变化，0.5和200的极值均可辨认且不裁切，不能用固定粗细图标代替。按钮 SHALL 有可访问名称「笔触设置」、展开状态及当前颜色／笔宽说明；不支持笔触的工具 SHALL 显示禁用占位曲线，说明用于绘图或形状。

打开后笔宽 SHALL 使用同一行标签、滑条和右侧64×44px数字输入，标签盒与滑条顶边对齐误差不超过2 CSS px；滑条与数字输入范围0.5–200、步长0.5，并从当前工具族权威参数同步。合法范围内有限数字 SHALL 按既有直接输入语义提交，不因HTML步长约束丢失原可接受精度；滑条按0.5步进。非法／空／越界输入 SHALL 不提交，失焦或Enter恢复有效权威值；被拒绝更新 SHALL 回读权威值。合法更新 SHALL 同步滑条、数字、S预览与后续绘制设置，无额外持久化复本。自由笔与形状 SHALL 独立；一般设置不包含笔宽。

#### Scenario: Width follows tool families and external updates

- **WHEN** 自由笔笔宽设为12，形状笔宽设为3，切换工具或外部更新当前参数
- **THEN** 笔触按钮预览及菜单控件反映当前族参数，其他工具禁用笔触按钮，切回时各族值保留，不产生文档历史或重涂旧对象

#### Scenario: Width survives committed object undo and reload

- **WHEN** 分别用不同笔宽绘制对象并撤销/重做，再序列化并重载文档
- **THEN** 各对象原始笔刷/形状宽度保持一致，笔触参数继续遵循原控制器语义，拖尾等展示状态不写入文档

#### Scenario: Width slider and number stay synchronized

- **WHEN** 用户在菜单将笔宽滑条调为12，右侧数字改为3.5，再输入空值、0、201并失焦或按Enter，随后外部把有效笔宽改为8
- **THEN** 12和3.5均同步到当前族设置和预览；非法值不提交且恢复3.5；外部更新后显示8，既有对象与历史不变

#### Scenario: Preview remains useful at both width extremes

- **WHEN** 用户依次设置0.5、3.5、12、200，并在预设与自定义色之间切换
- **THEN** S曲线粗细严格递增且始终留在按钮内，颜色即时与当前族一致；数字显示真实笔宽，不把缩略预览粗细误当作真实尺寸；预览不写入文档或绘图历史

### Requirement: Eraser trail is transient feedback

有效擦除输入 SHALL 在独立、事件透传的SVG叠加层显示12px圆头淡紫轨迹，每段从采样时起线性渐隐并在2000ms完全消失；新段 SHALL 不延长旧段寿命。轨迹 SHALL 跟随既有viewport，不进入文档、preview或撤销栈；无拖尾时 SHALL 无动画或计时循环，不使用常驻RAF。

#### Scenario: Eraser feedback fades without changing saved history

- **WHEN** 用户擦除并抬笔
- **THEN** 中间帧仍可见渐隐轨迹，擦除事务按原语义只提交一次，每段2秒后移除，文档/history不因渐隐改变，空闲没有RAF

#### Scenario: Lifecycle transitions clear all feedback

- **WHEN** 拖尾仍可见时切工具、取消输入、清空画布、撤销/重做、失焦、页面隐藏/离开或卸载
- **THEN** 轨迹节点和到期计时器立即清理，未完成擦除沿用原取消语义，重新进入不残留旧拖尾

### Requirement: Shared toolbar subpath and controlled file requests

painting SHALL 提供无绘图 controller、解析器或原生运行时依赖的公开 `@hamster-note/painting/toolbar` 子路径，导出 ToolbarShell、ToolbarPopover、ToolbarFileMenu 及结构类型。painting 的 Toolbar 和 PaintingBoard SHALL 接收可选 files/currentFileKey/paneId/busy、异步 onSelectFile/onRequestRemove 以及 layout。未传 files SHALL 隐藏文件入口，传入时 SHALL 在重做之后使用文件图标及箭头，按原顺序展示列表、当前项、存储与路径，不生成身份或枚举文件。

菜单 SHALL 固定打开时栏身份，每次请求带 fileKey/paneId/requestId，当前项和列表仅由宿主快照更新。当前项重复选择 SHALL 无操作，在途请求和 busy SHALL 禁止并行结构操作，取消及失败 SHALL 保持当前项并允许重试；失败展示错误。移除最后一项 SHALL 禁用，其余移除 SHALL 交宿主确认、保存和提交，不产生绘画/历史事务。文件按钮和菜单操作 SHALL 至少44×44px，支持键盘打开、方向键/Home/End、Escape焦点恢复和正常Tab退出。

#### Scenario: Mixed files and async host ownership

- **WHEN** 注入两存储同名 PDF、HNN 和 HPB，打开文件菜单并选择非当前项，等待宿主保存回执
- **THEN** 同序列表可区分身份，回调只发一次且目标栏固定，成功前不提前标记当前项；失败保留原项，回调成功后也仅由宿主新快照改变当前项

#### Scenario: Optional API and independent consumption

- **WHEN** 旧画板宿主不提供文件列表，或 reader/notes 契约适配器仅导入公开 toolbar 编译入口
- **THEN** 旧宿主工具和默认布局不变，适配器复用相同外壳和菜单且打包依赖图不含绘图运行时

### Requirement: Controlled pane edge and occupied content space

layout SHALL 使用宿主已解析 edge、四边有效 insets、headerContentInset 及可选 viewport bounds，不在库中判断分屏方向。显式0 SHALL 覆盖整屏 env，顶部避让 SHALL 取 top 与有效标题遮挡终点的较大值而不相加；底部仅消费 bottom。top 弹层优先向下、bottom 优先向上，均限制在所属栏与可见 viewport 交集中。外壳 SHALL 报告占位；受控画板 SHALL 在对应边预留真实空间并约束 surface。迁移边缘 SHALL 保留原 controller、笔画和撤销状态，不更改文档 key。

#### Scenario: Safe area and top/bottom migration

- **WHEN** 向画板传入 bottom=34、改为显式0，再改为 top=24/headerContentInset=44 的 top 布局
- **THEN** 胶囊外壳底距依次为50、16，顶部外壳距为60；正文不被栏遮挡，弹层向内容区展开，笔画及历史不变且surface不重挂载

#### Scenario: Side-by-side and vertical pane hosts

- **WHEN** 宿主为左右两栏传bottom，为上下上栏传top、下栏传bottom，栏宽320px
- **THEN** 三种内容消费者均采用传入边缘和有效安全区，不继承分隔线内侧屏幕 inset，文件菜单与工具可滚动到达且不越过所属栏
