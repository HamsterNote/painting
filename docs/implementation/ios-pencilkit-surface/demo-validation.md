# Demo 原生验证路径

本增量对应 G2/G3 的可行性原型，不代表 G1 压力、G2 分流或 G3 物理交接通过；3.x 生产桥和 iOS 默认启用仍待门槛验收。`/pencilkit-probe` 保留原 G1 回归用途。

## 笔刷设置后恢复手势隔离（db07021，Mac 本地通过，实体未验）

已核对 Mac 评论 `01a16ea3-03ae-7dab-8c54-f48ca8440939` 及附件 `ham66-db07021-local-evidence.zip` 的编译日志、UIKit 状态/调用栈、完整 trace 与截图，交付工程复测候选 **`db07021ddaca5fe052e6e6cf9303d4cf06cbfc93`**（原生/JS 同 SHA，兼容标识 **7**）。本轮仅记录验证结果，未提交 EAS、重建真机验收包或安装实体二进制，未更改生产代码或 G1。

- Xcode 26.6（17F113）/ Swift 6.3.3：真实 Simulator SDK 契约、host 23 组、指定 Jest 5 suites / 80 tests、WebKit 2/2、冻结安装与库构建均通过。完整 Debug app 重新编译、安装、启动成功，构建日志为 `SUCCEEDED`，耗时 41.45 秒；既有 Constants/依赖、启动和 run-loop 告警仍在。
- 实际 UIKit 初始关闭、开→关、颜色/宽度/不透明度及工具/布局变化后的最终状态均为 DOM 兄弟层、drawing/raw 两识别器禁用；开启时为 `gesture-ancestor`，两者启用，画布 `1032x1006`。DOM/WKWebView 地址全程相同，没有在调试器中手动改值。
- 尺子策略先关闭原生输入、保持 bridge 连接，再经真实 DOM 控件和 Expo RN props 更新笔刷；三个 setter 的 `applyTool` 返回断点均读到两个识别器禁用、DOM 不在 PKCanvas 祖先下。开→关事务内若 setter 先于关闭 prop 执行，中间快照仍为旧开启状态；完整事务结束后禁用。不能混淆 setter 返回时的配置状态与事务最终状态。
- iPad Pro 13-inch（M5）/ iOS 26.3 Simulator 的两笔自由笔、两笔 Line、首笔后改笔刷、undo/redo、工具切换和再次开关后四条历史路径可见。最终 trace 为 361 条、丢弃 0、`objectCount=4`、`active=null`、`pendingCommits=[]`，输入来源均为 `touch`；原生绘制计数为 0。本轮日志未见 Native action 缺失或 `handoff-stalled`。

已知诊断文案问题：开关请求开启但被尺子等策略停用时，实际 `web-sibling` 被状态标题显示为“PencilKit 原生宿主未连接”。这是待修正文案，当前应结合 `routing` 和实际识别器状态辨认；不能把标题当作原生绘图通过或实际宿主断连的证据。该候选没有声称所有 UI 文案均正确。

旧实体在更新 checkout/Metro 前仍需密码解锁，进程查询失败，没有实体 Safari/Xcode/WebContent 冻结栈；Mac 未主动 Reload、重启或安装。实体 Pencil 两笔、真实预览像素、活动 PK 工具期间的延迟笔刷应用、冻结恢复以及 G2/G3 仍未验证。后续须先解锁并保留旧现场取证；若现场丢失，先准备调试再最小复现。测试本修订需要包含上述 Swift SHA 的新原生二进制，不能在旧标识 6 IPA 上仅 Reload；本轮候选交付不授权发包。

以下记录修订依据及重跑方法；Mac 门槛已按上述证据核验通过，不能将其扩大为实体通过。

已核对 Mac 评论 `01a16e87-e42c-7938-9f25-4656a35766d8` 和附件 `ham66-ba9aadb-local-evidence.zip`。`ba9aadb` 的真实 SDK 契约、Swift host 22 组、Jest 80 项、WebKit 2/2 及 Xcode 26.6 / Swift 6.3.3 完整 Simulator 编译均通过，但实际关闭状态的 drawing recognizer 仍为 `isEnabled=true`，**该修订未达到本地交付门槛**。

真实主线程条件断点确认同一个识别器由 `setInkColor → applyTool → PKCanvasView.setTool → PKTiledView._updateDrawingGestureEnablementWithInk → UIGestureRecognizer.setEnabled(true)` 重新启用；DOM 的确在 PKCanvas 兄弟层，raw observer 已禁用，同一 DOM/WKWebView 地址保持。Simulator 的自由笔两笔、Line 两笔、undo/redo、切工具及开关后四笔可见，trace 为 434 条、无丢失、`active=null`、`pendingCommits=[]`；输入全为手指，不能证明实体 Pencil 冻结已修复。日志还有既有 Constants/依赖、Inspector websocket reset 和 run-loop 告警。

本修订在 `canvasView.tool` 设置返回后立即重新执行 `applyDemoInputRoute()`，覆盖颜色、宽度、不透明度以及活动原生工具结束后的延迟笔刷应用。没有增加定时器、全局手势观察或改动采样器。Swift 替身现在模拟真实 SDK 的 `setTool` 自动启用副作用，新增第 23 组回归覆盖初始关闭、开→关、多次笔刷变更及开启模式的延迟应用/路由；新测试在加修复前明确失败。DOM 四个关闭场景和浏览器两项连续 pen 用例增加首笔后改颜色再画第二笔、undo/redo、工具切换和历史保留。

本轮 Linux 本地通过：Swift 6.2.3 host 23 组、指定 Jest 5 suites / 80 tests、Chromium 2/2、容器 WebKit 26.4 2/2、修改 TS 文件 lint/格式检查。真实 Apple SDK 检查明确 SKIP；不沿用 `ba9aadb` 的 Mac 编译成功作为新 SHA 的验证结论。

仍使用未发布的兼容标识 **7**，但必须按本轮新 SHA 重新编译，不能复用 `ba9aadb` Simulator 二进制或 Reload 旧标识 6 IPA。Mac 需重跑 `node scripts/test-pencilkit-g1.mjs`（真实 SDK + host **23 组**）及下节 Jest/WebKit/库构建命令，完成 Xcode 26.6 / Swift 6.3.3 本地编译；用 LLDB 读取实际关闭→开启→关闭时两个识别器、DOM/WKWebView 身份和祖先关系，尤其记录颜色/宽度/不透明度修改后及工具切换、重新布局后的关闭状态。不得在调试器中手动改写识别器状态充当成功；短暂的 SDK setter 内启用不是最终状态，须检查 `applyTool` 返回后仍禁用、开启时恢复 `gesture-ancestor`。

旧实体设备在更新前仍 `passcodeRequired=true`，进程查询失败，没有取得实体 Safari/Xcode/WebContent 故障栈，也没有主动 Reload 或重启。若现场仍在，继续保留；设备解锁并建立调试连接后优先取证。Mac 本轮门槛通过前不交付实体复测候选，不提交 EAS、不重建验收包、不改 G1、不宣告实体冻结或 G2/G3 通过。

## App 关闭 PencilKit 后的手势隔离修订（ba9aadb，Mac 门槛未全通过）

修勾已明确复现条件：在 App 内关闭 PencilKit，冻结前没有画过原生笔；Pencil 第一笔可画，第二笔开始画布和顶部工具栏均无响应，手指没有该问题。当前实体安装版本仍为 `bc337be` / 标识 6。尚无故障时的 Safari/Xcode/WebContent 调用栈，不能把此前桌面或 Simulator 手指测试通过视为实体冻结已修复。

源码确认的隔离缺陷是：关闭状态仍把 DOM 放在 PKCanvas 绘图识别器祖先下，并保持绘图识别器和 raw observer 启用，仅在接收回调中拒绝触摸。本修订将同一个 DOM 容器移到 Expo host 内 PKCanvas 的兄弟层，停用两个原生识别器；PKCanvas 不再向该兄弟视图转发 hitTest。原生模式恢复公共 drawing recognizer 的真实祖先路由。重复关闭、布局更新及 epoch 重置不能重新启用原生识别器；关闭期间的 raw 会话丢弃，不伪造完成样本。DOM/controller/history 实例保持，G1 采样器不变。

运行时状态分别报告 `routing=web-sibling`（关闭/Web 工具）和 `gesture-ancestor`（原生绘图）。原生兼容标识升至 **7**，旧标识 6 IPA 仅 Reload 无法测试本修订；本轮不提交 EAS、不重建验收包。

回归：Swift 生产 view 的新用例覆盖首次关闭、反复更新、开→关、活动采样取消、新 epoch、两种 prop/mount 顺序、同一 DOM 身份/坐标和卸载。该用例在旧源码上首先因 DOM 仍是 PKCanvas 后代而失败，验证的是结构隔离缺口，不是模拟真实 UIKit 卡死。浏览器两项用例改为连续两笔相同 pointerId 的 pen，再 undo/redo、切工具和鼠标绘制；DOM host 既有关闭/待退休关闭 × 自由笔/Line 的四个集成场景保留。合成 PointerEvent 不冒充实体 Pencil 系统派发。

Linux 本地：Swift 6.2.3 host 22 组、指定 Jest 5 suites / 80 tests、Chromium 2/2、容器 WebKit 26.4 2/2、typecheck、变更 TS 文件 lint/格式检查通过；真实 Apple SDK 检查明确 SKIP。本轮 Mac 门槛通过前不交付实体复测候选。

Mac 保留 `apps/playground/app.json` 的 projectId/router/加密配置，按文末快进方式合并本分支后依次执行：

```bash
node scripts/test-pencilkit-g1.mjs
pnpm exec jest --runInBand packages/painting/src/__tests__/layered-pencilkit-host.test.tsx packages/painting/src/__tests__/core/layered-tools.test.ts packages/painting/src/input/native/__tests__/pencilkitDemoBridge.test.ts tests/jest/native/layered-dom-route.native.test.tsx tests/jest/native/pencilkit-demo-version.native.test.tsx
pnpm exec playwright test --config playwright.webkit.config.ts tests/ui/layered-editor.spec.ts --grep 'plain Web' --workers 1
pnpm run prepare:playground-artifacts
```

使用 Xcode 26.6 / Swift 6.3.3 核验真实 SDK 契约及 22 组 host，完整编译并安装本地 Simulator app（标识 7）。优先验证关闭时 `web-sibling` 且 DOM 不在 PKCanvas 祖先下、两个识别器禁用；开启为 `gesture-ancestor`，再次关闭仍保留同一 DOM 和历史。核对自由笔/Line 两笔、undo/redo、切换工具，避免用重复手指 smoke 替代这次路由检查。回传原生/JS SHA、编译日志和路由/手势状态证据。

若实体旧故障页面还在，先保留页面、不 Reload、不重启，由 Mac 建立 Safari/Xcode 调试连接后取暂停栈、主线程/WebContent 状态和 gesture trace；若现场丢失，先准备调试再做一次最小定位。设备是否解锁尚未确认。取得 Mac 本轮门槛前不安排修勾在旧 IPA 上测试新 Swift；不宣告实体冻结、G2/G3 或整体验收通过。

## 纯 Web 首笔冻结的早期定位（历史，测试增量）

2026-10-24 修勾在原生/JS `bc337be`、兼容标识 6、已安装 build `0300fc01-7b3a-4785-879c-e0c9af6cb7fa` 上确认实体 Pencil 跨笔不串笔，但报告纯 Web 的 pen 和 Line 均在完成第一笔后冻结。该单项 Pencil 结果不代表工具切换、Web、长期绘制或 G2/G3 验收通过；此版本不能作为整体验收通过版本，不再要求在冻结路径反复绘制。

本轮没有生产代码修复，新增的是定位用回归：

- `tests/ui/layered-editor.spec.ts`：普通 `/layered-editor`，无 diagnostics、fixture、native connection 或交接延迟。自由笔与 Line 分别首笔提交后再画、undo/redo、切换工具画第三笔、切回画第四笔；检查四笔可见、首笔 path 保持、无 pageerror/alert。使用合成 pen PointerEvent 和真实浏览器鼠标流，不代表实体 Pencil 输入。
- `packages/painting/src/__tests__/layered-pencilkit-host.test.tsx`：默认关闭，以及 native 已提交但尚未退休时关闭，两种状态各覆盖自由笔和 Line。使用实际 DOM board/controller/bridge，验证首笔后续画、undo/redo、双向工具切换和迟到 native 消息，检查历史、可见性及会话已清空。Canvas/布局为测试替身，不验证 UIKit 派发。

结果：Chromium 新用例 2/2、WebKit 26.4 新用例 2/2、DOM 集成文件 11/11 通过；新增四个集成场景也在原生产代码上通过，**未复现设备冻结，不能据此声称已修复**。WebKit 在 rootless Podman 的既有 `localhost/ham40-webkit:noble` 镜像运行，使用 Playwright 1.59.1 / WebKit 2272；Ubuntu 26 宿主直接启动因缺系统库失败，不计作应用失败。已有 Chromium 活动/交接与工具回归 2/2 通过。变更测试 lint/格式检查通过。生产 Swift、原生兼容标识、G1、依赖和锁文件未改。

还缺设备故障的准确入口、输入来源和冻结调用栈：基名 Web 路由完全不挂载原生模块；iOS App 关闭 PencilKit 后仍保留 PK 宿主及同一 DOM controller。两者不能混为一条路径。现有代码中关闭开关会卸载 DOM native connection/guard，待退休的 presentation 和输入资源也会清理；上述集成测试未发现 controller 被污染，但不能排除 UIKit/WKWebView 手势状态的问题。

Mac 本轮保留 `apps/playground/app.json` 改动，快进任务分支并执行：

```bash
pnpm exec playwright test --config playwright.webkit.config.ts tests/ui/layered-editor.spec.ts --grep 'plain Web' --workers 1
pnpm exec jest --runInBand packages/painting/src/__tests__/layered-pencilkit-host.test.tsx
```

再区分 Safari 网页与当前 development client 的 `/layered-editor?pencilkit=0`：记录是全新进入关闭状态，还是原生绘制后关闭，以及 Pencil/手指/鼠标来源。Simulator 先验证关闭状态与开→关后，自由笔和 Line 首笔后续画、undo/redo 和工具切换；原生计数为 0 的手指 smoke 不能排除实体 Pencil 专属故障。

对能复现的环境只做一次最小定位并停止：使用 `diagnostics=1&traceGestures=1`，导出 `window.__layeredGestureTrace.snapshot()`，保留首次 pointerup/end/commit/presentation 之前后的最后记录、文档数和活动会话。若 JS 已无响应，优先 Safari Web Inspector 暂停取调用栈，并在可调试时记录 Xcode 主线程/相关线程与 WebContent 状态；截图不能区分 JS 忙循环、WebKit 渲染或 UIKit 手势等待。记录本轮原生 SHA、JS SHA、URL、系统版本和日志。未取得复现或调用栈前，此测试增量只供定位，不是修复候选，不重建验收包或提交 EAS。

2026-10-24 已核对 Mac 评论 `01a16e4c-3b30-74af-a8ff-d78412b7c11f` 及附件 `ham66-eb9d72f-local-evidence.zip` 的日志、两份完整 trace 和最终截图：

- JS checkout `eb9d72f`，Simulator 原生 `bc337be` / 标识 6；macOS 26.3.1 arm64，iPad Pro 13-inch（M5）/ iOS 26.3。Mac WebKit 26.4 两项 2/2、DOM 集成 11/11 通过；首次因缺少 WebKit 包在启动前失败，安装浏览器后的原命令重跑通过。
- 初始关闭与开→关后的自由笔/Line 可续画、undo/redo、切换工具。两份 trace 分别为 4/9 个对象、445/934 条记录、`dropped=0`、`active=null`、`pendingCommits=[]`；所有事件来源均为 `touch`，最终为 `presentation/visible`。最终截图有九笔可见。该结果没有实体 Pencil，也没有真实待退休原生笔后关闭；不能覆盖用户报告的全部条件。
- 本轮运行日志未见 action 缺失或 handoff 故障，仍有既有 `kCFRunLoopCommonModes` 告警。早期横向手指操作曾退回旧页面，随后纵向操作完成上述验证；导航手势是否导致该现象未诊断，不能写成首笔冻结根因。
- 实体 iPad（iPadOS 18.7.10）进程查询返回 CoreDevice.ActionError 3 / StreamingAction 无法读取设备，锁状态 `passcodeRequired=true`。没有重启/Reload 实体 App，没有取得故障时的 Web Inspector/Xcode/WebContent 栈。Simulator iOS 26.3 的通过也不能替代目标 iPadOS 18.7.10 的结果。

当前等待修勾确认入口（Safari 网页或 App 内关闭）、输入来源（Pencil 或手指）、是否先画过原生笔，以及解锁目标设备以继续抓栈。若故障页面还在，保留页面，不 Reload、不重画；若现场已丢失，先由 Mac 准备调试连接再安排一次最小复现。未定位/修复首笔冻结，不交付候选。该次 Mac 结果唤醒已自动停用，后续按用户补充信息恢复定位。

## 32 笔后空预览退休与 Line 切换修订（bc337be，历史 Mac 验证）

`42314ff` / 兼容标识 5 的 EAS build `c59cb30d-841a-493f-815e-e90ea9c54ff7` 已安装到实体 iPad。修勾报告上一笔预览未退休时下一笔复用旧笔迹，以及 PencilKit 笔后绘制 Line 卡死。截图为起笔/完成/提交 32、tool 结束 32、待交接 2、待退休/已确认 2/30、PK 存量 0、`handoff-stalled`。该版本实体未通过，不再继续反复绘制；此前的 Mac 编译与 smoke 通过记录不能替代本轮验证。

本地确认并修复的缺陷：

- 退休账本此前要求每个完成笔都有 PKStroke；空的已结束笔会留在队首，后续 PKStroke 可能被分配给旧 ID。此前若实际 drawing 变为 0，而账本仍有索引，则直接返回、永久无法清理。现在 raw end 与 PK tool end 均到达后，将实际没有预览的笔登记为空；实际空 drawing 清除幽灵索引，只有收到该 ID 的退休请求才发真实回执。没有待完成周期的迟到无主 PKStroke 会移除，不能复活已退休 ID；tool end 先于 raw end 时仍保留尚未绑定的预览。活动 PK 工具期间仍不改写 drawing，也不按超时伪造退休。
- 每次 PK tool end 及相同笔刷 prop 都曾无条件重设 PKInkingTool。现在只在笔刷实际变化且工具空闲时应用一次，活动期间的变化保留到结束。避免收尾与无关状态更新重复改动原生工具；没有设备调用栈，不能据此断言这是全部实体串笔根因。
- Line 等新增形状起笔此前会准备全文档的命中查询，重复计算所有历史自由笔轮廓/布尔几何。现在只有 selection/eraser/lasso 准备查询；新增形状不需要扫描历史。这消除了可复现的主线程多余工作，尚未证明设备报告的卡死已全部解决。

新增 DOM 集成回归经过真实 controller、native bridge、输入适配器和 SVG 历史：上一笔等待退休时第二笔起笔，旧回执到达不能改写当前 samples 或历史 path；native 笔后 Line 在退休回执交错到达时完成，历史可见、undo/redo 与再画 native 笔均可操作。Swift 生产 view 协议回归覆盖 32 个交错有/无 PKStroke 的周期、活动期间延迟退休、空预览切至 Web 工具后队列清空、切回后继续绘制，以及笔刷延迟应用且不重复设置。另测迟到 drawing/raw end、空 drawing 与下一笔身份隔离。它们是本地集成测试，不是实际 PencilKit 像素或 UIKit 系统派发的端到端证据。

本地验证：Jest 93 suites / 1224 tests、responder 9 项、Swift 6.2.3 host 21 组、typecheck、lint（0 errors / 32 条既有 warnings）、库构建、iOS JS/DOM export、变更文件格式检查通过。生产采样器、G1、手指 Web 路由、依赖与锁文件保持不变。

本轮原生兼容标识升为 **6**；旧标识 5 IPA 加载新 JS 会明确提示构建不匹配，仅 Reload 不含本次 Swift 修订。本轮只核验并交付候选，不提交 EAS、不重建真机验收包。Mac 已保留 `apps/playground/app.json` 原有 projectId/router/加密声明，按文末快进流程合并任务分支，依次运行（避免库构建与 Jest 同时写产物）：

```bash
pnpm install --frozen-lockfile
node scripts/test-pencilkit-g1.mjs
pnpm exec jest --runInBand packages/painting/src/__tests__/layered-pencilkit-host.test.tsx packages/painting/src/__tests__/core/layered-tools.test.ts packages/painting/src/input/native/__tests__/pencilkitDemoBridge.test.ts tests/jest/native/layered-dom-route.native.test.tsx tests/jest/native/pencilkit-demo-version.native.test.tsx
pnpm run prepare:playground-artifacts
```

2026-10-24 已核对 Mac 评论 `01a16e1d-3da1-7f13-a970-d86a334997ee` 及附件 `ham66-bc337be-local-evidence.zip`，现交付实体工程复测候选 **`bc337bef9ce674af9c63b1bec94e7723d998abc6`**（原生/JS 同 SHA，兼容标识 6）：

- Xcode 26.6（17F113）/ Swift 6.3.3：真实 Simulator SDK 契约检查、host 21 组、指定 Jest 5 suites / 75 tests、冻结安装和库构建通过。完整新 app 编译、安装启动成功，诊断含 `BUILD SUCCEEDED`，仍有既有 Constants 弃用和依赖警告。
- iPad Pro 13-inch（M5）/ iOS 26.3 Simulator：直接入口 `1032x1120`、普通路由开→关→开后 `1032x1140`，均为 `gesture-ancestor`。手指 Web 笔迹经开关保留，完成 Line 后 undo 删除、redo 恢复，再切自由笔继续绘制；最终三笔均可见、控件可操作。附件的 Line 与 redo 截图一致，undo 截图不同。
- 本轮 Metro/runtime 未见 Native action 缺失或 handoff-stalled。runtime 有一条 `kCFRunLoopCommonModes` 告警及启动/后台模式告警；smoke 未观察到界面卡住，不能将此描述为零告警或长期稳定性证明。

Simulator 无真实 Pencil，原生起笔/完成/提交/tool 结束等计数全为 0；这些交互来自手指 Web，不能证明跨笔原生预览、退休与实体 PencilKit→Line 卡死已恢复，更不代表 G2/G3 通过。后续实体复测须使用包含候选 Swift SHA 的新二进制，不能在旧标识 5 IPA 上仅 Reload。优先记录两个真实 Pencil 场景：上一笔预览待退休时立即画下一笔，各笔身份与历史独立、空闲后队列/待交接/待退休归零；完成 PencilKit 笔后切 Line 并完成，随后 undo/redo、工具切换和再画均可继续。保留视频、状态计数与二进制/JS SHA；若再次串笔、`handoff-stalled` 或卡死立即停止，采集线程栈和日志，不继续重复绘制。G1 Probe 保留回归，HAM-66 继续 `in_progress`。

## PKCanvasViewDelegate 结束入口修正（42314ff，历史，实体复测未通过）

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
- 普通 `/layered-editor` 和首页默认仍是 DOM，顶部显示 `Web / DOM`，PencilKit 开关可直接切换验证参数。当前原生兼容标识为 `demoBridgeVersion=7`，旧 IPA 会显示构建不匹配；先完成首节 Mac 本地验证，本轮不重建验收包。
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

本节记录 Swift 增量的本地编译流程。本轮须使用首节标识 7 的原生代码，先做 Simulator smoke，不重提 EAS。

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
