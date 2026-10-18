# Proposal

## Why

当前绘图组件将输入、活动笔迹、历史渲染和编辑状态耦合，旧自由笔逐段中心线渲染难以获得一致的压感轮廓；未验收的 Skia 迁移又引入第二套渲染与平台复杂性。产品尚未上线，现在统一为永久 Web 显示端、以 perfect-freehand 生成几何轮廓，并分离控制器与图层，能建立可测试且可替换的跨平台基础。

## What Changes

- 拆分独立 Toolbar、无界面 EditorController、DrawingLayer 活动输入/笔迹层和 DisplayLayer 历史对象/DOM 文字交互层；Web 是唯一 viewport 权威。
- 第一期 Web、iOS、Android 的三个 DrawingLayer 平台入口复用 Web 绘制实现，原生保留 Expo DOM/WebView 承载。仅设计未来原生墨迹、批量原始样本提交和语义手势接口，不实现原生墨迹或跨桥逐点书写。
- 自由笔由共享 perfect-freehand 几何生成器产生填充轮廓：活动笔迹用命令式 Canvas，历史每笔一个 SVG filled path；历史对象树按文档顺序混排自由笔、形状、图片和 foreignObject HTML 文字。
- **BREAKING** 文档仅保存实际接受的原始样本及落笔时 brush snapshot/已解析压力模式，不保存私有平滑插值、预测点或 PF 轮廓；不保留旧中心线或 legacy V1/V2 兼容 fallback。
- 引入 auto（默认）、real、simulated、constant 压力模式，落笔时按来源/能力锁定；工具栏初期只暴露颜色、标称笔宽、不透明度和压力模式。**BREAKING** 取消自由笔虚线，直线/形状虚线仍保留独立配置。
- 输入会话明确 begin/update/end/cancel、落笔 viewport revision 与 brush snapshot，书写时冻结 viewport；取消、后台化及工具切换不得提交半笔。提交使用 commitId 去重，并在历史渲染确认后移交活动笔迹，而非仅 setState 后清屏。
- 保留直线/矩形/椭圆/多边形/贝塞尔、文字/图片与 IME、选择/套索及移动缩放旋转、整对象橡皮擦、撤销/重做，以及现有 ruler、virtual paper 和 minimap 能力。橡皮擦使用连续扫掠几何查询，非自由笔工具具有过程反馈；不新增导出功能。
- **BREAKING** 移除全部 Skia 依赖、渲染入口及相关专用资源，显式取代 `migrate-expo57-skia-surface`。旧 change 尚未全部交付（38/46），实施时移除而非伪装完成归档；本轮只规划，不删除旧 change 或修改业务代码。

## Capabilities

### New Capabilities

- `freehand-geometry-pressure`: 原始样本持久化、压力解析、PF 参数、活动/最终轮廓及缓存失效。
- `layered-web-rendering`: 控制器与图层边界、有序 SVG 历史、命令式活动 Canvas、幂等提交与渲染交接。
- `input-session-viewport`: 输入会话、坐标与 viewport 权威、来源策略、取消和未来原生语义契约。
- `document-object-interaction`: 形状/文字/图片、选择变换、连续整对象擦除、撤销重做与工具配置隔离。
- `web-platform-skia-retirement`: 三平台 Web 实现、Expo 承载、Skia 安全退出和未完成旧方案取代。

### Modified Capabilities

无。`openspec list --specs` 已核实当前没有已有 capability，不将未验收旧 change 当作已交付规范。

## Impact

- 主要涉及 `packages/painting` 的 DrawingSurface、StrokeRenderer、ImageRenderer、core、input、数学命中与 selectionResize，及 `packages/painting-board` 集成；现有未提交的平台无关实现须先审计再复用。
- 依赖实施时新增 perfect-freehand，移除 Skia exports/peer/dev/app 依赖、专用 fixtures、测试、脚本、文档及 pnpm 锁文件引用；保留无关 Expo、工具链和平台能力。
- `apps/playground` 展示/平台入口、Jest 和 `tests/ui` Playwright 覆盖需同步；不继承旧 Skia 描述符、通用 tile cache 或未经验证的 frame budget。
- 当前 dirty tree 较大，实施前须清点并备份/隔离用户工作，只删除确认的 Skia 内容，禁止 blanket reset/clean。本规划验收仅为 artifact 状态与 strict validate；真机压感、WebView DOM 输入与实际 paint/桥接性能验收属于实施及后续原生阶段，不以 props ACK 代替。
