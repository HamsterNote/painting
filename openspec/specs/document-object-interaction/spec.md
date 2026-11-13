# document-object-interaction Specification

## Purpose

明确分层改造后继续提供的文档编辑能力、工具配置隔离及几何命中行为，让文字输入、选择变换和整对象擦除在 DOM 与未来语义输入渠道下使用一致的对象模型。

## Requirements

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

Web 普通 hover/click SHALL 支持从实际 DOM 目标定位对象；选择工具已有选区时，手势起点 SHALL 先按本规格的选中框整体优先范围解析选择操作，范围外再使用普通对象命中。pointer capture 后，擦除等依赖当前位置命中的连续输入 MUST 使用轨迹几何查询而非把 captured target 当作当前位置命中；选中框变换 SHALL 使用起点锁定的目标和后续坐标计算变换，不重新选择轨迹上的对象。HTML 文字 SHALL 保留真实焦点、输入和键盘处理接口；原生承载/未来 overlay MUST 不声称天然穿透即可保证文字输入。

#### Scenario: Capture does not pin eraser target

- **WHEN** pointer 被活动层 capture 后移动至不同对象
- **THEN** 几何轨迹决定当前命中而非 capture 元素，普通未 capture 的点击仍能识别对象

#### Scenario: Hosted text editing owns focus

- **WHEN** 用户在 Web 或 Expo WebView 中进入文字编辑，输入并完成或取消
- **THEN** 真实 DOM 编辑器取得焦点并处理键盘，完成生成一次文档事务，取消不改写内容

#### Scenario: Selection frame precedes ordinary object identity

- **WHEN** 当前已选中对象 A，选择工具下在其整体优先范围内按下，实际 DOM 目标是更高层对象 B
- **THEN** 系统开始 A 的选择操作，不因 DOM 目标或普通对象几何命中而改选 B

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

### Requirement: Drawing excludes native text selection outside editing controls

在 iPad Safari 使用实体笔绘制时，系统 SHALL 防止画布非编辑区域（包括显示态文档文字）因快速连续落笔、抬笔或关联浏览器默认行为触发原生文字选择及选词菜单；绘制 SHALL 保持连续，一次完成的笔画形成一次可逆事务。防护 SHALL 限定在画布非编辑区域及绘图工具栏的静态文字，不得改变文档对象的业务选择与编辑，也不得阻断正常笔输入。工具栏静态标签、说明和按钮文案 SHALL 不参与浏览器原生文字选择；真实文本或数值输入内容 SHALL 保留其原生编辑行为。由画布开始的笔手势及其关联默认行为 MUST NOT 建立延伸到工具栏的原生文字选区、唤起选词菜单或误执行工具栏命令。正常结束或取消后，用户下一次主动操作工具栏 SHALL 立即生效，不要求额外点击解除防护。

#### Scenario: Rapid strokes over displayed text

- **WHEN** 用户在已有显示态文字的画布上及文字附近用实体笔快速连续绘制多笔，包括相邻落笔与抬笔
- **THEN** 不出现非编辑文字的原生选区或选词菜单，笔迹不被选词打断，每笔提交一次且可逐笔撤销重做，原文字内容保持不变

#### Scenario: Rapid strokes on empty paper

- **WHEN** 用户在空白画布上快速重复短笔和长笔并继续书写
- **THEN** 不出现画布或周围页面文字的误选区和选词菜单，不丢失可见笔画、不重复提交，也不因防护误开文字编辑器

#### Scenario: Text editor keeps native editing

- **WHEN** 用户主动进入文字编辑器或其他文本输入控件，选择文字、复制粘贴、替换并通过中文 IME 输入后完成或取消
- **THEN** 原生选择、菜单、焦点和组合输入保持可用，完成生成一次预期文档事务，取消不改写文档；返回画布绘制后防护继续生效

#### Scenario: Safe controls and surrounding page keep their behavior

- **WHEN** 用户操作画布内安全控件或在绘图工具栏以外的画布外页面选择文字
- **THEN** 控件仍能获得焦点并执行原有操作，页面文字选择不被防护取消；工具栏静态文字按本要求禁选

#### Scenario: Business interactions survive default selection suppression

- **WHEN** 用户通过鼠标或允许的笔/触摸输入完成多边形双击闭合、业务对象选择与移动、切换三档输入模式或进行笔指混合导航
- **THEN** 多边形保持既有一次闭合事务且无重复终点，业务选择与变换保持可用，输入模式和笔指归属不变，不因阻止浏览器选词而吞掉业务事件或新增历史

#### Scenario: Short strokes near toolbar leave labels unselected

- **WHEN** 用户在空白或含文字画布的顶部附近用实体笔连续完成 30 次快速短笔，其中包含相近位置连续落抬笔，并在最后一笔抬起后等待 1 秒
- **THEN** 不生成工具栏标签、说明、按钮文案的原生选区或选词菜单，30 笔各提交一次且可逐笔撤销重做，工具设置保持不变

#### Scenario: Canvas gesture crosses into toolbar

- **WHEN** 笔从画布落下，移动至工具栏标签或控件上方后抬起，随后用户另起一次手势主动点击工具栏按钮
- **THEN** 跨界手势不选中工具栏文字或误触控件，笔画遵循既有结束或取消契约且不重复提交；后续主动点击立即执行预期命令

#### Scenario: Toolbar controls work immediately after short strokes

- **WHEN** 连续短笔后用户以笔、鼠标或触摸分别主动切换工具与输入模式、打开颜色选择器、修改笔宽、拖动不透明度、切换压力模式并撤销重做
- **THEN** 所有控件保持原有响应、焦点与参数更新，不出现吞掉首击、禁用状态错误或新增绘图事务；Tab 及控件原有键盘操作继续可用

#### Scenario: Toolbar input values remain editable

- **WHEN** 用户聚焦工具栏笔宽数值输入，选择并替换内容，或在文字编辑器中选择、复制粘贴并用中文 IME 编辑
- **THEN** 输入内容的原生选择、菜单和编辑保持可用，周围静态标签仍不可选，完成或取消行为符合既有契约

#### Scenario: Cancellation does not leave an interaction lock

- **WHEN** 一次笔手势遇到 pointercancel、失焦、捕获丢失或编辑器卸载，之后恢复页面或重新挂载并主动操作工具栏和画布外可选文字
- **THEN** 未完成手势按既有契约清理，不残留选择拦截或焦点锁；工具栏立即可操作，画布外页面可正常选择文字

### Requirement: Selection frame has one complete interaction region

选择工具显示有效选框时，系统 SHALL 在选框自身局部坐标中，将选框内部、边界及所有现有手柄交互区域共同包围的完整矩形（包含边界）作为整体优先范围，再与选框一起变换到显示坐标；手柄与框之间、四周手柄所在外扩带内的空白 SHALL 包含在范围中。选框旋转后，该范围及缩放手柄命中区 SHALL 同步旋转，旋转手柄命中区 SHALL 跟随其中心位置；系统 MUST NOT 将旋转范围在宿主坐标中的正交外接矩形直接用作最终命中区。范围 SHALL 由当前可见选框及手柄的位置确定，不依赖所选图形的路径、填充、透明度、图形包围盒内可见部分或 DOM 是否命中图形。系统 SHALL 在该范围中支持拖动当前选择；直接命中既有缩放/旋转手柄交互区时 SHALL 保留对应操作，其余位置 SHALL 移动当前选择。多选时 SHALL 使用整体选框并移动完整选中集合，不改变对象之间的相对位置。显示与命中范围 SHALL 在缩放、平移、已变换对象和页面坐标映射下保持一致。选区优先于其他文档对象、输入策略及手势起点锁定规则 SHALL 继续有效。

#### Scenario: Empty space inside a frame moves a sparse object

- **WHEN** 选中斜线、空心椭圆或不规则图形后，从框内没有图形路径或填充的空白处按下并拖动
- **THEN** 当前选择按起点至终点位移移动，选框同步跟随，不清空选择

#### Scenario: Outer handle band belongs to the selection

- **WHEN** 起点位于选框局部坐标中含手柄的完整优先矩形的上、下、左、右外扩带或边界，且不在具体手柄交互区内
- **THEN** 无论框是否旋转，拖动均移动当前选择，即使该点既不在图形本身也不在原始图形包围盒内

#### Scenario: Handle operations remain available

- **WHEN** 用户直接从旋转后可见的缩放手柄或旋转手柄交互区开始拖动，包括该区域与其他对象重叠时
- **THEN** 分别缩放或旋转当前选中集合，目标不变且不退化为移动，原手柄位置不再具有旧命中效力

#### Scenario: Multiselection gaps move the whole selection

- **WHEN** 多个对象被选中，用户从旋转后的整体选框内的对象间隙开始拖动
- **THEN** 所有且仅所选对象移动相同位移，集合与相对位置保持不变

#### Scenario: Viewport and page mapping align with visible frame

- **WHEN** 在 zoom 为 0.5、1、2 且存在非零平移的画布，以及带宿主页面坐标映射的页面表面，从可见优先范围内空白拖动
- **THEN** 均命中当前选择，屏幕拖动与显示位移一致，不出现命中偏移或随 zoom 变化而漏掉手柄外扩带

#### Scenario: Rotated region wins over covered objects

- **WHEN** 低层 A 的选框已旋转 45°，更高层 B 覆盖其优先范围内空白，用户从该空白拖动
- **THEN** 只有 A 移动，选择和图层顺序不变，B 不抢占操作

#### Scenario: Axis aligned envelope does not create false hits

- **WHEN** 选框旋转 45° 后，用户从其完整优先范围的宿主正交外接矩形内、但实际旋转优先范围外且不在任何手柄命中区内的位置开始操作
- **THEN** 不因该外接矩形而拖动当前选择；命中其他对象时沿用普通选择规则，空白点击沿用取消选择规则，范围外 Shift 追加选择保持可用

### Requirement: Selection interaction precedes document stacking

选择工具下，系统 SHALL 在手势起点先解析当前选中框整体优先范围，再查询其他文档对象；整体范围内的命中 SHALL 优先于任意更高层对象，并保持当前选择集合与文档图层顺序。范围外起始的手势 SHALL 沿用既有普通选择、追加选择和空白取消选择行为。此优先规则 SHALL 仅适用于选择工具和当前输入策略允许的选择输入，保留安全控件、真实文字编辑、其他工具及既有导航归属规则。

#### Scenario: Covered low-layer selection wins at gesture start

- **WHEN** 低层 A 已被选中，更高层 B 覆盖 A 的优先范围内空白或可见路径，用户从重叠处拖动
- **THEN** 只有 A 移动，B 不变，选择仍为 A，原图层顺序保持不变

#### Scenario: Outside starts use normal selection even when entering the frame

- **WHEN** 起点在整体优先范围外并命中其他对象，之后拖动进入原选中框
- **THEN** 按起点的普通选择规则处理，不在经过选中框时将目标切换为原选择

#### Scenario: Blank outside and modifier selection stay available

- **WHEN** 用户在整体优先范围外点击空白或按住 Shift 点击另一对象
- **THEN** 分别沿用既有空白取消选择或追加选择行为；在范围内则保持当前选择，不追加被覆盖对象

#### Scenario: Input modes and controls keep their ownership

- **WHEN** 鼠标或输入模式允许的触摸/笔在选择工具下拖动整体范围，或用户以仅允许导航的单指输入及安全控件操作同一区域
- **THEN** 前者执行选中框操作；后者分别遵循原导航或控件行为，不因选中框存在而强行移动文档；其他工具也不被选中框截获

### Requirement: Selection drag locks its target at the start

系统 SHALL 在接受手势起点时锁定 owner 指针、当前选中对象集合、操作类型、起点和原始变换，在同一手势内仅由 owner 的坐标更新这些对象。后续经过更高层对象、空白、框外或不同 DOM 目标 SHALL 不重新命中并替换目标。正常结束且实际发生变换 SHALL 只生成一个可逆事务；没有变换的点击 SHALL 不新增历史。取消、Escape、失焦、页面隐藏、卸载、工具/输入模式切换 SHALL 清除预览和归属，不提交部分事务，迟到事件 SHALL 不提交旧操作。非 owner 输入 SHALL 不接管已锁定目标；既有导航仲裁要求取消时 SHALL 先取消并清理选择事务。

#### Scenario: Moving across higher objects never steals the owner

- **WHEN** 从 A 的整体范围内开始移动，连续经过 B、C 和框外，最后在 B 上方松手
- **THEN** 全程仅预览并提交 A 的移动，B、C 和选择集合保持不变，松手位置作为最终位移

#### Scenario: One move is one undoable transaction

- **WHEN** 一次选中框移动产生多个中间更新并正常结束，随后撤销再重做
- **THEN** 中间更新不增加历史，撤销一次恢复原始变换，重做一次恢复最终变换，图层顺序和其他对象保持不变

#### Scenario: Cancellation clears the locked drag

- **WHEN** 拖动期间依次单独复现 pointercancel、Escape、失焦、隐藏、卸载、工具或输入模式切换，并在每种情况后发送迟到 move/up
- **THEN** 文档与历史无该次变换，预览和归属被清除，迟到事件无效，下一次合法手势可正常开始

#### Scenario: A second pointer cannot replace the target

- **WHEN** owner 已开始选中框拖动后，另一个指针落在更高层对象上并移动或抬起
- **THEN** 第二指针不改变该次目标或提交事务；若既有仲裁取消当前操作以进入导航，先回滚预览，再按原规则导航，旧 owner 的迟到结束不提交

### Requirement: Selection frame orientation belongs to the selection session

系统 SHALL 为新建立的选择，以所选对象当前可见几何的文档轴对齐整体外接矩形建立起始选框，方向不继承对象已存储的旋转。选择集合不变且未被清除时，框与全部现有手柄 SHALL 随当前选择的旋转预览和已提交累计旋转同步变化，松手后保持该方向；连续旋转不得因跨越 ±π 而翻转或跳变。后续移动与缩放 SHALL 保持该会话方向并同步改变框的位置与尺寸；不得每次根据对象的正交外接矩形重新定向。多选 SHALL 使用一个会话方向，不要求各对象原始方向相同。清除后重选或选择集合实际变化 SHALL 开始新会话并恢复文档轴对齐；同集合的重复选择通知及 viewport 更新 SHALL 不重置方向。页面自身旋转 SHALL 仅影响文档到显示的映射，不累计为选框会话旋转。

#### Scenario: Preview and committed frame follow rotation

- **WHEN** 新选中一个未旋转矩形并旋转 30°，观察拖动中和松手后的框与手柄
- **THEN** 框保持原始包围关系并同步旋转 30°，缩放手柄位于旋转后的角点，旋转手柄沿旋转后的框外法线排列，松手不恢复正交

#### Scenario: Consecutive edits retain orientation

- **WHEN** 同一选择先旋转 30°，再旋转 20°，然后移动并缩放
- **THEN** 框方向累计为 50°，移动与缩放后仍为 50°；框及手柄连续贴合所选集合，各编辑操作仍正常

#### Scenario: Continuous rotation crosses angle wrap

- **WHEN** 用户连续旋转经过 +180° 与 -180° 的表示边界并继续同向转动
- **THEN** 图形、框和手柄连续跟随指针，不反向跳动或突然恢复正交

#### Scenario: Reselecting a rotated object starts orthogonal

- **WHEN** 用户旋转对象后点击范围外空白取消选择，再重新选择同一对象
- **THEN** 对象保留已提交旋转，新选框包围其当前可见几何并相对文档轴正交，旧会话方向不恢复，清除和重选不新增文档历史

#### Scenario: Multiselection changes start a fresh frame

- **WHEN** 含不同已有方向的多个对象被选中并整体旋转，随后通过范围外 Shift 操作实际增加或移除一个对象
- **THEN** 整体旋转期间使用同一个随动选框；集合变化后以新集合的当前几何建立正交框，不沿用旧集合角度

#### Scenario: Repeated selection and navigation keep the session

- **WHEN** 旋转后保持同一选择集合，收到同集合重复通知、平移或更改 zoom
- **THEN** 会话方向保持，框与手柄仅按最新视口映射显示，不积累额外旋转

#### Scenario: Page rotation composes with selection rotation

- **WHEN** 在页面旋转 0°、90°、180°、270°、zoom 为 0.5、1、2 且存在非零偏移时，多选对象并旋转 30°，再从旋转后的框内空白及各现有手柄操作
- **THEN** 框方向相对文档轴累计 30°，屏幕方向由页面映射与会话方向共同决定；显示与命中一致，不重复计入页面角度，拖动方向及缩放/旋转结果符合指针操作

### Requirement: Rotated selection frame obeys transaction and cancellation semantics

系统 SHALL 将选框会话方向作为临时交互状态，不写入持久化文档、不单独增加历史。一次实际移动、缩放或旋转 SHALL 仍只提交一个可逆文档事务；无变化点击不提交。取消未完成变换 SHALL 同时撤销对象及选框预览，恢复操作前仍有效的会话方向；若既有行为已清除选择则结束会话。pointercancel、Escape、失焦、页面隐藏、卸载、工具或输入模式切换 SHALL 遵守既有取消与归属规则，迟到事件不得提交或恢复旧方向。捕获丢失 SHALL 只改变事件路由，不取消活动手势或预览；owner SHALL 保留到真正的 up/cancel 或生命周期中断，正常 up 仍仅提交一次。历史撤销/重做或外部文档替换后，若选择仍有效，系统 SHALL 根据当前文档重新建立正交选框；若选择无效则清除，不能残留旧框或旧命中区。

#### Scenario: Cancel restores the previous orientation

- **WHEN** 当前会话已提交 30°，继续旋转预览至 60°，分别以 pointercancel、Escape、失焦或页面隐藏取消，再发送迟到 move/up
- **THEN** 无第二次旋转事务，仍有效选择的图形与选框恢复 30°，迟到事件不改变文档或框；新合法手势可正常开始

#### Scenario: Termination clears obsolete geometry

- **WHEN** 旋转预览中切换工具、输入模式或卸载编辑器，之后结束旧指针或重新挂载
- **THEN** 未完成操作不提交，旧预览、归属和命中区被清理，不复用上次挂载的会话状态

#### Scenario: History and external replacement reconcile the frame

- **WHEN** 完成一次旋转并撤销、重做，或从外部替换所选对象的文档内容
- **THEN** 文档按既有事务语义恢复；仍有效的选择重新得到当前几何的正交框，无效选择被清除，无额外选框历史、陈旧角度或不可见命中区

#### Scenario: Capture loss retains the rotated owner until release

- **WHEN** 选框已有30°已提交方向，继续旋转预览至60°，在正常up前或后丢失捕获
- **THEN** 捕获丢失本身不回滚预览或清除owner；正常up只提交一次60°方向，若收到真正取消则恢复30°且迟到up不提交

### Requirement: Scheduled lasso feedback preserves final geometry and cancellation

系统 SHALL 在套索绘制过程中只显示轨迹并保留手势前选区；begin/update MUST NOT 准备几何、执行几何查询或提交临时选区。允许合并中间输入的显示，但 MUST 保留全部有效输入用于正常结束时的一次最终相交选择。正常结束 SHALL 包含最后一批有效输入，以完整轨迹和开始时有效的文档版本计算最终结果；结果非空切换选择工具，结果为空保持套索工具。纯套索操作 MUST 不更改文档或新增 undo 事务。

#### Scenario: End arrives before queued preview update

- **WHEN** 高频输入尚有未显示的批次时正常抬起
- **THEN** 最终选区与对全部有效轨迹执行既有相交规则的结果一致，包含末批命中、保留文档顺序，随后延迟回调不覆盖最终结果

#### Scenario: Cancellation restores previous selection

- **WHEN** 套索因 Escape、pointercancel、失焦、页面隐藏、切换工具或卸载而取消
- **THEN** 在原文档版本仍有效时恢复手势前选区并清空轨迹，取消待执行工作，迟到回调不改写后续手势；文档变化时清理旧手势且不重新选中已删除对象

#### Scenario: Geometry and editing remain compatible

- **WHEN** 套索跨过变换后的笔画、形状、文字和图片，包含边界接触、自交及退化轨迹，然后移动、缩放或旋转选中对象并撤销重做
- **THEN** 选择结果遵循既有几何命中和退化处理规则，变换及撤销重做保持原有事务语义，取消和纯圈选不新增绘图事务

#### Scenario: Selection is computed once on release

- **WHEN** 用户按住并继续绘制有效套索而不抬起
- **THEN** 持续更新轨迹，几何准备和查询次数保持为零；正常抬起后按完整轨迹查询一次并提交最终结果。此契约由 2026-11-13 用户决定替代原实时选区要求，不表示原实时指标已通过

#### Scenario: Native touch release commits the final selection

- **WHEN** 浏览器以真实触摸输入完成有效套索，并正常发出 pointerup/touchend，指针捕获可能在正常松手之前或之后释放
- **THEN** MUST 执行一次最终查询并将成功结果写入选区，捕获丢失只改变路由而不得误取消当前手势或在途查询；保留owner直到up、真正取消或生命周期中断，重复up不重复提交；文档与历史不变。MUST 分开记录触摸与鼠标证据，CDP 触摸或桌面 WebKit 结果不得替代已报告故障设备的复验

#### Scenario: Touch interruption does not submit a stale selection

- **WHEN** 活动触摸套索收到取消、被双指缩放接管或用户切换工具
- **THEN** MUST 取消旧手势、保留有效原选区及文档和历史，不提交迟到结果，并允许下一次触摸圈选正常完成

#### Scenario: Pending final selection is visible and cancellable

- **WHEN** 松手后的最终查询尚未完成
- **THEN** 保留完整套索轨迹并显示正在选择的反馈；分批执行准备和精算，结果到达时以最终选框替换轨迹。等待期间的新手势、取消、文档更新、工具切换与销毁使旧结果失效，不恢复已删除对象

#### Scenario: Final selection performance gate

- **WHEN** 在桌面Chromium生产构建中以6×CPU降频，分别对500和1000笔完成连续套索手势
- **THEN** 松手到可见选区的延迟分别不超过150ms和400ms，全手势到选区呈现期间不存在超过200ms的主线程任务；冷态、热态分别报告，失败轮次不可删除或以CI通过替代

#### Scenario: Idle preparation precedes the first real lasso

- **WHEN** 首屏已显示或编辑完成，主线程有空闲时间且没有真实手势进行
- **THEN** 可以执行一次小型合成套索预热，并分批准备当前冻结文档的几何索引；预热不改变选区、工具、文档、历史或轨迹。输入开始或销毁取消排队预热，文档更改使旧准备失效。首次真实套索仍单列为冷态，预热自身成本、未完成预热的情况及长任务必须公开报告

#### Scenario: Performance comparisons reject host contention

- **WHEN** 比较两版套索查询性能
- **THEN** MUST 记录每轮前后load与空闲CPU；一分钟load超过可用核数一半时废弃整对并重跑。两版MUST在同一时段相邻交替AB/BA执行，以同线程查询边界CPU时钟及候选数、段对检查数、独立分配采样和GC次数为主证据。CPU时钟缺失不得以墙钟替代；内核首次查询不得冒充首次真实UI手势；原冷态150/400ms及零>200ms长任务门槛不变，真机验证单列
