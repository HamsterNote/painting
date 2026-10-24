# Tasks

本清单为 apply 的工作交接，当前所有实现项均未执行。修勾已确认 D1-A / D2-A / D3-A；后续改变方案时先修订 proposal/design/specs/tasks。G1-G3 不通过则停止后续生产集成，提交证据并重新评审。

## 1. 决策与验收条件

- [x] 1.1 记录修勾对 D1（raw + 原生临时墨迹 + PF）、D2（Pencil-only 原生、手指与其他工具 Web）、D3（中心化 history）的逐项结论；验证：HAM-66 评论 `01a154b5-a92b-7f0f-9d50-44c3038e5bd6` 回复“同意采用”，对应提案 D1-A / D2-A / D3-A，已同步 proposal/design。
- [ ] 1.2 确认可使用的 macOS/Xcode、签名开发环境、iPad/Pencil/OS 和高帧率拍摄设备；在验收文档记录版本与准备步骤，验证具备 iOS development build 和实体 Pencil 测试条件，不请求或记录密钥。

## 2. 原生可行性实验与门槛

- [ ] 2.1 建立仅验证配置启用的最小 Expo Module/Swift PKCanvasView 与 RN host 原型（建议 `packages/painting-pencilkit/`），接入 SDK 57 autolinking、iOS 16.4 与 TS view 接口；验证 prebuild/Pods/Xcode 真机编译、安装和显示成功，记录构建提交，Web/Android 无原生模块导入。
- [ ] 2.2 执行 G1：使用公开 UIKit 接口同步采集 Pencil 主/真实 coalesced touches，落实事件去重、pressure capability、时间基准与 estimated updates 规则；以实体 Pencil 的 tap、快速短笔/长笔日志验证 down/up 完整且不抢占 PK 手势，交付样本来源证据，失败停止。
- [ ] 2.3 执行 G2：在实际 RN/DOM/WKWebView 组合中验证 Pencil 与手指、工具栏/文字/尺子排除区域的分流；真机连续手指绘制、双指导航和 Pencil 非自由笔工具都收到真实输入，中文键盘可用，无伪造 DOM 轨迹，失败停止并重评 D2。
- [ ] 2.4 执行 G3：为原型接入最小 raw→PF 历史及按 commit 身份的 ready/retire/visible 交接，注入延迟和 Web 忙碌；以至少 120fps 外部视频验证首笔、快速连续笔、半透明与乱序 ACK 无可观察空窗/双显，失败停止并重评交接，不用固定等待替代。
- [ ] 2.5 汇总 G1-G3 的设备/构建/日志/视频与 PK→PF 外观对照，取得修勾对形状收敛的确认；验证三项门槛和外观结论有独立证据后才进入完整集成。

## 3. 版本化桥与 controller 接入

- [ ] 3.1 在 `input/native/layeredSemanticContract.ts` 及接收适配器补充 protocol version、epoch、begin lease、布局/viewport 版本、结果原因和独立呈现消息；用序列化/校验测试验证非法版本、无效样本、失效 lease 与缺字段会明确拒绝。
- [ ] 3.2 在 RN host 与 `LayeredEditorDom` 建立实际 Expo DOM callback/action 桥，发布画布 frame、命中排除区和 arm-state；验证 ready 前禁用输入、end 早于 begin 回复仍只提交一次、拒绝 begin 不写文档，记录真桥往返结果。
- [ ] 3.3 将 view-local point 转成锁定 viewport 下的 world DIP，映射 native source、压力、毫秒时间、连续 phase/sequence 与落笔快照；以纯映射测试和 0.5/1/2 倍视口设备对照验证无密度倍率错误、重复坐标/up 零值保留、无预测或路径点入库。
- [ ] 3.4 实现完整批次验证后进入 controller begin/update/end/commit（不重复首 down），保留 pending candidate 失败原子与同 commitId 重试；测试同 payload duplicate、异 payload conflict、顺序拒绝及 cache/commit 失败无部分文档/history。
- [ ] 3.5 实现每笔样本/字节、待交接队列限额和必要 transport 分块组装（初值见 design），加入无进展故障、结果查询与显式恢复；注入超限、缺块、ACK 丢失、重复重试与断桥，验证不截断成功、不生成新 commitId、不无限增长或假清屏。
- [ ] 3.6 接通统一输入模式/自动 Pencil 检测、begin 竞争与 viewport freeze；测试自动 touch→pen 抢占、已有双指 pair 拒绝抢占、强制手指/笔、模式切换、掌触 drain 与过期 revision，验证工具/文档/history 不因切档改变。

## 4. 原生预览、历史与生命周期

- [ ] 4.1 完成 PK pen 预览映射、pencilOnly、关闭本地滚动/缩放/ToolPicker、程序化更新来源标记；真机验证颜色/宽度/opacity 使用落笔快照、布局变更取消会话、程序化 redraw 不回传新笔，ruler 约束输入使用 Web。
- [ ] 4.2 隔离 PK 本地 undo 注册，接通可用的工具栏/键盘/系统撤销入口到 controller；以 Pencil→文字→形状的三次撤销/重做验证统一顺序、revision 单调、原生无幽灵笔，collecting 时 undo 不提交部分笔。
- [ ] 4.3 将通过 G3 的交接方案接入 `PresentationCoordinator`，按 epoch/commit/presentation identity 管理有限待交接预览；测试 ACK 延迟/乱序、下一笔、交接前 undo/删除与混排对象顺序，真机视频验证无全局清屏导致的新笔丢失或双重变深。
- [ ] 4.4 实现 cancel、后台/前台、卸载、工具/模式切换、layout 失效及 WebView 重载清理；以故障注入测试和真机重入验证旧 end/ACK 不影响新 epoch，已提交对象保留，delegate/订阅/手势/计时器释放。
- [ ] 4.5 接通文字焦点/键盘让渡及回到绘制的重新 arm；真机完成中文 IME、选择、复制粘贴、确认/取消后再用 Pencil 绘制，验证文字一次事务、无覆盖层拦截或额外 native commit。

## 5. Playground 与回归交付

- [ ] 5.1 在 `/layered-editor` 提供 iOS 验证配置、清晰的原生 ready/构建不匹配/故障状态和受控关闭配置；验证 Web/Android 路由、现有 `/native-adapter-smoke` 不变，关闭配置不丢 schema 3 已提交数据。
- [ ] 5.2 补充默认关闭且有界的 native 诊断与数据往返验证入口，只记录必要的版本、会话、样本计数、延迟及拒绝原因，不记录文档文字/图片；验证启用后能导出对应故障证据、关闭后不采集，原生文档 serialize→parse→Web 重放一致。
- [ ] 5.3 执行 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm test:ui`、`pnpm test:webkit`，以及 `pnpm run build`；记录逐条结果，验证既有 Web/pressure/history/input-mode/文字测试保持通过，不以 mock 代替设备结论。
- [ ] 5.4 运行 `pnpm --filter @hamster-note/painting-playground build:android` 和 iOS development build 编译/安装；验证 Android 现有入口可构建、iOS 自定义模块已在新二进制中，沿用 prebuild 配置而非只手改生成工程。
- [ ] 5.5 在 `docs/implementation/ios-pencilkit-surface/` 交付重建/启动/路由/诊断/回滚说明与逐项结果模板；设备执行 tap、快慢/长笔、真实压力及模式、三档笔指/双指、混排工具/变换/undo/redo、文字、缩放/旋转、后台和断桥恢复，保存设备/OS/Pencil/构建信息及 G1-G3 视频/日志。
- [ ] 5.6 对照全部 delta specs 逐项核验，修勾接受设备表现后才提交 iOS 默认启用改动；验证可受控关闭并保留文档，列出未通过项和证据边界，不宣称未经测试的平台/设备通过。
