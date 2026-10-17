# Spec Delta

## Purpose

规定 Skia 绘制面在文档读取、坐标系统、几何契约与交互叠层上的统一行为：兼容读取既有 V2 绘制数据，以单一 viewport 变换承担世界坐标平移缩放，使用设备无关像素单位，分离世界层与屏幕恒定叠层，保证绘制与命中几何一致，并遵守视区过滤。**正式功能与性能验收面为 Web**；原生运行/性能/E2E 不作要求，仅保留 `compat-static` 静态兼容。

## ADDED Requirements

### Requirement: V2 兼容读取

绘制面 MUST 读取既有 V2 绘制模型数据，MUST 保留可读字段与语义，MUST NOT 因迁移而丢弃或误解已有绘制内容。

#### Scenario: 读取 V2 数据

- **WHEN** 绘制面加载一份已有的 V2 绘制文档
- **THEN** 文档中的绘制对象被完整解析并可被继续渲染与编辑

#### Scenario: 未知可选字段

- **WHEN** V2 文档包含当前实现未使用的可选字段
- **THEN** 读取过程不报错，已知字段仍被正确保留

### Requirement: 单一 viewport 变换

世界坐标的平移与缩放 MUST 由单一 viewport 变换统一承担，MUST NOT 在多个层级重复应用世界变换。

#### Scenario: 平移与缩放

- **WHEN** 用户平移或缩放视图
- **THEN** 世界内容通过同一个 viewport 变换整体变换，不存在重复叠加的变换

#### Scenario: 变换合成

- **WHEN** 连续执行多次平移与缩放
- **THEN** 结果等价于在该单一 viewport 变换上的合成，不存在额外变换层

#### Scenario: 唯一仿射与 Skia 映射

- **WHEN** 世界内容交给渲染器
- **THEN** 只在单一 world Group 上应用一次 world→screen 仿射，采用 `screenX=a*x+c*y+tx`、`screenY=b*x+d*y+ty`，并映射为 Skia Matrix3 行主序 `[a,c,tx,b,d,ty,0,0,1]`；不存在 CSS/SVG/对象上的重复世界变换

### Requirement: DIP 单位

几何与样式尺寸 MUST 使用设备无关像素（DIP）作为逻辑单位，渲染时必须转换为物理像素，且几何契约本身 MUST NOT 与具体设备像素密度绑定。

#### Scenario: 不同密度下几何一致

- **WHEN** 同一绘制文档在不同像素密度的设备上渲染
- **THEN** 其在逻辑空间中的几何位置与尺寸保持一致

#### Scenario: 逻辑单位存储

- **WHEN** 绘制几何被写入文档
- **THEN** 存储值为 DIP 逻辑单位，而非物理像素

#### Scenario: 应用层不手动换算像素密度

- **WHEN** 绘制面在屏幕 Canvas 上渲染 DIP 布局、world Group、world geometry、overlay 与 input
- **THEN** 应用层不得手动乘 PixelRatio/devicePixelRatio，物理像素 backing store 换算由渲染后端处理

### Requirement: 世界层与屏幕叠层

绘制面 MUST 分离世界层与屏幕恒定叠层，世界层随 viewport 变换，屏幕叠层 MUST 保持屏幕恒定尺寸与方向。

#### Scenario: 叠层不随缩放改变

- **WHEN** 用户缩放视图
- **THEN** 屏幕叠层元素的屏幕尺寸与方向保持不变，而世界层内容按 viewport 变换

#### Scenario: 叠层不随平移漂移

- **WHEN** 用户平移视图
- **THEN** 屏幕叠层保持在屏幕上的固定位置，不跟随世界平移漂移

#### Scenario: overlay 空间标签

- **WHEN** 绘制面描述一个叠层
- **THEN** 该叠层携带 `space: 'world' | 'screen'`，且两者都是 world Group 之后的 identity siblings

#### Scenario: world overlay 的尺寸语义

- **WHEN** 用户缩放视图
- **THEN** world overlay 仅将 anchor/vertices 投影到屏幕坐标，线宽、marker 与 dash 保持屏幕 DIP 不缩放；screen overlay 的位置、方向与尺寸在屏幕上恒定

### Requirement: 渲染资源注入

渲染器 MUST 只消费已就绪的 `fontManager`、`fontFamily` 与 `getImage(src)` 资源句柄，MUST NOT 承担资源加载、权限、缓存或重试职责。文本 MUST 渲染真实 glyph（含 fontSize/color/基础多行/clip/rotation）；图片 MUST 渲染真实 SkImage 像素（含 fill、fallback descriptor rect 与 rotation）。

#### Scenario: 同步消费已就绪资源

- **WHEN** 渲染器收到文本或图片对象
- **THEN** 它使用注入的 ready `fontManager`/`fontFamily`/`getImage(src)` 同步绘制真实 glyph 或真实 SkImage 像素，而不触发加载、权限、缓存或重试

#### Scenario: 图片像素不可用时回退

- **WHEN** 图片像素不可用
- **THEN** 渲染器绘制 fallback descriptor rect，而非静默空白

### Requirement: 绘制与命中几何一致

同一绘制对象用于渲染与用于命中测试的几何 MUST 一致，MUST NOT 出现视觉位置与可点击位置相互偏离。

#### Scenario: 视觉与命中对齐

- **WHEN** 用户对某个可见绘制对象执行命中操作
- **THEN** 命中判定使用与其渲染相同的几何，结果与视觉位置一致

#### Scenario: 变换后仍一致

- **WHEN** viewport 发生平移或缩放
- **THEN** 渲染几何与命中几何同步变换并保持相互一致

### Requirement: 视区过滤

绘制面 MUST 对不在当前可见视区内的对象进行过滤，且过滤 MUST NOT 改变可见对象的渲染结果或命中结果。

#### Scenario: 视区外对象被跳过

- **WHEN** 存在位于当前可见视区之外的对象
- **THEN** 该对象在渲染或命中处理中被跳过，以降低开销

#### Scenario: 回到视区后恢复

- **WHEN** 用户平移视图使先前视区外的对象重新进入可见视区
- **THEN** 该对象被正常渲染并参与命中，结果与未过滤时一致

### Requirement: 共享 prepared 几何与瞬态绘制帧

渲染、空间过滤与精确命中 MUST 消费同一份 prepared geometry entry。entry MUST 以 document order/index 而非 stroke ID 标识，持有保守的 absolute-global-f64 world bounds；无效 geometry MUST 产生可诊断结果且不得进入渲染、索引或命中候选。

#### Scenario: 重复 stroke ID 不破坏顺序

- **WHEN** 文档中存在重复的 stroke ID
- **THEN** prepared entry 仍按 document order/index 唯一标识，渲染与 topmost hit 的稳定顺序不依赖 stroke ID

#### Scenario: 视区帧使用单一瞬态 origin

- **WHEN** 系统为有限的 layout DIP 和 viewport 构造绘制帧
- **THEN** 它从 layout 四角的 inverse affine 得到 visible-world AABB，以其中心作为仅当前帧的 origin，并只将一个 local-to-screen affine 应用于 Canvas；origin 不写入 document、history 或 onChange

#### Scenario: 远坐标查询恢复全局命中坐标

- **WHEN** 用户对重基后的绘制帧执行屏幕命中
- **THEN** 系统先通过同帧 local affine 的逆变换得到 local 坐标，再加同帧 origin 恢复 global 坐标查询索引，并使用同一 prepared geometry 作精确命中

### Requirement: 裁剪安全片段

对与当前帧可见区域相交但含远大顶点的对象，绘制帧 MUST 生成每帧 local 安全 fragments，MUST NOT 直接跳过对象，MUST NOT 改写或 clamp 持久顶点。渲染与精确命中 MUST 消费同一份 fragments，且裁剪 MUST NOT 通过先平移完整巨大 geometry 实现。canonical `DrawingGeometryDescriptor` MUST NOT 承载裁剪状态。clip region MUST 由有限 layout DIP、cull guard、视觉 outset 与 contour 误差经 inverse local affine 得出。

#### Scenario: 远大顶点对象被裁剪而非跳过

- **WHEN** 对象与当前帧可见世界区域相交，但其 global 顶点远超 f32 安全预算
- **THEN** 系统在 global 空间裁剪 / 分段后产出每帧 local fragments，render 与 hit 使用同一份 fragments，持久顶点不被改写或 clamp

#### Scenario: 开放路径的 pressure 与 dash 连续

- **WHEN** 对开放路径在切割点裁剪
- **THEN** 切割点插值 pressure 并保持 dash 相位连续，不因裁剪重置

#### Scenario: 闭合路径 fill 与 stroke 边界分离

- **WHEN** 裁剪闭合路径
- **THEN** fill 与 stroke 边界分别裁剪，且人工裁剪边不被描边

#### Scenario: 裁剪结果可诊断

- **WHEN** 绘制帧完成裁剪
- **THEN** 结果区分 success / empty / unresolved 且逐条可追踪，并且不宣称无视觉误差

### Requirement: 保守空间索引

核心空间索引 MUST 在 absolute global DIP 坐标中工作，支持跨 cell、负坐标、overflow、dedup、稳定 order 与精确 predicate。索引 MAY 返回 false positive，但 MUST NOT 因 bounds 或 cell 过滤造成 false negative；过大查询 MUST 安全退回精确线性过滤。

#### Scenario: 巨大对象跨越过多 cells

- **WHEN** 对象的 conservative world bounds 覆盖超过每对象 cell 上限
- **THEN** 它进入 overflow bucket，仍参与可见性与命中候选，而非被静默丢弃或改写几何

#### Scenario: 回到原视区

- **WHEN** 视口从对象外部平移回对象所在区域
- **THEN** 该对象重新由索引查询返回，并保持与未过滤情况下相同的渲染和命中语义

### Requirement: 测试分层与证据边界

测试体系 MUST 按运行时环境分层，各层 MUST 使用与其环境匹配的测试器，MUST NOT 将 React Native 与 Skia CanvasKit 混入同一 Jest project；Web/jsdom 环境下的测试结果 MUST NOT 被表述为原生（iOS/Android）证据。legacy DOM/SVG 测试 MUST NOT 在等价覆盖到位前直接删除；legacy 实现及相关 DOM/SVG 测试的退役 MUST 与 11.1 legacy 实现的稳定期退役在**同一变更**中发生。**原生运行/E2E 不作验收要求**，移动端证据 MUST 仅为 `compat-static` 静态兼容证据。

#### Scenario: 分层测试互不混用

- **WHEN** 建立 pure Node core、Web 组件、RN 组件、独立 Skia CanvasKit 与 Web E2E 各层测试
- **THEN** 各层在各自独立的环境中运行，React Native 与 Skia 不在同一 project，且任一层不以另一层环境冒充

#### Scenario: Web/jsdom 结果不冒充原生

- **WHEN** 使用 jsdom + `react-native` mock 或 Web 组件测试得到通过结果
- **THEN** 该结果仅作为 Web/组件层证据，不得声称覆盖 iOS/Android 原生行为

#### Scenario: legacy 测试先替代后退役

- **WHEN** 计划移除依赖 DOM/SVG 的 legacy 绘制面测试
- **THEN** 必须先由 core、当前 Web 组件或正式根 E2E 提供等价覆盖，覆盖到位后才允许退役，不得直接删除；退役 MUST 与 11.1 legacy 实现的稳定期退役在**同一变更**中发生
- **AND** 每个退役的 legacy DOM/SVG 测试 MUST 逐条/按能力映射到 core、当前 Web 组件或正式根 E2E 的等价覆盖
- **AND** 保护活跃 `/legacy` 或当前 Web 组件的 jsdom 测试可以保留；不得要求仓库零 jsdom/SVG 字符串

#### Scenario: 移动端证据仅为静态兼容

- **WHEN** 引用移动端兼容证据
- **THEN** 该证据 MUST 标注为 `[evidence:compat-static][target:ios|android][executor:linux]`，仅为静态目标导出/typecheck/RNTL 最小挂载结果，不得表述为 iOS/Android 平台运行、触控、手势、Skia、IME、picker、权限或性能证据

### Requirement: 验收证据标注与不可外推

验收证据 MUST 携带明确的平台/目标/执行者标签；**Web/Node 证据** MUST NOT 被外推为原生证据；**移动端 `compat-static` 证据** MUST 标注 `[evidence:compat-static][target:ios|android][executor:linux]` 且 MUST NOT 被表述为平台运行或性能通过。本地 Node 性能数字 MUST NOT 被表述为跨平台 SLA 或平台性能门通过依据。**正式验收面为 Web**。

#### Scenario: Web 证据标签

- **WHEN** 引用一条 Web 功能或性能证据
- **THEN** 该证据携带平台（web/node）、机器（host 或设备）与构建（commit/build id）标签；缺任一标签的证据不得作为 Web 验收依据

#### Scenario: 移动端静态兼容标签

- **WHEN** 引用一条移动端兼容证据
- **THEN** 该证据 MUST 为 `[evidence:compat-static][target:ios|android][executor:linux]`，仅表示静态目标导出、typecheck 或 RNTL 最小挂载，不得称为平台运行证据

#### Scenario: 不可跨平台外推

- **WHEN** 只有 Node 本机或 Web 本机的证据
- **THEN** 该证据不得被表述为 iOS/Android 平台运行或平台对等的验收证据

#### Scenario: 本地性能仅为同机预警

- **WHEN** 引用 `100k / 16 queries / 确定性生成器 / 同机` 的 Node 索引计时
- **THEN** 它仅作为同机回归预警，不被表述为 SLA，也不得外推到 Web CanvasKit 或原生平台

#### Scenario: 原生运行不再作为验收门

- **WHEN** 当前环境缺少 iOS/Android 设备或模拟器
- **THEN** 原生运行/性能/E2E **不作为验收 MUST**（已 CANCELLED/REPLACED）；移动端只保留 `compat-static` 静态兼容门，且不得以 Node/Web 证据冒充原生运行
