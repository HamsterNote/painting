# Mobile Input Mode Switch 归档验收

2026-10-18，分支 `feat/mobile-input-mode-switch`；实现与设备修复基线 `5f49556`。
本记录补充 apply 逐项记录与 iPad 修复记录，不更改六条冻结口径。

## 归档与规格

执行 `openspec archive mobile-input-mode-switch --yes`，19/19 任务完成，产物位于
`openspec/changes/archive/2026-10-18-mobile-input-mode-switch/`，包括 `.openspec.yaml`。
CLI 将 delta 的五条 requirement 同步到 `openspec/specs/input-session-viewport/spec.md`。
逐段对比确认五条 requirement 原文完整同步，原 `Web owns viewport and coordinates` 条文及场景未改。

## 验收依据

- 修勾于 2026-10-18 在 iPad（iPadOS 18 / Edge）使用手指与手写笔复验通过。
  用户确认见 HAM-44 评论 `01a14dc1-3084-7acc-897e-93fc0618f462`（“验证成功”）；
  设备和输入来源由小助手收尾评论 `01a14dc1-f275-73ad-8d10-7c7b47190746` 确认。
- 小助手在 `5f49556` 独立执行 `mobile-input-mode.spec.ts`、
  `mobile-input-mode-real-input.spec.ts`、`input-device-diagnostics.spec.ts`：36/36 passed。
  记录见评论 `01a14d9c-17c5-77f3-818a-881a993f2dd4`，含 iPad 原始负 ID 回归与 CDP touch/pen。
- iPadOS WebKit 的负 pointerId 是实际设备轨迹证据；身份保留原有符号与安全整数校验。
  sequence/revision 仍要求非负。负 ID 的 pen/touch 回归断言实际文档提交和双指导航。
- 自动化覆盖合成 PointerEvent、Chromium CDP trusted 输入及桌面 WebKit；
  它们不能替代真机书写品质、浏览器差异和硬件识别验收。

## 归档后的全量检查

下列检查在归档后的目录结构上重新执行，未放宽断言或新增跳过。

| 命令 | 本轮结果 |
| --- | --- |
| `openspec list` | No active changes found |
| `openspec validate --all --strict --no-interactive` | 5 passed / 0 failed（归档后只有五份主规格） |
| `pnpm run test` | 87 suites / 1129 tests passed，三个现有 projects |
| `pnpm run typecheck` | exit 0，三个 workspace |
| `pnpm run lint` | exit 0，0 errors / 32 条既有 warnings |
| `pnpm run build` | exit 0，库与 playground 静态构建通过 |
| `pnpm run pack:dry` | exit 0，painting / painting-board 两包 dry-run 通过 |
| `CI=true pnpm exec playwright test --project=chromium --workers=1 --retries=0 --trace=off` | 101 passed / 0 failed / 0 skipped，2.4m |
| WebKit 容器命令（下文） | 96 passed / 2 skipped / 0 failed，2.9m，禁用重试 |

两项跳过均为已有 `gesture-diagnostics.spec.ts` 的 Chromium-only CDP touch-action 实验。
新增移动模式、负 ID 与诊断用例在 WebKit 全部执行通过，没有新增跳过。

宿主 Ubuntu 26 的 WebKit 动态库不受当前 Playwright 支持，因此使用已有 Ubuntu 24
rootless Podman 镜像，实际执行如下；测试自行管理临时服务，未复用旧验证服务。

```sh
podman run --rm --name ham44-webkit-archive-check --network host \
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

## 未验证范围

- 真笔压力档位与压力品质、硬件掌触专项（自动化中的压力/触摸抑制断言不等于硬件验收）。
- iOS/Android 原生壳及桥接输入；此次真机结论限 iPadOS / Edge 浏览器。
- 长笔的性能、内存与刷新率预算；已有功能/像素用例不等于性能预算达标。
- Safari 真机与其他设备/浏览器组合没有单独验收结论。

验证服务由小助手停止，本轮仅使用 Playwright 管理的临时测试服务。
检查完成后 Podman 无遗留容器，5266 / 5278 均无监听。GitHub CI 由 PR 触发，
不在本记录中冒充已通过的本地检查，也不等待 CI 完成。
