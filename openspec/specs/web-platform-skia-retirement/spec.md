# web-platform-skia-retirement Specification

## Purpose

建立永久 Web 显示端和第一期三平台共同绘制能力的交付边界，同时要求安全移除尚未验收的 Skia 方案及专用依赖，保护当前工作区的非 Skia 用户工作和 Expo 承载能力。

## Requirements

### Requirement: Three replaceable drawing entries share Web implementation

系统 SHALL 保留 Web、iOS、Android 可替换绘制入口；Web 和 Android 继续复用 Web 活动绘制，iOS 在原生模块就绪并启用时 SHALL 使用原生 Pencil 自由笔活动输入，其余输入沿用 Web。显示端 SHALL 永久为 Web，iOS SHALL 保留 Expo DOM/WebView 历史显示及工具能力。自由笔最终几何不依赖 Skia；Web 与 Android 构建不得要求加载 iOS 原生绘制模块。

#### Scenario: Platform launch uses the same document contract

- **WHEN** 在 Web、iOS 和 Android 启动编辑器并创建同一输入文档
- **THEN** 三端使用相同原始样本契约与 Web 历史显示，不加载 Skia；启用后的 iOS Pencil 使用原生活动预览，Web 和 Android 保持 Web 活动绘制

#### Scenario: Native module is isolated from other platforms

- **WHEN** 构建 Web 或 Android，或在 iOS 受控关闭原生绘制配置
- **THEN** Web/Android 无 iOS 模块解析或运行依赖，关闭配置的 iOS 使用既有 DOM 绘制，schema 3 文档不需要迁移

### Requirement: Safely retire the uncompleted Skia plan

本 change SHALL 显式取代 `migrate-expo57-skia-surface`；实施 SHALL 移除全部 Skia 依赖、exports、渲染实现及专用资源/脚本/测试/文档引用和旧未归档 change，不将未完成旧任务标为完成归档。删除前 MUST 盘点并备份/隔离 dirty tree，只移除明确 Skia 内容；MUST NOT 使用 blanket reset/clean 或破坏无关 Expo、工具链及平台无关代码。

#### Scenario: Removal preserves unrelated work

- **WHEN** 工作区同时存在 Skia 专用和非 Skia 未提交改动，实施退休任务
- **THEN** 删除清单和备份可核对，Skia 专用入口/运行时依赖被移除，非 Skia 改动与 Expo 启动能力保留，旧 change 不被伪装完成归档

### Requirement: No legacy fallback or additional product scope

系统 SHALL 不为未上线产品保留旧绘制 API、legacy V1/V2 或中心线 fallback 迁移路径；平台无关几何、选择与历史逻辑 SHALL 仅在审计和测试后复用。此改造 MUST 不引入新的 PNG/SVG 导出功能、通用 tile cache 或照搬 Skia 描述符/未验证 frame budget。

#### Scenario: New editor has only the selected rendering path

- **WHEN** 构建并使用新的编辑器及 playground
- **THEN** 自由笔仅走新的共享填充轮廓路径，不提供 legacy/Skia fallback 路由或新增导出操作
