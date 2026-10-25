# ios-pencilkit-surface Specification

## Purpose

定义 iOS Apple Pencil 自由笔原生活动输入与临时墨迹能力，保证其与现有跨端文档、工具、输入模式及统一撤销语义兼容，并以真实设备证据验证采样、输入分流、生命周期和历史呈现交接。

## Delivery Status

2026-10-25 已验收并归档的是默认关闭、显式 opt-in 的 PencilKit 原型。下列条文保留完整生产能力与发布门槛，不表示全部已实现或设备验收通过；G1 压力、G2 全矩阵、G3 物理呈现及完整生产集成仍待核验，未授权默认启用。证据和未完成范围见 `docs/implementation/ios-pencilkit-surface/archive-verification.md`。Android 原生接入已取消。

## Requirements

### Requirement: Native Pencil input has a bounded platform scope

启用原生绘制的 iOS 编辑器 SHALL 仅将自由笔 Apple Pencil 输入交给原生活动层，最终历史显示和非自由笔工具仍由 Web 提供；尺子约束的自由笔 SHALL 保留 Web 路径。Web 与 Android SHALL 保持现有绘制路径。原生模块缺失或未就绪时 SHALL 明确报告状态，不声称原生能力已启用；开发者受控关闭原生配置后 SHALL 可使用现有 DOM 编辑器。

#### Scenario: Pencil draws through the native surface

- **WHEN** 兼容的 iOS development build 已就绪，用户在普通自由笔工具下使用 Apple Pencil 完成一笔
- **THEN** 移动时有原生临时墨迹，完成后同一笔进入 Web 历史显示及 schema 3 文档，形成至多一个事务

#### Scenario: Platform and tool boundaries remain usable

- **WHEN** 用户切到选择、套索、形状、整对象擦除、文字或尺子约束书写，或在 Web / Android 打开编辑器
- **THEN** 相应输入和显示使用既有 Web 工具能力，不触发原生自由笔提交，不要求这些平台加载 iOS 模块

### Requirement: Native raw samples preserve the document contract

系统 SHALL 仅提交实际接受的原生 down/move/up 及真实 coalesced 样本，保存 world DIP 坐标、连续 sequence、同一来源 native、时间、可选压力及锁定快照。系统 MUST NOT 将处理后的笔迹路径、预测/插值点、轮廓或原生绘图存档写入 schema 3。压力 capability SHALL 显式声明；缺失压力与真实零值 SHALL 区分，auto 在 begin 解析后整笔锁定，最终几何使用共享确定性算法。

#### Scenario: Short stroke and tap retain actual endpoints

- **WHEN** 实体 Pencil 快速短笔或原地 down/up，真实采样包含重复坐标、可用压力或真实 up 零压力
- **THEN** 保存至少首 down 与末 up，重复坐标与零值保留，sequence 连续，未增加预测或路径插值样本，最终笔迹可见

#### Scenario: Save and reopen preserve cross-platform data

- **WHEN** 保存含原生笔、文字、图片与形状的文档并在新 controller 或 Web 打开
- **THEN** 文档仍为 schema 3，原始样本、brush snapshot、resolved pressure mode、对象变换与混排顺序一致，不依赖原生绘图存档

#### Scenario: Brush changes apply to the next stroke

- **WHEN** Pencil 正在书写时修改颜色、宽度、不透明度或压力设置
- **THEN** 当前笔保持落笔快照和解析模式，下一笔才使用新设置；缺失压力不被伪造为硬件值

### Requirement: Native input preserves modes and Web interaction

系统 SHALL 保留既有三档模式、单指绘制/拖动、双指导航、笔优先检测与掌触抑制，并统一决定会话归属；本期原生通道 SHALL 只接 Pencil，手指和非自由笔工具通过可用的 Web 输入通道完成。原生覆盖层 MUST NOT 吞掉工具栏、安全控件、尺子、选择手柄或文字编辑输入，不得通过伪造 DOM 轨迹弥补被拦截的真实输入。

#### Scenario: Finger drawing survives native integration

- **WHEN** 自动档尚未检测到笔或处于强制手指档，用户先用单指绘制，再完成一笔 Pencil 自由笔
- **THEN** 两笔各产生一个独立事务，强制手指档的手指行为不因 Pencil 而改变；自动档按既有笔检测规则进入笔优先

#### Scenario: Navigation does not steal a Pencil stroke

- **WHEN** Pencil 正在书写，同时手掌或双指触摸画布，并在 Pencil 抬起后继续按住
- **THEN** Pencil 只提交一次，viewport 不改变且不补执行这些触点；触点全部抬起后新的双指手势可导航

#### Scenario: Text editing obtains real focus

- **WHEN** 用户切换到文字，进入输入框并使用中文 IME、选择及复制粘贴，随后返回自由笔
- **THEN** 原生未完成笔被取消，Web 获得真实焦点/键盘和编辑能力，完成文字为一个事务，返回后新的 Pencil 笔正常工作

### Requirement: Bridge commits are authoritative and idempotent

原生输入 SHALL 使用版本化且带编辑器世代、会话、commitId 和锁定 viewport/layout 版本的协议。只有被 controller 接受的 begin 才能完成提交，真实样本在原生收集后批量传输，系统不要求逐点跨桥。系统 SHALL 在改变文档前验证完整批次；同 commitId 同 payload 重试不得重复新增文档或历史，不同 payload SHALL 明确拒绝。样本、字节及待处理队列 SHALL 有限，超限或协议失败 SHALL 报告原因而非截断成功。

#### Scenario: Begin reply arrives after release

- **WHEN** 用户快速 down/up，正常 begin 回复晚于原生 end 到达
- **THEN** 原生批次等待权威回复；接受后只提交一次，拒绝则清理未提交预览且文档/history 不变

#### Scenario: Retry and conflicting duplicate are distinguished

- **WHEN** 已成功提交的批次因回复丢失而重发，之后同 commitId 收到修改后的 payload
- **THEN** 第一次重发返回 duplicate 且不新增历史，修改后的批次返回 conflict 且不改变原文档

#### Scenario: Invalid revision or oversized batch cannot partly commit

- **WHEN** 批次使用失效的 viewport/layout 版本、非法/不完整样本或超过公布的资源限额
- **THEN** 整笔拒绝并报告可诊断原因，不生成部分对象或 undo entry，不使用过期坐标显示最终笔迹

### Requirement: Central history is the only undo authority

系统 SHALL 将原生自由笔与文字、形状等操作放入同一 controller 撤销/重做顺序，原生绘图自身的撤销栈不得独立改变文档或恢复幽灵笔迹。程序化更新/清除原生临时墨迹 MUST NOT 生成新文档事务。撤销/重做时 SHALL 取消未完成输入并使预览与当前文档一致。

#### Scenario: Mixed operations undo in one order

- **WHEN** 用户依次完成 Pencil 笔、文字和形状，然后连续撤销三次并重做三次
- **THEN** 按相反/原顺序移除和恢复对应对象，每次一个事务，原生预览不残留或另行恢复已撤销笔

#### Scenario: Undo during unfinished input does not create a stroke

- **WHEN** 用户在 Pencil 尚未完成时请求撤销
- **THEN** 当前未提交笔取消，已提交历史按 controller 规则撤销，迟到 end 与程序化预览清理均不生成事务

### Requirement: Native lifecycle invalidates unfinished sessions

工具/输入模式切换、触摸取消、后台、组件卸载、画布布局失效或 WebView 重载 SHALL 取消 collecting 会话并清除其临时预览；迟到消息 SHALL 按世代/会话身份隔离。已成功提交的文档对象 MUST NOT 因清理预览而丢失；恢复后 SHALL 可开始新笔且不复用旧 lease。

#### Scenario: Background and reload reject stale end

- **WHEN** 一笔未完成时切后台或重载 WebView，恢复后收到旧 end/commit-result 并开始新笔
- **THEN** 旧笔不进入文档，不清除新笔；先前已提交对象保留，新笔有新的有效归属

### Requirement: Native presentation handoff is identity scoped and device verified

原生临时墨迹 SHALL 按对应提交身份与历史最终显示交接，不得在文档提交成功时立即全量清屏，迟到确认不得清除新笔。用户 SHALL 不观察到丢笔空窗、重复半透明变深或对象顺序颠倒。文档结果、Web 内部就绪与物理呈现 SHALL 区分；固定等待、mock ACK 或消息到达不构成物理交接证据。原生近似预览与最终轮廓的形状差异 SHALL 明确交付评审，不能声称像素相同。

#### Scenario: Delayed handoff protects consecutive strokes

- **WHEN** 用户连续快速绘制半透明笔，历史就绪消息被延迟或乱序到达
- **THEN** 每笔只显示一份正确顺序的结果，无可观察空窗或双重变深，旧确认不清除后续笔，最终与文档对象一一对应

#### Scenario: Undo before handoff does not resurrect ink

- **WHEN** 已提交的一笔还在等待交接时被 controller 撤销，随后迟到 ready/retire 消息到达
- **THEN** 文档及原生预览都不显示该笔，迟到消息不使它复活或清除其他笔

### Requirement: Release requires native device evidence and Web regression checks

交付 SHALL 提供 playground 可复现入口、iOS dev client 重建/启动步骤、设备/OS/Pencil/构建版本记录、真实采样与生命周期结果及交接视频。验收 SHALL 包含 tap、快速连续笔、长笔、压力、三档手指/笔混用、0.5/1/2 倍 viewport、旋转、文字键盘、混排撤销重做和故障恢复。Web 自动化回归 SHALL 保持通过，Android 现有入口 SHALL 保持可构建；模拟或导出检查不得代替设备验收。原始采样、输入分流或物理交接任一门槛不通过时 MUST NOT 默认启用原生绘制。

#### Scenario: Unsupported evidence cannot pass the release gate

- **WHEN** 只有 Jest/mock、静态检查、bundle 导出或已有 DOM 真机验证记录
- **THEN** PencilKit 设备验收仍未完成，不能宣称采样、掌触、键盘或物理交接已通过
