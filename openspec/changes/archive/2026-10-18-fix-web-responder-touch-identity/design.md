# Design

## Context

见 proposal.md 与 evidence/README.md。基线为 main `8a702a9`，锁定 RN Web 0.21.2，Expo 57。CDP trusted TouchEvent 已复现相同左下角 toast；不是仅 dispatchEvent 构造的异常事件。

发射点为 `react-native-web/src/modules/useResponderEvents/ResponderTouchHistoryStore.js:209` 的 `ResponderTouchHistoryStore.recordTouchTrack`。`createResponderEvent.js:52` 的 `normalizeIdentifier` 对 >20 的标识取 `%20`，负值原样返回。前者让 1/21、21/41 写入同一 touchBank 项；任一结束会将另一指记录也标成 inactive。后者将记录存成数组的负属性，结束一指时 `for (i=0; i<touchBank.length; i++)` 找不到仍活跃的负属性。二者在 touches.length 回到 1 时触发检查失败。

运行栈为 document eventListener → recordTouchTrack → Expo console.error / consoleErrorMiddleware → 被覆写的 console 捕获器。Metro 终端解析栈进一步定位实际加载的是 `react-native-web/dist/modules/useResponderEvents/ResponderTouchHistoryStore.js:161:21`，调用方为同目录 `ResponderSystem.js:249:32`；展示中间层为 `@expo/log-box/src/LogBox.ts:101:23` 与 `:33:25`，HMR 层为 `expo/src/async-require/setupHMR.ts:22:48`。截图证实 Expo 开发提示是宿主。应用 InputDeviceDiagnostics 仅监听 window.error/rejection 并显示 window.error: none；不是这条 console.error 的发射点。Web 层已退役 Skia，浏览器只交付输入事件。仓库中仅 native-adapter 冒烟页使用 Pressable，layered-editor 未使用旧 Touchable；不能套用旧 Touchable 多指按下不变量解释。

## Goals / Non-Goals

**Goals:** 修复依赖 responder 身份归一化，让 touch history 与其 TouchHistoryMath 消费者保持数组索引契约；保持真实 DOM PointerEvent 的身份和业务归属。

**Non-Goals:** 不重写 HAM-44 仲裁器，不禁用多指，不屏蔽 console.error/LogBox，不改全局原始事件或原生 RN renderer，不承诺新增双指同时画两笔功能。

## Decisions

### 使用可重装的 RN Web 依赖补丁

通过 pnpm patch / patch-commit 将 RN Web 0.21.2 补丁及配置、锁文件交给仓库，覆盖 Metro 实际加载的模块和包内对应 dist / CJS 入口。不能仅修改 node_modules 或仅修改未被加载的源码。

修复 `createResponderEvent` 的标识分配：为原始 touch identifier 建立生命周期内稳定、并发无碰撞的非负紧凑槽位映射；预留鼠标仿真所用槽位，避免笔生成的兼容鼠标事件与触摸共享记录。一个事件中顶层 identifier、changedTouches、touches 使用同一映射。为该事件的全部触点完成归一化后再释放真正结束/取消的触点映射，存活触点保持槽位；不在 move 中重分配。清理顺序必须让当次历史消费仍可读取结束触点，下一轮安全复用，空闲后空间有界。

保留 touchBank 数组：`TouchHistoryMath/index.js` 同样按数组长度扫描，直接换 Map 或去掉取模并用原始大整数/负数做数组键均不完整。内部编号不必与 DOM 原始编号相等，不对业务 pointerId 做 abs、截断或重新编号。

应用侧替代方案不合适：拦截 DOM 区域的 TouchEvent 冒泡会使全局 responder 看见不完整生命周期，且 touches 是全局列表；归一化应用 pointerId 也修不到独立的 TouchEvent.identifier。故落点为依赖层。直接升级尚无已验证的修复版本，不能凭版本新就宣称解决；未来升级须以本次复现矩阵通过为依据再移除补丁。

### 回归验证同时检查错误与业务结果

将证据脚本中的时序转为 Playwright 用例，保留 pre-navigation console 栈捕获和 trusted 校验，在未补丁基线确实失败后验证补丁成功。诊断开关各测；三档分别使用独立编辑器会话，防止 auto 的 pen latch 污染初始行为。包含大值、负值、同余值、两种抬指顺序、同时/错峰落指、三指、cancel、笔指混合与控件 down-time 归属。

补丁级测试检查映射唯一性、结束/取消复用、mouse/pen 兼容事件隔离、TouchHistoryMath 读取与反复循环后的空间界限。浏览器测试检查视口、对象、undo、预览与控制台，不以“没有 toast”单独判通过。

## Risks / Trade-offs

- 依赖补丁维护成本 → 锁定版本、校验补丁能在 frozen install 后生效，升级不得静默丢失补丁。
- 释放过早使同事件 touches/changedTouches 不一致 → 完成整次归一化后释放，并测试乱序抬指、cancel 和槽位复用。
- 只修报错而仍破坏手势 → 同时检查历史数学消费者与 HAM-44 业务结果，不删除检查或过滤日志。
- CDP 模拟 iPad UA 不是 iPad Safari/WebView → 真机验收保留为未完成事项；现有证据只证明依赖缺陷与匹配 UI，未证明用户原现场的具体 identifier。

## Migration Plan

apply 阶段先固定失败回归，再交付补丁，执行定向验证与现有输入测试，最后 frozen install、构建和 iPad 复验。文档无迁移。回退时一并回退补丁注册、补丁与锁文件；保留 HAM-44，明确旧警告可能恢复。

## Open Questions

iPad 原现场属于同余冲突还是负 touch identifier，需真机记录确认；两种已复现缺陷均在本方案内，不影响修复范围。
