# 任务 4 前置决策：手势会话边界与阶段 4 实施顺序

- 变更：`migrate-expo57-skia-surface`
- 任务：阶段 4（InputAdapter 与领域 GestureSession，移除 multi-drag/core）前置决策回填
- 验证所有者：父 orchestrator
- 状态：**前置决策已接受，阶段 4 可开始纯 core 契约实施**（不等于整个阶段已实施）
- 生成时间：2026-09-23
- 写入范围：仅本决策文件、`design.md` 相关用语、`.slim/deepwork/migrate-expo57-skia-surface.md`。未修改产品源码、依赖、lockfile、CI、`tasks.md` 勾选或其它工件。

> 本文件是阶段 4 实施前的有界决策回填，只固定已被接受的边界与实施顺序；不产出逐行实现方案，不改变 `tasks.md` 条目，不宣称阶段 4 已完成。

## 依据（本决策引用并依赖的既有工件）

| 依据 | 路径 | 作用 |
| --- | --- | --- |
| 领域词汇表（尺子语义） | `packages/painting/CONTEXT.md` | 尺子为宿主局部无限长条，高度/方向/物理刻度；视口平移或缩放不改变尺子屏幕几何 |
| 变更设计说明 | `openspec/changes/migrate-expo57-skia-surface/design.md` | 第 5、6 节 GestureSession 与 virtual-paper 角色收缩；本决策同步修正其尺子刚体用语 |
| 规范（手势会话） | `openspec/changes/migrate-expo57-skia-surface/specs/drawing-gesture-sessions/spec.md` | 尺子抓取偏移/角度吸附、双指刚体变换、选区变换、无 multi-drag 运行时依赖 |
| 依赖事实 | `packages/painting/package.json`、`node_modules/.../@hamster-note/virtual-paper/package.json` | `@hamster-note/virtual-paper@0.1.0-beta.2` 的 `dependencies` 直接声明 `@system-ui-js/multi-drag@^0.4.0`（传递依赖） |
| 阶段 3 闭合记录 | `.slim/deepwork/migrate-expo57-skia-surface.md` | GestureSession 与 multi-drag 移除已后置到阶段 4；core 已具备纯契约基础 |

## 决策零：尺子双指手势是刚体「仅平移 + 旋转」，不缩放

- 用户已明确选择：尺子双指手势为**刚体变换，但仅包含平移与旋转，不包含缩放**。
- 尺子的**高度、刻度间距、PPI 与无限长条几何保持不变**：双指手势不改变尺子高度、不改变物理刻度（毫米/半厘米/厘米）间距、不改变 PPI、也不改变其「无限长条」几何。
- 「比例保持一致」的准确含义是**无形变（形状/比例不畸变）**，**不是**为尺子新增一个 `scale` 自由度。尺子不存在可被双指手势修改的缩放比例。
- 与 `CONTEXT.md` 一致：尺子逻辑原点、旋转角、高度和物理刻度采用宿主局部 CSS 像素或弧度；画布视口平移或缩放不改变尺子的屏幕几何；尺子平移保持高度和方向不变，尺子旋转为刚性旋转。
- **用语修正说明**：`specs/drawing-gesture-sessions/spec.md` 中「平移、旋转与缩放的一致组合」「双指平移旋转缩放」等表述，其规范本意是强调「刚体、不引入非刚体形变」，**不得**被解读为尺子具有可缩放自由度。本决策以「仅平移 + 旋转」为权威解释。`design.md` 中易被误读为「尺子刚体 + 缩放」的用语已按本节修正；`spec.md` 文本本身不在本次授权写入范围内，其措辞澄清后置。

## 决策一：4.1–4.5 强耦合，实施顺序固定，不得先删依赖

阶段 4 任务 **4.1–4.5 强耦合**，实施必须遵循以下顺序：

1. **纯 normalized contract / ownership + GestureSession**：先在纯 core 定义归一化输入契约、对象归属（ownership）与 `GestureSession` 状态机。
2. **adapters**：再实现 Web / Native InputAdapter，把平台事件翻译为同一归一化契约。
3. **替换 legacy 两个 multi-drag 接缝**：以 GestureSession 驱动替换现有两处 multi-drag 运行时接缝。
4. **内建 Transform 等价**：落地 virtual-paper 仅保留的 Transform 等价语义。
5. **删除 multi-drag 与 virtual-paper runtime**：最后才移除 multi-drag / multi-drag-core 运行时依赖与 virtual-paper 运行时容器。

**硬约束**：**不得先删依赖**。任何在纯契约、adapters、接缝替换与 Transform 等价落地之前删除 multi-drag/virtual-paper 运行时的做法，都会使调用方在无替代实现时断裂，故被禁止。

## 决策二：virtual-paper 自身传递依赖 multi-drag，4.4 / 4.5 必须联合移除

- `@hamster-note/virtual-paper` **自身传递依赖** `@system-ui-js/multi-drag`（见其 `package.json` 的 `dependencies`）。因此 **4.4 与 4.5 必须联合处理**：
  - 必须联合移除 virtual-paper 的**运行时使用**以及 `packages/painting` 对它的**运行时依赖**；
  - 仅移除 `packages/painting` 直接声明而保留 virtual-paper 运行时，无法达成「完全无 multi-drag 运行时依赖」。
- **可保留**公开的 virtual-paper options 作为**兼容映射**（既有对外选项语义的等价映射），但**不能委托外部容器**承担变换职责。
- 仅保留 **Transform 等价**语义；**不得新增** `readerMode` / `bounds`（阅读/滚动模式及其边界语义），与 `design.md` 第 6 节一致。

## 决策三：core 只消费纯 normalized 宿主局部 DIP 事件与 targetRole

- core **只消费纯 normalized** 的**宿主局部 DIP** 事件与 `targetRole`：
  - **禁止** DOM `Element` / `PointerEvent`、RNGH / Reanimated / React 进入 core；
  - 平台机制（Web 的 capture / DOM 命中、native 的 RNGH 映射）由 **adapter** 负责。
- **ownership 语义**：object owner 在**逐 pointer down** 时锁定；**不同 owner 可并发**。
- **paper 内部仲裁**：`pending → drawing/navigate` 的仲裁**分开**进行。
- **生命周期三态**：`completed` / `failed` / `cancelled` **明确三态**，不得混同。

## 决策四：4.2 需要 iOS 与 Android 真实运行，Linux 当前不能关闭

- 任务 **4.2（Native Adapter）需要 iOS 与 Android 真实运行**证据。
- 当前 Linux 环境无 iOS/Android 模拟器或真机，因此 **4.2 在当前环境不能关闭**，必须**保留运行时债务**。
- **不修改 `tasks.md` 勾选**：本次回填不改变任何任务条目状态；4.2 保持未完成，作为与 1.4 同类的真实设备外部证据债务。

## 决策五：后续实施细节（记录，供阶段 4 实施遵循）

- **RNGH 2.32**：使用 `onFinalize(e, success)` 判定手势结束，**而非** v3 的 `canceled`。
- **触点标识**：按 `TouchData.id` 追踪触点，**而非数组顺序**（数组顺序不稳定）。
- **Android 触点**：统一使用 `averageTouches` 语义。
- **坐标**：使用 **host-local 坐标**（宿主局部 DIP）。
- **Web `touchAction`**：显式策略，其行为测试后续补齐。

## 边界与不做的结论

- 本决策**不修改**任何产品源码、依赖、lockfile、CI、`tasks.md` 勾选或 `spec.md` 文本。
- 本决策**不宣称**阶段 4 已实施；它只固定前置边界与实施顺序，供纯 core 契约实施起步。
- 本决策**不新增**尺子缩放自由度、不新增 `readerMode` / `bounds`、不新增功能。
- 4.2 的真实设备验证仍为外部证据债务，不在当前 Linux 环境关闭。

## 对下游任务的直接引用关系

- **4.1 / 4.3** 按决策一顺序起步：先纯 normalized contract / ownership + GestureSession，再 adapters。
- **4.2** 受决策四约束：保留真实设备运行时债务，不改勾选。
- **4.4 / 4.5** 按决策二联合移除：multi-drag 直接依赖与 virtual-paper 传递依赖一并处理，仅保留 Transform 等价。
- **design.md** 第 5、6 节与手势门相关用语按决策零修正尺子刚体解释。
