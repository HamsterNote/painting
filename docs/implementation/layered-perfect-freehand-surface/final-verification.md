# 最终开发验证记录

本文保留截至 `9a7da6b` 的退役交付基线；之后四项验收缺陷的修复与最新完整验证见 `acceptance-feedback.md`。当前 Chromium/WebKit 均为 56/56，任务为 44/49；原五项人工验收保持未完成。下文 49/49、40/45 与 CI SHA 均为历史实跑记录。

日期：2026-10-18。分支始终为 `feat/use-perfect-freehand`，正常 fast-forward 推送至 PR #24；没有 rebase/force-push。失败树 `agent/ham40-wip-failed-run` 保持本地，不推送。

## 实际命令与结果

| 命令                                                                                     | 实际结果                                                                                                                                                                |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                         | exit 0，resolution skipped / Already up to date；锁文件仅退出 Skia 独占依赖 80 行，没有升级                                                                             |
| `pnpm exec jest --listTests --runInBand --json`                                          | 82 文件；逐个对照 packages 与 tests/jest 中全部 82 个真实测试路径，missing=[]                                                                                           |
| `pnpm test`                                                                              | 在 CI 配置与 capability 审核后、格式整理后重跑：82 suites / 1065 tests PASS，3 projects（legacy-web 名称的 Web 工程、core-node、native）；含整个 Expo DOM host 最小挂载 |
| `pnpm typecheck`                                                                         | 格式整理后 exit 0，两个包与 playground 全部检查                                                                                                                         |
| `pnpm lint`                                                                              | 格式整理后 exit 0，0 errors / 32 warnings；未禁用规则，低于此前 36 warnings                                                                                             |
| 受影响文件 `pnpm exec prettier --check`                                                  | 对 origin/main 至当前分支已新增/修改且仍存在的源码、配置、文档 265 文件检查，exit 0；排除 pnpm 自动生成锁文件、Bob lib、原始 baseline/dirty-tree-backup 证据            |
| `pnpm test:ui --workers=1 --trace=off`                                                   | Chromium 49/49 PASS（1.6m），实际 prepare artifacts、5266 Expo Web 与完整 13 份 UI 文件；真实像素、合成输入                                                             |
| `pnpm exec playwright test --config=playwright.webkit.config.ts --workers=1 --trace=off` | 独立 WebKit 49/49 PASS（1.4m），同一完整 13 份 UI 文件                                                                                                                  |
| `pnpm --filter @hamster-note/painting-playground build:android`                          | exit 0，生成 LayeredEditorDom www.bundle 与 Android 静态包                                                                                                              |
| `pnpm --filter @hamster-note/painting-playground exec expo export --platform ios`        | exit 0，生成 LayeredEditorDom www.bundle 与 iOS 静态包                                                                                                                  |
| `pnpm build` / `pnpm pack:dry` / `pnpm verify:layered`                                   | 串行执行，两个包与 Expo Web 构建/打包及公开 exports、锁文件、无 Skia 产物检查通过                                                                                       |
| `node --test scripts/perf/*.test.mjs`                                                    | 55/55 PASS；仅保留纯 JSON/provenance/oracle 工具，不继承历史预算                                                                                                        |
| `openspec list --json`                                                                   | 仅 `layered-perfect-freehand-surface`；旧 change 未归档、未伪造完成                                                                                                     |
| `openspec validate layered-perfect-freehand-surface --strict`                            | capability 审核与格式整理后 exit 0；CI 中固定 `@fission-ai/openspec@1.13.1` 的相同校验也在本地实跑 exit 0                                                               |

### 环境与重跑说明

宿主 Node 24.15.0、pnpm 10.28.2。宿主 Ubuntu 26 不受 Playwright WebKit 支持，独立 WebKit 实际在 Ubuntu 24.04 Podman（`localhost/ham40-webkit:noble`）中使用已安装 Playwright 浏览器执行，network host 连接宿主临时 5266 Expo 服务；没有改成 Chromium 冒充。CI 也固定 ubuntu-24.04 / Node 24.15.0，直接安装 Chromium 与 WebKit 系统依赖。

完整 Podman 命令（仓库绑定到相同绝对位置以保留 pnpm workspace 链接；`REPO` 为当前仓库位置）：

```bash
podman run --rm --name ham40-webkit-check --network host \
  -v "$REPO:$REPO" -w "$REPO" \
  -v /home/zhangxiao/.cache/ms-playwright:/ms-playwright:ro \
  -v /home/zhangxiao/.nvm/versions/node/v24.15.0:/node:ro \
  -v /home/zhangxiao/.cache/node/corepack:/corepack:ro \
  -e PATH=/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  -e COREPACK_HOME=/corepack -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -e PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 \
  localhost/ham40-webkit:noble \
  pnpm exec playwright test --config=playwright.webkit.config.ts --workers=1 --trace=off
```

- 首轮受影响格式检查提示 69 文件：68 个手写源码/文档已格式化后复验；pnpm-lock.yaml 维持工具生成格式，未引入锁文件重排。
- 一次把 Android 导出和 Web 产物检查并行，导出清空共享 dist，检查报 Missing JavaScript artifacts；改为 Android → iOS → Web build → pack → guard 串行后通过。CI 从一开始即为串行。
- 一次把 Bob 重建和 Jest 扫描并行，Jest 在被清理的 lib/package.json 上遇到 ENOENT；构建结束后独立 `pnpm test` 重跑 82/1065 PASS。没有修改测试绕过失败。
- 本轮仅有自动化所需临时 Expo 服务，WebKit 结束后已按自身 PID 与工作目录核对并停止，没有启动 tmux 或持久验证服务。

## 审核与未验证范围

`capability-audit.md` 覆盖五份 spec 的 19 条 requirement；`retirement-verification.md` 列运行入口/资源删除与回归搬迁；`skia-supersession.md` 列旧八项义务和 33 文件旧 change 的退役依据。剩余 Skia 文本属于历史基线/审计说明，不在构建与公开导出链路。

3.3 / 6.1 / 7.5 / 7.6 / 7.8 的设备验收保留未勾选，已明确移入 `manual-acceptance.md`：Safari/iOS WebView 混排、系统 IME/键盘/焦点、原生启动；真笔四模式、up=0、掌触、高刷新交接；目标设备长笔 CPU/内存/rAF/历史 reconcile 与 WebView 预算。静态导出不等于原生构建或设备运行，内部 ACK 不证明 physical paint，未来 native bridge 性能不在本期实现范围。

## CI 实际结果

`gh pr checks 24 --watch --interval 20` 在本轮前台收集完成，exit 0。`e9f4356d5d49d66b98d2e9412019e035c8870ef6` 的 [Test and Build](https://github.com/HamsterNote/painting/actions/runs/39053474621) 全部步骤成功，用时 7m8s：冻结安装、lint/typecheck、三工程 Jest（含 native 最小挂载）与纯工具、strict、Chromium、独立 WebKit、两包/Expo Web 构建、pack、无 Skia 产物检查、Android/iOS Expo DOM 静态导出。CodeQL 的 actions / javascript-typescript 分析及汇总三项也全部 PASS。

补录此结果的后续提交仅修改证据文字与任务状态，会正常触发新 SHA 的 CI；上述通过结论严格对应 `e9f4356`，不把重跑中的新 SHA 描述为已通过。7.9/7.10 收尾后再次实跑全量 `pnpm test`：82 suites / 1065 tests PASS（11.814s）；`openspec validate layered-perfect-freehand-surface --strict` exit 0。当前 40/45 完成，五项设备部分均明确移入人工清单，原 checkbox 未勾选。
