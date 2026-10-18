# Tasks

下列命令均在仓库根运行，属于后续 apply 的验收计划，本次 propose 不执行。新增测试文件及 `-g` 用例名是交付约定，当前基线尚不存在；不得使用 passWithNoTests 或跳过缺失用例。Jest 使用现有 projects，Playwright 使用现有 chromium 配置并自动管理所需服务，测试进程退出即完成，不要求手动常驻 Dev Server。

## 1. 编辑器模式与偏好初始化

- [x] 1.1 给分层 controller 增加独立 input 快照、三档 setter、penSeen 和派生 touch 策略；会话定义为 controller 实例，不写文档/undo；新建 `packages/painting/src/__tests__/core/layered-input-mode.test.ts` 验证默认值、强制覆盖、切回 auto 保留 latch、工具切换不重置、controller 重建重置。验收：`pnpm exec jest --runInBand --selectProjects core-node --runTestsByPath packages/painting/src/__tests__/core/layered-input-mode.test.ts`。
  - 实跑上述验收命令：PASS，1 suite / 2 tests（2026-10-18）。
- [x] 1.2 新增 Web `inputModePreference.ts` 并在 createEditor 初始化同步恢复；覆盖读/解析/写异常、非法值、无浏览器、首帧已恢复及只写用户档位；新增 `packages/painting/src/__tests__/input-mode-preference.test.ts`。验收：`pnpm exec jest --runInBand --selectProjects legacy-web --runTestsByPath packages/painting/src/__tests__/input-mode-preference.test.ts`，断言异常时当前实例仍可切档，penSeen 从不进入存储。
  - 实跑上述验收命令：PASS，1 suite / 6 tests（2026-10-18）。
- [x] 1.3 完成初始 mode > 已存档位 > 旧 inputPolicy 提示 > auto 的优先级与 SSR 交互挂载门；在 `packages/painting/src/__tests__/layered-input-initialization.test.tsx` 验证 Toolbar 和 Surface 首个可交互状态一致、直接 core 宿主的初始化方式、旧提示不持续覆盖菜单。验收：`pnpm exec jest --runInBand --selectProjects legacy-web --runTestsByPath packages/painting/src/__tests__/layered-input-initialization.test.tsx`。
  - 实跑上述验收命令：PASS，1 suite / 6 tests。SSR 测试使用 node renderer，Canvas 呈现单独 mock；输入初始化与 adapters 为真实实现。

## 2. 纯仲裁和有序路由

- [x] 2.1 新建窄 `core/layeredInputArbitration.ts`，复用归属和 viewport 变换基础，不接旧 session 的 document-commit；在 `packages/painting/src/__tests__/core/layered-input-arbitration.test.ts` 覆盖三档 policy、single-tool 转 pair、先 cancel 确认后导航、取消失败不导航。验收：`pnpm exec jest --runInBand --selectProjects core-node --runTestsByPath packages/painting/src/__tests__/core/layered-input-arbitration.test.ts`。
  - 实跑上述验收命令：PASS，1 suite / 5 tests。
- [x] 2.2 在同一 reducer 测试文件补齐 pen 首次 down、touch 转 pen、笔书写掌触、导航期间 pen 不抢占、固定 pair/第三指/残留触点排空及控件和其他 owner 不混入；用事件序列断言 route/cancel/begin-navigation 顺序和迟到 up 无提交。验收：`pnpm exec jest --runInBand --selectProjects core-node --runTestsByPath packages/painting/src/__tests__/core/layered-input-arbitration.test.ts`。
  - 实跑上述验收命令：PASS，1 suite / 10 tests。
- [x] 2.3 新增 `input/web/layeredInputArbiter.ts` 作为分层唯一 DOM 仲裁入口，处理 down 与 window capture move/up/cancel、失焦/后台/销毁、模式切换；新增 `packages/painting/src/input/web/__tests__/layeredInputArbiter.test.ts` 验证同事件只路由一次、来源有效性、控制区排除、模式切换取消后下一次新 down 生效。验收：`pnpm exec jest --runInBand --selectProjects legacy-web --runTestsByPath packages/painting/src/input/web/__tests__/layeredInputArbiter.test.ts`。
  - 实跑上述验收命令：PASS，1 suite / 8 tests。

## 3. 三个 adapter、工具栏与示例接入

- [ ] 3.1 调整 freehand adapter 支持组合路径派发与显式取消，移除该路径的竞争监听；保留独立静态 policy、coalesced、快速 up、capture、pending commit 语义。在现有 adapter 测试补取消后迟到 up 和首 pen down 不丢。验收：`pnpm exec jest --runInBand --selectProjects legacy-web --runTestsByPath packages/painting/src/input/web/__tests__/freehandWebAdapter.test.ts packages/painting/src/input/web/__tests__/layeredInputArbiter.test.ts`。
- [ ] 3.2 接入 semantic/navigation adapter 和 Surface：统一来源准入，移除 touchDraw 全禁导航分支，支持取消未提交语义事务后以当前双指/viewport 建基线；默认纸面双指不因 virtual paper 可视开关关闭。在现有测试补形状/套索/擦除/选择事务取消、鼠标和笔写时冻结、固定 pair 与导航边界。验收：`pnpm exec jest --runInBand --selectProjects legacy-web --runTestsByPath packages/painting/src/__tests__/layered-semantic-adapter.test.ts packages/painting/src/__tests__/layered-navigation.test.ts packages/painting/src/__tests__/layered-canvas.test.tsx`。
- [ ] 3.3 Toolbar 在所有工具下显示可访问“输入模式”三档 select，连接 controller 和偏好写入；更新公开入口、PaintingBoard、示例及 touchDraw 兼容初始化，保留窄屏换行；在现有 toolbar/public-entry 测试验证选项、默认/恢复值和不新增 undo。验收：`pnpm exec jest --runInBand --selectProjects legacy-web --runTestsByPath packages/painting/src/__tests__/layered-toolbar.test.tsx packages/painting/src/__tests__/layered-public-entry.test.tsx` 及 `pnpm run typecheck`。

## 4. 真实分层入口的自动化回归

- [ ] 4.1 新增 `tests/ui/mobile-input-mode.spec.ts` 用例名含 `auto-default-touch`：隔离存储，不传 touchDraw，断言菜单默认自动、单指预览与最终笔迹可见、对象增一、undo/redo 一次一笔、viewport 不动。验收：`pnpm run test:ui -- tests/ui/mobile-input-mode.spec.ts --project=chromium -g auto-default-touch`。
- [ ] 4.2 同文件新增 `second-finger-cancels`：自动初始和强制手指两档分别单指移动到已有预览，再落第二指并改变中点和间距；断言无提交对象、无新增 undo、预览清除且 viewport 平移/缩放，迟到 up 不补笔迹。验收：`pnpm run test:ui -- tests/ui/mobile-input-mode.spec.ts --project=chromium -g second-finger-cancels`。
- [ ] 4.3 同文件新增 `auto-pen-latch`：首有效 pen down 所在笔正常提交，之后单指只拖动；虚拟时间推进、blur/返回和换工具不重置；重开新 controller/reload 后自动档再次允许单指画；hover/控制区 pen 不触发检测。验收：`pnpm run test:ui -- tests/ui/mobile-input-mode.spec.ts --project=chromium -g auto-pen-latch`。
- [ ] 4.4 同文件新增 `forced-finger-override`：从已经 latch 的 auto 切 finger，下一次新单指立即画；finger 中完成 pen 后下一次 touch 仍画，切回 auto 使用原 latch；模式切换中残留 pointer 不复活。验收：`pnpm run test:ui -- tests/ui/mobile-input-mode.spec.ts --project=chromium -g forced-finger-override`。
- [ ] 4.5 同文件新增 `forced-pen`：无笔检测也能单指拖动且无文档/undo 变更，笔正常画，空闲时双指可导航；实际 pen 写时两 touch 被抑制，笔结束不重放，全部抬起后新双指再导航。验收：`pnpm run test:ui -- tests/ui/mobile-input-mode.spec.ts --project=chromium -g forced-pen`。
- [ ] 4.6 同文件新增 `storage-unavailable`：通过浏览器 init script 在应用初始化前分别令 Storage 读/写抛异常，监听 pageerror；无合法偏好时默认 auto，菜单改 finger 后本会话仍可画，无未捕获异常、不要求 reload 记住失败写入。验收：`pnpm run test:ui -- tests/ui/mobile-input-mode.spec.ts --project=chromium -g storage-unavailable`；同步执行任务 1.2 的 Jest 命令覆盖解析异常。
- [ ] 4.7 同文件新增 `preference-first-frame`：页面初始化前预置 pen 档，监测首个可交互 Surface 即为 pen，第一次 touch 只导航；保存 finger 后 reload 恢复；自动检测不写入存储，非法枚举回 auto。验收：`pnpm run test:ui -- tests/ui/mobile-input-mode.spec.ts --project=chromium -g preference-first-frame`。
- [ ] 4.8 同文件新增 `adapter-matrix`：参数化三档的鼠标绘制/pan、双指导航、固定 pair/第三指、touch 语义工具取消、pen 抢占 touch 与 pen 不抢已有 pair、控件和尺子不计入纸面 pair；同时更新 `touch-drawing-arbitration.spec.ts` 的过时默认和第二指断言，保留取消/失焦覆盖。验收：`pnpm run test:ui -- tests/ui/mobile-input-mode.spec.ts tests/ui/touch-drawing-arbitration.spec.ts --project=chromium`。

## 5. 集成校验与交接

- [ ] 5.1 回归快速 pen、压力/取消/捕获与尺子等既有行为，完整执行 `pnpm run test`、`pnpm run typecheck`、`pnpm run lint`，并执行 `pnpm run test:ui -- tests/ui/layered-editor.spec.ts tests/ui/editor-candidate-canvas2d-pen.spec.ts tests/ui/touch-ruler-feedback.spec.ts tests/ui/mobile-input-mode.spec.ts tests/ui/touch-drawing-arbitration.spec.ts --project=chromium`；任何失败定位并修正，不删断言绕过。
- [ ] 5.2 在项目文档记录三档、会话 latch、初始化优先级、旧 inputPolicy 兼容语义和本机存储降级；记录上述实际命令结果及未做真机验证的限制。验收：交付记录可逐条对应本 change 的 5 条 requirement，`openspec validate mobile-input-mode-switch --strict --no-interactive` 通过；不在 apply 提前同步主 specs 或归档。
