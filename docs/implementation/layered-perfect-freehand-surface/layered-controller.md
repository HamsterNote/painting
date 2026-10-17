# 分层控制器（layeredEditorController）验证证据

- 日期：2026-10-08 ｜ HEAD：`ba4b1342ad2dc423fd0f5879bcb73b6610e6dc33`
- 范围：仅测试与文档；未改生产源码/tasks/global config。
- 本文件记录**当前 hash 与测试支持边界**，不宣称全面 all-passed 产品验收，不冒称 Phase 2 gate。

## 1. Hash（当前终态）

| 对象 | sha256 | git hash-object | 规模 |
|------|--------|-----------------|------|
| `core/layeredEditorController.ts` | `336f1610a6c2f2b32ac4a799576cc15b22233f16e916dc62bb6ff059a754d01c` | `e8575782b9841ada0ca5a2e945311ba8444c2bd8` | 1835 行 |
| `__tests__/core/layered-editor-controller.test.ts` | `5fed07373b54c2f0bdd3a95792ccb6e2ce87ead93af89271cb424b915b4c8d79` | — | 1576 行 / 49 tests |

历史核对：38-PASS 时点 controller git hash 为 `fcbbaedd…`；其后经组合收尾及四项审查修复更新为 `e8575782…`（sha256 已收敛 `336f1610`），本轮已在当前 hash 复跑。主编排再次核对源码与测试 sha256 均匹配本表。

## 2. 联合运行（core-node，5 suites / 125 tests）

命令：`pnpm exec jest --selectProjects core-node --runTestsByPath <5 paths>`
日志：`~/.cache/opencode-tmp/opencode/pf-controller-accepted-jest.log`

- 结果：**5 suites / 125 tests PASS，EXIT_CODE=0**
  - layered-editor-controller **49**
  - layered-freehand-session 35
  - layered-pressure-mode 6
  - layered-freehand-regressions 15
  - layered-freehand-cache 20

`--listTests` 精确收集以下 5 paths（`pf-controller-accepted-listTests.log`）：

```
packages/painting/src/__tests__/core/layered-editor-controller.test.ts
packages/painting/src/__tests__/core/layered-freehand-regressions.test.ts
packages/painting/src/__tests__/core/layered-freehand-session.test.ts
packages/painting/src/__tests__/core/layered-freehand-cache.test.ts
packages/painting/src/__tests__/core/layered-pressure-mode.test.ts
```

## 3. 类型检查

- pkg：`pnpm --filter @hamster-note/painting typecheck` → **EXIT_CODE=0**（`pf-controller-accepted-typecheck.log`；该 tsconfig 排除 `__tests__`）。
- 直接严格：`tsc --noEmit --strict --skipLibCheck --moduleResolution Bundler --types jest <controller test>` → **EXIT_CODE=0**（`pf-controller-accepted-tsc.log`）。

## 4. 行为契约要点（由 49 条集成测试支持）

- **频道**：`document / history / tools / selection / viewport / interaction`；前五者稳定引用，interaction 按需构造。
- **唯一真源**：document + history 由 controller 独占；revision **单调**，每次成功 commit/undo/redo 精确 +1。
- **commitId 幂等**：同 payload → `duplicate`（不改 revision/history/redo；移除 pending 时只通知 interaction，无 pending 时不通知）；不同 payload（含 pressure 缺失 vs 0）→ `commit-id-conflict`；失败（allocator/cache/冲突/revision-exhausted）**保留同一 candidate 引用**，可 retry。
- **pending 顺序**：多项 pending 时后项 commit → `pending-commit-out-of-order`，head 失败也不得越序。
- **active/pending**：active 仅 collecting；end 仅移入 pending，不写 document/history。
- **热路径**：`updateFreehand` 成功为 `Result<void>`，不主动复制快照（spy 真实 session 证明 `getSnapshot` 0 次），只轻量通知 interaction。
- **重入保护**：allocator 回调内 undo/commit 被拒；`getPresentationIdentity` 亦在 runExclusive 下，cache.getGeometry 回调重入 undo/commit → `internal-invariant`，文档与 docrev 不变。
- **typed adopter ≠ 2.2 JSON reader**：私有白名单 copy/deep-freeze 只接受已是 typed schema3 内存文档，不 `JSON.parse`、无 migration，mixed 四类保序。
- **依赖边界**：直接 import 仅 5 个模块（model/document、viewport、freehandSession、viewportTransform、freehandCache），**无 geometry fallback**，**无 DOM/Canvas/SVG/React/Skia**。

## 5. Oracle material-fix 证据（审查已接收，已局部修）

1. viewport 结构校验：collecting/非 collecting 的 missing viewport、NaN、scale 越界、transform NaN → `invalid-input`，不 throw、不 clamp、不改 revision；合法命令仍按 `active-freehand` 丢弃。
2. 重入：allocator 在 commit 期间重入被拒；精确 cache 反例在正常 commit 后开启回调，验证 identity 查询期间 undo/commit 均被 `internal-invariant` 拒绝；`getPresentationIdentity` 纳入互斥。
3. 真实 cache slot：commit 1 / undo 0 / redo 经 identity 重派生重建 / branch 旧 id 清除；`syncDocument` 抛错不阻断事务；prepare-then-throw 失败原子并清理临时 slot，保同一 candidate 可 retry。
4. 提交顺序与原子：先备好 geometry/receipt 再 mutation（防第二次派生造成“已提交却 failed”）；`pending-commit-out-of-order` 反例通过。

## 6. 真实未接线边界

- 旧入口（playground/board）未切换到新 controller。
- 非 freehand 对象的 create/edit 不在该 API 内。
- DOM cancel、真实 coalesced 输入、ACK/handoff、真实浏览器像素、native 实现均未做。

## 7. 验收状态

- **3.1 / 4.4 已由主编排验收**：源码、精确反例和实际联合日志已核对，任务即时勾选；本次不是 Phase 2 正式 gate。
- 证据边界：上述 125 tests 为 headless core-node 集成证据，不代表 UI/三平台/真机产品验收。
