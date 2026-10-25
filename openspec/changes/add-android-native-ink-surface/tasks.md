# Tasks

以下全部为后续实施任务，本轮不执行。用户评审确认本提案后，由后续执行者进入 apply。A0/A1/A2 为停止门槛，失败先修订方案，不自动更换库或扩大范围。

## 1. 评审与构建门槛 A0

- [x] 1.1 记录用户对 D1-A（Jetpack Ink）、D2（仅自由笔 stylus）、D4（平台中立桥与统一历史）的评审结论；以可追溯确认记录验证开工条件，变化先更新 proposal/design/specs/tasks。
- [ ] 1.2 在 `packages/painting-android-ink/` 建立最小 Kotlin Expo Module 与平台隔离 TS view，playground 显式依赖；锁定 Ink artifacts/版本并记录许可证、minSdk/compileSdk、AGP/Kotlin/ABI，验证冻结安装、Android prebuild 和实际 Gradle 构建/启动，不提交生成工程或覆盖本机配置。
- [ ] 1.3 验证 Ink 透明 view 与真实 Expo DOM/WebView 的宿主组合及逐笔移除能力，以实际 native view 层级、非空画面及 density/viewport 对齐记录通过 A0；若需升级基线或无法逐笔退休则停止并回评审。

## 2. Android 采样与分流门槛 A1

- [ ] 2.1 实现实际 MotionEvent owner pointer 采样与历史样本读取、单调时间、px→DIP→world 转换及能力声明；以 Kotlin 用例验证 actionIndex、多 pointer、同坐标、零/越界/缺失压力、真实 tap、历史顺序与取消，不从 Ink 路径生成 raw。
- [ ] 2.2 在包含真实 WebView 的 host 进行按来源/工具/排除区分发，隔离反向笔尖、侧键和自动手写输入影响；用真实设备验证 stylus 只接自由笔，三档手指、鼠标、双指导航、控件、Line、尺子和 IME 仍走真实 Web 输入，无合成 DOM 补偿。
- [ ] 2.3 验证活动笔冻结 viewport、掌触不抢占、模式切换取消和既有双指 pair 不被新笔劫持；保存设备事件/文档/viewport 证据通过 A1，无法可靠分流则停止，不进入后续主集成。

## 3. 呈现可行性门槛 A2

- [ ] 3.1 建立最小逐笔交接实验，将 Ink 临时笔与 DOM 最终 PF 笔按身份协调；以乱序/延迟退休用例证明旧确认不会全清新笔、前三笔退休时第四笔保留且第五笔可继续。
- [ ] 3.2 对空白首笔、连续笔、长笔、半透明、Web 忙碌与延迟桥录制至少 120fps 外部视频；逐帧核对无可见空窗、双显变深或误清并交付 A2 结论，失败停止修订，不用 ACK/固定帧延时替代验收。

## 4. 中立语义桥与统一历史

- [ ] 4.1 在 `packages/painting/src/input/native/` 定义平台中立标准化样本、能力、版本/epoch、begin lease、commitId、取消与 presentation identity 契约；用 TS 类型检查和契约用例证明 Android 不依赖 UIKit 字段，iOS 外部消息可兼容映射。
- [ ] 4.2 提取共享会话/提交接收器并保留 iOS Demo adapter，接入同一 DOM controller；用双 adapter 参数化回归验证 begin 拒绝、end 先到、锁定快照、模式检测幂等、同内容重发去重、异内容冲突和混排工具 undo/redo。
- [ ] 4.3 增加 50,000 样本/16 MiB 批次、4 笔待交接、12 条消息及回执去重缓存的有界管理；用边界用例验证整笔超限拒绝、分块未齐不提交、去重记录满后安全停止新 begin、5 秒无进展可恢复且不伪造 ACK。
- [ ] 4.4 串联系统 cancel、工具/模式/布局变化、后台/卸载、WebView 重载与恢复查询；用跨层用例验证不写半笔、不删除已提交文档、旧 epoch 不污染新笔，正常取消后下一笔无须重开开关。
- [ ] 4.5 完成逐笔 history-ready/retired/visible 的生产集成与释放资源；用故障注入验证 ACK 丢失、重复/乱序退休、undo 期间待交接及卸载清理，并再次核对 A2 场景未退化。

## 5. Playground 与可复现文档

- [ ] 5.1 新增 Android RN host 的 `androidInk=1` 显式入口、ready/缺模块/版本不匹配/暂停与恢复状态，默认关闭；以 RN 测试及实际新旧 dev client 验证状态、开关、停用后修改笔刷与连续两笔，不把正常 Web 策略停用报断连。
- [ ] 5.2 在 `docs/implementation/android-native-ink-surface/` 记录冻结安装、Android prebuild/重建、`dev:native` LAN 5266、入口 deep link、设备连接和清理步骤；按文档复跑 Android 构建/启动并记录 native/JS SHA，不把 JS export 当作原生编译。
- [ ] 5.3 在诊断开关下提供有界输入归属、采样数、提交/退休及故障记录与导出；用开关/溢出测试验证未启用无记录、输出不含文档文字/图片且可在 HTTP LAN 设备导出。

## 6. 跨平台与设备验收 A3

- [ ] 6.1 运行仓库 `pnpm run typecheck`、`pnpm run lint`、`pnpm test`、`pnpm run test:ui`、`pnpm run build:all` 及 `pnpm run pack:dry`，保存真实结果；验证 Web 无 Android 模块解析，iOS 相关 bridge/host/版本测试保持通过。
- [ ] 6.2 按既有 iOS 验证说明在具备 Apple 工具链的环境复跑 `node scripts/test-pencilkit-g1.mjs` 与 iOS export，并做实体 Pencil 开关、连续笔、取消恢复、改笔刷、Line/尺子及 undo/redo 回归；记录实际结果，缺设备项明确未验。
- [ ] 6.3 在至少一套真实压力 stylus Android 和无 stylus Android 场景完成 tap/快慢长笔、压力四模式、density/0.5/1/2 倍 viewport、三档输入、掌触、工具/IME、后台/旋转/重载、队列故障和恢复验证；记录型号/OS/刷新率/构建、事件计数、实测延迟及队列峰值，未测数值不得补写。
- [ ] 6.4 用最终集成构建复核 A2 视频并请用户确认 Ink→PF 外观收敛，交付 A0-A3 矩阵与 Web/iOS 回归证据；仍缺门槛时保持显式验证且标记未通过，不改变默认启用或将旧 iOS 门槛标完成。
- [ ] 6.5 核对三份共享 delta 与未归档 iOS change 保留一致的目标语义，验证关闭 Android 原生后已提交 schema 3 文档可在 Web 重放、历史保留；交接差异说明与回滚验证结果，本任务不自动归档其他 change。
