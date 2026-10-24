# Demo 原生验证路径

本增量对应 G2/G3 的可行性原型，不代表 G1 压力、G2 分流或 G3 物理交接通过；3.x 生产桥和 iOS 默认启用仍待门槛验收。`/pencilkit-probe` 保留原 G1 回归用途。

## PKCanvasViewDelegate 结束入口修正（42314ff，Mac 已验证，待实体复测）

Mac 对 `0965183` 的 Xcode 26.6 / Swift 6.3.3 编译成功，但报告 `canvasViewDidFinishUsingTool` 仅近似匹配可选协议方法；真实 SDK 要求 `canvasViewDidEndUsingTool(_:)`。因此原有工具结束计数、`previews.finishTool()`、退休协调与延迟笔刷设置不在系统结束回调中执行。已修正方法签名，保留原收尾逻辑；该缺陷足以阻塞退休，但不能据此宣告实体可见性全部恢复。

此前 19 组 Swift 替身未编译实际 Expo view，只测试了账本的直接调用，未覆盖系统委托入口。本轮 `node scripts/test-pencilkit-g1.mjs` 增加两层检查：

- 所有平台编译实际 `PaintingPencilkitView`，替身将三个相关 delegate 方法设为必需协议要求；旧错名代码已验证编译失败。新增视图回归通过协议分发 begin/end/drawing-change，使用生产采样器与账本，验证前三笔完成、第四笔活动时延迟退休、真实结束入口退休前三笔且保留第四笔、四笔回执逐一清理且不重复、第五笔可继续退休与笔刷解锁。
- macOS 先用 `xcrun` 的真实 iOS Simulator SDK 编译生产 view、采样器和手势 delegate，仅替换 Expo 宿主/事件边界。`AppleDelegateContract.swift` 以 SDK 协议与生产 view 的 `#selector` 校验同一结束方法并检查可选协议调用能通过类型检查；`-warnings-as-errors` 阻止近似协议签名警告。此步骤是 SDK 类型检查，不冒充系统实际派发或物理绘制验证。Linux 明确输出 SKIP。

DOM 多笔可见性回归进一步验证：前三个乱序退休确认不能提前显示历史；四笔完成交接后，第五笔仅隐藏自身，旧四笔路径与可见性保持。

2026-10-24 已核对 Mac 操作员的评论 `01a16d93-fa47-78e1-9bfc-936b723054b8` 及附件 `ham66-42314ff-local-evidence.zip`，可交付工程复测候选 **`42314ff3837624ca383c08ee71a58f3866086b9e`**，兼容标识 5：

- Xcode 26.6（17F113）/ Swift 6.3.3：真实 iOS Simulator SDK 契约检查以 warnings-as-errors 通过，host 20 组、指定 Jest 4 suites / 61 tests 及库构建通过。
- 按新 SHA 完整编译、安装、启动 Simulator app 成功，日志含 `BUILD SUCCEEDED`，原结束回调近似匹配警告消失。仍有模块 `Constants` 弃用与依赖警告，不将 app 构建描述为零警告。
- iPad Pro 13-inch（M5）/ iOS 26.3 Simulator：直接入口画布 `1032x1120`，普通路由开→关→开后 `1032x1140`，均为 `gesture-ancestor`。手指落墨、矩形工具切换、undo/redo 生效，开关保留原笔迹；本轮 Metro/runtime 日志未见 Native action 缺失错误。
- Mac 的 `apps/playground/app.json` 原有 projectId/router/加密配置保留。本轮没有提交 EAS 或重建真机验收包。

模拟器原生计数均为 0，不能证明真实 Pencil 结束事件派发、第四笔实体交接、原生预览与历史像素可见性或 G2/G3 通过。候选仍须后续安排包含上述 Swift SHA 的新原生二进制才能实体复测；旧标识 4 IPA 与 `0965183` 的标识 5 模拟器包均不能通过 Reload 带入此修复。当前只交付候选，不发包，HAM-66 保持 `in_progress`。

后续实体复测先确认单笔起笔/PK预览/tool结束/完成/文档提交均增长、队列/待交接/待退休归零，再检查前三笔完成后第四笔长笔可结束、四笔历史实际可见，第五笔不隐藏旧笔迹；通过后再做长笔/连续笔、undo/redo 和手指 Web 回归。若仍 `handoff-stalled`、不可见或卡死，立即停止，保留全部计数、视频/截图与线程日志；不继续在旧包反复绘制。

本地结果：Swift 6.2.3 host 20 组、相关 Jest 4 suites / 61 tests、修改文件 lint/格式检查通过；真实 SDK 检查在 Linux 明确跳过，MobileBuildMCP 返回 `spawn xcrun ENOENT`。这次不引用上一修订的 Mac 编译结果作为新签名的验证。

## 0965183 第四笔交接与多笔可见性修复（历史，结束入口仍有缺陷）

`6aecb3b` 的 Simulator smoke 已确认有效尺寸、`gesture-ancestor`、开关保留手指笔迹且无 action 错误，但原生计数为 0。随后实体 iPad 在第四笔停于 `handoff-stalled`：起笔 4、完成 3、提交 3、待交接 4、PK预览 4，原生预览与历史均不可见。该版本未通过，停止在旧包反复绘制；下述本地复现不能替代实体故障的完整根因证据。

- 原生预览账本原先在 PK tool-finish 时使用最新 raw ID；下一笔 raw down 先于上一笔 finish 时，会把完成归给下一笔，阻塞队首退休。现在按 raw begin 与 PK tool cycle 的 FIFO 配对，允许任一 begin 来源先到；取消保留自身的迟到 finish 身份，不能完成下一笔。
- RN 的待交接容量现在只计算已收到完整 stroke 的笔，不在 begin 时加入。前三笔待退休时，第四笔可以完成；完成后达到四笔上限才阻止下一笔。DOM handoff watchdog 在有效 native collecting 期间暂停，因为原生不能在活动 PK 笔期间改写 PKDrawing；结束/取消后恢复 5 秒检查。真正空闲且没有退休回执仍报错，不按超时清墨或伪造 ACK。
- 原生模式的 DOM drawing surface 改为透明，移除遮挡 PK 预览的白色背景；普通 Web 保持白色。历史仍须真实 `onPreviewRetired` 才显示，乱序回执不能跳过前缀或清掉下一笔预览。
- 状态栏区分“已提交，等待历史交接”和“历史交接已确认”，新增 `tool结束`、`PK存量`、`待退休/已确认`。PK存量是工具空闲时读取的缓存，不是绘制中的实时样本数；这些计数不能代替实际像素/视频证据。

新增回归覆盖前三笔完成、第四笔 collecting 30 秒、结束/取消后的 watchdog、四笔乱序退休后的 PF path 与可见性、下一笔 raw begin 早于上一笔 PK finish、tool-first 顺序、取消后迟到 finish。既有长笔、连续笔、手指 Web 以及 Probe/G1 回归保留；不改变 G1 样本语义，不进入 3.x，不修改依赖或锁文件。

本次 Swift 改动将 `demoBridgeVersion` 升为 **5**。现有 `8c46ab77` / 标识 4 IPA 会显示不匹配，仅 Reload 不能验证；本轮不提交 EAS 或验收包。Mac 保留本地 `apps/playground/app.json` 的 projectId/router/加密声明，按下方快进流程合并，再运行：

```bash
pnpm install --frozen-lockfile
node scripts/test-pencilkit-g1.mjs
pnpm exec jest --runInBand packages/painting/src/input/native/__tests__/pencilkitDemoBridge.test.ts packages/painting/src/__tests__/layered-pencilkit-host.test.tsx tests/jest/native/layered-dom-route.native.test.tsx tests/jest/native/pencilkit-demo-version.native.test.tsx
pnpm run prepare:playground-artifacts
```

先以 Xcode 26.6 / Swift 6.3.3 本地编译，并用新标识 5 的 Simulator app smoke：直接进入 `?pencilkit=1`、普通路由开→关→开，确认有效尺寸、`routing=gesture-ancestor`、无 Native action 错误、手指和工具栏可用、文档保持。回传编译/JS SHA、截图与日志；模拟器不能证明 Pencil 预览或第四笔真机成功。取得这些证据后再决定新二进制的实体工程复测，不让用户在已知故障旧包上继续绘制。

后续实体复测必须同时记录真实预览/历史像素和新增计数：前三笔完成后第四笔长笔应继续收取并完成；空闲后队列/待交接/待退休归零、四笔历史可见。若 tool结束 增长而 PK存量一直为 0，保留日志检查 PK 实际绘制，不把它当成退休成功；任何 `handoff-stalled`、不可见或 UI 卡死立即停止。G2/G3 仍未通过。

本地结果：Jest 93 suites / 1221 tests、responder 9 项、Swift 6.2.3 替身 19 组、typecheck、lint（0 errors / 32 条既有 warnings）、库构建、iOS JS/DOM export 与变更 Swift 语法解析通过。Linux 无 Xcode/UIKit；Swift 替身与语法解析不能证明生产原生视图编译或实际 PencilKit 渲染。

## 6aecb3b DOM Pencil 镜像事件误取消修复（历史，真机未通过）

`0d633d3` 对应的原生标识 4 / EAS build `8c46ab77-c8f8-49b4-bc00-53896f393923` 已安装到目标 iPad。最新截图显示起笔 1、PK预览 1、完成/提交 0、`gesture-ancestor`，故障为 `dom-pencil-fallback`，随后 `hit=disabled`。这不是旧 IPA，也不证明原始绘制路径或持续绘制卡死已修复。

本地复现：DOM 的 pen pointerdown 原先无条件 fault，native begin 先到时会发送 retire 取消有效会话；DOM 先到时会停用 native，异步 begin 随后被拒绝。`hit=disabled` 可以由这条取消链产生，不能仅凭该值判断最初未命中原生宿主。本轮不修改已得到 `gesture-ancestor` 回执的 Swift 宿主层级。

现在仲裁器仍立即阻止整条 DOM 自由笔 Pencil 流，禁止 Web 落墨；bridge 将其起点与已接受的 native begin 一次性关联，允许任一侧先到。关联仅作诊断，容差 8 个画布局部 CSS 像素、接收窗口 5 秒，最多保存 32 项证据；不比较 UIKit 与 DOM 的不同时间原点，不修改 raw 坐标、时间、G1 去重或 down/up。超时仍没有对应 native begin 才报告 `dom-pencil-fallback`；已消费、过期、不同起点的证据不能重复确认。reset、策略/映射变更和断开连接清理计时器。诊断关联不是 G2/G3 通过的证据，提交仍必须来自有效完整的 native raw。手指、鼠标、其他工具及尺子仍走 Web。

新增回归覆盖 native-first、DOM-first、native 已完成后 DOM 才到、DOM 已完成后 native 才到；30 秒时钟跨度、单笔只提交一次、真正缺失 native begin、证据消费/过期/位置不匹配、80 笔证据容量与清理。真实 DOM 测试在 24 笔（首笔 5,000 样本）中交替两侧起笔顺序，检查 PF 节点可见、每笔只产生一个 native 文档对象并逐笔退休。原有 20,000 样本与 64 笔测试保留。可复测命令：

```bash
pnpm exec jest --runInBand packages/painting/src/input/native/__tests__/pencilkitDemoBridge.test.ts packages/painting/src/__tests__/layered-pencilkit-host.test.tsx tests/jest/native/layered-dom-route.native.test.tsx tests/jest/native/layered-dom-actions.native.test.tsx
```

本轮只有 JS/TS 变更，兼容标识仍为 4，无需新 IPA，也不提交 EAS。Mac 保留本地 `apps/playground/app.json` 配置，快进分支后执行 `pnpm run prepare:playground-artifacts` 并重启/清理 Metro 缓存。先用已有标识 4 的本地 Simulator app 做路由 smoke：直接进入 `?pencilkit=1`、普通路由开→关→开，确认非零画布、`routing=gesture-ancestor`、无新增 Native action 错误、手指/工具栏可用、文档不被开关清空。回传 JS SHA、截图及本轮 Metro 日志；原生计数为 0 的模拟器截图不能证明 Pencil 输入。Linux 的 MobileBuildMCP `list_sims` 返回 `spawn xcrun ENOENT`，本轮未完成实际 Simulator 检查，不能先交付真机可验收结论。

上述 smoke 通过后，才在已安装的 `8c46ab77` IPA + 新 JS 上继续工程复测：先单笔确认起笔/PK预览/完成/提交均增长、队列与待交接归零、无误报停用，再做长笔/连续笔与 undo/redo/手指操作。持续绘制卡死和 G2/G3 保持未通过，压力变化不阻塞本轮。

本地结果：Jest 93 suites / 1214 tests、responder 9 项、typecheck、lint（0 errors / 32 条既有 warnings）、库构建、iOS JS/DOM export 与改动文件格式检查通过。未修改 Swift，因此本轮没有重跑 Swift 替身；之前 Mac 的 `0d633d3` smoke 不计为本次 JS 修复的 Simulator 证据。

## 0d633d3 持续绘制卡死修复（历史，真机未通过）

修勾在 `810271a` 的实际复测中报告原问题仍在，持续绘制后整页卡死，因此该版本未通过、不能进入验收。当前没有该次卡死的 iPad 调用栈；下面是本地可重现的缺陷与修复，不等同于已证实目标设备的全部根因。

- Swift 采样器在持有非递归 NSLock 时调用 begin/completed 回调。回调重入读取日志、取消或清理采样会死锁；旧实现的回归运行被 30 秒超时终止。回调现移至解锁后，同步主线程与样本接受顺序不变。
- 每个 move 从字典复制值类型 Session 后追加 Array/Set，会反复复制累计数据。现在使用仅在锁内修改的引用会话；同一 Linux Swift 6.2.3 替身测试，10,000 次独立 move / 20,002 个样本从约 2.42 秒降至 0.064 秒。该数据不是 iPad 帧率或物理绘制性能。Demo 不再额外保留已发送的 20 笔 raw 诊断副本，Probe 默认仍保留最近 20 笔；G1 去重、压力、真实 terminal 和 overflow 规则不变。活动 PK 笔期间不再为预览回收读取整份 PKDrawing。
- 64 笔的桥回归原先发送 578 条相同状态，现在只发布 1 条；非关键 DOM/controller 通知按帧合并，配置内容未变则不发。输入/工具/viewport 失效和收取 begin/finish 时仍同步校验。RN 复用实际 Expo DOM 子树，状态栏刷新不再反复序列化未确认的长笔；队首 5 秒 watchdog 不因后续入队而重置。状态栏增加队列/待交接数量。

本轮必须重建原生 development build：Demo 兼容标识升为 `demoBridgeVersion=4`，旧 `4f9e73d2-57d6-450b-97fa-addfbcddf386` / 标识 3 的 IPA 会明确提示构建不匹配，不能仅 Reload 用它验证锁和采样优化。`moduleVersion=0.1.0` 和原型消息的 `protocolVersion=1` 不变，此标识不代表进入 3.x 生产桥。

Mac 保留 `apps/playground/app.json` 的本地 projectId/router/加密声明，快进本分支，先运行冻结安装、`node scripts/test-pencilkit-g1.mjs`、`pnpm run prepare:playground-artifacts`，以 Xcode 26.6 / Swift 6.3.3 做本地编译和 Simulator smoke，确认标识 4、`gesture-ancestor`、控件/手指正常且无 action 错误。通过后使用新原生构建进行工程复测；本轮 Linux 未提交 EAS build，也未证明 Xcode/UIKit 编译通过。

实体复测先做单笔：起笔/PK预览/完成/文档提交都增长，队列/待交接归零，文档只有一个 native 对象且 PF 历史可见。再做 30 秒长笔、至少 100 笔连续笔和 2 分钟绘制/undo/redo/手指操作，检查 UI 仍可操作、不重复提交、预览逐笔退休。记录二进制/JS SHA、具体错误、四项计数、队列/待交接和本轮 Metro 日志；如再卡死，在 Xcode 暂停抓主线程及其他线程调用栈和内存。Probe 仍作 down/up、coalesced、seq、overflow 回归。压力变化不阻塞本轮。全部是工程复测，原始真机绘制路径恢复和 G2/G3 仍待证据，不能提前宣告通过。

新增覆盖：锁重入、跨 10,000 次 move 的长笔、80 笔与 Probe/Demo 保留边界、20,000 样本 + 64 笔提交/退休、真实 DOM 中长笔与 24 笔 PF 历史交接、真实 Expo wrapper 长消息不重传、队首 watchdog。测试命令沿用文档下方流程。

本地结果：Jest 93 suites / 1203 tests、responder 9 项、Swift 6.2.3 替身 17 组、typecheck、lint（0 errors / 32 条既有 warnings）、库构建、iOS JS/DOM export 和改动 Swift 语法解析通过。Linux 无 Xcode/UIKit；以上测试不能替代 Mac 编译和实体复测。

## 810271a begin/finish 修复（历史，真机未通过）

`2dae6e8` 已在 Mac 通过 Xcode 26.6 / Swift 6.3.3 编译和 Simulator smoke，确认 `gesture-ancestor` 且没有本轮新增 action 注册错误；对应 EAS build `4f9e73d2-57d6-450b-97fa-addfbcddf386` 已安装。实体 iPad 截图已证明 `hit=pencil`、起笔 1、PK预览 1，但以 `invalid-or-stale-begin` 停止，完成/文档提交为 0。旧错误合并了多个拒绝条件，截图本身不能确定是哪一个条件。

本次只改 JS/TS bridge，修复两项可复现问题：

- native begin 在异步传输期间，DOM 同原点的尺寸或排除区更新会推进配置 revision，旧实现按 key 不同直接拒绝，并发出 retire 取消原生采样。现在最多保留 32 个已发布且坐标映射、笔刷、工具和输入策略相同的配置；起点必须同时位于旧/新画布内、且不在两者的控件排除区。原点、viewport、笔刷或策略变化会清除兼容配置，未知/过期配置继续拒绝。有效 resize 通知不再无条件取消采样；原点或 viewport 改变仍取消。
- bridge 原先在 controller.beginFreehand 的同步通知之后才登记会话，通知期间发生的取消可能被覆盖。现在先预留 starting 会话，确认输入所有权与 controller 的 collecting 身份仍一致才接受；取消或 undo 后不会重新登记。finish 使用 begin 的原始 key，配置更新不改变本笔身份，重复 finish 只提交一次。

拒绝原因现在区分 `invalid-begin-sample`、`native-input-disabled`、`native-session-busy`、`native-stroke-id-reused`、`stale-begin-context`、`begin-outside-canvas`，便于下一次设备证据定位。Probe/G1 和 Swift 均未修改，手指仍由 Web 处理。

Mac 保留 `apps/playground/app.json` 未提交配置，快进任务分支后执行 `pnpm run prepare:playground-artifacts`，重启/清理 Metro 缓存并在现有 development build Reload；本次无需重提 EAS。先单笔、再连续快笔，确认起笔/PK预览/完成/提交均增加，文档中每笔仅一个 `source=native` 对象，undo/redo 正常；再验手指、工具栏和开关。若仍暂停，回传新具体错误、计数、布局尺寸和 Metro 日志，不能用旧 `invalid-or-stale-begin` 缓存结果验收。

本地 Jest 93 suites / 1198 tests、responder 9 项、Swift 替身 14 组、typecheck、lint（0 errors / 32 条既有 warnings）、库构建和 iOS JS/DOM export 通过。尚待现有 IPA + 新 JS 的实体单笔提交复测，不能据单测宣告 G2/G3 通过。

## 入口与边界

- 新 iOS development build：打开 `painting-playground:///layered-editor?pencilkit=1`。自由笔 Pencil 在真实 RN 原生视图中预览；raw 通过 Expo DOM 的串行消息/回调送到原 DOM controller，生成 schema 3 / PF 历史和统一 undo/redo。
- 普通 `/layered-editor` 和首页默认仍是 DOM，顶部显示 `Web / DOM`，PencilKit 开关可直接切换验证参数。旧 IPA（包括标识 4 的 `8c46ab77-c8f8-49b4-bc00-53896f393923`）缺本轮 `demoBridgeVersion=5` 的交接修复，显示构建不匹配；本轮需要新原生包。
- Web/Android 使用基名路由，不导入 PencilKit 原生运行时。选择、文字、形状、尺子等工具继续走真实 Web 输入。iOS 原型将真实 Expo DOM 子视图挂载到公开 `drawingGestureRecognizer.view` 下的容器中，不假设该 owner 就是 PKCanvasView 本体；几何 hit-test 总是选择真实 DOM 后代，delegate 在实际 UITouch 到达后过滤 Pencil、画布边界和控件排除区。容器按坐标转换对齐 PKCanvasView，布局时协调延迟挂载的 owner。手指不由原生接管。开关关闭时仍保留同一个宿主和 DOM controller，避免切换丢文档。
- 原生 begin 经过同一个输入仲裁器，锁定 controller 会话、笔刷和 viewport。end 只批量追加剩余真实样本，保留原始压力与接受顺序；取消、畸形或 overflow 整笔拒绝，不合成 DOM PointerEvent、raw up 或 PK 路径点。
- 每笔最多 50,000 样本，最多 4 笔完成后待交接，transport 最多 12 条消息；消息/回执缓存有界。无活动 native 会话时等待退休 5 秒仅进入可恢复故障，不按超时清屏或宣称已显示。重试查询/重用原 commitId，已提交文档保留。
- 历史节点就绪后，按原生笔身份移除对应 PKDrawing 临时 stroke，再允许显示 PF 历史。不会因旧确认清空下一笔；这只是候选协议，跨进程可见空窗、形状收敛和半透明仍须 G3 视频评估。

## 运行时确认

- 模块、onReady、DOM 配置、非零尺寸和 `routing=gesture-ancestor` 只表示“已配置，等待原生起笔”。`gesture-ancestor` 还会检查真实 DOM 是否是公开 drawingGestureRecognizer.view 的后代，不假设 PencilKit 的内部层级；不满足则显示“原生宿主未连接”并拒绝采样。
- `unattached` 还会显示具体原因：`dom-not-mounted`、`recognizer-not-mounted`、`recognizer-outside-canvas` 或 `dom-outside-recognizer`。挂载或卸载改变路由时重新发布回执，不会因首次布局尚未就绪而永久停留在旧状态。
- 起笔/完成来自真实 UIKit 的旁路手势观察器，`PK预览` 来自 PKCanvasViewDelegate 的实际 tool-begin，文档提交只在 DOM controller 回执成功后增加；历史交接状态另等真实退休回执。这些计数不表示实际预览可见或 G2/G3 已通过。观察器不识别、不抢占其他手势；Probe 仍使用原 UIResponder 采样路径，Demo 关闭该路径避免重复采样。
- `hit=pencil`、`non-pencil`、`control` 现在来自收到实际 UITouch 后的过滤；不再在初始 hitTest 中查询 `allTouches`。旧二进制 `hit=no-touch-metadata` 的截图说明先前的类型命中没有得到触摸元数据，放宽坐标匹配没有解决该问题。Apple 的 [hitTest](<https://developer.apple.com/documentation/uikit/uiview/hittest(_:with:)>) 支持空 event；[手势识别器](https://developer.apple.com/documentation/uikit/uigesturerecognizer) 接收其视图及后代的真实触摸，因此本候选改为祖先手势过滤。
- 开启实验后，如果 Web 收到自由笔、非尺子、画布区域的 `pointerType=pen`，立即阻止整条 Web 笔流；诊断允许与异步 native begin 一次性关联，5 秒无对应起笔才报告 `dom-pencil-fallback`，不会因重复 DOM 事件取消有效原生会话，也不会静默画 DOM 墨迹。手指、鼠标、控件、其他工具和尺子仍走 Web。关闭实验会卸载该断言并清理待确认项。
- `onNativeState` / `onNativeReply` 始终作为顶层函数 props 注册给 Expo DOM，开关只控制连接。Expo 57 的 wrapper 按收到消息时的当前 props 查找 action，不能在关闭开关时移除函数；迟到消息由稳定 action 接收并在断开状态忽略。
- PencilKit 的原 delegate 决策被保留；候选为后代 Web 手势设置 Pencil 绘制优先级，避免双向 failure 依赖。该公开 API 组合是否兼容目标系统的 PencilKit/WKWebView、能否绘制预览，必须在 Mac 和实体 iPad 验证，替身测试不能证明。

## Mac 合并与重建（Swift 历史增量）

本节记录 Swift 增量的本地编译流程。本轮须使用首节标识 5 的原生代码，先做 Simulator smoke，不重提 EAS。

先保留 `apps/playground/app.json` 已有未提交 projectId/router/加密声明，在任务分支执行：

```bash
git status --short --branch
git diff -- apps/playground/app.json
git fetch origin
git merge --ff-only origin/agent/agent/4b329d64789b
git diff -- apps/playground/app.json
pnpm install --frozen-lockfile
node scripts/test-pencilkit-g1.mjs
pnpm run prepare:playground-artifacts
```

不能快进或有本地冲突时保留工作树，不 reset/覆盖。此增量含 Swift、新事件与 props，Mac 先检查 Xcode 26.6/Swift 6.3.3 编译，并在本地原生 smoke 中确认实际层级回执为 `gesture-ancestor`、真实 DOM 可交互。若 `unattached`、delegate 断言或层级不成立，保留日志返回工程师，停止云构建；不要继续猜测后重提 EAS。通过本地检查后再按 README 的 Xcode/EAS 路径重建、安装新的 development build。仅 Reload 或重装旧 IPA 不会带入代码。本次 Linux 交付未提交 EAS build，未证明 UIKit 编译通过。

本地 Simulator smoke 必须覆盖直接进入 `?pencilkit=1`，以及普通路由的开→关→再开。每次开启后实际回执必须为 `routing=gesture-ancestor`，本轮新增 Metro 日志不得出现 `Native action "onNativeState" is not defined` 或同类 action 错误；关闭时手指与控件正常，文档不因开关重置。回传编译 SHA、截图和本轮日志。此 smoke 通过前只做本地修复/复测，不提交 EAS 验收包；模拟器本身不证明实体 Pencil 或 G2/G3 通过。

安装新包后连接既有 LAN Metro，再进入上述显式 Demo 路由，或在 Demo 顶部打开 PencilKit 开关。原生就绪后应显示等待原生起笔；画一笔确认起笔、PK预览、完成和文档提交计数。关闭再打开开关应保留原文档和同一个 DOM 连接。路由退出或刷新仍会销毁内存 controller，不会自动保存。

## 压力定位

附件 `文本-13C4EF763C09-1.txt`（20 笔、928 样本）的 `force` 原值只有 0、1，分母为 8.333333333333334，非零 `p=0.12`，因此不能归因于 JS 舍入或 clamp，也不能用 up 的真实零值与接触值 0.12 组成的 min/max 宣称轻重变化通过。根因还未证实。

修勾已确认当前手写笔不支持压感，本轮记录该硬件限制，压力变化不再作为 Demo 修复的阻塞项；不据此声称压力能力或变化压力已通过。

新 Probe 日志额外保存 `fBeforePencilkit` / `mfBeforePencilkit`：在 `super.touches*` 前复制数值，与调用后原 G1 的 `f/mf/p` 对照；不保留可变 UITouch 引用，不修改 G1 去重、压力归一化、接受顺序或迟到估计只计数规则。运行：

```bash
node scripts/analyze-pencilkit-pressure.mjs <导出的Probe日志.json>
```

若 `forceChangedDuringPencilkit > 0`，证明 super 调用期间原值发生变化，可据对应样本修订采样时机；若调用前后都恒定，则继续核对实际 Pencil 型号、系统输入来源和 estimated flags，不补造压力。Apple 官方对比页确认 [Apple Pencil USB-C 不支持 pressure sensitivity](https://www.apple.com/apple-pencil/)；目前日志没有实际笔型号，不能认定本次就是该设备。`maximumPossibleForce > 0` 只允许归一化，不是硬件压力能力证明。

## 必须回传的设备证据

1. 构建 SHA/build ID、Xcode/Swift、iPad/iPadOS、实际手写笔型号和能力；Probe 清空后笔画 JSON、摘要截图，逐笔仍应 down/up 各 1、末项 main/up、有 coalesced、seq 连续。仅支持压感的笔另测轻重变化；当前无压感笔不因恒定压力阻塞。
2. Demo 普通自由笔原生预览，完成后 PF 历史；Pencil→文字→形状三次 undo/redo，并导出/重读 schema 3 检查 `source=native`、raw 和笔刷快照。
3. 自动/强制手指/强制笔三档、真实连续手指笔、Pencil 与掌触、双指导航、工具栏、minimap、尺子、中文 IME；画布边缘、安全区、旋转以及 0.5/1/2 倍坐标对齐。
4. 首笔、连续快笔、长笔、半透明、Web 延迟/忙碌、旧/乱序确认、等待期间撤销、后台和 WebView 重载。G3 使用至少 120fps 外部录像；候选协议发生空窗/双显即失败，不能以单测或消息 ACK 宣告通过。

G2 无法可靠穿透、预览索引与 delegate 时序不匹配或 G3 不通过时，保留日志并暂停默认启用，按原设计重新评审。压力变化只在具备该能力的硬件上另行验证。

## Action 与 owner 挂载修复本地验证

Jest 93 suites / 1188 tests、responder 9 项、Swift 6.2.3 替身 14 组、typecheck、lint（0 errors / 32 条既有 warnings）、iOS JS/DOM export 和变更 Swift 的语法解析通过。新 Jest 用例使用 Expo 57 的真实 `webview-wrapper` action 注册/派发代码，仅替换原生 WebView，覆盖初始关闭、开关切换与关闭后的迟到回调。Swift 覆盖 owner 缺失、嵌套 owner、延迟 owner 变更、坐标对齐与卸载。

本环境为 Linux，无 `xcrun` / Xcode，未获得本轮真实 Simulator `routing=gesture-ancestor` 与 Metro 无 action 错误的证据。Mac 下一步仅执行本地编译/smoke 并回传，不重建验收包；取得两项实际证据后再决定重建。Probe/G1 规则与手指 Web 路径不变。

## a36e8b1 祖先手势候选验证（历史记录）

Jest 92 suites / 1187 tests、responder 9 项、Swift 6.2.3 替身 13 组通过；typecheck、lint（0 errors / 32 条既有 warnings）、库构建、iOS JS/DOM export 和变更 Swift 的语法解析通过。回归覆盖无元数据的几何命中、真实祖先关系检查、观察器坐标/去重、DOM Pencil 断言、手指真实绘制及开关保持 DOM 宿主。本环境没有 UIKit/Xcode，原生 delegate 组合、Fabric 嵌套与真实预览均未验证，G2/G3 保持未通过。

随后 Mac 的 Xcode 26.6 / Swift 6.3.3 编译通过；iPad Pro 13-inch (M5) / iOS 26.3 Simulator smoke 得到 `unattached`，并记录 `onNativeState` action 缺失。本候选未通过 smoke，也未提交 EAS build。上述本地测试不能替代此失败证据；本次增量修复持续 action 注册及真实识别器 owner 下的 DOM 挂载，需重新执行上一节 smoke。

## da1c224 命中修复验证（历史记录）

Jest 92 suites / 1181 tests、responder 9 项、Swift 替身 11 组通过；typecheck、lint（0 errors / 32 条既有 warnings）、iOS JS/DOM export 与 Swift view/module 语法解析通过。最后补充开关复位断言后，原生路由 4/4 通过。新 Swift 尚未在 Mac/UIKit 编译或目标 iPad 运行，不能据本地测试确认真实预览已恢复。

## 117d6ed 本地验证记录

- pnpm 10.28.2 冻结安装、typecheck、lint（0 errors，32 条既有 warnings）、库/Web 构建、Android/iOS JS export 通过。
- Jest 90 suites / 1176 tests 和 9 个 responder tests 通过；最后调整 LAN HTTP epoch 生成后，桥测试 15/15 通过并重跑 typecheck。
- Linux Swift 6.2.3 替身测试 10 组通过，view/module 的 Swift 语法解析通过；这些不替代 Xcode/UIKit 编译。
- Chromium 165/166：既有 `web-responder-touch-identity.spec.ts:104` 的 `pen diagnostics=false ids=1,21` 一次 touchend 残留 `[21]`；该例单 worker 独立重跑 3/3 通过，不能把整套记录为全绿。
- WebKit 缺 ICU 74、libxml2 等系统库，浏览器无法启动；未得到应用测试结果。尚无本增量的 iPad G2/G3 或压力诊断新日志。
