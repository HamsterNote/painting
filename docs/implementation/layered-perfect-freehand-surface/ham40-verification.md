# HAM-40 本次续做与验证

基于 PR #24 `a4b3c54`，沿 `feat/use-perfect-freehand` 推进；未新开分支、rebase 或 force-push。checkout 初始工作树为空。旧 change 的 8 个开放任务映射见 `skia-supersession.md`；其中 CI 义务补为本 change 7.10。旧 change 未勾选、未归档、未删除。

## 本次完成映射

| 任务 | 实现与实际验证                                                                                                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.2  | 独立 Toolbar 订阅 tools/history，freehand 四设置与 shape dash 隔离；`layered-toolbar.test.tsx` PASS                                                                                                      |
| 3.4  | controller raw append buffer → rAF Canvas；DPR/resize/viewport 重绘、历史 render observer 计数、稳定 DOM；`layered-canvas.test.tsx` PASS                                                                 |
| 3.5  | `@hamster-note/painting/layered`、`LayeredPaintingBoard`、playground `/layered-editor` 使用同一 controller；`LayeredPaintingBoard.test.tsx` 与 Chromium 4 用例 PASS                                      |
| 4.5  | 有序前缀、隐藏历史后缀、四字段 ACK、文档修订续发、撤销 pending、工具开始前确认已挂载几何；`layered-presentation.test.ts` 与 Canvas/Chromium 用例 PASS                                                    |
| 4.6  | dot/短笔/real 压力宽度、0.5 opacity 的 active/pending/history 实际像素；Chromium 4/4 PASS；500ms 延迟 ACK 录屏逐帧检查无空白/双深                                                                        |
| 4.7  | 可配置 mouse/touch/pen 策略、非笔完整 batch 过程预览；`layered-semantic-adapter.test.ts` 与 `layered-tools.test.ts` PASS；既有 freehand adapter 71 tests 亦由完整 Jest 运行                              |
| 5.1  | 五种 shape 预览/取消/提交与 undo/redo；text 编辑会话；PNG/JPEG/WebP 导入限制、解码后单事务写入、取消/工具切换/过期拒绝；完整 Jest 86/1467 PASS，Chromium 5/5 PASS（含解码后的 SVG 像素与图片 undo/redo） |
| 5.2  | 混合对象统一 move/uniform resize/rotate、lasso、多选与 transient preview；原始 freehand samples 引用保持，变换后 query 与 undo/redo 一致；`layered-tools.test.ts` PASS                                   |
| 5.3  | 普通 SVG hover/click id 委托，captured 连续轨迹走几何 query；`layered-semantic-adapter.test.ts` PASS                                                                                                     |
| 5.4  | 连续 radius sweep、变换/遮挡对象、bbox 候选、一次 undo/cancel 恢复；`layered-tools.test.ts` 与语义 overlay mock PASS，无生产假 DOM dispatch                                                              |
| 6.2  | future native types/契约，Web viewport 权威、raw commitId、完整非笔轨迹与显式 text/keyboard ownership；`layered-native-contract.test.ts` PASS，非 native ink/真实桥                                      |
| 7.4  | Android/iOS Expo 静态导出均 exit 0，并实际生成 `LayeredEditorDom` DOM bundle；非原生构建、模拟器、真机、压感或 physical paint 证据                                                                       |

文字与有序混排也已接入：TextEditor 的真实 DOM focus/composition/完成/取消由 jsdom 与 Chromium 验证。5.5 等待设备观察；3.3 等待 WebKit/Safari，因此保持未完成。新入口图片导入已补齐，数据 URL 持久化于 V3 对象，不引入 Skia descriptors；后续移动/缩放/旋转继续走共享对象变换。

## 实际命令与结果

- `pnpm install --frozen-lockfile`：exit 0，1160 packages；本次未改变锁文件。
- `pnpm exec jest --listTests --runInBand | rg 'layered|Layered'`：列出全部 19 个 layered/board 测试文件；本次新文件均位于被收集目录。
- `pnpm test`：85 suites / 1462 tests PASS，四 projects 均执行，包括 native 最小挂载与尚未退役的 Skia project。旧项目通过不表示新渲染路径验收。
- `pnpm test:ui -- tests/ui/layered-editor.spec.ts --workers=1 --trace=off`：Chromium 4/4 PASS（首轮曾因夹具漏导出 identity constant 2 fail，修正后通过；随后使用下述正确参数转发命令复核）。只运行新增分层文件，未运行全量旧 UI suite。
- `pnpm run typecheck`：exit 0，painting、painting-board、playground 均通过。
- `pnpm run lint`：exit 1。修正本次新增测试的 conditional expect 后，以 ESLint JSON 与 git changed/untracked 路径比对：124 errors / 36 warnings 全在未修改文件；本次文件 errors=0、warnings=0。未删除或忽略旧失败测试。
- `pnpm run build`：exit 0，两个 Bob 包和 Expo Web export 成功。旧 Skia 路由/资源仍存在，不能据此勾选 6.3/6.4 或 7.3 的无 Skia 条件。
- `pnpm run pack:dry`：exit 0，两个包均成功列出 tarball 内容，未发布。
- `pnpm --filter @hamster-note/painting-playground build:android`：exit 0，Android 1973 modules；DOM bundle 290 modules，生成 www.bundle。
- `pnpm --filter @hamster-note/painting-playground exec expo export --platform ios`：exit 0，iOS 1879 modules；DOM bundle 249 modules，生成 www.bundle。
- `pnpm exec playwright test --config playwright.webkit.config.ts --list`：独立收集 4 个 WebKit 用例。
- `pnpm exec playwright test --config playwright.webkit.config.ts --workers=1 --trace=off`：4 launch failures，缺少 WebKit executable；`pnpm exec playwright install webkit` 明确失败：`Playwright does not support webkit on ubuntu26.04-x64`。无 WebKit 运行证据，不声称 Safari/iOS 通过。
- `pnpm --filter @hamster-note/painting-playground exec expo start --help`：当前 Expo 57 不支持 `--no-open`。6.7 保持开放，等待决定受支持的等效启动方式；测试使用既有 Playwright headless server 配置。

一次 `pnpm run test -- --silent` 因把 `--silent` 解析为测试路径而没有收集测试，未当作通过；已用上面的 `pnpm test` 完整执行。

## 验证入口与剩余边界

### 半透明交接录帧复核

`pnpm test:ui tests/ui/layered-editor.spec.ts --workers=1 --trace=off`：Chromium 4/4 PASS。dot 用例先断言历史节点 hidden，再断言 visible；active/pending/final 的中心截图均为 RGB `[137,190,177]`，real 高压力轨迹的像素厚度超过低压力 8px 以上，constant 短笔亦可见。

Playwright 自带 ffmpeg 的实际命令：

```sh
~/.cache/ms-playwright/ffmpeg-1011/ffmpeg-linux -hide_banner -i test-results/layered-editor-dot-pressur-fa56f-ayed-handoff-remain-visible-chromium/video.webm -vf 'crop=2:2:62:94' -c:v png -f image2 test-results/handoff-final-%03d.png
```

将提取 PNG 用 `tests/ui/canvas2d-pen-pixel-helpers.ts` 的 `decodeRgbaPng` 逐帧解码：最终 5/5 用例这一轮的录屏为 800×450、25fps、4.92s 共 123 帧；首次墨色为第 20 帧，此后 104 帧 RGB 范围 `[137..139,189..189,177..177]`，相对截图每通道容差 12 内，空白或双深帧为 0。VP8 有压缩误差。这证明该次浏览器录帧未观察到空窗/双深，不排除 40ms 帧间的行为，不替代 WebKit/设备或未来跨桥 physical paint 验收。

首轮局部元素截图导致 Playwright 录屏临时切到裁剪坐标：完整帧仍有 dot，但固定坐标读到白色。已改用整页截图保持视频坐标稳定，未将这次取样假象认作产品修复。

可安排 tmux Dev Server 对 `/layered-editor` 做本轮增量验证。普通入口无诊断控件；测试使用 `?diagnostics=1`，可选 `&fixture=mixed` 与 `&handoffDelay=500`，诊断 hook 只在显式开启时提供 controller/render counters。

整个 change 尚不能整体验收：新入口缺导航辅助全能力接入，默认路由仍为旧编辑器，Skia/legacy 尚未退役，锁文件/CI/中文发布说明尚未迁移。WebKit 需要支持的系统环境；Web pen、iOS/Android 设备、Safari/WebView、长笔预算与真实 paint/keyboard 观察均未获得。内部节点 ACK、自动化合成 pen、录屏和静态 export 不替代这些证据。

## 图片补齐后的复核

- `pnpm exec jest --runInBand --testPathPattern 'layered-image-import'`：1 suite / 5 tests PASS，覆盖一次事务、内容顺序与 undo/redo、取消、切工具、文档版本过期、MIME 校验和解码失败。
- `pnpm test`：86 suites / 1467 tests PASS，四 projects；新增图片测试已由 `pnpm exec jest --listTests --runInBand` 收集。
- `pnpm test:ui tests/ui/layered-editor.spec.ts --workers=1 --trace=off`：Chromium 5/5 PASS，新增实际 PNG 文件解码、蓝色 SVG 像素、undo/redo 用例；未运行全量旧 UI suite。
- 图片接入首轮 typecheck/Bob 暴露 React 19 `useRef` 初值与 input `cancel` JSX 类型错误，已使用显式初值和原生 cancel listener 修复。紧随失败构建的 board typecheck 曾因声明产物未生成失败；最终检查在重新生成包后运行，结果见后续记录。
- 最终 `pnpm run typecheck`：exit 0。`pnpm run build`：两包 Bob 与 Expo Web export exit 0；小幅整理取消 callback 后 `pnpm run build:lib` exit 0，图片专项 1/5 再次 PASS。
- 最终 `pnpm run pack:dry`：exit 0；Android/iOS 静态导出复核均 exit 0，分别实际生成 290/270 modules 的 LayeredEditorDom bundle；依然不是设备启动证据。
- 最终 `pnpm exec eslint . -f json`：124 errors / 36 warnings，全部位于未修改文件；用 git changed/untracked 路径集合比对，本次文件 0 errors / 0 warnings。针对图片 hook/tests/UI 的 ESLint 命令亦 exit 0。
- `git diff --check`、`openspec validate layered-perfect-freehand-surface --strict`：exit 0。格式检查初次仅证据文档表格未对齐，已用 Prettier 修正；最终通过 Node `execFileSync` 将 git changed/untracked 非 lib 文件传给 `pnpm exec prettier --check`，exit 0，全部匹配文件格式通过。

## 交接状态

本轮从 15/44 推进为 27/45，新增 CI 任务 7.10 后剩余 18 项：3.3、5.5、5.6、6.1、6.3、6.4、6.5、6.6、6.7、7.1、7.2、7.3、7.5、7.6、7.7、7.8、7.9、7.10。已完成项均有本次命令结果；未获其全部证据的任务不勾选。

下一实施顺序是 ruler/virtual paper/minimap 接入（5.6），再完成默认入口迁移和审核后的 Skia/旧 change/锁文件清理（6.3–6.6），随后补齐 CI、中文发布说明和整体回归。环境缺口包括 Ubuntu 26.04 的 Playwright WebKit 不受支持，以及 Web pen、iOS/Android 真机、Safari/WebView 的输入/键盘/交接与长笔实测。6.7 的 `--no-open` 已不被当前 Expo 支持，等效启动方式仍待确认。

本轮无删除文件、无依赖/锁文件变更、无新分支/rebase/force-push。旧目录仍保留，未伪标完成。可对 `/layered-editor` 做增量验证；整个 change 保持实施中。
