# Tasks

> 范围修订（见 `decisions/web-only-acceptance-scope.md`）：正式验收面为 **Web**；
> 原生 iOS/Android **只保留 `compat-static` 静态兼容门**（根 typecheck、`expo export --platform ios|android`、native Jest/RNTL 最小挂载）。
> 被取消/替代的原生运行任务以 `CANCELLED`/`REPLACED` 注解保留审计语义，**不得**把取消项显示为原生 PASS。

## 1. 基线与 Expo SDK 57 应用骨架（Web 运行 + 移动 `compat-static`）

- [x] 1.1 记录迁移前基线：执行 `git status` 与 `pnpm install`、`pnpm lint`、`pnpm test`、`pnpm build`，产出基线报告并列出仓库中既有的未提交 pnpm/CI 改动清单；验证方式：命令退出码为 0 且报告工件存在，同时确认既有未提交改动未被修改或实施。
- [x] 1.2 将 `apps/playground` 从 Vite 入口迁移为 Expo SDK 57 应用骨架，接入 Metro 与 Expo Router 目录入口；验证方式：`apps/playground` 存在 expo 配置与 router 入口，且其 `tsc --noEmit` 通过。（证据：verification/task-1-phase-1-runtime.md）
- [x] 1.3 跑通 **Web** 端可交互启动，呈现绘制面入口且无白屏或启动崩溃；验证方式：运行 Web 启动脚本后在浏览器可观察到绘制面入口可交互。（证据：verification/task-1-phase-1-runtime.md）
- [x] 1.4 **[范围处置完成：`CANCELLED`（原生运行验收）+ `REPLACED`；`compat-static` 静态兼容通过——非原生启动/运行]** iOS/Android 手机目标兼容改为 `compat-static` 静态门：根 `pnpm typecheck`、`expo export --platform ios` 与 `expo export --platform android` 静态导出成功。验证方式：上述静态命令通过，证据标注 `[evidence:compat-static][target:ios|android][executor:linux]`。**明确不是**原生启动、触控、手势、Skia 渲染、IME/picker/权限或性能验证；原「iOS/Android 可交互启动」运行时门已 CANCELLED。（证据：verification/task-1-phase-1-runtime.md 中的 `expo export --platform ios|android` 静态导出记录；verification/web-only-scope-transition.md）
- [x] 1.5 引入 `@shopify/react-native-skia`、React Native Gesture Handler、Reanimated 与 Expo 认证依赖，并移除 Vite 运行时依赖；验证方式：依赖清单与 lockfile 更新，`pnpm build`（或等价打包命令）通过且不再打包 Vite 运行时。（证据：verification/task-1-phase-1-runtime.md）

## 2. CanvasKit 本地加载与超大坐标/性能 spike 决策

- [x] 2.1 spike 并确定 CanvasKit 本地静态资源发布与加载方案，产出不含外部 CDN 请求的最小可加载工件；验证方式：工件可在 Web 本地加载且网络面板观察不到外部 CDN 请求。（证据：verification/task-2.1-canvaskit-local.md）
- [x] 2.2 执行超大坐标与性能 spike，构造极端平移、极大/极小缩放、大对象数文档与接近浮点精度边界的坐标用例并采集精度与性能数据；验证方式：产出含用例、数据与结论的 spike 报告工件。（证据：spikes/coordinate-performance/README.md、spikes/phase-2/coordinate-performance-measurements.json）
- [x] 2.3 依据 spike 决定坐标策略、空间索引结构与性能阈值并记录决策；验证方式：决策工件存在且被后续 6.3 与 10.1 直接引用。（证据：decisions/task-2.3-coordinate-indexing.md）
- [x] 2.4 将 spike 结论回填到设计说明的兼容/性能边界段落，作为后续实现与验收依据；验证方式：设计工件出现对应决策条目且与 spike 报告一致。（证据：design.md 第 10 节与风险表；verification/task-2-phase-2-spike.md）

## 3. V2 纯核心层与 V1 迁移兼容

- [x] 3.1 抽取无 DOM、无 React Native、无 Skia 依赖的纯 core，包含 V2 文档模型、几何构造、命中测试与 viewport 变换数学；验证方式：静态检查确认 core 无 `document`/`window`/`react-native`/Skia 导入，且 core 单测通过。（证据：`packages/painting/src/core/{document,transient,geometry,index}.ts`；core 导入图静态断言与几何/命中/viewport 单测，见 verification/task-3-phase-3-core.md）
- [x] 3.2 实现 V1→V2 读时迁移与未知可选字段容忍，内部规范模型统一为 V2；验证方式：使用既有 `fixtures/v1` 与 `fixtures/v2` 做兼容回归，旧数据字段不丢失。（证据：`core/document.readDrawingDocument` + `model/strokeMigration`；`fixtures/v1`/`fixtures/v2` 回归与未知字段容忍测试，见 verification/task-3-phase-3-core.md）
- [x] 3.3 将公开类型收敛到以 V2 为基准并减少双形状分支，同时提供兼容 shim 以保证现有调用方仍可编译；验证方式：`pnpm typecheck` 通过且 `packages/painting-board` 无需同步改造即可编译。（证据：canonical `@hamster-note/painting/core`（V2 类型/schema、geometry/hit、viewport、document/transient）；root 为 legacy shim；root `pnpm typecheck` 通过，见 verification/task-3-phase-3-core.md）
- [x] 3.4 在 core 契约层分离持久 document 与高频 transient，明确 transient 不进入 document、不触发 history 与持久化回调；验证方式：单测断言逐帧 transient 更新不改变 document 且不触发 `onChange`。（证据：`core/transient` effect dispatcher 断言仅 `document-commit` 触发 history/onChange，见 verification/task-3-phase-3-core.md）

## 4. InputAdapter 与领域 GestureSession（移除 multi-drag/core）

- [x] 4.1 定义 InputAdapter 归一化输入事件契约并实现 Web Adapter，把 DOM Pointer Events 翻译为归一化事件；验证方式：core 单测使用合成归一化事件即可驱动几何与手势路径。（证据：verification/task-4-phase-4-gestures.md）
- [x] 4.2 **[范围处置完成：`CANCELLED`（原生真手势运行验收）+ `REPLACED`；静态兼容检查通过——非真手势]** Native Adapter 保留并继续开发，但不做真机手势验收；改为 Native Adapter 静态模块 + 最小 RNTL mount 兼容检查。验证方式：`native` project 的 `NativeAdapterSmokeSurface` 组件/可访问性/reset 最小挂载通过（2 套 / 5 tests），且根 `pnpm typecheck` 通过。**明确非真手势、非 iOS/Android 运行时**；原「native input → Native Adapter → core GestureSession → 可观察绘制/导航」运行时门已 CANCELLED。（证据：verification/task-9-phase-9-testing.md 的 native project 最小挂载；verification/web-only-scope-transition.md）
- [x] 4.3 在纯 core 实现领域 GestureSession（绘制、导航、尺子、选区会话），语义对齐 `CONTEXT.md` 的触点归属、抓取偏移、并发手势与取消处理；验证方式：单测覆盖单指/二指导航仲裁、指针取消丢弃未提交笔迹、尺子抓取偏移与 45° 吸附、双指刚体变换、选区移动/缩放/旋转。（证据：verification/task-4-phase-4-gestures.md）
- [x] 4.4 完全移除 `@system-ui-js/multi-drag` 与 `@system-ui-js/multi-drag-core` 的运行时依赖及测试 mock；验证方式：源码与打包产物检索不到 multi-drag 引用，`pnpm test` 与 `pnpm build` 通过。（证据：verification/task-4-phase-4-gestures.md）
- [x] 4.5 用 GestureSession 驱动 virtual-paper 仅保留的 Transform 等价语义，不引入未使用的 `readerMode`/`bounds`；验证方式：单测/E2E 断言导航与缩放范围行为保留，且代码中不存在 readerMode/bounds 相关路径。（证据：verification/task-4-phase-4-gestures.md）

## 5. Skia 世界层/屏幕层渲染与唯一 viewport matrix

- [x] 5.1 实现 Skia 世界层渲染，覆盖笔迹、形状、文本与图片对象；验证方式：Web E2E 或渲染快照可观察到各类对象按文档正确渲染。（证据：verification/task-5-phase-5-skia-rendering.md）
- [x] 5.2 实现屏幕恒定 overlay（选框/手柄、套索预览、光标/橡皮指示、缩放与角度反馈、尺子）；验证方式：E2E/单测断言缩放时叠层屏幕尺寸与方向不变、平移时不漂移。（证据：verification/task-5-phase-5-skia-rendering.md）
- [x] 5.3 以单一 viewport matrix 承担世界坐标平移与缩放，移除容器/SVG/对象的重复世界变换；验证方式：单测断言连续平移缩放等价于该 matrix 上的合成，且不存在额外变换层。（证据：verification/task-5-phase-5-skia-rendering.md）
- [x] 5.4 几何与样式使用 DIP 逻辑单位并在渲染时转换为物理像素；验证方式：单测/记录证明不同像素密度下逻辑几何一致，存储值为 DIP。（证据：verification/task-5-phase-5-skia-rendering.md）

## 6. 共享几何/命中与空间过滤

- [x] 6.1 让渲染与命中测试共用同一几何来源，替换 SVG/路径专属几何；验证方式：命中用例断言结果与渲染几何一致，且变换后仍一致。（证据：verification/task-6-phase-6-geometry-indexing.md）
- [x] 6.2 在 core 建立空间索引并按当前 viewport 可见区域过滤对象；验证方式：单测断言视区外对象被跳过、回到视区后恢复，且可见对象渲染与命中结果不变。（证据：verification/task-6-phase-6-geometry-indexing.md）
- [x] 6.3 按 2.3 的决策落地坐标策略：document 持久点保持 absolute f64 global DIP x/y，渲染前做每帧瞬态 camera-origin rebasing（`local = global - frameOrigin`、`localTranslation = globalTranslation + frameOrigin * scale`、`screen = local * scale + localTranslation`，render/hit 同 origin、单一最终 affine），绝不 clamp 持久顶点；验证方式：复用 2.2 的 spike 用例回归，并补真实 **Web** 证据，精度与性能满足 2.3 设定的阈值（见 decisions/task-2.3-coordinate-indexing.md）。（**Web-only 验收关闭（Gate 6.3 专项 attempt 3/3 APPROVE）**：在**正式 Web-only 验收范围**内，**canonical、预算安全的 `FrameGeometryProgram` 已完成**——partial cubic/ellipse、复杂/自交闭合路径的**显式 nonzero compound fill**、**contour cap**、**巨大 partial image**、**巨大 partial shaped-run text** 均已具备安全几何，且 **render/hit 只接受同一份通过最终 local / screen / font / style / resource 预算的 frame program**。**明确不代表 native/全平台运行**：shaped-run（`getShapedLines`）等能力**仅 Web**；原「缺 iOS/Android 真实运行证据」要求已 `CANCELLED`。证据：verification/task-6.3-web-safe-geometry.md）

## 7. Web CanvasKit 加载/回退、单画布与默认切换

- [x] 7.1 实现 Web CanvasKit 从本地资源加载、就绪标记、加载失败可见反馈与用户重试；验证方式：E2E 断言加载成功后就绪、失败提示可见、重试结果反映到界面。（证据：verification/task-7-phase-7-canvas-runtime.md；Gate 7 attempt 2/3 Oracle APPROVE。范围限于隔离入口 `/canvas-runtime` 的 Web 路径：本地同源 `LoadSkiaWeb({locateFile:file=>`/${file}`})`、error 可见、无自动 fallback；retry 用 sessionStorage one-shot key `canvas-runtime:retry-skia` + 整页 reload，reload 后 useState 惰性初始化同步消费标记直接进入 loading；4 个持久 E2E 用例通过。）
- [x] 7.2 保证任一时刻至多一个活跃生产画布，切换绘制面时先卸载旧画布；验证方式：E2E/断言确认 legacy 与 Skia 切换后不出现两个画布并存。（证据：verification/task-7-phase-7-canvas-runtime.md；Gate 7 attempt 2/3 Oracle APPROVE。`/canvas-runtime` web 路由 `mode legacy|loading|skia|error` 互斥条件渲染，切换先卸 legacy 再本地加载并动态 import SkiaSmoke；E2E 断言 Skia 挂载后仅 1 个 `<canvas>`、legacy 不在 DOM。范围限于隔离入口，非默认路由。）
- [x] 7.3 提供有限期且可见的 legacy SVG 回退，仅在功能/性能门禁通过前可用；验证方式：门禁前可触发回退且回退状态对用户可见。（证据：verification/task-7-phase-7-canvas-runtime.md；Gate 7 attempt 2/3 Oracle APPROVE。`/canvas-runtime` 默认 legacy 且可见，Skia/error 态可手动 back 回 legacy，无自动回退；back 同时清除 retry 标记。门禁前可用，范围限于隔离入口。）
- [x] 7.4 门禁通过后让 Skia 成为 **Web 的默认正式编辑面**，无需用户开关且不再自动回退；验证方式：Web E2E 断言默认即 Skia 且正常使用时不再回退。（**已在正式 Web-only 范围关闭（Oracle Gate 7.4 Web-only APPROVE，父 orchestrator 为验证所有者）**：根 `/` 已 thin export `EditorCandidateRoute`，`/editor-candidate` 为兼容别名，`/legacy` 保留旧多 demo；根切 canary 断言从首个 DOM mutation 起无 legacy marker、生命周期 canvas 最大/最终均为 1，WASM 阻断失败态仍在 `/`（候选 error/retry、canvas 0、无自动 legacy fallback/重定向）；候选根 Chromium E2E **52/52** 通过，证据 `verification/task-7.4-web-default-editor.md`。**首发实现约束（用户明确，已满足）**：selection resize 仅 **move / rotate / uniform scale**，**无 shear**，未扩展 schema 或 affine 模型。**此关闭仅表示 Web 默认面切换，非 Gate 10、不表示 change 完成、不表示 native 运行**；8.1/8.2/8.5、9.2/9.4、10.1/10.2/10.3、11.x、12.1 及 6.3 状态不变。）

## 8. 文本、图片资源与 app shell 导入（Web 验收面；原生保留开发）

- [x] 8.1 **[范围处置：`CANCELLED`（原生运行验收）+ `REPLACED` 为 Web 临时文本编辑层；Web-only 义务已完成并关闭]** 实现 **Web** 临时文本编辑层与提交后由绘制面渲染的段落流程；验证方式：Web E2E 断言编辑中出现临时层、提交后临时层移除且段落由绘制面渲染。（**已在正式 Web-only 范围关闭（Gate 8 Web-only 最终批准，父 orchestrator 为验证所有者）**：根 `/` 正式 Web Skia 编辑面的文本编辑层为**绝对定位 `<textarea>` 临时 overlay**，draft/composition 只更新纯会话、**不写 document/history**；composition 期间 Done 使提交**挂起**，`compositionend`/end **一次提交**，overlay 移除后段落由正式 frame 渲染；existing 编辑/hit/undo/cancel 正确。证据见 `verification/task-8-web-editor-closeout.md`。**此关闭仅表示 Web-only 义务完成，非原生运行**；不代表 Gate 10、native/全平台运行或整个 change 完成。）
- [x] 8.2 **[范围处置：`CANCELLED`（原生 IME 验收）+ `REPLACED` 为 Web 组合输入；Web-only 义务已完成并关闭]** 保证 **Web** 临时编辑层正确处理组合输入（IME）、多行与 emoji，组合中间态不被误提交；验证方式：Web E2E/单测覆盖组合确认、多行保留、中文/拉丁/emoji 混合不错位。（**已在正式 Web-only 范围关闭（Gate 8 Web-only 最终批准，父 orchestrator 为验证所有者）**：硬换行/混合 `中文 CJK + Latin + emoji ZWJ + newline` **逐 code-unit 保留原串**；生产 font/shaping/frame ready/renderable、有限 Canvas readback、frame-hit 重编辑回填原串；C0/C1、ZWJ、variation/bidi/zero-width **不做“需独立 glyph”检查**，`U+6587` 已进入 CJK 资产 lane。证据见 `verification/task-8-web-editor-closeout.md`。**此关闭仅表示 Web-only 义务完成，非系统 IME / 非原生运行**；不代表 Gate 10、native/全平台运行或整个 change 完成。）
- [x] 8.3 将一次文本编辑会话作为单个撤销单元；验证方式：单测/E2E 断言单会话多次增删后一次撤销即还原，且相邻会话撤销单元互不混合。（证据：verification/task-8-phase-8-text-resources.md；Oracle Gate 8 attempt 2/3 APPROVE。`core/textEditSession` 纯会话 draft/composition 不写 document；真实 Web E2E 断言 A→B→C 相邻会话各一次提交、两次 undo 精确恢复 B/A、cancel 不新增撤销单元。）
- [x] 8.4 图片资源使用稳定唯一标识并兼容读取既有旧 `src` 值；验证方式：加载含旧 `src` 的既有文档能正常解析并渲染，多次引用标识稳定。（证据：verification/task-8-phase-8-text-resources.md；Oracle Gate 8 attempt 2/3 APPROVE。`ImageStrokeV2.resourceId?` 可选 + `src` 必填回退；migration/read/legacy shim 保留非空 resourceId；`core/resourceRegistry` 解析 ID 优先、src 兜底、同 ID 碰撞不覆盖；Skia document 与 prepared-frame 同步 resolveImage 链贯通。）
- [x] 8.5 **[范围处置：`CANCELLED`（原生 picker/权限验收）+ `REPLACED` 为 Web shell importer；Web-only 义务已完成并关闭]** 资源导入由 **Web** app shell 注入，core 与资源解析层不获取平台文件或媒体权限；验证方式：core 代码检索不到平台文件/权限获取逻辑，且 **Web** app shell 导入流程 E2E 通过。（**已在正式 Web-only 范围关闭（Gate 8 Web-only 最终批准，父 orchestrator 为验证所有者）**：Web shell 以 `FileReader`/`HTMLImage` 解码，施加 Web MIME/20 MiB/8192 边/40M pixel 限制，cancel token 失效旧结果，resourceId registry-first 与 SkImage 同步注入；空 file/cancel、MIME/尺寸超限、dataURL 去重，undo/redo 可达时**不提前释放**。证据见 `verification/task-8-web-editor-closeout.md`。**此关闭仅表示 Web-only 义务完成，非 native picker/权限运行**；不代表 Gate 10、native/全平台运行或整个 change 完成。）

## 9. 测试体系从 DOM/SVG 迁移到 core/RN/Web/E2E（Web E2E 为正式验收）

- [x] 9.1 建立纯 Node（无 jsdom）的 core 单测套件，覆盖几何、命中、viewport、迁移与 GestureSession；验证方式：`pnpm test` 中 core 套件通过且不依赖 DOM 环境。（证据：verification/task-9-phase-9-testing.md；Oracle Gate 9 attempt 1/3 APPROVE。`core-node` project `testEnvironment: 'node'`，21 套 / 338 tests，与 `legacy-web`（jsdom，28 套 / 547 tests）精确无交集。）
- [ ] 9.2 移除或重写依赖 DOM/SVG 的旧测试，替换为 core、当前 Web 组件或正式根 E2E 的等价覆盖；验证方式：每个退役测试逐条/按能力映射到等价覆盖，且 `pnpm test` 通过。（**保持 OPEN**：legacy 实现及相关 DOM/SVG 测试的退役 **MUST** 与 **11.1** legacy 实现的稳定期退役在**同一变更**中发生，**不得**提前删除。`@system-ui-js/multi-drag` 的运行时依赖与测试 mock **已由 4.4 完成移除**，历史 `yarn.lock`／旧文档／closure regex 均属**非活动路径**，**不是** 9.2 的开放理由。每个退役的 legacy DOM/SVG 测试 **MUST** 逐条/按能力映射到 core、当前 Web 组件或正式根 E2E 的等价覆盖；保护活跃 `/legacy` 或当前 Web 组件的 jsdom 测试**可以保留**，**不得**要求仓库零 jsdom/SVG 字符串。9.2 的开放理由是等待 **11.1** 与 legacy-only 测试覆盖映射，而非 multi-drag。）
- [x] 9.3 建立 React Native/Web 组件层测试，覆盖绘制面渲染与交互挂载；验证方式：RN/Web 组件测试运行通过。（证据：verification/task-9-phase-9-testing.md；Oracle Gate 9 attempt 1/3 APPROVE。`native` project 以 jest-expo + RNTL 覆盖最小 `NativeAdapterSmokeSurface` 挂载/可访问性/reset（2 套 / 5 tests，**非真机、非 RNGH 真实触控**）；`skia-canvaskit` 独立 CanvasKit 环境；Web 组件层由 `legacy-web`（jsdom）承接。范围不含 9.2/9.4。）
- [x] 9.4 **[范围处置：`CANCELLED`（三端原生 E2E）+ `REPLACED` 为 Web E2E；已在正式 Web-only 范围关闭]** 建立 **Web** 端到端测试（Playwright 等），覆盖正式 Web 编辑面的启动、绘制、导航、文本与图片；验证方式：`pnpm test:ui` 或等价 **Web** E2E 命令通过，且覆盖**正式 Web 编辑面**而非仅隔离 fixture。（**已在正式 Web-only 范围关闭（父 orchestrator 为验证所有者）**：根 `/` 的 `tests/ui/editor-candidate.spec.ts --workers=1 --trace=off` **57/57 Chromium 通过**。覆盖同源 CanvasKit、10 工具、绘制/selection/ruler/navigation/text/image/font tiers/frame query，以及正式根/兼容别名/WASM failure canary。**该证据为 Chromium Web**，主要为 DOM/state/diagnostic 与**有限 Canvas 信号**；**不是** iOS/Android、**不是**全浏览器、**不是**绝对像素/GPU/性能证据。**不得**用 `/editor-candidate` 兼容别名替代正式根证据，也不影响 `/legacy`。证据：verification/task-9.4-web-e2e-closeout.md）

## 10. Web 性能与验收门（原三端门已被范围修订取代）

> 原「三端功能对等」与原生性能要求已 `CANCELLED`/`REPLACED` 为 **Web 验收**（见 `decisions/web-only-acceptance-scope.md`）。
> `verification/task-10-phase-10-no-go.md` 保留为**旧范围状态历史**；其原生条件由新范围决定覆盖。**10.1/10.2/10.3 仍 OPEN。**

- [ ] 10.1 建立 **Web** 性能基准与阈值，覆盖大文档、高频手势与超大坐标场景；验证方式：按**已批准 Web 性能合同**（见 `decisions/web-only-acceptance-scope.md` 第 4 节）在 **production Web export**、固定 **1440×900**、dSF 1/2、**100k 对象**、**120 pointer events/s 连续 10 秒**、`±(1e9 + .125)` 下执行 **5 次独立测量**，每次正确性通过，满足 `event→next-frame/commit p95≤50ms`、`rAF interval p95≤33.4ms`、无 >100ms 主线程长任务、同机冻结基线退化 ≤20%，并记录 OS/CPU/Chromium/commit+dirty+source patch hash/样本。（**保持 OPEN**：合同**刚冻结、尚未执行**；该合同是 Web 验收预算，非对外 SLA、非 native，**不得**据此直接勾选 10.1。）
- [ ] 10.2 执行 **Web** 功能验收，确认既有绘制/命中/编辑能力在 **Web** 正式编辑面有真实行为且无静默 no-op；验证方式：Web 验收清单与 **Web E2E** 全部通过。（**保持 OPEN**：Web 正式 Skia 编辑面 **7.4 及 8.1 / 8.2 / 8.5 已在 Web-only 范围关闭**，但仍欠 **9.4** 正式 Web 编辑面 E2E 等；原三端对等验收已 `CANCELLED`，不再要求原生运行，但 Web 门禁本身尚未满足。**当前状态注记**：6.3 已在正式 Web-only 范围由 Gate 6.3 专项 attempt 3/3 APPROVE 关闭，证据 `verification/task-6.3-web-safe-geometry.md`；此关闭不代表 7.4、native/全平台或整个 change 完成。）
- [ ] 10.3 汇总 **Web** 功能与性能门禁结果并记录 **Web 默认切换决策**；验证方式：产出验收报告工件，明确门禁通过项与 **Web 默认 Skia** 依据。（**保持 OPEN**：依赖 **7.4** 正式 Web Skia 编辑面（已关闭）、**8.1 / 8.2 / 8.5** 正式 Web 编辑能力（已关闭）、**9.4** 正式 Web 编辑面 E2E 及 **10.1** Web 性能合同执行；`verification/task-10-phase-10-no-go.md` 的 NO-GO 为**旧范围状态历史**，其原生条件已被本范围决定覆盖，故不得据此勾选。**当前状态注记**：6.3 已在正式 Web-only 范围关闭，不再是开放依赖；不因此外推 native/全平台或 7.4/10.x 完成。）

## 11. Legacy 稳定期删除、文档与 CI

- [ ] 11.1 **仅当 7.4 完成（Web 默认 Skia 编辑面落地）后**才涉及 legacy 删除：在稳定周期后删除 legacy SVG 绘制面实现与回退路径；验证方式：源码与打包产物检索不到 legacy 绘制面与 fallback，且 `pnpm build` 通过。（**保持 OPEN**：7.4 尚未完成，legacy 仍作为过渡路径保留；不得提前删除。）
- [x] 11.2 移除 Vite 运行时残留及与之绑定的配置、脚本与测试；验证方式：依赖清单与配置中不再含 Vite 运行时，`pnpm lint`、`pnpm test`、`pnpm build` 通过。（当前活动 package/config/pnpm lockfile 无 Vite；清除了四处 Web E2E 中已失效的 Vite 日志过滤；`pnpm lint` 0 error、`pnpm test` 65 suites / 1043 tests、`pnpm build` Expo Web export 均通过。历史 `yarn.lock` 与旧验证记录非活动运行路径，不视为运行时残留；本任务不清理它们。）
- [ ] 11.3 **[范围处置：`REPLACED` 为 Web 交付 + 移动 `compat-static`；保持 OPEN]** 更新文档（CHANGELOG、README、DESIGN、`CONTEXT.md`），记录 **Web 正式验收面**、**移动端 `compat-static` 静态兼容**、V1/V2 兼容策略与 CanvasKit 回退的临时性质；验证方式：文档工件含上述说明且与最终行为一致。
- [ ] 11.4 **[范围处置：`REPLACED` 为 Web 交付 + 移动 `compat-static`；保持 OPEN]** 更新 CI 以覆盖 **Web 交付/打包**、**移动 `compat-static` 静态门**（根 typecheck、`expo export --platform ios|android`、native Jest/RNTL 最小挂载）、CanvasKit 静态资源与门禁检查；验证方式：CI 配置变更提交且流水线通过（既有未提交 pnpm/CI 改动仅在获得授权后并入，不在本任务内实施）。

## 12. 验收移交

- [ ] 12.1 **[范围处置：`REPLACED` 为 Web 正式验收 + 移动 `compat-static`；保持 OPEN]** 汇总各阶段验证证据、门禁结果与回滚状态，移交父 orchestrator 作为验证所有者；验证方式：移交工件包含 **Web 验收**命令输出、**Web E2E** 结果、**移动 `compat-static` 静态证据（`[evidence:compat-static][target:ios|android][executor:linux]`）** 与门禁清单，并可由父 orchestrator 复核。
