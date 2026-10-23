# Demo 原生验证路径

本增量对应 G2/G3 的可行性原型，不代表 G1 压力、G2 分流或 G3 物理交接通过；3.x 生产桥和 iOS 默认启用仍待门槛验收。`/pencilkit-probe` 保留原 G1 回归用途。

## begin/finish 时序修复与本轮复测

`2dae6e8` 已在 Mac 通过 Xcode 26.6 / Swift 6.3.3 编译和 Simulator smoke，确认 `gesture-ancestor` 且没有本轮新增 action 注册错误；对应 EAS build `4f9e73d2-57d6-450b-97fa-addfbcddf386` 已安装。实体 iPad 截图已证明 `hit=pencil`、起笔 1、PK预览 1，但以 `invalid-or-stale-begin` 停止，完成/文档提交为 0。旧错误合并了多个拒绝条件，截图本身不能确定是哪一个条件。

本次只改 JS/TS bridge，修复两项可复现问题：

- native begin 在异步传输期间，DOM 同原点的尺寸或排除区更新会推进配置 revision，旧实现按 key 不同直接拒绝，并发出 retire 取消原生采样。现在最多保留 32 个已发布且坐标映射、笔刷、工具和输入策略相同的配置；起点必须同时位于旧/新画布内、且不在两者的控件排除区。原点、viewport、笔刷或策略变化会清除兼容配置，未知/过期配置继续拒绝。有效 resize 通知不再无条件取消采样；原点或 viewport 改变仍取消。
- bridge 原先在 controller.beginFreehand 的同步通知之后才登记会话，通知期间发生的取消可能被覆盖。现在先预留 starting 会话，确认输入所有权与 controller 的 collecting 身份仍一致才接受；取消或 undo 后不会重新登记。finish 使用 begin 的原始 key，配置更新不改变本笔身份，重复 finish 只提交一次。

拒绝原因现在区分 `invalid-begin-sample`、`native-input-disabled`、`native-session-busy`、`native-stroke-id-reused`、`stale-begin-context`、`begin-outside-canvas`，便于下一次设备证据定位。Probe/G1 和 Swift 均未修改，手指仍由 Web 处理。

Mac 保留 `apps/playground/app.json` 未提交配置，快进任务分支后执行 `pnpm run prepare:playground-artifacts`，重启/清理 Metro 缓存并在现有 development build Reload；本次无需重提 EAS。先单笔、再连续快笔，确认起笔/PK预览/完成/提交均增加，文档中每笔仅一个 `source=native` 对象，undo/redo 正常；再验手指、工具栏和开关。若仍暂停，回传新具体错误、计数、布局尺寸和 Metro 日志，不能用旧 `invalid-or-stale-begin` 缓存结果验收。

本地 Jest 93 suites / 1198 tests、responder 9 项、Swift 替身 14 组、typecheck、lint（0 errors / 32 条既有 warnings）、库构建和 iOS JS/DOM export 通过。尚待现有 IPA + 新 JS 的实体单笔提交复测，不能据单测宣告 G2/G3 通过。

## 入口与边界

- 新 iOS development build：打开 `painting-playground:///layered-editor?pencilkit=1`。自由笔 Pencil 在真实 RN 原生视图中预览；raw 通过 Expo DOM 的串行消息/回调送到原 DOM controller，生成 schema 3 / PF 历史和统一 undo/redo。
- 普通 `/layered-editor` 和首页默认仍是 DOM，顶部显示 `Web / DOM`，PencilKit 开关可直接切换验证参数。旧 IPA（包括 `da1c224` / `7fafe2ae-aed2-41cb-a1a5-6922d1b6d094`）缺 `demoBridgeVersion=3`，显示构建不匹配；此次宿主层级改动需要新原生包。
- Web/Android 使用基名路由，不导入 PencilKit 原生运行时。选择、文字、形状、尺子等工具继续走真实 Web 输入。iOS 原型将真实 Expo DOM 子视图挂载到公开 `drawingGestureRecognizer.view` 下的容器中，不假设该 owner 就是 PKCanvasView 本体；几何 hit-test 总是选择真实 DOM 后代，delegate 在实际 UITouch 到达后过滤 Pencil、画布边界和控件排除区。容器按坐标转换对齐 PKCanvasView，布局时协调延迟挂载的 owner。手指不由原生接管。开关关闭时仍保留同一个宿主和 DOM controller，避免切换丢文档。
- 原生 begin 经过同一个输入仲裁器，锁定 controller 会话、笔刷和 viewport。end 只批量追加剩余真实样本，保留原始压力与接受顺序；取消、畸形或 overflow 整笔拒绝，不合成 DOM PointerEvent、raw up 或 PK 路径点。
- 每笔最多 50,000 样本，最多 4 笔待交接，transport 最多 12 条消息；消息/回执缓存有界。等待 5 秒仅进入可恢复故障，不按超时清屏或宣称已显示。重试查询/重用原 commitId，已提交文档保留。
- 历史节点就绪后，按原生笔身份移除对应 PKDrawing 临时 stroke，再允许显示 PF 历史。不会因旧确认清空下一笔；这只是候选协议，跨进程可见空窗、形状收敛和半透明仍须 G3 视频评估。

## 运行时确认

- 模块、onReady、DOM 配置、非零尺寸和 `routing=gesture-ancestor` 只表示“已配置，等待原生起笔”。`gesture-ancestor` 还会检查真实 DOM 是否是公开 drawingGestureRecognizer.view 的后代，不假设 PencilKit 的内部层级；不满足则显示“原生宿主未连接”并拒绝采样。
- `unattached` 还会显示具体原因：`dom-not-mounted`、`recognizer-not-mounted`、`recognizer-outside-canvas` 或 `dom-outside-recognizer`。挂载或卸载改变路由时重新发布回执，不会因首次布局尚未就绪而永久停留在旧状态。
- 起笔/完成来自真实 UIKit 的旁路手势观察器，`PK预览` 来自 PKCanvasViewDelegate 的实际 tool-begin，文档提交只在 DOM controller 回执成功后增加。起笔、PK预览与提交均增加后才显示“原生链路已验证”；此状态只证明走过该链路，不表示 G2/G3 已通过。观察器不识别、不抢占其他手势；Probe 仍使用原 UIResponder 采样路径，Demo 关闭该路径避免重复采样。
- `hit=pencil`、`non-pencil`、`control` 现在来自收到实际 UITouch 后的过滤；不再在初始 hitTest 中查询 `allTouches`。旧二进制 `hit=no-touch-metadata` 的截图说明先前的类型命中没有得到触摸元数据，放宽坐标匹配没有解决该问题。Apple 的 [hitTest](<https://developer.apple.com/documentation/uikit/uiview/hittest(_:with:)>) 支持空 event；[手势识别器](https://developer.apple.com/documentation/uikit/uigesturerecognizer) 接收其视图及后代的真实触摸，因此本候选改为祖先手势过滤。
- 开启实验后，如果 Web 收到自由笔、非尺子、画布区域的 `pointerType=pen`，运行时断言阻止整条 Web 笔流并报告 `dom-pencil-fallback`，不会静默画 DOM 墨迹。手指、鼠标、控件、其他工具和尺子仍走 Web。关闭实验会卸载该断言。
- `onNativeState` / `onNativeReply` 始终作为顶层函数 props 注册给 Expo DOM，开关只控制连接。Expo 57 的 wrapper 按收到消息时的当前 props 查找 action，不能在关闭开关时移除函数；迟到消息由稳定 action 接收并在断开状态忽略。
- PencilKit 的原 delegate 决策被保留；候选为后代 Web 手势设置 Pencil 绘制优先级，避免双向 failure 依赖。该公开 API 组合是否兼容目标系统的 PencilKit/WKWebView、能否绘制预览，必须在 Mac 和实体 iPad 验证，替身测试不能证明。

## Mac 合并与重建

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
