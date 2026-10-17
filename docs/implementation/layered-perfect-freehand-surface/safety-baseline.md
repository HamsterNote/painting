# 安全基线与可恢复备份报告

- Change: `layered-perfect-freehand-surface`
- 任务: 安全 1.1（dirty tree 记录 + 可恢复备份）与基线 1.4（工具版本 + Jest 收集 + 既有测试/类型/构建基线）
- 执行时间: 2026-10-05（Asia/Shanghai）
- 执行者: fixer subagent
- 验证所有者: 主编排（勾选与备份核对由主编排完成）
- 说明: 本报告只记录证据，不修改任何业务/配置/依赖/任务勾选，不 `reset`/`clean`，不提交。备份在任何产生 build 产物的命令之前完成。

---

## 1. 任务 1.1：dirty tree 与可恢复备份

### 1.1 Git 状态（备份时刻）

- HEAD: `ba4b1342ad2dc423fd0f5879bcb73b6610e6dc33`
- 分支: 见 `<备份目录>/meta/branch.txt`
- `git status --porcelain=v1` 摘要: **35 个 M（tracked 修改）、4 个 D（tracked 删除）、43 个 `??`（untracked 顶层条目）**
- tracked 文件总数: **145**
- untracked（非 ignored）文件数: **208**
- ignored 文件数（未备份）: **101669**
- deleted tracked（工作区 `--diff-filter=D`）:
  - `apps/playground/index.html`
  - `apps/playground/src/main.tsx`
  - `apps/playground/vite.config.ts`
  - `packages/painting/src/types/virtual-paper.d.ts`

原始记录（脚本可复核，均为备份时快照）:
- `meta/status.porcelain.z`（`git status --porcelain=v1 -z` 原样）
- `meta/status.porcelain.v1.txt`、`meta/status.full.txt`
- `meta/diff.worktree.binary.patch`（tracked 工作区 diff，**含 binary**）
- `meta/diff.cached.binary.patch`（staged diff）
- `meta/name-status.worktree.txt`、`meta/name-status.cached.txt`
- `meta/untracked-files.txt`、`meta/tracked-files.txt`、`meta/deleted-tracked.txt`、`meta/ignored-files.txt`
- `meta/archive-input-files.z`、`meta/tracked-missing-in-worktree.txt`

仓库内快照副本: `docs/implementation/layered-perfect-freehand-surface/baseline-logs/16-git-state-snapshot.txt`

### 1.2 备份位置与内容

**备份目录（仓库外，独立）:**

```
/home/zhangxiao/.cache/opencode-tmp/opencode/backups/layered-perfect-freehand-surface-20261005-153833
```

指针文件: `/home/zhangxiao/.cache/opencode-tmp/opencode/backups/.latest-layered-perfect-freehand-surface`

| 文件 | 内容 |
|------|------|
| `worktree.tar` | 工作区实际存在的全部 **tracked 源文件** + **全部非 ignored untracked 内容**，共 349 个成员、约 46.3 MB |
| `worktree.sha256` | 349 个文件的 sha256 清单（`<hash>  ./相对路径`） |
| `head.tar` | `git archive HEAD`，198 个 tracked 文件，用于恢复工作区中已删除（D）的文件 |
| `meta/` | HEAD、status（-z/v1/full）、tracked/untracked/ignored/deleted 清单、binary diff、index entries |
| `staging/`、`restore/` | 恢复校验用的解包目录 |
| `staging.structure.txt`、`restore.structure.txt` | 类型+路径结构清单 |
| `README.md` | 恢复说明 |

**明确排除（不备份）**: `node_modules/`、`.git/`、`.gitignore` 命中的 build 产物（`dist/`、`build/`、`lib/`）、`playwright-report/`、`test-results/`、`.expo/`、`coverage/` 及 101669 个 ignored 文件（清单见 `meta/ignored-files.txt`）。

**备份包含未完成旧 change**: `openspec/changes/migrate-expo57-skia-surface/` 全部 32 个文件已进入 `worktree.tar`（含 tasks.md、design.md、proposal.md、decisions、spikes、specs、verification）。新 change `openspec/changes/layered-perfect-freehand-surface/` 亦已纳入。

### 1.3 备份验证结果

| 校验 | 方法 | 结果 |
|------|------|------|
| tar 成员检查 | `tar -tf worktree.tar \| wc -l` | **349**（与 archive 输入一致） |
| 实际恢复 | `tar -xf worktree.tar -C restore/` | 成功 |
| 哈希核对 | `sha256sum -c worktree.sha256 --quiet`（在 restore/ 内） | **PASSED**（349/349） |
| 结构核对 | `diff staging.structure.txt restore.structure.txt` | **PASSED**（349 文件 / 108 目录 / 0 软链） |
| HEAD 归档可恢复被删文件 | `tar -tf head.tar` grep 4 个 D 文件 | 4/4 命中 |

### 1.4 如何仅恢复特定文件（避免覆盖后续工作）

原则：**不要把整包解压回仓库根**。先解到临时目录，确认 diff 后再单文件 copy。

```bash
BK=/home/zhangxiao/.cache/opencode-tmp/opencode/backups/layered-perfect-freehand-surface-20261005-153833
REPO=/home/zhangxiao/frontend/HamsterNote/painting.feat-use-perfect-freehand

# 1) 新建独立空目录；先从归档清单确认成员名，不清空已有目录
RESTORE=$(mktemp -d "$BK/onefile.XXXXXX")
tar -tf "$BK/worktree.tar"
# 以下成员名必须与上面清单一致（如含 ./ 前缀，也须保留）
tar -xf "$BK/worktree.tar" -C "$RESTORE" -- packages/painting/src/viewport.ts
# 2) 查看差异
diff -u "$REPO/packages/painting/src/viewport.ts" "$RESTORE/packages/painting/src/viewport.ts" || true
# 3) 确认后单文件回填
cp "$RESTORE/packages/painting/src/viewport.ts" "$REPO/packages/painting/src/viewport.ts"
```

- 恢复子树：先从归档清单选择该子树的真实成员名，提取到新的独立临时目录后用 `cp`/`rsync` 挑选；不要假定归档包含目录成员。
- 恢复工作区已删除的 tracked 文件（D）：从 `head.tar` 提取对应路径再 `cp`（恢复会改变 dirty tree，须确认有意为之）。
- 哈希自检：`sha256sum -c "$BK/worktree.sha256"`（在解包目录内运行）。
- 不要使用 `git reset --hard` / `git clean` 做批量回退。

### 1.5 旧 change 任务完成数（备份时快照）

`openspec/changes/migrate-expo57-skia-surface/tasks.md`:

- 总 checkbox: **46**
- 已完成 `[x]`: **38**
- 未完成 `[ ]`: **8** — 9.2、10.1、10.2、10.3、11.1、11.3、11.4、12.1

该 change 仍处于未完成、未归档状态，本次未修改、未归档、未标记完成。

### 1.6 无 blanket reset/clean 声明

整个流程未执行 `git reset`、`git checkout -- .`、`git clean`、`git stash`。基线运行前后对比：tracked/untracked 状态完全一致，仅新增允许写入的 `docs/` 目录（见 §3.4）。

---

## 2. 任务 1.4：工具版本

`baseline-logs/00-tool-versions.txt`:

- OS: Ubuntu 26.04 LTS（内核 7.0.0-31-generic，x86_64）
- CPU: Intel Core i7-8700 @ 3.20GHz
- node: v24.15.0
- pnpm: 10.28.2
- git: 2.53.0
- jest: 29.7.0
- playwright: 1.59.1
- typescript: 5.9.3

---

## 3. Jest 收集与基线

### 3.1 `pnpm exec jest --listTests` 四 projects 实际收集

依据 `jest.config.js`（projects: `legacy-web`、`core-node`、`native`、`skia-canvaskit`），分别用 `--selectProjects` 列出（剔除 jest `Running one project:` 头部行）:

| project | 收集测试文件数 |
|---------|----------------|
| legacy-web | 31 |
| core-node | 31 |
| native | 2 |
| skia-canvaskit | 1 |
| **并集** | **65** |
| 全局 `--listTests` | **65** |
| 重复收集 | **0** |

四 project 并集与全局列表**完全一致**（65），无重复收集。
详情: `baseline-logs/01-jest-listTests-all.txt`、`02-jest-listTests-<project>.clean.txt`、`14-jest-collection-analysis.txt`。

### 3.2 缺口：`apps/playground/*.unit.test` 未被根测试收集

以下 **7 个** playground unit test **不被任何 project 收集**（`roots`/`testMatch` 均不覆盖 `apps/playground`），故不进入根 `pnpm test`:

- `apps/playground/src/editor-candidate/EditorCandidateAppendPipeline.unit.test.ts`
- `apps/playground/src/editor-candidate/EditorCandidateCanvas2dPenCanary.unit.test.tsx`
- `apps/playground/src/editor-candidate/EditorCandidateCorrectness.unit.test.ts`
- `apps/playground/src/editor-candidate/EditorCandidatePerformanceScheduler.unit.test.ts`
- `apps/playground/src/editor-candidate/EditorCandidatePerformance.unit.test.ts`
- `apps/playground/src/editor-candidate/EditorCandidateSplitCanvas.unit.test.ts`
- `apps/playground/src/editor-candidate/penPreviewCanvas.unit.test.ts`

**这意味着后续新增测试必须放入被收集路径或显式接入测试工程**，不能把 playground unit test 当作已通过。

### 3.3 基线命令结果

| # | 命令 | 退出码 | 结果 | 日志 |
|---|------|--------|------|------|
| 1 | `pnpm test` | **0** | 65 suites / 1067 tests 全部通过（4 projects，16.9s） | `10-pnpm-test.log` |
| 2 | `pnpm run typecheck` | **0** | painting + painting-board + playground `tsc --noEmit` 通过 | `11-pnpm-typecheck.log` |
| 3 | `pnpm run build` | **0** | lib build（bob）+ `expo export --platform web` 成功，输出 `dist` | `12-pnpm-build.log` |
| 4 | `timeout 1800 pnpm run test:ui` | **1** | 144 passed / 4 failed，用时 4.5m，**未超时**（未触发 1800s 上限） | `13-pnpm-test-ui.log` |

汇总: `baseline-logs/15-baseline-summary.txt`。

### 3.4 基线运行对 dirty tree 的影响

基线前（备份时）与运行后对比：除新增允许写入的 `docs/` 目录外，tracked/untracked 状态**完全一致**。未修改任何既有 dirty 改动，未 reset/clean。

### 3.5 前置失败（既存失败，本次不修复）

`pnpm run test:ui` 的 4 个既存失败（均为既有测试，未由本次引入，本次未修复）:

1. `tests/ui/canvas-runtime.spec.ts:158`（一次性重试：解除 WASM 阻断后刷新）— `TimeoutError: page.waitForEvent "framenavigated"` 30000ms 超时；伴随 `page.waitForResponse: Test ended.`
2. `tests/ui/interaction-feedback.spec.ts:105`（滚轮缩放百分比）— `toBeCloseTo` x: Expected 120, Received 119
3. `tests/ui/interaction-feedback.spec.ts:170`（触摸缩放百分比）— `toBeCloseTo` x: Expected 131, Received 130
4. `tests/ui/touch-drawing-arbitration.spec.ts:77`（首触转双指）— `toHaveCount` `path[opacity="0.7"]` Expected 0, Received 1（5000ms）

### 3.6 明确未声明通过的内容

- 无 `pack:dry`、`lint`、`format:check` 基线（不在本次任务范围）。
- `test:ui` 因 4 个既存失败而**整体失败（exit 1）**，不得宣称 UI 基线通过。
- UI 命令实际**未超时、完整跑完 148 个用例**（144 + 4）。
- 备份恢复校验只证明 tar/哈希/结构可恢复；不证明业务正确性。

---

## 4. 权限 / 环境阻塞

- 本次未遇到 sudo/权限阻塞；所有命令在普通用户 `zhangxiao` 下执行成功。
- `free -h` 未输出内存字段（环境无该字段），非阻塞。

---

## 5. 证据索引

一切证据位于 `docs/implementation/layered-perfect-freehand-surface/baseline-logs/`:

- `00-tool-versions.txt`
- `01-jest-listTests-all.txt` / `.stderr.txt`
- `02-jest-listTests-{legacy-web,core-node,native,skia-canvaskit}.txt` / `.clean.txt` / `.stderr.txt`
- `10-pnpm-test.log`
- `11-pnpm-typecheck.log`
- `12-pnpm-build.log`
- `13-pnpm-test-ui.log`
- `14-jest-collection-analysis.txt`
- `15-baseline-summary.txt`
- `16-git-state-snapshot.txt`

备份证据位于 `<备份目录>/`（`worktree.tar`、`worktree.sha256`、`head.tar`、`meta/`、`staging*`、`restore*`、`README.md`）。
