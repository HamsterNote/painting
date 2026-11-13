HAM-249 / PR #55 WebKit CI 修复（2026-11-13）

基于已推送提交 `f486553` 叠加修复，不改写历史。

CDP 与角度失败的原因

- `newCDPSession` 仅支持 Chromium。仅在 Chromium 的真实触摸拖动用例建立 CDP；WebKit 跳过该触摸用例，但仍执行原先误用 CDP 的鼠标优先级用例。
- 在相同页面 fixture 上，用 window capture 监听原生 pointerdown/move/up，记录请求坐标、实际 clientX/Y、SVG getScreenCTM 映射后的旋转中心及旋转前后角度。测试四种页面方向 × 三档页面缩放，各浏览器 12 组；原始数据见 `webkit-input-measurements.json`。
- WebKit 的实际坐标是整数 CSS 像素，正坐标样本均向下截断；Chromium 保留小数，仅有浮点序列化误差。不是旋转/命中实现的角度偏差：用实际交付坐标独立计算 atan2 增量后，WebKit 全部 12 组的选框残差绝对值小于 `0.000005°`，Chromium 小于 `0.0000003°`。

请求旋转 30° 的实测分布（方向按 0/90/180/270° 排列）

| 页面缩放 | 屏幕手柄半径（CSS px） | WebKit 实际旋转增量（°）                      | 相对 30° 最大绝对偏差 |
| -------- | ---------------------- | --------------------------------------------- | --------------------- |
| 0.5      | 25.5                   | 27.552811 / 28.610460 / 30.579229 / 29.475889 | 2.447189°             |
| 1        | 51                     | 29.054605 / 29.604450 / 30.579229 / 30.018362 | 0.945395°             |
| 2        | 102                    | 29.814160 / 30.094243 / 30.094243 / 29.814160 | 0.185840°             |

Chromium 的 12 组增量均约 `29.999998738°`。WebKit 在 0°、0.5 倍时，请求起点 `(220, 243.5)`、终点 `(232.75, 246.916352)`，实际为 `(220, 243)`、`(232, 246)`；实测增量 `27.552811379°` 与实际坐标预测只差约 `0.000000197°`。小半径放大同样的像素取整误差；具体误差还取决于页面方向及中心相对像素网格的小数部分，因此各方向不必严格随缩放单调。此机器 WebKit 与 Chromium 的页面顶端布局相差 13px；所有计算均取各自实时 DOM 中心，不假设跨浏览器布局相同。

测试修复及物理边界

- 不放宽 `expectSelectionAngle` 的 `0.01°` 阈值。通过浏览器实际交付的原生坐标计算期望角度，严格检查预览、提交、连续旋转、取消与重选；仍使用真实鼠标输入。独立约束请求与实际端点每轴误差至多 `1 CSS px`（另加 `0.0001px` 序列化余量）。
- 每个端点的误差圆半径至多 `sqrt(2)px`，在手柄半径 `r` 上对应角误差至多 `asin(sqrt(2)/r)`；起终点合计允许输入偏差为 `2*asin(sqrt(2)/r)`。上述三档半径的理论上界分别 `6.358436° / 3.177994° / 1.588844°`。这个上界仅约束输入相对请求的偏差，产品输出相对实际输入仍须满足 `0.01°`。
- 移动与中心缩放同样根据实际端点计算位移/半径比，保留原来 2 位小数的几何断言，并检查移动、缩放不改变已提交角度。避免修复角度断言后在后续缩放断言重复遇到同一个输入取整问题。
- 产品旋转与命中实现无需修改。

运行环境

本机 Ubuntu 26.04 与 Playwright 1.59.1 所用 WebKit 2272 的 Ubuntu 24.04 ABI 不同。缺失库从 Ubuntu noble 官方包提取到工作区外的临时目录，不修改系统及仓库依赖；本地启动包装器保留 WebKit 原有 bundle 环境，并增加该动态库目录（原始 MiniBrowser 包装器会覆盖 LD_LIBRARY_PATH）。已用最小页面确认正常启动。回归测试仅替换 executablePath 到该包装器，浏览器二进制与项目 WebKit 配置保持一致。

验证结果

- 两个相关文件 `layered-editor.spec.ts`、`page-integration.spec.ts`，使用上述临时浏览器配置同时运行 WebKit/Chromium，`CI=1 PLAYWRIGHT_PORT=6259 pnpm exec playwright test --config playwright.selection-diagnostics.config.ts --workers=2 --retries=0`：85 passed / 1 skipped / 2 failed，6.5 分钟。13 个角度用例在两种浏览器全部通过；WebKit 的鼠标优先级用例通过，只有 Chromium CDP 触摸用例按预期跳过。
- 上述 2 项失败均为既有 LAN 测试硬编码请求 `5266`，与本轮服务器 `6259` 不一致，报 ECONNREFUSED；不是本次修复的问题。确认 `5266` 空闲后，用相同配置及 `PLAYWRIGHT_PORT=5266 --grep 'responds over LAN' --workers=2 --retries=0 --reporter=list --output=../ham249-lan-results` 单独重跑，两种浏览器共 2 passed，41.8 秒。未修改该既有用例。
- 合计不同用例覆盖：WebKit 43 项通过 / 1 项跳过，Chromium 44 项通过。完整首轮日志与 LAN 补跑日志保留在 `webkit-bugfix-tests.txt`，没有将首轮描述为全部通过。
- 三个改动测试文件的 ESLint、六个改动 TS/Markdown/JSON 文件的 Prettier、`git diff --check` 均通过。新增 helper 使用 `pnpm exec tsc --noEmit --skipLibCheck --target es2022 --module esnext --moduleResolution bundler --lib es2022,dom --strict tests/ui/selection-session-helpers.ts` 独立类型检查通过。
- 没有重新推送或重跑远端 CI；本轮只准备叠加本地提交，等待协调员授权推送。
