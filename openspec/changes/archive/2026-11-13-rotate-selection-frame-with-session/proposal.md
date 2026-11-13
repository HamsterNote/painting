# Proposal

## Why

HAM-249 要求选框在本次选中期间随对象旋转，避免旋转后立即变回正交外接矩形。作为 HAM-246 的体验补充，显示方向和命中区必须同步，防止看得到的框与可拖动区域错位。

## What Changes

- 新建立的选择以文档坐标轴对齐的整体外接矩形起始；同一选择集合连续旋转时，框、缩放手柄和旋转手柄跟随累计旋转，松手后保持方向。
- 移动、缩放继续沿用本次选框方向；取消选择并重新选中时重新生成正交框，不继承对象已有旋转角。
- 将 HAM-246 包含手柄外扩带的完整优先矩形放在选框局部坐标中计算，再整体旋转；显示、手柄命中和整体拖动命中共享几何，保留选区优先及输入归属。
- 覆盖多选、跨越 ±π 的连续旋转、缩放/平移与页面旋转映射，保留一次操作一个事务及取消回滚。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `document-object-interaction`: 增加选择会话内方向保持与重选重置要求；修改 HAM-246 的整体交互区域，使其随选框旋转而非保持宿主轴对齐。

## Impact

目标为 schema3 共享 Web/Expo DOM 路径：`core/layeredToolSession.ts`、`core/layeredEditorController.ts`、`layered/SelectionOverlay.tsx`、`layered/semanticWebAdapter.ts`，以及 PR #51 新增的 `core/layeredSelectionGeometry.ts`。复用页面 `geometry/pageCoordinates.ts` 坐标映射与现有 Jest、Playwright 入口，不新增存储字段、依赖或绘图引擎。

前置条件：需求称 PR #51 已验收，但本次查询 GitHub 显示该 PR 仍为 OPEN（目标 main），当前 main 尚无其共享几何及规格增量。本文以 #51 的需求及已读取实现作为后续基线；实施前须集成该前置，保留 #52 已有套索性能改动。本次仅交付规划文档。
