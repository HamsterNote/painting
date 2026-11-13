# Tasks

11 项实施与自测任务已完成，2026-11-13 人工验收通过后同步主规格并归档。前置为 HAM-246 / PR #51，规格与设计见同目录文件。

## 1. 对齐实施基线

- [x] 1.1 集成 #51 的整体优先范围、共享 `layeredSelectionGeometry.ts` 和 `document-object-interaction` 规格，保留 main / #52 的套索调度与性能修复；核对三个 Selection frame/interaction/drag 要求存在，并运行 `pnpm exec jest --runInBand packages/painting/src/__tests__/core/layered-selection-geometry.test.ts packages/painting/src/__tests__/core/layered-tools.test.ts packages/painting/src/__tests__/layered-semantic-adapter.test.ts` 确认前置回归通过。

## 2. 会话方向和变换生命周期

- [x] 2.1 在 schema3 controller 临时交互状态中建立会话标识、按内容比较的稳定选择集合、初始框及累计变换，通过临时频道驱动订阅；在 controller 测试中覆盖新选择正交、同集合通知/viewport 更新保留、清空重选及集合变化重置，并断言文档和历史无新增 UI 字段或事务。
- [x] 2.2 更新 `layeredToolSession.ts`，冻结每次手势起始框与对象，以相同中心移动/等比缩放/旋转增量更新对象和框，解包连续旋转角；在 core layered-tools 测试中验证 30°+20° 后移动/缩放保持 50°、跨 ±π 连续、松手保持及多选不同初始方向一致随动。
- [x] 2.3 区分自身提交和外部文档变更，处理取消、undo/redo、文档替换及选择失效；以 core controller/tool-session 测试验证从 30° 预览 60° 后取消恢复 30°、单次编辑一个事务、无变化不提交、历史或替换后重建正交框、删除后清框，并确认通知期间不闪回。

## 3. 显示和命中共享旋转几何

- [x] 3.1 扩展 #51 共享模型，提供局部框、正逆变换、随动手柄和包含外扩带的局部完整优先矩形；在 `core/layered-selection-geometry.test.ts` 验证 0°/30°/45°/90°、框内空白、外扩带、边界、旋转/缩放手柄优先、宿主 AABB 假阳性排除及非法映射拒绝。
- [x] 3.2 接入 `SelectionOverlay.tsx`、`semanticWebAdapter.ts` 和必要的 `layeredInputArbiter.ts`，复用同一几何及现有页面逆映射；用 overlay/adapter 测试断言旋转后的角点和手柄位置与命中一致、低层选择优先于覆盖对象、旧手柄位置失效、范围外普通/Shift 选择与空白取消保持可用。
- [x] 3.3 保持输入模式、安全控件、owner 和取消契约；在 semantic-adapter 与 input-arbiter 测试中分别覆盖 pointercancel、Escape、失焦、捕获丢失、隐藏、卸载、工具/输入模式切换、非 owner 及迟到事件，断言无部分事务、旧框命中或旧会话恢复，后续合法操作正常。

## 4. 端到端验收与交付验证

- [x] 4.1 在 `tests/ui/layered-editor.spec.ts` 增加真实 pointer 场景：旋转预览/松手保持、连续旋转后移动/缩放、取消重选正交、多选空白拖动、45° 框外 AABB 区域不误命中、覆盖对象优先；用角点/手柄坐标与文档历史断言验证，不仅检查 transform 字符串。
- [x] 4.2 在 `tests/ui/page-integration.spec.ts` 覆盖页面方向 0°/90°/180°/270° × zoom 0.5/1/2，加入非零平移，并分别验证多选旋转 30° 后框内拖动、现有缩放和旋转手柄；通过真实 client 坐标落点确认显示和逆映射一致，重选框相对文档轴正交。
- [x] 4.3 执行本次相关 Jest、`pnpm exec playwright test tests/ui/layered-editor.spec.ts tests/ui/page-integration.spec.ts`、`pnpm run typecheck` 及变更文件 lint/格式检查；记录实际通过项与限制，并复跑套索性能回归入口确认临时状态未破坏 #52 历史层隔离。
- [x] 4.4 执行 `openspec validate rotate-selection-frame-with-session --strict`，逐项核对规格场景与测试证据，提交实施验证报告；明确 #51 已集成后才可同步本增量，验收通过前不标记实现完成。
