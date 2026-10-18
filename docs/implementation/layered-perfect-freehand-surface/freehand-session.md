# 自由笔输入会话契约（Task 2.3 整笔锁定 + 4.2 / 4.3 纯会话基础）

- 变更：`openspec/changes/archive/2026-10-18-layered-perfect-freehand-surface`
- 实现：`packages/painting/src/core/freehandSession.ts`（headless 状态机，无 DOM/React/Canvas/Skia/history/document 依赖，不创建文档对象或几何）
- 契约来源：`packages/painting/src/model/document.ts`（`resolvePressureMode`、`AcceptedSample`、`BrushSnapshot`、`InputSource`、`PressureCapability`、`PressureMode`）与 `core/viewportTransform.ts`（`normalizeViewportTransform`）
- 状态：纯会话基础实现已验证，Task 2.3 已验收；下述 DOM/controller 集成边界仍未完成。

## 1. 12 exports 核心接口

1. `FreehandSampleInput`：单条输入 `{sequence,x,y,pressure?,time,phase}`。
2. `FreehandInputBatch`：`{sessionId,pointerId,source,batchSequence,coordinateSpace,viewportRevision,samples}`。
3. `BeginFreehandSessionInput`：`{type:'begin',commitId,pressureCapability,brush,viewportSnapshot:{revision,viewport},batch}`。
4. `FreehandSessionUpdate`：`{type:'update',batch}`。
5. `FreehandSessionEnd`：`{type:'end',batch}`。
6. `FreehandSessionCancel`：`{type:'cancel',sessionId,pointerId,source,batchSequence,reason}`；reason 为 `pointercancel|unmount|background|tool-change|explicit`，不携带样本。
7. `FreehandCommitFeedback`：`commit-failed` 或 `commit-succeeded`（含 `objectId/documentRevision`）。
8. `FreehandCandidate`：`{commitId,sessionId,pointerId,source,lockedViewportRevision,brushSnapshot,resolvedPressureMode,samples:readonly AcceptedSample[]}`。
9. `FreehandSessionSnapshot`：四态 union（collecting 内联 owner/brush/mode/viewport/samples/序号；awaiting-commit 含 candidate；committed 含 candidate+objectId+documentRevision；canceled 仅 owner+reason，无 candidate）。
10. `FreehandSessionResult<T>`：`{ok:true,value:T}` 或 `{ok:false,code}`；code 含 `invalid-input/identity-mismatch/coordinate-space-mismatch/viewport-revision-mismatch/batch-sequence-mismatch/sample-sequence-mismatch/phase-mismatch/not-collecting/commit-id-mismatch`。
11. `FreehandSession`：`getSnapshot/update/end/cancel/applyCommitFeedback`。
12. `beginFreehandSession(input):FreehandSessionResult<FreehandSession>`。

## 2. begin 整笔锁定

- 仅调用一次 `resolvePressureMode(brush.pressureMode, source, pressureCapability)` 解析并锁定压力模式；不给 resolver 加新默认，显式模式原样锁定，auto 按 source/capability 路由。
- brush 白名单拷贝并冻结（仅 color/nominalSize/opacity/pressureMode/presetRevision），剔除未知 dash/multiplier/PF 参数；校验 `nominalSize>0`、`opacity∈[0,1]` 且有限、`color` 非空、mode 合法、`presetRevision` 非负安全整数。
- viewport 严格校验：`normalizeViewportTransform` 返回 null 或归一化后值与输入不同（被 clamp）都拒绝，要求落笔 viewport 有限且已规范；白名单拷贝并冻结。锁定 `revision` 与 `coordinateSpace`。
- 所有 id 非空；数值 `pointerId` 为有限安全整数；`batchSequence`/`viewportRevision`/`sequence`/`revision` 为非负安全整数。begin 要求 `batchSequence===0` 且 `batch.viewportRevision===viewportSnapshot.revision`。
- 外部 brush/viewport 在 begin 后改变不影响整笔（快照为独立冻结拷贝）。

## 3. 压力与坐标保真

- `pressure` 缺失保持缺失（条件构造，不写入 `pressure: undefined`）；有限越界值原样保留，本层不 clamp（clamp 属几何派生层）。
- up 上的 0 / 非零都作为原始样本原样保留；本层不做 release 收尾改写。
- `time` 仅要求有限，不强制递增；不按相同 xy/time 去重（零位移样本合法保留）。
- 序号连续性：sample `sequence` 必须从预期值连续（begin 从 0）；batch `batchSequence` 必须为上次 +1。
- 相位规则：begin 首帧 `down`、其后 `move`；update 全 `move`；end 末帧且仅末帧 `up`，batch 非空。
- screen 空间按冻结 viewport 反变换 `world=(screen-tx)/scale`，其余 raw 值原样保留；world 空间原样；转换结果非有限即拒绝。

## 4. 原子拒绝与四态

- 每个 batch 先完整校验（owner/坐标空间/viewport revision/批次序号/sample 序号/相位/有限性/转换）再原子 append；任何失败返回对应 code 且完全不改变 state 与序号，可重送正确批次，不会 partial append。
- 四态：`collecting --end--> awaiting-commit --commit-succeeded--> committed`；`collecting --cancel--> canceled`。
- update/end/cancel 运行时 guard input 为 object 且 type 匹配，再安全取 batch。
- `commit-failed` 留在 awaiting-commit（同 candidate、同 commitId）供 controller 重试；错误 commitId 拒绝。
- awaiting/committed 上的 cancel 返回 `not-collecting`，不丢候选、不回滚；committed 上的 failure 反馈不回退。
- cancel 仅 collecting 可用，成功清内部 buffer 并保留 canceled owner 信息；end 深拷贝 candidate 后清 buffer 减少驻留。

## 5. snapshot 与热路径

- `update` 与内部 `appendBatch` 返回 `FreehandSessionResult<void>`，成功 `ok(undefined)`，**不主动生成 snapshot**，避免每次 append 复制/冻结整笔 O(n)。
- `getSnapshot` 按需复制并冻结当前样本；`end` 一次性深冻结 candidate 及每个 sample 并返回 awaiting snapshot。未来 controller 不得每点取 snapshot（应 rAF 节流后按需取）。

## 6. 明确未覆盖边界（不冒称完成）

- headless 不处理：DOM coalesced 样本排重、预测点过滤、真实 pointercancel/unmount/background 事件接线、竞争 pan/zoom/掌触 intents、唯一 viewport 所有权、document/history 事务与 commit 幂等、presentation ACK/handoff、像素渲染与真机设备/桥性能。
- 因此 4.x 相关项（4.1/4.2/4.3 的集成部分、4.4–4.7）均未完成；本文件不宣称设备、pixels 或 commit/history 已验证。

## 7. 实际验证证据

- 新增 `packages/painting/src/__tests__/core/layered-freehand-session.test.ts`：35 条会话测试；`core-node --listTests` 确认精确收集一次。
- 主编排在最终源码 SHA-1 `e873da44c0892bd0fb55228762f1484742018b48` 上联合执行 session、pressure-mode、freehand-regressions、freehand-cache 四套测试：4 suites / 76 tests 全部通过（exit 0）。命令为 `pnpm exec jest --selectProjects core-node --runInBand --runTestsByPath` 后接上述四个测试文件。
- `pnpm --filter @hamster-note/painting typecheck` 通过；另以 `pnpm exec tsc --noEmit --strict --skipLibCheck --esModuleInterop --moduleResolution node --target ES2022 --module commonjs --lib ES2022,DOM --types jest packages/painting/src/__tests__/core/layered-freehand-session.test.ts` 直接检查测试文件通过，避免包 tsconfig 排除测试产生假覆盖。
- 本地日志：`~/.cache/opencode-tmp/opencode/pf-task2.3-final-combined.log`、`pf-task2.3-final-typecheck.log`；测试 lane 的收集与单文件类型检查日志为同目录 `pf-task2.3-session-*.log`。未以本轮 focused 验证代替全仓/UI/真机验收。
