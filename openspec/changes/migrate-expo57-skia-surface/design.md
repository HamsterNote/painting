# Design: Expo SDK 57 + Skia 绘制面迁移

> 本文是 explore 阶段的计划工件，只描述架构决策、边界与迁移策略，不包含逐行实现方案。所有决策以 `proposal.md` 与本 change 下的 `specs/*/spec.md` 为准；若执行中出现分歧，以 proposal 与 spec 的规范性要求为最高约束。

## Context

当前仓库是「名义上 React Native、实际仅 Web」的绘制实现，存在两类结构性耦合，必须在迁移到 Expo SDK 57 + Skia 时同时解决：

1. **Vite + SVG DOM 耦合**：绘制面以 Vite 打包，直接依赖 `document`、`window`、DOM Pointer Events、`getBoundingClientRect`、`setPointerCapture`，并以 `<svg>/<path>/<foreignObject>/<image>` 作为唯一渲染器。核心几何、命中与输入语义同 DOM 事件对象、宿主元素测量交织，无法在 iOS/Android 上运行，也无法在无 DOM 环境下复用。
2. **V1/V2 双模型并存**：公开契约 `DrawingValue`/`DrawingStroke` 不带 `schemaVersion`（V1 形状，见 `fixtures/v1`），而 `model/strokes.ts` 定义 `DrawingValueV2`/`DrawingStrokeV2`（带 `schemaVersion: 2`）。渲染层以 `RenderableStroke = DrawingStroke | DrawingStrokeV2` 和运行时 `schemaVersion in stroke` 分支同时兼容两套形状，迁移仅能在显式调用 `normalizeDrawingValue` 时发生。结果是「同一语义、两套契约」，几何、命中与持久化各自兼容，边界模糊、易误读历史数据。

同时，视口变换职责当前被分散：非虚拟纸模式由 SVG 内部 `<g transform>` 承担，虚拟纸模式由 `@hamster-note/virtual-paper` 容器承担，输入坐标又各自做屏幕↔画布换算；多指导航、尺子与选区变换依赖 `@system-ui-js/multi-drag`（及 core 包）。这些是迁移需要收敛的核心问题。

本 change 的能力边界（`expo-skia-runtime`、`cross-platform-drawing-surface`、`drawing-gesture-sessions`、`drawing-resource-editing`）见 `proposal.md`。

**范围修订（2026-09-25）**：正式产品验收改为 **Web-only**；原生界面、Adapter、路由与依赖**保留并继续开发**，但原生侧**不再要求/自动验收**真实启动、触控、手势、Skia 渲染、IME/picker/权限、性能与 E2E，只保留 **`compat-static` 静态兼容门**。详见 `decisions/web-only-acceptance-scope.md`，该决定 **supersedes** 旧的「原生真实运行为验收 MUST」要求，并**不篡改历史验证报告**。

> **当前状态 supersession / closure note（2026-09-26）**：本设计中第 10.1、10.2、10.6 及后续
> 历史段落所述「6.3 OPEN / proposed / block」保留为各自写入时的规划和阻断事实；它们**不再是当前
> 状态结论**。父 orchestrator 已以 **Gate 6.3 专项 attempt 3/3 APPROVE** 在正式 **Web-only** 范围
> 关闭 6.3，权威关闭证据为 `verification/task-6.3-web-safe-geometry.md`。关闭范围限于 Web-only，
> **不代表** native/全平台运行、7.4、8.x、9.4、10.x 或整个 change 完成。

## Goals

- 以 Expo SDK 57 承载应用：Web 完成可交互启动并作为**正式验收面**；iOS/Android 保留 **`compat-static` 静态目标兼容**（根 typecheck、`expo export --platform ios|android`、native Jest/RNTL 最小挂载）。
- 建立无 DOM、无 React Native、无 Skia 依赖的纯核心层，统一使用 V2 绘制模型，并兼容读取既有 V1/V2 持久化数据与既有图片 `src`。
- 由单一 viewport matrix 统一承担世界坐标平移与缩放，世界层与屏幕恒定叠层分离。
- 完全移除 multi-drag / multi-drag-core 运行时依赖，以自包含的领域 `GestureSession` 实现绘图、导航、尺子与选区多指语义。
- 在 Web 上本地加载 CanvasKit，提供可见失败与重试；legacy SVG 回退必须是有限期、可见、可删除的。
- 文本编辑与图片资源导入以 **Web 验收面**实现；原生 UI 保留开发但不做自动验收。
- **安全几何已在 Web-only 范围完成**：partial curve/ellipse、复杂/自交闭合路径、contour cap 与预算安全 `FrameGeometryProgram` 已由 Gate 6.3 专项 attempt 3/3 APPROVE 关闭；不得将其外推为 native/全平台运行完成。
- **7.4 首发范围（未来实现约束）**：完整正式 Web Skia 编辑器为首发目标；selection resize 仅支持 **move / rotate / uniform scale**，不得引入 shear 或 schema/affine 扩展。本条不表示 7.4 或任一后续 Web 门禁已实施或关闭。

## Non-Goals

- 不设计视觉样式、组件观感、动效或响应式布局（属 `@designer` 职责）。
- 不在 explore 阶段实施任何代码变更；不产出逐行实现方案。
- 不追求一次性删除全部 legacy 代码；删除由门禁与稳定周期驱动。
- 不改变持久化数据的既有语义字段（V2 可读字段、图片 `src` 形态）。
- **不要求也不自动验收原生真实运行/触控/手势/Skia/IME/picker/权限/性能/E2E**；这些旧要求已 `CANCELLED`/`REPLACED`（见 `decisions/web-only-acceptance-scope.md`）。

## Decisions

### 1. 纯核心层（core）与依赖方向

核心层是一个纯 TypeScript 层，只包含：V2 文档模型、几何构造、命中测试、输入语义、viewport 变换数学、空间索引与手势会话状态机。核心层：

- MUST NOT 导入 `document`/`window`/任何 DOM 类型，MUST NOT 导入 `react-native`，MUST NOT 导入 Skia。
- 以纯数据输入输出：外部把归一化输入事件交给核心，核心返回文档增量与需要绘制/叠层的描述。
- 便于在 Node/Jest 下直接测试，且各平台共享同一份几何与命中逻辑（满足 `cross-platform-drawing-surface` 的「绘制与命中几何一致」）。

依赖方向单向：`platform shell（Expo/Metro/RN）→ InputAdapter → core`，`platform shell → Skia renderer`；core 不反向依赖任何上层。核心层被抽取后，既有 DOM 专属工具（如 `createPointerInputController`、坐标测量）从 core 移出，归入 InputAdapter/平台 shell。

### 2. InputAdapter：平台输入适配边界

新增 InputAdapter 抽象，负责把各平台原生输入翻译为核心可消费的归一化事件（触点/指针、类型、位置、压力、阶段、时间戳），并承载「捕获/释放」等平台机制。至少两种实现：

- **Web Adapter**：DOM Pointer Events → 归一化事件。
- **Native Adapter**：React Native Gesture Handler / 原生触摸 → 归一化事件。

InputAdapter 只做翻译与生命周期管理，不做几何与手势仲裁；仲裁属于 core 的 GestureSession。这样 multi-drag 被替换后，手势语义仍只有一份实现。

### 3. 唯一 viewport affine 与 DIP 渲染边界

- 世界坐标（DIP）到屏幕的平移与缩放由**单一** world→screen 仿射承担，采用屏幕空间约定：`screenX = a*x + c*y + tx`、`screenY = b*x + d*y + ty`；普通视口（无旋转/斜切）满足 `a = d = scale`、`b = c = 0`。
- 该仿射是唯一真相：世界层只在**一个** world `Group` 上应用一次（交给 Skia 时为 Matrix3 行主序 `[a, c, tx, b, d, ty, 0, 0, 1]`）；命中与输入复用同一纯仿射，`canvasToScreen` / `screenToCanvas` 内部委托同一组纯函数（`createViewportAffine` / `invertViewportAffine` / `mapViewportAffinePoint`），不再手写第二套换算公式。
- 禁止在容器、CSS、SVG、画布或每个对象上重复应用世界变换；连续平移/缩放等价于在该单一 affine 上的合成（满足 spec「单一 viewport 变换」）。
- 屏幕坐标（叠层、命中反变换、输入）通过该 affine 的逆变换或显式映射得到。
- 每帧瞬态 camera-origin rebasing 由 **6.3** 实施（见第 10 节）；rebase 只产出**单一最终 affine**，`frameOrigin` 不是第二 viewport。
- **DIP 边界**：on-screen Canvas 布局、world `Group`、world geometry、overlay 与 input 一律以 DIP 表达；应用层 MUST NOT 手动乘 `PixelRatio` / `devicePixelRatio`，backing store 的物理像素换算由渲染后端处理。仅 offscreen surface、`RuntimeShader` 等另立物理像素契约，且不在本阶段范围。几何契约本身 MUST NOT 绑定设备像素密度（满足 spec「DIP 单位」）。

### 4. 世界层与屏幕 overlay 分层

- overlay 描述携带 `space: 'world' | 'screen'`；两者都是 world `Group` 之后的 **identity siblings**，不再各自套一层世界变换。
- **世界层**：所有随 viewport 变换的绘制对象（笔迹、形状、文本、图片、选区内容本体）。
- **world overlay**：只把 anchor / vertices 投影到屏幕坐标后绘制，其线宽、marker、dash 保持屏幕 DIP（不随 viewport 缩放），即投影的是**位置**而非尺寸。
- **screen overlay**：位置、方向、尺寸在屏幕上恒定，包括选框/手柄、套索预览、光标/橡皮指示、缩放与角度反馈、尺子等；屏幕恒定线宽与虚线段长按 spec 属屏幕层语义。
- 分层直接决定 Skia 的绘制组织：世界层用唯一 viewport affine 绘制，screen overlay 用屏幕坐标绘制；命中测试在世界层坐标系中进行，且与渲染几何同源。
- 本阶段只保证上述分层与几何/单位边界，**不承诺**所有 legacy 外观（视觉样式、动效、组件观感）在此时对齐；外观属 `@designer` 职责，随实现收敛。

### 5. 完全移除 multi-drag，采用领域 GestureSession

- 彻底删除 `@system-ui-js/multi-drag` 与 `@system-ui-js/multi-drag-core` 的运行时依赖（含 `package.json`、Jest 映射与打包产物检查），满足 spec「完全无 multi-drag 运行时依赖」。
- 以领域专用的 `GestureSession` 状态机替代，按语义划分为：绘制会话、导航会话、尺子会话、选区会话。
- 会话语义沿用现有领域文档（`CONTEXT.md`）：触点归属、抓取偏移、并发手势、单指/二指仲裁、指针取消时干净终止并丢弃未提交临时笔迹；尺子 45° 吸附与双指刚体变换（**仅平移 + 旋转，不缩放**：尺子高度、刻度间距、PPI 与无限长条几何保持不变，「比例保持一致」只表示无形变、不是新增尺子 scale 自由度，见 `decisions/task-4-gesture-session-boundaries.md`）；选区移动/缩放/旋转以世界坐标锚点为准。
- GestureSession 是纯核心逻辑，由 InputAdapter 驱动，不依赖任何手势库。迁移期可保留 UI 层再导出以降低调用方改造成本，但实现不得再引用 multi-drag。

### 6. virtual-paper 的角色收缩为 Transform

- 现有 virtual-paper 在「虚拟纸模式」下接管容器变换；迁移后该职责并入单一 viewport matrix + GestureSession，不再作为独立运行时容器。
- virtual-paper 只需保留其 **Transform** 语义的等价行为；MUST NOT 把其未使用的 `readerMode` / `bounds`（滚动/阅读模式及其边界语义）带回新架构。
- 对外 `DrawingSurfaceVirtualPaperOptions` 中与交互开关、缩放范围、初始位置相关的既有语义保留，但其实现由新的导航会话与单一 viewport matrix 承担，而非外部容器。

### 7. 持久 document 与高频 transient 分离

- **持久 document**：已提交的 V2 绘制文档，是 history/持久化的唯一真相，变更频率低，走受控/非受控 value 通道。
- **高频 transient**：进行中的笔迹点、手势位姿、预览、缩放/平移与角度反馈等，逐帧更新，MUST 不进入持久 document，MUST 不触发 history 与持久化回调。
- transient 用 refs / Reanimated shared value 等不引起 React 组件重渲染的载体承载，由 Skia 绘制层直接消费；手势结束时才把结果一次性提交为 document 增量。
- 目的：避免多指交互时的高频状态更新污染 document、history 与持久化，并保证性能门禁可达成。

### 8. Web CanvasKit 本地加载与有限期回退

- Web 从随应用发布的本地静态资源加载 CanvasKit，MUST NOT 运行时依赖外部 CDN 才具备绘制能力；加载成功前不得宣称就绪（满足 `expo-skia-runtime`）。
- 加载失败 MUST 有可见反馈与用户可触发的重试，重试结果反映到界面状态。
- **临时性**：在 `cross-platform-drawing-surface` 与相关功能/性能门禁通过前，Web MAY 回退 legacy SVG 绘制面；该回退是有限期的、被触发时可见的，并在稳定周期后连同 legacy 实现一起删除。
- 任何时刻至多一个活跃生产画布；从 legacy 切换到 Skia 时旧画布被卸载，不允许双 Canvas 并存。
- 门禁通过后，Skia 成为 **Web** 的默认绘制面，无需用户开关，且不再自动回退（任务 7.4 仍 OPEN）。

### 9. 文本与图片资源策略（同步 ready 资源注入）

- **同步 ready 资源注入**：渲染器只接收**已就绪**的资源句柄——`fontManager`、`fontFamily`、`getImage(src)`——并同步消费；加载、权限、缓存与重试 NOT 属于渲染器职责（加载失败/重试见 7.1，导入与权限见 8.5）。
- **文本**：渲染改用 Skia 文本能力（Paragraph/TextBlob）；本阶段目标是**真实 glyph**，覆盖 `fontSize` / `color` / 基础多行 / clip / rotation。编辑态由平台文本输入适配（Web 的 DOM 输入 / native 的 RN TextInput 或等价方案）承担，结果提交为 V2 文本对象；完整编辑流程后置 8.1 / 8.2 / 8.3。文本几何（包围盒、旋转）由核心几何统一计算，输入与渲染同源。
- **图片**：持久化继续保持既有 `src` 形态（含 data URL），既有 `src` 值必须可读。本阶段目标是**真实 `SkImage` 像素**绘制，支持 fill、**fallback descriptor rect** 与 rotation；稳定 resourceID 与旧 `src` 兼容后置 8.4，导入后置 8.5。
- 资源导入/解析逻辑以纯数据契约描述，平台适配层执行实际读取；**Web app shell** 负责 Web 导入；原生 UI 保留开发但**不做自动验收**（原「原生不得静默 no-op」验收要求已 `CANCELLED`，见 `decisions/web-only-acceptance-scope.md`）。

### 10. 空间过滤与超大坐标 spike

- **空间过滤**：核心维护世界坐标下对象包围盒的空间索引，按当前 viewport 可见区域做剔除；被剔除对象在渲染与命中中被跳过，但 MUST NOT 改变可见对象的渲染或命中结果（满足 spec「视区过滤」）。命中与渲染共用同一包围盒与几何来源。
- **超大坐标 spike**：迁移前先做一次性 spike，度量以下情形下的精度与性能：极端平移到远离原点的坐标、极大/极小缩放、包含大量对象的长文档、以及接近浮点精度边界的坐标。spike 只验证方案可行性，不在 spike 阶段写入产品必选行为；方法与数据见 `spikes/coordinate-performance/README.md` 与 `spikes/phase-2/coordinate-performance-measurements.json`。
- **已确定的坐标策略（阶段 2 决策，见 `decisions/task-2.3-coordinate-indexing.md`）**：V1/V2 document 的持久点继续为有限 JS f64 `number` **absolute global DIP x/y**；不引入 origin/chunk，不 clamp、不重写、不持久化局部重基点，V1→V2 语义保留；将来若需分块必须新 `schemaVersion` + 显式 migration，重基只是实现期瞬态手段而非持久化格式。f64 ULP 证据（`1e9 = 2^-23`、`2^53 = 2`）表明重基不能恢复已经丢失的信息。
- **每帧瞬态 camera-origin rebasing（6.3 实施）**：`local = global - frameOrigin`、`localTranslation = globalTranslation + frameOrigin * scale`、`screen = local * scale + localTranslation`；`global → local` 与 translation 合成在 f64 完成，`frameOrigin` 是每帧瞬态（非持久 / 非 history / 非 `onChange`、非第二 viewport），render 与 hit 同帧同 origin，最终只保留单一最终 viewport affine。`1e6 / 0.0625 DIP` 是 f32 输入预算，不是视觉 / CanvasKit / 完整 affine 误差；交给 Skia 的 local geometry、乘积、translation 与最终结果均须 finite 且满足预算，超大几何裁剪 / 分段，绝不 clamp 持久顶点。
- **空间索引**：未来 core 采用 sparse spatial hash，`256 DIP` 为可配置初值；支持跨 cell、dedup + 精确 predicate、负 keys、update/remove、huge overflow bucket、document/z-order、render/hit 共用 bbox。阶段 2 的性能数据仅为 dense fixed 16x16 的对照，sparse 只测逻辑边例、尚未性能基准。

### 10.1 阶段 6：prepared geometry、索引与 DrawingFrame

- 阶段 6 的纯 core 边界由三部分组成：prepared canonical geometry snapshot、通用 sparse spatial index 与每帧唯一的 `DrawingFrame`。此处只记录已接受的实现边界；6.1、6.2、6.3 在 Gate 6 前均不得宣称完成。
- **Prepared snapshot**：每个有效对象只调用一次核心几何描述，生成以 document `order/index` 为唯一 key 的 entry（不得使用可能重复的 `stroke.id`）；entry 持有 stroke、geometry descriptor、保守的 absolute-global-f64 `worldBounds` 和 order。无效/不可描述 geometry 必须产生 diagnostic，并同时从 render、index 与 exact hit 候选中排除。Skia、索引、精确命中和 rebase 后续都消费同一 entry；legacy SVG 生产路径不因本阶段自动迁移。
- **保守 bounds**：bounds 必须覆盖最大 stroke/pressure 外扩、round cap/join、rotation，以及 text/image/fallback 的 descriptor rect；dash 不得用于收紧 bounds。允许 false positive，禁止 false negative；text/image 命中是 box 语义而非 alpha-pixel hit。ellipse/cubic 的近似采样与精确命中差异必须由实现和测试明确限定，不得泛称任何路径“完全同一”。
- **Spatial index**：索引只存 absolute-global-f64 world bounds，绝不存 local/screen/px/frameOrigin。默认 cell size 为可配置的 256 DIP；支持跨 cell、负坐标 floor key、每对象最多 64 cells、巨大对象 overflow bucket、dedup、half-open AABB 精确 predicate、稳定 document/z-order、upsert/remove 和 normal/overflow 互转。查询还必须限制最大 cells；过大查询退回对 records 的线性精确 predicate，保证正确性。document 仍是唯一持久真相，索引可随提交整体重建。
- **DrawingFrame**：唯一 factory 接收有限且为正的 layout DIP 与 viewport，按 layout 四角逆 affine 求 padded visible-world AABB，以其中心为 transient `frameOrigin`，并绑定 prepared/index revision。frame 保留 `globalToScreen` 供数学审计与 query；Canvas 只应用一个 `localToScreen`。任意 affine 下：`local = global - O`、`localTx = tx + a*Ox + c*Oy`、`localTy = ty + b*Ox + d*Oy`。屏幕命中先逆 `localToScreen` 得 local，再加同帧 origin 恢复 global 以查询索引，最后在同帧 local geometry 上作精确判定；screen tolerance 的换算必须显式且有限。
- `frameOrigin` 纯属瞬态：不得持久化、写入 history / `onChange`，也不是第二 viewport；不得 clamp 或重写 absolute global document 点。不得使用 legacy 的 NaN→0 映射回退。`1e6 / 0.0625 DIP` 仍只是 f32 输入预算；与 viewport 相交却含远大顶点的对象最终必须 transient clip/segment 而非跳过或改写顶点。若实现暂仅报告 `requiresClipping` diagnostic，则不得以此关闭完整的 6.3 裁剪义务。
- Gate 6 的最低证据包括：Node 覆盖八类 prepared geometry、重复 ID、无效/旋转/high-curvature 对象、索引边例，以及在 `1e9 ± .125`、scale `.25/1/8` 和负坐标下的 frame/rebase、checksum、无持久 effect 与 `2^53` 局限；Web fixture 另覆盖 far/near/negative/huge-crossing/z-order/outside/pan-back/hit-probe 与 frame diagnostics。Node 计时不是平台 SLA。**当前状态 supersession**：iOS/Android `expo export` 仅作为 `compat-static` 静态兼容，**不再**作为 1.4 / 4.2 的原生运行证据；6.3 的原生运行要求已 `CANCELLED`，安全几何已由 Gate 6.3 专项 attempt 3/3 在 Web-only 范围关闭，证据 `verification/task-6.3-web-safe-geometry.md`，不得外推 native/全平台。
- 阶段 6 不切换默认路由、不实现 CanvasKit retry、资源编辑、legacy 重写、schema/chunk、R-tree、offscreen 或性能门；这些分别仍属于后续阶段。

### 10.2 阶段 6.3 裁剪整改（P0 预审已接受，整改实施中）

> **当前状态 supersession / closure note**：本节以下内容保留 Gate 6.3 专项批准前的预审、实施中和
> 未完成事实，供审计追溯；它们已被 `verification/task-6.3-web-safe-geometry.md` 的 **Gate 6.3 专项
> attempt 3/3 APPROVE** 关闭结论取代。当前 6.3 已在正式 Web-only 范围完成；原 native 运行要求
> `CANCELLED`。此注记不外推 7.4、8.x、9.4 或 10.x 完成。

> 本节回填已接受的 Oracle 6.3 裁剪预审决策，只固定实现边界，**不表示 6.3 已完成**。任务 6.3 仍**不得勾选**，Gate 6 待实现与验证后进行。**范围修订后**：原「缺 iOS/Android 真实运行证据」要求已 `CANCELLED`/`REPLACED`，不再阻塞 6.3；但 **partial curve/ellipse、复杂/自交闭合路径、contour cap 与完整 f32 预算 MUST 继续完成**，**不得**因 Web-only 范围降级为「不支持」。本整改不得扩张到范围外的后续能力。

- **数据流**：`prepared` 在 **global f64** 生成 canonical geometry 与保守 global bounds → **global 空间索引**（只存 absolute global f64 bounds）→ `DrawingFrame` 按当前帧 origin 产出**每帧 local 安全 fragments** → Skia 渲染与精确命中消费**同一份 fragments**。render 与 hit 绝不各自重建 geometry，也不得对同一对象产生不同片段。
- **禁止先 translate 完整巨大 geometry**：不得把含远大顶点的完整 geometry 直接 `global - frameOrigin` 后再交给 f32。裁剪 / 分段必须在 translate 前（或与之等价地）在 global 空间完成，使交给 Skia 的 local 顶点、matrix、乘积、translation 与 screen 结果全部 finite 且落在 f32 预算内；不得跳过对象，也不得 clamp / 改写持久顶点。
- **canonical descriptor 不承载裁剪状态**：`DrawingGeometryDescriptor` 仍是纯语义描述（path / cubic-bezier / rect / ellipse），MUST NOT 内嵌 clip、fragment、origin 或 safety 状态。裁剪状态属于帧级派生结构（fragments + diagnostics），随帧重建、不持久化。
- **clip region 来源**：帧的裁剪区域由有限正 layout DIP、cull guard、entry 视觉 outset（最大 stroke/pressure 外扩、round cap/join）与 contour 近似误差共同决定，并通过 **inverse local affine** 从屏幕 / layout 区域映射到 local 区域；不得把屏幕矩形直接当作 local 矩形。
- **完整 f32 预算**：预算同时覆盖 local 坐标、matrix（a/b/c/d）、linear product（`a*x`、`c*y`、`b*x`、`d*y`）、translation（tx/ty）、screen 坐标，以及 style / text / image 的输入数值；任一环节越界都视为 unsafe，需裁剪或诊断，不得静默截断。
- **open path 片段与 pressure/dash 连续**：开放 path 的分段裁剪必须在切割点插值 pressure，并保持 dash 相位连续；不得因裁剪重置 pressure 或 dash 相位。
- **closed fill 与 stroke 边界分离**：闭合 path 的 fill 边界与 stroke 边界分别裁剪；**不得把人工裁剪边当作可描边边界**（MUST NOT stroke 人工 clip edge），否则会产生视觉上不存在的边线。
- **cubic / ellipse**：只细分与裁剪区相交的 branch，不相交 branch 不细分；当精度或段数上限无法解决时以 `unresolved` 诊断 cap，不得声称已安全。
- **rect / text / image 语义与后置边界**：rect 可解析裁剪；text / image 保持 box 语义（descriptor rect），不做 alpha-pixel 裁剪；其完整编辑 / 资源语义仍后置 8.x，本整改不扩张到这些领域。
- **受控 partial text/image 资源 box 裁剪（已实现的局部范围，不表示 6.3 完成）**：对与当前 frame-local clip 区相交的旋转 text/image 矩形框，core 可从 global canonical geometry 生成 **frame-local clipped resource box / semantic Hit Area**——旋转矩形与局部 clip 区的凸交集**有面积**才成功；边 / 点接触返回 `empty`；浮点退化非凸拓扑仍 `unresolved('partial-resource-box')`。Skia 仅消费该 fragment，以外层 Group clip 裁剪**完整 local Paragraph / Image（含 fallback descriptor rect）**，render 与 hit 共用同一 fragment、不读取 raw geometry。**仍未实现**：partial cubic / ellipse、复杂自交 / 非凸 closed path、contour cap、完整 f32 输入预算的全链路证明、dash 相位 / alpha 连续性，以及 **alpha-pixel 裁剪**。该补充不改变本节其余结论，也不构成本任务的关闭依据。
- **诊断与不宣称**：fragments 结果必须区分 `success` / `empty` / `unresolved`（以及既有 `requiresClipping` 语义），逐条可追踪；**不得宣称“无视觉误差”**——近似 contour、f32 预算与 cap 都会带来有界但非零的误差，必须显式记录。
- **证据与债务**：6.3 证据来自 **Web（真实 CanvasKit）+ Node（纯 core 回归）**；原「缺 iOS/Android 真实运行证据」要求已 `CANCELLED`/`REPLACED`。但 **safe geometry 支持仍未完成**（partial curve/ellipse、复杂/自交闭合、contour cap、完整 f32 预算），故 **6.3 仍不能勾选、保持 OPEN**。
- **范围约束**：本整改不扩张到默认路由切换、retry、资源编辑、legacy 重写、schema/chunk、R-tree、offscreen 或性能门。

### 10.3 阶段 8：文本编辑会话与图片资源边界（已接受，实施与验证计划）

> **当前状态 supersession note**：下文历史性「6.3 / 7.4 状态不变（OPEN）」仅保留写入时语境；6.3
> 已由 Gate 6.3 专项 attempt 3/3 在 Web-only 范围关闭。当前开放项为 7.4、8.1、8.2、8.5、9.2、9.4、
> 10.1、10.2、10.3 等，不把 6.3 作为开放依赖。

> 本节回填阶段 8 已接受的实现边界与验证计划，只固定语义，**不表示阶段 8 已完成**；`tasks.md` 中 8.3 / 8.4 已关闭（纯 core 语义），**8.1 / 8.2 / 8.5 保持 OPEN**。**范围修订后**：8.1 / 8.2 / 8.5 的验收面改为 **Web 临时编辑层 / Web 组合输入 / Web shell importer**；原「真实 iOS/Android 运行证据」要求已 `CANCELLED`/`REPLACED`。原生 UI 保留开发但不做自动验收。任务 6.3 / 7.4 状态不变（OPEN）。

- **文本编辑会话不写持久状态**：`draft`、`isComposing`（输入法组合）、`measuredHeight` 等编辑期状态只存在于 `core/textEditSession` 的纯会话对象中；它们 MUST NOT 写入 document、MUST NOT 触发 history 或 `onChange`、MUST NOT 进入空间索引。只有 `commitTextEditSession` 成功返回的新 document 才是持久增量。
- **既有文本目标以 index + expected id + tool 三元组定位**：`ExistingTextEditTarget` 同时携带 `index`、`expectedStrokeId`、`expectedTool`；提交时三者全部匹配才替换或删除，避免文档中的重复 ID 被错误命中；任一不匹配返回 `stale-target` diagnostic 并**严格保留 document 引用**。
- **提交一次、取消/新建空零变更**：同一 session 最多产生一次 document 写入（成功或空草稿都终结 session，重复提交返回 `session-finalized`）；`commit-not-requested` 与 `composition-active` 期间不写 document；`cancelTextEditSession` 不接触 document；新建会话空文本提交零变更；既有会话空文本提交等价位删除，且仅在三元组匹配后发生。
- **resourceId 是 `ImageStrokeV2` 的可选持久引用且保留 `src`**：`resourceId?: string` 为可选增量字段，`src` 始终必填并继续作为回退；迁移**显式保留** `resourceId`（仅非空字符串才保留，空值不产生引用语义，维持旧 src-only 形态），既有 `src` 值可读语义不变。
- **shell 负责文件、权限与解码；Skia 只同步 ready 资源**：文件选择、平台媒体权限与字节解码由 app shell 承担并注入；core/资源解析层 MUST NOT 获取平台文件或权限；Skia renderer 只同步消费已就绪的 `fontManager` / `getImage(src|resourceId)`，不做加载、权限、缓存或重试。
- **纯 registry 无 I/O、无 ID 生成、无 platform、无 Skia**：`core/resourceRegistry` 只保存有序元数据记录，提供纯函数 `create` / `register` / `resolve` / `remove`；`resourceId` 命中优先，缺失或未命中时按登记顺序精确匹配 `src` 返回首条；相同 ID 不同数据保留既有记录并返回 `resource-id-collision` diagnostic，不隐式覆盖、不生成 ID；registry 不导入 DOM/RN/Skia，也不执行任何 I/O。
- **验证计划（当前环境）**：Node 纯 core 单测覆盖 `textEditSession` 的 draft/composition/commit/cancel/幂等/stale 路径与 `resourceRegistry` 的命中优先级、`src` 回退、碰撞、removal；并以 `pnpm test` / `typecheck` / `lint` / `build` 与 `git diff --check` 为回归。Web E2E 仅可覆盖与平台无关的提交渲染路径，**不构成原生证据**。
- **关闭边界**：8.3 / 8.4 已关闭（纯 core 语义）；**8.1 / 8.2 / 8.5 改为 Web 验收面且仍 OPEN**：Web 临时文本编辑层、Web 组合/多行/emoji、Web shell importer 尚未覆盖正式 Web 编辑面。原原生运行验收已 `CANCELLED`。任务 6.3 / 7.4 状态不变（OPEN）。

### 10.4 阶段 9：分层测试架构与证据边界（已落地；9.1/9.3 已关闭，9.2/9.4 OPEN）

> **当前状态 supersession note**：下文历史性开放项清单中的 6.3 已被 Gate 6.3 专项 attempt 3/3 的
> Web-only 关闭结论取代；保留原文仅为审计。当前 Web 开放项仍包括 7.4、8.1、8.2、8.5、9.2、9.4、
> 10.1、10.2、10.3。

> 本节回填阶段 9「测试体系从 DOM/SVG 迁移到 core/RN/Web/E2E」的**已接受结论与落地现状**。多项目 Jest 与分层运行环境**已落地**，兼容性 spike **已完成**，RN/Skia test runner **已安装并可用**；`tasks.md` 的 **9.1、9.3 已关闭**（Gate 9 attempt 1/3 APPROVE），**9.2、9.4 保持 OPEN**。范围修订后，**Web E2E 为正式验收**，移动端仅为 `compat-static` 静态证据；原生运行/E2E 验收已 `CANCELLED`。

- **分层原则**：测试体系按**运行时环境**分层，每层使用与其环境匹配的测试器，且各层在**独立的 Jest project / 运行环境**中执行：
  1. **pure Node core**（无 jsdom）：纯核心几何、命中、viewport、V1/V2 迁移与 GestureSession 等逻辑。
  2. **Web 组件层**：jsdom + React Testing Library / React Native Web，覆盖 DOM 环境下的组件挂载与渲染。
  3. **RN 组件层（`compat-static` 最小挂载）**：jest-expo + React Native Testing Library，覆盖原生组件**最小挂载**语义；**非真机、非运行证据**。
  4. **独立 Skia CanvasKit Jest**：Skia 渲染器与 descriptor 在 CanvasKit 下的行为。
  5. **Playwright Web E2E（正式验收面）**：浏览器端到端启动、绘制、导航、文本与图片路径；**Web 为正式验收平台**。
- **RN 与 Skia 不得混在同一 project**：React Native 与 Skia CanvasKit 的运行环境、preset 与全局对象互不兼容，RNTL 与 CanvasKit **MUST NOT** 被塞进同一个 Jest project；二者各自独立。
- **jsdom + `react-native` mock 不能称 native**：当前单一的 jsdom 环境叠加 `react-native` mock 只能作为 **Web/组件层近似**，**MUST NOT** 被表述为 iOS/Android 原生证据。
- **legacy 巨型测试先替代后退役**：依赖 DOM/SVG 的 legacy `DrawingSurface` / SVG 巨型测试**不得直接删除**；只有在 **core / descriptors / E2E** 提供**等价覆盖**之后才允许**退役**（先建立替代覆盖，再移除旧测试）。
- **原生运行/E2E 验收已 `CANCELLED`**：原「真实 native E2E 仍需真实环境」的门禁要求已被范围修订取代；原生端到端**不再作为验收 MUST**，移动端只保留 `compat-static` 静态兼容证据（`[evidence:compat-static][target:ios|android][executor:linux]`）。mock / Web 测试仍**不得**冒充原生运行。
- **任务状态与测试架构**：`tasks.md` 中 **9.1、9.3 已关闭**（core-node 纯 Node 套件、native 最小 RNTL 挂载与 skia-canvaskit）；**9.2、9.4 保持 OPEN**。范围修订后 **6.3、7.4、8.1、8.2、8.5、9.2、9.4 仍 OPEN**，其中 1.4 / 4.2 的原生运行要求已 `CANCELLED`/`REPLACED` 为 `compat-static`。测试架构的引入**不改变** Web 侧未完成项。
- **Gate 9 已执行结果**：**attempt 1/3 APPROVE**，仅批准关闭 **9.1、9.3**；Node core 证据 → Web 组件证据 → Skia CanvasKit → Web E2E 均按层运行，**9.2 退役**与 **9.4 Web E2E 覆盖正式编辑面**仍未完成。
- **不得宣称**：**不得声称 9.2 / 9.4 已完成**，**不得以 mock 冒充原生运行**，**不得以隔离 fixture 冒充正式 Web 编辑面 E2E**。

### 10.5 阶段 10：Web 性能与验收门的证据矩阵与边界（已建立边界；10.1–10.3 未完成）

> **当前状态 supersession note**：本节过去把 6.3 列为 10.2/10.3 的开放依赖，是 Gate 6.3 专项
> approve 前的历史状态。以 `verification/task-6.3-web-safe-geometry.md` 为准，6.3 已在正式
> Web-only 范围关闭；10.2/10.3 的当前开放依赖不再包含 6.3，仍为 7.4、8.1、8.2、8.5、9.4、10.1
> 及相应验收工作。

> 本节回填阶段 10 在**范围修订后**的证据矩阵与边界，**不表示阶段 10 已完成**；`tasks.md` 的 **10.1、10.2、10.3 一律不得勾选**。原三端对等/原生性能要求已 `CANCELLED`/`REPLACED` 为 **Web 验收**；`6.3 / 7.4 / 8.1 / 8.2 / 8.5 / 9.2 / 9.4 继续开放`。1.4 / 4.2 的原生运行要求已 `CANCELLED`/`REPLACED` 为 `compat-static`。详见 `decisions/web-only-acceptance-scope.md` 与 `verification/web-only-scope-transition.md`。

- **既定证据矩阵（B1–B9）**：阶段 10 的门禁证据按平台归入九类槽位；缺任一槽位即不得宣称对应平台验收完成。**B8–B9 仅为移动 `compat-static` 静态兼容槽位**：
  - **B1–B4：Node product sparse index（纯 Node，无 jsdom）**
    - **B1 索引正确性**：negative floor key、跨 cell、每对象 ≤64 cells、overflow bucket、dedup、half-open AABB 精确 predicate、稳定 document/z-order、upsert/remove、过大查询退回精确线性 fallback；**false positive 可接受、false negative 不可接受**。
    - **B2 索引 / rebasing 性能基准**：100k objects / 16 queries / 确定性生成器 / 同机。
    - **B3 prepared geometry 与 frame rebase 精度**：`1e9 ± .125`、scale `.25 / 1 / 8`、负坐标、checksum、无持久 effect。
    - **B4 f64/f32 边界**：`2^53` ULP 局限、f32 输入预算、`requiresClipping` 等诊断如实记录。
  - **B5–B7：Web CanvasKit**
    - **B5 本地 CanvasKit 加载**：同源 `canvaskit.wasm` 200 `application/wasm`，无外部 CDN。
    - **B6 真实 CanvasKit 渲染**：八类对象、真实 glyph、图片像素、order、overlay、affine 与 dSF 1/2。
    - **B7 Web E2E / fixture**：`/skia-drawing-fixture`、`/canvas-runtime`、resource-editing fixture；hit probe、clipped resource box 与 rebased 对照。
  - **B8–B9：移动端（`compat-static` 静态兼容，替代原 native 运行槽位）**
    - **B8 iOS**：`expo export --platform ios` 静态导出 + 根 typecheck，标注 `[evidence:compat-static][target:ios][executor:linux]`。
    - **B9 Android**：`expo export --platform android` 静态导出 + 根 typecheck，标注 `[evidence:compat-static][target:android][executor:linux]`。
    - 原 B8/B9「真实运行」已被范围修订 `CANCELLED`/`REPLACED`；移动端**不提供**运行/触控/手势/Skia/IME/picker/权限/性能证据。
- **统一证据标签**：每一条被引用的证据 MUST 携带 `[platform] [machine] [build]` 三元标签——平台（node / web / ios / android）、机器（host 或设备标识）、构建（commit / build id）。缺少任一标签的证据不得作为验收依据；**移动端静态兼容证据** MUST 使用 `[evidence:compat-static][target:ios|android][executor:linux]`。
- **2.3 阈值不是 SLA、不可外推**：任务 2.3 记录的 `100k / 16 queries / 确定性生成器 / 同机` 下 indexed `p95≤8ms`、`max≤16ms` **仅为同机 Node 回归预警**，**不是 SLA**；性能门（10.1）须按**已批准 Web 性能合同**在 Web 平台重新采集并标注，而非套用 Node 数字。
- **已批准 Web 性能合同（10.1 依据；尚未执行）**：production Web export；固定 **1440×900**；dSF **1/2**；**100k 对象**；**120 pointer events/s 连续 10 秒**；`±(1e9 + .125)`；**5 次独立测量**且每次正确性通过；`event→next-frame/commit p95≤50ms`；`rAF interval p95≤33.4ms`；无 >100ms 主线程长任务；同机冻结基线退化 ≤20%；记录 OS/CPU/Chromium/commit+dirty+source patch hash/样本。**该合同是 Web 验收预算，非对外 SLA、非 native；未执行，不得据此直接勾选 10.1。**
- **历史 10.2 证据范围（Gate 6.3 专项 approve 前）**：Web 功能验收当时有真实 CanvasKit + Web E2E 局部证据（B5–B7），但 **Web 正式 Skia 编辑面与 6.3 / 7.4 / 8.1 / 8.2 / 8.5 / 9.4 尚未完成**，且 9.4 现有 E2E 仅为隔离 fixture（未覆盖正式编辑面），故 10.2 **不可勾选**。原三端对等要求已 `CANCELLED`。
- **当前 10.2 证据范围**：6.3 已在正式 Web-only 范围关闭；10.2 仍待**正式 Web Skia 编辑面 / 7.4**、**8.1 / 8.2 / 8.5** 的正式 Web 编辑能力、**9.4** 对正式编辑面的 Web E2E，以及完整 Web 验收清单，故仍不可勾选。
- **10.3 当前可记录范围**：10.3 只能记录「**Web 默认 Skia 仍延后，7.4 未完成**」这一事实；仍待 7.4、8.1 / 8.2 / 8.5、9.4 与 10.1 Web 性能合同执行，Web 功能/性能门禁尚未通过，**无默认切换依据**，故 10.3 **不可勾选**。
- **历史开放任务（Gate 6.3 专项 approve 前）**：**6.3 / 7.4 / 8.1 / 8.2 / 8.5 / 9.2 / 9.4 继续开放**；**11.1 / 11.3 / 11.4 / 12.1 亦开放**；**10.1 / 10.2 / 10.3 均不可勾选**。1.4 / 4.2 的原生运行要求已 `CANCELLED`/`REPLACED` 为 `compat-static`。
- **当前开放任务**：**7.4 / 8.1 / 8.2 / 8.5 / 9.2 / 9.4** 继续开放；**11.1 / 11.3 / 11.4 / 12.1 亦开放；10.1 / 10.2 / 10.3 均不可勾选**。6.3 已在正式 Web-only 范围关闭；1.4 / 4.2 的原生运行要求仍为 `CANCELLED`/`REPLACED` 的 `compat-static` 静态门。
- **范围约束**：Node/Web 证据不得被包装为平台 SLA 或原生运行时证据；移动端静态兼容证据必须标注 `[evidence:compat-static][target:ios|android][executor:linux]`。

### 10.6 阶段 6.3 文本 shaping provider 子阶段与后续验证（proposed；6.3 仍 OPEN）

> **当前状态 supersession / closure note**：本节标题和下文的 `proposed`、`OPEN`、`BLOCK` 描述均为
> Gate 6.3 专项 attempt 3/3 APPROVE 前的历史规划与阻断记录，必须保留以供审计；其当前状态已被
> `verification/task-6.3-web-safe-geometry.md` 的 Web-only 关闭结论取代。不得将该关闭外推为 native
> shaped run、native/全平台运行、7.4、8.x、9.4 或 10.x 完成。

> 本节记录 Gate 6 attempt 3 BLOCK 之后新增的**文本 shaping provider 子阶段**及其**后续必须的验证**，
> **不表示该子阶段已实施或已验收**，也不改变 **6.3 OPEN** 的状态。契约细节见
> `decisions/task-6.3-safe-geometry-program.md` 第 3.10–3.18 节。

- **缺陷背景**：Oracle 最终复审发现**巨大 partial text** 在 `contentVisible=false` 时**不绘制**，
  但其 **resource polygon 仍可 hit**，构成 render / hit 分歧，故拒绝关闭 6.3。
- **淘汰旧模型**：淘汰 `contentVisible` 布尔与 resource box 语义 hit 并存的旧模型；文本 render 与
  hit **MUST** 由**同一份文本语义 region** 决定；`empty` 文本**无 render、无 hit**。
- **两阶段契约**：core 侧为**纯** `FrameTextLayoutRequest`（无 Skia / DOM / CanvasKit，不做 shaping）；
  Web ready shaped run provider 产出**纯已解析** `ResolvedFrameTextProgram`（shaped run / glyph、
  语义 region、render clip 与 hit 共用数据），只读 / 冻结 / 随帧重建 / 不持久化。Skia 只消费它。
- **完整 Paragraph 与重基证明**：shaping 基于**完整 Paragraph**（`ParagraphBuilder` +
  `Paragraph.getShapedLines()`，CanvasKit 0.41.0），并须证明 `start` / `left` alignment、
  **no-soft-wrap** 与**重基只做平移、不改变 shaping 结果**；**禁止 substring 重新 layout**。
- **缓存 / 空闲 / 分块**：采用文本 / 字体 / 宽度**修订缓存**与**空闲重建**；**超大文本分块继续
  生成** shaped run，chunk 边界不得改变 shaping 语义。
- **run 消费与预算**：Skia 用 `TextBlob` / `Glyphs` 实际消费 shaped run；glyph / run / shaping /
  缓存预算显式有界；缺字（`.notdef`）可诊断，跨多 typeface 的 run 携带各自 typeface 标识。
- **加载边界（零新依赖）**：Web-only shaping provider 只能在 `src/skia` 子路径、并在
  `LoadSkiaWeb` 成功之后调用；包根 barrel 不导出；**不得顶层 `import` canvaskit**；
  经 RN Skia web `JsiSkParagraph` 的 `.ref` 做能力探测；CanvasKit `ShapeText` 在本版本实测坏、不可用。
- **非 native 限制**：`getShapedLines` 与 Web shaping provider **仅 Web 生效**，**不作为 native
  验收含义**；native 只保留 `compat-static`，不得宣称 native shaped run。
- **后续必须的验证（尚缺合适字体资源，因此未执行、不得勾选）**：必须在**真实 Web CanvasKit**下、
  以 **dSF1 与 dSF2** 覆盖 **CJK、emoji、Arabic（RTL / 连写）与 combining（组合字符）**；
  这些用例**需要提供合适的字体资源**（含覆盖 CJK / emoji / Arabic 的字体与浏览器字体上下文），
  否则**不构成** shaping 证据。验证须同时证明：render clip 与 hit 语义 region 共用同一
  `ResolvedFrameTextProgram`；`empty` 文本无 render / hit；`pending` 有界且可转为
  `resolved` / `unresolved`；缺字与多 typeface 不产生 render / hit 分歧。
- **边界**：本节为 proposed 验证计划；**6.3 仍 OPEN**，阶段 6 整体不得标闭合；不得据此宣称
  native shaped run、默认路由切换、retry、资源编辑、legacy 重写、schema/chunk、R-tree、offscreen 或性能门。

### 11. 数据兼容与迁移语义

- 内部规范模型统一为 V2（`schemaVersion: 2`）；读取时对 V1 与 V2 持久化数据都做规范化，V1 按既有 `migrateStroke` 语义升级到 V2，任何迁移 MUST NOT 丢弃或误解已有绘制内容。
- 公开类型收敛到以 V2 为基准，减少 `DrawingStroke | DrawingStrokeV2` 式双形状分支；未知可选字段必须容忍（满足 spec「未知可选字段」）。
- 图片 `src` 的既有取值形态保持不变，作为持久化兼容的一部分。

### 12. Skia 渲染器隔离与依赖边界

- Skia 只能从 `@hamster-note/painting/skia` 子路径使用；包根 barrel MUST NOT 导出 Skia 相关实现，避免 DOM/SVG legacy 模块图与 Skia/CanvasKit 模块图相互污染。
- Web 端 MUST 仅在 `LoadSkiaWeb` 成功之后才动态 `import` Skia 模块；Skia Web 入口模块位于 Expo Router app 之外，不得作为全局 Router 启动门闩（与第 8 节一致）。
- 该子路径边界同时是 native 模块图的隔离边界：iOS/Android 路由不得经由根 barrel 进入 Skia/DOM 实现。

## Risks / Mitigations

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| CanvasKit 本地资源加载失败或体积过大 | Web 端首次可用性依赖本地资源；资源缺失会直接导致不可绘制 | 本地打包资源 + 可见失败反馈 + 用户重试；有限期 legacy SVG 回退；门禁通过前不宣称默认就绪 |
| 单画布约束被破坏 | 迁移期若 legacy 与 Skia 并存，可能同时挂载两个画布 | 切换时先卸载旧画布；以门禁检查「任一时刻至多一个活跃生产画布」 |
| 手势语义迁移回归 | 用自包含 GestureSession 替换 multi-drag，尺子吸附、抓取偏移、取消处理等易回归 | 保留 `CONTEXT.md` 领域语义为验收依据；会话状态机纯逻辑可单测；**Web** E2E 覆盖关键手势 |
| 精度问题（超大坐标/缩放） | 持久 f64 absolute global 在极大坐标下 ULP 变粗；f32 输入在不同量级可分辨粒度不同；剔除性能随对象数恶化 | 持久点保持 f64 absolute global DIP；6.3 每帧瞬态 camera-origin rebasing（render/hit 同 origin、单一最终 affine）；f32 输入预算按量级约束（`1e6` 约 `0.0625 DIP`），超大几何裁剪/分段而非 clamp；f64/f32 各自边界以真实 **Web** 验证后置（10.1） |
| 文本/图片在 Web 缺席 | Web 文本编辑或导入可能被省略为 no-op | Web 为正式验收面且必须有真实行为；资源加载失败可见；不支持的替代必须显式 |
| 持久化数据被误读/丢失 | V1/V2 并存与图片 `src` 兼容 | 统一 V2 规范模型 + 读时迁移；未知字段容忍；用既有 fixture 做兼容回归 |
| 高频 transient 污染 document/history | 逐帧状态进入受控 value 会触发持久化与重渲染 | document 与 transient 严格分离；transient 走非 React 状态载体，手势结束才提交 |
| 迁移期 scope 膨胀 | 一次性重写风险高 | 阶段化迁移 + 回滚点 + 门禁驱动，legacy 删除后置 |

## Phased Migration, Rollback & Acceptance Gates

### 阶段划分（每阶段可独立回滚）

1. **Spike 与骨架**：Expo SDK 57 + Metro + Expo Router 骨架跑通 **Web 正式运行**，并保留 **iOS/Android `compat-static` 静态兼容**；完成超大坐标/性能 spike 与空间索引选型。产出可回滚的独立实验分支。
2. **纯核心层抽取**：把 V2 模型、几何、命中、viewport、空间索引与 GestureSession 收敛为无 DOM/无 RN/无 Skia 的核心层，并让其通过现有行为测试。
3. **InputAdapter 与多指替换**：接入 Web/Native InputAdapter，彻底移除 multi-drag/core 运行时依赖，手势语义对齐 `CONTEXT.md`。
4. **Skia 绘制面**：世界层/屏幕层分层落地，单一 viewport matrix，文本/图片资源跨平台实现；CanvasKit 本地加载与失败/重试。
5. **门禁与 Web 默认可切换**：**Web** 功能与性能门禁通过后，Skia 成为 **Web** 默认绘制面；legacy SVG 仅在未通过门禁前作为有限期回退（7.4）。
6. **稳定期与 legacy 删除**：稳定周期后删除 legacy SVG 实现与回退路径，移除不再需要的 Vite 运行时。

### 回滚点

- 每个阶段以 feature flag / 分支为单位，可退回上一阶段的可用状态。
- 在门禁通过前，legacy SVG 回退是唯一允许的降级路径，且必须可见；回退不得与 Skia 并存。
- 核心层抽取阶段保留对外 API 兼容 shim，避免调用方被迫同步改造。

### 验收门（与 proposal/spec 对齐）

- **运行时门（Web 正式 + 移动静态）**：**Web** 能启动到可交互绘制面；Web CanvasKit 从本地资源加载，无外部 CDN 依赖；加载失败可见且可重试。**移动端仅要求 `compat-static`**（根 typecheck、`expo export --platform ios|android`、native Jest/RNTL 最小挂载），**不要求**原生运行。
- **单画布门（Web）**：Web 任一时刻至多一个活跃生产画布，切换不并存。
- **几何门**：单一 viewport 变换、DIP 单位、世界/屏幕分层、渲染与命中一致、视区过滤不改变可见结果。
- **手势门**：无 multi-drag 运行时引用；笔单指/二指导航仲裁、指针取消干净终止；尺子抓取偏移与 45° 吸附、双指刚体变换（**仅平移 + 旋转，不缩放**，无形变）；选区移动/缩放/旋转以世界坐标锚点为准。
- **数据门**：既有 V1/V2 文档与图片 `src` 可读且内容不丢失；未知可选字段被容忍。
- **资源门（Web 正式）**：**Web** 文本编辑与 Web 图片导入有真实行为且无静默 no-op；资源加载失败可见。原生 UI 保留开发但不做自动验收。
- **安全几何门（6.3 继续）**：partial curve/ellipse、复杂/自交闭合路径、contour cap 与完整 f32 预算 MUST 完成，**不得**因 Web-only 范围降级为「不支持」。
- **性能门（Web）**：按**已批准 Web 性能合同**（见 10.5）在 Web 采集并据此决定 Web 默认启用 Skia 及 legacy 删除时机。

### 阶段 5（Skia 渲染面）证据状态

Gate 5 已由 `verification/task-5-phase-5-skia-rendering.md` 和阶段 5 闭合记录证实通过；其中真实 CanvasKit Web fixture 覆盖八类对象、glyph、图片像素、顺序、overlay、affine 与 dSF 1/2。iOS / Android 仅有静态 `expo export`，**范围修订后**该静态结果仅为 `compat-static`，任务 1.4 / 4.2 的原生运行要求已 `CANCELLED`/`REPLACED`，未被 Gate 5 替代。

### 验证所有者

- 本设计的验证所有者是**父 orchestrator**；本工件不执行实现，也不替代后续实现阶段的验证。
