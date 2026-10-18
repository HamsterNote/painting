# Proposal

## Why

移动端当前默认拒绝 touch 绘制，无手写笔用户只能拖动画布；调试参数开启手指绘制又会关闭触摸导航。HAM-40 已合并到基线 `9f4ece3`，本变更按 HAM-44 已确认的六条口径修复输入仲裁。

## What Changes

- 工具栏新增“自动 / 强制手指绘制 / 强制手写笔绘制”三档菜单。首次默认自动，记住本机用户所选档位；存储失败使用内存，首个可交互画面即采用恢复后的档位。
- 自动档初始单指绘制；画布内首次有效 `pointerType === 'pen'` 落笔后，会话内锁定笔优先，单指改为拖动。不设超时；重开编辑器重置检测，强制手指档立即覆盖 latch。
- 三档均允许双指缩放/移动。手指绘制中加入第二指时先取消未提交笔迹，再启动双指导航；笔书写期间维持视口冻结与掌触抑制，结束后不补应用被忽略手势。
- 鼠标始终跟随当前工具。强制手指档仍允许笔操作，但笔事件不改变手指策略。
- 统一自由笔、语义工具、导航 adapter 的事件归属，补齐实际分层入口的自动化回归。
- **BREAKING**：分层组合入口的显式旧 `inputPolicy` 改为初始化兼容提示，不能持续覆盖三档菜单；底层独立 adapter 静态 policy 保持可用，初始化优先级和迁移见 design。

## Capabilities

### New Capabilities

无。复用现有输入能力路径，避免另建近义 spec。

### Modified Capabilities

- `input-session-viewport`: 增加三档选择、自动检测生命周期、恢复策略与跨 adapter 仲裁契约；手指取消后才允许双指导航，保持现有书写冻结条文不变。

## Impact

依据与影响模块：
- `packages/painting/src/layered/DrawingSurface.tsx` / `LayeredDrawingSurface`：默认 touch 为 none，装配三个独立 adapter。
- `packages/painting/src/input/web/freehandWebAdapter.ts` / `resolveSource`、`handlePointerDown`：已有 pen 判定和单 owner，尚无自动模式 latch。
- `packages/painting/src/layered/navigationWebAdapter.ts` / `createNavigationWebAdapter`：捕获阶段处理固定触摸 pair，`touchDraw` 直接跳过 touch 导航。
- `packages/painting/src/layered/semanticWebAdapter.ts` / `createSemanticWebAdapter`：独立 owner，并按同一来源 policy 过滤语义工具输入。
- `packages/painting/src/core/gesture/session.ts` / `createGestureSession`、`reduceGestureSession`：已有 pending-single/pair 等状态，但分层入口未统一接入；复用边界见 design。
- `packages/painting/src/layered/Toolbar.tsx` / `Toolbar`、`createEditor.ts` / `createEditor`、`core/layeredEditorController.ts` / `createLayeredEditorController`：拟增加模式状态、恢复初始化和菜单。
- `apps/playground/src/layered-editor/LayeredEditorDom.tsx` / `LayeredEditorDom` 及 `tests/ui/touch-drawing-arbitration.spec.ts`：替换仅靠 `touchDraw=1` 的产品路径及过时断言。

无新增依赖、无文档格式迁移；模式属于编辑器偏好，不进入文档或 undo。不扩展原生输入桥、不迁移渲染引擎。本轮仅规划，不修改主 specs 或实现。
