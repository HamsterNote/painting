# Proposal

## Why

现有 painting 工具栏在画板顶部平铺十二种工具与全部设置，主操作层级不清晰。HAM-156 要求参照附图改为底部悬浮胶囊，并明确 Web 组件库在 Expo / RN 中的复用边界，避免把视觉改版扩大为原生组件库迁移。

## What Changes

- 底部居中悬浮胶囊，按「撤销/重做 → 缩放比例 → 统一工具菜单 → 设置/选择/橡皮擦/套索/移动/清空画布独立组 → 调色板」组织；收起/展开为胶囊上方独立圆形按钮。
- 保留十二工具、三档输入、独立笔刷/形状配置、导航与自定义颜色；缩放改为25–800%滑动条，以所属绘图可视区中心为锚点同步变换scale/tx/ty。清空画布通过已有对象事务一次删除，可一次撤销恢复，空画布禁用。
- 黑色置于调色板最左，新编辑器默认黑色；色面24px，色面间留白由20px缩至约6.67px。最右自由取色环内部多色、仅在非预设当前色激活时显示当前色外轮廓；预设项激活环使用该预设色。
- 画笔（原自由笔）为工具菜单第一项，选择/橡皮擦直接在外部操作组切换；套索完成且命中对象后自动切到选择，保留选区、不增加历史，空套索或取消不切换。
- 展示状态仅属于本次挂载；窄屏内部横向滚动。已接受的各轮验收意见同步到本 change，不新增 PR。
- 复用评估结论：已发布的 `@hamster-note/components@0.3.0` 为 React DOM/CSS 组件（并非已证实采用 Custom Elements 的标准 Web Components），可用于现有 Web 和 Expo DOM/WebView 内；不能直接作为原生 RN UI 使用。现有 Toolbar 已复用 Icon，本期继续使用，胶囊布局使用局部样式，不引入全局主题覆盖。
- 独立子需求建议「components 转 Expo 组件库」：优先移植 Button、Icon、Popover/Menu、TextField 与主题 token；采用 RN View/Pressable/Text、原生图标渲染和跨端入口，保持现有 Web API。依赖 components 源码访问、目标 Expo/RN 版本与发布策略确认、原生可访问性/焦点方案及 iOS/Android/Web 验证环境；验收须证明原生依赖图无 DOM/CSS/ReactDOM 运行依赖且 Web 不退化。它不阻塞本次 DOM 工具栏，不在本 change 建 issue、生成迁移实现任务或直接开工。

## Capabilities

### New Capabilities

- `painting-toolbar`: 胶囊工具栏的结构、视觉状态、现有命令映射、能力保留、响应式布局及宿主交互边界。

### Modified Capabilities

无。既有 `document-object-interaction`、`input-session-viewport` 与 iOS 原生输入边界继续适用；本change补充套索命中后切换选择的工作流，不改变对象事务或输入仲裁。

## Impact

- 主要涉及 `packages/painting/src/layered/Toolbar.tsx`、`PaintingBoard.tsx`、公开 props 类型及 painting-board 重导出对应测试；独立 Toolbar 与 `toolbar={false}` 保持可用。
- 复用现有 controller 的 tools/history/input/navigation/viewport 频道，不改数据格式、撤销权威或原生 PencilKit 桥；不新增生产依赖。
- 扩展现有工具栏单元测试、浏览器视觉/交互回归及 Expo DOM 实机验收。关联 `replace-pdf-painting-core` 的页面坐标模式不变，宿主页面缩放仍由宿主管理，本次不在 PageDrawingSurface 注入第二套缩放。
- 本 change 已进入 apply；本轮按已采纳的第三轮四条验收意见修订并在 PR #44 交付。
