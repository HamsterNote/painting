# 阶段 3 验证报告：V2 纯核心层与 V1 迁移兼容

- 变更：`migrate-expo57-skia-surface`
- 任务：3.1、3.2、3.3、3.4（阶段 3 整体）
- 验证所有者：父 orchestrator
- 状态：**阶段 3 已通过，Oracle Gate 3 attempt 2 APPROVE**
- 生成时间：2026-09-23
- 写入范围：仅本报告文件（`verification/`）。未修改产品源码、依赖、lockfile、测试或 CI。

## 结论速览

| 任务 | 结论 | 证据 |
| --- | --- | --- |
| 3.1 纯 core（文档/几何/命中/viewport） | ✅ 通过 | `packages/painting/src/core/{document,transient,geometry,index}.ts` |
| 3.2 V1→V2 读时迁移与未知字段容忍 | ✅ 通过 | `core/document.readDrawingDocument` + `model/strokeMigration` |
| 3.3 V2 公开类型收敛 + 兼容 shim | ✅ 通过 | canonical `@hamster-note/painting/core`；root `pnpm typecheck` 通过 |
| 3.4 持久 document 与高频 transient 分离 | ✅ 通过 | `core/transient` effect dispatcher 单测 |

**总体判定：阶段 3 通过。Oracle Gate 3 attempt 2 APPROVE。**

## 实现范围（3.1–3.4）

### 新增纯 core 模块（3.1）

新增 `packages/painting/src/core/{document,transient,geometry,index}.ts`：

- `core/document.ts`：`readDrawingDocument` 读时迁移、`addStroke`/`updateStroke`/`removeStroke`/`clearStrokes` 不可变文档操作。
- `core/transient.ts`：`CoreState`/`CoreEffect`/`CoreTransition` 契约、`createCoreState`/`updateTransient`/`cancelTransient`/`clearTransient`/`commitDocument`。
- `core/geometry.ts`：唯一 geometry descriptor（path/cubic-bezier/rect/ellipse）、保守 bounds、命中测试。
- `core/index.ts`：纯入口，仅重导出同目录纯模块、V2 模型（`../model/strokes`）与纯 viewport（`../viewport`）。

core 完整导入闭包不含根入口、`components`/`hooks`/`render`/`utils`、`react`/`react-dom`/`react-native`、DOM 或 Skia/multi-drag，由 `core/document` 的静态导入图断言强制。

### Canonical API（3.3）

- 公开 canonical 纯 API 为 `@hamster-note/painting/core`，统一以 V2 为基准：V2 类型与 `DRAWING_STROKE_SCHEMA_VERSION` schema、geometry/hit、viewport、document/transient 均从该入口公开。
- 包根 `src/index.ts` 是**旧 API 兼容 shim**（`DrawingSurface`、旧 hooks、旧 utils、V1 类型等），不再 star 重导出 `./core`，不作为纯入口使用；core 与 legacy 同名操作不会在根入口发生隐蔽语义遮蔽。

### V1/V2 读时迁移与未知字段限制（3.2）

- `readDrawingDocument` 对缺失 `schemaVersion` 的 V1 数据与显式 V2 数据均在读取时非变异迁移，内部规范模型统一为 V2；输入对象与点/数组不被就地修改。
- **未知字段仅容忍、不承诺 round-trip**：未知 stroke/point 可选字段被接受但不保留；未知顶层字段随对象展开保留（已知语义不受影响）。
- **future schema 有 diagnostic 但当前规范化为 V2**：非 V2 的显式 `schemaVersion` 产生 `unsupported-schema-version` 诊断，同时仍安全返回规范化 V2 文档，避免把未来版本误当 V1 静默降级。

### transient 与 document 分离（3.4）

- core 契约层分离持久 `document` 与高频 `transient`；逐帧 `updateTransient`/`cancelTransient`/`clearTransient` 保持 `document` 引用严格不变、`effects` 恒为空。
- 唯一副作用 `CoreEffect` 为 `document-commit`；本地 effect dispatcher 单测断言：transient 更新不触发 history/onChange，仅 `commitDocument` 每次提交恰好触发一次 history 与 onChange，且 payload 只含 document、绝不携带 transient。

### Bob dual ESM/CJS 条件 exports（3.3）

`packages/painting/package.json` 的 `exports["./core"]` 提供三条件解析：

- `react-native` → `./src/core/index.ts`（+ module 类型）
- `import` → `./lib/module/core/index.js`（ESM）
- `require` → `./lib/commonjs/core/index.js`（CJS）

原因：同时支持 Metro/RN 直读 TS source、Node/bundler 的原生 ESM `import` 与 CJS `require`，并保持类型声明分条件解析；Bob `builder-bob` 同时产出 commonjs 与 module 两套目标。

## 命令与精确结果

| 命令 | 结果 |
| --- | --- |
| targeted Jest（core 4 套件 + `stroke-helpers.test.ts`） | **5 suites passed / 83 tests passed** |
| root `pnpm typecheck` | **exit 0**（painting、painting-board、playground 均通过） |
| `pnpm lint` | **0 errors / 6 warnings** |
| painting build（Bob） | **无 warnings** |
| CJS + ESM public self-reference | **通过**，两条件导出键集合一致 |
| `git diff --check` | **exit 0** |

- targeted Jest 命令：`node_modules/.bin/jest --runInBand packages/painting/src/__tests__/core packages/painting/src/__tests__/stroke-helpers.test.ts`；5 套件为 `core/{document,geometry,transient,viewport}.test.ts` 与 `__tests__/stroke-helpers.test.ts`。
- lint 6 warnings 构成：**新增 viewport Jest 规则 warnings 2 个**（`core/viewport.test.ts` 的 `it.each` 回调内断言经 helper 间接执行，触发 `jest/expect-expect`），**4 个既有**（`DrawingSurface.test.tsx` 1 个、`DrawingSurface.tsx` 3 个 `react-hooks/exhaustive-deps`）。
- CJS/ESM 自引用：`packages/painting` 内 `require('@hamster-note/painting/core')` 与 `import * as ... from '@hamster-note/painting/core'` 均成功，键集合一致（document/transient/geometry/viewport + V2 schema 常量等）。

### 条件解析与 Expo 导出

- `react-native` 条件解析到 `src/core/index.ts`（Metro 需直读源码）；**Node 无法直接执行 TS source 属预期**——Node 侧走 `import`/`require` 构建产物。
- 最终配置下 **Expo `android` / `web` export 通过**。

## 边界与不在本阶段结论内的项

- 本报告**不声称真实 native 交互**：未在模拟器/真机上运行 core，native 行为与性能须由后续阶段在真实设备验证。
- 几何为保守描述：bounds 与命中基于 descriptor 近似，**`geometry` 的 rendered/index bounds**、Bezier/text/image 近似尚未与最终 Skia 渲染几何对齐。
- 文档模型允许**重复 ID**，`update`/`remove` 仅命中从前到后的第一条；索引语义为有序条目，**不建立去重索引**。
- **unknown stroke/point 字段只容忍、不承诺 round-trip**；future schema 虽有 diagnostic，当前实现仍规范化为 V2。
- **rebase / hash / GestureSession 尚未开始**（归 6.3、4.x 及后续阶段）。
- 任务 **1.4** 债务不变：Linux 环境无 iOS/Android 模拟器/真机，三端真实运行时门仍保留为外部证据债务。
- 下一步仅可进入**阶段 4 勘查**，不开始阶段 4 实施。
