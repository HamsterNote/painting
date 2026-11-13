# Design

## Context

动机见 `proposal.md`。本次跨越选中框呈现、输入仲裁、Web 适配器和语义工具会话，需要一份共同的几何与归属设计。

已核对当前源码：

- `layered/SelectionOverlay.tsx` 通过 `deriveLayeredWorldBounds` 合并所选对象的 visualWorldBounds，再映射至 viewport；SVG 根节点为 `pointerEvents: none`，仅右下缩放矩形和上方旋转圆开启事件。当前并没有四边八个缩放手柄；“四周手柄区域”在本提案中指包含所有现有手柄的整体外接区域，不扩充控件。
- `layered/semanticWebAdapter.ts` 从 DOM 的 `data-selection-operation` 决定操作，否则默认 move，将 DOM 对象 id 交给工具会话；owner 已记录 pointer id/source，坐标复用 `getClientToLocal` 和起点 viewport。
- `core/layeredToolSession.ts` 的 begin 先查询对象，优先使用有效 targetId，空白 move 清空选择，随后才快照 originals；update 已从起点与 originals 计算变换。问题主要在起点分类和快照前的选择覆盖，不需要引入第二套移动引擎。
- `input/web/layeredInputArbiter.ts` 默认仅通过 `data-selection-operation` 把事件归为 selection，其余归为 paper。现有 selection 手柄归属与 paper 双指导航行为不同；必须同步整体范围分类，避免只修工具会话而仍被导航抢占。
- 当前普通点命中与擦除轨迹查询受 `document-object-interaction` 约束。增量显式区分选择起点优先范围、已锁定变换与擦除实时查询，保留擦除行为。

## Goals / Non-Goals

**Goals:** 同一几何派生结果供呈现和起点分类使用；在现有工具会话中固定变换目标；DOM 目标被其他对象覆盖时仍可解析选中框；真实画板和页面表面一致。

**Non-Goals:** 新增选择工具、四边/八点手柄、触摸热区尺寸重设计、自动置顶、修改文档格式、实现原生侧对象选择或重写既有导航状态机。

## Decisions

### 1. 共用选中框几何，并以包含手柄的完整外接矩形定义优先范围

在 painting 内部提取供 SelectionOverlay、语义输入和仲裁共同调用的几何派生与命中描述；输入为当前文档/预览、选中集合和 viewport，结果包含可见框、各手柄命中区及整体优先矩形。无有效选择或不可用几何时返回无范围，走原普通命中路径，不吞掉整张画布。

几何先使用现有 visualWorldBounds 合并选区，再转换到宿主 local DIP；手柄保持现有屏幕尺寸。当前缩放手柄为右下角中心周围 10×10，旋转手柄中心位于框顶上方 20 DIP、半径 6 DIP。整体范围取框与手柄交互区的外接矩形并包含边界，不仅是几个区域的并集，因此外扩带的空白也有效。屏幕命中后按既有映射计算 world 位移；不以固定 world margin 代替屏幕手柄尺寸。

备选：仅打开 SVG 框内部 pointer events 可改善空白命中，但无法单独保证外扩带、DOM 遮挡、页面坐标映射和仲裁分类一致；仅对对象包围盒加固定容差不能覆盖全部手柄且随 zoom 漂移。选用共用派生，SVG 可增加透明移动面以提供正确光标，但几何分类仍为权威。

### 2. 起点分类采用明确优先顺序

先执行现有安全控件、输入模式、当前工具和已有 owner gate。选择工具且选择有效时，依次检查具体手柄、整体优先矩形；得到 resize/rotate 或 move。命中后忽略覆盖对象的 DOM id 和普通点命中，保留整个选中集合（含 Shift 起点）；范围外沿用现有对象选择规则。直接手柄保留原功能是本提案依据已有规格作出的假设，非新增用户确认。

将共享分类结果用于 `layeredInputArbiter` 的 targetRole 和 `semanticWebAdapter` 的 begin，避免一方认为 selection 而另一方认为 paper。可用已有 targetRole 接缝接入，但必须基于同一坐标映射和几何，不依赖实际 DOM target。整体范围仅对 selection 工具启用；已在导航或真实文本输入中的事件按既有归属处理。

备选：提高所选对象 z-index 会改变文档展示且解决不了无内容空白命中；只给覆盖层提高 DOM 层级不能解决语义入口的目标重选。

### 3. 在既有工具会话 begin 中显式区分选中框命中与普通对象命中

内部 begin 输入携带已解析的选择操作描述，或等价显式选中框命中标识；不把所选对象 id 伪装成点击 DOM 对象。框命中先固定所选 ids、原始对象/变换、文档 revision、起点和 operation，再进入现有 preview/update/end 链路；普通命中维持旧分支。复用已有 originals 快照以支持多选，不在 move/up 再做对象点命中。

owner id/source 和起点 viewport 沿用现有 adapter；结束用 owner 最后有效坐标更新预览后只提交一次。若文档 revision 冲突，沿用 controller 拒绝和 adapter 清理机制，不将变换误应用到新的对象集合。几何错误也清理，不提交半成品。

备选：每次 move 按当前位置挑选目标直接违背目标锁定；另建移动引擎会产生重复历史和两套取消清理。

### 4. 扩展 selection 归属，保留既有导航与取消契约

整体优先范围接受后的指针享有当前 selection 类别的归属保护，第二指针不得把变换改交给其他对象。仍遵循既有策略决定哪些来源允许 selection、哪些只能导航；不将所有 touch 一律视为选择。真实取消、Escape、工具/模式切换及生命周期中断清空工具会话和 adapter owner；触发既有导航取消规则时先回滚预览，迟到 move/up 不提交。捕获转移本身沿用现有有效 owner 的连续事件契约，不额外把 lostpointercapture 一律当作提交或取消。

## Risks / Trade-offs

- [外接矩形会遮蔽其空白下方的其他对象选择] → 这是整体优先规则的直接结果；框外仍可选择/取消，且不更改图层顺序。
- [手柄直接拖动是否也应移动存在语言歧义] → 按既有规格保留缩放/旋转并显式标为规划假设；若评审要求所有手柄也移动，应同步修改本设计、规格和任务后再实现。
- [显示、仲裁和工具入口坐标漂移] → 共用几何和 getClientToLocal；测试非零平移、0.5/1/2 zoom 及页面宿主映射，避免复用旧 schema2 的 selectionOverlay helper 计算当前 schema3 对象。
- [扩大 selection 类别改变双指行为] → 仅在有效选择工具热区使用该类别，回归输入模式、第二指针和现有手柄保护测试，保留框外双指导航。
- [稀疏笔画或多选几何派生成本] → 复用 FreehandGeometryCache，按文档/选择/预览/viewport 版本更新；不在每次 move 做全量对象点查询或重建 React 状态。

## Migration Plan

实现阶段仅调整库内几何、输入分类及会话路径，无数据迁移和新增依赖。完成 core/adapter 与真实入口回归后按现有发布流程交付；回退该交互改动即可恢复原行为，已有文档可继续读取。实施验收包括桌面鼠标、触摸模拟及移动设备真实触摸；模拟测试不能代替设备结果。
