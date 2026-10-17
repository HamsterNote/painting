# 任务 6.3 规划决策：Safe Geometry Program（proposed；实施前置依赖兼容 spike）

- 变更：`migrate-expo57-skia-surface`
- 任务：**6.3「按 2.3 的决策落地坐标策略 + 安全几何支持」**
- 工件类型：**规划 / 决策文档（proposal 级）**，可审计、可追溯
- 决定时间：2026-09-25
- 验证所有者：**父 orchestrator**
- 状态：**PROPOSED / 尚未实施**；本文件**不勾选 6.3**、**不关闭阶段 6**、**不修改 `tasks.md`**
- 写入范围：仅本决策文件与 `.slim/deepwork/migrate-expo57-skia-surface.md` 的状态回填。
  **未修改产品源码、测试、`tasks.md`、`package.json`、lockfile、CI 或既有验证报告。**

> 本文件是 6.3 剩余安全几何能力的**实施方案骨架**，用于承接既有 Oracle P0 预审决策
> （见 `design.md` 第 10.2 节、`verification/task-6-phase-6-geometry-indexing.md`）
> 与范围修订决定（`decisions/web-only-acceptance-scope.md`）。
> 它**不**声称任何能力已实现或已验收，**也不**替代 Gate 6 的整体门禁。

---

## 1. 依据与范围修订（不得误读）

1. **正式产品验收面为 Web-only**（`decisions/web-only-acceptance-scope.md`）：
   功能、性能、E2E 的正式验收面为 **Web**；原生 iOS/Android **只保留 `compat-static` 静态兼容门**。
2. **原生运行不再作为 6.3 的验收 MUST**：原「缺 iOS/Android 真实运行证据」要求已
   `CANCELLED`/`REPLACED`，**不再阻塞 6.3**。`expo export`、Node/Jest、Web CanvasKit
   均**不得**被包装为原生运行时证据。
3. **安全几何支持继续完成、不得降级**：partial cubic / ellipse、**复杂或自交闭合路径**、
   **contour cap**、以及**完整 f32 预算**的全链路证明 **MUST 继续完成**；
   **禁止**因 Web-only 范围而把它们降为「不支持」。
4. **6.3 保持 OPEN**：本方案是**实施前**的规划，**不能**作为勾选 6.3 的依据；
   阶段 6 **整体不得标闭合**。
5. **Gate 6 attempt 3 BLOCK 与新子阶段**：Oracle 最终复审因**文本 render/hit 分歧**
   （`contentVisible=false` 不绘制但 resource polygon 仍可 hit）**拒绝关闭 6.3**。
   据此新增**文本 shaping provider 子阶段**（见 3.10–3.18），并以 `design.md` 10.6 记录
   后续必须的 dSF1/2 CJK/emoji/Arabic/combining 验证（需提供合适字体资源）。
   本文件**不改变任务状态**。

---

## 2. 现状盘点（现有实现与 unresolved 的**真实原因**）

现有帧级裁剪（`core/frameClipping.ts`）在无法**安全**表达时返回
`status: 'unresolved'` 且 `fragments: []`，从而**如实不渲染、不参与命中**
（renderable 集合排除它，仅保留诊断）。当前 `FrameClippingDiagnostic['reason']` 取值与成因如下：

| reason | 触发点（现状） | 本质原因 |
| --- | --- | --- |
| `unsafe-number` | 顶点绝对值超过 `Number.MAX_SAFE_INTEGER`；global region 或 local 结果非有限 | 超出安全整数 / 有限性预算，无安全几何表达 |
| `partial-curve-or-ellipse` | cubic / ellipse 需要与裁剪区求交，但当前仅实现了「完全包含才成功」 | **缺少 curve/ellipse 与裁剪区的安全细分求交 + cap 策略** |
| `complex-closed-path` | 闭合 path **自交**（`selfIntersectingClosedPath`）或**非凸**（`!convex`） | 缺少闭合路径的**非零环绕填充**下的安全裁剪与命中表达 |
| `contour-deviation-not-met` | 近似 contour 的 `capped` 或 `!isWithinRequestedMaxDeviation` | **contour cap** 偏差超预算时无安全 fallback，只能 diagnostic |
| `partial-resource-box` | 旋转 text/image box 与 clip 区的浮点退化/非凸交集 | 资源 box 只在**有面积的凸交集**下成立；退化拓扑无安全表达 |
| `invalid-geometry` | descriptor 与工具不匹配 / 边界点缺失 | 输入无关的非法几何，属防御性诊断 |

此外，`DrawingFrameDiagnostic.type` 另有 `requires-clipping`（`requiresClipping` /
`unsafeEntryKeys`）语义：表示对象与视口相交但含远大顶点、当前**尚未**完成裁剪/分段，
**不得**据此宣称完整 6.3 已满足。

**已实现且已验证的局部能力**（`verification/task-6-phase-6-geometry-indexing.md`「6.3 局部能力补充」）：
受控 **partial text/image 资源 box 裁剪**（凸交集、有面积才成功，render/hit 共用同一 fragment）。
它**不**覆盖 partial cubic / ellipse、复杂自交 / 非凸 closed path、contour cap、完整 f32 预算，
因此**不**构成 6.3 关闭依据。

---

## 3. 方案骨架（proposed）：Safe Geometry Program

核心主张：把「每帧每个对象的安全几何」提升为**一个显式、可验证、只读的几何程序**，
取代当前零散的 fragment 分支作为 6.3 的收敛目标。**以下是提案，均未实施。**

### 3.1 三道子门（core → Skia → Web）

提案把 6.3 的实现与验收拆为**串行、逐层加严**的三道子门，缺一不可：

1. **core 子门（纯 core，无 DOM / RN / Skia）**
   - 在 `global f64` canonical geometry 上完成安全裁剪 / 分段 / 求交，产出 **FrameGeometryProgram**。
   - 程序必须**确定性**、**只读**、可在 Node 直接单测；不依赖 Skia 运行时。
   - 覆盖：partial cubic / ellipse、复杂或自交闭合路径、contour cap、resource 巨大几何。
2. **Skia 子门（Skia frame 消费）**
   - `skia` 层**只读**消费 FrameGeometryProgram，映射为 Skia path / fill / stroke / clip。
   - 保证 compound fill **一次 paint**、stroke 与 clip 边分离（见 3.4 / 3.5）。
   - 不得在 Skia 层重新解释或重建几何（不产生 render/hit 分歧）。
3. **Web 子门（真实 CanvasKit Web E2E）**
   - 在**真实 Web CanvasKit** 下验证可观察行为：像素信号、命中探针、diagnostics、dSF1/dSF2。
   - 原生运行**不**在此子门、**不作为** 6.3 验收要求。

> 三子门是**增量加严**关系：core 子门失败则不得进入 Skia / Web；Web 子门只在其上作观察，
> **不得**用 Web 观察反推 core 算术正确性。

### 3.2 canonical nonzero fill（填充规则权威）

- 采用 **nonzero（非零环绕）** 作为 **canonical fill 规则**，与 Skia / SVG 默认一致。
- **render 与 hit 必须共用同一 fill 规则**：命中判定（内部/外部）与渲染填充用同一
  FrameGeometryProgram 的环绕语义，**不得**出现「渲染 nonzero、命中 even-odd」的分歧。
- 现有 hit 侧的 even-odd 判定属于**迁移前遗留**，在本方案下需被 nonzero 语义统一
  （**这是行为变更，必须由兼容 spike 先行验证**，见第 5 节）。
- 自交 / 复杂闭合路径只在 nonzero 语义下定义「哪些区域被填充」；这使 `complex-closed-path`
  有明确、可验证的语义，而非「无法表达」。

### 3.3 对象级 FrameGeometryProgram

- 每帧、每个（可见）对象产出**恰好一个** `FrameGeometryProgram`（对象级），
  内含：canonical 来源引用、frameOrigin、安全裁剪后的几何、fill/stroke 计数、
  偏差预算与 diagnostics。
- **对象级**（而非全局级或临时 fragment 级）保证：
  - render 与 hit 消费**同一个** program 实例；
  - program **只读 / 冻结**，帧重建、**不持久化**、不进 document / history / `onChange`；
  - 诊断可按对象逐条追踪，`success` / `empty` / `unresolved` 语义保留。
- `DrawingGeometryDescriptor` 仍为**纯语义**描述，**MUST NOT** 内嵌裁剪状态 / origin / safety。

### 3.4 compound fill 一次 paint

- 复合轮廓（compound path，含多 contour / 带洞闭合区域）的填充必须在**一次 paint** 内完成，
  以 nonzero 环绕一次成面；**禁止**用多次 paint 叠加模拟填充（会引入 overdraw、alpha 叠加错误、
  以及非零环绕语义偏差）。
- 命中侧使用同一 program 的 compound 拓扑判定内部。

### 3.5 stroke 与 clip 边分离

- **MUST NOT stroke 人工 clip edge**：裁剪产生的边界是**实现产物**，不得被当作可描边边界，
  否则会出现视觉上不存在的边线（现有 `design.md` 10.2 已定死此约束，本方案沿用并加严到 program 层）。
- program 内显式区分：
  - **原始 stroke 边界**（来自 canonical geometry，可描边）；
  - **clip 边**（帧级派生，仅用于 fill/clip 限定，**绝不**进入 stroke 集合）。

### 3.6 render / hit 只读同一 program

- render 与 hit **MUST** 只读同一份 FrameGeometryProgram，**绝不**各自重建几何或产生不同片段。
- 这是「共享几何/命中同一来源」（6.1 已建立）在 6.3 安全几何下的延续与强化。

### 3.7 screen-space deviation（屏幕空间偏差预算）

- 几何近似（curve 细分、contour 近似）的**偏差容差以屏幕空间 DIP 定义**，而非世界空间常量。
- 容差经 **归一化 affine 的绝对行和**映射到 local / global 预算（沿用 `visualClipRegion`
  的 normalized affine 做法），保证在旋转 / 剪切与 `.25 / 1 / 8` scale 下语义一致。
- `contour-deviation-not-met` 只有在**屏幕空间**偏差仍超预算时才是合法诊断；
  不得用世界空间常量误判。

### 3.8 local / f32 输入预算（全链路）

- 预算覆盖：local 坐标、matrix（a/b/c/d）、linear product（`a*x` / `c*y` / `b*x` / `d*y`）、
  translation（tx/ty）、screen 坐标，以及 style / text / image 的输入数值；
  任一环节越界即 **unsafe**，需裁剪或诊断，**不得静默截断**。
- **禁止先 translate 完整巨大 geometry**：裁剪 / 分段必须在 translate 前（或等价地）在 global 空间完成；
  绝不 clamp / 改写持久顶点；绝不因超大而跳过对象。
- `1e6 / 0.0625 DIP` 仍只是 **f32 输入预算**，不是视觉 / CanvasKit / 完整 affine 误差。

### 3.9 resource 巨大几何仍需安全方案（**仍 MUST 完成**）

- 与视口相交、但 text/image 资源矩形框含**远大顶点/超大坐标**的情形，
  **仍 MUST 有一个安全方案**（在 program 内裁剪 / 分段并给出 resource clip），
  **不得**仅因「resource box 语义」或「Web-only」而降级为不支持。
- 现有「凸交集才有面积才成功」只是**受控局部能力**，超大 / 退化拓扑路径**仍待安全表达**。

### 3.10 文本 geometry 致命缺陷：淘汰 `contentVisible` 布尔与 box hit 并存

> 本轮新增。背景：Oracle 最终复审（Gate 6 attempt 3 BLOCK）发现**巨大 partial text** 在
> `contentVisible=false` 时**不绘制**，但其 **resource polygon 仍可 hit**，即同一文本对象
> 出现「不渲染却可命中」的 render/hit 分歧。该缺陷**必须**在 6.3 内修复，**不得**被忽略。

- **淘汰旧模型**：`contentVisible` 布尔与「resource box 语义 hit」并存的旧文本模型被**淘汰**。
  文本的 render 与 hit **MUST** 由**同一份文本语义 region** 决定；**禁止**再出现
  「不可见但仍可 hit 的 box」，也**禁止**「可见但不可 hit」。
- `contentVisible`、raw resource polygon 均**不得**再作为独立的 hit / render 依据。
- 该淘汰是**行为变更**，其回归影响必须由兼容 spike 先行验证（见第 5 节）。

### 3.11 两阶段文本契约：Core 纯请求 + 已解析程序

- **阶段 A（core，纯）**：`FrameTextLayoutRequest` —— **纯数据、无 Skia / 无 DOM / 无 CanvasKit**，
  描述 frame-local 文本布局请求：canonical 文本、字体族 / 字号 / 颜色、换行宽度、对齐
  （`start` / `left`）、frameOrigin / rebase、局部裁剪 region、预算与 diagnostics。
  core **不做 shaping**、**不导入 Skia**。
- **阶段 B（Web ready）**：`ResolvedFrameTextProgram` —— 由 **Web ready shaped run provider**
  消费 `FrameTextLayoutRequest` 产出的**纯已解析**程序：真实 shaping 后的 run / glyph
  （含 advance / offset、typeface 标识）、文本语义 region、布局尺寸，以及 **render clip 与
  hit 共用的数据**。
- **边界**：`ResolvedFrameTextProgram` 一旦产出即**只读 / 冻结 / 随帧重建 / 不持久化**、
  不进 document / history / `onChange`；Skia **只消费**它，**不得**自行重排、重 shaping 或重建几何。

### 3.12 完整 Paragraph + 证明重基 / no-soft-wrap

- shaping **MUST** 基于**完整 Paragraph**（而非裁剪后的子串），使用
  `ParagraphBuilder` + `Paragraph.getShapedLines()`（CanvasKit 0.41.0）导出真实
  HarfBuzz / ICU shaped runs。
- **证明要求**：必须有证据证明 `start` / `left` alignment、**no-soft-wrap**
  （宽度 / `maxLines` 不触发隐式自动换行，或换行语义显式且单一），以及从 canonical global
  到 frame-local 的**重基只做平移**、**不改变 shaping 结果**（advance / glyph 位置不因
  `frameOrigin` 改变）。
- **禁止 substring 重新 layout**：**MUST NOT** 为裁剪把文本截成子串再重新 layout / shaping
  （会破坏 kerning / ligature / shaping context）。裁剪只允许作用于**已解析 run / glyph 的
  clip 与语义 region**。

### 3.13 文本语义 region 与 render clip / hit 共用

- 文本的**语义 region**（hit 依据）与 **render clip**（绘制裁剪依据）**MUST** 来自**同一**
  `ResolvedFrameTextProgram`、**共用同一数据**；**禁止**分别推导。
- render 与 hit **共用**同 frameOrigin / 同最终 affine；命中探针与像素渲染对同一 region 语义。

### 3.14 empty 文本无 render / hit

- 空文本、纯空白、或 shaping 后**无可见 glyph** 的文本：**既无 render、也无 hit**，
  产出 `empty`。**禁止**保留「不可见但仍可 hit 的 box」。
- `empty` 是**终态**诊断，**不得**被 `pending` 掩盖。

### 3.15 pending 不是永久 fallback

- shaping provider 未就绪（Web 尚未 `LoadSkiaWeb`、字体尚未 ready、空闲重建未完成）时，
  文本可为 `pending`。
- `pending` **不是永久 fallback**：**MUST**有明确的就绪 / 失败 / 超时路径；pending 期间
  **如实不 render / 不 hit** 并诊断，且 **MUST NOT 长期停留**；就绪后**必须**重建为
  `ResolvedFrameTextProgram` 或 `unresolved`。

### 3.16 缓存与空闲 / 分块策略

- **文本 / 字体 / 宽度修订缓存**：以 canonical 文本 + 字体上下文 + 换行宽度 + 对齐等
  **修订键（revision key）**缓存已解析 shaped 程序；**仅在修订变化时**失效重建，
  避免每帧 re-shaping。
- **空闲重建（idle rebuild）**：非关键路径的 shaping 重建放到**空闲时段**，避免阻塞交互帧。
- **超大文本分块（chunking）继续生成**：超大文本**不得整段丢弃**；按 chunk **继续生成**
  shaped run、逐块产出并合并为同一 `ResolvedFrameTextProgram` 语义；**chunk 边界不得改变
  shaping 语义**（不得在 chunk 内重新 layout 子串）。

### 3.17 run 消费、预算、字体与 range 边界

- **实际 run 消费**：Skia 侧用 `TextBlob` / `Glyphs` 实际消费 **shaped run / glyph**
  （非按字符重排），保持 advance / offset 与 shaping 结果一致。
- **预算**：glyph 数、run 数、每帧 shaping / 重建预算、缓存条目数均**MUST**有显式上限；
  超预算按分块 / 空闲处理并诊断，**不静默丢字**。
- **字体缺字 / 多 typeface 范围**：缺字（`.notdef`）**MUST**以可诊断方式呈现；一段文本跨
  多个 typeface（fallback）时，run **MUST**携带各自 typeface 标识，range 语义**MUST**覆盖；
  缺字与多 typeface **都不得**造成 render / hit 分歧。
- **非 native 限制**：`getShapedLines` / Web shaping provider **仅在 Web 生效**；
  **native 无此能力、也不作为 6.3 验收含义**（native 只保留 `compat-static`）。core 两阶段
  契约在 native 上只保证纯请求结构，**不得**宣称 native shaped run。

### 3.18 依赖与加载边界（零新运行时依赖）

- **零新运行时依赖**：**不新增** shaping 库；复用 CanvasKit / RN Skia 既有能力。
- **不得顶层 `import` canvaskit**：Web-only shaping provider **只能**位于 `src/skia` 子路径，
  且**在 `LoadSkiaWeb` 成功之后**才调用；包根 barrel **不得**导出。
- **能力探测**：通过 RN Skia web `JsiSkParagraph` 公开的 `.ref` 做 `getShapedLines`
  能力探测；CanvasKit `ShapeText` 在本版本**实测坏、不可用**，**不得**采用。
- provider 属 **Web-only** 路径，**native 不加载**。

---

## 4. 禁止 PathOps 作为 core 权威（硬约束）

- **禁止**把 Skia PathOps（如 `Path.simplify` / PathOps 布尔运算）作为
  **core canonical geometry 或 render/hit 一致性的权威**。理由：
  1. PathOps 属 **Skia-only**，纯 core / Node 不可用，会破坏「core 为单一几何来源」；
  2. 其结果依赖 Skia **版本 / 后端**，**非确定性**，不能作为可复现的几何权威；
  3. 一旦 render 用 PathOps、hit 用 core，必然产生 render/hit 分歧，
     违背 6.1 / 6.3 的「同一 program」要求。
- 允许的定位：PathOps **至多**作为 **Skia 子门**内部的**可选渲染辅助 / 交叉验证**，
  且**不得**成为命中判定或 core 语义的依据；是否使用须由兼容 spike 明确结论。

---

## 5. 实施前置依赖：兼容 spike（**先 spike，后实施**）

> 本方案**明确仍需依赖兼容 spike 通过后才实施**；在 spike 结论落地前，**6.3 保持 OPEN**，
> **不得**据此方案开始正式实现或宣称能力成立。原「6.3 原生运行证据」要求已 `CANCELLED`，
> 因此 spike 只在 **Web + 纯 core Node** 口径内设计，**不**引入原生运行依赖。

Spike（尚无产物，需新建；建议放于 `spikes/`，仅作事实来源、不导入产品代码）至少回答：

1. **nonzero 语义回归**：把 fill 与 hit 统一到 nonzero 后，既有 V1/V2 fixtures 与既有
   渲染 / 命中用例是否仍语义一致？even-odd 遗留路径的迁移影响范围有多大？
2. **对象级 program 可表达性**：FrameGeometryProgram 能否用**纯 core**表达
   partial cubic / ellipse、自交 / 非凸 closed path、contour cap、resource 巨大几何，
   并保持确定性、可冻结、可诊断？
3. **compound 一次 paint**：真实 Web CanvasKit 对 compound + nonzero 的**一次 paint**
   是否与 core 命中拓扑一致？带洞 / 自交区域的像素结果是否符合预期？
4. **screen-space deviation**：以屏幕 DIP 定义的容差经 normalized affine 映射后，
   在旋转 / 剪切与 `.25 / 1 / 8` scale 下的偏差是否可控且与命中一致？
5. **完整 f32 预算**：对「远顶点 + 超大 resource box」等用例，**先裁剪/分段再 translate**
   能否使 local / matrix / product / translation / screen 全链路 finite 且在预算内？
6. **PathOps 定位**：若 Skia 侧采用 PathOps 辅助，是否能证明其**不影响** core 权威
   与 render/hit 一致性（或应明确不采用）？

**spike 通过前**：不新增正式实现；**6.3 保持 OPEN**；本文件不产生勾选。

---

## 6. 与既有约束的承接关系

- **承接 2.3 坐标决策**：持久点仍为 absolute global f64 DIP；每帧瞬态单一 camera-origin
  rebasing；render/hit 同帧同 origin、单一最终 affine；**绝不 clamp 持久顶点**。
- **承接 6.1 / 6.2**：`PreparedDrawingDocument → DrawingFrame` 的 canonical 共享几何管线
  与 sparse spatial index 不变；FrameGeometryProgram 是 `DrawingFrame` 内安全几何的**收敛表达**，
  不是新增第二套几何来源。
- **承接 design.md 10.2**：不扩张到默认路由切换、retry、资源编辑、legacy 重写、
  schema/chunk、R-tree、offscreen 或性能门。
- **承接范围修订决定**：原生运行验收 `CANCELLED`；**安全几何支持继续 MUST**。

---

## 7. 门禁与验收（proposed；未执行）

若未来实施，验收需按三子门逐层给出证据，且**不得**跨层推断：

| 子门 | 证据形式 | 不得声称 |
| --- | --- | --- |
| core | 纯 Node 单测（几何、命中、program 确定性 / 冻结 / diagnostics） | 不得声称渲染正确 |
| Skia | Skia frame 消费 program 的单测 / 契约测试（compound 一次 paint、clip 边不入 stroke） | 不得声称 Web 像素等价 |
| Web | 真实 CanvasKit Web E2E（dSF1/dSF2、命中探针、diagnostics、像素信号） | 不得声称**无视觉误差**；**不得**声称 native 运行 |

- 三子门**全部**通过**且**兼容 spike 有结论后，才可将 6.3 提交 Gate 6 复核；
  **最终是否勾选 6.3 由 Gate 6 / 父 orchestrator 判定**，本文件无权决定。
- 即使通过，也**不得**宣称阶段 6 整体闭合、legacy SVG 迁移完成或完整裁剪「无误差」。

---

## 8. 明确不宣称 / 边界

- 本文件是 **proposed 规划**：**不**表示任何能力已实现、已验收或已勾选。
- **不**声称 `partial-curve-or-ellipse` / `complex-closed-path` / `contour-deviation-not-met` /
  `partial-resource-box` / `unsafe-number` 已被解决。
- **不**声称完整 f32 预算、dash 相位 / alpha 连续性、alpha-pixel 裁剪已完成。
- **不**声称文本 shaping provider、`FrameTextLayoutRequest` / `ResolvedFrameTextProgram`
  两阶段契约、缓存 / 空闲重建 / 分块策略**已实现**；它们均为 **proposed**。
- **不**声称 `getShapedLines` / Web shaping provider 提供 **native** shaped run；其**仅 Web**，
  **不作为 native 验收含义**。
- **不**声称原生 iOS/Android 运行、触控、性能或 E2E 已验证。
- **不**修改 `tasks.md`；**6.3 保持 OPEN**，阶段 6 整体不得标闭合。

---

## 9. 变更与验证记录

- 本轮写入：本文件（新增第 3.10–3.18 节：文本 shaping provider 两阶段契约）、
  `design.md`（新增 10.6 后续必须验证）与 `.slim/deepwork/migrate-expo57-skia-surface.md`
  （状态回填：6.3 仍 OPEN、Gate 6 attempt 3 BLOCK、新子阶段）。
- **未**修改产品源码、测试、`tasks.md`、`package.json`、lockfile、CI 或既有验证报告。
- 执行 `git diff --check` 与空白检查；验证所有者：**父 orchestrator**。
