# Spec Delta

## Purpose

规定以 Expo SDK 57 承载应用后，**Web 目标的交互启动**与 **iOS/Android 目标的静态兼容（`compat-static`）**
要求，以及 Skia 绘制面在 Web 上的本地 CanvasKit 资源加载、可见失败与重试、有限期 legacy 回退、
禁止生产双 Canvas 及功能就绪后 **Web 默认启用 Skia** 的行为边界。
原生目标**不再要求真实运行/触控/手势/Skia/IME/picker/权限/性能/E2E 验收**。

## ADDED Requirements

### Requirement: Web 交互启动

应用 MUST 以 Expo SDK 57 作为 Web 的运行时，且 Web 目标 MUST 完成可交互启动并呈现绘制面入口。

#### Scenario: Web 启动

- **WHEN** 在 Web 目标上启动应用
- **THEN** 应用进入可交互状态并呈现绘制面入口，不出现启动崩溃或白屏

### Requirement: iOS/Android 静态目标兼容（`compat-static`）

iOS 与 Android 目标 MUST 保持可构建的静态兼容，并 MUST 通过以下 `compat-static` 静态门：
根 `pnpm typecheck` 通过、`expo export --platform ios` 与 `expo export --platform android`
静态导出成功、native Jest/RNTL 最小挂载通过。`compat-static` 结果 MUST NOT 被表述为
安装、启动、触控、手势、Skia 渲染、IME、picker、权限或性能的通过。

#### Scenario: 静态目标导出成功

- **WHEN** 对 iOS 与 Android 目标执行 `expo export --platform ios|android`
- **THEN** 静态导出成功，且该结果被标注为 `[evidence:compat-static][target:ios|android][executor:linux]`，不声称原生运行

#### Scenario: 根静态检查通过

- **WHEN** 执行根 `pnpm typecheck` 与 native Jest/RNTL 最小挂载
- **THEN** 二者通过，且仅作为静态兼容证据，不替代任何原生运行时或功能验收

#### Scenario: 禁止原生 runtime 场景

- **WHEN** 引用本 capability 的验收结果
- **THEN** MUST NOT 使用原生运行/触控/手势/Skia/IME/picker/权限/性能/E2E 场景作为验收门

### Requirement: Skia Web 本地 CanvasKit 加载

Web 目标 MUST 从本地随应用发布的静态资源加载 CanvasKit，MUST NOT 在运行时依赖外部 CDN 才能获得绘制能力，且加载成功前不得宣称绘制面已就绪。

#### Scenario: 从本地资源加载

- **WHEN** Web 应用初始化 Skia 绘制面
- **THEN** CanvasKit 从本地静态资源加载，且加载过程不请求外部 CDN

#### Scenario: 加载成功后就绪

- **WHEN** 本地 CanvasKit 加载成功
- **THEN** 绘制面被标记为就绪并可接受绘制输入

### Requirement: 可见失败与重试

CanvasKit 加载失败时，运行时 MUST 向用户呈现可见的失败反馈，并 MUST 提供由用户触发的重试入口，且重试结果 MUST 反映到界面状态。

#### Scenario: 加载失败可见

- **WHEN** 本地 CanvasKit 加载失败
- **THEN** 用户看到明确的失败提示，而不是空白或无反馈的静默失败

#### Scenario: 重试成功

- **WHEN** 加载失败后用户触发重试且此次加载成功
- **THEN** 失败提示被清除且绘制面进入就绪状态

#### Scenario: 重试再次失败

- **WHEN** 加载失败后用户触发重试且此次加载仍失败
- **THEN** 失败提示保持可见且重试入口仍可用

### Requirement: 有限期 legacy 回退

在功能与性能门禁通过前，Web 目标 MAY 回退到 legacy SVG 绘制面，但该回退 MUST 为有限期且 MUST 在被触发时可见，遗留实现 MUST 在稳定周期后被删除。

#### Scenario: 回退被触发

- **WHEN** Skia 绘制面在门禁通过前不可用且 legacy 回退被启用
- **THEN** 用户获得可用的 legacy 绘制面，且回退状态对用户可见

#### Scenario: 稳定周期后移除

- **WHEN** Skia 绘制面已通过功能与性能门禁并进入稳定周期
- **THEN** legacy 绘制面实现被移除，回退路径不再存在

### Requirement: 禁止生产双 Canvas

运行时 MUST NOT 同时挂载两个活跃的绘制 Canvas，在任一时刻 MUST 至多存在一个承载生产绘制的画布实例。

#### Scenario: 就绪时只有单画布

- **WHEN** Skia 绘制面已就绪
- **THEN** 生产环境中不存在并行的第二个活跃绘制画布

#### Scenario: 切换时不并存

- **WHEN** 绘制面从 legacy 回退切换到 Skia
- **THEN** 切换完成后旧画布被卸载，不出现两个画布同时承载生产绘制

### Requirement: 功能就绪后 Web 默认 Skia

当 Skia 绘制面通过 **Web** 功能与性能门禁后，它 MUST 成为 **Web** 的默认绘制面，MUST NOT 需要用户显式开启。

#### Scenario: Web 默认即为 Skia

- **WHEN** 门禁通过后用户启动 Web 应用
- **THEN** Web 绘制面默认为 Skia，无需任何手动开关

#### Scenario: Web 不退回 legacy

- **WHEN** 门禁已通过且用户在 Web 正常使用绘制功能
- **THEN** 运行时不再自动回退到 legacy 绘制面
