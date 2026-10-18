# 归档与最终交付复核（HAM-40）

2026-10-18，从 `5dde69c25a3b52e6ad2c244012d2b85d0f599596` 沿 `feat/use-perfect-freehand` 收尾，交付 PR 为 [PR #24](https://github.com/HamsterNote/painting/pull/24)。本轮只调整 specs、任务/证据文档及归档后的 CI 校验入口；应用行为、测试断言与依赖未变。

## 验收决定及证据来源

来源为 HAM-40（issue `01a14a4e-cf26-7cbe-b887-a3dc4322d328`）的用户评论：

- `01a14cb5-a1c3-7733-a121-387c9f465e72`，2026-10-18 01:52:14Z：修勾确认原设备为 macOS + Edge + 鼠标。
- `01a14cf3-db14-7479-a422-6067646395a7`，2026-10-18 03:00:12Z：修勾设备复验「已经无法复现丢笔」，据此结案 8.1。
- `01a14d04-68e0-7cbf-bdd0-60f8f016c881`，2026-10-18 03:18:17Z：修勾决定设备验收「本期不做」，「居中只管进入页面时的默认，窗口尺寸变化不管」，并授权进入归档。

捕获释放的浏览器对照证据见 `device-gesture-followup.md`：修复前无浏览器 pointercancel，却有 adapter cancel=1、历史=0；修复后 commit=1、visible=1、历史=1。证明修掉了「浏览器真实释放 capture 后误取消 owner」这条路径，不等于在线上证明它是原设备唯一根因。设备复验结案与此边界同时保留；诊断入口 `/layered-editor?diagnostics=1&traceGestures=1` 仍可查看、复制、下载最近 2048 条手势记录。

主 spec `document-object-interaction` 固化首次呈现横向居中：默认纸宽 794，`tx=(可绘制宽度−794×zoom)/2`，ty 不动。窗口 resize、缩放、隐藏重显不重新初始化；1280 宽、zoom=1 时 tx=243。现有非单位 zoom、窄屏、主图/小地图/输入坐标及后续导航回归保留。

## 归档产物与引用

- 正式命令：`openspec archive layered-perfect-freehand-surface --yes`，exit 0。CLI 提示 47/52、5 项未完成；按用户已授权的延期决定继续，未将设备项勾成通过。另有超过 10 个 delta 的非阻塞拆分建议，未跳过 spec 同步或验证。
- 档案：`openspec/changes/archive/2026-10-18-layered-perfect-freehand-surface/`，保留 proposal、design、tasks 和五份 delta specs。
- 主 specs：`openspec/specs/{document-object-interaction,freehand-geometry-pressure,input-session-viewport,layered-web-rendering,web-platform-skia-retirement}/spec.md`，共 25 条 requirements；已逐份比较 requirements 正文，与归档 delta 一致。
- `openspec list`：`No active changes found.`；`openspec list --json`：`changes=[]`；`openspec list --specs --json`：五份主 specs，requirements 数依次为 9/4/6/3/3。
- `migrate-expo57-skia-surface` 按 6.5 保持退役，没有恢复或伪造完成归档。搜索确认源码/脚本/CI 没有读取两个旧活动目录；历史日志/备份路径、当轮执行命令和 supersedes 文字保留，当前文档入口已指向档案。
- CI 改为 `pnpm dlx @fission-ai/openspec@1.13.1 validate --all --strict --no-interactive`，覆盖全部现行 specs 和活动 changes，避免归档后仍按旧 change 名查找。

## 归档后实跑

UI 前执行 `tmux kill-session -t ham40-dev`，返回会话不存在，与验证方已停服务一致；确认 5266 无监听后启动。Chromium、WebKit、build 和 pack 串行执行，避免争用构件。

| 命令                                                                                                          | 本轮结果                                                                  |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm test`                                                                                                   | PASS，82 suites / 1070 tests，三个 Jest projects，24.702s                 |
| `pnpm typecheck`                                                                                              | PASS，exit 0                                                              |
| `pnpm lint`                                                                                                   | PASS，exit 0；0 errors / 32 既有 warnings                                 |
| `pnpm test:ui --workers=1 --trace=off`                                                                        | Chromium 65/65 PASS，1.8m                                                 |
| `node node_modules/@playwright/test/cli.js test --config=playwright.webkit.config.ts --workers=1 --trace=off` | 独立 WebKit 63 PASS / 2 skipped，1.8m；仅跳过两个 Chromium CDP touch 实验 |
| `pnpm build`                                                                                                  | PASS，exit 0；两个库及 Expo Web 构建完成                                  |
| `pnpm pack:dry`                                                                                               | PASS，exit 0；两个发布包 dry-run，未发布                                  |
| `pnpm verify:layered`                                                                                         | PASS，exit 0；公开 exports 与包/Web 产物无退役 Skia runtime               |
| `openspec validate --all --strict --no-interactive`                                                           | PASS，5 passed / 0 failed                                                 |
| `pnpm dlx @fission-ai/openspec@1.13.1 validate --all --strict --no-interactive`                               | PASS，5 passed / 0 failed；与 CI 固定版本/命令相同                        |
| 本轮文件 `pnpm exec prettier --check`、`git diff --check`                                                     | PASS                                                                      |

独立 WebKit 使用受支持的 Ubuntu 24.04 Podman 镜像 `localhost/ham40-webkit:noble`，同路径挂载 checkout，使用 Node 24.15.0 与已有 Playwright 缓存、host 网络及宿主临时 Expo 服务。宿主 Ubuntu 26 不在 Playwright WebKit 支持范围；容器运行不冒充 Safari/iOS WebView 设备验收。Chromium 与 WebKit 全部原有断言保留，本轮无失败用例或重试通过；WebKit 两个已有 skip 仅为 Chromium CDP 对照。前台 runner 在测试结束后收掉临时服务，实测 5266 无监听。

本轮未重跑 Android/iOS 静态导出或设备性能测量；已有静态导出记录见 `ham40-verification.md` / `final-verification.md`，静态导出不等于真机启动。推送后的新 SHA CI 结果另由 GitHub 执行，本地通过不代表其已通过。

## 本期未做/延后的设备验收

归档 tasks 为 **47/52 完成、5 项设备验收延后且未验证**。依据上述用户决定及缺少所需设备/观测，以下五项保留未勾选；`manual-acceptance.md` 的完整步骤、设备字段与性能测量方法全部保留作后续移交。

| 任务 | 延后且未验证的范围                                                                                         |
| ---- | ---------------------------------------------------------------------------------------------------------- |
| 3.3  | Safari/iOS WebView 的 SVG/foreignObject 混排、旋转缩放和实际合成顺序；Chromium/Linux WebKit 像素已覆盖     |
| 6.1  | iOS/Android 真机启动 Expo DOM 编辑器、编辑导航及后台恢复；平台入口/静态导出/native Jest 不替代真机         |
| 7.5  | 真笔四压力模式、up=0、掌触与 viewport 冻结、高刷新率交接；系统 IME/软键盘/焦点，以及设备图片/选择/擦除观察 |
| 7.6  | 目标设备长笔 PF 重算/Canvas replay CPU、内存、rAF、历史 reconcile 与 WebView 交接预算                      |
| 7.8  | Safari/iOS WebView 系统输入法、焦点、键盘、viewport 和混排观察；独立 Linux WebKit 自动化不等同此项完成     |
