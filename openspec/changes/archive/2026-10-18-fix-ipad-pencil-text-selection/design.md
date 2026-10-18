# Design

## Context

动机见 proposal.md。设计基于实际检出的 HAM-50 补丁提交 `9834cec61b641c7f5041a14280d8c56322390e68`。已读项目 propose 命令、skill、spec-driven 配置及 `document-object-interaction` 完整规格，沿用其 HTML 编辑器与多边形双击契约。

证据分级：

| 级别 | 本轮证据与结论 |
| --- | --- |
| 用户报告 | iPad + 实体笔快速绘制触发文字选择；作为需求事实。未提供设备版本、画布内容及完整事件时序 |
| 静态分析，已证 | `DrawingSurface.tsx:164` 仅有 touchAction，未声明 userSelect/WebKit touch callout；`DisplayLayer.tsx` 将文字渲染到 foreignObject 内 div，未声明不可选择；`TextEditor.tsx` 使用真实 textarea 和 data-interactive 容器 |
| 静态分析，已证 | `semanticWebAdapter.ts:189,254` 监听 dblclick，仅多边形完成成功时 preventDefault，并跳过交互控件；部分 pointer down/move 已 preventDefault，但这不证明所有浏览器选词入口已覆盖 |
| 静态分析，已证 | `interactionOwnership.ts:63` 对缺少 pointerType 的 dblclick 回退为 mouse；搜索生产源码仅发现该 helper 定义，没有发现调用点，不能据此认定本次根因 |
| 合成输入 / CDP | 本轮未执行。HAM-50 的 Chromium CDP trusted 证据针对 responder 身份缺陷，不能迁用为本问题的复现证据 |
| iPad Safari + 实体笔 | 待验收；没有新真机结论，不能声称补丁后仍复现或已修复 |

“快速落抬笔被识别为 dblclick，再触发选词”是候选链路而非已证根因；系统选词、长按菜单、兼容鼠标事件也不能仅由静态分析排除。

## Goals / Non-Goals

**Goals:** 在实际 DOM 边界建立默认选择防护，编辑控件明确恢复原生行为；防护不依赖 UA、压力阈值或笔速猜测，不修改输入事务模型。按用户要求先完成提案，真机复验放在验收阶段。

**Non-Goals:** 不重写输入仲裁、历史或文字模型；不增加全局手势锁或延时去抖；不调整 RNW responder；不将浏览器原生选词与业务套索/对象选择混为一谈。

## Decisions

### 1. 使用画布局部样式作为第一层防护

在 DrawingSurface 的非编辑绘制区域声明 `user-select: none`、`-webkit-user-select: none` 和 `-webkit-touch-callout: none`，保留现有 touchAction。必要时在 DisplayLayer 的显示态文字节点明确应用，避免 foreignObject/浏览器继承差异。宿主样式合并顺序必须保证消费方常规 style 不意外解除非编辑区域防护；真实编辑控件使用明确例外。

理由：样式覆盖发生在浏览器选择动作之前，也覆盖抬笔后的兼容事件，不需要维护“最近使用笔”的全局计时状态。只有 touchAction 不能表达文字选择边界；仅拦截 dblclick 也不能覆盖全部系统选词入口。接受画布显示态文字不能原生拖选，业务文字选择/编辑入口仍保留。

### 2. 明确恢复编辑控件，并保留业务双击

TextEditor 的 textarea/文本输入区域明确恢复 `user-select: text`、`-webkit-user-select: text`、`-webkit-touch-callout: default`；其他安全控件不受事件取消影响。不得对 document/body 注册全局选择清除，也不得以 `removeAllRanges()` 清除用户已有的编辑或画布外选区。

样式若不足，再在 semanticWebAdapter 的非交互目标边界对可取消的 dblclick 或 selectstart 做局部 preventDefault。dblclick 仍须执行多边形业务完成逻辑；不得全局 stopPropagation、删除 dblclick 监听或吞掉 pointerdown/up。没有证据时不新增长按/contextmenu 拦截器。若确需 selectstart，须验证目标与当前合法编辑选区，并随 adapter destroy 清理监听，禁止清空跨区域选区。

理由：既有 `tests/ui/interaction-feedback.spec.ts` 已要求 textarea 原生选择与替换；`document-object-interaction` 要求多边形双击闭合。全局禁选/禁双击会直接回退这些能力。

### 3. 测试分层且保留证据来源

自动化新增于已接入的 `tests/ui/`，复用 layered-editor fixture 与现有 interaction-feedback/mobile-input-mode 用例。检查计算样式、显示文字边界、快速连续笔输入后的对象数与历史，以及编辑控件选择替换、IME、取消和多边形闭合。Chromium/WebKit 桌面引擎验证 DOM 防护和兼容性；DOM dispatchEvent 只能证明合成事件路径，不能证明浏览器原生选词；CDP isTrusted=true 仍只证明 Chromium 输入路径。记录实际方法和结果，不混用为真机结论。

真机验收必须对比相同设备、相同数据/模式的 HAM-50 补丁基线和候选版本。在普通入口及诊断入口验证空白/含文字画布，自动见笔前后及强制笔/手指模式，快速短笔/长笔、抬笔后再写、文字编辑、鼠标/触摸与双指导航。记录 selectionchange/selectstart/dblclick/兼容鼠标事件的实际存在性（可用 Safari Web Inspector 临时监听），不在产品里增加常驻录制或采集文字内容。

### 4. 真机验收决定是否保留 change

用户允许 propose 不等真机。验收时先在未应用本 change 的补丁基线上按用户操作复核；若现象不复现，本 change 直接关闭，不把候选代码“无现象”冒充修复证据，不交付多余改动。若基线复现而候选不复现，且编辑/输入回归通过，才可接受修复。仅候选不复现但基线未测时，验收不完整。

## Risks / Trade-offs

- [Safari 样式继承、foreignObject 与系统菜单差异] → 在显示节点与真实编辑节点显式声明，并以真机对照验收；样式断言通过不等于用户问题解决。
- [父层禁选影响 textarea、复制菜单或 IME] → 明确编辑例外，实测原生选择、复制粘贴、中文组合输入及完成/取消，保留既有测试。
- [只测合成 dblclick 会漏掉系统选词路径] → 如实标注输入来源，真机必过，不把假设写成已证根因。
- [当前根因假设不足以解释真机结果] → 基线复现但候选仍失败时不得勾选验收；收集具体事件链后修订 design/tasks 再继续，不直接扩展为 RNW patch 修改。
- [消费者 style 覆盖或防护溢出] → 验证宿主最终样式、画布外选词与安全控件焦点；防护仅对挂载的画布局部生效，卸载后无全局遗留。

## Migration Plan

无数据或依赖迁移。后续 apply 使用 `9834cec` 或包含 HAM-50 补丁的 main；本方案不修改 HAM-50 文件，不新增强制等待其合并的顺序约束。开发及自动化完成后提供可访问的验收版本，由用户完成真机对照；本 propose 不启动服务、不实现、不部署。若基线不复现则关闭 change；候选回退时仅撤回本 change 的局部样式与监听，不动 HAM-50 补丁。
