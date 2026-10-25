# Design

## Context

动机见 proposal。基线 main 含 HAM-66 合并提交 `b605e2dd31261d9f3214346325ac30d210b3daa4`。以下是源码观察，而非 Android 能力声明：

- Android 的 `DrawingLayer.android.tsx` re-export Web，playground 默认 `LayeredEditorRoute.tsx` 承载 DOM；controller 在 DOM 内创建。
- iOS 有 `packages/painting-pencilkit/` 和独立 RN host，以 `pencilkit=1` 显式开启。`pencilkitDemoContract.ts` 明示为实验协议，包含 iOS 专用 `f/mf` 字段；`layeredSemanticContract.ts` 仍是未来语义契约。
- Demo bridge 已具备 begin、contextKey、逐笔退休、取消、去重及队列保护。现有限额是每笔 50,000 样本、最多 4 笔待交接、宿主 12 条消息及 5 秒无进展保护，不采用旧设计中尚未实施的限额冒充现状。
- `demo-validation.md` 记录用户对指定 iPad 场景反馈通过，但明确不代表 G1 压力、G3 120fps 或 3.x 生产桥全部通过。HAM-66 done 是前置完成信号，不消除这些技术限制。
- 主规格仍保留三平台 Web 活动层约束；iOS delta 未归档，Android delta 必须保留 iOS 例外，后续同步时逐条处理重叠。
- 本轮无 Android 编译、Ink 依赖解析或设备实验，不能报告兼容或延迟数据。

## Goals / Non-Goals

**Goals:** 以 Android 专用原生渲染器实现暂存预览，以平台中立协议对接同一个 DOM controller，严格保留 raw、会话、历史、坐标与工具归属。

**Non-Goals:** 不把 controller 移入 RN，不维护第二文档，不把 iOS 实验通道升级为生产默认，不移植最终 PF 到 Kotlin，不承诺原生预览与最终轮廓逐像素一致。

## Decisions

### D1. 渲染选型：推荐 A，待用户评审

| 方案 | 收益 | 代价与结论 |
| --- | --- | --- |
| A：Jetpack Ink + MotionEvent 实际采样 | 采用现有 Android 墨迹库承担活动绘制，采样与渲染可分离；与 PencilKit 临时预览边界相近 | 新增 AndroidX/原生依赖，透明合成、版本与 Expo 兼容须验证；推荐 |
| B：MotionEvent + 自绘 Canvas | 渲染生命周期直接可控，外部依赖较少 | 需维护平滑、压力和低延迟预览，仍不同于 PF；不作为自动降级，A 失败时回评审 |
| C：第三方完整绘图库 | 可能附带笔刷和编辑工具 | 许可证、维护、数据与撤销模型需额外审计；没有已核验候选，不为本期引入第二编辑器 |

Android Ink API 在此具体指 AndroidX Jetpack Ink，不假定系统内置。优先采用与当前 Expo 生成工具链兼容的稳定发布版本，禁止动态版本。**A0 构建门槛：** 在后续 apply 的最小 Expo view 中锁定实际坐标、渲染和交接所需 Ink artifacts 及版本，记录许可证、minSdk、compileSdk、AGP、Kotlin、ABI 和透明 view 支持，完成真实 Gradle 构建/启动。若要求提高现有最低系统、整体升级 Expo 或只有不可接受的预发布依赖可用，停止并提交 D1 修订；不静默采用 B。本文未声称某一 Ink 版本已满足条件。

### D2. 输入范围：推荐仅自由笔 stylus 原生化

与 iOS 已确认范围对齐：手指/鼠标及非自由笔、尺子约束笔留 Web。替代“所有输入都原生化”将扩大导航、文字和语义工具范围，本期不采用。反向笔尖 `TOOL_TYPE_ERASER` 和侧键不启用原生擦除，也不伪装自由笔；需要产品支持时另行通过 controller 工具命令设计。

原生 host 位于 Expo DOM 外部，不能仅改 DrawingLayer re-export。优先由包含真实 WebView 子树的 Android ViewGroup 在事件分发入口按 tool type、画布 frame、排除区和 DOM 配置确定归属。不能先吞掉整个 MotionEvent，再用合成 JS PointerEvent 模拟手指。接管时只处理所属 pointerId，尊重 actionIndex 与历史批次；非所属轨迹保留真实 Web 输入路径。Android 一个 MotionEvent 可含多个来源，不能按第零指分类整个事件。

**A1 输入门槛：** 用真实 stylus + 手指证明自由笔只提交一次、手指 Web 三档与双指导航不变、活动笔冻结 viewport、控件/IME/Line/尺子可用、停用及笔刷设置后不会残留拦截。若公开 dispatch/split 机制无法保持归属，不推进默认启用，回 D2 评审。系统自动手写输入若抢走画布 stylus，只在墨迹表面采用适用公开配置隔离，不破坏 Web 文字输入。

### D3. 真实采样与压力

| 原生事实 | 标准化输出 |
| --- | --- |
| owner pointer 的 down、按平台顺序的历史 move、当前 move、up | 连续 sequence 的 accepted samples，真实 tap 保留 down/up；同坐标样本不去重，不从 Ink 路径反推 raw |
| view-local px | 除实际 density 转 DIP，扣布局偏移，再按落笔 viewport 逆变换到 world；布局 revision 变更取消，不重复换算 |
| eventTime / historicalEventTime | 同一 Android 单调时间基准的毫秒；按平台接收顺序保存，不以时间排序改写 |
| AXIS_PRESSURE 与设备 source 的 MotionRange | 能力在 begin 明确声明并锁定；有限原值保留，包括零和超过 1；缺失省略，不照搬 UIKit force/maxForce，不以数值变化推断能力 |
| Ink 预测/平滑路径 | 仅预览，不进入提交或 schema 3 |

auto 压力沿用 controller：有能力的 pen 为 real，明确不可用为 simulated；显式 real/simulated/constant 不被原生改写。Ink 预览工具只映射颜色、宽度、不透明度，不能宣称其压力算法等于 PF。预览坐标的 Ink API 单位在 A0 用 density/viewport 校准验证，不能凭命名假定。平台触摸取消或笔 pointer 被取消时整笔丢弃；收到正常取消后下一笔自动可用，不锁定持续 fault。

### D4. 平台中立桥与统一历史

建议新增中立 TS contract/receiver 与 `packages/painting-android-ink/`，Android host 以 `androidInk=1` 显式启用。DOM 使用统一语义接收器；Android adapter 转换自己的采样，iOS 保留现有外部消息格式，由兼容 adapter 映射进公共语义。只提取实际重复的会话/提交/退休职责，不重写 iOS host 或 Swift 采样器。

公共 envelope 含 `protocolVersion`、`editorEpoch`、`messageId`、`sessionId`、`commitId` 和上下文 revision；不得让 Android 构造名为 PencilkitDemo 的业务消息或 UIKit force 字段。两个 adapter 进入同一 controller begin/update/end/cancel、commit 幂等和 history，统一的上层接口是语义与权威边界，不要求原生库拥有相同 view 类。

| 交换 | 规则 |
| --- | --- |
| DOM 配置 | 发布工具、模式、brush、viewport、布局和排除区 revision；未 ready 不接笔 |
| begin-request / lease | 本地暂存实际 down，DOM 原子决定归属、快照及有效版本；自动模式检测只执行一次。拒绝清本笔；end 先到则等待同一 lease，不能丢首笔 |
| end raw batch / commit-result | 有效 lease 后批量验证完整样本与快照再提交，至多一个事务；同 commitId 同内容重发返回已知结果，异内容拒绝；ACK 不是显示证明 |
| cancel / invalidation | 工具、模式、布局、后台、卸载、重载取消 collecting；epoch 隔离迟到消息；已提交内容不因清理删除 |
| history-ready / retired / visible | 带 presentation identity 的逐笔交接，保留后续活动笔，不用全画布 clear |

公共限额建议沿用已实现的 50,000 samples/笔、4 笔待交接、12 条发送队列，补齐组装后 16 MiB/笔字节上限。超过限额整笔拒绝并显示原因，不截断成功。若需分块传输，按 commitId 有界重组，未齐全不提交。连续 5 秒无进展进入可恢复故障，停止新 native begin，查询权威结果再清理，重试不换 commitId；正常取消不得进入此故障。固定大小的已完成提交回执缓存满后停止接新笔并要求安全重建 epoch，不遗忘去重记录后继续接受旧重发。历史和后续 brush 变更不修改当前落笔快照。

### D5. 呈现交接与设备门槛

历史只在 Web 中按 mixed object order 显示，Ink 仅保留活动及有界待交接笔。初始候选沿用 iOS 的逐笔准备最终几何、退休原生预览、确认后显示历史；此候选并不保证跨 compositor 无空窗。**A2 呈现门槛：** 实体 Android 以至少 120fps 外部录影观察空白首笔、半透明、多笔快速连续、长笔、Web 忙碌和延迟桥，无可见空窗、双显变深或误清新笔才通过。若无法通过，停止生产启用并修订合成方案，不能以固定延时、crossfade、Web ACK 或截图代替证据。

**A3 产品验收：** 对照 Ink 预览与 PF 最终外观，用户确认收敛可接受；记录设备、stylus、OS、density、刷新率、native/JS SHA、依赖版本、原始事件计数、端到端耗时及峰值队列。至少一套实际支持压力的 stylus 设备及无 stylus Android 场景；模拟器用于构建/路由，不证明压力或物理呈现。没有采集的性能数值标记未测。

## Risks / Trade-offs

- [AndroidX/Expo 工具链或透明合成不兼容] → A0 先验证；不升级基线或自动换库。
- [事件分流破坏 Web 控件、手指或两端同时提交] → A1 及停用/换笔刷/取消恢复回归先于主集成；只根据真实事件取证。
- [跨进程交接和原生/PF 外观存在差异] → A2/A3 独立验收；不能用 iOS 已合并推断 Android 通过。
- [共享提取影响 iOS 已修复取消与路由行为] → 保留 iOS 外部协议，回跑原测试并安排实体开关和连续笔回归。
- [未归档 iOS delta 被后续同步覆盖] → 此 change 三份共享 delta 是合并后的目标语义，后续同步必须比较两份 change；本轮不归档、不改主规格。

## Migration Plan

1. 本轮完成 propose，等待用户评审 D1-A、D2 范围及 D4 统一权威；未确认不进入 apply，不自行分派。
2. 后续实施依次验证 A0/A1/A2，再完成中立桥与 Android 入口；不得把原型通过当成全部产品验收。
3. 新模块只在重建后的 Android development build 中显式启用。缺模块或版本不匹配时提示重建；关闭配置走现有 DOM，启用失败不静默冒充原生成功。
4. 完成 A3 及 Web/iOS 回归后才另行评估 Android 默认启用；本 change 不改默认值。
5. 回滚先取消 collecting、核实已提交结果、退休预览，再关闭 Android 配置；schema 3 无迁移，保留历史。不回滚 iOS 或新增 Skia/legacy 路由。

## Open Questions

- 设备验证时补齐实际 Android/stylus 型号、系统及可用高帧率录像设备；这是执行资源，不改变上述验收条件。
- Ink 精确版本与生成工程参数由 A0 给出实测记录；无法满足既定工具链则停止修订 D1，不能作为任意实现选择。

D1/D2/D4 是本提案明确的推荐方案，等待 Android 方案评审；不是用户已确认事实。A0-A3 是待执行门槛，本轮无通过证据。
