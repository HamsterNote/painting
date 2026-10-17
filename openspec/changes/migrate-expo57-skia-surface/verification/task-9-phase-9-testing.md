# 阶段 9 验证报告（9.1 / 9.3）：分层测试体系从 DOM/SVG 迁移到 core/RN/Web/E2E

- 变更：`migrate-expo57-skia-surface`
- 任务：**9.1、9.3**（本报告只覆盖这两项；**9.2、9.4 明确保持未勾选**）
- 验证所有者：父 orchestrator
- 状态：**Oracle Gate 9 attempt 1/3 APPROVE，仅批准关闭 9.1、9.3**
- 生成时间：2026-09-24
- 写入范围：仅本报告文件、`tasks.md` 的 9.1/9.3 勾选，以及 `.slim/deepwork/migrate-expo57-skia-surface.md` 的状态回填。**未修改任何产品源码、Jest 配置、脚本或依赖**；**未改动 9.2、9.4 以及 1.4、4.2、6.3、7.4、8.1、8.2、8.5 的未完成状态**。

## 结论速览

| 任务 | 结论 | 主要证据 |
| --- | --- | --- |
| 9.1 建立纯 Node（无 jsdom）core 单测套件 | ✅ 通过 | `core-node` project（`testEnvironment: 'node'`）覆盖几何、命中、viewport、V1/V2 迁移与 GestureSession；21 套 / 338 tests，与 `legacy-web` 精确无交集 |
| 9.3 建立 React Native/Web 组件层测试 | ✅ 通过 | `native` project（jest-expo + RNTL）最小挂载/可访问性/reset（2 套 / 5 tests）；`skia-canvaskit` 独立 CanvasKit 环境；Web 组件层由 `legacy-web` 承接 |

**总体判定：在 Oracle Gate 9 attempt 1/3 APPROVE 下，9.1、9.3 通过并关闭。9.2、9.4 及阶段 9 整体不闭合，仍需等价覆盖与真实三端运行证据。**

## Gate 9 裁定

- Oracle Gate 9 **attempt 1** **APPROVE**，**仅批准关闭 9.1 与 9.3**。
- 该批准**仅覆盖纯 Node core 分层与 RN/Web 组件层挂载测试**；**不表示**阶段 9 整体完成。
- **9.2 保持未勾选**：依赖 DOM/SVG 的旧测试与 multi-drag 虚拟 mock **尚未移除或重写**，且**必须先有等价覆盖再行退役**。
- **9.4 保持未勾选**：**无 iOS/Android 真机/模拟器端到端证据**，Web E2E 不能替代三端。
- **本报告不改任务文字含义**，仅新增勾选与证据链接。

## 9.1 实现与证据（纯 Node、无 jsdom 的 core 单测套件）

- **多项目 Jest 分层（`jest.config.js` 的 `projects`）**：四个独立 Jest project：
  1. `legacy-web`：`testEnvironment: 'jsdom'`，承接原 Web 组件/DOM 层测试。
  2. `core-node`：`testEnvironment: 'node'`，**纯 Node（无 jsdom）**。
  3. `native`：`jest-expo` preset + React Native Testing Library。
  4. `skia-canvaskit`：`testEnvironment: '@shopify/react-native-skia/jestEnv.js'` + `jestSetup.js`（CanvasKit）。
- **真实 Node 环境**：`core-node` 的 `testEnvironment: 'node'`，`testMatch` 精确圈定为 `packages/painting/src/__tests__/core/**/*.test.ts` 及 7 个纯逻辑测试（`interactionFeedback`、`selectionRotation`、`utils`、`viewport-affine`、`viewport`、`stroke-helpers`、`task15-regression`）。**不存在 `document`/`window` 等 DOM 全局**，用例仅覆盖几何、命中、viewport、V1/V2 迁移与 GestureSession 等无副作用核心模块。
- **覆盖范围**：`core/` 目录含 `document`、`drawingFrame`、`frameClipping`、`geometry`、`gesture-ownership`、`gesture-session`、`input`、`preparedDocument`、`resourceRegistry`、`spatialIndex` 等套件；连同上述纯逻辑测试，`core-node` 计 **21 套 / 338 tests**。
- **与 `legacy-web` 精确无交集**：`legacy-web` 在 `testPathIgnorePatterns` 中对 `core/` 与 `interactionFeedback`、`selectionRotation`、`utils`、`viewport-affine`、`viewport`、`stroke-helpers`、`task15-regression` **逐项精确排除**，避免同一批用例在两个 project 重复执行；`legacy-web` 保留 **28 套 / 547 tests**（Web 组件/DOM 层），二者集合互不重叠。
- **验证方式**：`jest.config.js` 中 `core-node` 的 `testEnvironment: 'node'` 与 `legacy-web` 的 jsdom 隔离，`pnpm test` 中纯 Node 套件全部通过且不依赖 DOM 环境。

## 9.3 实现与证据（RN/Web 组件层测试）

### RN 组件层（`native` project，jest-expo + RNTL）

- **运行环境**：`native` project 以 `jestExpoPreset` 为基座，`transform` 显式替换 JavaScript transformer（`tests/jest/babel.native.cjs`），避免根 Babel 配置污染；`setupFilesAfterEach: tests/jest/native/setup.cjs`。
- **测试范围（2 套 / 5 tests）**：
  - `tests/jest/native/native-adapter-smoke.native.test.tsx`（4 个用例）：`NativeAdapterSmokeSurface` 的 **最小挂载**（root/interaction/status/events/reset 稳定 testID）、**限制文案**（明确 native 冒烟而非产品画布）、**可访问性**（可访问性语义，非触摸证据）、**reset**（RNTL 触发 reset 后组件仍可用且状态文案更新）。
  - `tests/jest/native/view-text.native.test.tsx`（1 个用例）：通过 RNTL 渲染 `View`/`Text` 的 native Jest baseline。
- **边界（如实记录）**：该层**不是真机**、**不是 iOS/Android 运行时**，**不构成真实触控（RNGH）证据**，也**不构成**任务 1.4 / 4.2 的原生证据；它只验证原生组件在 jest-expo 预设下的**挂载/可访问性/reset**语义。

### Web 组件层（`legacy-web`）与 Skia CanvasKit 独立环境（`skia-canvaskit`）

- **Web 组件层**：由 `legacy-web`（jsdom）承接 28 套 / 547 tests，覆盖 DOM 环境下组件挂载与渲染。
- **Skia CanvasKit 独立环境**：`skia-canvaskit` project 使用独立 `testEnvironment` 与 `maxWorkers: 1`，`testMatch` 为 `tests/jest/skia/**/*.skia.test.tsx`，`transformIgnorePatterns: []`；当前含 `canvaskit.skia.test.tsx`（**1 套**）。**RN 与 Skia CanvasKit 不进同一 project**（preport 互不兼容）。
- **Web E2E（`/skia-drawing-fixture`）**：持久 Playwright Chromium E2E（`tests/ui/skia-drawing-fixture.spec.ts`，**2 条**）已存在：
  1. 本地 CanvasKit 同源加载（`/canvaskit.wasm` 200 `application/wasm`）、DOM 结构与图例语义、无产品级 console/page error。
  2. 缩放至 4 / 右移 / 下移 / 回中的状态文本，跳转「远端 50k」与「1e9+0.125」后 frame origin（world DIP）改变。
- **E2E 证据边界（关键）**：该 spec **只断言 DOM 语义**（testID / 可访问文本 / 元素计数），**不使用任何截图像素断言**（无 `toHaveScreenshot` / 像素比对），**绝不**把图例文本或一个 `<canvas>` 元素当作 Canvas 像素内容；**不涉及原生平台行为**。因此它 **仅覆盖 Web/DOM 语义，非像素证据、非三端证据**。

## 全量验证命令与结果

| 命令 / 范围 | 结果 |
| --- | --- |
| `core-node` + `skia-canvaskit` | **22 suites / 339 tests passed** |
| `native` | **2 suites / 5 tests passed** |
| 全量 `pnpm test` | **52 suites / 891 tests passed** |
| `pnpm typecheck` | **通过（exit 0）** |
| `pnpm lint` | **0 errors / 8 known warnings** |
| `pnpm build` | **通过**（`painting-board` 既有 Bob exports warning） |
| `git diff --check` | **通过（exit 0）** |

- `pnpm lint` 的 8 个 warning 为既有非阻断项（测试 `jest/expect-expect` 与 `DrawingSurface` ref cleanup `react-hooks/exhaustive-deps`），与本阶段变更无关。
- `pnpm build` 的 warning 为 `painting-board` **既有 Bob exports** warning，非本阶段引入。

## 依赖与 peer 警告（受控风险，保持现状）

- `@testing-library/react-native@^14`（RNTL 14）**传递依赖 `react-test-renderer`**，其对 `React ^19.3` 的 peer 范围会产出版本 peer 警告；当前仓库锁定 **`react-test-renderer` 19.2.3 / React 19.2.3 / Jest 29.7**。
- **处置结论（受控风险）**：**保持 React 19.2 / Jest 29，不擅自升级依赖**；该 peer 警告**不阻断** `native` 与全量测试通过，作为已记录的受控风险。
- **后续约束**：一旦升级 React/Jest 等依赖，**必须重跑 `native` project 验证**；CI 使用 **frozen lockfile**（`pnpm install --frozen-lockfile`）以保证可复现。

## 已知非阻断项与准确边界（禁止扩张声明）

- **不表示阶段 9 完成**：仅 9.1、9.3 在 Gate 9 attempt 1/3 APPROVE 下关闭。
- **9.2 未做**：依赖 DOM/SVG 的旧测试与 `@system-ui-js/multi-drag` 虚拟 mock **尚未移除/重写**。**legacy DOM/SVG 未删除**，且**必须先由 core / descriptors / E2E 提供等价覆盖，才允许退役**（先建替代覆盖，再移除旧测试）。
- **9.4 未做**：**无 iOS/Android device/simulator E2E**。Web E2E **不等于三端**；Linux 无模拟器/真机，真实原生端到端仍需设备/模拟器或未来 EAS Maestro 路径。
- **native 层非真机**：`native` project 的 RNTL 最小挂载/可访问性/reset **不是真实触控（RNGH）**、**不是 iOS/Android 运行证据**。
- **Web E2E 证据强度**：仅 DOM 语义，**非像素比对、非原生渲染**。

## 任务状态与开放项（精确）

- **已关闭（本报告）**：9.1、9.3。
- **9.2 保持未勾选**：legacy DOM/SVG 旧测试与 multi-drag mock 未删除/重写；须先有等价覆盖。
- **9.4 保持未勾选**：无 iOS/Android 真机/模拟器 E2E。
- **严格未触碰且仍未完成**：**1.4、4.2、6.3、7.4、8.1、8.2、8.5**（真实设备/高级裁剪/默认切换/文本与资源等债务不变）。
- 任务文字含义未被改写，仅新增勾选与证据链接。

## 后续边界

- **阶段 9 整体不闭合**：9.2、9.4 仍开放，阶段 9 不能标 closed。
- **下一步仅可**：处理 **9.2 等价覆盖**（先建 core/descriptors/E2E 替代覆盖，再退役 legacy DOM/SVG 与 multi-drag mock），或推进 **9.4 真实 native/EAS 路径**，或继续记录/处理既有债务（1.4、4.2、6.3、7.4、8.1、8.2、8.5）。
- 所有既有债务状态保持。
