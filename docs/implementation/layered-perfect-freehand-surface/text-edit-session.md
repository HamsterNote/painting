# Text edit session（core/layeredTextEditSession.ts）验证证据

- 日期：2026-10-14 ｜ 范围：仅测试与文档；未改 source/tasks。
- 记录**当前 hash 与测试支持边界**；不代表 5.5 完成，不勾 tasks。

## 1. Hash 与验证

| 对象                                               | sha256                                                             | 规模              |
| -------------------------------------------------- | ------------------------------------------------------------------ | ----------------- |
| `core/layeredTextEditSession.ts`                   | `2ec1962e72d272f6745a42143e00f5287bc9b854ad9c1d9285153f06329a2cc9` | 终态              |
| `__tests__/core/layered-text-edit-session.test.ts` | `1011e7df1fa215670c10174455740a8035b7a51057f24472463788d2ab8ce816` | 604 行 / 35 tests |

- `core-node` focused：**35 tests PASS，EXIT_CODE=0**；直接 strict tsc EXIT 0；`--listTests` 收集 1
- 日志：`~/.cache/opencode-tmp/opencode/pf-text-session-{jest,tsc,listTests,hashes}.log`
- 主编排冻结联合验证：10 个 core suites（277 tests）及 Web adapter（71 tests）全部通过，painting 包 typecheck 通过；日志 `pf-world-text-accepted-{core,dom,typecheck}.log`。这不是全仓或真实 IME 验证。

## 2. 冻结 10 exports

`LayeredTextEditDraft` / `LayeredTextEditDraftUpdate` / `LayeredTextEditTarget` /
`LayeredTextEditCandidate` / `LayeredTextEditFeedback` / `LayeredTextEditSnapshot` /
`LayeredTextEditErrorCode` / `LayeredTextEditResult` / `LayeredTextEditSession` /
`beginLayeredTextEditSession`。

## 3. 覆盖语义

- 纯内存状态机：无 document/history/DOM/focus/真实 IME；普通结构非法输入返回 Result（**不承诺 getter/proxy 等异常**）；输入不改写。
- 候选：new 空 content → noop，非空 → create；existing 空 → delete，非空 → update；content 不 trim。
- begin 非法（未知 target kind / 空 objectId / revision / transform NaN·奇异 / fontSize·color·bounds 非法 / runtime undefined）→ `invalid-input`。
- composition：start 幂等；composing 期间 requestCommit 挂起（`candidate-not-ready`）；end final 缺 content / 非法字段整包原子拒绝并保 composing/draft/pending；合法 final 一次生成候选（中文/emoji 原样）；无 pending 结束回 editing。
- awaiting：updateDraft / startComposition 拒绝；重复 requestCommit 幂等；候选稳定。
- failed：四种 reason 保候选/target 可 retry；stale 不换 ID/revs。
- success 严格匹配（next-safe revision）：noop（docrev 相等、id/rev null）；create（docrev = expected+1、objectRevision = 1）；update（objectId 匹配、objectRevision = expectedObjectRevision+1）；delete（objectId 匹配、objectRevision null）；wrong id/rev/docrev → `feedback-mismatch` 且 state/candidate 保留。
- 终态：committed 重复同 receipt 幂等、late failed/cancel 不回退；cancel 幂等并清理 composing/pending；late end/success 拒绝。
- MAX_SAFE_INTEGER：`nextSafeRevision` 为 null 时无合法后继——update 目标 expectedObjectRevision=MAX_SAFE 时，objectRevision null/MAX_SAFE 均 mismatch；create 目标 docrev=MAX_SAFE 无合法成功 receipt；unsafe feedback（MAX_SAFE+1）→ `invalid-input`。
- 边界精修：noop 候选携带深冻结 target；updateDraft 混合非法原子拒绝、显式 known undefined 拒绝、unknown 字段剔除；endComposition 真缺 content（`{}`）原子拒绝后可 valid retry，候选 target/draft/bounds 嵌套冻结且外部 transform mutation 不影响。

## 4. 关联机械修（world-bounds test）

- `layered-world-bounds.test.ts`（`3644caa81326bdb141812253f7fc7ab08e04846f2e02ac520525927b352e20d5`，581 行）修正 refs 断言为“先存 refs/JSON、再 derive、后校验不变”，并明确 dense 标题为代表性采样；仍 35 tests PASS、tsc 0。

## 5. 边界与未做

- 未接 controller/DOM/焦点/真实 IME composition；无像素/真机；无 V2/Skia。
- Task 5.5 的 controller 创建对象、foreignObject 焦点/键盘接线与端到端未做；不勾 tasks。
