# Tasks

## 1. 固定失败回归

- [x] 1.1 在 `tests/ui` 将 evidence/probe.mjs 的 CDP 时序转为定向回归，导航前捕获 warn/error 栈；验证未补丁 `8a702a9` 下 1/21、21/41、-1/-2 在两指退回一指时失败，普通 1/2 对照通过，且输入为 trusted。
- [x] 1.2 为三档建立独立会话，覆盖诊断开关、两种抬指顺序、同时/错峰落指、第三指与取消；断言无伪警告以及正确 viewport、对象、undo、预览结果，证明确有业务断言而非仅检测 toast。

## 2. 修复依赖身份映射

- [x] 2.1 用 pnpm 补丁修复 RN Web 0.21.2 的 createResponderEvent 身份分配，保持紧凑非负槽位、并发唯一、同事件各 touches 列表一致及 mouse 仿真槽位隔离；用补丁级测试验证负/大/同余标识、单指存活与 TouchHistoryMath 数组读取。
- [x] 2.2 实现结束/取消后的映射回收与安全槽位复用；连续至少 50 轮和长循环测试证明无身份串扰、存活触点不改号且映射与 touchBank 空间有界，不删检查或过滤日志。
- [x] 2.3 注册补丁及锁文件，覆盖 Metro 与 dist/CJS 实际消费入口；`pnpm install --frozen-lockfile` 后复跑失败用例全部通过，构建产物仍含修复，注入无关 console.error 时开发错误通道仍正常显示。

## 3. HAM-44 集成回归

- [x] 3.1 运行 `pnpm exec playwright test tests/ui/mobile-input-mode.spec.ts tests/ui/mobile-input-mode-real-input.spec.ts tests/ui/touch-drawing-arbitration.spec.ts --project=chromium` 及新增定向用例；三档、自动笔锁定、负 pointerId、down-time 控件归属、固定 pair、笔触冻结均通过；保留 before/after 栈、事件与截图。
- [x] 3.2 运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build:all`，记录结果；确认改动仅补丁、注册/锁文件与必要回归，没有回退 HAM-44 输入行为。

## 4. iPad 复验与交接

- [ ] 4.1 修勾在 iPad Safari 的 `/layered-editor` 与 `/layered-editor?diagnostics=1&traceGestures=1` 按 evidence/README.md 四条路径复验，各重复 20 轮，包含正反抬指顺序；记录系统/浏览器版本、模式、截图和诊断导出，所有路径无目标提示，绘制、导航与历史符合预期。
- [ ] 4.2 如原现场是 Expo 宿主/WebView，在同宿主重复上述路径；记录原始 touch identifier 与 pointerId 的区别，明确真机已验证或仍待验，不以 Chromium iPad UA 冒充真机通过。
- [x] 4.3 整理补丁维护/升级移除条件、before/after 证据和自动化/真机结果，执行 `openspec validate fix-web-responder-touch-identity --strict --no-interactive` 通过后提交验收；未完成真机项保持未勾选。
