# Proposal

## Why

选中细线、空心或不规则图形后，用户仍须准确命中图形才能移动，触摸操作尤其困难。选中框与其他图形重叠时，普通对象命中还可能改变目标，使已选中的低层图形难以拖动。

## What Changes

- 选择工具下，将当前选中框内部、边界及四周手柄所在的完整外接区域作为统一优先交互范围，包含没有图形内容的空白。
- 手势起点先判定选中框整体范围，再处理普通对象命中；框内拖动保留当前选择，优先于更高层对象，不改变图层顺序。
- 在起点固定选中对象集合、操作类型及原始变换，拖动经过其他对象或移出框后仍操作同一目标，正常结束只提交一次事务，取消不提交。
- 兼容既有多选、鼠标及输入模式允许的触摸/笔、viewport 和页面坐标映射。框外选择及导航沿用既有规则。
- 提案假设：直接命中已有缩放/旋转手柄仍执行其原功能，手柄周边其余优先范围用于移动；不新增手柄。该解释依据现有对象编辑规格保留缩放/旋转能力，属于规划假设，未获得用户另行确认。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `document-object-interaction`: 增加选中框整体命中、优先级、起点锁定及事务验收，并明确它与普通对象命中、擦除轨迹查询的适用关系。

## Impact

影响 `packages/painting/src/layered/SelectionOverlay.tsx`、`semanticWebAdapter.ts`、`core/layeredToolSession.ts`、`input/web/layeredInputArbiter.ts` 及相关单元/真实入口交互测试；需统一显示与命中几何。现有 `replace-pdf-painting-core` change 涉及页面表面与坐标换算，本提案复用其已存在的映射接口，不修改其产物。预计无需新增依赖、存储迁移或公共 API 破坏性变更。本次仅交付规划文档。
