# Spec Delta

## ADDED Requirements

### Requirement: Drawing excludes native text selection outside editing controls

在 iPad Safari 使用实体笔绘制时，系统 SHALL 防止画布非编辑区域（包括显示态文档文字）因快速连续落笔、抬笔或关联浏览器默认行为触发原生文字选择及选词菜单；绘制 SHALL 保持连续，一次完成的笔画形成一次可逆事务。防护 SHALL 限定在画布非编辑区域，不得改变文档对象的业务选择与编辑，也不得阻断正常笔输入。

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

- **WHEN** 用户操作画布内安全控件或在画布外选择页面文字
- **THEN** 控件仍能获得焦点并执行原有操作，画布外的文字选择不被画布防护取消

#### Scenario: Business interactions survive default selection suppression

- **WHEN** 用户通过鼠标或允许的笔/触摸输入完成多边形双击闭合、业务对象选择与移动、切换三档输入模式或进行笔指混合导航
- **THEN** 多边形保持既有一次闭合事务且无重复终点，业务选择与变换保持可用，输入模式和笔指归属不变，不因阻止浏览器选词而吞掉业务事件或新增历史
