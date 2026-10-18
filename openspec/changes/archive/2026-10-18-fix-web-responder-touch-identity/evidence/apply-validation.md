# HAM-50 Apply 验证与补丁维护

基线：main `8a702a9`，工作分支 `agent/agent/c282011b35fe`。完整提案与原始 evidence 来自任务附件，保留在本 change 中。以下为 apply 时的自动化记录；2026-10-18 修勾已在 iPad 浏览器复验通过，服务 SHA `9834cec`，验收依据与 WebView 条件不适用说明见 `device-acceptance.md`，随后按指令归档。

## 失败回归

先在未补丁依赖上执行 CDP trusted 回归，再修改 pnpm patch 暂存目录。为核验抬指的准确身份，额外建立 detached `8a702a9` 工作树，安装其原始 frozen lockfile，并拷入正式测试文件执行：

```sh
pnpm install --frozen-lockfile
pnpm exec playwright test tests/ui/web-responder-touch-identity.spec.ts --project=chromium --workers=1 --grep 'identity regression: auto|identity ownership|unrelated' --reporter=json
```

结果：6 passed，6 failed；六个失败全部位于目标控制台错误断言。每次仅结束指定触点后，测试还核验 DOM `touchend.touches` 的原始编号，避免 CDP 发错抬指事件。`touchEnd` 的非空列表在当前 Chromium 表示结束的触点，因此辅助函数从当前触点减去预期存活触点计算发送列表；完整结束和取消发送空列表。所有触摸输入来自 CDP，`isTrusted=true`，没有使用 `dispatchEvent` 冒充真实浏览器输入。

| 标识 | diagnostics=false 目标错误数 | diagnostics=true 目标错误数 |
| --- | --- | --- |
| 1/2 | 0，通过 | 0，通过 |
| 1/21 | 4，预期失败 | 4，预期失败 |
| 21/41 | 4，预期失败 | 4，预期失败 |
| -1/-2 | 2，预期失败 | 2，预期失败 |

三档控件归属对照与无关 console.error 的 LogBox 展示均通过。`before-regression.json` 保存全部原始事件、warn/error 参数、调用栈和状态；`before-regression.png` 保存普通入口的实际错误提示。提案 probe 的原始证据另行保留，不与正式测试的轮数混算。

## 补丁交付

使用 `pnpm patch react-native-web@0.21.2` / `pnpm patch-commit` 生成 `patches/react-native-web@0.21.2.patch`，并注册 `package.json` 的 `pnpm.patchedDependencies` 和锁文件。补丁同步覆盖：

- Metro 实际消费的 `dist/modules/useResponderEvents/createResponderEvent.js`。
- CommonJS 的 `dist/cjs/modules/useResponderEvents/createResponderEvent.js`。
- 上游 Flow 源码 `src/modules/useResponderEvents/createResponderEvent.js`。

每个 history store 使用 WeakMap 保存独立的原始标识到槽位的映射；触摸槽位从 1 分配，0 留给鼠标仿真。所有列表归一化后再释放结束/取消触点，保留当次 history 消费所需的数字槽位。空间随最大并发触点数增长，不随累计手势轮数增长。未修改 ResponderTouchHistoryStore、ResponderSystem 或 TouchHistoryMath 的检查与日志，也未改应用业务代码、LogBox、诊断开关、production 模式、packageManager 或原有 overrides。

```sh
pnpm install --frozen-lockfile
pnpm install --frozen-lockfile --force
pnpm test:responder
```

以上均通过。强制重装后直接测试安装包的 src / ESM dist / CJS dist，9 项通过。测试使用真实 ResponderTouchHistoryStore 和 TouchHistoryMath；每个入口做 5000 轮，覆盖负数、大整数、同余值、0、正反抬指、鼠标槽位隔离、store 隔离、取消回收、存活触点不改号，以及映射清空和 touchBank 长度上界。VM 仅测量 Map，不覆写控制台或依赖错误检查。

## 自动化验收

正式浏览器套件在开发模式运行，覆盖三个独立模式会话、两个入口、四组标识、正反抬指、同时/错峰落指、第三指与取消；业务断言包括视口、对象数、undo/redo、六种工具预览、控件 down-time 归属、笔触冻结与排空恢复。另有 50 轮 trusted 连续手势。负 pointerId 与自动笔锁定等由 HAM-44 的既有套件共同验证，原测试保留。

证据边界：CDP 注入的负值是 TouchEvent.identifier，Chromium 自行分配的 PointerEvent.pointerId 仍为正。负 pointerId 的业务回归由 HAM-44 既有适配器合成输入及单元测试验证，不冒充 trusted 负 pointerId 或 iPad 实测。

实际执行：

```sh
pnpm exec playwright test tests/ui/web-responder-touch-identity.spec.ts tests/ui/mobile-input-mode.spec.ts tests/ui/mobile-input-mode-real-input.spec.ts tests/ui/touch-drawing-arbitration.spec.ts --project=chromium --workers=2 --reporter=list,json
pnpm typecheck
pnpm lint
pnpm test
pnpm build:all
openspec validate fix-web-responder-touch-identity --strict --no-interactive
```

结果：

| 检查 | 实测结果 |
| --- | --- |
| Playwright Chromium | 95/95 通过，4.9 分钟；新增 44 项，HAM-44 原三文件 51 项；新增会话目标警告 0 |
| typecheck | 退出码 0，三个 workspace 检查通过 |
| lint | 退出码 0，0 errors、32 条既有 jest/expect-expect warnings |
| test | 87/87 Jest suites、1155/1155 tests 通过，随后依赖测试 9/9 通过 |
| build:all | 库的 ESM/CJS/类型声明及 Expo Web 导出均通过 |
| OpenSpec strict | 通过 |

Jest 首轮有一次既有原生冒烟测试首次挂载超过 5000 ms（1154 通过、1 超时）；未修改测试、配置或超时，完整复跑全部通过，耗时 19.218 秒。保留该结果差异，不把首轮描述为全绿。

`after-regression.json` 保存 95 项结果、44 个新增会话的原始事件与日志，以及 HAM-44 trusted 输入测试的原 trace。`after-regression.png` 是与修复前对应的普通入口截图；`after-unrelated-error.png` 证明无关 `console.error('HAM50 unrelated error')` 仍展示为 Expo LogBox。所有取证包装均继续调用原始 console。

`build-verification.json` 保存实际导出 bundle 的文件名、SHA-256 和归一化/回收模块片段，确认 frozen 重装后修复仍进入产物：`entry-2718230c4ff9847a116df0a2846bc20a.js`，SHA-256 `d1a9a6148da7403d2e3b11575ac3288feba00db7235dc7b28b370d78f74857c0`。浏览器自动化使用开发构建验证真实错误通道；静态导出只用于构建产物核验，未以 production 模式通过提示验收。

Playwright 管理的临时服务已随测试退出，5266 无监听。上述 apply 轮没有启动常驻服务、创建 PR 或归档 change；后续收口状态见 `device-acceptance.md`。

## 真机交接与移除条件

由小助手组织修勾执行 `README.md` 的四条路径：单指、双指缩放/平移、双指绘制尝试、笔指混合。普通 `/layered-editor` 和 `?diagnostics=1&traceGestures=1` 各 20 轮，交替抬指顺序，并包含第三指、控件/尺子起笔与排空后新输入。记录 iPadOS、浏览器或 Expo 宿主/WebView 版本、三档模式、截图和诊断导出。区分 TouchEvent.identifier 与 PointerEvent.pointerId；Chromium iPad UA 不是 iPad 真机通过的证据。

升级 RN Web 时先在候选版本移除补丁运行相同模块测试和 CDP 回归，再执行 frozen install、构建及上述真机路径。只有唯一性、稳定性、释放顺序、空间界限和开发错误展示全部满足，才同时移除补丁文件、patchedDependencies 与锁文件注册。不能因不再看到 toast 就移除补丁。原生 RN 输入不在本补丁范围内。
