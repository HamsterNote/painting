## 1. Migration

- [x] 1.1 实现严格确定性迁移及形状增量样式，导出 API，添加完整工具/错误/幂等测试。

## 2. Page integration

- [x] 2.1 实现页面几何与 PageDrawingSurface，共用输入逆变换，覆盖缩放/滚动/旋转/分页/取消/颜色测试。

## 3. Delivery

- [x] 3.1 编写接入说明，完成测试、类型检查、lint、build、pack 和 OpenSpec 校验。
- [x] 3.2 提交 PR 并触发正式 minor 发布；核实 registry 可用性，向 reader 交付正式版本与 API 约定。

## 4. Read-only surface patch

- [x] 4.1 解耦展示生命周期与输入启用，覆盖禁用首次挂载、重挂载、文档更新、切换启用状态和底层页面事件。
- [x] 4.2 发布 painting / painting-board 0.8.2，验证正式包下载、导出及只读展示回归，保留已发布 tag。
