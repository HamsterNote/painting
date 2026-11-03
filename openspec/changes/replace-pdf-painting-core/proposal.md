## Why

reader 升级绘图核心需要由 painting 集中承担旧文档迁移和 PDF 页面坐标换算，避免每个消费方保留旧版适配代码。

## What Changes

- 新增显式、可重复调用的旧 DrawingValue / schema 1、2 文档到 EditorDocument 的迁移 API；严格校验，不静默丢对象。
- 新增页面几何与仿射换算 API，以及使用统一输入/显示变换的页面绘图表面。
- 保持现有 0.7 API；按 lockstep 发布 painting / painting-board 0.8.0，并以 0.8.1 修复旧文档公共样式校验缺口。

## Capabilities

### New Capabilities

- `page-document-integration`: 旧文档迁移、页面锚定绘图和增量发布。

### Modified Capabilities

无；通用画板仍由 controller 管理 viewport，页面表面明确由宿主页面管理导航。

## Impact

painting model/core/layered 输入适配器及公开入口；painting-board 重导出；发布元数据、测试和接入文档。reader 存储实现由 reader change 承担，库不访问文件或 v4 blob。
