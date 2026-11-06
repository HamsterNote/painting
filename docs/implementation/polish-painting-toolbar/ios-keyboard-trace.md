# HAM-175 iOS 键盘：原生命令桥候选与低扰动取证

PR #46 保持 Draft，HAM-175 保持 blocked，4.2 / 4.3 不勾选。本轮选择授权的 **(b) 原生→DOM 转发桥**。这是待 Mac 重建的候选；本机没有 xcrun / Apple LLDB，没有 Swift 编译或原生通过结论。

## 选择依据

- `b50496f`：WKContentView 本已是 first responder，18项失败；补 `becomeFirstResponder` 无效。
- `bb06548`：编辑态 Tab / Escape 到 WK entry / proxy send / 可信 DOM；非编辑态只到 UIApplication / WK try，detach 后一致。
- `e1b939a`：hasFocus 前后都是 true；工具/缩放 `_tryToHandlePressesEvent:` false，设置 Escape began true / ended false；delegate / WK entry / proxy send 无命中。探针开启和 detach 后两套18项均失败。文字态 inputDelegate / asyncInputDelegate 为 `_UIKeyboardStateManager`、keyboard-required=true；菜单态 delegate=nil、keyboard-required=false。`window.focus()` 也被证伪。
- 先试验了页面 focus sink：Chromium 147 的透明裁剪 textarea / contenteditable 加 `aria-hidden=true`、`tabindex=-1`，确实收到可信 keydown，但 CDP AX 树仍包含 focused/editable 节点，`ignored=false`。inert / display:none / visibility:hidden 排除 AX 后又不能聚焦。见 [原始结果](focus-sink-chromium.json)，复现命令 `node scripts/ios/probe_focus_sink.mjs`。**证伪的是这些 sink 在 Chromium 下满足无障碍约束的能力，不是宣称做过 iOS sink 路由实验。** 不将一个辅助技术仍能看到的隐形编辑器放入产品。

## c2f8700 回归后：本轮具体修正

Mac 已重建 `c2f8700`，14项关闭/退出行为达成但因isTrusted=false仍判失败；设置Escape/Tab在默认和PencilKit下的4项另有行为失败。无重复键，快速菜单→文字a/Tab/Escape首键均可信且未走桥。本轮不修改可信度判定或spec，也不扩展原生命令集合。

两处故障有不同原因：

- 原始DOM日志在06:11:20.158开始第二次组合输入，06:11:25.690取消时只有focusout、没有compositionend。桥保存的文档级composing=true永久禁用了后续面板；从此重进Escape与1.5秒Tab的首个命令都没有。改为记录具体composition owner，移除或失焦后清除，仅当前编辑器仍受保护。后到的旧compositionend不会清掉另一个编辑器的状态。**不添加responder刷新或模拟重复定时器。**
- 设置打开就focus到SELECT，唤起UIKit选项菜单；Tab再focus到color，原生颜色选择器在约3ms内使DOM焦点变BODY。仅iOS桥宿主开启页面内picker模式：输入模式/压力/线型用radio组，颜色用可编辑的#RRGGBB字段，合法完整颜色才提交；无效草稿离焦恢复。自由取色环变成打开同一设置面板的按钮，Tab聚焦它不会打开系统色板。面板初始focus取radio组已选项，不跳到不可Tab的未选项。Web/Android默认保持原控件；能力和控制器更新语义保留。

颜色字段属于真实文字编辑器，桥在它获得focus时关闭，Tab/Escape预期由WebKit投递可信事件，离开到非编辑控件后恢复桥；这一往返须由Mac实测。单测的重复payload只覆盖桥状态，不代表系统长按/自动重复通过。

本轮Swift补丁和LLDB探针未改；Mac先前已成功编译c2f8700，不能据此代替新head的运行验证。若仍有丢键，可通过独立只读evaluate保存 `window.__paintingToolbarKeyboard?.snapshot()`：scope为DOM请求值、acknowledgedScope为Expo action已返回值、composingConnected和activeTag为即时读数。snapshot不修复/发布状态，不改原观察器。两个scope相同只证明配置调用返回，不证明UIKit命令已被查询。

## 候选的行为与限制

移除已证伪的 requestFocus / window.focus 路径。pnpm 补丁在 DomWKWebView 通过公开 UIKit `UIKeyCommand` 注册 Escape、Tab、Shift+Tab，只在 DOM 面板持有非文字编辑焦点时启用。命令有系统优先级，由 UIKit action 触发一次；不同时监听 raw presses 再复制一次。Android/Web 不安装原生桥。

DOM 通过 Expo action 提交随机 scope，原生回传 scope、单调 sequence、key、shiftKey、source=`ios-key-command`。DOM 检查当前面板、焦点、可见性、composition、scope、序号再分发 cancelable keydown；旧面板和编辑态的迟到回调被拒绝。启停跨异步桥串行化，并在卸载时关闭。桥不注册字母、Enter 或方向键。

**桥事件 `isTrusted=false`**，不修改这一属性。Escape 使用既有关闭/归还焦点处理；合成 Tab 没有浏览器默认行为，因此在未 preventDefault 且焦点未被处理器改变时，用 tabbable 的文档顺序移动焦点（包含隐藏/禁用过滤、radio组、正tabindex），原 ToolbarPanel 的 Tab 离开关闭逻辑继续生效。不环绕、不困焦点；到文档边缘 blur 后关闭面板。真实 WebKit 文字路径继续应为 `isTrusted=true`。

这不是已证明的修复。Mac 必须验证 WKContentView 响应链是否实际选中本 UIKeyCommand、有无重复可信/非可信事件、select 默认行为与按住重复、异步启停窗口是否吞掉刚进入文字框的首键。DOM 可以拒绝迟到回调，但无法把 UIKit 已消费的快捷键退回系统。若任何一项失败，保留失败结果，不能靠等待/改观察器掩盖。

## Mac 重建与验收（先无 LLDB）

1. 取 PR #46 分支 `agent/agent/16ee970f929f` 最新 head，记录完整 SHA、工作树、Xcode/系统版本、主程序/debug dylib 构建与安装哈希。执行 frozen install、准备库产物、prebuild / pod install、重建安装 development client；只刷新 Metro 不会安装新 Swift API。
2. 使用原 iPhone 17 Pro / iOS26.5 **模拟器**，默认入口、diagnostics关闭。沿用原 `drive.py` / `matrix.py` / `observe.js` / `metrics.js` 与 idb HID 命令，**不改断言或日志过滤、不由测试调用桥、不用 evaluate/dispatchEvent 代替 HID**。公开说明输入为脚本HID，不能写成实体键盘/真机验收。
3. 完全未附加 LLDB 时先运行原18项：工具/缩放/设置 × Escape/Tab/Shift+Tab × 默认/PencilKit。保存每行 open/result、DOM events、焦点、截图和原 matrix-summary。桥结果应如实为 isTrusted=false；原判定若要求可信而判失败，保留失败，不重写成绿。单独报告功能行为、可信度差异，不能把浏览器桥契约测试算作这18项。
4. 并行保存 app console 的 `[HAM175 keyboard]` 日志，含原生 UIKeyCommand payload、accepted 和 error。按 scope / sequence / UTC 与同一 HID 操作和原 DOM 事件对应：每次命令至多一个 keydown、不得混入测试注入。日志是原生 action 入口证据，单凭 source 字符串不证明实体硬件来源。
5. 优先复测两条已定位链路：取消尚未选词的IME草稿（允许没有compositionend）→真实触摸重进工具菜单→Escape；然后三个面板各按住Tab1.5秒。每组发键前保存独立snapshot，scope应重新启用。设置中逐步记录radio→颜色文字字段→不透明度的焦点、软键盘及原DOM可信度，颜色字段必须走WebKit真实编辑路径，不能由脚本调用receive补键；重新进入设置时也测非默认输入模式、画笔/形状两类。保留英文、中文IME选词、完成/取消/一次撤销、文字 Tab/Escape、横滚、软键盘布局、PencilKit点击。增加菜单→文字框快速切换后首键、开关/离开重进、同进程前后台首键与长按Tab检查。文字键仍应可信且不经过桥；若有吞键、双键、软键盘误弹，记录失败。

## 可选诊断：单键、薄探针、独立日志

只有需要解释失败时再 attach 本次 app 的准确 PID；**不等待或重试 WebContent 附加**（kernel hardened / 无get-task-allow）。先文字阳性与菜单同键各一次，不能用探针下矩阵替代无探针验收。

```text
(lldb) command script import /path/to/painting/scripts/ios/trace_keyboard.py
(lldb) ham175-start --role app --output /path/to/evidence/app-thin.jsonl
(lldb) ham175-mark text-tab
(lldb) continue
```

默认只读寄存器/栈，不执行 ObjC getter。保留 UIApplication receive/dispatch/action、responder presses、WK try、keyboard manager/delegate、WK entry/completion、proxy enqueue/send 等入口。只给 WK try 的 BOOL 安返回探针；completion handled 直接读寄存器。`keyCommands`、keyboard-required、async、PageClient 查询等高频入口须 `--verbose` 显式启用，均不挂返回探针。

上一版 regex discovery 包含内联位置，错误地把 `page.active/page.focused` 挪到 `updateActivityState/setCursor/updateBackingStoreDiscardableState` 等外层函数入口；这些标签的旧读数不能作 focus 证据。本版检查物理函数/符号名与目标模式，命中再检查名字、PC和非内联；拒绝项写入 inventory / `entry-rejected`，缺符号仍为 unavailable。

返回按线程、caller PC、入口 SP 对应；x86_64 计入 ret 弹栈。重复栈槽、栈已退出、超过5秒的返回记录会移除对应断点，并明确写 `return-unobserved` 和 reason、保留累计 discardedReturns；32个上限之外报告 return-unavailable。stop 也会将剩余项记录为 trace-stopped。**没有返回不能当成false；过期清理不是成功匹配。** 必须回传起止 inventory、pending/discarded/errors。匹配修复仅经过宿主测试，仍待 Apple LLDB 实测。

`e1b939a` 在文字 Escape 有观察扰动，detach 后才正常。因此 `--details` 改为只允许手动暂停快照，不再在任何 key hit/return 内执行 getter。需要时另开日志：

```text
(lldb) expression -l objective-c++ -- @import UIKit
(lldb) ham175-start --role app --output /path/to/evidence/app-snapshot.jsonl --details
(lldb) ham175-focus 0xWKContentViewAddress
```

使用刚采集的 WK try arguments[0] 实际十六进制地址替换占位符，勿用旧进程地址。快照读取 keyWindow/scene、focus item、WK 已有 inputDelegate/asyncInputDelegate 及 keyboard-required 等；不调用 singleton 初始化器。表达式使用唯一局部名、显式动态返回类型、250ms超时；失败保留原始错误。`scripts/ios/page_focus.js` 仍只读页面状态。快照与后续 HID 分开，不冒充事件期间状态。

```text
(lldb) ham175-status
(lldb) ham175-stop
(lldb) process detach
```

回传构建身份、完整无探针矩阵与原观察日志、app command日志、可选薄探针 JSONL/inventory、错误原文、detach后的文字Escape对照。原生矩阵通过前不完成 HAM-175，不勾4.2/4.3，不合并 Draft。
