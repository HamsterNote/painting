# HAM-50 取证与验收

Apply 的修复、正式前后回归、命令结果及补丁维护条件见 `apply-validation.md`。本页以下保留 propose 阶段原始取证记录；iPad Safari / Expo WebView 真机复验仍待完成。

## 基线与方法

2026-10-18，main `8a702a9`（HAM-44 / PR #25 已合并），初始工作树干净、无活动 change。项目配置为 spec-driven，仓库未携带独立 opsx-propose 命令或技能副本，因此遵循本环境安装的 openspec-propose 技能与 CLI 返回模板。

`pnpm install --frozen-lockfile`、`pnpm run prepare:playground-artifacts` 成功后，临时启动 Expo Web 5266。Playwright Chromium（1.59.1 安装包）使用 iPad gen 7 的设备参数，通过 CDP `Input.dispatchTouchEvent` 注入浏览器输入；window 捕获的 TouchEvent 与 PointerEvent 均带 trusted，非 DOM dispatchEvent。导航前覆写 warn/error 以保留参数、时间和 Error.stack，不吞日志；同时采集 pageerror。

## 实际结果

| 输入标识 | 诊断 | 捕获事件数 | 目标 console.error 次数 |
| --- | --- | --- | --- |
| 1/2 对照 | 关 | 1127 | 0 |
| 1/2 对照 | 开 | 1127 | 0 |
| 1/21 | 开 | 251 | 21 |
| 21/41 | 开 | 251 | 21 |
| -1/-2 | 开 | 259 | 12 |
| 1/21 | 关 | 251 | 21 |
| 21/41 | 关 | 251 | 21 |
| -1/-2 | 关 | 259 | 12 |

所有组 pageerror 均为空。控制台输出经 Expo 展示为左下角红色 toast，文案与用户报告一致。普通对照并不足以判定已修复；本轮未采用“已被 HAM-44 修复”的结论。

最短触发时序（坐标为实际首轮页面坐标，后续应由 surface bounding box 相对计算）：

1. A touchStart：id=1，(120,199)。
2. A touchMove 至 (150,199)。
3. B touchStart：id=21，(260,209)，A 仍按住。
4. 两指移动：A=(100,199)，B=(310,209)。
5. touchEnd 仅保留 B；该时刻 touches.length=1，RN Web 报错。反向先抬 B 也触发。
6. B 继续移动并结束；替换为 21/41 或 -1/-2 重复。完整脚本另覆盖第三指与取消以及笔指混合。

第一组 1/21 的诊断开栈时间约 994.2ms，document eventListener → ResponderTouchHistoryStore.recordTouchTrack → console.error → consoleErrorMiddleware → console 捕获器。依赖源位置：`react-native-web/src/modules/useResponderEvents/ResponderTouchHistoryStore.js:209`；对应归一化在 `createResponderEvent.js:52`。具体堆栈 URL、原始触点与时间均保留在 JSON。

Metro 终端解析出的实际加载栈为 `react-native-web/dist/modules/useResponderEvents/ResponderTouchHistoryStore.js:161:21` ← `ResponderSystem.js:249:32`，经过 `@expo/log-box/src/LogBox.ts:33:25`、`:101:23` 和 `expo/src/async-require/setupHMR.ts:22:48`。因此补丁必须覆盖 dist，不能只改 src。本轮临时进程已退出，5266 未留下常驻服务。

## 文件与复跑

- `baseline.json`：普通 1/2 的开关诊断对照。
- `identifiers.json`：诊断开启的三组复现与应用 gesture trace。
- `no-diagnostics.json`：普通入口的三组复现，排除诊断面板宿主。
- `toast.png`：普通入口最终左下角实际提示截图。
- `probe.mjs`：只读页面取证辅助脚本，不是应用实现或正式测试。默认复现三组，`--no-diagnostics` 关闭诊断，`--baseline` 改用 1/2 对照并循环五次；输出文件生成在执行命令的目录中。

后续复跑需自行启动临时服务（本轮服务已在取证后停止）：在仓库根执行 `env EXPO_UNSTABLE_HEADLESS=1 EXPO_NO_DEPENDENCY_VALIDATION=0 EXPO_NO_NEW_ARCH_COMPAT_CHECK=0 pnpm dev`，再执行 `node openspec/changes/fix-web-responder-touch-identity/evidence/probe.mjs`；普通入口加 `--no-diagnostics`。复跑后停止服务。

## iPad 验收路径（待 apply 后由修勾复验）

每条在普通入口及诊断入口各做 20 轮，记录 iPadOS、Safari/宿主版本和模式。手工不能指定 identifier，连续多轮有助覆盖设备自然编号；必要时由 Safari Web Inspector 临时采集 touch identifier 与原始 pointerId，不在产品中常驻采集。

1. **单指**：自动未见笔时画一笔，应一笔一 undo；强制手指同样绘制；强制笔下单指仅平移。负 pointerId 保持可用，鼠标逻辑不变。
2. **双指缩放/平移**：三档分别双指开合与同向移动；交替先抬左/右指，残留指继续移动后抬起，再新落一指。viewport 正常，无新增对象或 undo，无跳动、提示或触点卡住；加第三指再抬 pair 一指时第三指不替补。
3. **双指画的尝试**：自动未见笔或强制手指下，第一指先画出预览，第二指落下并移动。按 HAM-44 取消未提交笔并转导航，不同时画两条，不留半笔或 undo；全部抬起后新单指正常绘制。再验证一指起于工具栏/尺子后移入纸面不抢作第二指。
4. **笔+指混合**：笔落下写线，双指落下移动；笔先抬而双指仍留，再排空双指。笔只提交一次，书写中与排空前视口不动、不补执行；新的双指可导航。自动笔检测保持锁定，强制手指覆盖检测，切档不复活旧触点。

最终通过条件：未补丁时自动化复现失败，补丁后同用例目标警告为零且业务断言通过；上述 iPad 路径无目标提示、无输入行为回退。只关闭 toast、改 production 模式或过滤 console 不算修复。

## 证据边界

已证明 RN Web 依赖中的两种身份缺陷能在本项目真实浏览器输入上产生匹配提示，未获得用户 iPad 原现场记录，无法断言其具体编号。UA 模拟不等于 Safari 引擎或真机。取证辅助脚本不含正式断言，不作为 HAM-44 全量回归通过的证据；正式回归及修复均留给 apply。本轮没有修改业务代码、依赖补丁、锁文件或测试代码。
