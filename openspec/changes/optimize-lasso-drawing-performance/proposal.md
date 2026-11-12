# Proposal

## Why

HAM-245 反馈空画布套索流畅、存在笔画时严重掉帧，优先怀疑随历史笔画数量增长的逐次开销（整层更新、命中检测、文本或图层快照），而不是套索采样本身。源码已发现每次套索更新重新查询完整多边形、预览变动带动历史对象遍历及挂载确认扫描；尚未进行性能实测，不能把这些候选热点描述为已确认根因。

## What Changes

- 隔离套索轨迹预览与静态历史显示，消除仅轨迹变化导致的历史遍历、挂载确认和无效选区更新。
- 合并高频输入的可视更新，复用候选几何并缩小精确查询范围；保留绘制中的选区反馈及结束时完整轨迹的精确结果。
- 建立 0、100、500、1000 笔的端到端对照，覆盖局部圈选、密集圈选和混合对象；平均帧率至少达到空画布的 90%，估算掉帧率增量不超过 5 个百分点，并检查轨迹显示延迟与结束耗时。
- 保持相交选择、取消恢复、工具切换、选择变换及撤销重做语义。

上述规模与门槛为本方案提出的验收基准，不是已有实测结果或用户确认过的设备 SLA。默认覆盖共享 Web/DOM 套索路径（含 iOS WebView 承载）；设备与输入方式记录在性能报告中。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `layered-web-rendering`: 增加有历史内容时的套索响应性能和可复现测量要求。
- `document-object-interaction`: 明确调度优化下套索的实时反馈、最终选择与取消一致性。

## Impact

涉及 `packages/painting/src/core/layeredToolSession.ts`、`layeredObjectQuery.ts`、`layeredEditorController.ts`，以及 `src/layered/DisplayLayer.tsx`、`SelectionOverlay.tsx` 和输入适配边界；具体改动以采样结果定位。复用现有 core/Jest 与 layered-editor Playwright 测试入口，新增套索专用性能场景及报告，不沿用旧核心的 100k Node 微基准作为 UI 帧率证据。不更改公共 API、存储格式、选择规则或绘图引擎；与 `replace-pdf-painting-core` 的页面迁移能力独立，并验证页面坐标接入不回归。
