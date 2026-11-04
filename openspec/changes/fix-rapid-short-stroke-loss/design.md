# Design

## Context

动机见 proposal.md。基线为 `2f0a3f2851d0f6cf890e7b8933f2dc64c546586c`，OpenSpec CLI 1.13.1，项目采用 `spec-driven`，无自定义 context/rules，当前无其他活动 change。

### 已查证的链路

1. Web：`layeredInputArbiter.ts` 在 host 接 down，在 window capture 接 move/up/cancel，归属由 `layeredInputArbitration.ts` 管理；它先建立归属再向工具端口派发，没有工具 begin 成功回执。
2. `freehandWebAdapter.ts` 接受 host 或历史对象上的 down，拒绝其他 target、已有 owner 或 operating 状态；按批次累加 move，up 独立构造末样本，同步 end、释放 capture、commit。`lostpointercapture` 本身保留 owner，并非取消。
3. `layeredEditorController.ts` 的 end 将候选放入 pending 后清除 activeSession；commit 按 commitId 幂等且按 pending 顺序执行。正常后续 begin 不依赖历史显示 ACK。
4. `drawingCanvas.ts` 的 interaction 更新经 rAF 调度；绘制 pending、待提交候选和 active。`PresentationCoordinator.ts` 按对象保存 pending，历史 ACK 匹配四字段身份后按文档顺序释放；`DisplayLayer.tsx` 在 layout effect 挂载并确认路径，可配置 `historyReadyDelayMs`。这些行为本身不能证明浏览器实际 paint 无空窗。
5. iOS PencilKit 是显式 opt-in 原型。raw observer/采样器 → RN route 消息队列 → `pencilkitDemoBridge.ts` begin/stroke → 同一 controller → Web 就绪 → 原生按 ID 退休 → retired 回执。桥与宿主均有待交接数量限制，桥中 `pending.size < 4`，宿主传输队列上限为 12；存在异步延迟及背压状态。
6. `semanticWebAdapter.ts` 的 dblclick 仅完成 polygon，`layeredToolSession.ts` 会检查当前 polygon placement；当前没有证据支持“自由笔被双击处理直接吞掉”。不得据症状直接移除双击能力。

### 本轮复现探查与边界

2026-10-26，在 Linux、Node v24.15.0 下直接加载仓库 TypeScript，使用 `node --experimental-transform-types --input-type=module -e` 和仅补齐相对 `.ts` 扩展的 resolve hook；未替换生产逻辑。分别调用真实 `beginFreehandSession`/end，以及真实归属 reducer。后一次探查使用 `createLayeredInputSnapshot('finger')` 生成合法策略快照。

输入：mouse/touch/pen/native 四来源；位移 0、8、160 CSS px；每组合 100 笔；无 move，仅 down/up；落笔逻辑时间间隔 200 ms、接触 20 ms；复用 pointerId=1，独立 sessionId/commitId，up pressure=0。全部在同步循环执行，逻辑时间不代表真实墙钟调度。Web 三来源分别经过独立 reducer 探查，native 仅调用 session，不伪装为 Web device。

| 来源 | 每种笔长的候选/尝试 | 三种笔长的路由事件数 | 结束残留 contacts |
| --- | --- | --- | --- |
| mouse | 100/100 | 600/600 | 0 |
| touch | 100/100 | 600/600 | 0 |
| pen | 100/100 | 600/600 | 0 |
| native | 100/100 | 不适用 | 不适用 |

结论：纯 session 和独立归属 reducer 在该输入下未复现隔笔丢失；共生成 1200 个候选。该结果不覆盖两者之间的真实 adapter 集成、controller 提交、历史、几何、DOM、浏览器事件、rAF 或 UIKit。当前 checkout 未安装依赖，无可用实体 iPad/触控笔；本轮没有启动应用、执行 UI 回归或完成原设备端到端复现，不能声称根因已确认或修复通过。

### 待证伪根因假设

| 假设 | 代码依据与可解释范围 | 判定证据 | 定点处理方向 |
| --- | --- | --- | --- |
| H1：归属已建，但某笔 down 未被工具接受，或终止未送达留下状态 | arbiter 没有 begin 回执；adapter 有 target/owner/operating 门；短笔缺少中间样本，暴露首尾路径问题 | 比较原始 down/up、route、adapter begin/拒绝原因及 owner 清理。若每笔 begin/end 均接受则排除此层 | 修正证据指向的路由/归属释放；保留真实 cancel 与控件排除 |
| H2：已提交笔在预览与历史交接时丢失 | rAF、layout effect、pending 多笔及 ACK 可交错；快速完成更易跨过活动 paint | 对丢失笔核对 commitId、文档对象、非空几何、Canvas/SVG 可见性与像素；文档和 undo 已有该笔而屏幕没有支持此假设 | 按每笔身份保留覆盖、挂载和释放；不清除新活动笔、不全量清屏 |
| H3：结束批次校验或提交失败 | up pressure=0、coalesced、sequence、viewport revision 和 pending 顺序均有校验 | 记录 end/commit 的 error/sessionCode 与 payload 元数据；候选缺失定位 end，候选存在但无文档定位 commit | 修正确定的样本/序号或提交顺序；不伪造 pressure、不以截断成功掩盖失败 |
| H4：仅原生路径中，异步 begin/stroke、tool/raw end 和退休账本失配，或背压误停用 | 原生桥单 active、四个待交接槽位、宿主异步发布 enabled 与独立 PK tool 周期 | 对照 PencilKit 关/开，同一 ID 的 raw begin/end、消息、提交、PK tool、ready/retired 及队列深度；长短笔保持相同起笔频率 | 仅在原生证据成立时修正 lease、消息或按 ID 退休；保留有界队列与错误报告 |

这些是假设及验证分支，不是已发生的事实。相同起笔频率并不证明相同接触时长或桥接压力；不能仅凭长笔正常排除异步链路。

## Goals / Non-Goals

**Goals:** 找到第一处从“尝试输入”到“可见历史”数量或身份不一致的边界，保留修复前失败证据，再只修改该边界；以逐笔身份和最终像素同时验证可靠性。

**Non-Goals:** 不重写绘图引擎、压力算法、导航或所有工具；不增加第二份文档/history；不以最短笔长过滤问题；不将延长固定等待或 crossfade 作为交接正确性方案；本 propose 不执行实现、构建发布或真机安装。

## Decisions

### 1. 先定位丢失边界，再选择修改模块

复用 `/layered-editor?diagnostics=1&traceGestures=1` 的有界 trace（2048 条、带累计计数和 trusted），逐笔对齐：尝试数 A、业务原始 down D、接受 begin B、有效 end E、创建提交 C、存活对象 O、可见最终笔 V 和 history 事务 H。无 cancel/非法输入时要求 A=D=B=E=C=O=V=H；若 A>D，优先查浏览器/UIKit 派发，不能把缺失 down 排除到分母之外。确有 cancel/策略拒绝时逐笔归因，不算完成笔。

按小批导出 trace，避免 100 笔覆盖 2048 条窗口；累计数不能替代丢失笔的完整链路。诊断关闭时重复关键序列，避免诊断开销改变复现。只有现有字段不足以定位具体边界时才补最小事件字段，仍有界且不逐点 setState。

拒绝直接加入 down/up 防抖、距离阈值、双击禁用或任意 setTimeout：它们没有对应失败证据，可能改变合法短笔与原有工具行为。

### 2. 以受控对照拆分笔长、接触时长和频率

下列参数是提案验收基线，不是用户已确认的复现场景。自动化每格独立干净文档，落点分散不重叠；相同设备、笔刷、输入模式、viewport 与应用版本。

| 维度 | 受控值 |
| --- | --- |
| 笔长 | tap 0、短笔 8、长笔 160 CSS px |
| 起笔频率 | 2、5、8 Hz，即 down-to-down 周期 500、200、125 ms |
| 接触时长 | 20、80 ms，各档短/长笔使用相同 down/up 时间和样本数 |
| 样本 | 无 move；一个 move；非空 coalesced；空 coalesced 回退；独立同帧 down/up 压力测试 |
| 来源 | Web pen 主验；mouse/touch 在策略允许档回归；iOS PencilKit 条件验收 |
| 身份 | 同一 pointerId 连续复用与每笔新 pointerId，两者均使用不同 session/commit |
| 显示 | 空白与混排历史；opacity 1 和 0.5；viewport 0.5/1/2 |

核心笛卡尔矩阵为三种笔长 × 三档频率 × 两档时长，每格 100 笔。样本/身份/显示边界在 5 Hz 与 8 Hz 另做定向用例，不强制所有维度笛卡尔展开。基准运行不插入人为 ACK 延迟；随后增加最多三笔同时等待、首笔历史 ACK 延迟 300 ms 的用例，并注入乱序和重复 ACK。原生不得用超出四槽容量的无限延迟证明普通负载丢笔；另测超限须明确拒绝并恢复。

真机在实际支持的笔/入口上以 5 Hz 目标连续短笔 100 次及同频率长笔 100 次，记录实际 down 间隔分布、接触时长和位移，不把人工节拍当作精确调度。至少三轮，并附慢速对照；如设备难以达到该频率，保留真实数据，补自动化压力结果，不声称完成精确真机 8 Hz。发现丢失时保存最小失败批次并逐笔定位。

### 3. 输入完成与显示 ACK 解耦，保持每笔身份

后续实现应继续允许上一笔等待显示时下一笔开始。若证据指向 H2，以 commit/object/revision 身份维护待交接覆盖及确认；只让匹配且仍存活的笔退出覆盖，按顺序显示历史。保留同步 end/commit 及幂等语义，不为每笔引入 React 逐点重建。先用现有 `historyReadyDelayMs` 验证，再决定是否需改变状态模型。

替代方案“等待上一笔历史确认才启笔”会阻塞快速输入，不采用；“提交成功立即清屏”违背当前显示交接契约，不采用。

### 4. 历史和像素共同作为验收结果

修复前先固定能失败的 adapter/controller 集成或浏览器用例。复用 `freehandWebAdapter.test.ts`、`layered-presentation.test.ts` 和 `tests/ui/layered-editor.spec.ts` 的入口与断言方式。每格核对 100 个独立对象及 100 个历史事务；逐次 undo 至基线、逐次 redo 至原序，过程中每步恰好改变一笔，结束后再绘制一笔确认无残留 owner。

DOM 数量、非空 path 与 controller 对象数量仅证明内部状态。Web 最终在每个分散落点区域核对非背景像素；延迟交接要检查过程中无空窗与半透明变深，真机以录屏/逐帧检查补物理呈现，不能用 mock ACK 替代。交接中 undo 和迟到 ACK 单独验证不复活笔迹或清掉下一笔。

### 5. 按真实启用路径验收触控笔

Web `pointerType='pen'` 与原生 `source='native'` 分开记录，不拿合成事件通过当作 PencilKit 通过。默认先验 DOM；iOS 原生开关开启时额外记录宿主起笔/完成/提交、tool begin/end、待交接/待退休、消息 ID、contextKey 和原因。覆盖 begin 回复晚于 up、上一笔未退休下一笔已开始、真实零压力、重复坐标、合法 cancel、掌触和模式切换后的再起笔。

若问题确认只发生在其中一个入口，限制实现修改范围，另一入口仍跑相关回归；保持原生默认关闭及既有发布门槛，不触发原生生产接入扩项。

## Risks / Trade-offs

- [用户设备/入口未知] → 暂按跨入口诊断与条件验收规划；已请求补充设备、系统、入口和 PencilKit 开关，收到信息后收窄复现入口，不改变零丢笔契约。
- [尚无端到端复现] → 当前只有纯状态机未复现证据，不能确认单一修复方案；实施第一项必须取得失败 trace/用例后再改实现，若仍不能复现，报告证据缺口而非声称修复。
- [诊断或合成输入改变事件调度] → 记录 trusted、开关诊断对照、真实墙钟调度及真机结果；不混用逻辑时间和实测频率。
- [历史积压与原生背压混淆] → 记录队列深度和 enabled 变化；区分容量内丢笔、明确超限拒绝与恢复，保留有界策略。
- [修改交接影响混排顺序与半透明] → 用混排文档、延迟/乱序确认、opacity 0.5 和 undo/redo 验证。

## Migration Plan

无 schema/保存数据迁移。后续实施以独立最小修复提交交付，保留失败回归与对应通过证据；涉及 Swift 时需匹配原生二进制与 JS 来源并重新设备验证，不能以 Reload 代替。回退代码不改变既有文档格式，原生保持默认关闭。本轮不执行以上实施或发布步骤。

## Open Questions

- 用户实际设备/系统/入口和 PencilKit 开关、实际短笔长度与频率尚未提供，决定优先收集哪条链路的设备证据。当前按上述明确假设覆盖两路径。
- 当前没有用户现场 trace 或视频，H1–H4 均未确认；这些证据决定最终修改模块，实施必须先满足复现门槛。
