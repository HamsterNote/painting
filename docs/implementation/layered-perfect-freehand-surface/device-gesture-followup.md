# 快速丢笔的设备诊断与纸张定位

本轮基于 `2fb15e9`，单人沿 PR #24 分支推进。用户补充原设备为 **macOS + Edge + 鼠标**，已将调查重点转回桌面输入；触摸只是浏览器取消路径的对照，未据此归因。原设备尚未给出 trace，任务 8.1 重新打开；下述捕获释放漏洞有浏览器证据，但不能宣称就是原设备快速丢笔的根因。原五项人工验收不变。

## 已证实的捕获释放漏洞

用 Playwright mouse 在真实入口按下并移动，确认宿主持有 capture，再调用浏览器原生 `releasePointerCapture`；继续移动到表面外的诊断栏并松手。该控件阻止 move/up 冒泡。没有手工 dispatch `lostpointercapture`，浏览器产生的 capture loss / move / up 均为 trusted。

| 计数                      | 修复前 | 修复后 |
| ------------------------- | ------ | ------ |
| window 收到 pointermove   | 2      | 2      |
| freehand 接受 update      | 1      | 2      |
| 浏览器 lostpointercapture | 1      | 1      |
| 浏览器 pointercancel      | 0      | 0      |
| adapter cancel            | 1      | 0      |
| window 收到 pointerup     | 1      | 1      |
| commit / visible          | 0 / 0  | 1 / 1  |
| 文档对象数                | 0      | 1      |

旧代码把捕获路由的丢失误当会话结束，清掉 owner。现在保持 owner，由 window capture 的 move/up 收尾；既不要求 up 落在原元素内，也不受下层 stopPropagation 影响。只有实际 pointercancel、失焦/后台、卸载、工具切换才取消。未发 up 的断流不会凭空补出提交。

`tests/ui/gesture-diagnostics.spec.ts` 同时通过真实入口检查一次 undo/redo；原 adapter 测试改为验证 capture loss 后 up 正常提交，随后另一笔 capture loss + pointercancel 不提交。原有并发来源、重入、无效批次与取消回归仍保留。

## 浏览器触摸仲裁对照

Chromium CDP touch（trusted 浏览器输入，非物理设备）在移动 viewport 390×844、`touchDraw=1` 下测试：

- 实际表面 `touch-action: none`：3 次 move、1 次 up、0 cancel、1 commit、1 visible。
- 实验性改成 `touch-action: auto` 并提供可滚动页面：浏览器发出 1 次 pointercancel、0 up、0 commit；取消契约保持正确。

代码已有正确的 `touch-action: none`；本轮没有凭猜测改 CSS 或把 pointercancel 提交为半笔。这个对照证明 trace 能区分浏览器滚动取消与 adapter 错误取消，不证明原设备没有系统手势/浏览器差异。

## 原设备使用方式

打开 `/layered-editor?diagnostics=1&traceGestures=1`，保持原来的工具/输入源复现；若本来用手指绘制，沿用原来的 `&touchDraw=1`。复现后展开页面底部「手势诊断（记录中）」，点击「复制记录」或「下载记录」。HTTP LAN 无 Clipboard API 时，「查看记录」提供可全选的文本框，不要求 DevTools。

JSON 包含设备/浏览器环境、当前 viewport、工具/导航设置、最近 2048 条事件及累计计数/丢弃数量；有 pointer id/source/trusted、owner/session/commit、coalesced 数量/接受批次、timeStamp、movementX/Y、pointerrawupdate、拒绝/取消原因和 pending/visible 呈现记录。up 时另记 operating/destroyed/destroyRequested、最后已接受世界坐标样本与 pending candidate 数；adapter 同步消费 move，不存在待刷新的 lastPoint 队列。rawupdate 只观察，不加入文档采样。仅保留元数据与事件坐标，不包含文档文字、图片或原始文档。逐点仅写固定环形缓冲，不 setState 或复制整笔；界面在用户导出时更新。不开两个开关时不创建记录器/事件观察器/面板。

排查顺序：同一 session 的 begin → update/reject → up/cancel → end → commit → presentation visible。up 已到但无 owner、source 不匹配、coalesced identity 不符、commit 错误与已提交未交接可据此区分。取消请求记录明确原因；真正的 native capture 事件不伪装成 cancel。

## 分批验证

- 加诊断、未改取消逻辑时：`pnpm test:ui tests/ui/gesture-diagnostics.spec.ts --workers=1 --trace=off` 为 1 failed / 4 passed，失败处历史对象数 0 而非 1；原始 trace 已导出留作附件。
- 捕获修复后同命令：Chromium 5/5 PASS。
- `pnpm exec jest --runInBand --testPathPattern 'freehandWebAdapter|layered-navigation|rulerGestureController'`：3 suites / 81 tests PASS。

任务 8.1 要等原设备证据；不将这次路径修复当作原问题已验收。

## 纸张初始横向居中

默认新增 `top-center`，纸张首次显示且布局宽度可用时写入 controller viewport 的 tx；保持 ty 与 scale。显式 `top-left`、完整 `center` 仍可使用。初始化按 controller/placement 记一次，隐藏/重显、窗口 resize 和后续手动导航不重置。1280 宽、zoom=1 的左边距为 243 px；纸张比屏幕宽时允许负边距，仍保持几何中心一致。

回归覆盖宽度 1280 / 390、zoom=1 / 非单位缩放、已有纵向平移、输入 screen→world 转换、主 SVG/纸张 matrix 与小地图 indicator 一致、隐藏重显和 resize 后导航不被覆盖。纸张单测在修复前 3 failed / 2 passed，修复后完整 `pnpm test` 为 82 suites / 1070 tests PASS（追加测试时曾误嵌套两个 test，修正后全量复跑通过）。纸张与分层入口 Chromium 专项 27/27 PASS。

## 最终实跑结果

运行实现为 `96dd2e1`（捕获修复/诊断）、`dba660b`（纸张定位）、`d18cbb3`（桌面诊断补充），全部普通 fast-forward 推送到 `feat/use-perfect-freehand`。

- `pnpm install --frozen-lockfile`：exit 0，无依赖/锁文件修改。
- `pnpm test`：82 suites / 1070 tests PASS，web/core-node/native 均执行。
- `pnpm typecheck`：exit 0。新增诊断最初使用的 Array.at 不在库的目标 lib 中，pointerrawupdate 在 DOM 声明中也为普通 Event；分别改为下标读取和已知指针事件监听器后完整复跑通过，未降低编译检查。
- `pnpm lint`：exit 0，0 errors / 32 既有 warnings。
- `pnpm test:ui --workers=1 --trace=off`：最终 Chromium 65/65 PASS（1.7m），包含新增桌面诊断字段、非法 coalesced 原因、rawupdate 不重复采样和无 Clipboard API 的导出回退。以上类型错误也曾使准备构件失败；修复后重新启动并跑完本次全量，不将启动失败当测试通过。
- `node node_modules/@playwright/test/cli.js test --config=playwright.webkit.config.ts --workers=1 --trace=off`：Ubuntu 24.04 Podman `localhost/ham40-webkit:noble` 内独立 WebKit 63 PASS / 2 skipped（1.8m）；跳过的仅两个 Chromium CDP touch 实验，其余旧 56 例、纸张 4 例与诊断 3 例均通过。容器使用 host 网络，同路径 checkout、Node 24.15.0 和 Playwright 缓存挂载；宿主临时 Expo 服务在检查结束后由前台 runner 收掉。
- `pnpm build` → `pnpm pack:dry` → `pnpm verify:layered` 串行：均 exit 0；两个包、公开 exports 与 Expo Web 构建通过，产物无退役 Skia runtime。未发布包。
- 所有本轮受影响源码/测试/配置/spec/文档的 Prettier check、`git diff --check` 与 `openspec validate layered-perfect-freehand-surface --strict`：PASS。

最终 change 为 46/52。8.5/8.6/8.7 已完成；8.1 明确重新打开，等待原 macOS Edge 鼠标 trace；原 3.3/6.1/7.5/7.6/7.8 五项人工验收完全保留。本轮未重跑 Android/iOS 静态导出，也没有用 Linux WebKit 冒充 Safari 或 macOS Edge 真机。

`tmux kill-session -t ham40-dev` 已在首次 UI 前执行。检查结束确认 5266 无监听；本轮未另起持久验证服务，验证方需从最新 head 重启后交原设备复现。推送触发 CI，本轮未等待或声称新 SHA 的 CI 已通过。
