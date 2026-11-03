# Proposal

## Why

现有 painting 工具栏在画板顶部平铺十二种工具与全部设置，主操作层级不清晰。HAM-156 要求参照附图改为底部悬浮胶囊，并明确 Web 组件库在 Expo / RN 中的复用边界，避免把视觉改版扩大为原生组件库迁移。

## What Changes

- 底部居中悬浮工具栏，按「撤销/重做 → 缩放比例 → OCR → 收起/固定 → 文字 → 矩形 → 绘图 → 六色调色板」组织；浅灰底、细分隔线、紫底白字选中态，尺寸和颜色见 design.md。
- 将次级工具和参数移入绘图菜单、矩形菜单及上下文设置面板，保留全部十二种工具、三档输入模式、笔刷/形状独立配置、尺子/纸张/小地图、自定义颜色及数值缩放。窄屏采用可横向滚动的单行胶囊。
- OCR 当前没有业务接口，本期仅显示禁用入口及「暂未接入」说明；不实现识别服务。收起/固定是本次新增的局部展示状态，不写文档或历史。
- 复用评估结论：已发布的 `@hamster-note/components@0.3.0` 为 React DOM/CSS 组件（并非已证实采用 Custom Elements 的标准 Web Components），可用于现有 Web 和 Expo DOM/WebView 内；不能直接作为原生 RN UI 使用。现有 Toolbar 已复用 Icon，本期继续使用，胶囊布局使用局部样式，不引入全局主题覆盖。
- 独立子需求建议「components 转 Expo 组件库」：优先移植 Button、Icon、Popover/Menu、TextField 与主题 token；采用 RN View/Pressable/Text、原生图标渲染和跨端入口，保持现有 Web API。依赖 components 源码访问、目标 Expo/RN 版本与发布策略确认、原生可访问性/焦点方案及 iOS/Android/Web 验证环境；验收须证明原生依赖图无 DOM/CSS/ReactDOM 运行依赖且 Web 不退化。它不阻塞本次 DOM 工具栏，不在本 change 建 issue、生成迁移实现任务或直接开工。

## Capabilities

### New Capabilities

- `painting-toolbar`: 胶囊工具栏的结构、视觉状态、现有命令映射、能力保留、响应式布局及宿主交互边界。

### Modified Capabilities

无。既有 `document-object-interaction`、`input-session-viewport` 与 iOS 原生输入边界继续适用；工具入口位置改变不修改其业务语义。

## Impact

- 主要涉及 `packages/painting/src/layered/Toolbar.tsx`、`PaintingBoard.tsx`、公开 props 类型及 painting-board 重导出对应测试；独立 Toolbar 与 `toolbar={false}` 保持可用。
- 复用现有 controller 的 tools/history/input/navigation/viewport 频道，不改数据格式、撤销权威或原生 PencilKit 桥；不新增生产依赖。
- 扩展现有工具栏单元测试、浏览器视觉/交互回归及 Expo DOM 实机验收。关联 `replace-pdf-painting-core` 的页面坐标模式不变，宿主页面缩放仍由宿主管理，本次不在 PageDrawingSurface 注入第二套缩放。
- 这是 Propose 文档交付；仅在后续单独授权的 apply 阶段实现。具体尺寸、六色色值、窄屏策略及收起/固定语义是本提案建议，尚未获用户逐项确认。
