# Mobile Input Mode Switch 验收记录

2026-10-18，基线 `9f4ece3`，分支 `feat/mobile-input-mode-switch`。本文保留 apply 阶段的逐项实跑记录；当时未同步主 specs、未归档、未创建 PR。后续 iPad 修复见 [ipados-input-fix.md](./ipados-input-fix.md)，真机验收与归档后验证见 [archive-verification.md](./archive-verification.md)。

## 契约与实现对应

| Spec Delta Requirement                                                  | 实现与验证                                                                                                                                                                                |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Three input modes share one selected tool                               | controller 独立 input 频道、Toolbar 三档；鼠标跟随工具，模式不进入文档/undo。1.1、3.3、4.1、4.4、4.5、4.8 验证。                                                                          |
| Automatic pen detection is latched within the editor session            | 唯一 DOM 仲裁入口仅在有效纸面 pen down 记录 latch；所有档位可记录，只有 auto 使用。无超时，失焦/后台/换工具保留，重建 controller 清除。2.2、2.3、4.3、4.4、4.7 验证。                     |
| Touch pair navigation follows cancellation and preserves writing freeze | 窄 reducer 先发 cancel，成功 ACK 后才 begin-navigation；失败不导航。固定 pair 不替补；笔/鼠标书写不让 touch 改 viewport，掌触排空后才接受新手势。2.1、2.2、3.1、3.2、4.2、4.5、4.8 验证。 |
| Input mode changes cancel unfinished input without replay               | 模式变更取消工具与纸面导航事务，隔离旧触点，新 down 采用新档位；笔可抢单 touch 工具事务，不能抢已有 pair。2.3、3.1、4.4、4.8 验证。                                                       |
| Mode preference is restored before interaction with memory fallback     | Web factory 同步恢复，SSR 有交互门；只写菜单用户档位，不写检测状态。初始化优先级和兼容语义见 README。1.2、1.3、4.6、4.7 验证。                                                            |

## 逐项实际命令

Jest 使用既有 `core-node` / `legacy-web` projects，没有 `passWithNoTests`。下表 1.1 至 3.3 为该任务完成时的实跑结果；最终全量覆盖后续增加的无浏览器 Node 宿主回归。

| Task | 实际命令                                                                                                                                                                                                                                                      | 结果                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1.1  | `pnpm exec jest --runInBand --selectProjects core-node --runTestsByPath packages/painting/src/__tests__/core/layered-input-mode.test.ts`                                                                                                                      | 1 suite / 2 tests passed；最终全量包含新增的 Node 无浏览器用例，共 3 tests。 |
| 1.2  | `pnpm exec jest --runInBand --selectProjects legacy-web --runTestsByPath packages/painting/src/__tests__/input-mode-preference.test.ts`                                                                                                                       | 1 suite / 6 tests passed。                                                   |
| 1.3  | `pnpm exec jest --runInBand --selectProjects legacy-web --runTestsByPath packages/painting/src/__tests__/layered-input-initialization.test.tsx`                                                                                                               | 1 suite / 6 tests passed；SSR 使用 node renderer，Canvas 单独 mock。         |
| 2.1  | `pnpm exec jest --runInBand --selectProjects core-node --runTestsByPath packages/painting/src/__tests__/core/layered-input-arbitration.test.ts`                                                                                                               | 1 suite / 5 tests passed。                                                   |
| 2.2  | `pnpm exec jest --runInBand --selectProjects core-node --runTestsByPath packages/painting/src/__tests__/core/layered-input-arbitration.test.ts`                                                                                                               | 1 suite / 10 tests passed。                                                  |
| 2.3  | `pnpm exec jest --runInBand --selectProjects legacy-web --runTestsByPath packages/painting/src/input/web/__tests__/layeredInputArbiter.test.ts`                                                                                                               | 1 suite / 8 tests passed。                                                   |
| 3.1  | `pnpm exec jest --runInBand --selectProjects legacy-web --runTestsByPath packages/painting/src/input/web/__tests__/freehandWebAdapter.test.ts packages/painting/src/input/web/__tests__/layeredInputArbiter.test.ts`                                          | 2 suites / 80 tests passed。                                                 |
| 3.2  | `pnpm exec jest --runInBand --selectProjects legacy-web --runTestsByPath packages/painting/src/__tests__/layered-semantic-adapter.test.ts packages/painting/src/__tests__/layered-navigation.test.ts packages/painting/src/__tests__/layered-canvas.test.tsx` | 3 suites / 16 tests passed。                                                 |
| 3.3  | `pnpm exec jest --runInBand --selectProjects legacy-web --runTestsByPath packages/painting/src/__tests__/layered-toolbar.test.tsx packages/painting/src/__tests__/layered-public-entry.test.tsx`；`pnpm run typecheck`                                        | 2 suites / 4 tests passed；三个 workspace 类型检查通过。                     |

### Chromium 分项命令

任务文件给定的 `pnpm run test:ui -- ...` 命令均已实际执行。pnpm 10 会把该 `--` 透传给 Playwright，后面的 `-g` 变成文件筛选参数，因此原命令运行当时文件内全部用例。为确认目标用例确实存在并运行，4.2 至 4.7 另实跑了不含分隔符的精确命令；结果如下。项目配置仅有 `chromium`，无缺失用例跳过。

| Task | 实际任务命令                                                                                                           | 原命令结果                          | 追加精确筛选                                                                                                   |
| ---- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 4.1  | `pnpm run test:ui -- tests/ui/mobile-input-mode.spec.ts --project=chromium -g auto-default-touch`                      | 1 passed                            | 当时仅此 1 项；后续全量亦通过。                                                                                |
| 4.2  | `pnpm run test:ui -- tests/ui/mobile-input-mode.spec.ts --project=chromium -g second-finger-cancels`                   | 3 passed                            | `pnpm run test:ui tests/ui/mobile-input-mode.spec.ts --project=chromium -g second-finger-cancels`：2 passed。  |
| 4.3  | `pnpm run test:ui -- tests/ui/mobile-input-mode.spec.ts --project=chromium -g auto-pen-latch`                          | 4 passed                            | `pnpm run test:ui tests/ui/mobile-input-mode.spec.ts --project=chromium -g auto-pen-latch`：1 passed。         |
| 4.4  | `pnpm run test:ui -- tests/ui/mobile-input-mode.spec.ts --project=chromium -g forced-finger-override`                  | 5 passed                            | `pnpm run test:ui tests/ui/mobile-input-mode.spec.ts --project=chromium -g forced-finger-override`：1 passed。 |
| 4.5  | `pnpm run test:ui -- tests/ui/mobile-input-mode.spec.ts --project=chromium -g forced-pen`                              | 6 passed                            | `pnpm run test:ui tests/ui/mobile-input-mode.spec.ts --project=chromium -g forced-pen`：1 passed。             |
| 4.6  | `pnpm run test:ui -- tests/ui/mobile-input-mode.spec.ts --project=chromium -g storage-unavailable`                     | 8 passed；另重跑 1.2 Jest：6 passed | `pnpm run test:ui tests/ui/mobile-input-mode.spec.ts --project=chromium -g storage-unavailable`：2 passed。    |
| 4.7  | `pnpm run test:ui -- tests/ui/mobile-input-mode.spec.ts --project=chromium -g preference-first-frame`                  | 9 passed                            | `pnpm run test:ui tests/ui/mobile-input-mode.spec.ts --project=chromium -g preference-first-frame`：1 passed。 |
| 4.8  | `pnpm run test:ui -- tests/ui/mobile-input-mode.spec.ts tests/ui/touch-drawing-arbitration.spec.ts --project=chromium` | 30 passed                           | 1366px / 390px 截图、Canvas 非空像素、最终 SVG 笔迹与布局检查通过。                                            |

### 5.1 全量回归

- `pnpm run test`：87 suites / 1111 tests passed，3 projects，12.855s。
- `pnpm run typecheck`：painting / painting-board / playground 全部通过。
- `pnpm run lint`：退出码 0，0 errors / 32 warnings；警告均位于未修改的既有测试，类型为 `jest/expect-expect`。
- `pnpm run test:ui -- tests/ui/layered-editor.spec.ts tests/ui/editor-candidate-canvas2d-pen.spec.ts tests/ui/touch-ruler-feedback.spec.ts tests/ui/mobile-input-mode.spec.ts tests/ui/touch-drawing-arbitration.spec.ts --project=chromium`：49 passed（1.1m）。包含 DPR 1/2 长笔、历史静止、最终像素、压力、取消、快速笔、尺子与全部新输入契约。

实际修复：尺子冻结时仍需保留命中归属，不能充当纸面第二指；Surface 只订阅档位，避免 penSeen 变化让历史层额外渲染；tools 频道设置变化不能当作换工具取消活动笔。旧组合 mouse policy 测试按已批准的 BREAKING 行为改为明确验证鼠标/笔不被隐藏限制。文字重复点击用例补齐实际抬笔，取消/提交/撤销断言全部保留。

### 5.2 文档与规格校验

README 已记录三档、会话 latch、初始化优先级、旧 inputPolicy 的 BREAKING 兼容语义、SSR 交互门和存储降级。本记录逐条对应 5 条 delta requirement。

- `openspec validate mobile-input-mode-switch --strict --no-interactive`：valid。
- `openspec validate --strict --all --no-interactive`：6 passed / 0 failed。
- `git diff --exit-code 9f4ece3 -- openspec/specs openspec/changes/archive`：退出码 0，主 specs 与归档目录未变更。

## 分阶段提交

| SHA       | 内容                                                                   |
| --------- | ---------------------------------------------------------------------- |
| `8826369` | 原始 change 包独立提交，含 `.openspec.yaml`。                          |
| `161f324` | controller 模式、偏好与交互初始化。                                    |
| `e99b8cd` | 窄仲裁 reducer、DOM 入口、取消确认。                                   |
| `5821616` | 三个 adapter、Surface、工具栏及公开入口。                              |
| `1399440` | 分层浏览器契约矩阵、旧 touch 用例更新及尺子归属修复。                  |
| `8400a70` | 全量回归发现的设置取消问题修复、兼容断言与生命周期修正、无浏览器用例。 |

## 限制与交接

本节描述 apply 阶段的边界：当时未运行真实手写笔、真实掌触、iOS/Android 启动或 Safari 真机验证。后续修勾已在 iPadOS 18 / Edge 用手指与手写笔复验通过，见归档验收记录；不能把该结论扩展为 Safari 专项、硬件掌触、压力品质或原生壳验证。Chromium 合成 PointerEvent 不代表设备手感或硬件掌触识别能力。六条冻结口径未改。
