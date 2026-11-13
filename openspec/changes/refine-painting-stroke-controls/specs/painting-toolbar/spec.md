# Spec Delta

## MODIFIED Requirements

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
- **THEN** 菜单依次提供笔宽、颜色、不透明度及压力／线型；自由笔压力保留自动、真实、模拟、恒定四种，形状提供实线／虚线且无压力项；一般设置不再重复笔触项，切换不改压力算法或原有绘制语义

#### Scenario: Stroke dialog closes and restores focus

- **WHEN** 用户用 Enter 或 Space 打开笔触菜单，Tab 到输入框编辑，再按 Escape；随后重开并收起工具栏
- **THEN** 输入可以原生选择替换，Escape 后焦点返回笔触按钮；收起关闭弹层，展开参数不变；打开其他弹层时笔触菜单关闭

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

调色板 SHALL 整体位于笔触菜单的颜色分区，底部栏不再提供调色板或自由取色副本；调色板 SHALL 按黑#2D2D2D、蓝#7FA3C3、绿#8FBA8D、黄#D5B984、粉#CD9BAA、紫#AB9CC2顺序显示六点。每点 SHALL 有24px色面和约30.67×44px不重叠命中区域，色面留白约6.67px（原20px的1/3），选中项 SHALL 同时有与该预设色一致的环和勾号及可访问选中状态。自由笔或线/形状下选色 SHALL 只更新当前工具族后续绘制设置，不重涂已有对象；其他工具下笔触入口 SHALL 禁用并说明用于绘图或形状，不强制切换工具。非预设当前色 SHALL 不伪造某预设选中。新编辑器的自由笔与形状 SHALL 默认黑色，不覆盖现有快照。最右 SHALL 提供自由取色环，内部多色，仅当前色不匹配预设且工具支持颜色时active并显示当前色外轮廓，非active时无外轮廓；匹配预设时仅相应预设active，键盘焦点提示独立保留，选择任意有效颜色只更新当前工具族；不支持颜色的工具下该控件也禁用。

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

### Requirement: Stroke width is a primary tool parameter

首层笔宽 SHALL 使用紧跟统一工具菜单的笔触设置按钮，尺寸至少44×44px；按钮内 SHALL 为圆头S型曲线，颜色来自当前工具族，有界的预览粗细随真实笔宽严格单调变化，0.5和200的极值均可辨认且不裁切，不能用固定粗细图标代替。按钮 SHALL 有可访问名称「笔触设置」、展开状态及当前颜色／笔宽说明；不支持笔触的工具 SHALL 显示禁用占位曲线，说明用于绘图或形状。

打开后笔宽 SHALL 使用同一行滑条和右侧64×44px数字输入，二者范围0.5–200、步长0.5，并从当前工具族权威参数同步。合法范围内有限数字 SHALL 按既有直接输入语义提交，不因HTML步长约束丢失原可接受精度；滑条按0.5步进。非法／空／越界输入 SHALL 不提交，失焦或Enter恢复有效权威值；被拒绝更新 SHALL 回读权威值。合法更新 SHALL 同步滑条、数字、S预览与后续绘制设置，无额外持久化复本。自由笔与形状 SHALL 独立；一般设置不包含笔宽。


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
