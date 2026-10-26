# Proposal

## Why

HAM-111 反馈连续快速短笔约隔一笔丢一笔，同频率长笔未见同类问题，影响连续书写可靠性。现有规格已保证快速笔完成及身份隔离，但尚缺连续短笔、同频率长笔及交接积压的量化验收，需建立证据后定点修复。

## What Changes

- 将独立连续短笔、无 move 的 down/up、同帧结束、重复 pointerId 的下一笔明确纳入输入完成契约，不以最短距离、时长或等待上一笔显示作为启笔门槛。
- 补充短/长笔同频率、相同接触时长的对照矩阵，逐笔核对输入、候选、提交、可见历史和 undo/redo，区分输入丢失与仅显示丢失。
- 明确多笔等待历史挂载时的交接及迟到确认规则，保证旧笔确认不清除新笔，撤销后不复活。
- 覆盖 Web pen、按策略允许的 mouse/touch，以及显式开启的 iOS PencilKit 连续短笔与桥接延迟路径。PencilKit 保持默认关闭。
- 根据复现日志选择最小修复点；本 change 不预先断言是采样、节流、双击识别或交接清屏导致。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `input-session-viewport`: 扩展速度无关完成要求，增加连续短笔、同频率长笔和逐笔历史验收。
- `layered-web-rendering`: 扩展幂等交接要求，覆盖多笔在首笔 ACK 前完成、乱序/重复 ACK 与撤销交错。
- `ios-pencilkit-surface`: 为既有原生桥提交契约补充连续短笔及前笔待退休时下一笔的场景，不改变生产发布门槛。

## Impact

可能涉及 `freehandWebAdapter.ts`、`layeredInputArbiter.ts`、`layeredEditorController.ts`、`drawingCanvas.ts`、`PresentationCoordinator.ts` 和 `DisplayLayer.tsx`。若证据指向原生路径，再限定检查 `pencilkitDemoBridge.ts`、iOS playground 消息队列、raw observer 与预览退休账本。复用现有 Jest、Playwright 和真机诊断入口；不新增绘图引擎、不修改 schema 3 或公共 API、不默认启用原生绘制，不扩展到其他工具重构。

本轮仅生成规划产物。当前纯会话探查未复现用户现象；设备、系统、入口及 PencilKit 开关未确认，完整端到端复现和根因定论仍待实施前证据采集，详见 design。
