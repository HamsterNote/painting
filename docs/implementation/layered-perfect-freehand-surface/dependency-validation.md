# perfect-freehand 依赖安装 — 独立终态验证（dependency-validation）

- 验证时间：2026-10-08T04:44Z ~ 04:46Z UTC
- HEAD：`ba4b1342ad2dc423fd0f5879bcb73b6610e6dc33`（分支 `feat/use-perfect-freehand`）
- 工具：node v24.15.0 / pnpm 10.28.2 / tsc 5.9.3
- 结论：**PASS**。已安装 PF 1.2.3 与 `packages/painting` 的精确 runtime、lock importer/integrity、根 API（默认 + 命名导出）、类型、CJS/ESM 全部一致；冻结安装无锁变更，本任务未新增任何 tracked diff。
- 日志目录：`docs/implementation/layered-perfect-freehand-surface/dependency-validation-logs/`

## 1. 验证范围与边界

本次为**终态验证**，不重跑旧安装任务、不写 manifest/lock、不修改生产代码，不恢复上一安装任务（host 证实为 aborted 非 live）的业务写入。

- 允许写入：本文件 + `dependency-validation-logs/`。
- 只读核对：`packages/painting/package.json`、`pnpm-lock.yaml` importer/integrity、`node_modules` 中已安装 PF。
- 类型探针：仅在 approved cache `/home/zhangxiao/.cache/opencode-tmp/opencode` 下 `mktemp -d` 新目录内运行，无 `rm`，未引入额外 renderer/platform 依赖。

## 2. 命令与退出码（owner 实测）

| #   | 命令                                             | 退出码 | 日志                         |
| --- | ------------------------------------------------ | ------ | ---------------------------- |
| 1   | `pnpm install --frozen-lockfile`                 | **0**  | `03-pnpm-install-frozen.log` |
| 2   | `tsc --noEmit -p <probe>/tsconfig.json`          | **0**  | `07-type-probe-tsc.log`      |
| 3   | `node -e "require('perfect-freehand')..."` (CJS) | **0**  | `08-runtime-cjs-esm.log`     |
| 4   | `node --input-type=module -e "import ..."` (ESM) | **0**  | `08-runtime-cjs-esm.log`     |

`pnpm install --frozen-lockfile` 关键输出：`Lockfile is up to date, resolution step is skipped` / `Already up to date` / `Done in 1.4s`。唯一 warning 为忽略 `@shopify/react-native-skia` build script（非本次范围，不影响 PF）。

## 3. runtime / manifest 精确性

`packages/painting/package.json` → `dependencies."perfect-freehand": "1.2.3"`（精确版本，无 `^`/`~`）。

已安装包 `node_modules/.pnpm/perfect-freehand@1.2.3/node_modules/perfect-freehand/package.json`：

- `name=perfect-freehand`，`version=1.2.3`，`license=MIT`
- `main=./dist/cjs/index.js`，`module=./dist/esm/index.mjs`，`types=./dist/types/index.d.ts`
- `exports["."] = { types, require, import }` 三条件齐备

`packages/painting/node_modules/perfect-freehand` → symlink 指向 `node_modules/.pnpm/perfect-freehand@1.2.3/...`，物理安装与依赖声明一致。

## 4. lock importer / integrity（只读）

importer `packages/painting.dependencies.perfect-freehand`：

```yaml
perfect-freehand:
  specifier: 1.2.3
  version: 1.2.3
```

resolution/integrity：

```yaml
perfect-freehand@1.2.3:
  resolution:
    {
      integrity: sha512-bHZSfqDHGNlPpgH2yxXgPHlQSPpEbo+qg7li0M78J9vNAi2yjwLeA4x79BEQhX44lEWpCLSFCeRZwpw0niiXPA==,
      tarball: https://registry.npmjs.org/perfect-freehand/-/perfect-freehand-1.2.3.tgz,
    }
```

`specifier`、`version`、installed 版本三者一致，integrity 为 `1.2.3` 官方 tarball。

## 5. 根 API / 类型

已安装 `dist/types/index.d.ts`：

```ts
import { getStroke } from './getStroke';
export default getStroke;
export * from './getStrokeOutlinePoints';
export * from './getStrokePoints';
export * from './getStroke';
export * from './types';
```

- 默认导出 = `getStroke`；命名导出含 `getStroke`、`getStrokePoints`、`getStrokeOutlinePoints`。
- `StrokeOptions` 字段：`size? thinning? smoothing? streamline? easing? simulatePressure? start? end? last?`，`start/end = { cap?, taper?, easing? }`。
- 类型探针在独立 cache 目录用 `tsc --noEmit` 实测：默认/命名导出可赋同一函数签名，完整显式 preset（含 `streamline:0.5`、`start/end {cap:true,taper:0}`、`last:false/true`）类型通过，退出码 0。

运行时 CJS 与 ESM 均：默认导出、`getStroke`、`getStrokePoints`、`getStrokeOutlinePoints` 全部为 `function`；`getStroke` 实际生成 46 点多边形，无异常。

## 6. 官方要求的显式 preset 核对

业务代码 `packages/painting/src/geometry/freehand.ts` 的 `buildStrokeOptions()` **显式**给出全部字段，不依赖 README/库默认：

```ts
{
  size,                       // 显式传入 nominalSize
  thinning: isConstant ? 0 : 0.5,
  smoothing: 0.5,
  streamline: 0.5,
  easing: identity,           // 显式恒等函数，覆盖库默认
  simulatePressure: mode === 'simulated',
  start: { cap: true, taper: 0, easing: identity },
  end:   { cap: true, taper: 0, easing: identity },
  last: state === 'final',    // active=false / final=true
}
```

与官方研究结论（size 使用 nominalSize；thinning/smoothing/streamline 为 0.5，constant 的 thinning 为 0；cap true/taper 0/active last false/final true）逐项一致。

## 7. Git 局部 diff：旧脏状态 vs 本次无新增

- 任务 1.1 基线快照 `baseline-logs/16-git-state-snapshot.txt` 已包含 ` M packages/painting/package.json` 与 `?? pnpm-lock.yaml`，即二者为**既有用户脏状态**，非本次产生。
- 文件在基线中已脏不等于每条新增内容均为用户原有改动。实施记录表明 `perfect-freehand: "1.2.3"` 由先前安装 lane 添加；本轮只验证既存终态，未再修改该条依赖。原有其他 manifest/lock 内容不可由本报告归属或删除。
- `pnpm-lock.yaml` 为**未跟踪**文件（`git ls-files` 无记录），同样为既有状态。
- 安装前后 `sha256sum`（`02-prehash.txt` vs `04-posthash.txt`）完全一致：
  - lock：`2ac1374748dd1de90107196a59cf2a1c36dce639f4ac345f1d2797e84bea0c04`
  - package.json：`2fef87fd470f06bde3d8441cf2bfc0d1d42d416eb7a248fae07d8efe37ec8d3b`
- 安装前后 `git status --porcelain` 逐字节相同（`01-*` vs `05-*`，`GIT_STATUS_IDENTICAL=YES`）。
- 本次新增文档位于已整体未跟踪的 `docs/` 下，不产生新的 tracked diff；未改动 manifests/lock。

## 8. 对 task 2.1 的建议

依赖侧证据齐备且自洽：精确 runtime 1.2.3、lock importer/integrity 一致、冻结安装 0 退出、根 API/类型/CJS/ESM 均通过、业务 preset 显式且符合官方要求、无新增 diff。**可据此放行 task 2.1 的依赖前置条件。** 本次不勾选 tasks.md、不删除 commit、不读取全局 opencode 配置。
