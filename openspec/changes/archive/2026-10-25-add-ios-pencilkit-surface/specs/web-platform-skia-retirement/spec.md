# Spec Delta

## MODIFIED Requirements

### Requirement: Three replaceable drawing entries share Web implementation

系统 SHALL 保留 Web、iOS、Android 可替换绘制入口；Web 和 Android 继续复用 Web 活动绘制，iOS 在原生模块就绪并启用时 SHALL 使用原生 Pencil 自由笔活动输入，其余输入沿用 Web。显示端 SHALL 永久为 Web，iOS SHALL 保留 Expo DOM/WebView 历史显示及工具能力。自由笔最终几何不依赖 Skia；Web 与 Android 构建不得要求加载 iOS 原生绘制模块。

#### Scenario: Platform launch uses the same document contract

- **WHEN** 在 Web、iOS 和 Android 启动编辑器并创建同一输入文档
- **THEN** 三端使用相同原始样本契约与 Web 历史显示，不加载 Skia；启用后的 iOS Pencil 使用原生活动预览，Web 和 Android 保持 Web 活动绘制

#### Scenario: Native module is isolated from other platforms

- **WHEN** 构建 Web 或 Android，或在 iOS 受控关闭原生绘制配置
- **THEN** Web/Android 无 iOS 模块解析或运行依赖，关闭配置的 iOS 使用既有 DOM 绘制，schema 3 文档不需要迁移
