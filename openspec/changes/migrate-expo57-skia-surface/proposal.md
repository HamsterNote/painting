# Proposal

## Why

现有绘制面是仅面向浏览器的 SVG DOM 实现：它依赖 Vite、`document`、DOM 指针捕获和 SVG 专属元素，声明的 React Native 支持无法在 iOS 与 Android 上实际运行。项目需要以 Expo SDK 57 承载应用，并以 Skia 提供一致、可扩展的矢量绘制能力。

**范围修订（见 `decisions/web-only-acceptance-scope.md`）**：正式产品验收改为 **Web-only**；
原生界面、Adapter、路由与依赖**保留并继续开发**，但原生侧**不再要求真实启动/触控/手势/Skia/
IME/picker/权限/性能/E2E 的验收**，只保留 **`compat-static` 静态兼容门**（根 `pnpm typecheck`、
Expo Android/iOS 静态导出、native Jest/RNTL 最小挂载）。Web 仍 MUST 最终默认切换到正式 Skia 编辑面（7.4 未取消）。

## What Changes

- **BREAKING** 将 playground 从 Vite Web 应用迁移为 Expo SDK 57 应用，并以 Expo Metro/Expo Router 承载 **Web 正式验收面**，同时保留 iOS/Android 目标以支持 **`compat-static` 静态兼容**。
- 新建由 `@shopify/react-native-skia` 驱动的绘制面；不再将 SVG DOM 作为目标渲染器。
- 将绘制文档、几何、命中测试和输入语义抽离为无 DOM、无 React Native、无 Skia 依赖的核心层，并统一使用 V2 绘制模型。
- 以 Skia 的单一 viewport matrix 承担世界坐标的平移与缩放；保留屏幕恒定的交互叠层语义。
- **BREAKING** 删除对 `@system-ui-js/multi-drag`（含其 core 包）的运行时依赖，以领域专用的手势会话实现多指导航、尺子与选区变换语义。
- 为 Expo Web 增加本地 CanvasKit 加载、失败反馈及有限期的 legacy SVG 回退；在 **Web 功能与性能门禁**通过后切换为 **Web 默认 Skia 绘制面**（7.4），并在稳定周期后删除 legacy 实现。
- 将文本编辑、图片资源导入和自动化测试改造成以 **Web 验收面**为主的实现；原生 UI 保留开发但**不做自动验收**。

## Capabilities

### New Capabilities
- `expo-skia-runtime`: Expo SDK 57 的 **Web 交互启动与 Skia Web 加载/切换行为**，以及 iOS/Android **静态目标兼容（`compat-static`）** 要求。
- `cross-platform-drawing-surface`: 基于统一文档、坐标和几何契约的 Skia 绘制、命中及交互叠层行为（**Web 为功能/性能正式验收面**）。
- `drawing-gesture-sessions`: 不依赖 multi-drag 的绘图、导航、尺子与选区多指手势仲裁行为。
- `drawing-resource-editing`: **Web 临时文本编辑/组合输入与 Web shell 资源导入**，以及图片资源解析、兼容读取的纯 core 行为。

### Modified Capabilities

无；仓库目前没有已登记的 OpenSpec capability。

## Impact

- 主要影响 `apps/playground`、`packages/painting`、`packages/painting-board` 及其 DOM/SVG 测试。
- 新增 Expo SDK 57、Expo Router、React Native Gesture Handler、Reanimated 和 Expo 认证的 `@shopify/react-native-skia` 依赖；移除 Vite 运行时及 multi-drag 依赖。
- 需要迁移发布/CI、Web CanvasKit 静态资源、**Web 正式验收测试**与文档化的兼容策略；CI 需覆盖 **Web 交付**与**移动 `compat-static` 静态兼容**。
- 绘制组件的内部实现与部分平台特定适配 API 会改变；持久化的既有 V1/V2 绘制数据和既有图片 `src` 值必须继续可读。
- **范围修订**：原生运行/性能/E2E 验收要求被取代（`CANCELLED`/`REPLACED`），历史验证报告不改写；原生只保留 `compat-static` 静态兼容门。
