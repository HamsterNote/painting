# Design

## Context

动机见 proposal.md。本设计基于 painting 0.8.3、项目 OpenSpec 1.13.1 / spec-driven，以及 HAM-156 原图和触发评论。

- `packages/painting/src/layered/Toolbar.tsx` 使用 div/button/input/select 与 CSSProperties，已有十二工具、Icon、历史、颜色/笔宽/不透明度、压力/线型、输入模式、导航开关、25–800% 缩放。订阅 tools/history/input/navigation/viewport；不订阅逐点 interaction。
- `PaintingBoard.tsx` 是 column 布局，工具栏在画布前。`packages/painting-board/src/index.tsx` 重导出此画板及类型；`toolbar={false}` 隐藏栏。Toolbar 自身也有公开导出。
- `apps/playground/src/layered-editor/LayeredEditorDom.tsx` 以 `'use dom'` 承载整个编辑器；默认原生路由通过 `dom` props 使用它，Web 路由也使用它。iOS/Android DrawingLayer 入口重导出 Web 层。因此本次改动落在 DOM 内，不应把组件库迁移误认为 Expo 可运行的先决条件。
- 既有 `document-object-interaction` 要求保留全部编辑/导航能力、形状与自由笔配置隔离、静态标签禁选但输入可编辑；`input-session-viewport` 要求单一 viewport 和三档输入。本设计增加呈现契约，不修改这些语义。iOS PencilKit 原型仍保持 opt-in。
- `replace-pdf-painting-core` 是已有完成任务的独立 change；其 PageDrawingSurface 接受宿主页面坐标与导航，本次不向该模式追加通用 viewport 控件。

## Goals / Non-Goals

**Goals:**

- 将参考图转换成可测量的工具栏规格，并将每个入口映射到已有命令或明确的局部展示状态。
- 在不删除原有功能的前提下收敛首层信息，保持公开画板和独立 Toolbar 的用法。
- 为后续实施者给出有版本和文件依据的复用判断。

**Non-Goals:**

- OCR 服务、文字颜色新模型、文档迁移、新原生工具栏、组件库迁移实现、输入桥重构、自动隐藏/拖拽定位、全站主题和暗色模式扩展。
- 本轮仅生成 Propose 文档，不执行实现任务或创建/分派子 issue。

## Decisions

### 1. 容器内底部悬浮，布局不改变 viewport

将 PaintingBoard 根容器作为 position:relative 的定位边界，画布占满可用区域；工具栏由覆盖层承载，底部居中，而非固定到浏览器页面。覆盖层空白处 pointer-events:none，胶囊、菜单与真实控件恢复 pointer-events:auto，标记既有 data-interactive 安全边界。工具栏/菜单不被当作纸面触点，不新增画布级全屏拦截层。

Toolbar 保留当前 controller 必传接口；增加可选 `placement: 'inline' | 'floating'`，默认 inline，便于独立调用；PaintingBoard 内传 floating。`toolbar` 布尔值语义不变。浮动定位由容器层完成，不对画布内容做 CSS scale/translate，不重置 controller viewport。普通画板的布局尺寸变化仍走原有表面测量；页面模式仍由宿主管理导航。

选择容器定位而非 viewport fixed，防止多画板、侧栏和嵌入场景串位；不采用压缩画布留出顶栏的旧结构，以符合参考图。局部层级建议 surface=0、toolbar=20、菜单=30，仅作用于画板 stacking context；不能覆盖文字输入系统弹层或宿主全局模态。

### 2. 首层信息架构与现有代码映射

宽度足够时完整保持以下从左到右顺序；组与组之间分隔，组内不加竖线。主操作各为独立入口，文字/矩形/绘图之间仅用间距，不额外增加竖线。

| 分组 | 首层入口 | 命令 / 状态 / 次级入口 |
| --- | --- | --- |
| 历史 | 撤销、重做 | history.canUndo/canRedo 决定 disabled；调用 controller.undo/redo |
| 缩放 | 当前比例（如 125%） | 打开缩放面板；保留数值输入 25–800%、步长25，调用 updateViewport 的 replace 命令并带最新 expectedRevision；无效输入不提交，拒绝则恢复权威快照，不创建另一套缩放 |
| OCR | 图标与 OCR 文案 | 固定禁用，显示可访问说明「OCR 暂未接入」；无请求、弹假结果或文档变更 |
| 展示 | 收起、固定 | 两个不同按钮：默认展开且未固定；固定后保持展开并禁用收起，先解除固定才可收起；不做自动隐藏 |
| 主操作 | 文字 | setTool('text')；activeTool==='text' 时选中 |
| 主操作 | 矩形（带菜单入口） | 主按钮 setTool('rect')；独立箭头打开形状/对象菜单：line、rect、ellipse、polygon、bezier、image；在上述工具下本组高亮，文案使用当前工具名，默认名「矩形」 |
| 主操作 | 绘图（带菜单入口） | 主按钮 setTool('freehand')；独立箭头打开 freehand、selection、lasso、eraser、pan，以及「设置」入口；对应工具下本组高亮，文案显示当前工具名，自由笔显示「绘图」 |
| 调色板 | 六色圆点 | 自由笔 → setFreehandSettings；五种线/形状 → setShapeSettings；其余工具下禁用并说明「用于绘图或形状」；不借 shape 设置伪装成文字颜色 |

「设置」始终可从绘图菜单访问，包括三档输入模式（原名称和选项）、尺子、虚拟纸张、小地图。自由笔上下文设置包括自定义颜色、标称笔宽、不透明度、压力；形状包括自定义颜色、笔宽、不透明度、线型。仍调用原 updateStyle 逻辑及 setInputMode / writeInputModePreference / setNavigation，不把这些参数变成文档对象事务。

菜单的每种工具使用原中文可访问名称（自由笔、直线、矩形、椭圆、多边形、贝塞尔、文字、图片、选择、套索、橡皮擦、平移）；顶层「绘图」可访问名称允许为「绘图（自由笔）」。文字模式无可用颜色设置，调色板禁用但保留其位置。非预设当前色时六点均不选中，自定义颜色仍由设置面板访问。选择颜色仅更新当前工具族的后续绘制设置，不重涂已选对象。

选择次级菜单而非移除工具，因为现有规格要求能力完整；把输入模式放入始终可达的设置入口，避免它只在自由笔时才可见。

### 3. 视觉 token 与状态

以下为从原图提炼的提案值，单位为 CSS px；不是用户确认的像素采样值。图中选中项遵照触发评论采用白字。

| 项目 | 规格 |
| --- | --- |
| 胶囊 | 高60；box-sizing:border-box；左右内边距12、上下7；外圆角30；1px 边框 #E2E5EA；背景 #F5F6F8；阴影 0 6px 24px rgba(15,23,42,0.12) |
| 定位 | 底边距16 + env(safe-area-inset-bottom,0px)；左右至少16；max-width:calc(100% - 32px)；居中，不拉伸填满宽度 |
| 按钮 | 交互区域最小44×44；主操作左右内边距12、图文间距8；按钮圆角12；图标18；文案14/20、字重600 |
| 间距 | 同组相邻按钮4；组边缘至分隔线8；主操作之间4；分隔线1×24、色 #D9DEE5、垂直居中 |
| 普通 | 文字/图标 #526174，透明按钮底；hover 背景 #E8EBF1；按下背景 #DEE2EA |
| 选中 | 背景 #7163D9、文字/图标 #FFFFFF；hover #6557C8；aria-pressed=true；同一活动工具仅所属主操作组高亮 |
| 禁用 | 前景 #9AA5B5、透明底、无 hover 变化；原生 disabled 语义；不以 opacity 降低整个胶囊对比度 |
| 焦点 | 2px #7163D9 外描边、offset2；焦点与选中可同时可见 |
| 六色 | 蓝 #7FA3C3、绿 #8FBA8D、黄 #D5B984、粉 #CD9BAA、紫 #AB9CC2、黑 #2D2D2D；圆点直径24，44×44 命中框，点中心间距44 |
| 色点选中 | 2px #7163D9 环、间隔2；额外勾号区分仅颜色差异；分别提供蓝/绿/黄/粉/紫/黑可访问名称及选中状态 |
| 菜单面板 | 向上打开，间距8；背景 #FFFFFF、边框 #E2E5EA、圆角16、padding8，继承阴影；最大高度不超过可视区域减32，可纵向滚动 |

在 1440 和 1280 宽度画板验证完整单行；在 1024/768/390/320 宽度及浏览器200%缩放验证内容超宽时胶囊内部单行横向滚动，组不拆分、按钮不缩小，画板和宿主页面无额外横向溢出。是否滚动取决于实际内容宽度，不硬编码设备类型。键盘聚焦自动将控件滚入可见区域，滚动区提供标签「绘图工具栏，可横向滚动」。面板以实际可见触发点定位并约束到画板与 visual viewport 交集，软键盘出现后仍可操作。收起后只留下44×44「展开工具栏」按钮，同一底部安全间距；展开保留工具/参数，焦点回到收起按钮。

### 4. 组件库复用评估（可复核证据）

评估对象是 painting package.json / pnpm-lock.yaml 锁定的0.3.0，而非未知源码分支。已通过 npm view 和 npm pack --ignore-scripts 检查其发布包；该版本 gitHead 为 `bae8a07fa39716b1bef45afbe43787f6b6150507`。未获取 components 开发仓库，不对其未发布版本作结论。

| 证据（发布包内路径） | 观察 | 结论 |
| --- | --- | --- |
| package.json | peer react + react-dom；导出 import / types / styles.css，无 react-native 条件入口 | 无原生 RN 导出契约 |
| dist/button-DjMS8bKj.js、dist/components/button/Button.d.ts | jsx('button')、className；ButtonHTMLAttributes<HTMLButtonElement> | React DOM 按钮依赖浏览器控件与 CSS |
| dist/Icon-BBSPOBTI.js、dist/components/icon/Icon.d.ts | jsx('svg')、SVGProps<SVGSVGElement> | 现有 Web Icon 可用；原生 RN 需原生图标/SVG 适配 |
| dist/popover-D00SlGpL.js、dist/dialog-BYlEUJ_j.js | 从 react-dom 导入 createPortal | 不能直接放入原生 RN 树 |
| dist/use-modal-K9L8aPS0.js、dist/hamster-note-components.css | document.activeElement/body、HTMLElement、CSS变量/伪类 | 弹层与主题需独立的原生实现 |

结论分三种环境：Web 可直接使用；Expo 的 `'use dom'`/WebView 内可沿用 Web 实现（仍需验证样式加载、定位、焦点）；Expo 原生 RN View 树不能直接使用。React Native Web 提供在浏览器上渲染 RN 的能力，不会把 DOM 按钮反向转成 iOS/Android 原生控件。这里的“web component”按用户语境指 Web UI；上述证据指向 React DOM，而非已确认 customElements.define / Shadow DOM 的标准 Web Components。

本次继续复用已有 Icon；胶囊和按钮以局部 CSSProperties/样式定义，菜单可用原生 DOM 控件构成并实现焦点管理，不为视觉改版新增整库 CSS 导入。未选整体套用组件库 Button/Popover：其默认主题与尺寸不等于参考图，全局 CSS 也可能污染消费方。独立转换建议的范围、依赖与验收写在 proposal.md；这项建议不是本次任务依赖，也不意味着整个 painting 已具备纯原生 UI。

### 5. 状态、输入和公开接口兼容

主工具高亮、历史可用性、比例和颜色从 controller 频道读取，不维护副本。仅 openPanel/collapsed/pinned 为组件局部状态，默认展开/未固定、仅本次挂载有效，互斥面板切换或卸载时清理；均不写文档/撤销/持久化。

保留 useInputInitialization 的首帧就绪约束；收起不能重置输入偏好，重新展开不重新初始化 controller。默认选择工具与其颜色取自已有快照，不为了符合截图自动选择文字或覆盖默认色。

所有按钮有语义名称，菜单触发器提供 aria-expanded/aria-controls；菜单支持键盘上下移动与选择、Escape 关闭并返回触发器，点击外部关闭时不吞掉用户原本的画布输入。工具栏内 Tab 顺序跟随视觉顺序。静态文字禁选，数值与颜色控件保留正常编辑、原生菜单和焦点；不全局 preventDefault。既有画布起笔跨界与后续主动首击行为继续通过原输入仲裁维护。

## Risks / Trade-offs

- [底部覆盖可绘制区域] → 仅胶囊真实区域拦截输入，提供显式收起；不通过第二套 viewport 补偿位置。
- [窄屏无法同屏展示所有分组] → 内部横向滚动，保持顺序与44px触控区，Tab 自动滚入；不宣称窄屏完全复刻宽屏截图。
- [菜单化后旧测试假定控件总在首层] → 修改测试为用户真实打开面板后操作，继续断言 controller 状态及历史，而非仅改选择器使测试通过。
- [OCR 没有业务接口] → 本期明确禁用并说明原因；接入真实识别属于未来独立业务需求。
- [Expo DOM 的键盘、安全区与原生覆盖层] → Web 自动化之外在实际 iOS/Android DOM 宿主验证；现有 opt-in PencilKit 启用时额外验证工具栏不被原生层吞掉，不扩大原型生产承诺。
- [参考图没有精确 token 和收起/固定交互定义] → 本文给出明确可实施建议供评审；不是已有用户确认事实。

## Migration Plan

后续 apply 先调整组件结构与局部样式，再接入菜单并跑原有交互回归；不需数据迁移，不改 packages 版本或锁文件。公开布尔 toolbar 参数及默认行为保持兼容；独立 Toolbar 默认 inline。若集成出现回归，可回退此次 Toolbar/PaintingBoard 呈现改动，不影响保存文档和 controller。

## Open Questions

无阻塞问题。可在评审中微调阴影、色点和图标表现；若要让 OCR 可用、改为纯原生工具栏或实施组件库转换，应另立 change 重新定义业务范围。
