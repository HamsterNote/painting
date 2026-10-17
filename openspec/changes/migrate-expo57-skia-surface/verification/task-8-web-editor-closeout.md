# 阶段 8 Web-only 闭合报告：Web 文本编辑层（8.1）、组合输入（8.2）与 Web shell 导入（8.5）

- 变更：`migrate-expo57-skia-surface`
- 任务：**8.1、8.2、8.5**（本报告覆盖这三项；**8.3、8.4 已由
  `verification/task-8-phase-8-text-resources.md` 在 Gate 8 attempt 2/3 关闭**）
- 验证所有者：**父 orchestrator**
- 门禁：**Gate 8 Web-only 最终批准**（父 orchestrator 为验证所有者），**批准关闭 8.1、8.2、8.5**
- 状态：**在正式 Web-only 验收范围内关闭 8.1、8.2、8.5**
- 生成时间：2026-09-28
- 写入范围：仅本报告文件、`tasks.md` 的 8.1/8.2/8.5 勾选与链接、
  `decisions/web-only-acceptance-scope.md` 的**当前状态 supersession / 状态矩阵**、
  `.slim/deepwork/migrate-expo57-skia-surface.md` 的**当前状态**回填。
  **未修改产品源码、测试、路由、字体、核心、`package.json`、配置或任何历史验证报告/其它 OpenSpec 文档。**

## 1. 范围声明（Web-only；明确不代表 native）

- 本验收遵循 `decisions/web-only-acceptance-scope.md`：正式产品验收面为 **Web**；
  原生 iOS/Android **只保留 `compat-static` 静态兼容门**。
- 8.1、8.2、8.5 的关闭**仅**表示：在 **Web-only** 范围内，正式 **Web Skia 编辑面（根 `/`）** 的
  临时文本编辑层、组合/多行/emoji 输入与 **Web app shell 导入**义务已完成并通过门禁。
- **原「原生运行 / IME / picker / 权限」验收要求已 `CANCELLED` 并由 Web 义务 `REPLACED`**；
  本次关闭**只是 Web-only 义务完成**，**不是原生运行通过**。
- 本报告所有 Web 证据**不得**被包装为 native 运行时证据；native 证据只以
  `[evidence:compat-static]` 标注。

## 2. 结论速览

| 任务 | 结论 | 主要证据 |
| --- | --- | --- |
| 8.1 Web 临时文本编辑层与提交后绘制面渲染 | ✅ Web-only 义务完成 | 根 `/` 绝对定位 textarea 临时 overlay；draft/composition 不写 document/history；提交后 overlay 移除、frame 渲染 |
| 8.2 Web 组合输入（多行 / 混合 Unicode / emoji ZWJ） | ✅ Web-only 义务完成 | `中文 CJK + Latin 👨‍👩‍👧‍👦\nsecond line` 原串保留；composition 中提交挂起、`compositionend` 一次提交；frame ready/renderable + 有限 Canvas readback + frame hit 回填原串 |
| 8.5 Web shell 导入 | ✅ Web-only 义务完成 | FileReader / HTMLImage 解码；Web MIME/大小/尺寸/像素限制；cancel token；resourceId registry-first；SkImage 同步注入；undo/redo 可达不提前释放 |
| 根候选套件 Chromium | ✅ **57/57** | `tests/ui/editor-candidate.spec.ts`（含 8.1/8.2/8.5 边界证据组） |
| 字体资产校验 | ✅ 通过 | `apps/playground` `fonts:verify` |
| 全量门禁 | ✅ test 65 suites/1043、typecheck、lint 0 error/8 既有 warnings、build、diff check | 见 §6 |

**总体判定：在正式 Web-only 范围内，Gate 8 最终批准关闭 8.1、8.2、8.5；
结合已关闭的 8.3、8.4，阶段 8 的全部 Web-only 义务闭合。
此闭合不代表 Gate 10、不代表 native/全平台运行、也不代表 change 完成。**

## 3. 8.1 Web 临时文本编辑层与提交后绘制面渲染

- **正式编辑面**：根 `/` 为候选 Web Skia 编辑器（Gate 7.4 已关闭），文本编辑层是
  **绝对定位的 `<textarea>` 临时 overlay**，只承载编辑草稿，不参与持久 document。
- **草稿 / composition 不写 document / history**：`textarea` 的输入经
  `updateTextEditDraft` / `startTextEditComposition` / `endTextEditComposition` 更新
  **纯会话**；草稿期笔迹计数与 history 计数**不增长**（E2E 断言 `笔迹 0` / history `0,0`）。
- **Done during composition pending**：composition 活跃时点击“完成”只把提交**挂起**
  （`requestTextEditCommit` → `isComposing` 时不提交），overlay 仍在，不写 document。
- **end 一次提交**：`compositionend`（或非组合态完成）时**恰好一次**提交：
  overlay 消失、`笔迹 1`、history 恰 `+1`。
- **overlay 移除 + 绘制面渲染**：提交后临时层移除，段落转由正式 Skia frame 渲染
  （frame diagnostics 显示 `Frame ready · visible 1`、`未解决裁剪 0`，并展示已提交文本）。
- **既有编辑 / hit / undo / cancel 正确**：
  - **既有编辑**：以 `index + expectedStrokeId + expectedTool` 三元组锁定既有文本，命中后回填原串；
  - **hit**：点击已有文本可再次进入编辑 overlay（frame-only hit）；
  - **undo**：单会话单次提交对应单个撤销单元（8.3 已建立），撤销精确还原；
  - **cancel**：取消 overlay、document/history 不变。

## 4. 8.2 Web 组合输入（多行 / 混合 Unicode / emoji）

- **原串保留**：`中文 CJK + Latin 👨‍👩‍👧‍👦\nsecond line`（CJK、Latin、emoji ZWJ、
  硬换行）在 `textarea` 与提交后帧中**逐 code-unit 保留原串**，不规范化、不截断、不重排。
- **glyph 覆盖判定边界**：C0/C1 控制码、ZWJ（`U+200D`）、variation selector
  （`U+FE00–FE0F`）、bidi 控制（`U+202A–202E` 等）、zero-width 字符**不做“需独立 glyph”检查**
  （`isLayoutControlOrFormatCodePoint`），避免把无独立可绘 glyph 的布局控制码误判为缺字；
  **`U+6587`（文）已由生产 CJK 资产 lane 纳入 subset**。
- **生产字体 / shaping / frame ready 且 renderable**：Latin + `cjk-on-demand` + `emoji-on-demand`
  三个 tier 在明确超时内实际 `ready`（`expectTextChainReady`），文本 entry 为
  `text[0] ready`，frame 为 `Frame ready · visible 1 · renderable 1`、`未解决裁剪 0`。
- **有限 Canvas readback**：仅要求首行附近存在连续非背景簇（不假设具体字形/颜色/绝对像素）。
- **frame-hit 重编辑回填原串**：对已提交 frame 文本做 hit，再次进入编辑 overlay 时
  `textarea` 的值为**逐 code-unit 相同的原串**（含 ZWJ 与换行）。
- **系统 IME 边界（明确不证明）**：本项只读取 Web `textarea` 的 code-unit selection，
  **不声称**验证系统 IME 候选窗、系统 caret、原生输入法组合行为（见 §7）。

## 5. 8.5 Web shell 导入

- **导入职责在 Web app shell**：`FileReader` 读取为 data URL，`HTMLImage`（`Image`）解码尺寸；
  core 与资源解析层不获取平台文件或媒体权限。
- **Web 输入限制（解码前冻结）**：
  - MIME 白名单 `image/png`、`image/jpeg`、`image/webp`；
  - 文件大小 **1 B–20 MiB**（`MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024`）；
  - 边长 **≤ 8192**（`MAX_IMAGE_EDGE`）、总像素 **≤ 40M**（`MAX_IMAGE_PIXELS`）。
- **cancel token**：每轮导入独占 `imageOperationRef` token；取消 / 取消文件选择 /
  document revision 变化 / unmount 都会让旧异步结果失效（丢弃，不写入）。
- **resourceId registry-first**：`resolveImage` 先经 `resolveImageResource(registry, reference)`
  解析 resourceId，命中后取 ready SkImage；否则回退按 `src` 的 ready 索引（去重 / dataURL 去重）。
- **SkImage 同步注入**：`Skia.Image.MakeImageFromEncoded` 解码后写入
  `readyImagesByIdRef` / `readyImagesBySrcRef`，供 renderer 同步消费；register/像素只在
  document append **成功后**发布，避免半导入。
- **dataURL 去重**：相同 data URL 复用既有 registry 记录与资源，避免重复导入无界增长。
- **空 file / cancel 不写**：`files` 为空或原生 `cancel` 事件只递增 token 并置取消状态，
  document / history / 资源计数均为零。
- **尺寸超限拒绝**：`8193×1` PNG header 被 `validateImageDimensions` 拒绝，
  不分配大文件、不写 document/history/resource。
- **undo/redo 可达时不提前释放**：资源只有在 **document、undo stack、redo stack 三处都不可达**
  后才释放；E2E 断言 clear / undo / redo 过程中 `data-release-total` 始终为 `0`。
- **明确不证明**：三处皆不可达时**实际 release 调用**未由稳定用户流程证明——
  本项只证明**不提前释放**（见 §7）。

## 6. 全量验证命令与结果

| 命令 / 检查 | 结果 |
| --- | --- |
| 根候选 Chromium E2E `tests/ui/editor-candidate.spec.ts` | **57/57 通过** |
| 字体资产校验 `apps/playground` `fonts:verify` | **通过** |
| 全量 `pnpm test` | **65 suites / 1043 tests** |
| `pnpm typecheck` | **通过** |
| `pnpm lint` | **0 error / 8 既有 warnings** |
| `pnpm build` | **通过**（`painting-board` 既有 Bob exports warnings 为非阻断既有项） |
| `git diff --check` | **通过** |

- 8 个 lint warning 为既有非阻断项；`PaintingBoard` mock `<view>` console warning 亦为既有项。

## 7. 明确不能证明（边界）

- **系统 IME**：不能证明系统输入法候选窗、候选选择、系统 caret 与原生输入法组合行为；
  只覆盖 Web `textarea` 的 `compositionstart` / `compositionend` 语义与 code-unit 原串保留。
- **native 运行 / Picker**：不能证明 iOS/Android 启动、触控、手势、Skia 渲染、原生 IME、
  native picker 与媒体权限；这些原生运行要求已 `CANCELLED`，只保留 `compat-static` 静态门。
- **绝对像素字体等价 / GPU / 性能**：不能证明绝对逐像素字体等价、GPU 行为或帧率性能；
  Canvas readback 仅为**有限**的存在性断言（不假设具体字形/颜色/绝对像素）。
- **实际 release 调用**：当 document、undo、redo 三处皆不可达时的**实际资源释放调用**，
  未由稳定用户流程证明；本报告只证明**不提前释放**。
- **不得外推**：不得称整个 change、Gate 10、9.2/9.4、11/12 完成。

## 8. 开放项与边界保持

- 本报告**不**声称 change 完成，也**不**声称 Gate 10 或阶段 8 之外的任何门禁完成。
- 当前仍开放的 Web-only 工作：**9.2 / 9.4、10.1 / 10.2 / 10.3 以及 11.x、12.1**。
  （6.3、7.4 及 8.1–8.5 均已在正式 Web-only 范围关闭。）
- **`compat-static` 表述保持**；**1.4 / 4.2** 按已修订 scope 保持 `CANCELLED`/`REPLACED`
  静态兼容语义，**不重新解释为 runtime 通过**。
- **阶段 8 历史报告不改写**：`verification/task-8-phase-8-text-resources.md` 保留其
  8.3/8.4 时间点事实；本报告只补充 8.1/8.2/8.5 的 Web-only 关闭。
- **legacy 删除仅当 7.4 完成后才涉及**（11.1 边界），本报告不触发任何 legacy 删除。

## 9. 验证方式（复现要点）

- 根候选 Chromium E2E：fresh headless Metro、workers=1、构件预备后运行
  `tests/ui/editor-candidate.spec.ts`（含 8.1/8.2/8.5 边界证据组）。
- 字体资产：`pnpm --filter @hamster-note/painting-playground fonts:verify`。
- 全量：`pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm build`、`git diff --check`。
- 本工作树为 dirty（迁移涉及大量未提交改动），证据以本工作树时间点命令输出与已批准门禁结论为准。
