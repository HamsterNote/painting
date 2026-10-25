# Proposal

实施授权更新（2026-10-25）：HAM-109 评论 `01a1717a-ab80-7692-bf88-8a0596a0c096` 授权不等待 HAM-63，先交付局部 Web 修复和自动化验证；iPad Safari 实体笔验收后续补齐。下文关于等待依赖的描述为提案时背景，执行以 tasks.md 的授权调整为准。

## Why

HAM-109 报告手写笔快速短笔仍会误选上方工具栏文字。现有画布局部禁选未覆盖独立工具栏，需要明确跨区域防护边界，并保证正常工具操作及文本编辑不回退。

## What Changes

- 工具栏静态标签、说明及按钮文案不参与浏览器原生文字选择；不影响控件点击、焦点、键盘访问和参数修改。
- 画布开始的快速短笔及关联默认行为不得生成延伸到工具栏的浏览器选区、选词菜单或误触工具操作；已有画布防护继续有效。
- 真实文本/数值输入、文字编辑器保留原生选取、替换、复制粘贴与 IME；编辑器外页面仍可选择文字。
- 增加短笔后立即操作工具栏、跨画布边界、取消后恢复的自动化回归与 iPad Safari 实体笔对照验收。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `document-object-interaction`: 在已有画布防护之外，补充工具栏静态文字禁选及跨区域短笔行为的可验证契约，明确输入控件例外。

## Impact

- 主要涉及 `packages/painting/src/layered/Toolbar.tsx`、`DrawingSurface.tsx`，以及必要时的局部 Web 事件适配；组合边界参考 `packages/painting/src/layered/PaintingBoard.tsx`。
- 回归落在 `tests/ui/interaction-feedback.spec.ts`、工具栏组件测试及相关输入用例；无公开 API、文档格式或依赖变更计划。
- 本轮只生成 OpenSpec 产物。用户原需求指定 HAM-63 完成后执行实施；当前 HAM-63 为 in_progress，实施前必须确认依赖完成，并在届时基线上复核。
- 范围为 Web DOM 浏览器行为，不修改 PencilKit、安卓绘制后端或原生输入仲裁。根因尚未经真机事件链证实，不能把静态缺口写成已复现结论。
