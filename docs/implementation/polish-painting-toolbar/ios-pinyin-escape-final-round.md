# HAM-175：拼音 Escape 最后一轮有界实验

**已执行并停止（39fd473，2026-11-06）；修勾已选择A接受行为验收。** 拼音结论仍为“内部终止层未定；现有方案下拼音Escape不可达”，作为已接受的平台限制记录，不能写“三条假设全部证伪”。iOS宿主子项行为通过、原始0/18及实现方式差异见[validation定稿](validation.md)。PR #46进入代码评审，4.2/4.3不勾选。本文以下为原实验计划的历史存档，当时的待决策/Draft/blocked状态不覆盖当前结论；不再追加取证或修改代码。

本轮只区分下面三条假设。一个原生构建、固定对照、一次交回结果；不继续调整语言/marked gate，不扩大到其他输入法或新修复路线。PR #46保持Draft、HAM-175保持blocked，4.2/4.3及spec不改。用户尚未决定是否接受isTrusted=false或拼音Escape限制。

## 已有事实与本轮变量

Mac已真实重建安装`f21a1ee`，Xcode27.2 / iPhone17 Pro / **iOS26.5模拟器、idb脚本HID**，0编译错误。关闭诊断的18/32/12/8组行为达成，44次矩阵HID对应44次命令/DOM事件，无重复，全部isTrusted=false，正式0/18。两入口各五态、诊断开关共20个窗口各只有一次Escape；六个非组合拼音窗口在两个开关状态都失败，组合取消及英文可信Escape成立。不能冒充真机/实体键盘验收。

已读原始`command-on-default-pinyin-idle-offline-check.json`：trace87–92是两次commands→validate(true)→target(WebView)，同一Escape命令priority=true；first responder为WKContentView，next链为WKContentView→WKScrollView→DomWKWebView→**DomWebView**。owner在链中不等于UIKit已经派发。action-enter/guard/payload/DOM全无，诊断1–1318连续、有35次action阳性对照、无overflow。

H2利用这个**既有DomWebView容器**，不插入视图/响应者，不换first responder。Debug启动参数`-HAM175EscapeCommandOwner`提供三个互斥模式：

| 值                                    | Escape归属                                                   | 用途                                          |
| ------------------------------------- | ------------------------------------------------------------ | --------------------------------------------- |
| `webview`（默认，未知值同样回落默认） | 原DomWKWebView                                               | 保留矩阵和A组                                 |
| `color-container`                     | 仅原门控已放行的非组合中文颜色Escape移到DomWebView，其余不动 | B组，只改变命令owner                          |
| `menu-container-control`              | 仅非编辑面板Escape移到DomWebView，颜色不动                   | 容器action的真实HID阳性对照，不能代替拼音测量 |

Release不启用实验。各模式沿用同一个UIKeyCommand对象及`toolbarKey:` selector、modifier、priority；被移走的Escape不再由WebView声明/认领，且只有该selector的target查询转交现有next链，容器通过canPerformAction校验并由super解析target。容器只有收到真实UIKit action才调用原WebView处理函数，仍经过foreground/scope/中文marked门控和DOM校验，只发一份原payload。Tab、组合态撤销scope、英文颜色Escape、普通文字及DOM触摸代码未改。

`command-route`沿用原schema，新增`containerExperiment`；容器记录的owner是DomWebView，`container-action-enter`区分真实容器action与随后原处理函数的`action-enter`。每个WebView共享traceSequence。不能主动调用这两个action作为阳性对照。

## 三条假设与app侧读数

| 假设                                       | 必须收集的读数                                                                                                                                                                      | 支持 / 排除条件                                                                                                                                                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H1：中文输入法在公开命令派发前消费Escape   | `UIKeyboardImpl handleKeyCommand:repeatOkay:beforePublicKeyCommands:`的真实入口、beforePublic参数与匹配的BOOL返回；`UIApplication sendAction:to:from:forEvent:`的sender/target/返回 | 相同单键窗口中beforePublic=true且返回true、无对应公开sendAction，支持此前消费。对应命令sender/target确实进入sendAction则排除“根本没进入公开派发”。只看到handleKeyEvent入口不能证明消费；私有符号/签名缺失不能当false。                           |
| H2：WKWebView作为target影响派发            | A/B的命令对象/selector/priority、实际owner链、validate/target；B的container-action-enter、原payload、DOM与关闭归还；单独容器阳性对照                                                | 只有B出现真实容器action、恰好1次投递/关闭，且A仍失败，支持owner相关路径。B返回同命令、validate=true、target确为容器、阳性对照有效，却与A同样无action，排除“只换到该公开容器即可修复”。若target没移成功或阳性对照失败，实验无效，不能判H2已排除。 |
| H3：WK `_tryToHandlePressesEvent:`先行消费 | 同一事件指针的WK try入口/匹配BOOL返回、UIApplication receive/dispatch、后续WK entry/completion和公开sendAction时序                                                                  | 对应began/ended路径返回true且其后无命令派发/DOM，支持WK先接管，但true本身不证明吞键根因；若同时H1命中需保留歧义。对应调用全返回false则排除此try分支的消费；未解析/未匹配返回不能作false，只有代理/异步入口也不能称已消费。                       |

H1与H3可能位于同一次调用链，不能把两次命中当作两个独立根因。优先看H1读数，再看H2单变量对照，用H3的真实返回约束解释。缺席判断必须有UIApplication接收、原HID操作记录、完整日志与阳性对照；查询次数不能代替键数。不同进程的指针不可比较。

## 一次Mac执行安排

只构建安装一次，保存实际SHA、Swift构建结果及安装哈希；构建失败就交回原文，本轮不在Mac改代码。先以`webview`且诊断NO、无LLDB执行原18/32/12/8保留组。任何行为回退先保存现场并停止实验，不改观察器或验收门槛。

测量窗口最多30个，每个只发一次真实HID Escape，不自动重试：

1. 无LLDB的A/B：两入口 × 拼音空闲/组合中/组合结束/先选拼音再新scope/英文同字段 × 两种owner，共20个窗口。A为webview，B为color-container，路由诊断YES。每次换模式重启任务App，保持同源码/已装二进制，另存PID/参数。用既有`probe_color_escape_hid.py`和原观察器采集，不调用DOM focus、receive、sendAction或action来伪造路径。
2. 阳性对照：menu-container-control模式，默认/PencilKit各打开非编辑面板发一次真实Escape，共2个窗口。须看到target=容器、container-action-enter、恰好1份payload/false DOM键及关闭归还。此结果只验证容器可调用。
3. 仅A/B仍不能明确定位时，做4个短LLDB窗口：默认入口A拼音空闲、B拼音空闲、A英文颜色、容器非编辑阳性对照。每次先准备好状态，再暂停安装下面的escape预设，继续后只发一次键，保存返回/inventory并stop/detach。不在每个回调执行ObjC getter，不等待WebContent附加。
4. 若用了LLDB，再在无LLDB、诊断NO下复查默认入口的A/B拼音空闲及A/B英文，共4个窗口。用例/结果受探针影响则以无探针结果为准，并将内部层级解释标为无法确定。

准备失败、符号缺失、日志截断或读取失败都记录“无有效读数”，不无限重做。解析问题只重跑离线检查，不重发测量键。30是上限，不是必须凑齐；H2已在无LLDB下形成有效成功对照时，可跳过后8个窗口。

启动示例（另一次进程用webview或menu-container-control替换值）：

```sh
xcrun simctl launch --terminate-running-process --console-pty "$HAM175_SIMULATOR" "$HAM175_BUNDLE_ID" -HAM175KeyboardRouteTrace YES -HAM175EscapeCommandOwner color-container
```

**保存console完整原文。** f21a1ee统一日志中的1440条route有1436条被截断，不能拿这种文件推断事件缺席。沿用该轮附件`normalize_console.py`的逐行校验方式生成`native-console-normalized.jsonl`，原文/行号和转换完整性同时保留；不更改产品观察器或`check_color_escape.py`的判定。拼音检查仍必须满足真实中文gate、投递和行为，isTrusted=false独立记录。

## 窄范围LLDB预设

先附加**任务App进程**并暂停，导入本head脚本：

```text
command script import /absolute/path/to/painting/scripts/ios/trace_keyboard.py
ham175-start --role escape --output /absolute/task/evidence/escape-a-pinyin.jsonl
ham175-mark A-pinyin-idle-before-real-HID
continue
```

键后暂停执行`ham175-status`、`ham175-stop`、detach。新文件每次独立创建，不覆盖旧结果。不要启用`--verbose`或`--details`。预设只含UIApplication receive/dispatch/action、UIKeyboardImpl precommand/handle入口、keyboard manager、WK try/entry/completion；无热keyCommands探针。

UIKeyboardImpl的私有方法名只是发现模式，不承诺iOS26.5存在。安装探针时在暂停状态读取该方法运行时编码，且只接受`BOOL/bool (self, _cmd, object, BOOL*, BOOL)`签名；签名不符或编译读取失败时保持entry-only，inventory明确`returnCoverage=unavailable`。不得从void或未知方法的寄存器猜handled。该元数据读取不获取输入法单例、不调用输入处理方法。

实际键期间仅读寄存器/栈：`keyboard.precommand`保存command地址和beforePublic；`application.action`保存sender/target/event地址，并记录匹配BOOL返回；WK try沿用物理入口、线程/栈校验的返回探针。将sender与原命令id、target与owner地址对应；若UIKit给了不同对象/转发包装，报告无法按对象建立对应，不自行补事件关联。`return-unobserved`、ABI缺失、过期/入口拒绝和错误数都随报告交回。

## 停止判据与交回格式

每条假设给出“支持 / 已排除 / 无法区分”，附具体文件、事件/command地址和匹配callSequence；交回A/B逐项表、原DOM与HID、原生console及转换校验、LLDB inventory/命中/返回、开关对照和保留组结果。不要把H2成功写成整单通过，也不要自动把实验模式改为产品默认。

**若三条假设全部证伪且有效A/B仍无action/DOM，则本轮判定「拼音 + 颜色字段下 UIKeyCommand 不可达」并停止。** 这个判定限定于已测iOS26.5模拟器、当前宿主、真实idb HID和这两种公开owner实现，不是对所有iOS版本/输入法的不可实现证明。

若H1或H3得到支持且两种owner都失败，也停止追加UIKeyCommand条件，按已测平台限制交回。若关键探针缺失或阳性对照失败，则写“本轮无法确定内部终止层；现有方案下拼音Escape仍不可达”，**不得把无法区分改写成全部证伪，也不再追加取证轮次**。接下来只有整理已有证据与限制；验收是否接受false事件、是否调整4.3范围由用户决定，未获决定前保持blocked。
