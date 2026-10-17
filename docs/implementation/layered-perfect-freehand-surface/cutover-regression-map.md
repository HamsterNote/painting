# 分层入口的回归迁移

## 首批迁移（2026-10-18）

本批先迁调用方与测试，尚未执行 Skia/旧目录删除。`packages/painting-board` 的 `PaintingBoard` 现在直接使用 `LayeredPaintingBoard`，必须传入唯一 controller；`apps/playground/src/App.tsx` 使用同一 Expo DOM 路由。旧 value/ref/pressureMultiplier 不再是公开 board 契约。

| 保留行为                                                                               | 新入口中的可执行回归                                                                                                                   |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| board 满尺寸、初始文档、导航开关/范围、工具/历史唯一真源                               | `packages/painting-board/src/__tests__/{PaintingBoard,LayeredPaintingBoard}.test.tsx`                                                  |
| 原始样本、release=0、提交/undo/redo、取消、工具切换取消、并发来源和 viewport 冻结      | `tests/ui/playground.spec.ts`，`core/layered-freehand-session.test.ts`                                                                 |
| 五档笔宽、六色与自定义颜色、套索隐藏样式控件                                           | `tests/ui/painting-controller-{width,color}.spec.ts`                                                                                   |
| 五类形状的过程反馈/取消/undo、套索/多选移动缩放旋转、raw 不变、快速半径擦除、dash 隔离 | `tests/ui/layered-editor.spec.ts`，`core/layered-tools.test.ts`                                                                        |
| 尺子的无限裁切/刻度、屏幕坐标、普通鼠标绘制、Alt 旋转与反馈                            | `tests/ui/ruler-test.spec.ts`，`input/web/__tests__/rulerGestureController.test.ts`                                                    |
| 触控尺子角度与中线投影、无文字误选                                                     | `tests/ui/touch-ruler-feedback.spec.ts`                                                                                                |
| 鼠标与双指缩放百分比、浮层位置/自动消失、textarea 原生选区与替换                       | `tests/ui/interaction-feedback.spec.ts`；迁移时补齐了分层缩放浮层，`layered-zoom-feedback.test.ts` 验证跨输入源过期 timer 不清除新反馈 |
| touch 导航固定 pair/拒绝第三指、显式 touch 绘制/掌触隔离、取消与 blur 后恢复           | `tests/ui/touch-drawing-arbitration.spec.ts`，`layered-navigation.test.ts`                                                             |
| 真实文本连续两会话逐次撤销与取消、mouse/pen/touch 尺边绘制                             | 前批已迁移的 `resource-editing-fixture.spec.ts`、`ruler-edge-inputs.spec.ts`                                                           |

旧回归中的 V1 controlled/uncontrolled props、DOM 属性/菜单形状、采样率、自由笔 dash/pressureMultiplier、点击序列式形状、中心线分段宽度断言属于被明确替换的 API/算法，不能照搬为新 API 的断言。保留的文档/历史/输入/工具行为在表中通过 schema3 和真实分层 DOM 验证。原 tap 不成笔断言按新规范改为 filled dot。

## 已运行

- `pnpm exec jest --runInBand --testPathPattern 'layered-|painting-board/src/__tests__'`：24 suites / 343 tests PASS，含 native Expo DOM host 最小挂载。
- `pnpm test:ui tests/ui/playground.spec.ts tests/ui/ruler-test.spec.ts tests/ui/touch-drawing-arbitration.spec.ts tests/ui/painting-controller-color.spec.ts tests/ui/painting-controller-width.spec.ts tests/ui/interaction-feedback.spec.ts tests/ui/touch-ruler-feedback.spec.ts --workers=1 --trace=off`：Chromium 17/17 PASS。

这不是全套 UI 或最终 cutover 验收。候选编辑器/Skia 专用回归、公开根入口与旧运行路由尚待核对；不据此勾选 6.3、7.1、7.2 或 7.9。
