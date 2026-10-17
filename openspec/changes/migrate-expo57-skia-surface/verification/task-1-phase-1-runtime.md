# 任务 1 阶段 1 运行时验证报告（1.2 / 1.3 / 1.5）

- 变更：`migrate-expo57-skia-surface`
- 任务：1.2（Expo SDK 57 骨架迁移）、1.3（Web 可交互启动）、1.5（依赖引入与 Vite 运行时移除）
- 验证所有者：父 orchestrator
- 生成时间：2026-09-23
- 复审结论：Oracle 复审 APPROVE，允许勾选 1.2、1.3、1.5；1.4 必须保持未完成
- 写入范围：仅本报告（`verification/` 目录）。未修改任何应用源码、依赖、lockfile、CI 或既有未提交文件

## 结论速览

| 任务 | 结论 | 依据 |
| --- | --- | --- |
| 1.2 Expo SDK 57 / Metro / Expo Router 骨架 | ✅ 通过 | Expo 配置与 router 入口存在，playground `tsc --noEmit` 通过，Vite 入口已移除 |
| 1.3 Web 端可交互启动 | ✅ 通过 | Web Playwright 验证 smoke surface 可交互、无 console error、无外部网络请求 |
| 1.4 iOS / Android 端可交互启动 | ⏸️ 保持未完成 | Linux 环境无模拟器/真机，缺少真实交互运行时证据；静态 `expo export` 不可替代 |
| 1.5 依赖引入与 Vite 运行时移除 | ✅ 通过 | React/ReactDOM/react-test-renderer=19.2.3、RN=0.86.3 收敛；Vite 运行时依赖与入口移除 |

## 1.2 Expo SDK 57 应用骨架

### Expo Router / Metro / Vite 移除

- `apps/playground/package.json` 的入口为 `"main": "expo-router/entry"`，已由 Vite 入口迁移为 Expo Router。
- Expo 配置存在于 `apps/playground/app.json`：`web.bundler = "metro"`、`web.output = "single"`、`plugins = ["expo-router"]`；`newArchEnabled = true`。
- Metro 配置位于 `apps/playground/metro.config.cjs`，直接基于 `expo/metro-config` 的 `getDefaultConfig(__dirname)`，未使用旧的 `watchFolders`/别名 hack；仅额外将 `wasm` 加入 `resolver.assetExts`，以支持本地 CanvasKit 静态资源。
- Babel 配置位于 `apps/playground/babel.config.cjs`。
- Expo Router 目录入口位于 `apps/playground/app/`：`_layout.tsx`、`index.tsx`、`skia-smoke.tsx`。
- Vite 运行时残留移除：旧 `apps/playground/index.html`、`apps/playground/vite.config.ts`、`apps/playground/src/main.tsx` 已删除。

### app 外平台路由隔离

- Expo Router 使用同步 `require.context` 收集路由，因此路由文件只保留平台无关的薄入口，Web-only 的 CanvasKit 实现放在 `.web.tsx` 平台后缀文件中：
  - `/skia-smoke`：`src/skia/SkiaSmokeRoute.tsx`（薄入口）+ `src/skia/SkiaSmokeRoute.web.tsx`（CanvasKit Web 实现）。
  - `/`：`src/LegacyPlaygroundRoute.tsx` + `src/LegacyPlaygroundRoute.web.tsx`。
- 效果：CanvasKit 与 Web legacy DOM/CSS（含 `types/css.d.ts` 声明的 CSS side-effect import）均**不进入 native 模块图**；native 端只加载 app 内部 smoke surface，绝不进入 `@hamster-note/painting` 根 barrel（其中含 DOM/SVG/multi-drag）。
- 保留既有 Web legacy demo 的视觉与交互，同时避免其被解析进 native 打包图。

### 验证命令

| 命令 | 结果 |
| --- | --- |
| `tsc --noEmit`（`apps/playground`） | ✅ 通过 |
| `expo install --check` | ✅ 通过（依赖与 SDK 57 对齐） |

## 1.3 Web 端可交互启动

在浏览器自动化（Playwright）下访问 `http://127.0.0.1:5266/skia-smoke`：

- 本地 CanvasKit（`/canvaskit.wasm`，本机 origin）载入后**出现 smoke surface**，无白屏、无启动崩溃。
- **拖动**绘制交互生效，坐标实时更新并记录为 **`x 230 · y 190`**。
- **清除**操作后画布**复位**为“尚未绘制”。
- 控制台**无 console error**。
- 网络面板：fetch / XHR / WASM 请求**仅指向 localhost（本机 origin）**，无外部 CDN 请求。

Web 启动脚本已适配 Expo CLI 57：原 `dev:web` 中 Expo CLI 57 不支持的 `--no-open` 已删除；`expo start --web --lan --port 5266` 能正常监听并被自动化工具连接。

## 1.5 依赖引入与 Vite 运行时移除

### 依赖收敛

- React / React DOM / react-test-renderer 统一为 **19.2.3**：
  - `apps/playground/package.json`：`react: 19.2.3`、`react-dom: 19.2.3`。
  - `packages/painting/package.json`、`packages/painting-board/package.json`：`peerDependencies.react ^19.0.0`，devDependencies `react: 19.2.3`、`react-dom: 19.2.3`。
  - 根 `package.json`：`react-test-renderer: 19.2.3`。
- React Native 统一为 **0.86.3**：
  - `apps/playground/package.json`：`react-native: 0.86.3`。
  - `packages/painting/package.json`、`packages/painting-board/package.json` devDependencies：`react-native: 0.86.3`。
- 已引入 `@shopify/react-native-skia`、React Native Gesture Handler、Reanimated 及 Expo 认证所需依赖（由 Expo SDK 57 对齐的 `expo install` 结果与 lockfile 体现）。
- Vite 运行时依赖与入口已从 playground 移除；不再打包 Vite 运行时。

### 验证命令

| 命令 | 结果 |
| --- | --- |
| `expo export --platform web` | ✅ 成功 |
| `expo export --platform android` | ✅ 成功（静态打包证据，非运行时） |
| `expo export --platform ios` | ✅ 成功（静态打包证据，非运行时） |
| `pnpm typecheck` | ✅ 通过 |
| `pnpm lint` | ✅ 通过（0 error，4 个既有 warning） |
| `pnpm build` | ✅ 通过（库构建 + Expo Web 导出） |

`pnpm lint` 的 4 个 warning 为迁移前既有项（`jest/expect-expect` 1 处；`react-hooks/exhaustive-deps` 3 处），不阻塞。

## 测试基线状态（`pnpm test`）

`pnpm test` 仍为 **exit 1**：**255 tests passed / 10 suites failed**，均为基线允许保留的既有遗留：

1. `@system-ui-js/multi-drag` ESM 未被 Jest 转换（对应迁移任务 4.4）。
2. `@hamster-note/components` 未构建、moduleNameMapper 目标缺失。

说明：此前记录的“React 18 package devDependency 与 Expo React DOM 19 混配导致的 Testing Library suite 初始化 React TypeError”在依赖收敛到 React/ReactDOM/react-test-renderer=19.2.3 之后**已消失**；当前失败不再包含该项。

## 1.4 原生运行时门（保持未完成）

- 任务 1.4 要求 iOS 与 Android 端可交互启动并呈现绘制面入口。
- 当前 Linux 环境**没有 iOS/Android 模拟器或真机**，无法取得真实交互运行时证据。
- `expo export --platform android|ios` 仅为**静态打包证据**，**不可替代**真实运行的交互门。
- 因此 1.4 **必须保持未完成**，作为外部证据债务，待具备模拟器/真机环境后补做。

## 结论

- 阶段 1 的 1.2、1.3、1.5 已由 Oracle 复审 APPROVE，可关闭；1.4 保留未完成并作为外部证据债务。
- 阶段 2 可以开始；阶段 1 门禁判定为批准（在 1.4 保留为外部证据债务的前提下）。
- 写入合规：仅新增本报告文件，未修改任何应用源码、依赖、lockfile、CI 或既有未提交文件（tasks.md 与 deepwork 状态文件的更新由本任务的独立记录动作完成）。
