# Design

## Context

动机见 proposal.md。本设计基于 painting 0.8.3、项目 OpenSpec 1.13.1 / spec-driven，以及 HAM-156 原图和触发评论。

- `packages/painting/src/layered/Toolbar.tsx` 使用 div/button/input/select 与 CSSProperties，已有十二工具、Icon、历史、颜色/笔宽/不透明度、压力/线型、输入模式、导航开关、25–800% 缩放。订阅 tools/history/input/navigation/viewport/document；不订阅逐点 interaction。
- `PaintingBoard.tsx` 是 column 布局，工具栏在画布前。`packages/painting-board/src/index.tsx` 重导出此画板及类型；`toolbar={false}` 隐藏栏。Toolbar 自身也有公开导出。
- `apps/playground/src/layered-editor/LayeredEditorDom.tsx` 以 `'use dom'` 承载整个编辑器；默认原生路由通过 `dom` props 使用它，Web 路由也使用它。iOS/Android DrawingLayer 入口重导出 Web 层。因此本次改动落在 DOM 内，不应把组件库迁移误认为 Expo 可运行的先决条件。
- 既有 `document-object-interaction` 要求保留全部编辑/导航能力、形状与自由笔配置隔离、静态标签禁选但输入可编辑；`input-session-viewport` 要求单一 viewport 和三档输入。本设计补充呈现与套索完成后切换选择的契约，保留编辑/历史和输入语义。iOS PencilKit 原型仍保持 opt-in。
- `replace-pdf-painting-core` 是已有完成任务的独立 change；其 PageDrawingSurface 接受宿主页面坐标与导航，本次不向该模式追加通用 viewport 控件。

## Goals / Non-Goals

**Goals:**

- 将参考图转换成可测量的工具栏规格，并将每个入口映射到已有命令或明确的局部展示状态。
- 在不删除原有功能的前提下收敛首层信息，保持公开画板和独立 Toolbar 的用法。
- 为后续实施者给出有版本和文件依据的复用判断。

**Non-Goals:**

- 文字颜色新模型、文档迁移、新原生工具栏、组件库迁移实现、输入桥重构、自动隐藏/拖拽定位、全站主题和暗色模式扩展。
- 不迁移组件库，不新增 change 或 PR。

## Decisions

### 1. 容器内底部悬浮，布局不改变 viewport

将 PaintingBoard 根容器作为 position:relative 的定位边界，画布占满可用区域；工具栏由覆盖层承载，底部居中，而非固定到浏览器页面。覆盖层空白处 pointer-events:none，胶囊、菜单与真实控件恢复 pointer-events:auto，标记既有 data-interactive 安全边界。工具栏/菜单不被当作纸面触点，不新增画布级全屏拦截层。

Toolbar 保留当前 controller 必传接口；增加可选 `placement: 'inline' | 'floating'`，默认 inline，便于独立调用；PaintingBoard 内传 floating。`toolbar` 布尔值语义不变。浮动定位由容器层完成，不对画布内容做 CSS scale/translate，不重置 controller viewport。普通画板的布局尺寸变化仍走原有表面测量；页面模式仍由宿主管理导航。

选择容器定位而非 viewport fixed，防止多画板、侧栏和嵌入场景串位；不采用压缩画布留出顶栏的旧结构，以符合参考图。局部层级建议 surface=0、toolbar=20、菜单=30，仅作用于画板 stacking context；不能覆盖文字输入系统弹层或宿主全局模态。

### 2. 首层信息架构与现有代码映射

宽度足够时从左到右如下，组间用竖线分隔：

| 分组     | 入口与语义                                                                                                                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 历史     | 撤销、重做由 history.canUndo/canRedo 决定禁用态，调用原 controller 命令                                                                                                                                                          |
| 缩放     | 当前百分比打开25–800%、步长25的滑动条，无数值输入框；显示当前百分比，每次读取绘图可视区与visual viewport交集中心，使用最新 expectedRevision 提交transform，同时更新scale与平移以保持中心世界点不动，拒绝后恢复权威值，不延迟重放 |
| 工具     | 一个统一工具菜单，触发器显示当前工具；含画笔、直线、矩形、椭圆、多边形、贝塞尔、图片、文字（画笔第一项，内部仍为freehand），原 setTool 语义不变                                                                                  |
| 独立操作 | 设置、选择、橡皮擦、套索、移动、清空画布组成独立组；套索映射 lasso、移动映射 pan，设置任意工具下直接可达                                                                                                                         |
| 调色板   | 黑、蓝、绿、黄、粉、紫，最右为自由取色环；仅自由笔/五种线形状可用，各自更新工具族设置                                                                                                                                            |

收起/展开按钮独立于胶囊，位于其上方居中，44px圆形，间隔8px。收起隐藏整个胶囊和弹层，圆形按钮保留且不受胶囊横向滚动影响；恢复保留工具、参数、输入偏好并将焦点保留在同一按钮。没有固定或自动隐藏状态。

清空画布从最新 document 快照获取全部 objectId，调用一次 editObjects（expectedDocumentRevision + removeIds），空画布禁用。成功后清理预览，原控制器协调选择；只形成一次历史事务，撤销恢复所有对象。活动书写或版本冲突时遵循控制器拒绝，不取消笔、不重试、不排队。无需新增控制器API或逐点订阅。

设置面板保留三档输入模式、尺子、纸张、小地图，以及自由笔/形状各自颜色、笔宽、不透明度、压力/线型。颜色仅改变后续绘制，不重涂对象；文字等无颜色模型的工具禁用调色板。自定义色在预设之外时不勾选任何色点，仅非预设色时最右取色环激活并用当前色画外轮廓，匹配预设时仅该色点激活、取色环无外轮廓。现有编辑器快照绝不在挂载时覆盖，只有 createEditor 的新建默认自由笔与形状色改为黑色#2D2D2D。

缩放锚点通过所属画板的绘图表面（data-drawing-viewport）即时测量，取其与visual viewport的可见交集中心，再换算为表面局部屏幕坐标；不读取纸张边界或工具栏位置。使用现有transform intent的相同startFocal/currentFocal与目标/当前比例，控制器统一更新scale/tx/ty并保留版本/书写冻结规则；每次事件重新测量，覆盖平移后、容器尺寸改变、嵌入偏移及可视区变化。独立inline工具栏优先使用同父容器绘图表面，无表面时回退当前浏览器可视区中心。

套索在共享core/layeredToolSession完成路径处理，DOM与语义输入共用：最终路径查询成功且有命中时，先释放手势所有权、提交选区，再setTool('selection')并清理预览，避免工具订阅取消逻辑恢复旧选区。拖动中仍是套索；空/退化路径、取消或文档失效不切换。选择过程不产生文档历史，切换后下一次拖动立即移动选区。

颜色active由工具族当前色派生：匹配六个预设则仅该预设active；否则仅自由取色active。通过原生取色器选择预设同色时也归该预设；没有额外持久化来源状态。非颜色工具下全部inactive/disabled。预设色面和自己的选中环同色并保留勾号，键盘焦点提示与active环分开。

### 3. 视觉 token 与状态

以下为从原图提炼的提案值，单位为 CSS px；不是用户确认的像素采样值。图中选中项遵照触发评论采用白字。

| 项目       | 规格                                                                                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 胶囊       | 高60；box-sizing:border-box；左右内边距12、上下7；外圆角30；1px 边框 #E2E5EA；背景 #F5F6F8；阴影 0 6px 24px rgba(15,23,42,0.12)                                              |
| 定位       | 底边距16 + env(safe-area-inset-bottom,0px)；左右至少16；max-width:calc(100% - 32px)；居中，不拉伸填满宽度                                                                    |
| 按钮       | 除紧凑调色板外，交互区域最小44×44；主操作左右内边距12、图文间距8；按钮圆角12；图标18；文案14/20、字重600                                                                     |
| 间距       | 同组相邻按钮4；组边缘至分隔线8；主操作之间4；分隔线1×24、色 #D9DEE5、垂直居中                                                                                                |
| 普通       | 文字/图标 #526174，透明按钮底；hover 背景 #E8EBF1；按下背景 #DEE2EA                                                                                                          |
| 选中       | 背景 #7163D9、文字/图标 #FFFFFF；hover #6557C8；aria-pressed=true；同一活动工具仅所属主操作组高亮                                                                            |
| 禁用       | 前景 #9AA5B5、透明底、无 hover 变化；原生 disabled 语义；不以 opacity 降低整个胶囊对比度                                                                                     |
| 焦点       | 2px #7163D9 外描边、offset2；焦点与选中可同时可见                                                                                                                            |
| 六色       | 黑 #2D2D2D、蓝 #7FA3C3、绿 #8FBA8D、黄 #D5B984、粉 #CD9BAA、紫 #AB9CC2；圆点直径24，命中框约30.67×44，组内gap0，点中心间距约30.67，色面留白约6.67（原20的1/3）；命中框不重叠 |
| 色点选中   | 2px该预设自身颜色环、间隔2；额外勾号区分仅颜色差异；分别提供蓝/绿/黄/粉/紫/黑可访问名称及选中状态                                                                            |
| 自由取色环 | 最右原生color输入，24px多色渐变圆面；仅active时有2px当前色外轮廓，非active无外轮廓（独立键盘焦点提示保留）；同色点命中尺寸、可键盘聚焦和禁用，原生取色器保留                 |
| 菜单面板   | 向上打开，间距8；背景 #FFFFFF、边框 #E2E5EA、圆角16、padding8，继承阴影；最大高度不超过可视区域减32，可纵向滚动                                                              |

在 1440 和 1280 宽度画板验证完整单行；在 1024/768/390/320 宽度及浏览器200%缩放验证内容超宽时胶囊内部单行横向滚动，组不拆分、按钮按上述尺寸，画板和宿主页面无额外横向溢出。是否滚动取决于实际内容宽度，不硬编码设备类型。键盘聚焦自动将控件滚入可见区域，滚动区提供标签「绘图工具栏，可横向滚动」。面板以实际可见触发点定位并约束到画板与 visual viewport 交集，软键盘出现后仍可操作。收起后只保留上方圆形「展开工具栏」按钮，展开恢复原位与焦点。

### 4. 组件库复用评估（可复核证据）

评估对象是 painting package.json / pnpm-lock.yaml 锁定的0.3.0，而非未知源码分支。已通过 npm view 和 npm pack --ignore-scripts 检查其发布包；该版本 gitHead 为 `bae8a07fa39716b1bef45afbe43787f6b6150507`。未获取 components 开发仓库，不对其未发布版本作结论。

| 证据（发布包内路径）                                         | 观察                                                                               | 结论                                            |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------- |
| package.json                                                 | peer react + react-dom；导出 import / types / styles.css，无 react-native 条件入口 | 无原生 RN 导出契约                              |
| dist/button-DjMS8bKj.js、dist/components/button/Button.d.ts  | jsx('button')、className；ButtonHTMLAttributes<HTMLButtonElement>                  | React DOM 按钮依赖浏览器控件与 CSS              |
| dist/Icon-BBSPOBTI.js、dist/components/icon/Icon.d.ts        | jsx('svg')、SVGProps<SVGSVGElement>                                                | 现有 Web Icon 可用；原生 RN 需原生图标/SVG 适配 |
| dist/popover-D00SlGpL.js、dist/dialog-BYlEUJ_j.js            | 从 react-dom 导入 createPortal                                                     | 不能直接放入原生 RN 树                          |
| dist/use-modal-K9L8aPS0.js、dist/hamster-note-components.css | document.activeElement/body、HTMLElement、CSS变量/伪类                             | 弹层与主题需独立的原生实现                      |

结论分三种环境：Web 可直接使用；Expo 的 `'use dom'`/WebView 内可沿用 Web 实现（仍需验证样式加载、定位、焦点）；Expo 原生 RN View 树不能直接使用。React Native Web 提供在浏览器上渲染 RN 的能力，不会把 DOM 按钮反向转成 iOS/Android 原生控件。这里的“web component”按用户语境指 Web UI；上述证据指向 React DOM，而非已确认 customElements.define / Shadow DOM 的标准 Web Components。

本次继续复用已有 Icon；胶囊和按钮以局部 CSSProperties/样式定义，菜单可用原生 DOM 控件构成并实现焦点管理，不为视觉改版新增整库 CSS 导入。未选整体套用组件库 Button/Popover：其默认主题与尺寸不等于参考图，全局 CSS 也可能污染消费方。独立转换建议的范围、依赖与验收写在 proposal.md；这项建议不是本次任务依赖，也不意味着整个 painting 已具备纯原生 UI。

### 5. 状态、输入和公开接口兼容

主工具高亮、历史可用性、比例和颜色从 controller 频道读取，不维护副本。仅 openPanel/collapsed 为组件局部状态，默认展开、仅本次挂载有效，互斥面板切换或卸载时清理；均不写文档/撤销/持久化。

保留 useInputInitialization 的首帧就绪约束；收起不能重置输入偏好，重新展开不重新初始化 controller。默认选择工具与其颜色取自已有快照，不为了截图自动选择文字或覆盖已有快照颜色。

所有按钮有语义名称，菜单触发器提供 aria-expanded/aria-controls；菜单支持键盘上下移动与选择、Escape 关闭并返回触发器，点击外部关闭时不吞掉用户原本的画布输入。工具栏内 Tab 顺序跟随视觉顺序。静态文字禁选，数值与颜色控件保留正常编辑、原生菜单和焦点；不全局 preventDefault。既有画布起笔跨界与后续主动首击行为继续通过原输入仲裁维护。

## Risks / Trade-offs

- [底部覆盖可绘制区域] → 仅胶囊真实区域拦截输入，提供显式收起；不通过第二套 viewport 补偿位置。
- [窄屏无法同屏展示所有分组] → 内部横向滚动，保持顺序与规定触控区（一般44px，调色板约30.67px宽），Tab 自动滚入；不宣称窄屏完全复刻宽屏截图。
- [菜单化后旧测试假定控件总在首层] → 修改测试为用户真实打开面板后操作，继续断言 controller 状态及历史，而非仅改选择器使测试通过。
- [Expo DOM 的键盘、安全区与原生覆盖层] → Web 自动化之外在实际 iOS/Android DOM 宿主验证；现有 opt-in PencilKit 启用时额外验证工具栏不被原生层吞掉，不扩大原型生产承诺。

## Migration Plan

后续 apply 先调整组件结构与局部样式，再接入菜单并跑原有交互回归；不需数据迁移，不改 packages 版本或锁文件。公开布尔 toolbar 参数及默认行为保持兼容；独立 Toolbar 默认 inline。若集成出现回归，可回退此次 Toolbar/PaintingBoard 呈现改动，不影响保存文档和 controller。

## Open Questions

无阻塞问题。可在评审中微调阴影、色点和图标表现；若要改为纯原生工具栏或实施组件库转换，应另立 change 重新定义业务范围。
