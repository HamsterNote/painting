# Spec Delta

## Purpose

定义 Android 手写笔原生临时墨迹与共享 Web 编辑器协作的用户行为和数据边界，确保真实输入、统一历史、可恢复取消、逐笔呈现交接与设备验收均有明确标准，同时保持已有跨平台工具和文档能力。

## ADDED Requirements

### Requirement: Android native ink is explicit and platform isolated

系统 SHALL 在重建且模块匹配的 Android development build 中提供显式开启的原生自由笔验证入口，默认仍为既有 Web 路径。原生只拥有临时预览；文档、最终几何、历史显示和工具仍由共享编辑器管理。请求启用但模块缺失或不匹配时 SHALL 显示重建提示，不冒充原生成功。Web/iOS 构建 MUST NOT 要求 Android 原生运行时。

#### Scenario: Explicit native entry and missing build

- **WHEN** 用户在 Android 打开原生验证入口，分别使用匹配构建和缺失模块的旧构建
- **THEN** 匹配构建可在 ready 后接受原生笔，旧构建明确提示重建且不启用原生采样；关闭选项时既有 Web 绘制仍可使用

#### Scenario: Other platforms retain behavior

- **WHEN** 启动 Web 和既有 iOS 验证通道
- **THEN** 两端不加载 Android 模块，iOS 的开关、连续笔、取消恢复及正常策略停用行为保持原语义

### Requirement: Real Android samples preserve document fidelity

系统 SHALL 仅保存所属手写笔实际 down/move/up 和平台历史样本，按接受顺序赋连续序号，保留同坐标、实际零压力及可用的有限越界压力。预测点、渲染路径或插值点 MUST NOT 进入文档。压力能力 SHALL 在落笔明确报告并锁定，不以值是否变化推断；缺失压力保持缺失。坐标 SHALL 从实际 view 像素转换为 DIP，再用落笔 viewport 转 world，时间使用一致的单调毫秒基准。

#### Scenario: Historical samples and release pressure

- **WHEN** 压力可用的 stylus 以批量历史样本绘制并以零压力抬笔
- **THEN** schema 3 包含按原顺序接受的真实样本、末尾零压力、落笔快照和锁定压力模式，无预测或派生点，最终使用共享几何

#### Scenario: Density and viewport are applied once

- **WHEN** 在不同 density、平移和 0.5/1/2 倍 viewport 下画出相同画布位置的笔迹
- **THEN** 原生预览和最终历史对齐，世界坐标只应用一次 density 和一次 viewport 逆变换；旋转导致布局失效时当前笔取消

#### Scenario: Device without pressure

- **WHEN** adapter 明确声明 stylus 无可用压力能力，用户使用 auto 或显式压力模式
- **THEN** auto 锁定 simulated，显式模式保持用户选择，raw 压力缺失，不补造力值或中途改模式

### Requirement: Stylus routing preserves real Web input

原生 SHALL 只接管画布内、无尺子约束的自由笔 stylus，手指、鼠标、其他工具和控件使用真实 Web 输入。反向笔尖及侧键 SHALL 不意外触发自由笔或绕过共享历史擦除。系统 MUST 按 pointer identity 区分混合事件，不将一个触点的类型应用到整批事件，不以合成 Web 事件补偿被吞的输入。三档策略、掌触抑制与双指导航 SHALL 服从共享编辑器归属。

#### Scenario: Native pen and Web finger remain independent

- **WHEN** 用户在三档输入模式下分别绘制 stylus 笔、手指笔或导航，并在活动 stylus 期间加入掌触
- **THEN** 每笔只由一个入口提交一次，手指按档位绘制或导航，活动 stylus 期间 viewport 冻结且结束后不补导航

#### Scenario: Tools controls and disabling remain usable

- **WHEN** 用户切 Line、尺子、文字并唤起 IME，或停用原生后修改笔刷再继续绘制
- **THEN** 对应真实输入到达 Web，顶部控件可用，原生不残留拦截、不误报模块断连，不新增原生自由笔事务

### Requirement: Shared leases and idempotent commits control history

系统 SHALL 通过带版本、编辑器世代、会话/提交身份及布局/viewport revision 的平台中立语义取得权威 begin lease，锁定 brush 和压力模式，结束后批量提交。一个接受的 end SHALL 至多生成一个共享 history 事务。相同 commitId 同内容重试 SHALL 返回已有结果，异内容 SHALL 拒绝。Android 接口 MUST NOT 要求 Apple 专用力字段或独立文档/撤销栈。

#### Scenario: End arrives before begin acknowledgement

- **WHEN** 快速短笔结束早于 begin 回复到达
- **THEN** 真实首尾样本有界暂存，同一 lease 接受后只提交一次；begin 拒绝时整笔丢弃，无半成品对象

#### Scenario: Mixed tools and retries share undo order

- **WHEN** 用户依次创建原生笔、Web 形状和文字，重传已成功笔批次后执行 undo/redo
- **THEN** 文档无重复笔，撤销与重做按原事务顺序进行；相同 ID 的不同内容被拒绝且不改已有笔

### Requirement: Cancellation and bounded failures recover safely

系统 SHALL 在工具/模式/布局变化、系统取消、后台、卸载或重载时取消未提交笔，隔离旧 epoch 的迟到消息且保留已提交文档。正常取消 SHALL 不持续暂停下一笔。系统 SHALL 限制为每笔 50,000 样本及组装后 16 MiB、至多 4 笔待交接与 12 条发送队列；超限整笔失败而非截断提交。5 秒无进展 SHALL 停止新原生 begin 并报告可恢复故障，不伪造成功或显示确认。

#### Scenario: System cancel allows the next stroke

- **WHEN** 已接受的笔收到合法系统取消，清理后用户开始下一笔
- **THEN** 被取消笔无文档对象或 undo entry，下一笔无需重开开关即可正常提交；畸形取消数据仍被拒绝

#### Scenario: Stale messages and transport failure

- **WHEN** WebView 重载后旧结果到达，或传输超限、无进展超过 5 秒
- **THEN** 旧消息不修改新会话；故障有明确原因且暂停新原生输入，恢复先核对已提交结果，重试不会重复新增文档

### Requirement: Per-stroke presentation requires device evidence

系统 SHALL 按单笔身份协调最终历史准备、原生预览退休和显示确认，不以全清画布删除后续笔，不把提交 ACK 作为物理呈现证据。启用验收 SHALL 包括真实压力 stylus 设备和无 stylus Android 场景，记录设备/构建版本；至少 120fps 外部录像 SHALL 验证空白首笔、连续笔、长笔、半透明及延迟/忙碌场景无可见空窗、双显变深或误清新笔。原生预览向最终几何的外观收敛 SHALL 经用户确认。

#### Scenario: Earlier retirement preserves later input

- **WHEN** 前三笔待退休时第四笔开始，且旧退休确认延迟或乱序到达
- **THEN** 各笔历史至多显示一次，第四笔预览保持，完成后待交接队列归零，后续第五笔正常可见

#### Scenario: Incomplete evidence prevents acceptance

- **WHEN** 只有模拟器、单帧截图、桥 ACK 或不足以验证交接的设备录屏
- **THEN** 物理交接和压力门槛标记未验证，原生路径仍为显式验证状态，不声明默认启用或设备验收通过
