# Design

实施授权更新（2026-10-25）：本轮按 HAM-109 评论 `01a1717a-ab80-7692-bf88-8a0596a0c096` 提前实施局部 Web 样式防护及自动化验证，不等待 HAM-63；真机复现、事件层必要性判断及实体笔验收留待后续，不宣称真机问题已修复。其余设计约束保持有效。

## Context

动机见 proposal.md。项目使用 OpenSpec 1.13.1、spec-driven schema；检出仓库没有随附 propose 命令/技能文件，采用本运行环境安装的 openspec-propose 技能及 CLI 返回的模板。

本轮只读查证：

- `DrawingSurface.tsx` 已在消费方 style 之后设置 userSelect/WebkitUserSelect/WebkitTouchCallout 防护；`DisplayLayer.tsx` 显式保护显示态文字，`TextEditor.tsx` 已为编辑控件恢复选择。
- `PaintingBoard.tsx` 将 Toolbar 和 DrawingSurface 渲染为兄弟节点。`Toolbar.tsx` 标记 data-interactive，包含静态 label、按钮、number/color/range input 和 select，但没有禁选样式。因此画布局部样式不能覆盖工具栏；这只是静态缺口，尚不能证明完整根因。
- `semanticWebAdapter.ts` 跳过交互目标，并保留多边形 dblclick。`freehandWebAdapter.ts` 排除安全控件并管理 pointer 生命周期，后续修改须沿用既有所有权。
- `tests/ui/interaction-feedback.spec.ts` 已验证画布禁选、外部文本可选和 textarea 编辑，但未覆盖短笔后工具栏选区。Playwright 当前只配置 Chromium，不可声称已有 Safari 自动化覆盖。
- 用户报告为本次需求事实；本轮未运行浏览器或实体笔复现，未获得事件时序。HAM-63 仍在进行，用户指定其完成后实施。

## Goals / Non-Goals

**Goals:** 在组件自身建立静态文字与真实编辑内容的明确边界，避免依赖页面全局样式；在浏览器默认动作发生前防护，保留原有输入和事务路径。

**Non-Goals:** 不修改 native/PencilKit/安卓后端、RNW 补丁、文档格式或输入模式策略；不增加全局禁选、笔后冷却计时器、永久诊断采集或新的手势框架。

## Decisions

### 1. 工具栏自身覆盖静态文字，编辑节点显式恢复

在 Toolbar 根节点设置 `user-select: none`、`-webkit-user-select: none`、`-webkit-touch-callout: none`；静态 label 和按钮文案继承，必要时对实际文本节点显式声明以兼容 WebKit。保留画布已有防护，独立使用 Toolbar 时也有效。

文本及数值编辑 input、textarea、contenteditable 的实际可编辑节点显式恢复 `user-select: text`、WebKit 对应属性和默认 callout。color、range、select、button 保持原生事件、焦点及弹出行为，不额外阻断其 pointer、click、keydown 或 change；不用给整个 label 恢复可选，否则静态文案再次暴露。

选择局部 CSS 是因为它覆盖快速抬笔后可能发生的默认选择且不依赖手势持续时长。替代方案：在 board/body 上一概禁选会扩大影响面，单独改画布则不能覆盖兄弟工具栏；均不采用。不通过 pointer-events:none、失焦或取消按钮 pointerdown 实现禁选。

### 2. 事件防护只用于已证明的剩余默认动作路径

先在 HAM-63 完成后的基线上复现并确认事件路径，再验证局部样式是否足够。如果仍观察到 selectstart/dblclick 等默认选择入口，才在所属 surface/toolbar 局部处理器中对可取消、非编辑目标调用 preventDefault；缺省不增加事件监听。

选择防护的判定与“安全控件不接收绘图输入”分开：Toolbar 整体有 data-interactive，不能因此把所有静态标签都豁免禁选；同样不能因其静态文案禁选而吞掉控件操作。已有多边形 dblclick 业务逻辑仍先按原契约执行，仅取消浏览器默认选择。

如证据要求在画布 pointerdown 阶段取消默认选择，只在既有仲裁确认接管非编辑绘图输入时同步处理，不扩大至被拒绝输入或工具栏控件。沿用已有 pointer capture 和 pointerId 所有权，避免画布起始跨界手势被控件二次接管。只有复现证明存在关联 click 误激活时，才按确切 pointer 生命周期在局部屏蔽该次派生 click；不得按“最近用过笔”屏蔽下一次主动点击。

所有新增监听随挂载/销毁成对清理；如确需会话状态，pointerup、pointercancel、lostpointercapture、blur、destroy 均按既有输入契约释放。不得对 document/body 常驻 preventDefault，不调用 removeAllRanges 清除已存在的编辑或外部选区，不全局 stopPropagation。仅监听 selectionchange 事后清空会造成闪烁且破坏合法选区，不采用。

### 3. 行为与证据分层验收

复用现有 interaction-feedback UI 用例、layered-toolbar 组件测试和 layered editor fixture。断言工具栏静态标签计算样式、真实数值输入选择/替换、color/select/range 原生操作、键盘焦点，以及连续短笔前后对象和历史数量。不能仅断言 getSelection 为空：已有合法外部选区可保留，应确认未新建工具栏选区且未清除合法编辑选区。

自动化覆盖相近落点短笔、零或极少 move 的快速落抬笔、顶部跨界抬笔、短笔后立即点工具、cancel/blur/捕获丢失、卸载重挂，以及原多边形双击、业务选择和笔指导航。合成 pointer 仅验证事件与事务分支；trusted 浏览器鼠标输入验证默认选择边界。两者均不能代替 iPad Safari + Apple Pencil。

真机在同一 iPad/iPadOS/Safari/笔型号上对比基线与候选，普通入口优先，诊断入口仅辅助。空白/含文字画布分别在 auto 见笔前后及 pen 模式完成每组 30 次短笔，另验证 finger 模式按既有规则拒绝笔绘图但不误选；记录短笔操作方法、落抬笔间隔范围、顶部距离及抬笔后 1 秒状态。覆盖横竖屏工具栏换行、跨界、连续书写、原生控件/输入/IME、撤销重做。仅在需要定位时临时观察 selectstart、selectionchange、dblclick 和兼容鼠标事件，不记录文字内容。

基线复现且候选不复现、输入回归通过，才能认可修复；基线未复现则验收证据不足，应补充可复现操作后再评估，不能报告已修复。自动化报告标明引擎与输入来源，Safari 真机证据独立记录。

## Risks / Trade-offs

- [WebKit 对表单控件与父级禁选继承存在差异] → 可编辑节点显式恢复，真机验证选择、菜单、数值输入和颜色/下拉弹层。
- [新增默认动作取消影响焦点或兼容 click] → 先局部样式，事件层按实测入口添加，并验证短笔后的首击、键盘及输入所有权。
- [现有规格要求画布外可选与工具栏禁选看似冲突] → delta 完整修改原要求，明确工具栏静态文字为例外，工具栏编辑内容及其他外部页面保留选择。
- [HAM-63 完成后组合结构可能变化] → 实施开始前复核真实 Web 入口及组件边界；若本问题转为纯 native 行为，应修订范围，不能沿用 DOM 结论。

## Migration Plan

无数据或依赖迁移。本轮只交付规划产物；后续实施须等待 HAM-63 完成并进入 apply 阶段，复核基线后按 tasks 执行。失败时撤回本次工具栏样式和有证据支持的局部事件改动，保留原画布防护及业务契约。

## Open Questions

- 实际复现的 iPad/iPadOS/Safari 和笔型号、短笔节奏尚未提供，可在真机验收时登记，不影响当前行为契约与局部防护方案。
