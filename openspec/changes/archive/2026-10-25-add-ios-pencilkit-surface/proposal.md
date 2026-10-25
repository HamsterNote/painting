# Proposal

## Why

iOS 的 `/layered-editor` 目前通过 Expo DOM/WebView 完成活动绘制，尚无 PencilKit 原生墨迹。HAM-64 已完成 dev client 运行验证，现在需要在保留 schema 3 文档与 Web 显示端的前提下，为 Apple Pencil 建立原生输入与预览通道。

## What Changes

- 新增 Swift + 自定义 Expo Module 的 PencilKit 组件，仅接管 iOS 自由笔的 Apple Pencil 输入与临时墨迹；历史显示、工具栏、文字、选择/套索、整对象擦除及形状继续由 Web 管理。
- 原生在本地收集真实触点，结束后批量提交 schema 3 accepted raw；PencilKit drawing/path 不作为原始样本或存档。最终轮廓继续使用共享 perfect-freehand（PF）。
- 保留 controller 对 document、undo/redo、viewport、brush snapshot、输入模式与会话归属的唯一权威，补充具备版本、会话失效与重试语义的真实桥。
- 保留三档输入模式、手指绘制与导航能力；建议 PencilKit 本期只收 Pencil，手指和非自由笔工具走现有 Web 通道，分流可行性必须真机验证。
- 明确原生临时墨迹与 PF 最终形状可能不同；跨进程交接需实测，不能把 commit-result 或 Web 挂载 ACK 当作物理显示同步证明。
- 本轮只提交 proposal、design、delta specs、tasks；修勾已确认采用 D1-A / D2-A / D3-A，后续执行者可据此进入 apply。本轮不实现、不部署、不合并、不修改 main 行为。

## Capabilities

### New Capabilities

- `ios-pencilkit-surface`: Expo 原生组件、输入分流、raw 采样桥、中心化历史、生命周期、交接及设备验收。

### Modified Capabilities

- `input-session-viewport`: 将未来语义输入约束具体化为 iOS 真实桥；原生有效 Pencil down 可参与自动模式检测。
- `freehand-geometry-pressure`: 允许 iOS PencilKit 仅作为近似活动预览，最终确定性轮廓仍使用共享算法。
- `web-platform-skia-retirement`: 将三端均用 Web 活动绘制的阶段约束更新为 iOS PencilKit 活动层、Web 永久历史显示，Android 保持现状。

## Impact

- 预计新增 `packages/painting-pencilkit/`（Expo Module、Swift view、TS 接口及 iOS 平台解析），以及 painting 的语义桥与 iOS host 组合接口；具体名称为建议落点。
- 影响 `packages/painting/src/input/native/layeredSemanticContract.ts`、`core/layeredEditorController.ts`、`layered/PresentationCoordinator.ts`、`packages/painting-board` 的 host 组合，以及 playground 的 `LayeredEditorRoute.tsx` / `LayeredEditorDom.tsx`。
- `DrawingLayer.ios.tsx` 当前随 DOM 子包运行，不能仅改 re-export 就在 DOM 中加载 UIKit；原生组件必须位于 RN host。Web 入口不得解析到原生模块。
- 增加 Expo Modules / PencilKit 原生构建依赖，须重建 iOS development build；沿用 SDK 57、RN 0.86 与 iOS 16.4 基线，最终以实际工具链验证为准。
- 不做 Android 原生墨迹、PKDrawing 存档/schema 升级、PencilKit 独立撤销、PKToolPicker、原生套索/像素擦除、倾角笔刷、PNG/SVG 导出或全编辑器原生化。
- 三项决策及备选见 design 的 D1-D3。修勾在 HAM-66 评论 `01a154b5-a92b-7f0f-9d50-44c3038e5bd6` 回复“同意采用”，确认 D1-A / D2-A / D3-A；该确认不代表 G1-G3 已验证通过或已接受尚未展示的真机外观。
