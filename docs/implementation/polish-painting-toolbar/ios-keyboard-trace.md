# HAM-175 iOS 键盘分层诊断

这是 PR #46 的诊断候选，**没有声称修复原生键盘路由**。保持 Draft；终点仍是原生 18 项矩阵通过。产品代码沿用 Mac 已构建的 `b50496f`，包括已整合的 Tab 离开关闭处理；本轮不再增加 `becomeFirstResponder` 调用。`bf4611c` 的 Mac 验收记录已采纳至同一分支。

## 已知事实与待验证假设

2026-11-05，iPhone 17 Pro / iOS 26.5 **模拟器**、dev client 0.1.0(1)、idb 脚本 HID 输入：工具 / 缩放 / 设置 × Escape / Tab / Shift+Tab × PencilKit 关 / 开，18 项全部失败。84 条按下 / 抬起记录均有同一 WebView 的 WKContentView first responder；DOM 没有对应 keydown。文字框内同一路径产生可信 Tab / Escape，英文 / 系统拼音所测通过。完整事实见 [validation.md](validation.md) 的 Mac 回归节与 HAM-175 两个附件。

原 `native_trace.py` 只观察 UIApplication 的 `_handleKeyUIEvent:` / `sendEvent:` 和 `becomeFirstResponder`。调用栈证明焦点补丁运行，没有记录 presses、keyCommands、WebKit 键盘处理或跨进程接收，不能从这些日志判定具体断点。

WebKit 上游源码提供以下待核对路径（仅用于选择探针，**不代表 Apple iOS 26.5 二进制与当前上游相同**）：

- [WKContentViewInteraction.mm](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/ios/WKContentViewInteraction.mm)：`pressesBegan/Ended` → `_tryToHandlePressesEvent:` 检查 `_hidEvent`、first responder、编辑状态 / input peripheral；键盘回调经 `handleKeyWebEvent:` / `_internalHandleKeyWebEvent:` 或 BrowserEngineKit 的 `handleKeyEntry:withCompletionHandler:`。这些是不同分支，不能要求每个事件经过所有方法。
- [WebPageProxy.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/WebPageProxy.cpp)：`handleKeyboardEvent` 排队、`sendKeyEvent` 发送、`keyEventHandlingCompleted` 确认。入口命中不等于已经发送。
- [WebPage.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/WebProcess/WebPage/WebPage.cpp) / [WebFrame.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/WebProcess/WebPage/WebFrame.cpp)：`WebPage::keyEvent` → `WebFrame::handleKeyEvent` → `WebCore::EventHandler::keyEvent`，最后与既有 DOM capture 监听器对照。

优先区分 UIKit responder/command 分发、WebKit 非编辑态输入处理、UI 进程队列 / IPC、WebContent 接收 / DOM 分发。`_hidEvent` 为 nil、输入法接管、未收到发送确认都只是待观测的分支，尚无根因结论。

## Mac 操作步骤

1. 从 PR #46 的 `agent/agent/16ee970f929f` 取最新 head，记录完整 SHA 和干净工作树。按既有流程 frozen install、准备库产物、prebuild、pod install、**重建安装 Debug dev client**。保存 build/install SHA-256 与 Xcode、模拟器、Expo 版本。默认入口、产品 diagnostics 关闭。不要只刷新旧客户端。
2. 沿用原附件的 `drive.py` / `matrix.py` / `observe.js` 和 HID 输入命令、断言，另开一份证据目录。不要编辑这些脚本或其判过条件；新脚本仅增加原生观测。安装既有 DOM 监听器并读一次快照，确认连接的是当前 app / 页面。
3. WebView 加载完成后，用 LLDB attach 到**本次 app 的准确 PID**，暂停并导入下列模块。把示例路径替换为当前仓库 / 本轮证据目录；日志文件必须尚不存在，防止串入上一轮。

```text
(lldb) command script import /path/to/painting/scripts/ios/trace_keyboard.py
(lldb) expression -l objective-c++ -- @import UIKit
(lldb) ham175-start --role app --output /path/to/evidence/app-keyboard.jsonl --details
(lldb) ham175-mark cold-start-ready
(lldb) continue
```

导入只注册命令，`ham175-start` 才启用探针。它从已加载符号发现方法，在函数入口下断点，避免函数序言覆盖参数寄存器；支持 arm64 / arm64e 与 x86_64，不支持的 ABI 会拒绝运行。模块晚加载、页面 / 进程重建后需 stop，再 start 到新的日志文件；不会假装自动追踪另一个进程。

`--details` 在暂停点读取只读 ObjC getter：UIEvent 地址 / timestamp / type / `_hidEvent` 是否存在、**全部** press 的 HID keyCode / phase / modifiers，WKContentView 的实际类 / first responder / 视图祖先，以及 UIApplication 实际发送的 action / target / UIKeyCommand input。不记录文字输入内容。`keyCommands` 记录谁被查询及调用栈，**不会主动调用 getter、添加 command，也不声称查询等于选中或处理**；以 `application.action` 确认实际 action 分发。WebEvent 的 `webKeyCode` 与 UIPress 的 HID code 不保证同一编码，不能直接比较数值。

每个命中含 UTC / host monotonic 时间、PID、线程、序号、原始参数和最多 12 层栈。C++ 参数只保留原始寄存器，不按未知版本的对象布局解引用。表达式限制 250ms、屏蔽递归断点；失败记 `error`，不会记成事件未到。若 getter 不可用，先保存错误，再 stop / 另开日志去掉 `--details`，收纯寄存器与调用栈；不要为让日志好看而吞掉错误。

4. 检查 start 输出的 inventory，记录每个 probe 的实际 locations。至少核实 `application.dispatch`、`responder.presses`、`responder.commands`、`webkit.entry`、`proxy.enqueue` / `proxy.send`。`coverage: unavailable` 或 locations=0 表示**观测缺口**。私有方法可能被改名 / 内联 / 去符号；保存以下查找输出交回，不能把零命中写成产品丢事件：

```text
(lldb) image lookup -r -n 'WKContentView.*(presses|keyCommands|KeyWebEvent|KeyEntry|requiresKeyEvents)'
(lldb) image lookup -r -n 'WebPageProxy::(handleKeyboardEvent|sendKeyEvent|keyEventHandlingCompleted)'
(lldb) image list -u -f
```

5. 先用文字框发 **单个 Tab，再触摸重新聚焦文字框发单个 Escape**，记录可信 DOM 事件作阳性对照。然后打开工具菜单发同样的键，逐键操作并等待事件处理完毕，分别保存 open/result 快照及时间窗口；不能把累计日志中的文字事件算到菜单上。保留按下 / 抬起与 Shift press；不可只取 `allPresses.anyObject`，那会漏掉组合键。首轮只需要这两组来确定哪段缺日志，再扩到原 18 项矩阵。
6. 用 app 日志里的 Expo DomWKWebView 地址核实所属 WebContent PID。在 app 暂停时，可读取已有对象的只读私有 PID getter（先确认 selector 存在），或用现有 Web Inspector 的进程映射。不要直接选择进程列表中第一个 WebContent：

```text
(lldb) expression -l objective-c++ -- (BOOL)[(id)0xWEBVIEW respondsToSelector:@selector(_webProcessIdentifier)]
(lldb) expression -l objective-c++ -- (int)[(id)0xWEBVIEW _webProcessIdentifier]
```

保存地址 → PID 映射，在**另一个 LLDB 会话** attach 这个 PID，WebView app 会话保持运行。WebContent 会话：

```text
(lldb) command script import /path/to/painting/scripts/ios/trace_keyboard.py
(lldb) ham175-start --role webcontent --output /path/to/evidence/webcontent-keyboard.jsonl
(lldb) ham175-mark paired-process-ready
(lldb) continue
```

在两个进程探针都挂好后，再做文字阳性对照和工具菜单单键对照。`WebCore::EventDispatcher::dispatchEvent` 是通用分发点，命中可能来自 focus / pointer / timer；**只有同一线程栈包含 keyEvent 的命中才能归入同步键盘分发**，最终仍以既有 DOM 记录器的 `isTrusted` 为准。WebContent attach 被系统拒绝或 WebCore 符号不存在时，完整保留错误 / inventory，明确该段未观测，不把 UI 进程发送端当成 WebContent 已收到。

7. 每组前后可暂停、`ham175-mark 场景名`、`ham175-status` 后 continue。分组标记需与原矩阵的 open/result UTC 窗口对应；暂停会延迟事件，不用 47/55ms 作为成功门槛。记录 instrumented 的完整矩阵后，在**两个会话**分别暂停并结束：

```text
(lldb) ham175-stop
(lldb) process detach
```

stop 写入最终 inventory / 命中数 / 错误数并只删除本模块创建的断点，不删其他断点。Detach 后继续用原脚本复验失败场景与文字阳性对照，保留无探针结果排除观测时序影响。不要在回归过程中终止并重启 app 来充当前后台恢复。

## 每一段日志回答什么

| 对照结果（符号已解析、阳性对照证明观测有效）                                    | 下一步定位范围                                                                                                                 |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| UIApplication 有事件，WKContentView 无 presses / keyboard entry                 | UIKit responder / command / gesture 路由；检查继承的 UIResponder presses 命中的 receiver 类与 action target，不据此断言是 Expo |
| WK presses 到达，`_tryToHandlePressesEvent` 有入口，但 WebKit keyboard entry 无 | 对照 `_hidEvent`、编辑态 / 非编辑态、keyCommands 查询和 action；入口命中不提供 `_try` 的返回值，必要时再做针对该分支的单步     |
| keyboard entry 有，proxy enqueue 无                                             | WebKit 输入法 / internal handler 分支；检查 `webkit.ime`、实际栈与 completion 的 handled 值                                    |
| proxy enqueue 有，send 无                                                       | 队列等待 / 页面状态；对照先前 completion，不能声称 IPC 已发出                                                                  |
| proxy send 有，正确 WebContent PID 的 receive 无                                | 发送 / IPC / 进程或 frame 生命周期；确认 PID 没换、对应点阳性命中过后再定位                                                    |
| WebContent receive / frame / WebCore key 有，DOM 无                             | WebCore 到目标文档 / frame 的分发；核对 DOM 记录器页面身份与同步 dispatch 栈                                                   |
| 任一必需点 unavailable，getter 报错，或阳性对照也不命中                         | 诊断覆盖不足；回传错误和符号列表，不给该边界通过 / 失败结论                                                                    |

路径存在分支：编辑态未必经过 `pressesBegan`，非编辑态也未必走 `keyCommands`。缺少某个可选入口不能单独当成失败。上述表是缩小范围的依据，不是自动判绿的测试。

## 必须回传

- 完整构建 SHA、build/install 身份、系统和设备型号，明确 **模拟器 / idb 脚本输入**。
- app / WebContent JSONL，start/end inventory、未解析的符号查找、对应 image UUID 列表、WebView 地址 → WebContent PID 映射；未能 attach 的原始错误。
- 原有 `native-events.jsonl`、`dom-events-all.json`、18 项 `matrix-summary.json`、open/result 快照和截图，不修改输入或判定脚本。标出文字阳性与非编辑态每次按键的 UTC 窗口和探针开 / 关状态。
- 文字 / IME / 提交 / 取消 / 撤销、横滚、PencilKit 所测操作的回归结果；未操作项记未验。

本轮 Linux 只检查 Python 逻辑和仓库自动化；没有 xcrun、Swift 编译、LLDB/Apple 私有符号运行或新的模拟器结论。4.2 / 4.3 保持未勾选。
