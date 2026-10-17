# 阶段 6 验证报告（6.1 / 6.2）：共享几何/命中与空间过滤

- 变更：`migrate-expo57-skia-surface`
- 任务：**6.1、6.2**（本报告只覆盖这两项；**6.3 未关闭**，阶段 6 整体不视为完成）
- 验证所有者：父 orchestrator
- 状态：**例外 Gate 6 P0 复审已批准 6.1 与 6.2 关闭**（用户已授权例外复审；四个 P0 均 resolved）
- 生成时间：2026-09-24
- 写入范围：仅本报告文件。未修改产品源码、依赖、lockfile、测试或 CI；未改动任务 1.4、4.2、6.3 的未完成状态。

## 结论速览

| 任务 | 结论 | 主要证据 |
| --- | --- | --- |
| 6.1 渲染与命中共用同一几何来源，替换 SVG/路径专属几何 | ✅ 通过 | canonical V2 `PreparedDrawingDocument → DrawingFrame fragments → Skia frame renderer / frame hit` 单一管线；core 与 Skia target tests |
| 6.2 建立空间索引并按当前 viewport 可见区域过滤对象 | ✅ 通过 | `SparseSpatialIndex` + `createPreparedDrawingSpatialIndex` + `visibleWorldBounds` 召回；core target tests |

**总体判定：在例外 Gate 6 P0 复审授权下，6.1 与 6.2 通过并关闭。6.3 及其余阶段 6 能力仍未关闭。**

## 例外 Gate 6 P0 复审裁定

- 本关闭基于**用户授权的例外 Gate 6 P0 复审**，而非普通阶段 6 整体门禁。
- 复审确认**四个 P0 均 resolved**，据此**批准关闭 6.1 与 6.2**。
- 该批准**不代表**阶段 6 整体完成：**6.3 保持未完成**，其剩余高级裁剪能力与 iOS/Android 真实运行证据仍为开放项（见文末边界）。

## canonical V2 共享几何管线

阶段 6 的 canonical 数据流为**唯一一条**：

```
V2 document
  → PreparedDrawingDocument（prepareDrawingDocument：每条 stroke 只描述一次 canonical geometry + 保守 global-f64 bounds）
  → SparseSpatialIndex（只保存 absolute global f64 bounds，按 document order 稳定）
  → DrawingFrame fragments（每帧由 canonical global geometry 裁剪/重基出的 local 安全 fragments）
  → Skia frame renderer / DrawingFrame hit
```

- **单一几何来源**：`prepareDrawingDocument`（`core/preparedDocument.ts`）对每条 stroke 恰好调用一次 `describeDrawingStrokeGeometry`；entry 的 `geometry` 是冻结的 canonical descriptor，`key`/`order` 取 document 下标而非 stroke ID（允许重复 ID）。
- **渲染与命中同源**：`createDrawingFrame` 产出的 `renderableEntries` 同时是 renderer 与 hit 的输入。`SkiaDrawingCanvas` 只消费 `frame.renderableEntries` 的 `fragments`（`skia/descriptors.ts` 明确不读取 `entry.geometry`）；`hitTestDrawingFrame` 只使用同一份 `frame.renderableEntries` 的 `fragments` 判定，**不各自重建几何、不产生不同片段**。
- **替换 SVG/路径专属几何**：本阶段后，render 与 hit 不再依赖旧的 SVG/DOM 专属几何路径；两者共享 `DrawingFrameEntry.fragments`（`FrameStrokeFragment` / `FrameSemanticAreaFragment`）。`canonicalLocalGeometry` 与 `geometry` 字段仅为兼容/审计保留，新 renderer 不以它们为渲染或命中输入。
- **范围限定**：该管线为 **pure core + Skia frame 路径**；不涉及 legacy SVG 绘制面迁移，也不代表默认画布切换（默认切换归 7.4，本报告不声称）。

## 空间索引与可见过滤正确性（6.2）

`SparseSpatialIndex`（`core/spatialIndex.ts`）语义：

- **半开 AABB**：`query(bounds)` 采用 `intersectsSpatialBounds`（`minX < maxX && maxX > minX …`），接触边界不算相交；`queryPoint` 采用 `containsSpatialPoint`（`min <= p < max`），点落在 `max` 边上不命中。
- **cell 语义**：默认 256 DIP、可配置；negative floor key；跨 cell；每对象最多 64 cells；超出预算进入 overflow bucket。
- **性能保护不影响正确性**：对象或查询范围过大时回退为**精确线性过滤**，因此保护阈值只影响性能、不影响结果。
- **query 语义**：dedup（Set）、按 `order` 稳定排序；`upsert`/`remove` 活跃；无显式 order 的更新保留原 order。
- **frame 过滤**：`tryCreateDrawingFrame` 先由有限正 layout DIP、cull guard（默认 1 screen DIP）与 inverse affine 求出 `visibleWorldBounds`，再对索引执行 `query(visibleWorldBounds)`；对每个召回条目按 entry 视觉外扩（最大 stroke/pressure 外扩、round cap/join 与 contour 误差）经 inverse local affine 生成局部 clip region。**false positive 可接受，false negative 不可接受**。
- **可见与可绘分离**：`visibleEntries` 为索引召回的候选（含 `empty`/`unresolved`）；`renderableEntries` 只含至少一个可安全消费 fragment 的条目。render 与 hit 都只用 `renderableEntries`。
- **回归证据**：`core/spatialIndex.test.ts`、`core/drawingFrame.test.ts`（视区外跳过、回视区恢复、可见命中不变、`unresolved` 条目不渲染不命中）。

## 四个最终 P0 的解决（例外复审）

1. **pressure end（命中宽度取源端 pressure）**
   - `FrameStrokeFragment.sourcePressures` 始终保存**原始 source segment 两端 pressure**；裁剪交点 pressure 只写入 `clip.insertedPressures` 用于审计。
   - `hitTestDrawingFrame → hitFragments` 对 pen 使用 `fragment.sourcePressures.end` 计算命中半径，**不使用**裁剪插值 pressure。
   - 证据：`drawingFrame.test.ts` — “uses only pen source end pressure for hit width, including a clipped fragment” 与 “keeps source endpoint pressure for a locally clipped pressure segment…”。

2. **semantic boundary + tolerance（语义边界优先 + 容差）**
   - `hitsSemanticArea` 先以 `distanceSquaredToSegment <= tolerance²` 判定**边界命中**（含裁剪生成的语义 ring 边），再以 even-odd 判定填充内部。
   - 命中宽度容差在 core 内由 `toleranceScreenDip / globalToScreen.a` 从屏幕 DIP 换算，保持 scale 语义。
   - 证据：`frameClipping.test.ts` — “hits rotated resource boxes and clipped semantic rings by interior, exact edge, and tolerance”；`geometry.test.ts` — bounds touch → interior → tolerance-outside 三态与 “keeps world tolerance derived from screen DIP at scale …”。

3. **normalized affine clip（归一化 affine 而非原始 viewport.scale）**
   - `visualClipRegion` 使用 `createViewportAffine` 已归一化的线性部分计算 screen-per-world，经 inverse affine 的**绝对行和**把 screen outset 映射为 local AABB，从而在旋转/剪切与 `.25 / 1 / 8` scale 下不漏召回。
   - 仍不得用屏幕矩形直接当 local 矩形；也不得对完整巨大 geometry 先 translate 再交给 f32。
   - 证据：`drawingFrame.test.ts` — “uses normalized global affine scale … for visual clip outset without mutating the viewport”。

4. **variadic run tuple（可变长 run 元组）**
   - `FrameStrokeFragment.points` 类型为 `readonly [GeometryPoint, GeometryPoint, ...GeometryPoint[]]`，至少两点且可表达完整 polyline。
   - `runFragments` 仅合并**连续且都在同一 run 内**的普通路径线段（`previous.index + 1 === segment.index` 且端点相同且未被裁剪），pressure pen 逐段 flush 以保留逐段源 pressure；闭合轮廓单独表达。不会跨裁剪缺口错误桥接。
   - 证据：`frameClipping.test.ts` — closed contour 的 `sourceSegmentStart/sourceSegmentEnd`；`drawingFrame.test.ts` — “coalesces ordinary contiguous paths and closed contours into runs without bridging clipped gaps”。

## 验证命令与结果

| 命令 | 结果 |
| --- | --- |
| targeted Jest（`__tests__/core` + `__tests__/skia`） | **13 suites / 161 tests passed** |
| 全量 `pnpm test` | **47 suites / 867 tests passed** |
| `pnpm typecheck` | **通过（exit 0）** |
| `pnpm lint` | **0 error / 8 known warnings** |
| `pnpm build` | **通过（含库构建与 Expo Web 导出）** |
| `git diff --check` | **通过（exit 0）** |

- targeted Jest 命令：`node_modules/.bin/jest --runInBand packages/painting/src/__tests__/core packages/painting/src/__tests__/skia`，本轮为 **13 suites / 161 tests passed**。
- `pnpm lint` 的 8 个 warning 均为**已知非阻断**：5 个测试 `jest/expect-expect`（`DrawingSurface.test.tsx`×1、`core/viewport.test.ts`×2、`viewport-affine.test.ts`×2）与 3 个 `react-hooks/exhaustive-deps` ref cleanup（`DrawingSurface.tsx`）。
- `pnpm test` / `typecheck` / `lint` / `build` 已于本次复审中重新运行确认，结果与上述一致。

## 真实 Web CanvasKit E2E（fixture）

- **路由**：`/skia-drawing-fixture`（非默认路由；不替代 legacy 画布，也不代表默认切换）。
- **命令**（临时脚本，不提交）：

```bash
python3 /home/zhangxiao/.config/opencode/skills/webapp-testing/scripts/with_server.py \
  --server "pnpm --dir apps/playground run dev:web" \
  --port 5266 --timeout 90 \
  -- python3 /tmp/opencode/phase6_skia_clipping_e2e.py
```

- **观察结果**：
  - 本地 `LoadSkiaWeb` 载入同源 `canvaskit.wasm`（**200 `application/wasm`**，无外部 CDN）；资源就绪文案确认 **FixtureSans 真实 glyph** 与 **96×64 程序生成 PNG 真实像素**。
  - **dSF1 / dSF2** 两个 `device_scale_factor` 均通过；画布截图中文本深蓝 glyph 像素与 PNG 区域彩色像素多样性达标。
  - **topmost hit**：重叠中心点击命中 `key=10 order=10`（后绘制者在上层），由 `hitTestDrawingFrame` 与 render 共用同一 frame 得出。
  - **giga / rebase**：跳转至 `1e9 + 0.125` 与 `-(1e9 + 0.125)` 后 `frameOrigin` 改变且可见集非空，同帧 hit 有明确结果；跳转后 screen marker 画布像素边界不变，证明该 overlay 不随 world/frame 移动。
  - **clip / segmented**：开启裁剪演示阈值后，UI 显示“本帧包含真实几何裁剪/分段（已安全完成）”，并出现 `segmented` 状态、真实可见的 segmented run（teal 像素）与凸填充部分裁剪边界（蓝像素）；未出现人工裁剪边线。
  - **unresolved**：存在无法安全表达的条目时，UI 明确显示“无法安全表达，如实不渲染、不参与命中”。
  - scale `0.25 / 1 / 8` 均重建 frame 且 `frameOrigin` 有效；8 种对象与新增索引状态标记全部存在。
- **截图工件**（`/tmp/opencode/phase6-skia-clipping-*.png`，含 `main` / `clip-demo` / `giga-neg` 的 dSF1 与 dSF2，以及 full-page 截图）。
- **运行时有非 fatal 警告**：SkPath deprecation 与 GPU `ReadPixels` 警告；二者不阻断渲染与断言。
- **无 console error、无 page error。**

## observer 局限

- canvas 外 role legend 的 testID（`skia-fixture-object-*` / `skia-fixture-overlay-role-*`）**只能证明对应 React 元素挂载**，**不能**作为 Canvas 内像素证据；Canvas 内证据只来自画布截图的 glyph/彩色像素与 marker 边界分析。
- E2E 断言的是**可观察状态**（origin、可见/可绘计数、fragments/unresolved 计数、状态分布、diagnostics、hit probe 文本、像素信号），不是逐像素与参考图完全等价；因此**不声称“无视觉误差”**。
- fixture 为**静态 descriptor 驱动**，不表示 GestureSession/InputAdapter 已接线，也不代表默认画布切换。
- 本 E2E 为 **Web CanvasKit** 证据，**不构成 native（iOS/Android）运行时证据**。

## 6.3局部能力补充（不改变任务状态）

> 本节只追加一项**已实现且已验证的局部能力**与对应 Web 证据，**绝不勾选 6.3、不关闭阶段 6、不改变任务 6.3 的未完成状态**，也不改变任务 1.4 / 4.2 债务。本节不修改 `tasks.md`。

### 已实现且验证的范围：受控 partial text/image 资源 box 裁剪

- **core 侧**：`core/frameClipping.ts` 的 `resourceBoxFragment(entry, frameOrigin, region, limit)` 从 **global canonical prepared geometry** 生成 **frame-local clipped resource box**，同时作为渲染片段与 **semantic Hit Area**（`FrameResourceBoxFragment`，携带 `resourceBox.source`）。旋转矩形框与 frame-local clip 区经 Sutherland-Hodgman 求局部交集：只有**有面积的凸交集**才产出可渲可命中的 fragment；边/点接触返回 `empty`；浮点退化非凸拓扑仍返回 `unresolved('partial-resource-box')`。命中判定使用的是这份 **frame-local clipped box**，而非原始完整 box。
- **Skia 侧**：`skia/SkiaDrawingCanvas.tsx` 的 `renderFrameTextDescriptor` / `renderFrameImageDescriptor` **只消费 frame descriptor 的 `resourceBox`**：partial 时以外层 `<Group clip={descriptor.resourceBox.clip}>` 裁剪**完整 local Paragraph / Image（含 fallback descriptor rect）**，内层保留资源自身 rotation；**不读取 `entry.geometry` 或原始 text points**（源码注释与 `skia/descriptors.ts` 契约一致）。
- **render/hit 同 fragment**：render 与 `hitTestDrawingFrame → hitFragments` 消费**同一份 `frame.renderableEntries[].fragments`**；hit 仅对 fragment 的 `points` 执行 `hitsSemanticArea`（语义边界容差 + even-odd 内部），不各自重建几何。因此 partial 文本/图片的**可见区域与可命中区域一致**。

### fixture 场景（`/skia-drawing-fixture` 的 `resource-clip`）

- 新增「资源裁剪」跳转（世界 `5000,5000`）及其条目：
  - `fixture-clip-text`（key `18`）：旋转文本框跨上缘，partial → `resourceBox + clip`，**可渲染、可命中**，`status=clipped`。
  - `fixture-clip-image`（key `19`）：旋转图片框跨下缘，partial → 同上，**可渲染、可命中**，`status=clipped`。
  - `fixture-clip-ellipse`：partial 椭圆 → `unresolved('partial-curve-or-ellipse')`，**如实不渲染、不参与命中**，仅诊断可见（绝不暗示已完成）。
  - `fixture-clip-pen`：同场景安全笔迹，作为 **rebased 对照**（完整在视口内，正常渲染/命中）。
- 场景 frame diagnostics 明确出现 `partial-curve-or-ellipse`；status 分布含 `clipped 2` 与 `unresolved 1`，unresolved 提示为「不渲染、不参与命中」。

### 真实 Web CanvasKit E2E（dSF1 / dSF2）

- **headless 环境变量**（真实浏览器 CanvasKit，仍非 native）：`EXPO_UNSTABLE_HEADLESS=1 EXPO_NO_DEPENDENCY_VALIDATION=0 EXPO_NO_NEW_ARCH_COMPAT_CHECK=0`；服务由 `with_server` 脚本以内网 `dev:web` 启动；临时 E2E 脚本位于 `/tmp`，**不提交**。
- **命令形态**（临时脚本，不提交）：

```bash
EXPO_UNSTABLE_HEADLESS=1 EXPO_NO_DEPENDENCY_VALIDATION=0 EXPO_NO_NEW_ARCH_COMPAT_CHECK=0 \
  python3 /home/zhangxiao/.config/opencode/skills/webapp-testing/scripts/with_server.py \
  --server "pnpm --dir apps/playground run dev:web" \
  --port 5266 --timeout 90 \
  -- python3 /tmp/opencode/phase6_skia_clipping_e2e.py
```

- **断言到的观察**：
  - 同源 `canvaskit.wasm` 返回 **200 `application/wasm`**，无外部 CDN。
  - `resource-clip` 场景 Canvas 内出现**被裁文字 glyph 像素**与**彩色图像像素**（非仅 DOM legend）。
  - hit probe：文本可见区命中 **`key=18` 且 `status=clipped`**；图片可见区命中 **`key=19` 且 `status=clipped`**；partial 椭圆原位**未命中**。
  - **无 console error、无 page error**；运行期仅既有非 fatal 的 SkPath deprecation 与 GPU `ReadPixels` 警告。

### observer 截图事实与局限

- **可观察事实（截图）**：`Clip 456` 文本框被画布**上缘裁切**（可见字形顶部被斜切）；图片区域呈**渐变图像**；**screen marker 画布像素边界与 dSF2 比例保持稳定**（跳转前后不漂移，证明该 overlay 不随 world/frame 移动）。
- **observer 不能证明的项**（不得据此扩张）：不能证明 hit **算术**（命中宽度/容差公式）本身的正确性（截图只证明某点命中/未命中这一可观察结果）；不能证明 **native（iOS/Android）** 运行时行为；不能证明 **dash 相位 / alpha 连续性**或逐像素等价；不能证明**完整裁剪拓扑**（复杂自交、非凸 closed path、contour cap 等）。

### 当前代码 / 测试级证据

- targeted：**3 suites / 71 tests passed**（资源裁剪相关 core + skia 套件），并单独跑通 painting package build。
- 随后全量回归：`pnpm test` **47 suites / 871 tests passed**；`pnpm typecheck` 通过；`pnpm lint` **0 error / 8 known warnings**；`pnpm build` 与 `git diff --check` 通过。
- Expo `web` / `android` / `ios` export 均为**静态**导出，**不能替代** native 运行时门。

### 6.3 未完成理由（保持不变）

- **缺 iOS / Android 真实运行证据**（Linux 无模拟器/真机）；export、Jest 与 Web CanvasKit 均不能替代。
- 以下能力**仍未完成、本节不作声明**：`partial-curve-or-ellipse`（partial cubic/ellipse 细化与 cap）、复杂自交 / 非凸 closed path、`contour-deviation-not-met`（contour cap）、**完整 f32 输入预算**的全链路证明、**dash 相位 / alpha 连续性**。
- 因此：**不可称阶段 6 闭合**，**不可称 legacy SVG 迁移**，也**不可称与完整裁剪等价**；`partial-resource-box` 仅在本节所述的**受控凸矩形∩局部 AABB**范围内成立，浮点退化 / 非凸拓扑仍 `unresolved`。

## 准确边界（禁止扩张声明）

- **不声称 legacy SVG 迁移**：本阶段只建立并验证 canonical V2 共享几何/命中与空间过滤；legacy SVG 绘制面、回退路径与默认切换不在本报告结论内。
- **不声称完整裁剪**：`partial-curve-or-ellipse`、复杂自交/非凸 closed path、`contour-deviation-not-met`、`partial-resource-box`、`unsafe-number` 等仍以 `unresolved` 诊断**如实不渲染、不参与命中**；text/image 保持 box 语义，不做 alpha-pixel 裁剪。这些是**有界非零误差**的诚实暴露，不是“裁剪已全部完成”。
- **任务 6.3 保持未完成**：advanced partial clipping 仍 unresolved，且缺 iOS/Android 真实运行证据；export/Jest/Web 均不能替代原生运行。
- **任务 1.4 与 4.2 债务不变**：Linux 环境无 iOS/Android 模拟器或真机，三端真实运行时门与 Native Adapter 真实设备证据仍缺失；本报告不改变其未完成状态。

## 后续边界

- 阶段 6 **整体不闭合**：仅 **6.1 / 6.2 在例外复审下关闭**；**6.3 仍开放**。
- 后续只可处理 **6.3 剩余能力**或记录**真实 native 运行债务/阻塞**，不得据此宣称阶段 6 完成，也不得扩张到默认切换、retry、资源编辑、legacy 重写等其他阶段范围。
