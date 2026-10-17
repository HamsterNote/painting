# Web 自由笔适配器（freehandWebAdapter）验证证据

- 日期：2026-10-08 ｜ 范围：仅文档；未改 source/test/tasks/deepwork。
- 记录**当前 hash 与测试支持边界**，不冒称全面产品验收或正式 Phase 2 gate。

## 1. Hash 与联合证据

| 对象 | sha256 |
|------|--------|
| `input/web/freehandWebAdapter.ts`（867 行，冻结） | `3cbc4d485b2733a579ea9ae83fd997ef640d6ff936df8c1d446b8914924ece22` |
| `input/web/__tests__/freehandWebAdapter.test.ts`（1811 行） | `416b1aa3561d7cfed308785acb0d3184aa438bbaefda8f8b9741d221c3c93a5d` |

联合日志（`~/.cache/opencode-tmp/opencode/pf-webadapter-barrier-{core,dom,typecheck,hashes}.log`）：
- core 5 suites / **125 tests PASS**（0.781s）
- dom 1 suite / **71 tests PASS**（0.863s，legacy-web）
- `pnpm --filter @hamster-note/painting typecheck` EXIT 0
- 直接 strict tsc（DOM lib）最新 EXIT 0；`--listTests` 收集 1 次

## 2. 公开契约（6 exports）

- `WebFreehandSource = 'mouse' | 'touch' | 'pen'`
- `WebFreehandPolicy = Readonly<Record<WebFreehandSource, 'draw' | 'none'>>`（默认三来源 draw）
- `FreehandWebAdapterNotice = { phase: 'begin'|'update'|'end'|'cancel'|'commit'; sessionId; commitId; result }`
- `CreateFreehandWebAdapterOptions = { host; controller; createSessionId; createCommitId; policy?; pressureCapabilityForSource?; onResult? }`
- `interface FreehandWebAdapter { destroy(); getActivePointerIds(); retryCommit(commitId) }`
- `createFreehandWebAdapter(options)`

## 3. DOM 绑定与取消

- 监听：`host` pointerdown / lostpointercapture；`window` pointermove / pointerup / pointercancel / blur / pagehide；`document` visibilitychange（查 `visibilityState`）。
- 取消来源：pointercancel、lostpointercapture、visibilitychange(hidden)、blur、pagehide、工具切换、destroy；取消后无对象/无 history，迟到 up 忽略。
- `destroy()`：移除全部 listener、unsubscribe tools、取消活动笔并 release capture；幂等，之后 down 不产生 ID 回调。
- lostpointercapture 必须派发到 **host**；正常 up 先清 owner 再 release，故同步 lostcapture 不误 cancel。

## 4. 与 controller 的边界

- controller 是文档/history/viewport 唯一真源；adapter 不持有 viewport，brush 由 controller 注入并冻结为**落笔 snapshot**（中途改设置只影响下一笔）。
- owner 记录 pointer/source/session/commit 与批次序号；第二 pointer/不同 source 不接管，source 中途变化 move/up 被拒。
- batch 使用**当前 origin（host rect + border 偏移）与锁定 viewport revision**；不逐点调用 `getSnapshot`（热路径 update 返回 `Result<void>`、不复制快照）。

## 5. 事件语义

- coalesced：**仅 move**；非空列表只消费列表，**不 append parent**（W3C 父与列表二选一，避免重复）；空/无 API/throw 回退 parent。
- **不按值去重**：相同 xy/time/pressure 的独立真实样本全部保留；时间戳保存事件原值，按列表顺序分配 sequence，不自行改写时间或按时间去重。
- 不读 predicted events；不监听 rawupdate。web 侧一个 batch 最多一次 rect read，coalesced 不逐项 layout read；origin/rect 非有限则 down 原子拒绝。

## 6. Pressure 解析

- 默认 capability `unknown`；pen + unknown → real（恒 0.5 也 real，**不以 .5 值启发式推断**）；显式 unavailable → simulated；mouse/touch → simulated。
- capability 在 down 解析一次并整笔锁定；begin 后改设置不改变已锁定 mode。

## 7. 重入 / 失败恢复

- ID/capability、controller 调用与 `onResult` 期间用 barrier 忽略同步嵌套 pointer 数据；通知结束后的独立事件仍可开始下一笔。回调内 destroy/background 延迟到退出 barrier 后处理，不宣称禁止所有控制器操作。
- deferred begin/update 的取消先对账再 phase notice；`destroy` 中 cancel 失败一次则用真实 snapshot 序号 retry，二次失败保留 owner 并通知，允许手动 destroy 恢复。
- commit 失败（allocator/cache）保 candidate；正常外部 `retryCommit` 在 destroy 后仍可恢复 pending。operation、通知回调或 destroy 收尾中重试返回 `internal-invariant`，不再发通知，避免递归。

## 8. 边界与未做

- 71 tests 为 **jsdom** DOM 集成证据，非真实浏览器 pixels、非真机或硬件压感。
- `touch-action`/pan、非笔工具 shape/lasso/eraser 过程语义（4.7）未实现；未整体接入 DrawingSurface/board；4.5 ACK/handoff 无。
- attempt 3/3 曾因两个回调重入问题 BLOCK；用户明确授权局部修复和一次例外复核。例外专项复核 PASS，真实 controller probes 验证回调嵌套 pointer 被忽略、重试递归有界拒绝、回调后正常输入与 destroy 后外部重试保留。
- 主编排结合冻结源码、196 项联合测试和专项结论验收 4.1–4.3。此为 headless/DOM adapter 范围验收，不是正式 Phase 2 总 gate，未将 UI 接线、真实浏览器 pixels 或设备验证视为完成。
