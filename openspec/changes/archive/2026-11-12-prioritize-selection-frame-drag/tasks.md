# Tasks

以下为后续实施清单，本次 propose 不执行。行为契约见 `specs/document-object-interaction/spec.md`；采用 proposal 中“具体手柄保留缩放/旋转”的明确规划假设。

## 1. 统一显示与命中几何

- [x] 1.1 提取当前 schema3 选区的内部几何派生，提供框、现有手柄交互区及其完整外接优先矩形；用几何测试验证空心/斜线对象、多选间隙、四周外扩带、包含边界、范围外一点和无有效选择。
- [x] 1.2 让 `layered/SelectionOverlay.tsx` 复用该几何，保留已有手柄样式和功能，并为移动区域提供合适指针反馈；通过组件测试验证显示框与命中矩形一致、现有 resize/rotate 标记保留、非选择工具不拦截画布。
- [x] 1.3 校准 local DIP、world 与 `getClientToLocal` 的使用；以非零 tx/ty、zoom 0.5/1/2、已旋转/缩放对象和页面宿主仿射映射的测试验证可见起点命中及屏幕位移一致，手柄尺寸不随 world 容差漂移。

## 2. 起点解析与目标锁定

- [x] 2.1 在 `core/layeredToolSession.ts` 明确区分选中框命中和普通对象命中，框命中先保留选择并固定对象集合/原始变换/operation/revision，再沿用 preview/update/end；扩展 `core/layered-tools.test.ts` 验证低层 A 被高层 B 覆盖时仍移动 A，路径穿越 B/C/框外后目标不变，多选整体移动且图层顺序不变。
- [x] 2.2 在 `layered/semanticWebAdapter.ts` 使用共享起点分类，优先具体手柄、再整体范围、最后普通对象，不让 DOM targetId 覆盖已解析的选区；扩展 `layered-semantic-adapter.test.ts` 验证空白、覆盖对象 DOM 目标、手柄功能、框外普通/Shift 选择、无位移点击不增历史。
- [x] 2.3 接通 `input/web/layeredInputArbiter.ts` 的共享 selection targetRole，让整体热区获得现有选择归属；运行并扩展仲裁和 adapter 测试，验证 mouse、允许的 pen/touch、三档输入策略、安全控件、框外双指导航及第二指针不能接管目标。

## 3. 生命周期与真实入口验收

- [x] 3.1 在 core/adapter 测试验证连续预览只生成一次事务，最终 pointerup 坐标生效，undo/redo 一次恢复；逐项覆盖 pointercancel、Escape、blur、隐藏、卸载、工具/模式切换、文档 revision 冲突和迟到 move/up，断言无半成品历史、无残留归属且下一次手势可用。
- [x] 3.2 扩展 `tests/ui/layered-editor.spec.ts`，从真实选择工具入口复现空心图形框内空白、外扩带、低层重叠和移出框；以鼠标及触摸上下文运行相关 Playwright 用例，断言只有选中对象改变，缩放/旋转、框外改选、撤销重做和擦除扫掠回归通过。
- [x] 3.3 为页面表面补充共用输入路径的坐标回归，并在移动设备真实触摸验证空白与重叠拖动、结束/取消和后续导航；交付含设备/浏览器、操作步骤及结果的验收记录，明确区分模拟测试与实机结果，无法实机执行时如实列为待验收。
- [x] 3.4 运行 `pnpm exec jest --runInBand --runTestsByPath` 加上本次修改/新增的测试路径、`pnpm test:ui --grep` 加上新增用例名称，以及 `pnpm lint`、`pnpm typecheck`、`pnpm format:check`；记录实际命令和结果，修复本次引入的问题后重新运行受影响检查。
