# iPadOS 输入失效修复记录

日期：2026-10-18。基线 `764324d`，核心修复 `37eab5a`，分支 `feat/mobile-input-mode-switch`。
原 change 保持 19 项已完成 / 0 项未完成；六条冻结行为、spec delta、主 specs 和 archive 未改。

## 真机证据与根因

修勾附件 `01a14d89-23e3-7595-83a7-b985de6b87d1`（`painting-gesture-trace.json`）
来自 iPad 2018 / iPadOS 18.7.5 / Edge 153，HTTP LAN 非 secure context，DPR 2。
用户确认工具栏、白纸和虚拟纸张开关正常；最早的 HAM-44 现象来自鼠标，并非这台 iPad。

附件有 258 条 trace，其中 244 条为指针生命周期：20 down（9 pen / 11 touch）、204 move、20 up，
没有 pointercancel。20 次 down 都命中 surface，且均为负整数 pointerId，例如 pen `-765894345`、
touch `-765894343`。没有任何 freehand 路由/提交记录，最终对象数为 0。

两处身份校验拒绝合法的有符号 DOM pointerId：

1. `input/web/layeredInputArbiter.ts` 的 `pointerId < 0` 拒绝三档中的全部笔、触摸、导航输入。
2. `core/freehandSession.ts` 的 `isPointerId()` 复用非负整数校验，即使通过仲裁仍不能书写。

修复保留整数安全性与原值身份匹配，允许负安全整数；不取绝对值、不重映射 ID。
sequence、batchSequence、viewportRevision、presetRevision、documentRevision 的非负约束保持原样。
审查 semantic/navigation adapter、ownership、窄 reducer、controller 和文本会话后，
未发现其他 pointerId 非负限制；文本会话不持有 pointerId，文档格式无需修改。

初始化门在桌面 WebKit iPad 仿真中实测为 ready，真实触摸 tap 和鼠标笔迹均能提交。
真机 trace 的事件观察器本身也位于 inputReady effect 内，说明事件已经进入该 effect 的监听范围。
本轮没有移除恢复偏好前的首帧输入门，没有改 useSyncExternalStore 或初始化优先级。

## 回归与诊断

- 仲裁器集成单测：真实 freehand/controller/navigation，负 pen、touch 均实际落文档，第二指先取消再改变视口。
- reducer：负数保留 owner，符号不同的 ID 不能冒充 owner，固定双指仅在取消 ACK 后接管。
- session：pen/touch、三种负数（含 signed 32-bit 下界）的 update/end/cancel；拒绝非整数、非有限和不安全整数。
- controller：负 pen/touch 完成 begin/update/end/commit，原始样本和单次 undo/redo 正确。
- `mobile-input-mode.spec.ts`：三档负 ID 的绘制、双指、latch 和语义工具；加入 WebKit testMatch。
- `mobile-input-mode-real-input.spec.ts`：Chromium iPad 仿真，CDP touch 与 pen，断言 trusted down/move/up、实际对象数与视口。
- `input-device-diagnostics.spec.ts`：Chromium/WebKit 的真实 touch tap 和鼠标；诊断能显示命中被阻断、cancel 和错误；无查询参数时不显示。

`?diagnostics=1` 现在直接显示 ready、mode、arbiter、计算后 pointer-events、分来源的
down/move/up/cancel 计数、最近事件和 down 的 ID/button/pressure/time/trusted/hit、window error/rejection。
观察器在 window 捕获阶段记录，host 被 pointer-events 阻断时仍能取证；计数不会逐 move 触发 React 更新。
新增 `data-input-arbiter=ready` 仅在仲裁器创建后设置，清理时删除。

扩大完整 UI 覆盖发现三个旧合成事件辅助路径漏发 up：Unicode 文字重编辑、图片二次导入、资源文字重编辑。
补齐 down/up 生命周期，原有内容、焦点、取消、提交、undo/redo 和错误断言保留。

## 实跑结果

| 命令                                                                                                                                                  | 结果                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 修复前 `pnpm exec playwright test tests/ui/mobile-input-mode.spec.ts --project=chromium --workers=1 --trace=off -g signed-pointer-identity`           | 3 failed，三档均复现                                         |
| 修复前 `pnpm exec jest --selectProjects core-node --runInBand --runTestsByPath packages/painting/src/__tests__/core/layered-freehand-session.test.ts` | 新增负 ID 3 failed / 旧用例 35 passed                        |
| 修复后 `pnpm run test`                                                                                                                                | 87 suites / 1129 tests passed，全部三个现有 projects         |
| `pnpm run typecheck`                                                                                                                                  | exit 0，三个 workspace                                       |
| `pnpm run lint`                                                                                                                                       | exit 0，0 errors / 32 条既有 warnings                        |
| `CI=true pnpm exec playwright test --project=chromium --workers=1 --retries=0 --trace=off`                                                            | 101 passed，完整 Chromium，含三条 CDP 真实输入与三条负 ID UI |
| WebKit 容器命令（下文）                                                                                                                               | 96 passed / 2 skipped / 0 failed，完整配置，3.2m             |
| `openspec validate mobile-input-mode-switch --strict --no-interactive`                                                                                | valid                                                        |
| `openspec validate --all --strict --no-interactive`                                                                                                   | 6 passed / 0 failed                                          |

WebKit 的两项 skip 是原有 `gesture-diagnostics.spec.ts` 中仅能使用 Chromium CDP 的 touch-action 实验；
没有新增 skip，全部新增移动模式和诊断用例均执行通过。Chromium 的 101 项无 skip，两个浏览器均禁用重试。

### 原始轨迹前后回放

实际执行：

```sh
node docs/implementation/mobile-input-mode-switch/replay-device-trace.mjs ../attachments/painting-gesture-trace.json http://127.0.0.1:5278 http://127.0.0.1:5266
```

同一 244 条生命周期事件、20 次 down（9 pen）：

- 旧服务 `764324d`：objects=0，penSeen=false，viewport revision=0。
- 修复版：objects=9，penSeen=true、effectiveTouch=pan，viewport revision=82，无 alert。

回放保留原始 ID、坐标、压力、时间、顺序；它是 DOM 合成回放，不冒充硬件复验。
原附件没有 button 字段，回放按主接触 button=0；独立 CDP 用例另外验证浏览器可信输入。

### WebKit 环境与完整命令

宿主 Ubuntu 26 不受当前 Playwright WebKit 支持，直接启动因缺少 libicu74 等库失败。
实际 WebKit 使用仓库此前已验证的 Ubuntu 24.04 rootless Podman 镜像，未以 Chromium 替代。
测试自己管理临时 5266 服务；没有改动小助手管理的旧 5278 验证服务。

```sh
podman run --rm --name ham44-webkit-check --network host \
  -v "$PWD:$PWD" -w "$PWD" \
  -v /home/zhangxiao/.cache/ms-playwright:/ms-playwright:ro \
  -v /home/zhangxiao/.nvm/versions/node/v24.15.0:/node:ro \
  -v /home/zhangxiao/.cache/node/corepack:/corepack:ro \
  -e PATH=/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  -e COREPACK_HOME=/corepack -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -e PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 -e CI=true \
  localhost/ham40-webkit:noble \
  pnpm exec playwright test --config=playwright.webkit.config.ts --workers=1 --retries=0 --trace=off
```

## 设备复验

上述自动化记录交付时尚未完成实体 iPad 复验。其后小助手将 `ham44-dev` / 5278 更新至
`5f49556`，修勾于 2026-10-18 在同台 iPad（iPadOS 18 / Edge）用手指与手写笔复验通过，
并回复“验证成功”。服务由小助手停止。该反馈不等于真笔压力档位、掌触专项或性能预算验收。
归档后验证与剩余边界见 [archive-verification.md](./archive-verification.md)。
