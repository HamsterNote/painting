# HAM-175 iOS 键盘：原生命令桥候选与低扰动取证

**诊断已停止；修勾已选择A接受行为验收（2026-11-06）。** iOS宿主子项按行为通过，两条限制作为实现方式差异与平台限制记录，见[validation定稿](validation.md)。PR #46进入代码评审、不合并，4.2/4.3不勾选；不再追加取证或改代码。以下为原生桥及各轮诊断的历史记录，当时的Draft/blocked状态不覆盖当前结论，也不是新的执行请求。

已结束的[拼音Escape最后一轮有界实验](ios-pinyin-escape-final-round.md)未能确定内部终止层；现有方案下拼音颜色Escape仍不可达，不能称三条假设全部证伪。Mac已真实构建安装39fd473；本地Linux没有xcrun或新的Swift运行结论。

## 96625b6 回归后：拼音命令选择诊断候选

这版只增加默认关闭的原生路由记录与独立证据检查器，**尚未修复拼音 Escape**。不继续修改已放行的语言门控，不把未定位的命令选择故障写成修复。Mac在96625b6上实际重建通过，原18/32/12/8组和颜色label16/16均行为达成；拼音空闲/组合结束/先选拼音再新建scope仍6次无投递。英文同字段可信Escape正常。详见validation及issue附件。

已核对原始日志：默认拼音空闲在11:58:08.459Z的scope/ack非空，11:58:09.182687Z有`zh-Hans / marked=false / escapeBridge=true`，截至11:58:09.891Z仍零DOM事件。默认组合中在11:58:29.321Z的scope/ack都空、composing=true；真实Escape产生可信compositionend，随后新scope恢复。**DOM在compositionstart主动撤销命令是现有保护，不是组合残留；这条记录不能单独证明Swift marked gate有效。** 不为取证而在组合态保留命令。

`[HAM175 command-route]`是Debug构建的可选JSON日志。只有以`-HAM175KeyboardRouteTrace YES`启动进程才启用，每个WebView最多4096条，下一条明确记overflow。它不调用子响应者的keyCommands、不主动执行target/canPerformAction查询、不发送action、不设置focus；读公开的first responder、next链、输入法及marked状态，因此仍须做开启/关闭对照，不能宣称零扰动。

| stage                                                        | 实际观测边界                                                                                                                              |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| scope                                                        | Expo配置/导航清理后的scope和tabOnly；组合态与DOM snapshot对齐                                                                             |
| commands                                                     | 此WebView实际返回的Escape/Tab命令及从super得到的同键命令，含对象身份、selector、modifier和priority；空scope直接保留super路径，不记此stage |
| validate                                                     | 此WebView实际收到的toolbarKey/toolbarTab或颜色cancelOperation校验及原返回值                                                               |
| target                                                       | 此WebView实际收到的对应target查询与super原返回对象，绝不替换target                                                                        |
| action-enter                                                 | toolbarKey在任何guard之前的入口；与“JS成功回调才打印”的旧日志区分                                                                         |
| action-reject-context / action-reject-color / action-forward | action入口后的拒绝点或进入原JS转发路径；最终payload/accepted仍看原keyboard日志                                                            |

每行含owner/firstResponder对象身份、firstResponder的next链及ownerInChain、scope、tabOnly、language、marked（未知为null）、keyWindow、时间和traceSequence。命令记录只留Escape/Tab，不记输入字符。**super.keyCommands仅代表WKWebView继承实现，不是WKContentView/IME全部命令；target缺席也不证明UIKit没查询其他响应者。** 不凭祖先关系就断言该命令能被中文输入法选中。

### Mac执行用例：门控开、命令未执行不能算通过

1. frozen install后真实重建安装，保存源码SHA、Swift构建/安装哈希。先不带LLDB、以`-HAM175KeyboardRouteTrace NO`运行原18/32/12/8/16及快速菜单→文字首键、HEX/英文Escape/IME/PencilKit保留组。新版本未在Linux编译Swift。
2. 仅重启本任务App并开启诊断，不改原输入、observe、metrics、matrix脚本：

   ```sh
   xcrun simctl launch --terminate-running-process "$HAM175_SIMULATOR" "$HAM175_BUNDLE_ID" -HAM175KeyboardRouteTrace YES
   ```

   保存原始`log stream --style ndjson`输出及原actions.log。沿用96625b6附件的`color_routes.py`、`pinyin_fresh_entry.py`与原`state.py`只读snapshot。默认/PencilKit各做拼音合法HEX空闲、真实nihao组合中、实际选词结束、先选拼音再关闭重开新scope、英文同字段对照。真实HID Escape只发一次；不得调用toolbarKey、sendAction或DOM receive来模拟命令执行。组合中需保存发键前scope/ack为空及compositionend后的恢复，而不只保存Swift日志。

3. 每个用例保留`route-…-before-state.json`、`-after-state.json`、`-after.json`（原observation.events）、原生NDJSON和实际HID动作。追加检查命令示例：

   ```sh
   python3 scripts/ios/check_color_escape.py --evidence "$HAM175_EVIDENCE" --prefix route-default-pinyin-idle --native "$HAM175_EVIDENCE/native-keyboard.jsonl" --expect pinyin
   ```

   空闲/结束后/新scope使用`--expect pinyin`，组合取消用`--expect composing`，英文用`--expect english`。脚本只读文件；失败退出1，数据格式错误非零。门控开但零action/DOM保持失败，commands/validate/target命中不算投递；孤立false事件没有匹配payload也失败，重复事件失败。即使行为达成，结果也明确是`bridged-behavior-only`并保留isTrusted=false，**不修改原矩阵正式判定**。完整原始记录仍要人工对齐真实HID次数，检查器不证明输入来源。

   也可在**真实原生切到拼音并聚焦颜色字段后**执行新增单键回归入口；它复用原harness的只读snapshot/observer与idb，不修改任何原脚本，不自行聚焦、切语言或调用桥。默认/PencilKit、空闲/组合结束/新scope各用独立prefix：

   ```sh
   python3 scripts/ios/probe_color_escape_hid.py --harness "$HAM175_EVIDENCE" --udid "$HAM175_SIMULATOR" --prefix command-default-pinyin-idle --native "$HAM175_EVIDENCE/native-keyboard.jsonl" --expect pinyin
   ```

   它校验DOM准备状态后只发一次真实HID Escape，保存原格式before/after和检查结果；已有prefix拒绝覆盖。非macOS拒绝运行。语言/marked最终必须由对应原生日志证明，英文或缺少日志不能通过pinyin断言。若日志尚未完整落盘导致解析错误，只重跑离线check，勿再次发键覆盖现场。

4. 按scope、命令id和时间分段读数：返回Escape且owner在next链，但没有validate/target/action，只能说明尚未观测到此响应者的选择/调用；validate=false或target不符则看对应状态；action-enter存在则看guard和最终JS结果。不能从旧color-route或一条commands日志跳到“IME吞action”的结论。必须有scope启动记录、连续traceSequence、无overflow，才可讨论新日志中的缺席；日志溢出则重启短用例。
5. 若仍需确认系统选择了谁，仅在上述无LLDB复现后使用已有app侧`trace_keyboard.py`采UIApplication action/keyboard manager/delegate与寄存器调用栈，与相同时间的command-route对齐。无需等待WebContent附加；不在断点回调执行ObjC getter。随后关闭诊断重新启动并重做拼音失败及英文对照，单独保存结果，防止探针扰动文字Escape。

仓库`fixtures/color-escape-96625b6.json`是上述**真实Mac失败/组合取消记录的最小投影**，附原ZIP哈希，不含输入文字。8项Python离线回归防止将“中文门控放行却没命令”、英文代偿、仅查询成功或孤立合成事件误判为成功。它不是UIKit/中文IME执行测试；Linux没有此执行能力。对完整旧包运行检查，6个拼音失败保持失败，两种入口的组合取消和英文对照分别成立。下一版是否修复仍以Mac真实HID为准。

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

## 5e5be90 回归后：label命中、拼音Escape及键盘frame

最新Mac基线为 `5e5be90cb637e42655b947e1582fc102ea058a53`：iPhone17 Pro / iOS26.5模拟器、idb脚本HID/触摸、无LLDB，真实重建0 errors。行为18/18、触摸32/32、range12/12、双向持续Tab8/8且松开静默。44次单键对应44个命令/DOM keydown，全部false，正式仍0/18。

颜色→radio input/label16项仅14项完整达成。默认/矩形两个失败都先pointerup LABEL，再由helper失焦颜色、focus未选radio，随后兼容mousedown/click命中DIV、没有checked更新。新候选只将颜色→label的恢复延后到真实click；不改点位或合成激活，range/直接input仍保留pointerup恢复。固定坐标的浏览器重排fixture在旧代码命中背景、新代码命中label；原生逐帧几何尚待补齐。

拼音颜色Escape现场没有DOM事件，但composingConnected=false；英文同字段正常。颜色模式现在额外允许**原生确认中文输入法且无marked text**的Escape命令。公开UITextInput不可用、语言未知/非中文、markedText存在时均不走该例外；DOM同时拒绝当前composition/旧scope/新文字编辑器。保留原tabOnly字段作为颜色请求模式，实际例外由payload的colorEscape标记，事件仍false，英文Escape预期仍可信。

键盘遮挡现场是颜色重新获焦、原生键盘仍显示、DOM却已622全高。候选以原生frame通知与宿主窗口坐标约束高度，willHide不立即释放，did frame/hide确认后再扩展，避免仅依赖willShow/willHide。原现场没有native frame时间线，不能把此推断写成已确认根因。本轮必须收集新日志：

- App console：`[HAM175 color-route]`包含scope、language、marked和escapeBridge；只在状态变化时记录。`[HAM175 keyboard]` payload另有colorEscape/inputLanguage/markedText以及原sequence/tabOnly。未知读数是证据缺口，不能当成没有组合文本。
- RN/Metro console：`[HAM175 keyboard-frame]`包含Date.now、通知名称/endCoordinates；`[HAM175 keyboard-layout]`包含宿主窗口frame、当前键盘frame及maxHeight。只读诊断不写入文本或修复DOM。
- 与同一操作UTC下的原DOM事件/viewport、AX键盘可见性、截图对应。scope ack不代表UIKit路由，maxHeight计算也不代表画面已完成布局。

## 候选的行为与限制

移除已证伪的 requestFocus / window.focus 路径。pnpm 补丁在 DomWKWebView 通过公开 UIKit `UIKeyCommand` 注册 Escape、Tab、Shift+Tab，在 DOM 面板持有非文字编辑焦点时启用；唯一编辑态例外是带专用标记的颜色字段，保留Tab两向以及上述严格门控的中文空闲Escape。命令有系统优先级，由 UIKit action 触发一次；不同时监听 raw presses 再复制一次。Android/Web 不安装原生桥。

DOM 通过 Expo action 提交随机 scope和tabOnly，原生回传 scope、单调 sequence、key、shiftKey、tabOnly、source=`ios-key-command`。DOM 检查当前面板、焦点、可见性、composition、scope、序号再分发 cancelable keydown；旧面板、普通文字编辑态、没有colorEscape标记的颜色Escape回调被拒绝。启停跨异步桥串行化，并在卸载时关闭。桥不注册字母、Enter 或方向键。

**桥事件 `isTrusted=false`**，不修改这一属性。Escape 使用既有关闭/归还焦点处理；合成 Tab 没有浏览器默认行为，因此在未 preventDefault 且焦点未被处理器改变时，用 tabbable 的文档顺序移动焦点（包含隐藏/禁用过滤、radio组、正tabindex），原 ToolbarPanel 的 Tab 离开关闭逻辑继续生效。不环绕、不困焦点；到文档边缘 blur 后关闭面板。真实 WebKit 文字路径继续应为 `isTrusted=true`。

这不是已证明的修复。Mac 必须验证 WKContentView 响应链是否实际选中本 UIKeyCommand、有无重复可信/非可信事件、select 默认行为与按住重复、异步启停窗口是否吞掉刚进入文字框的首键。DOM 可以拒绝迟到回调，但无法把 UIKit 已消费的快捷键退回系统。若任何一项失败，保留失败结果，不能靠等待/改观察器掩盖。

## Mac 重建与验收（先无 LLDB）

1. 取 PR #46 分支 `agent/agent/16ee970f929f` 最新 head，记录完整 SHA、工作树、Xcode/系统版本、主程序/debug dylib 构建与安装哈希。执行 frozen install、准备库产物、prebuild / pod install、重建安装 development client；只刷新 Metro 不会安装新 Swift API。
2. 使用原 iPhone 17 Pro / iOS26.5 **模拟器**，默认入口、diagnostics关闭。沿用原 `drive.py` / `matrix.py` / `observe.js` / `metrics.js` 与 idb HID 命令，**不改断言或日志过滤、不由测试调用桥、不用 evaluate/dispatchEvent 代替 HID**。公开说明输入为脚本HID，不能写成实体键盘/真机验收。
3. 完全未附加 LLDB 时先运行原18项：工具/缩放/设置 × Escape/Tab/Shift+Tab × 默认/PencilKit。保存每行 open/result、DOM events、焦点、截图和原 matrix-summary。桥结果应如实为 isTrusted=false；原判定若要求可信而判失败，保留失败，不重写成绿。单独报告功能行为、可信度差异，不能把浏览器桥契约测试算作这18项。
4. 并行保存 app console 的 `[HAM175 keyboard]` 日志，含原生 UIKeyCommand payload、accepted 和 error。按 scope / sequence / UTC 与同一 HID 操作和原 DOM 事件对应：每次命令至多一个 keydown、不得混入测试注入。日志是原生 action 入口证据，单凭 source 字符串不证明实体硬件来源。
5. **本轮优先，默认/PencilKit × 画笔/矩形**：保留32项触摸，再跑颜色→已选radio input/未选radio label × Escape/Tab共16项，尤其默认/矩形label两项。固定本次手势坐标，记录pointerdown/up的label矩形、颜色失焦时点、兼容mousedown/click命中及checked真实变化，不能只看scope恢复。触摸后直接发键，不轮询等恢复；不能改点位、补click或强制checked来通过。需要逐帧几何时，在原矩阵结束后另行注入 `scripts/ios/trace_toolbar_handoff.js`，只记录低频事件/下一帧及resize的panel/label/control矩形，不读取文字、不修复状态。读取 `window.__ham175HandoffTrace.snapshot()` 导出，完成后调用 `.stop()`；重装会先移除自己旧的监听器。原observe.js仍原样保留。
6. 保留已通过的12项颜色焦点下range真实拖动：从当前滑块改值，控件内/外抬起及立即按键；保存input/change、pointerup/cancel、焦点与scope/mode。不要先blur颜色，不把颜色可信Escape关闭算作range交接成功。对照非编辑态同手势。快切文字/画布、重新获焦颜色、pointercancel、移除/卸载不得被click后的迟到恢复抢回。
7. **真正持续按住Tab 1.5秒跨颜色**，使用原idb长按命令，另测Shift+Tab跨颜色及松开后重新按键。应由radio经过颜色、range、后续控件退出，不能以逐键代替。保存每次原生命令及DOM对应、scope不换、颜色阶段tabOnly=true、松开后的静默区间；不得有额外重复/双发。原生UIKeyCommand未提供repeat元数据，桥仍不伪造repeat/keyup。若只首个回调，完整记录失败，勿以JS计时补键。
8. 拼音/英文颜色Escape做同字段对照：空闲合法HEX、中文候选组合中、提交/取消后再按。空闲中文且原生marked=false时预期1条colorEscape命令/1个false keydown并关闭；英文预期1个可信Escape、零桥命令。组合中/原生读数未知不得由桥关闭面板。保留color-route覆盖日志；没日志、getter不可用或没有命令都各自记为缺口，不根据键盘外观猜primaryLanguage。快速菜单→普通文字a/Tab/Escape首键、英文/中文选词/完成/取消/一次撤销、未选词取消后重进Escape继续回归。
9. PencilKit颜色→radio input/label→立即Tab回颜色，逐项对照原生键盘可见性、keyboard-frame通知、keyboard-layout宿主frame/maxHeight、DOM innerHeight/visualViewport及工具栏矩形。键盘仍盖住时不能因DOM已全高就按其坐标清理；保留截图/AX及原始输入后果。补键盘语言切换/高度变化、旋转/重排、完成收起及快速取消收起，验证工具栏始终可操作、无重复避让或编辑内容丢失。先收齐frame日志再判断具体事件顺序；不使用Keyboard.dismiss/responder强制切换掩盖。保留横滚、同进程前后台、重开首键、PencilKit点击。原18项判定与4.2/4.3不改。

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
