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

## dfccc31 回归后：触摸焦点与颜色 Tab

Mac本轮确认IME取消残留已消失，重进Escape有效；工具/缩放/文字工具设置的1.5秒Tab有8/1/4次命令。原18项的关闭条件全部达成，但默认/PencilKit设置Tab都走radio→颜色→BODY、跳过range，完整遍历只有16/18，原可信度判定仍0/18。34次单键对应34个keydown（32 false / 2 true），无双发。

剩余失效已能从DOM侧解释：触摸radio/range完成值更新后只有旧控件focusout，没有新控件focusin；activeElement=BODY、请求/ack scope均空，桥对象仍存在。颜色Tab则已有真实可信WebKit keydown，随后默认遍历跳BODY；不是需要新增原生命令。

本轮只改iOS安装的DOM helper：

- radio/checkbox/range在pointerup或click后，用下一帧恢复被操作控件的真实focus，再由现有focusin/sync重新发布scope。支持label点击和range拖动无click的结束，不改触摸默认值、不逐点发送桥消息。新的pointerdown、click或键盘操作取消旧恢复；pointercancel、卸载、控件移除、页面隐藏、焦点转到文字或其他区域均不抢回。不是在BODY上保留旧scope。
- 只有带专用标记的设置颜色文字字段，其非组合态Tab/Shift+Tab取消默认焦点移动，沿与桥一致的tabbable顺序前进/后退。原KeyboardEvent继续冒泡，不创建第二个事件、不改isTrusted。微任务在面板观察到原焦点后移动，以保留离开关闭规则。Escape、字母、组合输入、外部文字编辑器仍走原路径。

本轮Swift、命令集合、既有scope/sequence及composition生命周期、LLDB探针均未改。真实触摸完成到首键之间的时序、可信颜色Tab是否到range、持续按住跨颜色字段是否继续仍需Mac实测，不能用浏览器或逐键结果推导长按。

## c21d53f 回归后：旧颜色焦点交出与连续 Tab

Mac 的 iPhone17 Pro / iOS26.5 **模拟器、idb脚本HID** 无探针结果：关闭和完整遍历均18/18，非编辑态触摸后紧接按键32/32；正式可信度判定仍0/18，44次单键对应44个keydown（42 false / 2 true）。颜色逐键双向Tab、HEX与Escape、快切文字首键、IME/PencilKit所测通过。另列的四组1.5秒长按均仅首个桥回调，进入颜色后停止；颜色焦点下range确实0.95→0.1、有pointerup/change且无cancel，600ms后仍颜色焦点、scope空。证据为issue附件 `HAM-175-c21d53f-ios-validation.md` / `HAM-175-c21d53f-ios-evidence.zip`。

新候选仅针对这两个边界：触摸恢复保存pointerdown时的颜色焦点及focus版本；完整pointerup后允许同面板、未发生新focusin的旧颜色字段让焦给实际操作控件，包含控件外抬起。新编辑焦点（包括同一颜色节点重新获焦）、新交互、取消和移除继续优先，拖动值不由恢复逻辑修改。

颜色字段保留同一panel scope，但宿主改为 **tabOnly**：仅Tab/Shift+Tab由UIKeyCommand处理，Escape/字符仍交给WebKit，composition和普通文字编辑器仍关闭全部命令。非编辑控件↔颜色不再卸载Tab或换scope，Swift复用同一批命令对象，避免一次按住期间切换重复键来源；没有重复定时器或额外raw presses转发。颜色Tab也将是桥的 **isTrusted=false**，保留原可信度判定；不能再预期该字段Tab一定是true。若WebKit仍投递可信Tab，既有颜色默认遍历修正继续消费原事件，不重发。

**必须重建安装新原生包**：`setToolbarKeyboardScope`现在含第二个Bool参数。只读snapshot新增 `tabOnly/acknowledgedTabOnly`；颜色应为同一非空scope且两项true，range应同scope且两项false，普通文字编辑器/composition应scope空。ack只证明Expo调用返回。原生payload附tabOnly，保持scope/sequence/accepted/error；原观察器及输入/判定脚本不变。

## 11893ba 回归后：兼容鼠标阶段再次失焦

Mac已真实重建安装 `11893ba48cc7d81678ad2db71b03bac9a02e659a`，Swift/API编译0 errors。环境仍为iPhone17 Pro / iOS26.5 **模拟器、idb脚本HID/触摸**，全程无LLDB。颜色焦点下range拖动12/12、双向持续Tab跨颜色8/8行为达成，松开后约1.5秒无补发。原矩阵行为18/18，44次单键对应44次原生命令/DOM keydown，全部false，正式0/18。全轮213次回调均sequence唯一、accepted=1/error=nil。

但radio/checkbox触摸交接回退24项：原32项为7项达成、24项失败、1项pointercancel；取消项另以完整滑块手势重做达成，原记录保留。700ms仍BODY/scope空、后续键无效，重启且仅保留原观察器也复现。`diagnosis-default-checkbox-nonediting-order.json`显示09:30:37.000 pointerup，37.001 focusin checkbox，37.002 mousedown→focusout→mouseup→click，37.007 input/change仍BODY；颜色→radio也同序。证据在issue附件 `HAM-175-11893ba-ios-validation.md` / `HAM-175-11893ba-ios-evidence.zip`。

本候选在released-click分支使用**原Touch记录**再次安排下一帧恢复，覆盖click默认动作结束后的状态。pointerup继续负责没有click的range拖动；同一手势的控件外祖先click也保留原origin/focusVersion。不会在click处重新采集编辑器身份，因此新进入的颜色/文字仍能阻止过期恢复；取消、移除、卸载检查继续生效。本轮产品改动仅在该DOM分支，Swift/原生API/长按命令路径沿用已构建版本。

新增radio、checkbox浏览器回归显式重放Mac的兼容事件顺序：先等待产品pointerup恢复完成，再模拟UIKit mousedown默认blur，最后click实际更新checked、产品再次恢复焦点/scope。Chromium本身不实现这段UIKit默认动作，fixture的失焦重放明确不是HID验收；不会手工focus控件使结果通过。两项在旧helper均失败于click后获焦断言，新候选通过，既有真实触摸range用例也通过。

## 候选的行为与限制

移除已证伪的 requestFocus / window.focus 路径。pnpm 补丁在 DomWKWebView 通过公开 UIKit `UIKeyCommand` 注册 Escape、Tab、Shift+Tab，在 DOM 面板持有非文字编辑焦点时启用；唯一编辑态例外是带专用标记的颜色字段，只保留Tab两向。命令有系统优先级，由 UIKit action 触发一次；不同时监听 raw presses 再复制一次。Android/Web 不安装原生桥。

DOM 通过 Expo action 提交随机 scope和tabOnly，原生回传 scope、单调 sequence、key、shiftKey、tabOnly、source=`ios-key-command`。DOM 检查当前面板、焦点、可见性、composition、scope、序号再分发 cancelable keydown；旧面板、普通文字编辑态、颜色中的Escape迟到回调被拒绝。启停跨异步桥串行化，并在卸载时关闭。桥不注册字母、Enter 或方向键。

**桥事件 `isTrusted=false`**，不修改这一属性。Escape 使用既有关闭/归还焦点处理；合成 Tab 没有浏览器默认行为，因此在未 preventDefault 且焦点未被处理器改变时，用 tabbable 的文档顺序移动焦点（包含隐藏/禁用过滤、radio组、正tabindex），原 ToolbarPanel 的 Tab 离开关闭逻辑继续生效。不环绕、不困焦点；到文档边缘 blur 后关闭面板。真实 WebKit 文字路径继续应为 `isTrusted=true`。

这不是已证明的修复。Mac 必须验证 WKContentView 响应链是否实际选中本 UIKeyCommand、有无重复可信/非可信事件、select 默认行为与按住重复、异步启停窗口是否吞掉刚进入文字框的首键。DOM 可以拒绝迟到回调，但无法把 UIKit 已消费的快捷键退回系统。若任何一项失败，保留失败结果，不能靠等待/改观察器掩盖。

## Mac 重建与验收（先无 LLDB）

1. 取 PR #46 分支 `agent/agent/16ee970f929f` 最新 head，记录完整 SHA、工作树、Xcode/系统版本、主程序/debug dylib 构建与安装哈希。执行 frozen install、准备库产物、prebuild / pod install、重建安装 development client；只刷新 Metro 不会安装新 Swift API。
2. 使用原 iPhone 17 Pro / iOS26.5 **模拟器**，默认入口、diagnostics关闭。沿用原 `drive.py` / `matrix.py` / `observe.js` / `metrics.js` 与 idb HID 命令，**不改断言或日志过滤、不由测试调用桥、不用 evaluate/dispatchEvent 代替 HID**。公开说明输入为脚本HID，不能写成实体键盘/真机验收。
3. 完全未附加 LLDB 时先运行原18项：工具/缩放/设置 × Escape/Tab/Shift+Tab × 默认/PencilKit。保存每行 open/result、DOM events、焦点、截图和原 matrix-summary。桥结果应如实为 isTrusted=false；原判定若要求可信而判失败，保留失败，不重写成绿。单独报告功能行为、可信度差异，不能把浏览器桥契约测试算作这18项。
4. 并行保存 app console 的 `[HAM175 keyboard]` 日志，含原生 UIKeyCommand payload、accepted 和 error。按 scope / sequence / UTC 与同一 HID 操作和原 DOM 事件对应：每次命令至多一个 keydown、不得混入测试注入。日志是原生 action 入口证据，单凭 source 字符串不证明实体硬件来源。
5. **本轮优先，默认/PencilKit × 画笔/矩形**：重跑原32项，重点是radio改值、已选radio、checkbox触摸后紧接Escape/Tab的24项回退；另测颜色→radio、label激活。保留pointerup→focusin→mousedown→focusout→click→再次focusin的原始顺序和scope/ack，click后应落实际操作控件、scope非空，随后单键有效。先做不加等待的按键操作，700ms快照仅用于解释失败，不轮询等待scope后才发键。
6. 保留已通过的12项颜色焦点下range真实拖动：从当前滑块改值，控件内/外抬起及立即按键；保存input/change、pointerup/cancel、焦点与scope/mode。不要先blur颜色，不把颜色可信Escape关闭算作range交接成功。对照非编辑态同手势。快切文字/画布、重新获焦颜色、pointercancel、移除/卸载不得被click后的迟到恢复抢回。
7. **真正持续按住Tab 1.5秒跨颜色**，使用原idb长按命令，另测Shift+Tab跨颜色及松开后重新按键。应由radio经过颜色、range、后续控件退出，不能以逐键代替。保存每次原生命令及DOM对应、scope不换、颜色阶段tabOnly=true、松开后的静默区间；不得有额外重复/双发。原生UIKeyCommand未提供repeat元数据，桥仍不伪造repeat/keyup。若只首个回调，完整记录失败，勿以JS计时补键。
8. 保留颜色逐键双向Tab、真实HEX输入和Escape：本版颜色Tab可能为桥的false，字符/Escape应可信且零桥命令；composition期间不接管Tab。复测快速菜单→文字a/Tab/Escape首键、英文/中文选词/完成/取消/一次撤销、未选词取消后重进Escape、横滚/软键盘/PencilKit、同进程前后台与重开首键。任何吞键、双发、编辑被抢均记失败；原18项判定与4.2/4.3不改。

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
