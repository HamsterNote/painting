# Tasks

## 1. 基线与证据约定

- [x] 1.1 在 `9834cec` 或含 HAM-50 补丁的 main 上准备实现分支，记录提交和未改动的补丁文件；用 `git diff -- patches/ package.json pnpm-lock.yaml` 验证本 change 未修改它们，使用 frozen install 验证诊断/测试环境包含补丁。
- [x] 1.2 在本 change 下建立验收记录，明确区分用户报告、静态事实、DOM 合成输入、CDP trusted 和 iPad 真机；记录所测提交、设备/引擎、isTrusted（采到时）与实际断言，核验未经执行的项目均标为待验收，不把 dblclick 候选链路写成已证根因。

## 2. 局部防护与编辑例外

- [x] 2.1 在 DrawingSurface 非编辑区域增加标准/WebKit 禁选与 touch callout 样式，保留 touchAction；按 foreignObject 需要覆盖 DisplayLayer 显示态文字，并在 TextEditor 的 textarea/文本输入区域恢复原生选择和菜单。用 `tests/ui/interaction-feedback.spec.ts` 新增场景验证计算样式、消费者 style 合并、显示文字与输入框边界、画布外选词及控件焦点。
- [x] 2.2 用浏览器默认输入核验样式是否足够；仅在样式未覆盖的可复现路径上，在 semanticWebAdapter 增加局部可取消 dblclick/selectstart 防护，跳过安全控件并继续多边形完成逻辑。通过 `layered-semantic-adapter.test.ts` 或相应浏览器用例验证业务双击、不可取消事件、编辑例外及卸载清理；若样式足够，记录不新增事件拦截的实测依据。禁止全局清选区或修改未被调用的 interactionOwnership helper 来宣称修复。

## 3. 自动化与兼容性验证

- [x] 3.1 在已被两份 Playwright 配置收集的 `tests/ui/interaction-feedback.spec.ts` 扩展空白/含文字画布的快速连续笔输入回归，验证对象与历史一笔一次、撤销重做、不误开编辑器；同时覆盖原生文字选择替换、完成/取消、组合输入会话与返回绘制，注明合成 IME/笔事件不等于真机行为。
- [x] 3.2 执行 `pnpm exec playwright test tests/ui/interaction-feedback.spec.ts tests/ui/mobile-input-mode.spec.ts tests/ui/layered-editor.spec.ts --project=chromium --workers=1`，再使用 `--config=playwright.webkit.config.ts --project=webkit` 执行相同文件；保存报告，核验画布外选择、多边形闭合和三档输入/笔指混合回归。WebKit 桌面或 iPad UA 不作为真机验收通过。
- [x] 3.3 执行 `pnpm typecheck`、`pnpm lint`、`pnpm test` 和 `pnpm build:all`，记录实际结果；使用 `openspec validate fix-ipad-pencil-text-selection --strict --no-interactive` 验证产物，检查 diff 没有 HAM-50 文件或无关代码修改。

## 4. iPad Safari + 实体笔真机验收（必过）

- [ ] 4.1 开发及自动化完成后交付可访问的补丁基线与候选版本，记录各自提交、iPad/笔型号、iPadOS/Safari 版本、入口、模式和操作步骤。先在未应用本 change 的补丁基线上按用户操作复验；若真机验收不复现，本 change 直接关闭，不做多余改动，不将候选版本无现象当成修复成功，不进入修复交付。若已有候选代码，关闭时不交付该候选改动；保留不复现记录。
- [x] 4.2 基线确认复现后，用同一 iPad Safari + 实体笔对比候选版本：普通 `/layered-editor` 与 `?diagnostics=1&traceGestures=1` 入口、空白与含文字画布、自动/强制笔/强制手指模式；每组建议至少 20 轮快速短笔/长笔与相邻落抬笔，并确认自动见笔前后状态。记录选区/菜单与笔迹/undo 结果；可用临时 Safari Inspector 记录实际 pointer、dblclick、selectstart/selectionchange 时序，注明来自实体笔而非 CDP。只有基线复现且候选消除、每笔一次事务时通过；候选仍复现则修订方案，不勾选完成。轮数为提案建议，不是用户已确认要求。
- [ ] 4.3 同设备验证文字编辑器原生选词/菜单、复制粘贴、中文 IME、完成/取消后继续写字，业务对象选择移动、多边形双击闭合、双指导航与笔指混合均保持原行为，并验证画布外文字仍可选。保存真机结果与可分享录屏/截图；任一回归或缺少真机证据均不得声明修复验收通过。

## 收口依据（2026-10-18）

修勾 2026-10-18 文字确认验证通过（评论 `01a14f29-e771-789d-ac8c-bf2f41191246`，原文「验证通过」），小助手随后明确按 iPad 真机验收通过归档、推送、提 PR。4.2 按此用户确认勾选；该确认不是逐场景测试日志，不据此声称已取得各档位、轮数或事件时序记录。

4.1 的服务、提交与入口已交付，但未收到 iPad/笔型号和 iPadOS/Safari 版本，记录要求未全满足，保持未勾。4.3 的功能验收接受同一文字确认，但未附任何真机截图/录屏，影像保存要求未满足，保持未勾。归档按本轮明确授权继续，缺失资料不编造、不代填，也不把桌面截图当真机证据。
