# Proposal

## Why

Android 的绘制入口仍委托 Web，尚无原生墨迹输入和预览。HAM-66 的 PencilKit 验证通道已随 PR #29 合入 main；现在需要在同一 controller/document 边界下规划 Android 接入，避免两端各自维护文档和历史。

## What Changes

- 推荐 Kotlin + Expo Module 封装 Jetpack Ink 临时墨迹，MotionEvent 收集真实 stylus 输入，抬笔后批量交给 DOM controller，沿用 schema 3 与 perfect-freehand 最终几何。具体依赖版本和构建兼容性须先经实施门槛验证，不宣称本轮已验证。
- 推荐本期仅接管自由笔的手写笔输入；手指、鼠标、文字、形状、选择、套索、整对象擦除及尺子约束笔继续使用既有 Web 路径，保留三档输入策略。
- 建立平台中立的会话、快照、提交、取消、重试和逐笔预览退休契约；复用已有 controller 语义，不将带 UIKit 力字段的 PencilkitDemoSample 直接变成 Android API。
- 统一 document、viewport 和 undo/redo 权威；Android 不持久化 Ink stroke、预测点或第二份历史。
- 增加 playground 显式开启入口、构建兼容提示、真机验证步骤及 Web/iOS 回归要求。通过门槛和用户验收前不默认启用 Android 原生路径。
- 本轮仅生成规划文档；下述方案是待评审推荐，不沿用 iOS 用户确认作为 Android 选型授权。

## Capabilities

### New Capabilities

- `android-native-ink-surface`: Android 原生组件、真实采样、输入分流、共享桥、逐笔交接、生命周期及设备验收。

### Modified Capabilities

- `input-session-viewport`: 明确 Android 原生输入的非权威语义，以及有效原生 stylus down 的自动模式检测。
- `freehand-geometry-pressure`: 允许受控原生墨迹作为近似活动预览，保留共享的确定性最终几何。
- `web-platform-skia-retirement`: 将 Android 纯 Web 活动绘制约束扩展为可选原生自由笔，同时保留三端 Web 历史显示和平台依赖隔离。

## Impact

- 建议新增 `packages/painting-android-ink/`（Kotlin Expo view、Gradle/module config、平台隔离的 TS 入口），在 playground 显式依赖并重建 Android development build。
- 预计触及 `packages/painting/src/input/native/`、`apps/playground/src/layered-editor/LayeredEditorDom.tsx` 和新增 Android RN host；`DrawingLayer.android.tsx` 不能在 DOM 内直接挂原生 view。共享桥调整必须保留现有 iOS Demo 外部消息与路由行为。
- 沿用 Expo 57 / RN 0.86 工具链。仓库未提交 Android 生成工程，不能据此声称已确认 minSdk/AGP/Kotlin 兼容；实施须记录实际 prebuild 配置和锁定的 Ink 版本。
- 既有 iOS change 尚未归档，三份共享能力存在 delta 重叠；本提案给出包含 iOS 例外的完整替换要求，不改写旧 change、不把其未完成生产桥任务视为已交付。
- 不做全编辑器原生化、Ink 文档存档、独立撤销、原生选择/文字/橡皮、倾角笔刷、导出功能或 iOS 默认启用。推荐决策、未决设备条件及停止门槛见 design。
