# HAM-50 真机验收与归档依据

## iPad 浏览器验收

2026-10-18，修勾在 iPad 真机按 `README.md` 的四条路径（单指、双指缩放/平移、第二指取消绘制预览、笔指混合冻结与排空）复验通过。普通 `/layered-editor` 与 `/layered-editor?diagnostics=1` 入口均覆盖，验证服务锁定提交 `9834cec61b641c7f5041a14280d8c56322390e68`。

HAM-50 评论依据：

- 修勾于 `2026-10-18T12:28:13Z` 回复“验证完毕”，评论 `01a14efb-e51f-76b6-a4fa-cbd6d6e12000`，无附件。
- 小助手于 `2026-10-18T12:29:49Z` 确认真机验收通过、服务 SHA 和入口，评论 `01a14efd-5dea-7e56-9003-023f8a575999`，并要求归档、推送、提 PR；验证服务 `ham50-dev` 已停止，5291 空闲。
- 验证前四路径与两入口说明为评论 `01a14ee6-ce30-7a03-8d4d-fad1cf3ab964`。

验收是用户文字确认，没有收到本轮真机截图、录屏或诊断 JSON；既有 Chromium 截图不是真机验收截图。不补造系统/浏览器版本、逐轮计数、实际 touch identifier 或 traceGestures 参数的记录。原路径要求每入口各 20 轮、正反抬指；用户未逐项提供计数，按其完成确认及小助手明确验收通过的委托记录 tasks 4.1 完成。

## 条件项 4.2 不适用

本轮通过 Multica CLI 重新下载并解析 HAM-44 原始 `painting-gesture-trace.json`，附件 ID `01a14d89-23e3-7595-83a7-b985de6b87d1`。其 `environment.userAgent` 为：

```text
Mozilla/5.0 (iPad; CPU OS 18_7_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/153.0.4234.46 Version/18.0 Mobile/15E148 Safari/604.1
```

附件导出时间为 `2026-10-18T05:41:53.055Z`。仓库 `docs/implementation/mobile-input-mode-switch/ipados-input-fix.md` 的“真机证据与根因”也记录同附件来自 iPad 2018 / iPadOS 18.7.5 / Edge 153；`archive-verification.md` 将验收边界限定为 iPadOS / Edge 浏览器。该依据与本轮收口指令一致，原现场是浏览器宿主，不是 Expo 宿主/WebView。

因此 4.2 的“如原现场是 Expo 宿主/WebView”条件不成立，记为不适用并保持未勾选。没有进行或宣称 WebView 复验；旧附件只用于确认原现场宿主，不作为本次修复的真机事件导出。TouchEvent.identifier 的依赖槽位修复与应用原始 PointerEvent.pointerId 的有符号身份保持区分，详见 `apply-validation.md`。

## 归档范围

按 2026-10-18 收口指令，将 change 归档至 `openspec/changes/archive/2026-10-18-fix-web-responder-touch-identity/`，保留全部原始 evidence。仅向 `openspec/specs/input-session-viewport/spec.md` 新增 delta requirement，不修改既有 requirement，尤其 `Web owns viewport and coordinates`。条件项不适用的书面依据用于处理归档的未完成项提示，不将其硬勾为 WebView 已验收。

本轮实测：

- `openspec archive fix-web-responder-touch-identity --yes`：退出码 0；显示 9/10 tasks，提示一个未完成项后继续；规格变化为 `+ 1, ~ 0, - 0`，归档目录符合上述日期。
- `openspec list`：`No active changes found.`
- `openspec validate --all --strict --no-interactive`：5 passed / 0 failed。
- Node `assert` 对比归档前 HEAD 中的主规格与归档后文件：旧文件逐字节前缀完全保留，新增后缀恰等于 delta 的 ADDED requirement，既有 HAM-44 条文未改。

本轮仅更新验收文档、归档与同步规格，未修改补丁或应用/测试代码；全量自动化实测仍见 `apply-validation.md`，不将历史结果冒称本轮重跑。未启动常驻服务，PR 由负责人按 merge commit 方式合并，本轮不合并。
