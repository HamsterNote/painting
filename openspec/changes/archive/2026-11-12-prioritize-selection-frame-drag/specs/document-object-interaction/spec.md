# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Selection frame has one complete interaction region

选择工具显示有效选中框时，系统 SHALL 将选中框内部、边界及所有现有手柄交互区域共同包围的完整矩形（包含边界）作为整体优先范围；手柄与框之间、四周手柄所在外扩带内的空白 SHALL 包含在范围中。范围 SHALL 由当前可见选中框及手柄的位置确定，不依赖所选图形的路径、填充、透明度、图形包围盒内可见部分或 DOM 是否命中图形。系统 SHALL 在该范围中支持拖动当前选择；直接命中既有缩放/旋转手柄交互区时 SHALL 保留对应操作，其余位置 SHALL 移动当前选择。多选时 SHALL 使用整体选中框并移动完整选中集合，不改变对象之间的相对位置。显示与命中范围 SHALL 在缩放、平移、已变换对象和页面坐标映射下保持一致。

#### Scenario: Empty space inside a frame moves a sparse object

- **WHEN** 选中斜线、空心椭圆或不规则图形后，从框内没有图形路径或填充的空白处按下并拖动
- **THEN** 当前选择按起点至终点位移移动，选中框同步跟随，不清空选择

#### Scenario: Outer handle band belongs to the selection

- **WHEN** 起点位于含手柄的完整外接矩形的上、下、左、右外扩带或边界，且不在具体手柄交互区内
- **THEN** 拖动移动当前选择，即使该点既不在图形本身也不在原始图形包围盒内

#### Scenario: Handle operations remain available

- **WHEN** 用户直接从缩放手柄或旋转手柄交互区开始拖动，包括该区域与其他对象重叠时
- **THEN** 分别缩放或旋转当前选中集合，目标不变且不退化为移动

#### Scenario: Multiselection gaps move the whole selection

- **WHEN** 多个对象被选中，用户从整体选中框内的对象间隙开始拖动
- **THEN** 所有且仅所选对象移动相同位移，集合与相对位置保持不变

#### Scenario: Viewport and page mapping align with visible frame

- **WHEN** 在 zoom 为 0.5、1、2 且存在非零平移的画布，以及带宿主页面坐标映射的页面表面，从可见优先范围内空白拖动
- **THEN** 均命中当前选择，屏幕拖动与显示位移一致，不出现命中偏移或随 zoom 变化而漏掉手柄外扩带

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
