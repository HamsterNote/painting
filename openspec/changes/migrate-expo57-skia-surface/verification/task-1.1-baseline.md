# 任务 1.1 迁移前基线报告

- 变更：`migrate-expo57-skia-surface`
- 任务：1.1 记录迁移前基线（`git status` + `pnpm install` / `pnpm lint` / `pnpm test` / `pnpm build`）
- 验证所有者：父 orchestrator
- 生成时间：2026-09-23
- 写入范围：仅本报告（`verification/` 目录），未修改 package.json、lockfile、CI、源代码或任何既有未提交文件

## 环境信息

| 项 | 值 |
| --- | --- |
| 仓库 HEAD | `ba4b1342ad2dc423fd0f5879bcb73b6610e6dc33` |
| Node | `v24.15.0` |
| pnpm | `10.28.2` |
| 工作目录 | `/home/zhangxiao/frontend/HamsterNote/painting.feat-use-perfect-freehand` |

## 命令执行结果

| # | 命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 1 | `pnpm install` | `0` | 通过（lockfile 已是最新，未改动） |
| 2 | `pnpm lint` | `0` | 通过（0 error, 4 warning） |
| 3 | `pnpm test` | `1` | **失败**（10 suites failed / 25，255 tests passed） |
| 4 | `pnpm build` | `2` | **失败**（lib 成功，playground 构建失败） |

> 说明：本任务为“基线记录”，不修复任何失败。命令 3、4 的失败均为迁移前既有状态，未做任何修复。

## 迁移前既有未提交改动清单

`git status --short`（命令前 = 命令后，完全一致）：

```
 M .github/workflows/ci-pr.yml
 M .github/workflows/publish.yml
 M .gitignore
 M apps/playground/package.json
 M package.json
 M packages/painting-board/package.json
 M packages/painting/package.json
 M playwright.config.ts
?? openspec/changes/migrate-expo57-skia-surface/
?? pnpm-lock.yaml
?? pnpm-workspace.yaml
```

其中 pnpm / CI 相关既有未提交改动：

- CI：`.github/workflows/ci-pr.yml`、`.github/workflows/publish.yml`（已修改）
- pnpm 相关：`pnpm-lock.yaml`、`pnpm-workspace.yaml`（未跟踪）、各 `package.json`（`package.json`、`apps/playground/package.json`、`packages/painting/package.json`、`packages/painting-board/package.json`，已修改）
- 其他：`.gitignore`、`playwright.config.ts`、`openspec/changes/migrate-expo57-skia-surface/`（本变更目录，未跟踪）

这些改动均属迁移前既有状态，本任务**未实施、未修改、未合并**（见下方完整性校验，哈希前后一致）。

## 各命令精炼输出摘要

### 1. `pnpm install` — 退出码 0

```
Scope: all 4 workspace projects
Lockfile is up to date, resolution step is skipped
Already up to date
Done in 781ms using pnpm v10.28.2
```

### 2. `pnpm lint` — 退出码 0

```
> eslint .
✖ 4 problems (0 errors, 4 warnings)
```

告警明细（不阻塞）：

- `packages/painting/src/__tests__/DrawingSurface.test.tsx:1034` `jest/expect-expect`：测试无断言
- `packages/painting/src/components/DrawingSurface.tsx:3574 / 3577 / 3894` `react-hooks/exhaustive-deps`：cleanup 中 ref 值可能已变化（共 3 处）

### 3. `pnpm test` — 退出码 1（失败）

```
> jest --runInBand
Test Suites: 10 failed, 15 passed, 25 total
Tests:       255 passed, 255 total
Time:        4.604 s
ELIFECYCLE  Test failed.
```

失败的 10 个 suite（均为 `Test suite failed to run`，非断言失败；已执行的 255 个用例全部通过）：

```
FAIL packages/painting-board/src/__tests__/PaintingBoard.test.tsx
FAIL packages/painting/src/components/__tests__/PaintingBoard.test.tsx
FAIL packages/painting/src/components/__tests__/PaintingController.relative.test.tsx
FAIL packages/painting/src/components/__tests__/PaintingController.test.tsx
FAIL packages/painting/src/components/__tests__/PaintingStrokeColorControl.test.tsx
FAIL packages/painting/src/__tests__/DrawingSurface.test.tsx
FAIL packages/painting/src/__tests__/Minimap.test.tsx
FAIL packages/painting/src/__tests__/TextDrawingSurfaceSelection.test.tsx
FAIL packages/painting/src/__tests__/TextDrawingSurface.test.tsx
FAIL packages/painting/src/__tests__/virtual-paper-import.test.ts
```

失败原因归为两类（均为迁移前既有配置问题）：

1. **`@system-ui-js/multi-drag` ESM 未被 Jest 转换**（8 个 suite 报此错）：
   ```
   node_modules/.pnpm/@system-ui-js+multi-drag@0.4.0/.../dist/index.js:1
   export * from './drag';
   SyntaxError: Unexpected token 'export'
   ```
   涉及 `DrawingSurface.test.tsx`、`Minimap.test.tsx`、`TextDrawingSurface*.test.tsx`、`PaintingController*.test.tsx`、`PaintingBoard.test.tsx`、`virtual-paper-import.test.ts` 等。

2. **`@hamster-note/components` 未构建，moduleNameMapper 目标缺失**（2 个 suite 报此错）：
   ```
   Could not locate module @hamster-note/components mapped as:
   .../node_modules/@hamster-note/components/dist/index.js
   ```
   涉及 `PaintingStrokeColorControl.test.tsx`、`packages/painting-board/.../PaintingBoard.test.tsx`。

> 与任务 4.4（移除 multi-drag）及构建顺序存在关联，属预期会在迁移中处理的既有失败，本任务不修复。

### 4. `pnpm build` — 退出码 2（失败）

- `build:lib`：`@hamster-note/painting` 与 `@hamster-note/painting-board` 的 `bob build` 均成功（仅若干 `esm`/`exports` 字段告警）。
- `build:demo`：`apps/playground` 的 `tsc && vite build` 失败：

```
> tsc && vite build
App.tsx(1,40): error TS2307: Cannot find module 'react-native' or its corresponding type declarations.
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @hamster-note/painting-playground@0.1.0 build: `tsc && vite build`
Exit status 2
ELIFECYCLE  Command failed with exit code 2.
```

聚合构建因 playground 失败而整体退出码为 2。该失败为迁移前既有状态（playground 仍为 Vite 骨架，任务 1.2 才迁移至 Expo SDK 57）。

## 既有未提交改动完整性校验

对命令执行前后的文件做 SHA-256 比对，全部一致，确认既有未提交改动未被修改：

| 文件 | 命令前哈希 | 命令后哈希 | 状态 |
| --- | --- | --- | --- |
| `.github/workflows/ci-pr.yml` | `7f61bb65…` | `7f61bb65…` | 一致 |
| `.github/workflows/publish.yml` | `58de8797…` | `58de8797…` | 一致 |
| `.gitignore` | `8b97c441…` | `8b97c441…` | 一致 |
| `apps/playground/package.json` | `6f4cd3d7…` | `6f4cd3d7…` | 一致 |
| `package.json` | `1d61be0c…` | `1d61be0c…` | 一致 |
| `packages/painting-board/package.json` | `cd8d23a8…` | `cd8d23a8…` | 一致 |
| `packages/painting/package.json` | `9f79b748…` | `9f79b748…` | 一致 |
| `playwright.config.ts` | `f6846ea1…` | `f6846ea1…` | 一致 |
| `pnpm-lock.yaml`（未跟踪） | `d9792a46…` | `d9792a46…` | 一致 |
| `pnpm-workspace.yaml`（未跟踪） | `b4af9e2b…` | `b4af9e2b…` | 一致 |

变更目录内既有文件（`design.md`、`proposal.md`、`tasks.md`、`.openspec.yaml`、`specs/**`）哈希前后亦一致。

最终 `git status --short` 与初始完全一致（见上），`pnpm install` 未改动 lockfile（`Lockfile is up to date`），构建产物位于被 `.gitignore` 忽略的 `lib/` 目录，未出现在 git status 中。

## 结论

- 基线报告工件：本文件 `openspec/changes/migrate-expo57-skia-surface/verification/task-1.1-baseline.md`。
- 迁移前基线：`pnpm install` ✅ 0，`pnpm lint` ✅ 0，`pnpm test` ❌ 1，`pnpm build` ❌ 2。
- 阻塞/失败：`pnpm test`（10 个 suite 因 multi-drag ESM 与 `@hamster-note/components` 缺失而无法运行）与 `pnpm build`（playground `tsc` 找不到 `react-native`）为迁移前**既有**失败，如实完整记录，未尝试修复。
- 写入合规：仅新增本报告文件；所有既有未提交改动（含 pnpm/CI）哈希前后一致，未被修改。
