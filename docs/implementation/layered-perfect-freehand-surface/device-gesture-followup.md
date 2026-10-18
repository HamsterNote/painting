# 快速丢笔的设备诊断与纸张定位

本轮基于 `2fb15e9`，单人沿 PR #24 分支推进。用户原设备尚未给出 trace，任务 8.1 重新打开；下述捕获释放漏洞有浏览器证据，但不能宣称就是原设备快速丢笔的根因。原五项人工验收不变。

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

JSON 包含设备/浏览器环境、当前 viewport、工具/导航设置、最近 2048 条事件及累计计数/丢弃数量；有 pointer id/source/trusted、owner/session/commit、coalesced batch 数、拒绝/取消原因和 pending/visible 呈现记录。仅保留元数据与事件坐标，不包含文档文字、图片或原始文档。逐点仅写固定环形缓冲，不 setState 或复制整笔；界面在用户导出时更新。不开两个开关时不创建记录器/事件观察器/面板。

排查顺序：同一 session 的 begin → update/reject → up/cancel → end → commit → presentation visible。up 已到但无 owner、source 不匹配、coalesced identity 不符、commit 错误与已提交未交接可据此区分。取消请求记录明确原因；真正的 native capture 事件不伪装成 cancel。

## 分批验证

- 加诊断、未改取消逻辑时：`pnpm test:ui tests/ui/gesture-diagnostics.spec.ts --workers=1 --trace=off` 为 1 failed / 4 passed，失败处历史对象数 0 而非 1；原始 trace 已导出留作附件。
- 捕获修复后同命令：Chromium 5/5 PASS。
- `pnpm exec jest --runInBand --testPathPattern 'freehandWebAdapter|layered-navigation|rulerGestureController'`：3 suites / 81 tests PASS。

后续完整验证结果在本文件继续记录。任务 8.1 要等原设备证据；不将这次路径修复当作原问题已验收。
