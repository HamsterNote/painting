# Design

## Context

需求动机及验收矩阵见 `proposal.md`。已读取项目 `.opencode/commands/opsx-propose.md` 及随附技能；当前 CLI 为 1.13.1，配置为 `spec-driven`，本 change 依赖 proposal → specs/design → tasks。

当前 `Toolbar.tsx` 用单个 `openPanel` 管理 tools/settings/zoom，订阅 tools、viewport 等低频快照；首层用 `ToolbarNumberField` 编辑笔宽，尾部是六色和自由取色；settings 同时含输入／导航和笔触项。`toolbarStyles.ts` 尚无 range 轨道／滑块主题。`createEditor.ts` 的自由笔及形状默认已是 `#2D2D2D`，没有证据可把截图绿色归因到此处。

`ToolbarPanel` 复用共享 `ToolbarPopover`，已有面板边界、焦点恢复和 top/bottom 定位。`inlinePickers` 为 Expo DOM 的页面内颜色／选项提供替代路径，现有 `toolbar-inline-pickers.test.tsx`、`native-toolbar-bridge.spec.ts` 覆盖键盘桥接。已有进行中的 `replace-pdf-painting-core` change 聚焦页面／旧文档迁移，未覆盖本次 UI 要求；无需合并或改写它。

布局间距沿用现有实现：底部基础间距为8px，顶部为16px。依据 `packages/painting/src/toolbar/ToolbarShell.tsx` 的 `gap = edge === 'bottom' ? 8 : 16` 及默认底部 `calc(8px + var(--hn-toolbar-safe-area-bottom, env(safe-area-inset-bottom, 0px)))`，与 `docs/toolbar.md` 的布局章节一致；`toolbarStyles.ts` 不负责外壳定位。未提供layout时叠加有效底部安全区；受控bottom布局使用8px加显式bottom inset，显式0不回退整屏env。

本次只更正change中wide-board场景误抄的16px底边距，不修改布局代码。该requirement同时变更了首层分组，因此按当前schema的MODIFIED规则保留完整场景并更正数值，避免省略原场景导致后续归档丢失。主规格的其他历史安全区示例不在本次修订范围。

开发对账：在1280／1440px宽度测量浮动外壳相对所属画板的bottom；有效安全区0时应为8px、有效安全区34时应为42px；受控bottom=0应为8px、bottom=34应为42px。默认CSS变量显式覆盖0时不再叠加env。另确认top布局仍使用16px加max(top, headerContentInset)，例如top=24/header=44得到60px。本条是沿用布局的回归核对，不改变S5缩放控件验收标准。

## Goals / Non-Goals

**Goals:** 将所有笔触表单集中到同一弹层，展示层仅派生当前 controller 参数；复用现有交互边界，使浏览器和 Expo DOM 迁移后仍可编辑、键盘导航与安全关闭。

**Non-Goals:** 不调整输入／压力算法、已有对象样式、文档 schema、公开工具栏 API、原生 PencilKit 视图或其他仓库；不新增压力曲线、持久化偏好和动画系统。

## Decisions

### 1. 增加 stroke 面板，保留一般设置

在现有面板联合类型及互斥状态中增加 stroke，复用 `ToolbarPanel`；标签为「笔触设置」，使用 dialog 语义而非包含普通表单却标成 menu。将宽度、六色、自由取色／颜色编辑、不透明度、压力或线型搬入此面板；settings 留输入模式、尺子、纸张、小地图。新入口占原笔宽位置，旧尾部颜色组及多余分隔线删除，不预留宽度。

这样沿用现有菜单互斥、焦点和边界能力。另建独立弹层状态会允许多菜单同时打开；把所有内容搬入一般设置会违背 S 曲线按钮入口。打开文件菜单时也应关闭 stroke。非自由笔／形状下按钮禁用；若外部在面板打开时切到不支持工具，关闭面板且不提交残留草稿。切换支持工具族则切换该族表单，输入草稿不得串族。

### 2. S 预览采用有界 SVG，状态来自工具快照

按钮至少44×44px，内部 SVG 可用40×24视区，曲线在左右／上下留足笔宽边距，圆头圆角。预览颜色绑定当前族颜色，不透明度绑定当前族不透明度；可访问说明仍提供颜色与真实笔宽，透明度为0时不伪造可见墨迹。不支持工具用中性灰占位。

用 `1 + 5 × log(width / 0.5) / log(400)` 将合法笔宽0.5–200映射到1–6 CSS px：严格单调且极大值不填满按钮。SVG 专属类覆盖现有全局18px图标规则；不向绘图 controller 提交预览，不生成绘图对象或轮廓缓存。直接使用真实200px描边会溢出；固定宽度图标无法预览粗细。此预览不模拟某次真实笔压，实际压力效果以绘制结果验收。

### 3. 笔宽控件共享权威更新链路

滑条和 `ToolbarNumberField` 共用当前工具族读数与现有 `updateStyle`。拖动按0.5步进；右侧输入保持64×44px与原选择替换行为，合法有限且范围内值沿用既有提交语义（不引入新的小数精度归一化）。非法草稿仅本地保留，失焦／Enter回到权威值；工具族切换重置草稿。每次设置后回读 tools 快照，拒绝时所有展示恢复，不建立第二份持久状态。

菜单内为可收缩横向滑条加固定输入；在320px栏内仍保持输入在右。无需改 controller API。仅靠输入框和滑条分别维护本地数值会在外部更新或拒绝时失配。

### 4. 自定义 range 样式，保留原生 range 语义

仍使用 `input[type=range]`，在工具栏作用域增加专属 range 类，覆盖 WebKit／Blink 的 track/thumb 及 Firefox 对应伪元素。移除默认 appearance，6px圆角轨道用线性渐变显示 #7163D9 填充与 #E2E5EA 余量；18px白滑块、2px紫边。以44px高透明输入盒提供命中区，焦点沿用2px紫环／2px偏移；hover／pressed用轨道或滑块浅紫光晕，disabled减弱并保留可辨识轮廓。

缩放填充从有效值按 `(percent - 25) / 775` 推导，笔宽填充按 `(width - 0.5) / 199.5` 推导并限于0–1。保留缩放现有 controller transform 命令、revision 检查和每次输入时中心计算。原生 range 的键盘、辅助技术、触控行为可复用；只设 accent-color 无法保证截图中的黑轨消失。无需引入 slider 库或纯 div 仿制滑条。

### 5. 原样迁移颜色能力，默认黑通过链路验收

六色顺序、24px色面、原命中区域、色环／勾号、自定义激活互斥沿用。菜单颜色区显式用 grid/flex 和专属样式覆盖 `.hn-painting-panel button { width:100% }`，避免色点被拉成长按钮。常规模式保留原生自由取色；inlinePickers 将颜色编辑直接放在笔触面板，不再借 settings 面板间接打开，且不挂载原生 select/color picker。

先验证新建入口 controller 及首笔快照；若均黑，不改初始化。若实际入口覆盖默认值，仅修正无显式设置的入口；保留宿主显式绿色及用户当前参数。挂载强制黑色会破坏独立工具族状态及旧对象，因此不采用。文档只序列化对象快照，不新增当前工具设置的持久化承诺。

## Risks / Trade-offs

- [极端笔宽难按真实比例预览] → 有界单调映射，数值展示真实值，S3含极值截图。
- [移入弹层后CSS继承导致色点／输入撑开] → 分区专属类，320/390px及200%缩放截图检查；弹层保留所属栏内滚动。
- [键盘桥接／原生取色失去焦点或吞首击] → 沿用 `inlinePickers` 和 `ToolbarPopover`，迁移现有桥接测试，S6/S8记录宿主实测，未验证环境明确标记。
- [旧测试硬编码主栏笔宽和settings压力入口] → 更新相关单测及 `painting-toolbar.spec.ts`、`toolbar-round4.spec.ts`、`native-toolbar-bridge.spec.ts`，保留原历史／手势断言；不只改选择器而删除行为验证。
- [截图来自旧构建或显式绿色配置] → S1区分默认值与显式设置，记录版本与入口，不编造根因。

## Migration Plan

开发按 `tasks.md` 修改展示层和受影响测试，执行 `proposal.md` 的S1–S8并记录证据后交付评审。无数据迁移；回滚恢复工具栏渲染、样式及测试入口即可，笔画、压力快照和文件格式无需改写。开发阶段如缺设备，Web通过与设备未验证分别报告，不宣称所有宿主验收完成。

## Open Questions

无影响规格或任务拆分的未决决策。待开发记录当前构建默认绿色是否可复现，以及浏览器／设备版本与实测结果。
