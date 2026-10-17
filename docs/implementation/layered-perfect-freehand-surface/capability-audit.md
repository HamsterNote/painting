# Capability 实施审核

2026-10-18 主编排逐项复读五份 capability 的 19 条 requirement，对照公开入口、实现、实际被收集测试与浏览器回归。本文区分开发证据和设备验收，不能单凭 strict 或 artifact 状态推定完成。

测试路径约定：下表 `core/*.test.ts` 位于 `packages/painting/src/__tests__/core/`，普通组件测试位于 `packages/painting/src/__tests__/`，UI 位于 `tests/ui/`。

| Capability / requirement                                                | 实现                                                                                     | 可执行证据与边界                                                                                                                                                             |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| freehand / Raw sample document fidelity                                 | `model/document.ts`、`documentReader.ts`、`input/web/freehandWebAdapter.ts`              | `core/layered-document-roundtrip.test.ts`、`core/layered-freehand-session.test.ts`：raw/up=0/coalesced/预测排除；保存不含 outline                                            |
| freehand / Pressure mode locks at stroke begin                          | `resolvePressureMode`、`core/freehandSession.ts`                                         | `core/layered-pressure-mode.test.ts`、`core/layered-freehand-regressions.test.ts`：恒 0.5 pen、正压力 mouse/touch、unavailable、显式模式；真笔留人工                         |
| freehand / Shared deterministic filled geometry                         | `geometry/freehand.ts`、`closedPath.ts` 共享 PF 派生与 path commands                     | `core/layered-freehand-regressions.test.ts`、`layered-canvas.test.tsx`、`layered-editor.spec.ts`：dot/短笔/模拟时间无关、Canvas/SVG 最终像素                                 |
| freehand / Revisions invalidate derived geometry                        | `geometry/freehandCache.ts` 缓存与对象变换                                               | `core/layered-freehand-cache.test.ts`、`core/layered-tools.test.ts`：brush/sample/algorithm revision、replace/delete/undo、transform 不改 raw                                |
| rendering / Independent controls and rendering responsibilities         | `core/layeredEditorController.ts`、`layered/{Toolbar,DrawingLayer.web,DisplayLayer}.tsx` | `core/layered-editor-controller.test.ts`、`layered-toolbar.test.tsx`、`editor-candidate-canvas2d-pen.spec.ts`：单真源、历史非逐点 reconcile；不承诺 PF 纯增量                |
| rendering / Ordered mixed document display                              | `layered/DisplayLayer.tsx` 有序 SVG 与 foreignObject                                     | `layered-display-regression.test.tsx`、`layered-editor.spec.ts`：结构和真实浏览器像素、新笔覆盖旧文字；Safari/WebView 留人工                                                 |
| rendering / Idempotent commit and acknowledged render handoff           | controller commit kernel、`layered/PresentationCoordinator.ts`                           | `core/layered-presentation.test.ts`、`layered-canvas.test.tsx`、`layered-editor.spec.ts`：重复/旧/乱序 ACK、延迟挂载、连续笔、半透明；不将内部 ACK 当 physical paint         |
| input / Snapshot-based input lifecycle                                  | `core/freehandSession.ts`、Web adapter                                                   | `core/layered-freehand-session.test.ts`、`DrawingSurface.test.tsx`、`playground.spec.ts`：brush 冻结、取消/工具切换/后台/卸载、迟到 end                                      |
| input / Web owns viewport and coordinates                               | controller viewport revision、`layered/navigationWebAdapter.ts`                          | `core/layered-affine.test.ts`、`layered-navigation.test.ts`、`touch-drawing-arbitration.spec.ts`：冻结、掌触/第三指竞争、非单位矩阵、结束不补跳                              |
| input / Source policy preserves supported drawing and semantic feedback | `input/web/freehandWebAdapter.ts`、`layered/semanticWebAdapter.ts`                       | `layered-semantic-adapter.test.ts`、`core/layered-tools.test.ts`、`layered-editor.spec.ts`：mouse/touch/pen 策略与非笔工具过程反馈                                           |
| input / Future native input is semantic and non-authoritative           | `input/native/layeredSemanticContract.ts`                                                | `core/layered-native-contract.test.ts`：batch/commitId、pan/zoom intent、text focus 契约；仅契约/mock，无 native ink 或桥性能结论                                            |
| objects / Preserve object editing and undo semantics                    | controller、`core/layeredObjectQuery.ts`、`layered/SelectionOverlay.tsx`                 | `core/layered-tools.test.ts`、`TextDrawingSurface.test.tsx`、`layered-image-import.test.tsx`、`layered-editor.spec.ts`：五形状/资源/混合变换/取消/undo                       |
| objects / Preserve navigation aids and IME composition                  | `layered/{NavigationOverlay,TextEditor}.tsx`、迁入 `input/web` 的原 gesture controllers  | `Minimap.test.tsx`、`VirtualPaper.test.tsx`、`layered-text-editor.test.tsx`、原 ruler gesture 全套与 ruler/resource/interaction UI；系统 IME/软键盘留人工                    |
| objects / Separate freehand and shape styles                            | controller 独立 settings、Toolbar                                                        | `layered-toolbar.test.tsx`、`layered-editor.spec.ts`：自由笔无 dash/算法滑块，shape dash 往返保留                                                                            |
| objects / Continuous whole-object erasure                               | `core/layeredObjectQuery.ts` 扫掠 query、controller 可逆事务                             | `core/layered-tools.test.ts`、`layered-semantic-adapter.test.ts`、`layered-editor.spec.ts`：端点外跨越、半径擦边、遮挡与 cancel/undo；首期 ink 中心线加宽近似已明确          |
| objects / Point hit and DOM text focus are explicit                     | DOM delegation、semantic adapter、TextEditor                                             | `layered-semantic-adapter.test.ts`、`layered-text-editor.test.tsx`、`editor-candidate.spec.ts`：capture 后几何 query、真实 focus/composition；设备边界未冒充                 |
| platform / Three replaceable drawing entries share Web implementation   | `DrawingLayer.web/ios/android.tsx`、Expo DOM route                                       | `tests/jest/native/layered-dom-route.native.test.tsx`、Android/iOS Expo export；真机启动留人工，host 仅 layout props，无逐点 bridge                                          |
| platform / Safely retire the uncompleted Skia plan                      | 已审核运行入口/资源删除与旧 change 退出                                                  | `retirement-verification.md`、`skia-supersession.md`；旧八项逐一承接、Git 可恢复历史、本地 WIP 不推；锁文件无无关升级                                                        |
| platform / No legacy fallback or additional product scope               | root/core exports、统一分层 routes                                                       | `layered-public-entry.test.tsx`、`core/document.test.ts` 的 runtime graph guard、`canvas-runtime.spec.ts`、`pnpm verify:layered`；无 V1/V2 fallback、新导出或通用 tile cache |

## 用户决策与删除保真

- 本期 Web 是永久显示端、唯一 viewport 权威。第一期三个绘制入口均走 Web；未来 native 只留语义契约，没有擅自实现原生墨迹。
- raw 持久化与 PF filled geometry 取代旧算法，没有旧中心线保底。tap 可见、release 零压力保留；自由笔 dash 明确退出，形状 dash 独立保留。
- 旧调用方先迁移再删目录。测试按保留行为搬迁；旧 API/菜单 DOM/中心线/Skia 专用断言的退出原因、82/1065 与旧数量差异已在退役记录列明，不能说所有旧断言原样保留。
- `d913148` 删除旧 change 全部 33 文件，未归档、未把旧未完成项勾选。`skia-supersession.md` 记录八项未完成义务与 Git 恢复依据；proposal 的 supersedes 历史声明仍保留。
- 历史文档中的 Skia 字样、基线日志与删除清单是可审计证据，不属于运行入口。没有删除无关 Expo/native 工程、平台无关数学或原手势回归。

## 验收边界

3.3、6.1、7.5、7.6、7.8 的设备部分明确移入 `manual-acceptance.md`，原 checkbox 保持未完成。真实 Safari/iOS WebView、pen/掌触/高刷新交接与目标设备长笔性能预算尚无证据，不能由静态导出、Linux WebKit、宿主 rAF 或 mock ACK 补齐。其余开发验证以最终实际命令记录为准。
