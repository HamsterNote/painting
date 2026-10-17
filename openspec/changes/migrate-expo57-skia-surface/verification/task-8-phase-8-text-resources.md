# 阶段 8 验证报告（8.3 / 8.4）：文本编辑会话撤销单元与图片资源稳定标识

- 变更：`migrate-expo57-skia-surface`
- 任务：**8.3、8.4**（本报告只覆盖这两项纯 core 语义；**8.1、8.2、8.5 明确保持未勾选**）
- 验证所有者：父 orchestrator
- 状态：**Oracle Gate 8 attempt 2/3 APPROVE，仅批准关闭 8.3、8.4**
- 生成时间：2026-09-24
- 写入范围：仅本报告文件与 `tasks.md` 的 8.3/8.4 勾选、`.slim/deepwork/migrate-expo57-skia-surface.md` 状态回填。未修改任何产品源码、测试、包、配置或其它 OpenSpec 文档；未改动 8.1、8.2、8.5 以及 1.4、4.2、6.3、7.4 的未完成状态。

## 结论速览

| 任务 | 结论 | 主要证据 |
| --- | --- | --- |
| 8.3 一次文本编辑会话作为单个撤销单元 | ✅ 通过 | `core/textEditSession` 纯会话；draft/composition 不写 document；相邻会话各一次提交形成独立撤销单元 |
| 8.4 图片资源使用稳定唯一标识并兼容旧 `src` | ✅ 通过 | `ImageStrokeV2.resourceId?` 可选 + `src` 必填回退；迁移/读取保留；`core/resourceRegistry` 稳定解析 |

**总体判定：在 Oracle Gate 8 attempt 2/3 APPROVE 下，8.3、8.4 通过并关闭。8.1、8.2、8.5 及其余阶段 8 能力未关闭，仍需真实 iOS/Android 运行证据。**

## Gate 8 裁定

- Oracle Gate 8 **attempt 2** 与 **attempt 3** 均 **APPROVE**，**仅批准关闭 8.3 与 8.4**。
- 该批准**仅覆盖纯 core 语义**（编辑会话撤销单元、图片资源稳定标识与旧 `src` 兼容）；**不表示**阶段 8 整体完成。
- **8.1 / 8.2 / 8.5 保持未勾选**：仍欠真实 iOS/Android 临时编辑层、IME 组合输入（CJK/emoji/多行）与 native picker 权限运行证据；Linux 环境无模拟器/真机，Web E2E 与 Metro export 不能替代。

## 8.3 实现与证据（文本编辑会话 = 单个撤销单元）

- **纯会话边界**：`core/textEditSession` 的 `draft`、`isComposing`、`measuredHeight` 等编辑期状态只存在于会话对象；**不写 document / 不触发 history / 不触发 `onChange` / 不进入空间索引**。仅 `commitTextEditSession` 成功返回的新 document 构成持久增量。
- **draft/composition 期间不写 document**：`updateTextEditDraft`、`startTextEditComposition`、`endTextEditComposition`、`requestTextEditCommit` 均只返回新 session，不产生 document 写入；composition 期间的提交被挂起，`commitTextEditSession` 在 `!commitRequested` 时返回 `commit-not-requested`、在 `isComposing` 时返回 `composition-active`，二者都不写 document。
- **提交幂等**：成功或空草稿提交都会把 session 终结为 `committed`，重复提交返回 `session-finalized`，故**同一 session 至多一次 document 写入**。**cancel 不触碰 document**，已结束会话保持幂等。
- **既有目标三元组匹配**：`ExistingTextEditTarget` 用 `index + expectedStrokeId + expectedTool` 定位；任一不匹配返回 `stale-target` 并**严格保留 document 引用**，避免重复 ID 误命中。
- **真实 Web E2E（`tests/ui/resource-editing-fixture.spec.ts`，2/2 通过）**：
  - 用例一：A→B→C 相邻会话各一次提交，每次 commit/history 精确 +1、多次 draft 期间计数不增长；**两次 undo 依次精确恢复 B、再恢复 A**（以精确文本 aria-label 断言，不以长度替代相等）。
  - 用例二：会话 draft 后 cancel，document/计数不变；**cancel 不新增撤销单元**——仅一次 undo 即精确回到初始 A。
- **证据边界**：该 Web E2E 只覆盖与平台无关的提交/撤销语义，**不验证原生 IME**，不构成 8.1/8.2 证据。

## 8.4 实现与证据（图片资源稳定标识与旧 `src` 兼容）

- **类型边界**：`ImageStrokeV2.resourceId?: string` 为**可选持久引用**；`src` 始终必填并作为回退。空 `resourceId` 保持旧 src-only 形态。
- **迁移/读取/legacy shim（`core/document` + `model/strokeMigration`）**：迁移**显式保留**非空 `resourceId`（`typeof === 'string' && length > 0`），旧 `src-only` 文档可读语义不变；未知/空字段容忍，不丢字段。`stroke-helpers` 单测覆盖「保留非空 resourceId 并保持旧 src-only 图片有效」。
- **registry 语义（`core/resourceRegistry`）**：纯数据结构，`create`/`register`/`resolve`/`remove`，**无 I/O、无 ID 生成、无 platform、无 Skia**。
  - `resolveImageResource`：**`resourceId` 命中优先**，缺失或未命中时**按登记顺序精确匹配 `src` 并返回第一条**。
  - `registerImageResource`：完全相同的资源幂等；**同 ID 异数据保留既有记录并返回 `resource-id-collision`**，不隐式覆盖、不隐式生成 ID。
  - `removeImageResource`：删除指定 ID；不存在时保留原 registry 引用。
- **Skia 同步 resolveImage 链贯通**：`skia/descriptors.ts` 的 `resolveReadyImage` 以 `resolveImage(reference) ?? getImage(reference.src) ?? null` 顺序同步解析；`describeSkiaDocument` 与 prepared-frame 入口 `describeSkiaFrameEntries` 均传入同一 `resolveImage`，`SkiaDrawingCanvas` 只同步消费 ready 资源，不加载/不重试。单测断言：document 路径按 `{resourceId, src}` 调用 `resolveImage`；frame 路径同样调用 `resolveImage`，且 **frame 只读 fragment/resourceBox，不读 raw/canonical entry.geometry**；`resolveImage` 未命中时回退 legacy `getImage(src)`。
- **fixture**：`/resource-editing-fixture` 的 Web importer 演示 app shell 侧 `FileReader/Image → resourceId → registry → SkImage` 的同步 resolver（resourceId 优先、src 兜底）；**仅隔离 fixture 证据，不代表 8.5 完成**。

## 全量验证命令与结果

| 命令 | 结果 |
| --- | --- |
| target Jest（`SkiaDrawingCanvas` + `stroke-helpers` + `textEditSession` + `resourceRegistry` + `document` + `frameClipping`） | **6 suites / 105 tests passed** |
| resource fixture Playwright `tests/ui/resource-editing-fixture.spec.ts` | **2/2 tests passed** |
| 全量 `pnpm test` | **49 suites / 885 tests passed** |
| `pnpm typecheck` | **通过（exit 0）** |
| `pnpm lint` | **0 error / 8 known warnings** |
| `pnpm build` | **通过（painting-board Bob exports 既有 warning）** |
| `git diff --check` | **通过（exit 0）** |
| 真实 Web E2E（CanvasKit） | 同源 `canvaskit.wasm` **200 `application/wasm`**、真实 glyph/像素；**不构成 native 运行证据** |

- `pnpm lint` 的 8 个 warning 为既有非阻断项（测试 `jest/expect-expect` 与 `DrawingSurface` ref cleanup `react-hooks/exhaustive-deps`），与本阶段变更无关。

## 已知非阻断项（如实记录）

- **fixture UUID fallback 仅存在于隔离 fixture**：`ResourceEditingSurface` 的 `crypto.randomUUID` 安全回退只在该 Web fixture 内用于生成演示 resourceId；**core registry 不做 ID 生成**，不影响 8.4 契约。
- **unchanged 「Done」可后续优化**：编辑内容未变化时仍允许提交的交互（Done 按钮状态）可在后续优化；当前不阻断撤销单元语义。
- **Web importer 不代表 8.5 完成**：隔离 fixture 的浏览器图片导入只是 Web 路径演示，**8.5 仍欠 native picker/媒体权限运行证据，保持未勾选**。

## 准确边界（禁止扩张声明）

- **不表示阶段 8 完成**：仅 8.3、8.4 在 Gate 8 attempt 2/3 APPROVE 下关闭。
- **不表示原生文本编辑/IME**：8.1（临时编辑层提交后绘制面渲染）、8.2（CJK 输入法组合输入、多行与 emoji）仍需真实 iOS/Android 运行证据，Web E2E 不可替代。
- **不表示原生资源导入/权限**：8.5 的资源导入 shell 流程与权限由后续 native 验证负责。
- **不表示默认路由变更**：7.4 仍开放；本次未触及默认画布切换、retry、legacy 删除。

## 任务状态与开放项（精确）

- **已关闭**：8.3、8.4（本报告）。
- **8.1 保持未勾选**：欠真实 iOS/Android 临时编辑层与绘制面渲染证据。
- **8.2 保持未勾选**：欠真实 iOS/Android CJK IME 组合输入、多行与 emoji 运行证据。
- **8.5 保持未勾选**：欠 native picker/媒体权限运行证据。
- **1.4 / 4.2** 真实设备债务不变（Linux 无模拟器/真机）。
- **6.3** 高级裁剪/native 债务不变。
- **7.4** 默认 Skia 切换延后，保持未勾选。
- 任务文字含义未被改写，仅新增勾选与证据链接。

## 后续边界

- 阶段 8 **整体不闭合**：8.1、8.2、8.5 仍开放，阶段 8 不能标 closed。
- 下一步**仅可进入阶段 9 勘查**，或继续记录/处理既有的原生运行债务（1.4、4.2、6.3、7.4 及 8.1/8.2/8.5）。
- 所有既有 1.4 / 4.2 / 6.3 / 7.4 债务保持。
