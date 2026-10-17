# 任务 7.4 验证报告（Web-only）：Web 默认正式 Skia 编辑面切换

- 变更：`migrate-expo57-skia-surface`
- 任务：**7.4**（门禁通过后让 Skia 成为 **Web 的默认正式编辑面**）
- 验证所有者：父 orchestrator
- 门禁：**Oracle Gate 7.4 Web-only APPROVE**（父 orchestrator 为验证所有者）
- 状态：**在正式 Web-only 验收范围内关闭 7.4**；**仅关闭任务 7.4**，不代表 Gate 10、不代表 change 完成
- 生成时间：2026-09-27
- 写入范围：仅本报告文件、`tasks.md` 的 7.4 勾选与链接、`decisions/web-only-acceptance-scope.md` 的当前状态 supersession、`.slim/deepwork/migrate-expo57-skia-surface.md` 状态回填。
  未修改产品源码、路由、测试、`package.json`、lockfile、CI 或任何历史验证报告/其它 OpenSpec 工件。

## 1. 范围声明（Web-only；明确不代表 native）

- 本验收遵循 `decisions/web-only-acceptance-scope.md`：正式产品验收面为 **Web**；
  原生 iOS/Android **只保留 `compat-static` 静态兼容门**。
- 7.4 的关闭**仅**表示：在 **Web-only** 范围内，根 `/` 已切换为**候选编辑器**这一正式 Web Skia 编辑面，
  默认即 Skia、正常使用不再回退。
- **明确不代表**：
  - **native / 全平台运行**——原生只做 `compat-static` 静态兼容，**绝无 runtime 主张**；
  - **性能门 10.x**（Web 性能合同尚未执行，10.1/10.2/10.3 仍 OPEN）；
  - **8.1 / 8.2 / 8.5、9.2 / 9.4、11.x、12.1**（全部保持 OPEN）；
  - **绝对像素 / GPU 性能 / 逐像素等价**——候选根证据仅来自 **Web Chromium**。
- 本报告所有 Web 证据**不得**被包装为 native 运行时证据；native 证据只以
  `[evidence:compat-static]` 标注。

## 2. 结论速览

| 项 | 结论 | 主要证据 |
| --- | --- | --- |
| 根 `/` 正式切换为候选 Web Skia 编辑器 | ✅ 通过 | `app/index.tsx` 薄 export `EditorCandidateRoute`；根切 canary |
| `/editor-candidate` 兼容别名保留 | ✅ 通过 | `app/editor-candidate.tsx` 同一 `EditorCandidateRoute`；别名 canary |
| `/legacy` 保留旧多 demo | ✅ 通过 | `app/legacy.tsx` → `LegacyPlaygroundRoute`；canary 无 legacy marker |
| 候选 root Chromium E2E | ✅ 52/52 通过，`[platform:web-chromium][build:fresh-headless-metro]` | `tests/ui/editor-candidate.spec.ts` |
| 后根切工作区全量验证 | ✅ test 65/1043、typecheck、lint 0 error/8 known warnings、build、diff check | 见 §5 |
| production Web export direct-route 探针 | ✅ candidate=1 / legacy=0 / canvas=1 / wasm 200 / 无 route/page error | `[build:production-web-export]` 见 §6 |
| native `compat-static` | 静态兼容（非运行） | `[evidence:compat-static][target:ios\|android][executor:linux]` 见 §7 |
| legacy 组 | ✅ 71/71 通过；**另有 3 个 pre-cut 既有失败保留** | 见 §8 |

**总体判定：在正式 Web-only 范围内，根 `/` 已切换为候选编辑器（Web 默认 Skia 编辑面），
Oracle Gate 7.4 Web-only APPROVE，任务 7.4 关闭。此关闭不代表 Gate 10、不代表阶段 7 之外的任何
门禁、也不代表 change 完成。**

## 3. 根路由与根切 canary 事实

- **根 `/`（正式默认面）**：`apps/playground/app/index.tsx` 为平台无关**薄入口**，仅
  `export default EditorCandidateRoute`；平台实现由 Metro 选择：
  native 基名 `src/editor-candidate/EditorCandidateRoute.tsx`（**compat-static 说明页，不是编辑器**），
  web 覆盖 `src/editor-candidate/EditorCandidateRoute.web.tsx`（延后加载 CanvasKit）。
- **`/editor-candidate`（兼容别名）**：`app/editor-candidate.tsx` 同样薄 export 同一
  `EditorCandidateRoute`，仅作**不动作的诊断/兼容别名**保留，不掩盖根路径失败。
- **`/legacy`（旧多 demo 保留）**：`app/legacy.tsx` → `src/LegacyPlaygroundRoute`（web 覆盖为
  legacy DOM demo），旧多 demo 继续经 `/legacy` 访问。
- **根 canary（`tests/ui/editor-candidate.spec.ts` 第 3098 行起 describe）**：
  在**任何 `goto` 之前**以 `page.addInitScript` 安装 `MutationObserver`（即**navigation 之前**登记，
  能看到候选编辑器挂载的完整 DOM 变更历史），记录：
  - 从**首个 DOM mutation** 起**从未出现**任何 legacy marker
    （`drawing-tool-toolbar` / `drawing-surface-uncontrolled` / `painting-board` / `painting-board-demo-a`）；
  - 生命周期内 **canvas 数量的历史最大值与最终值均为 1**；
  - WASM 阻断失败态仍在 `/`：候选 route **error + retry** 可见、**canvas 0**、
    **无自动 legacy fallback / 无重定向**、从未出现 legacy 标识。
  - 别名 canary 单独证明 `/editor-candidate` 仍挂载同一候选编辑器（不复用根路径覆盖来掩盖失败）。

## 4. 候选 root Chromium E2E（52/52）

- **命令/环境标签**：`[platform:web-chromium]`、`[build:fresh-headless-metro]`。
  以 **fresh headless Metro**、**workers=1**、**构件准备先完成**（本地 CanvasKit / fonts manifest
  已就绪）为前置条件，对**候选根 `/`** 运行 `tests/ui/editor-candidate.spec.ts`，
  **52/52 Chromium 通过**（50 个静态用例 + D3 参数化 3 例展开）。
- **覆盖范围**：production Frame、十工具（pen/line/rect/ellipse/polygon/bezier/eraser/lasso/text/image）、
  selection **move / rotate / uniform scale**（四角等比，无 shear）、text composition（含 Unicode /
  emoji）、image 导入、fonts on-demand、dSF readback + frame hit、ruler、wheel + touch navigation、
  lifecycle diagnostics，以及 root / alias / failure **canary**。
- **证据强度边界**：这些用例只断言 **DOM 语义**（testID / title / 可访问名称）与 core 暴露的
  计数 / history / selection 文本，以及同源 `canvaskit.wasm` 200 `application/wasm`；
  **不是**绝对像素比对、**不是** GPU/帧率性能基线、**不是** native 行为验证。

## 5. 后根切工作区全量验证（父 orchestrator）

- `pnpm test`：**65 suites / 1043 tests**；
- `pnpm typecheck`：**通过**；
- `pnpm lint`：**0 errors / 8 known warnings**（8 个为既有已知 warning）；
- `pnpm build`：**通过**（`painting-board` 既有 Bob exports warnings 为非阻断既有项）；
- `git diff --check`：**通过**；
- **已知非阻断项**：PaintingBoard mock `<view>` console warning 为既有已知项，不阻断。

## 6. production Web export direct-route 探针

- **标签**：`[build:production-web-export]`。
- **探针结果**（fresh production Web export 的 direct route probe）：
  - `/`：candidate=1、legacy=0、canvas=1、`wasm` 200 `application/wasm`、fonts manifest 200、
    无 route/page error；
  - `/legacy`：legacy toolbar=1、canvas=0；
  - `/editor-candidate`：candidate=1、canvas=1、assets 200。
- **边界**：只能称其为 **production direct-route / asset / mount 证据**，
  **不是** production interaction suite（交互行为由 §4 的 Chromium E2E 覆盖）。

## 7. native `compat-static`（静态兼容，非运行）

- 后根切的 **iOS + Android `expo export --platform ios|android`** 静态导出成功，
  以及 **native Jest/RNTL 2 suites / 5 tests** 最小挂载通过。
- 统一标注为 **`[evidence:compat-static][target:ios|android][executor:linux]`**。
- **明确**：这是**静态兼容证据**，**绝无 runtime / 启动 / 触控 / 手势 / Skia 渲染 / IME / picker /
  权限 / 性能主张**；不得据此声称任何原生运行通过。

## 8. legacy 组结果（准确保留既有失败）

- **`/legacy` passing group 71/71**：
  - `playground` 49；`ruler` 14；`ruler-edge` 3；`touch-ruler` 1；`width` 2；`color` 2。
- **另有 3 个 pre-cut 也存在的失败必须准确保留**（非本次引入，也不被本报告掩盖）：
  1. `interaction-feedback` wheel zoom：expected **120** got **119**；
  2. touch zoom midpoint：expected **131** got **130**；
  3. touch-drawing：expected zero opacity `.7` path，got **1**。
- **不得**将 legacy 组、`test:ui` 或 CI 描述为**全绿**。

## 9. 证据标签与工作树说明

- 使用（至少）以下标签区分证据强度与来源：
  - `[platform:web-chromium]`：候选根 Chromium Web 行为证据；
  - `[build:fresh-headless-metro]`：fresh headless Metro、workers=1、构件预备的候选 E2E；
  - `[build:production-web-export]`：production Web export direct-route 探针；
  - `[evidence:compat-static][target:ios|android][executor:linux]`：native 静态兼容。
- **实际工作树为 dirty**（迁移涉及大量未提交改动）；因此**本报告不以 HEAD 唯一标识**工件，
  证据以本工作树时间点的命令输出与已批准门禁结论为准。

## 10. 开放项与边界保持

- 本报告**不**声称 change 完成，也**不**声称阶段 7 之外任何门禁完成（**非 Gate 10**）。
- 以下 Web-only scope 内任务**保持 OPEN**：
  **8.1 / 8.2 / 8.5**（Web 临时编辑、组合/多行/emoji、Web shell importer）、
  **9.2 / 9.4**（legacy DOM/SVG 等价覆盖、正式 Web 编辑面 E2E）、
  **10.1 / 10.2 / 10.3**（Web 性能合同、Web 功能验收、Web 默认切换门）以及
  **11.1 / 11.2 / 11.3 / 11.4、12.1**。
- **`compat-static` 表述保持**；**1.4 / 4.2** 按已修订 scope 的既有状态保持，
  **不重新解释为 runtime 通过**；**6.3 保持关闭**，不改动其证据。
- **legacy 删除仅当 7.4 完成后才涉及**（11.1 边界），本报告不触发任何 legacy 删除。
- **旧范围历史不改写**；`decisions/web-only-acceptance-scope.md` 的 7.4 历史 `OPEN` 表述
  由该文件新增的**当前状态 supersession** 取代。

## 11. 验证方式（复现要点）

- 根 canary：navigation 前以 `addInitScript` 安装 `MutationObserver`，断言从首个 DOM mutation
  起无 legacy marker、canvas 历史最大/最终均为 1，并覆盖 WASM 阻断失败态与别名。
- 候选根：fresh headless Metro、workers=1、构件预备后运行 `tests/ui/editor-candidate.spec.ts`。
- production 探针：fresh production Web export 后对 `/`、`/legacy`、`/editor-candidate` 做
  direct-route / asset / mount 检查。
- native：根 typecheck + `expo export --platform ios|android` + native Jest/RNTL（`compat-static`）。
- 全量：`pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm build`、`git diff --check`。
