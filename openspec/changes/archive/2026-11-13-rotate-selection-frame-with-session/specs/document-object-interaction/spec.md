# Spec Delta

本增量以 HAM-246 / PR #51 的规格为前置；其中被修改的完整交互区域要求尚未进入本次检出的 main。归档或同步本增量前必须先集成前置规格。

## MODIFIED Requirements

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

## ADDED Requirements

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

系统 SHALL 将选框会话方向作为临时交互状态，不写入持久化文档、不单独增加历史。一次实际移动、缩放或旋转 SHALL 仍只提交一个可逆文档事务；无变化点击不提交。取消未完成变换 SHALL 同时撤销对象及选框预览，恢复操作前仍有效的会话方向；若既有行为已清除选择则结束会话。pointercancel、Escape、失焦、捕获丢失、页面隐藏、卸载、工具或输入模式切换 SHALL 遵守既有取消与归属规则，迟到事件不得提交或恢复旧方向。历史撤销/重做或外部文档替换后，若选择仍有效，系统 SHALL 根据当前文档重新建立正交选框；若选择无效则清除，不能残留旧框或旧命中区。

#### Scenario: Cancel restores the previous orientation

- **WHEN** 当前会话已提交 30°，继续旋转预览至 60°，分别以 pointercancel、Escape、失焦、捕获丢失或页面隐藏取消，再发送迟到 move/up
- **THEN** 无第二次旋转事务，仍有效选择的图形与选框恢复 30°，迟到事件不改变文档或框；新合法手势可正常开始

#### Scenario: Termination clears obsolete geometry

- **WHEN** 旋转预览中切换工具、输入模式或卸载编辑器，之后结束旧指针或重新挂载
- **THEN** 未完成操作不提交，旧预览、归属和命中区被清理，不复用上次挂载的会话状态

#### Scenario: History and external replacement reconcile the frame

- **WHEN** 完成一次旋转并撤销、重做，或从外部替换所选对象的文档内容
- **THEN** 文档按既有事务语义恢复；仍有效的选择重新得到当前几何的正交框，无效选择被清除，无额外选框历史、陈旧角度或不可见命中区
