# Task 2.6 — 自由笔几何/呈现缓存（freehand-cache）

- 实施时间：2026-10-08（UTC）
- 写入范围（本次仅新增 3 个文件）：
  - `packages/painting/src/geometry/freehandCache.ts`
  - `packages/painting/src/__tests__/core/layered-freehand-cache.test.ts`
  - `docs/implementation/layered-perfect-freehand-surface/freehand-cache.md`（本文件）
- 未改动：`document.ts`、`freehand.ts`、`closedPath.ts` 现源码；manifests、lock、barrels；旧 reader/input/transform 任务范围；`tasks.md`。
- 验证日志（approved cache 目录，非仓库写入）：
  - `~/.cache/opencode-tmp/opencode/pf-task2.6-jest-focused.log`
  - `~/.cache/opencode-tmp/opencode/pf-task2.6-jest-listTests.log`
  - `~/.cache/opencode-tmp/opencode/pf-task2.6-tsc-newfile.log`、`pf-task2.6-tsc-test.log`

## 1. 目标与契约

实现 headless、instance-scoped 的几何/呈现缓存，覆盖 Task 2.6：

- 几何缓存按 **samples / brush / preset / algorithm / mode / state 版本 + 对象身份**失效。
- `syncDocument(document)` 按当前 freehand `objectId` 保留/删除缓存槽，文档替换与 undo/redo 不复用 stale outline。
- transform 只失效 **presentation（bounds / 可选 transformed polygon）**，不失效 local geometry，不改写 raw samples。
- 缓存全部为派生数据，不进入 document 保存/序列化数据。
- 对象几何 identity 采用「版本相等 **且** `samples`/`brushSnapshot` 引用身份相等」，仅相同 id/revision 不足。
- `same geometry + new transform` 可复用几何；`new raw reference, same revisions` 必须重算。
- active / final 分开 key；同一调用可同时维护两种状态。
- 可精确仿射变换 outline 顶点求 `worldBounds`；拒绝非 finite 或 singular transform；不生成 history。

## 2. API（小接口，中文注释）

`packages/painting/src/geometry/freehandCache.ts`：

- `class FreehandGeometryCache`
  - `syncDocument(document: EditorDocument): void` —— 按 freehand objectId 保留/删除缓存槽，不重算。
  - `getGeometry(object: FreehandObject, state: FreehandGeometryState): DerivedFreehandGeometry` —— active/final 分开缓存，命中返回同一 frozen 引用。
  - `getPresentation(object: FreehandObject, state: FreehandGeometryState): FreehandPresentation` —— 呈现 key 含几何身份 + `transformRevision` + transform 数值，`transformRevision` 变化即失效；非有限/奇异/溢出变换抛 `TypeError`。
  - `clear(): void` —— 清空缓存，不触碰文档。
- `buildFreehandGeometryCacheKey(input): string` —— 纯函数，组装版本 key（含 algorithm revision）。
- 常量：`FREEHAND_CACHE_MAX_ENTRIES_PER_STATE = 2`、`FREEHAND_CACHE_MAX_PRESENTATIONS = 4`。
- 类型：`FreehandPresentation = { worldBounds, transformedPolygon }`、`FreehandGeometryKeyInput`。

设计取舍：
- 缓存只依赖 `model/document.ts` 类型与 `deriveFreehandGeometry`，不依赖 controller/DOM/Canvas/SVG/Skia/legacy（无旧 V2/frame/skia）。
- 引用身份无法字符串化，故 key 由「版本字符串 + `===` 引用守护」共同构成；`buildFreehandGeometryCacheKey` 仅负责可断言的版本部分。
- algorithm revision 目前是常量 `FREEHAND_ALGORITHM_REVISION`；它进入 key，但**不设计人为的公共算法开关**，派生始终用当前实现。测试用 const assert + 纯 key 敏感性锁定该机制。
- 呈现 key = 几何身份 + `transformRevision` + transform 6 个数值；`transformRevision` 变化即失效呈现（与 design.md「世界 bounds 由 transformRevision 失效」一致），几何与 raw samples 不受影响。`applyTransform` 对小防御做非有限结果检查，有限矩阵乘大坐标溢出时拒绝而非生成 infinite bounds。
- 每个对象每种状态保留 2 条（当前 + 一步 undo/redo），呈现保留 4 条，避免无界增长。

## 3. 验证证据（owner 实测）

### 3.1 收集确认（listTests）

```
pnpm exec jest --selectProjects core-node --listTests
```

新测试文件被 core-node 项目精确收集一次：

```
/home/zhangxiao/frontend/HamsterNote/painting.feat-use-perfect-freehand/packages/painting/src/__tests__/core/layered-freehand-cache.test.ts
```

（日志：`pf-task2.6-jest-listTests.log`）

### 3.2 聚焦执行

```
pnpm exec jest --selectProjects core-node --runTestsByPath \
  packages/painting/src/__tests__/core/layered-freehand-cache.test.ts
```

结果：**PASS，1 suite / 20 tests，EXIT_CODE=0**（日志：`pf-task2.6-jest-focused.log`）。未运行全量 test/UI。

覆盖用例：

| 分组 | 用例 |
|------|------|
| 复用/分离 | 重复 getGeometry/getPresentation 命中同一 frozen 引用；active 与 final 分开 key |
| 版本/身份失效 | samplesRevision；同 revisions 新 samples 引用；同值新 brush 引用；brushRevision；presetRevision；resolvedPressureMode；algorithm revision（const assert + key 敏感性） |
| transform | 仅 transform 变化→几何复用、呈现重算、samples/brush 引用与版本不变；transformRevision 单独变化→几何复用、呈现按 revision 重算且数值 bounds/polygon 相等；有限矩阵乘大坐标溢出拒绝；非有限拒绝；奇异变换拒绝 |
| 生命周期 | syncDocument 删除后失效 + reinsert；文档替换不同 objectId；undo/redo 快照不 stale 且同引用复用；clear |
| 保存数据 | 文档序列化不含 polygon/commands/worldBounds/geometryRevision；raw samples/对象未被修改、引用保持 |

### 3.3 类型（bounded，非全量 typecheck）

对新源文件及其依赖、以及新测试文件分别做单入口 `tsc --noEmit --strict`：均 **EXIT_CODE=0**（`pf-task2.6-tsc-newfile.log` / `pf-task2.6-tsc-test.log`）。未运行项目级 `pnpm run typecheck`（超出本 lane 验证范围）。

## 4. Git 局部核对

- 新增文件均为 untracked，且 `packages/painting/src/geometry/` 目录整体本就 untracked，因此本次不产生新的 tracked diff。
- `pnpm-lock.yaml` sha256 = `2ac1374748dd1de90107196a59cf2a1c36dce639f4ac345f1d2797e84bea0c04`
- `packages/painting/package.json` sha256 = `2fef87fd470f06bde3d8441cf2bfc0d1d42d416eb7a248fae07d8efe37ec8d3b`
- 本 lane 未对 manifest/lock 做任何改动；两份文件哈希与 Task 2.1 终态记录一致。文件“脏/未跟踪”不代表其中所有 diff 都归属某一来源，本 lane 不对既有条目做归属判断。
- 验证时点只读记录的源码哈希（集成 fix-7 落地后，2026-10-08T04:59Z 复跑）：`geometry/freehand.ts` = `b788173e9409b74b60e96be47304cd2d13a420c3`、`geometry/closedPath.ts` = `be59d9c6cf5dda4225c07bf28c459003ca375310`。本 lane 聚焦测试在该 final state 上复跑通过；若后续其它 lane 再改这两处源码，需整合后再次复跑本 lane 聚焦测试。

## 5. 边界与未做

- 未接入任何 barrel/导出、未改 `tasks.md`、未改 document/freehand/closedPath 源码。
- 未实现 controller/Canvas/Skia 集成与 UI 验证（属 3.x/7.x）。
- 缓存为进程内实例状态，不持久化、不生成 history。
