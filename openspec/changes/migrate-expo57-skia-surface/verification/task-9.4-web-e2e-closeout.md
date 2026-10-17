# 任务 9.4 Web-only 闭合报告：正式根 Web 编辑面 E2E

- 变更：`migrate-expo57-skia-surface`
- 任务：**9.4**（`REPLACED` 为 **Web E2E**；原三端原生 E2E 已 `CANCELLED`）
- 验证所有者：**父 orchestrator**
- 状态：**在正式 Web-only 验收范围内关闭 9.4**
- 生成时间：2026-09-28
- 写入范围：仅本报告文件、`tasks.md` 的 9.4 勾选/9.2 文字审计澄清、
  `decisions/web-only-acceptance-scope.md` 的**当前状态 supersession / 状态矩阵 9.4**、
  `specs/cross-platform-drawing-surface/spec.md` 的 **9.2 与 11.1 先替代后退役时序**澄清、
  `.slim/deepwork/migrate-expo57-skia-surface.md` 的**当前状态**回填。
  **未修改产品源码、测试、路由、legacy 实现、`package.json`、配置、锁文件或任何历史验证报告。**

## 1. 范围声明（Web-only；明确不代表 native / 全浏览器 / 性能）

- 本验收遵循 `decisions/web-only-acceptance-scope.md`：正式产品验收面为 **Web**；
  原生 iOS/Android **只保留 `compat-static` 静态兼容门**。
- 9.4 的关闭**仅**表示：在 **Web-only** 范围内，**正式根 `/` Web 编辑面**的
  端到端测试覆盖义务已完成并通过。
- **明确不代表**：
  - **iOS/Android 运行**——原生运行要求已 `CANCELLED`，只做 `compat-static` 静态兼容；
  - **全浏览器兼容**——证据仅为 **Chromium Web**；
  - **绝对像素 / GPU / 性能门**——证据主要是 DOM/state/diagnostic 与**有限 Canvas 信号**，
    不是逐像素、GPU 或帧率基线；
  - **Gate 10 / change 完成**。
- 本报告所有 Web 证据**不得**被包装为 native 运行时证据；native 证据只以
  `[evidence:compat-static]` 标注。

## 2. 结论速览

| 项 | 结论 | 主要证据 |
| --- | --- | --- |
| 正式根 `/` Web 编辑面 E2E | ✅ **57/57 Chromium 通过**，`[platform:web-chromium]` | `tests/ui/editor-candidate.spec.ts --workers=1 --trace=off` |
| 覆盖范围 | ✅ 同源 CanvasKit、10 工具、绘制/selection/ruler/navigation/text/image/font tiers/frame query | 见 §3 |
| 正式根 / 兼容别名 / WASM failure canary | ✅ 通过 | 根证据来自根 `/`；`/editor-candidate` 仅作兼容别名证据 | 见 §4 |
| 证据强度边界 | ⚠️ 仅 Chromium Web；DOM/state/diagnostic + 有限 Canvas 信号 | 见 §5 |

**总体判定：在正式 Web-only 范围内关闭 9.4。此关闭仅表示正式根 Web 编辑面 E2E 覆盖义务完成，
不代表 iOS/Android、全浏览器、绝对像素/GPU/性能、Gate 10 或 change 完成。**

## 3. 覆盖范围与命令

- **命令 / 环境标签**：`[platform:web-chromium]`。
  `tests/ui/editor-candidate.spec.ts --workers=1 --trace=off`，对**正式根 `/`** 运行，
  **57/57 Chromium 通过**（50 个静态用例 + D3 参数化 3 例展开，含 8.1/8.2/8.5 边界证据组）。
- **覆盖能力**：
  - **同源 CanvasKit**：本地 `canvaskit.wasm` 加载成功（同源、无外部 CDN）；
  - **10 工具**：pen/line/rect/ellipse/polygon/bezier/eraser/lasso/text/image；
  - **绘制 / selection**：selection **move / rotate / uniform scale**（无 shear）；
  - **ruler**：尺子抓取与 45° 吸附；
  - **navigation**：wheel + touch 导航/缩放；
  - **text**：文本编辑层与提交后由 frame 渲染、composition/emoji；
  - **image**：图片导入与渲染；
  - **font tiers**：Latin / CJK on-demand / emoji on-demand 实际 ready；
  - **frame query**：dSF readback + frame hit、frame diagnostics。

## 4. 正式根 / 兼容别名 / WASM failure canary

- **正式根证据来自根 `/`**：本报告的关键 E2E 结论以根 `/`（正式默认 Web Skia 编辑面）为准。
- **`/editor-candidate` 仅为兼容别名**：它复用同一 `EditorCandidateRoute`，仅作不动作的
  **诊断/兼容别名**；**不得**用该别名结果**替代正式根证据**。
- **WASM failure canary**：阻断 WASM 时，根 `/` 仍为候选 error + retry、**canvas 0**、
  **无自动 legacy fallback / 无重定向**、从未出现 legacy marker。
- **不影响 `/legacy`**：本报告不触发 `/legacy` 旧多 demo 的任何变更或删除；`/legacy` 保留其
  既有状态（含既有非阻断失败）。
- **根切 canary 事实**（沿用已关闭的 7.4 证据）：navigation **之前**以 `addInitScript` 安装
  `MutationObserver`，断言从**首个 DOM mutation** 起从未出现 legacy marker，
  canvas 历史最大值与最终值均为 1。

## 5. 证据强度边界（明确不证明）

- **仅 Chromium Web**：证据来自 Chromium，**不是**全浏览器兼容矩阵（Firefox/WebKit 未覆盖）。
- **主要 DOM/state/diagnostic 与有限 Canvas 信号**：用例断言 DOM 语义（testID/title/可访问名称）、
  core 暴露的计数/history/selection 文本，以及同源 `canvaskit.wasm` 200 `application/wasm`；
  Canvas 信号为**有限**存在性断言。
- **不是绝对像素/GPU/性能**：无截图像素比对、无 GPU 行为、无帧率/性能基线。
- **不是 iOS/Android**：无原生启动/触控/手势/Skia 渲染/IME/picker/权限证据。
- **不得外推**：不得称 Gate 10、native/全平台运行、9.2 完成、11/12 完成或整个 change 完成。
- **工作树为 dirty**：迁移涉及大量未提交改动，证据以本工作树时间点的命令输出与门禁结论为准。

## 6. 与 9.2 / 11.1 的关系（不冲突）

- **9.4 关闭不影响 9.2**：9.2（legacy DOM/SVG 测试先替代后退役）**保持 OPEN**。
- **9.2 退役时序绑定 11.1**：legacy 实现及相关 DOM/SVG 测试的退役 **MUST** 与 **11.1**
  legacy 实现的稳定期退役在**同一变更**中发生，**不得**提前删除。
- 本报告不删除、不改写任何 legacy 实现或 DOM/SVG 测试。

## 7. 验证方式（复现要点）

- 正式根 E2E：fresh headless Metro、`--workers=1 --trace=off`，运行
  `tests/ui/editor-candidate.spec.ts`，确认 **57/57 Chromium 通过**。
- 根 canary：navigation 前安装 `MutationObserver`，断言无 legacy marker、canvas 历史最大/最终均为 1，
  并覆盖 WASM 阻断失败态。
- 空白检查：对新报告 / deepwork / decision / spec 运行 `git diff --no-index --check`
  （文件存在差异时 exit 1 正常，仅要求**无 whitespace 输出**）。
