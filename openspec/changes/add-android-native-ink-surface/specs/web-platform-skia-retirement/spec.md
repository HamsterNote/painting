# Spec Delta

## MODIFIED Requirements

### Requirement: Three replaceable drawing entries share Web implementation

系统 SHALL 保留 Web、iOS、Android 三个可替换绘制入口和相同原始样本文档契约。Web SHALL 使用 Web 活动绘制；iOS/Android 在原生模块匹配、ready 且显式启用时 SHALL 使用相应原生手写笔自由笔临时预览，其余输入继续 Web。三端最终几何与永久历史显示 SHALL 保持共享 Web 实现，原生保留 Expo DOM/WebView 承载；默认关闭的原生配置仍使用既有 DOM 路径。自由笔最终几何不依赖 Skia；每个平台 MUST NOT 要求加载另一平台原生绘制运行时。

#### Scenario: Platform launch uses the same document contract

- **WHEN** 在 Web、iOS 和 Android 启动编辑器并创建同一输入文档
- **THEN** 三端按同一 raw 契约和共享最终规则显示 Web 历史，不加载 Skia；显式原生通道仅改变对应平台自由笔临时预览

#### Scenario: Native module is isolated from other platforms

- **WHEN** 构建任一平台，或受控关闭该平台原生绘制
- **THEN** 构建不解析其他平台原生运行时，关闭后保留既有 DOM 工具和绘制能力，schema 3 文档不需要迁移
