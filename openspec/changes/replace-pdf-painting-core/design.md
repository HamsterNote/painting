## Context

HAM-131 最新决策撤回 legacy 投影和双写。painting 0.7.0 只读 schema 3，reader 0.4 数据为按 page-N 保存的 DrawingValue。库内保留的 V2 normalizer 会静默过滤坏数据，不能直接用于持久化升级。

## Decisions

- 新增 `migrateLegacyDocument(input: unknown): DocumentReadResult<EditorDocument>`，支持无版本 / schema 1、2 的 `{strokes}` 以及 schema 3。新文档走严格 reader；旧文档逐字段校验、稳定 ID、确定性 sequence/time，返回深冻结新文档，不修改输入。失败带原始字段路径，整次失败；不把未知未来版本当旧数据。重复迁移输出相同，迁移输出再次输入值相等。原 reader 不增加 fallback。
- pen 转为新 freehand raw samples（无旧时间时以点序号填充；单点复制终止样本）；有压力选 real，无压力选 constant。颜色、宽度、压力、对象顺序保留；笔形使用 schema 3 的 perfect-freehand，而不是旧的分段 SVG 算法，轮廓不承诺逐像素相同。虚线 pen 和多点直尺 line 在迁移时拆成稳定 ID 的普通 shape，保持路径/压力宽度/虚线相位，后续可逐段编辑；形状、文字、图片保留语义、bounds、rotation、resourceId；形状增量支持 dashOffset / fillOpacity。零宽形状用透明 stroke 表达。无效或不可表达数据返回错误，绝不部分成功。
- 新增 `PageGeometry { width, height, pageToSurface: AffineTransform }`、`createPageCoordinateSpace`，返回 pageToSurface / surfaceToPage 和映射函数。width/height 是永久页面坐标尺寸；pageToSurface 是页面到叠加容器局部 CSS 像素的变换。宿主可通过 `createPageGeometry({width,height, viewportTransform, referenceTransform})` 直接传 pdf.js 当前和 scale-one 的六元组，库计算 current × inverse(reference)。
- 新增 `PageDrawingSurface`，使用几何描述定位透明的页面表面；CSS 仿射负责所有呈现，库内同一逆矩阵负责 freehand/semantic/arbiter 输入。逐批读取容器 rect，因此滚动不引入陈旧偏移。页面表面保持 controller viewport 恒等，禁用库内导航（宿主 PDF viewer 是页面导航权威）；切换页面、矩阵、尺寸会重挂载输入资源并取消未完成笔，不跨页串笔。无页面 prop 的既有 DrawingSurface 行为不变。
- 页面容器应覆盖 PDF 页内容区域（排除 border/padding），不得再次单独缩放 overlay；父容器的轴对齐 CSS 缩放由实测 rect/client 尺寸比补偿。旋转由 pageToSurface 表达。每页独立 controller，pageId/坐标基准不得随缩放改变。
- painting / painting-board 0.8.2 正式 npm 版本为 reader 前置依赖；不使用 link/git ref。0.8.1 修复旧格式公共样式校验，0.8.2 修复禁用输入时的首次展示，不改变已有 API。库只返回新格式；reader 成功写入新键后优先读新键，保留 v4 原 blob，不双写、不投影、不删。旧 App 只看到升级前内容。

## Validation

旧数据 fixtures、完整工具类型、错误路径/不 mutation/重复迁移；缩放/滚动/旋转/分页与 coalesced 输入；页面表面活动和历史对齐、颜色快照、取消事务；既有测试、typecheck、lint、build、pack。浏览器自动化证明坐标契约，真笔设备不由合成事件证明。

## Release

0.8.2 追加修复只读初始展示：PresentationCoordinator 随 controller/trace 生命周期创建与销毁，不依赖输入启用；输入 adapter 另行绑定该实例，enabled 变化只清理输入。禁用时历史 SVG 不参与命中测试，交互覆盖层不挂载，文档展示继续订阅。reader 当前正式依赖升级为 0.8.2，保留已发布的 0.8.0/0.8.1 tag。

PR #40 已合并；0.8.2 修复从 main 新开 PR，推送新 tag v0.8.2 触发现有 trusted-publishing 流程。正式 npm 是否可用以 registry 查询、下载包及只读展示验证为准；发布失败不将计划版本宣称为已发布。

0.8.3 单独修复文字编辑取消：文字请求绑定创建它的 controller，只有输入有效时才挂载编辑器，禁用或替换 controller 时清空请求，恢复输入不复活旧草稿。编辑器在 layout effect 中建立会话、同步清理并取消；StrictMode 的重放创建新会话。提交和 IME 持久化入口核对当前会话身份，卸载后的旧回调无法写文档。保留 0.8.2 及以前的 tag；使用正式 0.8.3 包复验后交付 reader。
