# Design

## Context

动机见 proposal.md。基线 `9f4ece3`，schema 为 `spec-driven`。以下为已观察机制，后文带“新增”的模块尚不存在：

| 文件与符号 | 已观察行为及设计影响 |
| --- | --- |
| `packages/painting/src/layered/DrawingSurface.tsx` / `LayeredDrawingSurface` | effect 创建 navigation、freehand、semantic 三个 adapter；surface 默认 touch none，policy 变化会拆装 adapter，不能靠 React 重建响应首次 pen down |
| `packages/painting/src/input/web/freehandWebAdapter.ts` / `resolveSource`、`handlePointerDown`、`handlePointerUp` | 按 pointerType 分源，单 transport owner；window 捕获阶段终止，begin/update/end/commit 走分层 controller；非空 coalesced 批次与快速抬笔必须保留 |
| `packages/painting/src/layered/navigationWebAdapter.ts` / `createNavigationWebAdapter` 的 down/move/end | host 捕获阶段先分流，touchDraw 跳过全部 touch 导航；固定双指、第三指抑制、残留指抬起前不续接；writing 检查只看 activeFreehand |
| `packages/painting/src/layered/semanticWebAdapter.ts` / `createSemanticWebAdapter` 的 down/cancel | 非自由笔工具有独立 owner、policy 和过程反馈，不能只修自由笔 |
| `packages/painting/src/core/gesture/session.ts` / `createGestureSession`、`reduceGestureSession`、`paperBehavior` | 支持 singleTouch/twoTouch、pending-single 转 navigating-two；进入 drawing 后不支持迟到第二指转导航，且带旧文档 document-commit effects |
| `packages/painting/src/core/gesture/ownership.ts` / `reducePointerOwnership`；`core/viewportTransform.ts` / `applyViewportTransformIntent` | 可复用纯归属和变换基础，不需要另一份文档或 viewport |
| `packages/painting/src/core/layeredEditorController.ts` / `cancelFreehand`、`updateViewport` | collecting 时冻结 viewport；cancel 需当前 identity 与批次序号，不能销毁整个 adapter 代替事务取消 |
| `packages/painting/src/layered/Toolbar.tsx` / `Toolbar`；`layered/PaintingBoard.tsx` / `LayeredPaintingBoard` | Toolbar 通过 controller 获取状态，与 Surface 同级；适合新增菜单和独立低频订阅 |
| `packages/painting/src/layered/createEditor.ts` / `createEditor`；`apps/playground/src/layered-editor/LayeredEditorDom.tsx` / `LayeredEditorDom` | controller 在组件初始化创建；touchDraw 查询参数只设置静态 inputPolicy，没有三档或持久化 |
| `tests/ui/touch-drawing-arbitration.spec.ts` | 旧断言为默认 touch 导航、touchDraw 后拒绝第二指；必须更新，不得把原断言不变当作回归通过 |

主规格 `input-session-viewport` 的 `Web owns viewport and coordinates` 保持原文不变。手指转双指时先结束取消书写会话，再导航；书写会话存在时仍冻结 viewport。

## Goals / Non-Goals

**Goals:** 同一次 DOM 输入只经过一个仲裁决策；跨 adapter 取消/转交有明确顺序；首帧初始化确定；自动检测不依赖设备猜测；保持快速笔、压力和历史事务语义。

**Non-Goals:** 替换分层 freehandSession、引入旧文档提交、修改文档 schema、实现原生手势或墨迹桥、在本次 propose 编码或运行 UI 测试服务。

## Decisions

### 1. 状态属于编辑器，存储属于 Web 宿主

新增 controller `input` 快照/订阅和模式设置入口，保存 `mode: auto | finger | pen`、`penSeen: boolean`，派生 `effectiveTouch: draw | pan`。模式与 latch 不进文档、undo、序列化、笔刷或压力设置。工具栏和 Surface 读取同一快照。controller 不访问 DOM/存储。

编辑器会话定义为 controller 实例生命周期；重绘、切工具、Surface 重挂载、blur/后台都不重置 latch；销毁并创建新 controller 才重置。不同 controller 不共享 latch。

新增 Web 偏好模块 `layered/inputModePreference.ts`（拟定路径），键 `hamster-note.painting.input-mode.v1`，值为三个合法枚举之一。Web `createEditor` 初始化同步读取并把有效 mode 作为初始配置传入 core factory；只在用户菜单选择时写入。读取/解析/写入异常均捕获，未知值按 auto，保存失败仍保留当前实例的内存选择。无浏览器环境默认 auto；SSR 必须在客户端恢复完成前阻止 Surface 接收输入，不在 mount effect 中先展示 auto 再恢复。直接使用 core factory 的宿主须在首次挂载可交互 Surface 前完成同样初始化。

选择 controller 状态而非 Toolbar 私有 state，是因为 Toolbar 可关闭且 Surface 不能看到不同模式；选择同步小值读取而非异步 effect，是为避免首帧错误输入。

### 2. 唯一仲裁入口和 policy 翻译

新增 `input/web/layeredInputArbiter.ts` / `createLayeredInputArbiter`，由 Surface 创建一次，负责 host down 与 window capture move/up/cancel 的有序路由。三个 adapter 在该组合路径改为接收仲裁派发的样本/取消指令，不再自行竞争监听同一生命周期；独立使用 adapter 的静态 policy API可保留。复用现有分源与批次采样，不能把合法真实压力越界样本交给会过滤它的旧 normalizePointerInput。

| 选中模式 | penSeen | freehand/semantic 的来源许可 | navigation 的触摸许可 |
| --- | --- | --- | --- |
| auto | false | mouse、pen、单 touch 可操作当前工具 | 双 touch 平移+缩放，单 touch 不抢绘制 |
| auto | true | mouse、pen；touch 不发起绘制 | 单 touch 平移，双 touch 平移+缩放 |
| finger | 任意 | mouse、pen、单 touch 可操作当前工具 | 双 touch 平移+缩放 |
| pen | 任意 | mouse、pen；touch 不发起绘制 | 单 touch 平移，双 touch 平移+缩放 |

这是准入许可，后续仍由当前工具分派自由笔/语义工具；pan 工具单指或鼠标拖动始终导航，鼠标不因三档变更而禁用。三档的默认纸面导航不受 `touchDraw` 或虚拟纸张可视开关意外关闭；现有缩放边界继续适用。用户命中的按钮/输入等安全控件先排除；尺子、选择手柄保持各自已有归属，双指纸面导航仅组合纸面有效 touch，不把控件或其他 owner 的指针计入 pair。

现有 Surface `inputPolicy` 兼容策略：保留类型入口，将显式 touch draw/none 仅映射为初始化 finger/pen 的兼容提示；优先级为显式新增初始 mode > 有效已存档位 > 旧 inputPolicy 提示 > auto。旧提示不持久化，不作为持续覆盖菜单的第二策略；示例去掉 touchDraw 产品路径。对旧调用方这属于策略语义调整，需发布说明；底层独立 adapter 的静态过滤保持原契约。鼠标、笔的显式旧来源限制不在新三档组合入口继续形成隐藏第四档，调用方应迁到独立 adapter 或宿主禁用机制。

不采用“给三个 adapter 分别加 mode 判断”，因为无法保证第二指捕获先后、取消和 latch 的原子顺序；不以重建 adapter 切换模式，避免丢掉触发检测的那次 pen down。

### 3. 新建窄仲裁状态机，复用 core 基础，不接入旧完整 session

新增纯 reducer `core/layeredInputArbitration.ts`，维护 idle、single-tool、single-pan、touch-pair、pen-tool 及本轮 suppressed ids，输出 route/cancel/begin-navigation 等意图。复用 `reducePointerOwnership` 的 down-time 归属及 `applyViewportTransformIntent`；导航 adapter 只执行给定 pair 和基线的变换，controller 仍是唯一 viewport 权威。

明确不整体接入 `core/gesture/session.ts`：其旧文档 effect 不能进入 schema3 分层提交链，并且当前 drawing 状态不会处理迟到第二指。本次新建的只是仲裁 reducer，不再创建笔迹几何/文档状态机；实际自由笔继续调用现有 `freehandSession` 与 controller。保留旧 session 供原调用路径使用，不做全仓迁移。

事件顺序：
1. 校验来源、目标、identity 与有效坐标，排除安全控件，冻结 down-time 归属。
2. 更新有效 pen 检测状态，计算当前工具与模式的准入。
3. 仲裁输出取消时，调用对应 adapter 的显式取消，清除 transport owner/capture/预览，并确认 controller 已不再 collecting；不能伪造 pointerup、commit 或通过 undo 补救。
4. 取消确认后才以两指当前坐标、当前 viewport revision 建立新导航基线。取消失败则拒绝本次接管并报告诊断，保持视口冻结，不能带病平移。
5. 其余样本只给唯一 owner。固定 pair 中任一指结束，本轮其余触点进入 suppressed，全部抬起后才接受新手势；第三指不替补，不补应用旧 move。

单指 touch 正在自由笔、形状、套索、擦除或选择事务时，纸面第二指触发未提交事务取消后转导航；已经完成的点击/文字/图片操作不回滚。有效笔绘制期间 touch 全部抑制，不组成 pair；笔结束后仍按抑制集合排空，重新落下的两指可导航。mouse 已有书写 owner 时也不让 touch 改变 viewport。

### 4. penSeen latch 和强制覆盖

仅画布业务输入入口首次有效 `pointerType === 'pen'` down 设置 penSeen；hover、move、pointerup、设备能力探测、压力值、maxTouchPoints、UA 和工具栏触碰都不触发。有效指样本不要求压力大于零，避免笔事件压力缺失时无法检测。合成 PointerEvent 用于自动化；真实设备事件使用相同语义，不以 isTrusted 限制业务处理。

penSeen 在任意档位均可记录，但只参与 auto 计算：finger 始终 draw，pen 始终 pan，auto 才读取 latch。切 finger 立即覆盖 latch；切回 auto 则仍采用本会话的 penSeen，不清零、不等待超时。不新增“忘记手写笔”隐含动作。

首次有效 pen down 若遇到 touch 工具会话，先取消 touch 再把同一 pen down 交给绘制工具；若已有双指导航，记录 latch 但不抢夺 pair，排空后下一次新 pen down 可绘制。模式切换先取消所有未提交活动工具/导航并隔离残留指针，再对后续新 down 使用新模式；已完成对象和 pending commit 不撤销。所谓“立即恢复”指菜单选择后的下一次新手指输入立刻可绘制，不复活切换前按住的指针。

### 5. UI 与验收策略

现有 Toolbar 新增带可访问名称“输入模式”的 select，三个选项文本与确认口径一致，在任何工具下可见；直接控制 controller 模式入口。窄屏沿用 flexWrap，不改为独立设置页。

测试采用现有 Jest 的 core-node/legacy-web 和 Playwright chromium 配置。新增纯 reducer、存储/组合入口测试，以及 `tests/ui/mobile-input-mode.spec.ts`，复用 `layered-helpers.ts` 的 PointerEvent 派发与 document/history/viewport 观察；每例独立清空本地偏好，只有持久化例跨 reload 保留。不能仅测 policy 枚举；要断言双指后文档数、undo 状态、预览清理与 viewport 真实变化。具体命令及用例名约定见 tasks.md，供 apply 新建用例后执行，本次不运行。

## Risks / Trade-offs

- [取消与 up 捕获竞态] → 单入口有序派发，显式 cancel 后忽略迟到 up，保留快速 pen/capture 既有回归。
- [旧 session 复用过度导致双提交] → 只复用归属和变换基础，唯一分层 freehandSession 提交，不接旧 document-commit。
- [菜单更改破坏当前会话] → 明确取消未提交事务、排空原触点，已提交历史不动，模式操作不创建 undo。
- [存储/SSR 导致首帧闪错模式] → 同步初始化或交互挂载门，异常内存降级；测试在首个可交互 Surface 前断言恢复值。
- [旧 inputPolicy 使用方行为变化] → 保留初始化映射和独立 adapter API，发布说明列出初始化优先级及迁移；不留隐藏模式覆盖。
- [合成输入不足以证明设备掌触质量] → 自动测试锁住路由契约，保留既有真机诊断能力；本变更不宣称已完成真实笔设备验证。

## Migration Plan

实施按 controller/偏好初始化、纯仲裁、adapter 组合、Toolbar、回归的顺序交付，不迁移任何文档。将旧 touchDraw 测试迁到可见菜单或明确初始 mode；同步标注 inputPolicy 组合入口的兼容语义。回退实现版本不影响文档，旧版本忽略新增偏好键即可。

## Open Questions

无需要产品拍板的遗留歧义。初始化优先级、会话定义、强制档与 latch、切换时取消和遗留触点隔离均为本设计明确的工程约定；六条产品口径保持不变。
