# Demo 原生验证路径

本增量对应 G2/G3 的可行性原型，不代表 G1 压力、G2 分流或 G3 物理交接通过；3.x 生产桥和 iOS 默认启用仍待门槛验收。`/pencilkit-probe` 保留原 G1 回归用途。

## 入口与边界

- 新 iOS development build：打开 `painting-playground:///layered-editor?pencilkit=1`。自由笔 Pencil 在真实 RN 原生视图中预览；raw 通过 Expo DOM 的串行消息/回调送到原 DOM controller，生成 schema 3 / PF 历史和统一 undo/redo。
- 普通 `/layered-editor` 和首页默认仍是 DOM，顶部显示 `Web / DOM`，PencilKit 开关可直接切换验证参数。旧 IPA（包括 `3c0f8f1b-2b00-49bd-be82-a7ccba99511d`）缺 `demoBridgeVersion=2`，显示构建不匹配；此次命中过滤修复需要新原生包。
- Web/Android 使用基名路由，不导入 PencilKit 原生运行时。选择、文字、形状、尺子等工具继续走真实 Web 输入。Pencil-only 不负责手指穿透；原型以 UIKit 按触摸类型命中，将手指交给底层 WKWebView，并上报画布 frame 与控件排除区。
- 原生 begin 经过同一个输入仲裁器，锁定 controller 会话、笔刷和 viewport。end 只批量追加剩余真实样本，保留原始压力与接受顺序；取消、畸形或 overflow 整笔拒绝，不合成 DOM PointerEvent、raw up 或 PK 路径点。
- 每笔最多 50,000 样本，最多 4 笔待交接，transport 最多 12 条消息；消息/回执缓存有界。等待 5 秒仅进入可恢复故障，不按超时清屏或宣称已显示。重试查询/重用原 commitId，已提交文档保留。
- 历史节点就绪后，按原生笔身份移除对应 PKDrawing 临时 stroke，再允许显示 PF 历史。不会因旧确认清空下一笔；这只是候选协议，跨进程可见空窗、形状收敛和半透明仍须 G3 视频评估。

## 运行时确认

- `PencilKit 原生已启用` 必须同时具有 DOM 启用状态、原生 onReady、当前 context 的原生配置回执，以及非零原生画布尺寸。仅模块存在不显示此状态；等待连接/配置、停用、布局未完成、构建不匹配与故障分别显示。
- 状态下方始终显示原生起笔、完成、文档提交计数。起笔/完成仅来自有效原生回调，提交仅在 DOM controller 回执成功后增加；重复回执不重复计数。画一笔后依次增加才证明实际经过原生输入链路，配置就绪本身不代表画过原生笔。
- `hit=pencil` 是 UIKit 类型命中，`non-pencil` 是手指事件穿透，`control` 是控件排除区，`no-touch-metadata` 是系统尚未提供触摸元数据；最后一种仍穿透、不冒充 Pencil。请同时回传状态栏截图和笔迹表现，便于区分命中与提交问题。
- 修复移除了 Pencil 的 `UITouch.location` 与 hit-test 点必须相差小于 1pt 的限制；两次坐标读取没有这种一致性保证。画布边界、控件排除、触摸类型和结束状态过滤保留，手指单独触摸仍走真实 WebView。新增 Swift 替身回归覆盖位置尚未更新的 Pencil、手指、掌触组合、已结束 Pencil、无元数据、停用和控件命中；是否对应本次真机失败仍须新包证据确认。

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

不能快进或有本地冲突时保留工作树，不 reset/覆盖。此增量含 Swift、新事件与 props，必须由 Mac 先检查 Xcode 26.6/Swift 6.3.3 编译，再按 README 的 Xcode/EAS 路径重建、安装新的 development build。仅 Reload 或重装旧 IPA 不会带入代码；不要重跑旧 build ID。本次 Linux 交付未提交 EAS build，未证明 UIKit 编译通过。

安装新包后连接既有 LAN Metro，再进入上述显式 Demo 路由，或在 Demo 顶部打开 PencilKit 开关。原生就绪后应显示启用状态；画一笔确认三项计数。开/关验证参数不要在有未保存文档时销毁路由；原型文档仍是现有 controller 的内存生命周期，刷新不会自动保存。

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

## 本次命中修复验证

Jest 92 suites / 1181 tests、responder 9 项、Swift 替身 11 组通过；typecheck、lint（0 errors / 32 条既有 warnings）、iOS JS/DOM export 与 Swift view/module 语法解析通过。最后补充开关复位断言后，原生路由 4/4 通过。新 Swift 尚未在 Mac/UIKit 编译或目标 iPad 运行，不能据本地测试确认真实预览已恢复。

## 117d6ed 本地验证记录

- pnpm 10.28.2 冻结安装、typecheck、lint（0 errors，32 条既有 warnings）、库/Web 构建、Android/iOS JS export 通过。
- Jest 90 suites / 1176 tests 和 9 个 responder tests 通过；最后调整 LAN HTTP epoch 生成后，桥测试 15/15 通过并重跑 typecheck。
- Linux Swift 6.2.3 替身测试 10 组通过，view/module 的 Swift 语法解析通过；这些不替代 Xcode/UIKit 编译。
- Chromium 165/166：既有 `web-responder-touch-identity.spec.ts:104` 的 `pen diagnostics=false ids=1,21` 一次 touchend 残留 `[21]`；该例单 worker 独立重跑 3/3 通过，不能把整套记录为全绿。
- WebKit 缺 ICU 74、libxml2 等系统库，浏览器无法启动；未得到应用测试结果。尚无本增量的 iPad G2/G3 或压力诊断新日志。
