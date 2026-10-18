# 验收反馈修复与验证

2026-10-18，基于 `9a7da6b` 修复四项验收缺陷。交互契约已写入当前 change 的 input/document specs 与任务 8.1–8.4；原五项设备人工验收不勾选、不缩小范围。

## 修复与回归对应

1. **快速 pen 松手丢笔**：宿主原先把子 SVG path 冒泡的 `lostpointercapture` 当成自身丢失捕获，取消正在书写的 owner。现在只处理宿主自身的捕获丢失，并在 window capture 阶段处理有效 owner 的 up/cancel，避免后代导航事件门控截断收尾。真正的 host capture loss、pointercancel、后台和卸载仍取消，不把取消强行提交。浏览器入口测试从既有墨迹 path 落笔，快速单次移动加入子节点捕获转交通知，慢速十二次移动逐次等待 16ms；均断言新增历史、最终 SVG 可见、末样本 up/pressure=0、viewport 不变及 undo/redo。
2. **贝塞尔**：拖动松手只确定直线两端；后续两次点击依次确定两个控制点，最终保存 `[start, cp1, cp2, end]`，只形成一次事务。浏览器使用真实 mouse 拖动/点击，断言直线预览、各阶段历史与最终精确控制点；额外检查 Escape/工具切换取消草稿。
3. **多边形**：只有点击落点进入顶点列表，移动/拖动轨迹仅预览；浏览器 dblclick 闭合。第二点击的轻微坐标偏移不新增终点。入口回归检查精确顶点、闭合 path、完成前无历史、完成后一次 undo/redo 和取消行为。
4. **小地图背景**：背景与纸张矩形均跟随工具栏的 `navigation.paper`；关闭时纯白且不绘制纸张矩形。入口回归实际切换工具栏，检查主纸张、地图渲染树和白色背景 CSS。

旧交互语义对照 `a4b3c54^` 的 DrawingSurface/PaintingController/reducer。回归位于既有收集目录 `tests/ui/acceptance-feedback.spec.ts`，同时加入独立 WebKit 的 testMatch。测试只读 diagnostics 检查文档，不调用内部 controller mutation 或 mock gesture engine。

## 实跑证据

- 修复前：`pnpm test:ui tests/ui/acceptance-feedback.spec.ts --workers=1 --trace=off`，初始五例 **4 failed / 1 passed**；失败分别拦住捕获转交丢笔、贝塞尔、多边形和地图背景，慢速 pen 通过。
- 修复后：同命令，扩展为 **7/7 PASS**，包含双击坐标偏移和两个取消用例。
- `pnpm test`：**82 suites / 1065 tests PASS**，三个项目均收集；保留既有取消/捕获/工具回归，更新原先错误的拖动即完成形状假设。
- `pnpm typecheck`：exit 0。
- `pnpm lint`：exit 0，**0 errors / 32 warnings**，未增加 error、未禁用规则。
- `pnpm test:ui --workers=1 --trace=off`：全量 Chromium **56/56 PASS**，包括新增七例和原 49 例。
- `pnpm exec playwright test --config=playwright.webkit.config.ts --workers=1 --trace=off`：独立 WebKit **56/56 PASS**。宿主 Ubuntu 26 不受支持，实际在已有 `localhost/ham40-webkit:noble` Ubuntu 24.04 Podman 中执行，使用 `--network host` 连接临时 5266 服务、绑定同路径代码和 Playwright 浏览器缓存；没有用 Chromium 代替。
- `openspec validate layered-perfect-freehand-surface --strict`：exit 0。apply 状态为 **44/49**，只剩原五项人工验收。

- `pnpm build`：exit 0，两个库与 Expo Web 静态产物构建成功；浏览器结束后串行执行，未与其他导出竞争共享目录。
- `pnpm pack:dry`：exit 0，painting 977 files / 1.0 MB，board 12 files / 4.5 kB；未发布包。
- `pnpm verify:layered`：exit 0，exports 存在，源码/锁文件/两个包和 Expo 产物无退役 Skia runtime。
- `pnpm exec prettier --check <本轮 16 个源码/测试/配置/文档>`：exit 0；最终证据文字补录后另查修改文档。`git diff --check` 无错误。

功能与回归提交 `9751a57` 已普通推送至原 PR #24 分支，后续证据提交不改变运行实现。构建/打包完成后按 `/proc/1206666/cwd` 核对本轮临时服务 PID，仅终止该服务并收齐前台会话；`ss -ltn '( sport = :5266 )'` 确认无监听。没有启动持久验证服务。新 SHA 的 CI 由推送触发，本地结果不冒充 CI 结果。

## 验证限制

pen 输入是浏览器真实入口上的合成 PointerEvent。可信 Chromium CDP pen 的快慢输入在修复前均能提交，尚未在真实硬件上复现用户所有快速丢笔场景；本次定位并修复的是可重现的捕获转交取消路径，不能据此声称所有硬件原因均已证明。需修勾用原设备复验快速书写。

五项人工验收仍为 3.3 / 6.1 / 7.5 / 7.6 / 7.8，详见 `manual-acceptance.md`。Linux Chromium/WebKit 与合成输入不替代 Safari/iOS WebView、真笔压力/掌触/高刷新交接或目标设备长笔预算。验证服务 `ham40-dev` 已按要求停止，本轮只使用临时前台测试服务，交回时由验证方另起。
