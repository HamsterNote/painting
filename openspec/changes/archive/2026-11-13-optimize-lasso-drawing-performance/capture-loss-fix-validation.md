# 松手选不中：捕获丢失修复

修勾的两份录制已经复现并定位故障：套索把 `lostpointercapture` 当作取消，先清除 owner，随后真正的 pointerup 被忽略。旧构建回放为4次成功、4次取消；修复后8次全部查询并提交，逐ID与原有 oracle 一致。PR #53仍为草稿，等待修勾在原设备复验；性能工作继续暂停。

产品修改仅在 `semanticWebAdapter.ts` 移除 lostpointercapture 的取消监听及清理。捕获变化只影响事件路由，owner 继续由 window/arbiter 接收 up/cancel；pointercancel、blur、hidden、pagehide、工具/模式切换、文档失效和销毁仍清理会话。正常 up 清除 owner 后释放捕获，迟到 lost/重复 up 不重复提交。几何算法、版本检查与拖动零查询保持原实现。

## 为什么会在 up 前释放

**可复现条件：按下鼠标并取得捕获后，在 mouseReleased 之前收到一次 buttons=0 的 mouseMoved。无需元素替换或应用调用 releasePointerCapture。** Chrome 156.0.8078.80 的 `PointerEventManager::SendMousePointerEvent` 在派发这种移动前调用 `ReleasePointerCapture` 和 `ProcessPendingPointerCapture`，因此先出现可信 lostpointercapture，随后才是无按键移动与 up。

源码证据：[Chromium 156.0.8078.80 pointer_event_manager.cc](https://chromium.googlesource.com/chromium/src/+/156.0.8078.80/third_party/blink/renderer/core/input/pointer_event_manager.cc#1140)，原文件随附件保存。代码注释说明这是处理鼠标在页面外松开的补偿路径，但实际条件只判断非伪造移动且 buttons=0，并不要求元素被卸载。

本轮用同一存活 host、捕获API调用栈及可信事件检查证明：buttons-zero 场景在丢失前只有一次 setPointerCapture，没有 release/transfer 调用，host身份未变且仍 connected。显式 release 和把捕获移交 body 也能触发同一个应用错误，分别独立验证。

**不能归因于156独有。** 相同输入在147.0.7727.15上也复现旧版失败；此前 harness 只发按下状态的移动，然后直接up，漏掉了无按键移动先到的分支。实测版本边界是上述147与156两个版本，未推断中间所有版本或Mac系统行为。用户原始记录的4次失败均为 lost→pressure=0的move→up，与该机制一致；原录制没有buttons及API调用栈，因此不能进一步断言其OS为何先产生这次移动，也不能仅凭标签surface证明当时元素身份。

## 验收原始输出

| 验证                                                                | 结果                                                                                  | 附件中的原始输出                                |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 单测先红后绿                                                        | 旧代码6项中5失败；修复后6/6。顺序互换、有序ID、重复up、取消/blur/hidden/unmount覆盖   | `unit-before.log`、`unit-final.log`             |
| 相关功能及几何回归                                                  | 5套件83项通过，含P2、共线、异步失效与semantic工具测试                                 | `unit-after.log`                                |
| headed Chrome156、真实CDP、正常up及提前显式释放/无按键移动/捕获转移 | 旧版后三项均取消且零查询；修复后四项均选中115，开始/完成/提交各1，cancel=0，拖动查询0 | `browser156-before/`、`browser156-after/`及日志 |
| 同条件147对照                                                       | 正常成功，其余三项同样触发旧版取消；不以此替代156验收                                 | `browser147-control/`及日志                     |
| 两份录制精确轨迹回放                                                | 原来的4次失败在旧构建再次失败；新构建8/8逐ID匹配oracle，开始/完成/提交各1，cancel=0   | `replay-before/`、`replay-after/`及日志         |
| 10,000条差分                                                        | seed245、100对象、10,000轨迹，零差异                                                  | `differential.log`                              |
| Chrome156真实触摸与中断                                             | 5/5：鼠标、触摸、取消、双指缩放、工具切换，下一次手势成功                             | `touch-ui156.log`                               |
| 静态检查与构建                                                      | typecheck、修改文件lint/format、库构建、production export、OpenSpec严格校验           | 对应命令日志                                    |

Chrome156为官方Chrome for Testing 156.0.8078.80 Linux64，下载来源及revision见 `browser-download.json`；ZIP SHA256 `b711c720f774be355197f32edf37e0651418ba036d92446ee2da19ac017540a7`。headed使用Xvfb，并非物理显示器或Mac Edge。这轮只判断功能，不将任何耗时当作有效性能成绩。

回放结果：

| 录制     | 手势 | 原结果          | 修复后命中数 | 与oracle有序ID比较 |
| -------- | ---- | --------------- | -----------: | ------------------ |
| 78872624 | 1    | 取消            |          116 | 相同               |
| 78872624 | 2    | 128             |          128 | 相同               |
| 78872624 | 3    | 取消，保留旧128 |           50 | 相同               |
| 384ec7d3 | 1    | 取消            |           97 | 相同               |
| 384ec7d3 | 2    | 66              |           66 | 相同               |
| 384ec7d3 | 3    | 69              |           69 | 相同               |
| 384ec7d3 | 4    | 74              |           74 | 相同               |
| 384ec7d3 | 5    | 取消，保留旧74  |           28 | 相同               |

回放保留全部记录的浮点/coalesced样本、viewport和原事件顺序，用DOM事件确保几何不被CDP重新采样；与可信浏览器捕获试验分开。78872624中间还有一次选择移动，已重放该操作恢复revision=1后再测试第三次套索。每次开始恢复记录中的原选区和工具，避免修好前一次失败后自动切换选择工具改变后续输入含义；原来4次成功的ID也与原录制逐项一致。完整expected/selected数组保留在JSON中。

初次156触摸回归的轮询复制了500笔完整文档，5秒轮询截止时仍返回旧选区，而截图与事件日志已显示选框及selection-submit。改为只读selection.length进行轮询后5项通过，未放宽断言或改产品；原失败输出保留为 `touch-ui156-initial.log`。首次构建与Jest并发触发生成目录扫描竞态，之后顺序执行通过；Xvfb启动和初版CDP按钮参数的探针错误不算产品证据，最终脚本验证可信捕获、元素身份及派发顺序。

## 其他工具核查

| 路径                                               | 结论                                                                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| freehandWebAdapter                                 | 已把捕获视作路由；继续由window结束会话，无需修改                                                      |
| semanticWebAdapter                                 | 当前套索、形状、擦除等共用该绑定；本次移除共同的错误取消入口，原工具取消测试通过                      |
| selectionGestureController / webInputAdapter       | 仍有lost→cancel等价写法；仓库内没有当前layered生产调用，web公开入口只导出freehand，不在本轮更改其契约 |
| viewportGestureController / rulerGestureController | 导航、标尺会话把捕获丢失视作取消；按要求保持现状，未顺手更改                                          |

## 复验入口和运行方式

修复版500笔入口：**http://192.168.0.145:6275/layered-editor?fixture=lasso&lassoCount=500&touchDraw=1**。6273/6274继续保存旧版用于复现，不是此次修复构建。修勾在原Mac Edge/鼠标上重复圈选确认；iPad手指/Pencil的手感与性能仍未验收。

6275提供本轮production export，已用相同资源完成上述156浏览器和8次录制检查。绑定0.0.0.0，tmux `ham245-capture-6275`；日志 `artifacts/research/lasso-capture/server.log`、`access.log`；停止命令 `tmux kill-session -t ham245-capture-6275`。无Multica环境声明，tmux尽力持续运行，不保证主机重启恢复。PID、提交和实际HTTP资源哈希在附件 `service.json`，维护路径不作为可点击交付文件。

复跑主要命令（先下载附件到脚本约定的raw目录；Chrome/Xvfb路径可用脚本环境变量覆盖）：

```sh
pnpm exec jest --runInBand --runTestsByPath packages/painting/src/__tests__/layered-lasso-capture.test.ts packages/painting/src/__tests__/layered-semantic-adapter.test.ts packages/painting/src/__tests__/core/layered-lasso-scheduling.test.ts packages/painting/src/__tests__/core/layered-lasso-compatibility.test.ts packages/painting/src/__tests__/core/layered-lasso-query.test.ts
LASSO_EXPECT_FIXED=1 node scripts/perf/lasso-capture-browser.mjs http://127.0.0.1:6275 artifacts/research/lasso-capture/recheck-native
LASSO_EXPECT_FIXED=1 node scripts/perf/lasso-recording-replay.mjs http://127.0.0.1:6275 artifacts/research/lasso-capture/recheck-recordings
pnpm exec esbuild scripts/perf/lasso-compatibility-differential.test.ts --bundle --platform=node --format=cjs --outfile=artifacts/research/lasso-capture/differential.cjs
node --test artifacts/research/lasso-capture/differential.cjs
LASSO_EXPORT_ROOT=artifacts/research/lasso-capture/site LASSO_CHROMIUM_EXECUTABLE=/path/to/chrome156 pnpm exec playwright test --config=playwright.lasso.config.ts --project=chromium tests/ui/lasso-touch-release.spec.ts
```
