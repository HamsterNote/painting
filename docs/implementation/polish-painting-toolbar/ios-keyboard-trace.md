# HAM-175 iOS 键盘：页面 focus 候选与 app 侧取证

PR #46 保持 Draft，HAM-175 保持 blocked，4.2 / 4.3 不勾选。当前选择 **(a) 通过公开页面 focus API 恢复 WebKit 的正常键盘路径**，未启用原生→DOM 合成事件桥。是否有效必须由 Mac 的真实 HID / `isTrusted` 证据确认；本机没有 xcrun / Apple LLDB。

## 依据、候选和证伪条件

`b50496f` 的18项矩阵失败时，WKContentView 已是 first responder。`bb06548` 进一步确认：文字 Tab / Escape 命中 `handleKeyEntry:withCompletionHandler:` → `_internalHandleKeyWebEvent:` → `WebPageProxy::handleKeyboardEvent` / `sendKeyEvent`，DOM 可信；工具菜单同键命中 UIApplication 和 `_tryToHandlePressesEvent:`，上述 entry / proxy 没有命中，detach 后一致。

这定位到了非编辑态交接范围，尚未证明 `_tryToHandlePressesEvent:` 返回 false，也没有证明 UIKit keyboard input delegate / 页面 frame focus 正确。`bb06548` 的 `--details` 因短变量名 `d` 与内部符号冲突、动态 getter 未标注返回类型而编译失败。WebContent hardened 且无 get-task-allow，kernel 拒绝附加。**不再要求双进程阳性门槛，不等待或绕过该限制。**

本候选在现有 iOS DOM 控件 focusin / 非编辑控件 pointerdown 内同步执行 `doc.defaultView.focus()`，条件为页面可见、`document.hasFocus() === false`、没有正在编辑的元素。保持当前 activeElement，不调用 `.blur()`、隐藏输入框、private setter 或新的 `becomeFirstResponder`。重入保护避免 focus 通知递归；画布笔迹、文本/数字输入、select、contenteditable、隐藏页面不触发；Android/Web 不安装这一 iOS hook。原 Tab 离开关闭逻辑与 HID 验收断言不变。

依据是 [WebKit LocalDOMWindow::focus](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/LocalDOMWindow.cpp) 请求 `focusDocumentView()`，而 [WKContentView 的 first responder 路径](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/ios/WKContentViewInteraction.mm) 更新宿主响应者与活动状态。这是公开的 frame focus 补齐候选，不是已证实根因；上游 main 也不代表 Apple iOS 26.5 的精确版本。

**证伪条件**：若同一非编辑态样本的 `document.hasFocus()` 原本已为 true，候选按设计不会调用 focus；若从 false 恢复 true 后同键仍无 WebKit entry / 可信 DOM，则“补页面 frame focus 可恢复路由”这个候选失败。记录结果，不再添加同类调用。再结合 `_try` 返回、keyboard-required / async 状态、input delegate 与 keyWindow 判断是否推进授权的 (b)；本候选不自动切换 (b)，不伪造可信度。

## Mac 运行步骤

1. 取 PR #46 分支 `agent/agent/16ee970f929f` 最新 head，记录完整 SHA、工作树、Xcode / 系统版本和构建安装身份。按现有流程 frozen install、准备库产物、prebuild / pod install、重建安装 dev client。使用 iPhone 17 Pro / iOS 26.5 **模拟器**、默认入口、产品 diagnostics 关闭；不是实体键盘或真机验收。
2. 沿用附件的 `drive.py` / `matrix.py` / `observe.js` / `metrics.js` 及原 idb HID 命令，不改输入、事件监听和判过条件。通过原 Inspector 的只读 evaluate 通道执行 `scripts/ios/page_focus.js`，保存独立 `*-page-focus.json`。脚本只读 hasFocus / visibility / active 元素类型 / 页面 URL，不聚焦、不安装监听、不改原 DOM 日志。
3. **先不开探针**，做英文非组合输入文字框 Tab / Escape 与工具菜单同一单键的对照。每组在真实触摸打开/聚焦前、打开后、HID 按键后各取一次 page_focus 快照与原 open/result 证据；它是时间点读数，不冒充事件期间状态。勿用 `.focus()` / JS click 设置测试前置。文字 Tab 后须实际触摸重新聚焦 textarea 才发 Escape。
4. WebView 加载后 attach **本次 app 的准确 PID**，暂停。旧进程 PID、其他任务的 WebView 不能用于采样。替换示例路径；日志必须尚不存在。

```text
(lldb) command script import /path/to/painting/scripts/ios/trace_keyboard.py
(lldb) expression -l objective-c++ -- @import UIKit
(lldb) ham175-start --role app --output /path/to/evidence/app-details.jsonl --details
(lldb) ham175-mark english-text-ready
(lldb) continue
```

5. 重复文字 / 工具菜单单键对照并确认新读数有效。每次 HID 只发一个键，等待处理完成；保存全部按下/抬起和 Shift press，不用 `allPresses.anyObject`。用 UTC 窗口、event 地址 / timestamp、线程、`callSequence` 关联入口与返回，不能把累计文字日志算到菜单。定点暂停后可 `ham175-mark 场景名` / `ham175-status`，随后 continue；暂停会改变延迟，不用旧的47/55ms当门槛。
6. app 侧阳性成立后运行原18项矩阵：工具/缩放/设置 × Escape/Tab/Shift+Tab × 默认/PencilKit。**WebContent 无法附加不再阻止矩阵执行。** 候选无效仍记录真实失败和范围；未执行项写未验。保留文字/IME/完成/取消/一次撤销、横滚、PencilKit 点击最小回归。
7. 暂停并 stop / detach，然后重复文字和失败场景；若宣称修复，**完整矩阵必须也在无探针状态通过**。不把重启当作同进程前后台恢复。

```text
(lldb) ham175-stop
(lldb) process detach
```

## 新读数与限制

导入只注册命令，start 才启用。正则发现已加载方法后，在函数入口采样，避免序言覆盖参数寄存器。支持 arm64 / arm64e / x86_64；未知 ABI 拒绝运行。进程变化会停止本模块采样，必须另开日志；cleanup 只移除自己的入口和临时返回断点。

| 记录                                                    | 含义                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `application.receive/dispatch/action`                   | UIApplication 入口、event/type/timestamp、全部 press 的 HID code/phase/modifiers，以及实际发送的 command action                                                                                                                                                                                          |
| `responder.presses/commands`                            | 原方法 receiver 地址和调用栈；keyCommands 查询不等于选中 command。高频查询保持纯寄存器采样，避免 getter 延迟                                                                                                                                                                                             |
| `webkit.presses` 的 hit + return                        | `_tryToHandlePressesEvent:` 的真实 BOOL，`callSequence` 对应入口。true 表示该调用处理了 press，false 表示调用方可继续；false 不等于已到 DOM 入口                                                                                                                                                         |
| `webkit.keyboard-required/requires/async/ime` 的 return | 系统自然调用时的 BOOL。`--details` 的 `focus` 另读即时状态；两者来源不同，分别保留                                                                                                                                                                                                                       |
| `keyboard.manager/delegate`                             | 阳性栈中的 `_UIKeyboardStateManager handleKeyEvent:` / `UIKBInputDelegateManager handleKeyWebEvent:`，区分 UIKit 键盘管理器与 WK entry 交接                                                                                                                                                              |
| `webkit.completion.handled`                             | 直接读取 `_didHandleKeyEvent:eventWasHandled:` 参数寄存器，即便 getter 编译失败仍保留                                                                                                                                                                                                                    |
| `proxy.enqueue` 的 return / `proxy.send`                | 入队 BOOL 及发送入口；不代替 WebContent 接收证据                                                                                                                                                                                                                                                         |
| `focus`（WK try 入口与返回）                            | keyWindow、sceneActivationState、UIFocusSystem focusedItem 地址/类、可读取的 WKContentView 已持有的 inputDelegate / asyncInputDelegate 地址/类，以及 requiresKeyEvents / keyboard-required / async / focused-element 状态。delegate 可能是包装对象，地址不同不单独判错；focusedItem=nil 也不单独证明故障 |
| `page.focused/active` 的 return                         | app 侧 PageClient 自然查询的 BOOL（如果该版本有符号且命中）。DOM 页面状态由 page_focus.js 提供，不相互冒充                                                                                                                                                                                               |

返回探针使用 LLDB 展开的 caller PC，不手动解引用带 PAC 的 LR；核对线程与返回时 SP（x86_64 计入 ret 弹栈），读取 x0/rax 低字节，不改寄存器、返回值或控制流。同一调用点的嵌套调用不会消耗外层返回探针。异常展开/尾调用/缺符号可能导致缺失：`return-unavailable`、`pendingReturns`、error 都须保留，**无返回记录不能当成 false**。最多128个未匹配调用，达到上限明确报错；回传后 stop/start，不无限增加断点。

`--details` 已改用唯一前缀局部变量并显式转换动态 getter 返回类型，分别保留 `error` 与 `focusError`。表达式限制250ms、屏蔽递归断点，不记录输入文字。只读 WKContentView 已持有的 inputDelegate / asyncInputDelegate，不调用可能初始化键盘状态的 singleton accessor；`webkit.delegate-change` 记录系统原有 setter 的参数，探针不调用 setter。Mac 仍须验证 Apple 表达式兼容性。失败时先保存原始错误，stop 后另开不带 `--details` 的日志；**返回值与 handled 不依赖 getter**，可继续定位。

保存 start/end inventory 的 coverage 与 locations。`proxy.completion` 在 `bb06548` 未解析，不据零命中判丢失。WebContent 模式保留供受支持环境使用，本轮不附加、不改签名或系统权限、不等待它。必要的 app 符号清单：

```text
(lldb) image lookup -r -n 'WKContentView.*(presses|KeyWebEvent|KeyEntry|requiresKeyEvents|requiresKeyboard|AsyncInteractions)'
(lldb) image lookup -r -n 'UIKeyboardStateManager.*handleKeyEvent|UIKBInputDelegateManager.*handleKeyWebEvent'
(lldb) image lookup -r -n 'WebPageProxy::(handleKeyboardEvent|sendKeyEvent)|PageClientImpl::isView'
(lldb) image list -u -f
```

## 交回什么、如何判断

- 构建/安装 SHA 与版本；app JSONL、inventory / image UUID、原始 getter/return 错误、逐组 page_focus 快照、原 DOM/矩阵/open-result/截图证据，明确探针开/关与 UTC 窗口。
- 先回答 `_try` 返回 true 还是 false；false 时 keyboard-required / async / delegate / keyWindow 与文字阳性有何差异；UIKit keyboard manager / delegate 到哪层停止；页面 focus 候选有无补齐可观测缺口。
- 若非编辑态始终 hasFocus=true 且路由仍断，明确本次(a)候选无效。结合 app 读数决定后续授权的桥接方案，届时须如实记录 `isTrusted=false` 及 Tab 默认遍历等契约影响。
- 单键通过不代替18项矩阵；没有原生证据不勾4.3。`bb06548` 只有单键对照与非键盘最小回归，18行是 not_run；`b50496f` 才是18项全失败，不混用两个SHA。

本机检查：`python3 -B -m unittest discover -s scripts/ios -p 'test_*.py' -v` 验证探针宿主逻辑，不能证明 Apple getter 编译、Swift 或原生链路通过。最终结果回填 [validation.md](validation.md)。
