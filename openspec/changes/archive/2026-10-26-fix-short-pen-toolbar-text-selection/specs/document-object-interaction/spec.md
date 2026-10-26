# Spec Delta

## MODIFIED Requirements

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
