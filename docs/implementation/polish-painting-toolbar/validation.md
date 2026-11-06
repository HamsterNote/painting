# 工具栏验证

## HAM-175 收口定稿：已采用A，iOS宿主子项行为通过

修勾于2026-11-06在本单评论`01a1b164-b31a-746c-8d2f-10db6d9c4efc`选择 **A：接受行为验收**。4.3的本次iOS宿主子项按行为通过记录：弹层关闭、焦点归还及完整遍历18/18，触摸交接32/32，颜色焦点下range拖动12/12，双向长按Tab跨颜色8/8且松开无补发。原生桥事件`isTrusted=false`作为已接受的实现方式差异，拼音输入法＋颜色字段Escape在现有UIKeyCommand方案下不可达、内部终止层未定作为已接受的平台限制；二者不列为本次A口径的未满足项。

有界诊断已结束，不追加取证、不再修改产品代码。PR #46进入代码评审，不合并；4.2/4.3仍未勾选，spec未改。4.2仍需实体笔验收，4.3的整体勾选留给修勾在HAM-164决定，本次子项行为通过不表示完整4.3或真机验收通过。

统一原生证据口径：**iOS 26.5模拟器 / idb脚本输入 / 非真机**。具体为iPhone17 Pro模拟器、当前Expo DOM宿主及默认/PencilKit入口；不是实体键盘或真实Apple Pencil验收，不外推其他iOS版本、真机或Android。最后一次Mac实测源码为`39fd473e1822b9068dec060c159ee2946bbcd003`，Mac arm64 / Xcode27.2一次原生构建安装成功，188.107秒、0编译错误，主程序/debug dylib构建与安装哈希一致。本次采用A仅修改文档；最终head的Linux单测、类型、构建、UI及依赖/格式检查结果记录在PR #46描述中，不替代原生证据。

### 已达成行为与保留的原始判定

下表均来自该SHA在无LLDB、诊断关闭、默认webview owner下的保留组；未放宽原输入、观察器或判定。

| 范围                                                                               | 行为结果    | 原始证据文件（本单最终ZIP内）                           |
| ---------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------- |
| 默认/PencilKit × 工具、缩放、设置 × Escape/Tab/Shift+Tab；关闭、焦点归还、完整遍历 | 18/18       | baseline-summary.json、matrix-summary.json及逐步DOM记录 |
| 触摸激活后直接发首键；实际改选、焦点、scope/ack及按键效果                          | 32/32       | touch-summary.json及原始触摸/state记录                  |
| 颜色焦点下真实range拖动；pointerup/change、拖后焦点与紧接按键                      | 12/12       | boundary-summary.json及原始拖动记录                     |
| 真正双向持续按住Tab 1.5秒跨颜色；松开后约1.48–1.51秒静默                           | 8/8，无补发 | boundary-summary.json及长按/释放记录                    |

**原18项矩阵的原始正式判定保留为0/18，唯一失败原因是桥事件`isTrusted=false`。** 该矩阵44次HID对应44次原生投递和44个false DOM keydown，无重复；整个保留阶段184次命令包含准备和其他组，不能替代矩阵键数。这个“唯一原因”仅指原18项矩阵；追加的拼音颜色Escape原始读数为无投递/不关闭，不可归为仅可信度问题。选择A后按行为通过并记录两条已知限制，不改写原始结果或原检查器。

### 已接受的实现方式差异：原生桥事件的可信度

在已测宿主的非编辑态，真实脚本HID到达UIApplication/WK处理路径，但WebKit没有向DOM投递keydown。公开UIKeyCommand接管后，经JS桥创建的KeyboardEvent按平台语义为`isTrusted=false`；桥行为达成并不使事件成为WebKit可信事件。没有覆盖isTrusted、伪装来源或修改原观察器/矩阵来通过判定。

三个焦点方向均未形成满足本单约束的方案，但证据范围必须区分：`becomeFirstResponder`（b50496f）和页面`window.focus()`（e1b939a）在**iOS模拟器原生重建回归**中无效；页面focus sink的透明textarea/contenteditable实验在**Chromium 147**里虽有可信键，却仍暴露focused/editable AX节点，`aria-hidden`/tabindex=-1不满足无障碍约束，见[原始记录](focus-sink-chromium.json)。不存在这第三条的iOS实测证据，不能写成“三套焦点方案均已实机排除”；这些记录更不代表真机结论。

### 已接受的平台限制：拼音颜色Escape仍不可达，内部终止层未定

最后一轮A/B共20个有效单键窗口：12个非组合拼音窗口均无原生投递/DOM Escape，颜色焦点和面板保持；4个组合取消、4个英文同字段可信Escape对照成立。中文gate已放行、marked=false、scope/ack一致；B的validate=true、target确实移到既有DomWebView容器，行为仍未改善。关闭探针后的A/B拼音空闲仍失败，英文对照正常。

固定30个预留窗口中25个有单键前后证据且各一次HID，5个测量前失效、未重发。两项无LLDB容器阳性对照因Inspector EOFError失效；三个颜色短探针安装超时，H1私有ABI和拼音H3匹配返回缺失。非编辑容器短探针虽有sendAction=true、两次WK try=false和关闭归还，但完整action console缺失，accepted payload晚于after快照，原检查器失败仍保留。因此H1（输入法前置消费）/H3（WK try先消费）无法区分，H2（WKWebView命令owner影响派发）不作严格排除；**不能写“三条假设全部证伪”或已证明某个UIKit内部根因**。

按停止条件结束取证。不可达结论仅限已测iOS 26.5模拟器、当前宿主、idb脚本输入及现有两种owner方案；不是对全部iOS/WKWebView能力的不可实现证明。实验开关保持既有默认，不推广容器方案。

### 验收材料索引与未覆盖范围

本单Mac最终评论`01a1b148-d071-76b4-9917-c9e7f606cb0f`的三份附件是收口依据：

- `HAM-175-39fd473-ios-validation.md`：构建身份、保留组、30窗口账本、H1/H2/H3边界和停止结论。
- `HAM-175-39fd473-ios-evidence.zip`：原始HID/DOM、完整已保存console及投影校验、LLDB inventory/返回/超时、window-ledger.json、single-key-audit.json、command-summary.json。不要凭截断的统一日志或不完整的LLDB段推断缺席。
- `HAM-175-39fd473-package-proof.json`：Mac报告包内1566文件，CRC/逐字节校验通过；ZIP SHA-256为`742e66eb8046fcc94bf1f68f2b30eb1cfe07ad37675109779dba3ec32ad1a654`。

前轮证据用于解释方案来源，不拼接为本SHA新通过项；例如96625b6的label16/16、文字编辑回归及键盘稳定遮挡结果并未全部在39fd473重跑。真机/实体键盘、真实Apple Pencil压感倾斜和跨边界、完整VoiceOver、其他机型/系统、4.3的Android及完整设备验收不由本单模拟器结果覆盖。原[有界计划](ios-pinyin-escape-final-round.md)和[诊断记录](ios-keyboard-trace.md)均已转为历史资料，不再作为下一轮执行请求。

### 已采用的A收口措辞

> 4.3的本次iOS宿主子项按行为通过记录：接受iOS 26.5模拟器、idb脚本输入下弹层关闭/焦点归还/遍历18/18、触摸交接32/32、range拖动12/12、双向长按8/8的行为结果；原生桥事件isTrusted=false与拼音输入法＋颜色字段Escape在现有UIKeyCommand方案下不可达、内部终止层未定，分别作为已接受的实现方式差异与平台限制并列记录，不列为本次未满足项。保留原矩阵0/18及全部未覆盖项，不表示真机或完整4.3通过；4.2/4.3仍未勾选，整体4.3由修勾在HAM-164决定。

## 历史验证记录

以下保留各轮当时的备选口径、实现、待验计划和结果；“待选择/保持Draft/blocked/本轮/新候选/待Mac重建”等历史措辞不覆盖上面的A验收结论，也不构成继续取证或改代码的授权。

### e7b0c69收口备选记录（选择A之前）

以上证据、两条限制、输入口径和未覆盖范围是共同记录；以下A/B仅替换决策段，不改变历史结果、原0/18判定或任务勾选。**还差修勾一句话：选择A“接受行为验收＋两条已知限制”，或选择B“按平台限制降级记录”。** 当前没有代为选择，也没有新的Mac取证任务等待执行。

**A：修勾接受行为验收时采用（待确认）**

> 4.3的本次iOS宿主子项按已测行为及已知限制记录：接受iOS 26.5模拟器、idb脚本输入下18/32/12/8的行为达成，同时接受原生桥事件isTrusted=false，以及拼音输入法＋颜色字段的Escape在现有UIKeyCommand方案下不可达、内部终止层未定。此口径保留原矩阵0/18及全部未覆盖项，不表示真机或完整4.3通过；4.2/4.3仍未勾选。

**B：修勾选择降级时采用（待确认）**

> 4.3的本次iOS宿主子项按平台限制降级记录：保留iOS 26.5模拟器、idb脚本输入下18/32/12/8的行为证据，将原生桥事件isTrusted=false，以及拼音输入法＋颜色字段的Escape在现有UIKeyCommand方案下不可达、内部终止层未定列为未满足项，不据此承诺完整键盘支持。此口径保留原矩阵0/18及全部未覆盖项，不表示真机或完整4.3通过；4.2/4.3仍未勾选。

对应 HAM-156 / OpenSpec change `polish-painting-toolbar` / PR #44。本轮在同一 change 和分支落实已采纳的第四轮三条验收意见，先更新 spec/design 并严格校验后实施。

2026-11-04用户验收后已同步主规格并归档，任务仍为14/16；归档位置、校验及实机待验说明见 [归档记录](archive-verification.md)。以下保留实施阶段的验证结果。

## 行为与实现

- `PaintingBoard` 在自身定位上下文内承载底部悬浮工具栏；空白覆盖区域透传，真实控件与面板保留输入安全边界。
- 八种工具在统一菜单中，画笔首位；设置、选择、橡皮擦、套索、移动、清空画布为独立组。套索有效完成命中后自动切selection，保留选区，可直接拖动；空/退化路径、取消、失效不切换。保留全部十二工具、输入模式、导航和独立笔刷/形状参数。工具菜单后新增独立笔宽组，64×44px数值输入，0.5–200/步长0.5，设置中删除笔宽；工具族、外部更新、对象快照、撤销重做及JSON重载沿用原控制器语义。
- 比例入口固定72px并使用等宽数字，100/125/200%及25/800%在1280/390/320px下入口/胶囊/scrollWidth与后续组坐标完全不变。缩放使用25–800%滑动条和百分比读数；按当前绘图表面与visual viewport交集中心提交现有transform命令，同时更新scale/tx/ty；带最新revision，拒绝后恢复权威值，不补执行。
- 收起/展开按钮为胶囊上方独立44px圆形按钮，不参与横向滚动；收起隐藏胶囊与面板，恢复焦点与设置，不写入文档、历史或输入偏好。
- 黑色最左、新编辑器默认黑色；不覆盖现有编辑器快照。24px色面之间留白约6.67px（原20px的1/3），命中区域约30.67×44px且不重叠；其他按钮至少44×44px。
- 最右自由取色环使用原生颜色输入，多色内部，仅非预设自定义色激活时显示当前色外轮廓；预设项激活环与本色一致，两者互斥；预设/自定义颜色仅更新当前支持的工具族，不重涂对象。
- 擦除拖尾是独立、事件透传的SVG瞬时层；12px淡紫圆头短段按采样时间线性渐隐，2000ms完全移除，后续采样不延长旧段寿命，跟随原viewport矩阵。CSS动画和一次性到期计时器，无RAF或空闲循环；切工具、清空、撤销/重做、取消、失焦/隐藏/离页、卸载即清理节点和计时器，不进入文档/preview/history。清空进行中的擦除后，迟到move/up也不能重建拖尾或重复提交。
- 清空通过已有对象事务一次删除全部对象，一次撤销可全部恢复，重做再次清空；空画布禁用，活动书写/版本冲突遵循控制器拒绝。
- 旧识别入口与固定功能及相应规格条目已移除。未新增生产依赖、文档模型或原生桥变更；组件库转Expo仍不在本次范围。
- 独立 `Toolbar` 默认inline、可选floating；`toolbar={false}` 有效。实现可用于Web/Expo DOM/WebView，不能直接渲染到原生RN View。

## 自动化验证

环境：Linux，Node 24.15.0，pnpm 10.28.2，Playwright 1.59.1 / Chromium 147.0.7727.15。本机浏览器安装使用Ubuntu24.04兼容构建。

| 命令                                                 | 结果                                         |
| ---------------------------------------------------- | -------------------------------------------- |
| `pnpm run test`                                      | 97套件、1316项通过；responder依赖回归9项通过 |
| `pnpm run typecheck`                                 | painting、painting-board、playground通过     |
| `pnpm run lint`                                      | 0 errors，已有32 warnings                    |
| `pnpm run build`                                     | 库构建与Expo Web export通过                  |
| `pnpm run test:ui --workers=4 --shard=1/2`           | 109项通过，0失败                             |
| `pnpm run test:ui --workers=4 --shard=2/2`           | 90项通过，0失败                              |
| `openspec validate polish-painting-toolbar --strict` | 通过                                         |

两分片合计199项完整通过，无跳过或重试。本轮新增6项UI回归覆盖定宽、首层笔宽与擦除拖尾。新版工具栏专项新增实际拖动滑动条回归：非1倍/平移、嵌入偏移、窗口尺寸改变与部分可视区域下，中心世界点投影误差小于10⁻⁶ CSS px；同时检查已保存笔迹包围盒中心保持在0.5px内（点状轮廓有亚像素近似误差）。预设/自定义激活环互斥与跨工具族验证通过。保留六档宽度、键盘/焦点、30笔及跨工具栏笔事件等回归。

本轮9张新截图包含主栏笔宽、100%/125%/200%定宽对照、擦除拖尾起始/约0.9秒中间帧/2秒后消失、设置中无笔宽、窄屏笔宽与设置；通过issue附件交付。截图已目视核对，局域网页面HTTP200及实际操作验证通过。tmux服务会话/日志/停止方式在issue交接。

## 实机待验

无已连接的iPad Safari、iOS或Android Expo DOM实机；OpenSpec任务4.2/4.3保持未勾选，不以Chromium/CDP结果代替：

- iPad Safari实体笔：30笔快速短笔、跨工具栏边界、无原生选词、后续首击、中文IME及系统取色器。
- iOS/Android Expo DOM：安全区、横滚、系统软键盘、弹层和焦点。
- 显式启用iOS PencilKit原型：原生覆盖层不吞工具栏。

## HAM-164 设备发现与 HAM-167 修复（2026-11-04）

原始设备侧基线为 `e97f9fe`。以下记录来源为 HAM-164 的 Mac 操作员评论与附件 `HAM-164-device-validation.md` / `HAM-164-evidence.zip`（13 张截图、AX 摘录、崩溃日志）。**这是修复前的实际观察，不代表修复后的设备通过结果。**

Mac 为 arm64 / macOS 27.2 (26B123) / Xcode 27.2 (27B52)。原生宿主为 Painting Playground development build 0.1.0 (1)，Expo 57.0.24、React Native 0.86.3、expo-dev-client 57.0.20、@expo/dom-webview 57.0.1。

| 设备 / 系统 / 浏览器或宿主                                                      | 输入来源                                              | 待验项与实际判定                                                                                                                      |
| ------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| iPhone 18 Pro 模拟器 / iOS 27.2 / 上述 dev client                               | 启动请求、深链接                                      | **失败**：UIKit 报 `UIScene life cycle is required for apps built with this SDK`，SIGTRAP，未进入编辑器；构建成功不等于启动通过       |
| iPhone 17 Pro 模拟器 / iOS 26.5 / 上述 dev client                               | idb 注入模拟触摸、HID 键盘                            | **安全区 / 胶囊未通过**：状态行 y=10 与系统状态栏重叠；初次胶囊 AX 宽 26pt、仅露左缘，后续 x=16 / 宽 370pt；稳定底部位置仍需复验      |
| 同一 iPhone 17 Pro 模拟器                                                       | 同上                                                  | **内部横滚所测操作通过**：可从工具组滚到画布操作与调色板；独立收起按钮保留                                                            |
| 同一 iPhone 17 Pro 模拟器                                                       | 同上                                                  | **键盘 / 文字部分通过、有缺陷**：能聚焦、显示英文软键盘、输入 `nihao` 并完成保留；靠右创建文字时完成按钮中心 x=430.5，超出 402pt 屏宽 |
| 同一 iPhone 17 Pro 模拟器                                                       | 同上                                                  | **弹层 / 焦点部分通过**：菜单打开、选择文字、聚焦成功；Tab / Escape / 焦点返回完整矩阵未覆盖                                          |
| 同一 iPhone 17 Pro 模拟器 / `pencilkit=1`                                       | 模拟触摸；原生笔输入计数均为 0                        | **PencilKit 工具栏触摸子项通过**：`gesture-ancestor` 状态可打开菜单、切文字，所测点击未吞；无法推导原生笔书写、压力、跨边界通过       |
| iPad Pro 11-inch (M5) 模拟器 / iPadOS 27.2 / Safari 27.2 (AppleWebKit 605.1.15) | idb 模拟触摸、HID 键盘，`pointerType=touch` / `pen=0` | **中文 IME 模拟器部分通过**：输入 `nihao` 出现“你好”候选，触摸选词并完成后保留；系统取色器面板外观通过，颜色提交未验                  |
| 实体 iPad / 发现为离线设备，系统 18.7.11，型号与 Safari 版本无法读取            | 无可操作设备 / Apple Pencil                           | **无法验证**：30 笔快速短笔、跨工具栏边界、系统选词后首击、真机中文 IME 与原生取色器均待设备                                          |
| Android / 第一轮无在线 adb 设备、无 emulator 与 AVD                             | 无                                                    | **第一轮无法验证**：第二轮已建立 API 36 AVD，最新结果见下表；不等待 Android 才交付 iOS 修复                                           |

第二轮 Mac 验证（HAM-164 评论 `01a1a5aa-d3b1-72b5-a78b-f7a36c3a4a9f`，2026-11-04，仍为修复前 `e97f9fe`）：

| 设备 / 系统 / 宿主                                                                                                        | 输入来源                                                                       | 实际判定                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Pixel 7 配置 AVD / Android 16 API 36 ARM64 / Playground 0.1.0 (1)，Expo 57.0.24、RN 0.86.3、System WebView 133.0.6943.137 | ADB 模拟触摸与键盘，Gboard；Temurin 17 构建、ADB 安装并连接 `dev:native` Metro | **默认入口安全区 / 胶囊失败**：画布宽 0、胶囊仅露左缘                                                               |
| 同一 Android AVD，诊断入口                                                                                                | 同上                                                                           | **内部横滚子项通过**：scrollLeft 0→254→0，页面横向滚动为 0；不能替代默认入口验收                                    |
| 同一 Android AVD，默认入口                                                                                                | 同上                                                                           | **文字提交子项通过、布局失败**：提交 `Android57` 成功；文字框右缘约 602px，屏宽约 412px，完成按钮在屏外并被键盘遮挡 |
| 同一 Android AVD                                                                                                          | ADB 键盘                                                                       | **所测焦点子项通过**：Escape 关闭工具菜单 / 缩放弹层并回各自触发按钮；Tab 可遍历，末项离开并关闭，无弹层闭环        |
| iPhone 17 Pro / iOS 26.5                                                                                                  | idb HID 输入通道                                                               | **无法验证键盘矩阵**：`dtuhidd connection ... invalidated`，换工具 / 重启仍无可信响应；不是产品通过或失败结论       |

第二轮结束已停止 Metro、AVD、代理与 iPhone 17 Pro，保留单一 API 36 AVD 和 dev client 供新 head 回归。以上均为模拟器结果，不替代实体设备结论。

第三轮设备回归（HAM-164 评论 `01a1a60a-7f4f-7925-ba00-ec1bcaabdb3d`，附件 `HAM-164-round3-validation.md`，head `7e7d062`）：

| 设备 / 项目                                                         | 实际判定                                                                                                                                                                                                                     |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 同一 Pixel 7 AVD / Android 16 API 36 / System WebView 133，默认入口 | **所测布局恢复**：画布 412.19×839.24 CSS px，胶囊 x16、宽380.19、底823.24；内部横滚通过、外页 scrollX=0。顶部系统状态文字对比不足，未据此宣告安全区全部通过                                                                  |
| 同一 Android AVD / 弹层与焦点                                       | **Escape 与归还通过**：工具、缩放、设置分别关闭并回触发按钮；Tab 经过实际控件后离开并关闭，无层内闭环                                                                                                                        |
| 同一 Android AVD / 系统键盘                                         | **仍失败**：Gboard 实际可见时 innerHeight / visualViewport 高仍约839.24，右下 textarea / 完成 / 取消被覆盖；退出再进默认页后仍复现。横向限位已通过，隐藏键盘后可完成提交                                                     |
| 同一 Android AVD / 两处 P2                                          | **专项通过**：25% 提交并重开100个“汉”，文档与内容高度均300px；祖先仅 translate(20px,30px)，resize事件0，浮层同步移动。输入来自CDP，不是系统中文IME结论                                                                       |
| iPhone 17 Pro / iOS 26.5、iPhone 18 Pro / iOS 27.2 / 新 dev client  | **构建与所测启动通过、稳定布局改善**：iOS27.2不再启动即SIGTRAP；实际进入默认编辑器，稳定画面的安全区与胶囊正常，26.5胶囊x16、宽370、底824。尚未覆盖全部冷启动瞬时首帧                                                        |
| iOS 26.5 / 横滚、软键盘、焦点与 PencilKit 点击                      | **无法验证，输入通道问题**：HID触摸 / Tab / Escape连接失效，Simulator前台System Events仍超时。PencilKit已启用并收到gesture-ancestor配置回执，但不能用AX激活替代真实点击结论；由人工或恢复通道后补验，不在本次Android修复范围 |

第四轮 Android Gboard 续修验证（HAM-164 评论 `01a1a61d-f7f7-7202-a2d4-b8c819c9e5f4`，附件 `HAM-164-round4-validation.md` / `HAM-164-round4-evidence.zip`，head `a97818e16a15b046eaabffe7cbd394799a2e33fb`）：

环境为 Pixel 7 配置 AVD / Android 16 / API 36 ARM64，Playground development client 0.1.0 (1)，Expo 57.0.24 / RN 0.86.3 / @expo/dom-webview 57.0.1，System WebView 133.0.6943.137，Gboard 15.1.08.726012951-preload-arm64-v8a。默认入口已确认加载新 Metro Android / DOM bundle，未启用 diagnostics，也未改写视口或 CSS。输入为 ADB 模拟触摸（含 Gboard 按键、完成 / 取消 / 撤销）与文本注入，菜单选文字使用 CDP 点击。**以下仅为模拟器所测场景通过，非 Android 真机、非中文 IME 或手写验收。**

| 场景                                | 第四轮实际判定与证据                                                                                                                                                                                                                                                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 字母键盘 / 表情面板高度切换         | **通过**：无键盘 innerHeight / visualViewport.height 为839 / 839.238 CSS px，字母模式527 / 527.238，表情模式403 / 403.048。原生外层仍为完整高度，内部宿主及直接 WebView 底边实际从2337→1517→1192设备像素，缩至键盘上方；以稳定态记录，不宣告所有过渡帧无延迟或闪动。证据 `typed.*`、`keyboard-stable.png`、`emoji-stable.*` |
| 键盘可见时完成 / 一次撤销           | **通过**：完成 / 取消均在可见区域内并可实际触摸；完成提交恰一段 `AndroidRound4g`，一次撤销后对象归零、撤销禁用且重做可用。证据 `committed.*`、`undone.*`                                                                                                                                                                    |
| 键盘可见时取消                      | **通过**：新建 `CancelRound4` 草稿后实际触摸取消，编辑器关闭、对象仍零、撤销仍禁用且重做仍可用，未新增对象或历史。证据 `cancel-draft.*`、`cancelled.*`                                                                                                                                                                      |
| 高度变化、隐藏 / 重开期间草稿与焦点 | **通过**：隐藏后高度恢复839，重开字母键盘回到527；同一 textarea 和页面观测标记保留，草稿不变、焦点持续为“文字内容”，未收到 focusout。完成 / 取消后 textarea 正常销毁、焦点 BODY，不描述为回到工具按钮。证据 `hidden.*`、`reopened.*` 及焦点观测                                                                             |
| 退出 / 重进默认页                   | **行为已确认**：带 `LeaveDraft` 离开至另一原生路由再返回后，创建新编辑器、观测标记消失、未提交草稿不恢复，焦点 BODY、对象与历史均空；再次编辑可唤起 Gboard、缩至527并取消。不是跨页面草稿持久化通过。证据 `before-leave.*`、`away.*`、`reenter-default.*`、`reenter-keyboard.*`                                             |

第四轮未扩大为全部4.3或真机结论。iOS26.5交互仍需人工 / 恢复输入通道，实体iPad + Apple Pencil仍缺；4.2 / 4.3保持未勾选，HAM-164继续 `blocked`。

### 修复范围与本机验证边界

- 通过 `apps/playground/plugins/with-ios-scene.cjs` 持久化 UIScene 迁移：Info.plist 注册 Expo 57 自带的 `EXExpoAppSceneDelegate`；AppDelegate 提供 RN factory，由 scene 创建窗口并启动 RN。保留 dev-client bundle URL 与冷 / 热深链接委托，移除 AppDelegate 重复启动。无需手改被忽略的生成工程；模板不兼容时 prebuild 显式报错。
- 原生编辑器宿主在 RN 层消费四边安全区，根 Provider 使用初始窗口 metrics；DOM 容器与 WebView 显式占满宿主宽度，关闭 WebView 的自动重复 inset。iOS 使用 KeyboardAvoidingView；Android 初版仅依赖系统 resize，第三轮证实 API 36 宿主未随 IME 收缩，现改为订阅 `keyboardDidShow` / `keyboardDidHide` 并读取已有 `Keyboard.metrics()`。用键盘顶部减容器实际窗口坐标，限制内部 WebView 宿主的 maxHeight，键盘变高 / 关闭与容器重排均更新。以高度上限避免已生效的系统 resize 被重复扣减；不重挂载 DOM，既有草稿与焦点保持。Web 路由保留原入口。
- 胶囊外壳改为明确的 left / right 约束，内部声明固有宽度再按宿主限宽，避免依赖首帧逻辑 inset / shrink-to-fit 的组合。实际 26pt 首帧问题是否完全消除，必须冷启动设备复验。
- 文字编辑 UI 改为独立 HTML 浮层，SVG 锚点保留对象 / viewport / 页面祖先变换的实际投影，操作面板保持正向并约束到所属画布与 visual viewport 的交集；随宿主 resize、可见视口 resize / scroll 更新。输入区可缩小并内部滚动，操作区换行，保持完成 / 取消可达；字号至少 16 CSS px 避免 iOS 聚焦自动放大。编辑浮层的避让不修改文档坐标、对象 transform、viewport 或撤销历史，提交仍走既有 IME session。
- 审查 P2 修复：长文字高度通过独立隐藏节点按文档宽度、字号及行高测量，避免 25% 缩放时用浮层换行高度写回导致裁切；已有对象的自定义行高保留。监听 SVG 锚点至页面祖先的属性 / 类变动、尺寸与 CSS 动画，纯平移、缩放、旋转无需额外触发 window resize 即可更新浮层，动画结束后停止逐帧跟随。

修复执行环境为 Linux / Node 24.15.0 / pnpm 10.28.2。调用模拟器工具返回 `spawn xcrun ENOENT`，本机没有 Xcode / iOS 运行时，**未在本机执行 iOS 26.5 / 27.2 启动与系统键盘自查**。Mac 第三轮已覆盖所测构建 / 启动，第四轮已在 `a97818e` 覆盖 Android Gboard 续修场景，结果见上；iOS交互输入通道缺口仍保留。各轮设备结果以各自 head 为准，`19a7d46` 仅作基线。浏览器测试使用独立 5276 端口，避免复用 HAM-156 的旧服务。

| 本轮命令 / 检查                                                     | 结果                                                                                                                                                                                                                    |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                                                         | 98 套件 / 1318 项通过（含新增 Android 键盘事件 2 项），responder 9 项通过，Expo 模板迁移 / 重复执行 / 异常模板测试 2 项通过                                                                                             |
| `pnpm typecheck`                                                    | painting / painting-board / playground 全部通过                                                                                                                                                                         |
| `pnpm lint`                                                         | 0 errors，已有 32 warnings                                                                                                                                                                                              |
| `pnpm build`                                                        | 库构建 / 类型产物 / Expo Web export 全部通过；不等同原生 Swift 编译或设备启动                                                                                                                                           |
| iOS `expo prebuild --platform ios --no-install`，再次执行并比较哈希 | 通过：生成的 AppDelegate / Info.plist 重复生成不变；RN 仅由 Expo scene delegate 启动                                                                                                                                    |
| Chromium 专项 UI                                                    | 既有38项通过；新增Android宿主高度回归1项修正撤销版本号断言后单独重跑通过，共39项覆盖。`mobile-editor-layout`、`painting-toolbar`、`toolbar-round4`、`interaction-feedback` 四份 spec，2 workers                         |
| `pnpm --filter @hamster-note/painting-playground build:android`     | 通过：Android Hermes bundle 与 Expo DOM bundle 均已导出；不等同 API 36 Gboard 设备验收                                                                                                                                  |
| WebKit 专项 UI                                                      | **无法运行**：默认 Ubuntu 26.04 不支持安装；下载 Ubuntu 24.04 兼容构建 WebKit 26.4 后仍缺 ICU74、libxml2、libevent、libflite、libavif、libmanette、libwoff、GStreamer 等宿主库。13 项在浏览器启动前失败，无页面行为结论 |

UI 使用本地临时配置继承 `playwright.config.ts`，仅改 baseURL / webServer 为 5276、`reuseExistingServer=false`；测试本身已纳入标准 Chromium 配置，新布局 spec 同时加入 WebKit 配置。Chromium 是 147.0.7727.15。首轮新增 4 项覆盖：320 / 402px 右侧文字输入的可见视口缩小与平移、焦点与草稿保留、完成与撤销；零宽宿主恢复后首帧胶囊宽度与内部横滚；旋转 / 缩放祖先下编辑控件可达及取消不改对象。本轮另增 6 项：25% / 50% / 200% 输入 100 个“汉”后提交、重开与改字号，实际渲染高度不超过对象边界；仅改变祖先类名做平移 / 缩放 / 旋转，不派发 resize，检查实际位置、控件可达、草稿与焦点保留、取消不写历史。这里直接输入中文字符串并模拟 viewport 事件，只证明 DOM 布局与会话行为，不冒充系统中文 IME 或软键盘。

Android 续修另增两项原生事件测试：将平台明确设为 Android，模拟 `keyboardDidShow` / `keyboardDidHide`，外层高度保持839px时限制到键盘顶部、键盘高度变化 / 隐藏 / 重开、系统已收缩不二次扣减、容器原点变化与入页已有键盘。仅模拟原生几何边界，使用真实 Keyboard 事件与宿主状态更新，检查子树保留。浏览器新增一项让WebView视口实际按839→496→436→839→496px变化，验证右下编辑框与完成 / 取消位于可见区域，草稿 / 焦点保留、一次提交与撤销；没有使用iOS visualViewport属性覆盖。**这些是自动化边界验证；第四轮已另外在 `a97818e` 的 API 36 模拟器完成 Gboard 所测场景，仍不替代真机或中文 IME 验收。**

Web / Expo DOM 浮层使用已有 ReactDOM renderer；包显式声明可选 `react-dom` peer（Web 宿主需提供）并补开发类型，不新增生产依赖。

### Mac 回归清单（历轮执行与剩余项）

以下为累计清单；第三 / 四轮已完成部分以上述结果为准，未覆盖的冷启动瞬时首帧、iOS交互与实体笔项目继续待验。

1. 直接取 HAM-167 PR #45 的最新 head（无需等待合并），安装依赖与 `prepare:playground-artifacts`；运行 `prebuild --platform ios --no-install` 检查生成 AppDelegate 与 Info.plist，再安装 Pods / 重建 dev client。**必须重建，刷新 JS 无法更新 UIScene 生命周期**。
2. iPhone 17 Pro / iOS 26.5、iPhone 18 Pro / iOS 27.2 分别冷启动与热启动，连接 Metro，验证首页及 `/layered-editor` 冷 / 热深链接均进入编辑器，保留进程日志。
3. 不带 diagnostics 冷启动至少三次，首帧截图检查顶部状态行在状态栏之下、底部胶囊完整且在 home indicator 之上；402pt 宿主胶囊应宽 370pt。再检查旋转 / 宿主尺寸变化与内部横滚。
4. 在右侧 / 底部创建文字并打开英文软键盘、中文 IME；长文本、多行、候选选词、完成 / 取消、键盘关闭 / 重开均检查可达、焦点保留与一次提交 / 撤销。增加 25% 缩放输入 100 个“汉”并提交、重开，检查无裁切；仅更改页面祖先 transform 做平移 / 缩放 / 旋转，不派发 resize，检查浮层跟随且保持草稿 / 焦点。补菜单、Escape / Tab（可用外接键盘时）、焦点返回矩阵。iOS 26.5 若 idb 失效，可尝试 Simulator 前台 System Events 或 simctl 硬件键盘开关，仍无响应则明确记录输入通道不可用。
5. 显式开启 `pencilkit=1`，重复菜单、横滚和文字编辑，确认原生覆盖层未吞工具栏点击；实体 Pencil 的输入仍单独标记。
6. 复用现有 Android API 36 AVD，在默认入口完整重跑安全区、胶囊首帧 / 横滚、系统键盘、文字限位、弹层与焦点，不能以诊断入口替代。每项回传实际设备型号 / OS / 宿主版本 / 构建 SHA / 输入来源、步骤、判定与截图或录屏，含未通过原因。4.2 / 4.3 保持未勾选，直到父任务有完整设备证据。
7. Android右下文字续修已在第四轮 `a97818e` 完成所测场景：Gboard字母 / 表情模式下内部宿主和WebView实际收缩至527 / 403 CSS px，完成 / 取消可点，草稿与焦点在高度变化、隐藏 / 重开期间保留，提交后一次撤销；键盘可见时取消不写对象 / 历史。退出重进创建新编辑器、未提交草稿不恢复。详见第四轮记录；本轮未新增原生模块或修改Android工程配置，iOS交互缺项仍交由人工 / 恢复输入通道后补验。

## HAM-175：iOS 非编辑态键盘路由（2026-11-05）

### B 轮设备事实（修复前）

基线 `main 0116d23`，iPhone 17 Pro / iOS 26.5 **模拟器**，Playground Expo development client 0.1.0 (1)，Expo 57.0.24 / RN 0.86.3 / @expo/dom-webview 57.0.1。输入全部来自 idb 脚本触摸、英文文本与 HID 键注入，**不是人工手点、真实 iPhone / iPad、Apple Pencil 或系统中文 IME 的验收**。来源为 HAM-164 评论 `01a1abdb-89de-7c48-be47-369b437bd198` 与 `01a1abe3-f9b1-7d6e-aa1c-7f6504781fdd`，附件 `HAM-164-ios-input-validation.md` / `HAM-164-ios-evidence.zip`、`HAM-164-key-routing-result.md` / `native-events.jsonl` / `dom-events-all.json` / `HAM-164-key-routing-evidence.zip`。

| 子项                            | B 轮实际结论                                                                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 胶囊内部横滚                    | **所测场景通过**：scrollLeft 0→457→601→0，外页 scrollX / scrollY 始终为0                                                                                                                                |
| 系统键盘与文字框                | **所测场景通过**：脚本触摸聚焦、输入英文；键盘出现时 innerHeight / visualViewport 722→353，完成 / 取消均可触摸；完成后一次撤销移除，取消另一草稿不新增历史                                              |
| PencilKit 不吞工具栏点击        | **所测点击通过**：显式启用并收到 `gesture-ancestor`，脚本触摸可打开工具菜单、缩放并横滚；原生笔计数0，不推导实体笔通过                                                                                  |
| 工具菜单、缩放弹层 Escape / Tab | **不通过，已定位为产品缺陷**：原生 UIApplication 已接收 Escape（keyCode41）/ Tab（43），DOM 无 keydown，弹层保持打开，焦点停在菜单项或 BODY。触摸缩放滑条重试仍复现。不是“按键未进入模拟器”的工具链缺口 |
| 文字框 Escape / Tab 阳性对照    | **通过**：同一注入命令与记录器，Tab / Escape 到 DOM 约55 / 47ms，`isTrusted=true`；分别移到字号、取消草稿。不能推广为弹层键盘通过                                                                       |
| 设置弹层键盘、系统中文 IME      | **本轮未覆盖**                                                                                                                                                                                          |

### b50496f 首版实现与验证边界（历史记录，后续原生回归已失败）

首版依据的 B 轮日志确认了原生→DOM传递中断，但当时没有记录失效时的 first responder；“需要补原生响应者”只是首版假设。下文 Mac 回归已确认失效时存在 WKContentView responder，首版假设不足以解释缺陷，不再沿此方向追加调用。

通过 pnpm 的 `@expo/dom-webview@57.0.1` 补丁增加 iOS 原生 `requestFocus` 方法，调用公开 `WKWebView.becomeFirstResponder()`，由 WebKit 将响应者交给内容视图。原生路由在 DOM 挂载就绪、非编辑控件 focusin 或工具栏 / 面板 pointerdown 后请求焦点；同一事件循环合并请求，非交互画布笔迹不产生逐点桥调用。监听卸载时清理，不替换 WebKit 的键盘事件或构造 DOM keydown。Android 不注册该 iOS action，Web 保留直接 DOM 入口。

采纳补充分支 `agent/ham175-toolbar-tab-supplement`（`24223be`）的DOM退出处理与双向Tab回归要点：保留浏览器默认遍历，待Tab默认操作完成后，焦点离开面板即关闭（含回到同一工具栏），不夺回新焦点；卸载时清理待执行检查。Escape仍归还原触发器。B轮证据合并在上表，仅保留本分支实际执行的测试结果，不重复记录补充分支的历史测试数字。

DOM 侧跳过正在输入的 textarea、文本 / 数字 input、select 和 contenteditable；原生方法在异步跨桥后重新读取当前 activeElement，再决定是否请求焦点，避免迟到的弹层请求打断文字或 IME。range / checkbox 等非文本控件允许获取响应者。此变更包含 Swift，**必须重新安装依赖并重建 iOS development client，单纯刷新 Metro 不会安装原生方法**。

本机为 Linux / Node 24.15.0 / pnpm 10.28.2。模拟器工具实际返回 `spawn xcrun ENOENT`，没有执行 iOS Swift 编译或 iPhone 17 Pro / iOS 26.5 回归。因此本次状态为：**修复实现已提交验证；修复后弹层键盘路由尚待模拟器确认，不能记为通过**。下列自动化只证明桥契约与浏览器行为，不证明原生按键可达。

| 本机检查                                              | 结果                                                                                                                                                                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                                           | 100套件 / 1322项通过；responder 9项；原生配置 / 补丁依赖检查4项通过。包含真实 Expo action registry / ref 转发、DOM就绪请求、非编辑交互、编辑态保护、异步请求清理和原生侧JS守卫；不等于Swift运行测试 |
| `pnpm typecheck`                                      | painting / painting-board / playground 通过                                                                                                                                                         |
| `pnpm lint`                                           | 0 errors，已有32 warnings                                                                                                                                                                           |
| `pnpm build`                                          | 两库构建与 Expo Web export 通过                                                                                                                                                                     |
| Chromium 专项 UI                                      | 42项通过（既有39项及新增三类弹层Escape焦点归还 / Tab离开关闭）；使用独立5285端口，未复用其他任务服务。包括文字composition提交 / 取消、一次撤销、Android宿主高度变化和笔迹 / 工具栏回归              |
| iOS / Android `expo export`                           | 两端Hermes与DOM bundle均导出通过；只验证静态依赖解析，不证明Swift编译或原生运行                                                                                                                     |
| WebKit                                                | 无页面结论：本机缺少本版本所需的webkit-2272；安装命令失败，`Playwright does not support webkit on ubuntu26.04-x64`，不把其他已安装WebKit版本当作本版本测试                                          |
| `pnpm install --frozen-lockfile` / `git diff --check` | 通过；4.2 / 4.3仍未勾选，未改规格                                                                                                                                                                   |

### Mac 必须补齐的修复后回归

1. 取 HAM-175 的 PR head；执行 `pnpm install --frozen-lockfile`、`pnpm prepare:playground-artifacts`，重建并安装 iOS development client。只连接原来的0.1.0(1)安装包、刷新JS不足以验证Swift补丁；记录实际构建SHA。
2. iPhone 17 Pro / iOS 26.5 模拟器从默认入口进入，不启用 diagnostics。冷启动后，分别打开工具菜单、缩放、设置：用相同 idb HID 路径发 Escape，验证真实 DOM keydown、弹层关闭且 activeElement 回各自触发器；重开后用 Tab / Shift+Tab 经过实际控件并离开，验证自动关闭且不困住。同步保存原生 / DOM 事件、`isTrusted`、焦点和截图，不能以 `dispatchEvent` 替代原生输入。
3. 文字框英文与中文 IME 输入、候选选词、完成 / 取消 / 一次撤销；文字框 Tab 到字号、Escape 取消，再开三类弹层重复第2步，检查原生焦点可恢复且无重复键或软键盘误弹。补后台 / 前台及离开 / 重进后的首次按键。
4. 重新检查横滚、软键盘布局；显式启用 PencilKit 后重复工具栏点击与弹层键盘矩阵。Android 继续复用 API36 AVD 验证既有 Escape / Tab 和 Gboard 高度路径，不以iOS修复推导Android通过。

4.2 实体笔五项继续待 iPad + Apple Pencil。归档 `tasks.md` 的4.2 / 4.3保持未勾选；HAM-175 的原生回归结果应另行写入本节，HAM-164 最终验收以实际设备证据为准。

### HAM-175 Mac 原生候选回归（2026-11-05，b50496f）：不通过

实际构建 `b50496f30531e1275e821109518a9f0c2e506e28`（PR #46），arm64 / macOS 27.2 / Xcode 27.2，iPhone 17 Pro / iOS 26.5 **模拟器**，development client 0.1.0(1)。frozen install、库产物、iOS prebuild、pod install 通过；真实 Debug build / install / launch 成功（533704ms、编译错误0）。已核对安装的可执行文件及debug dylib与构建产物SHA-256一致，包含requestFocus符号；原生栈实际经过 `DomWebView.requestFocus()` 完成闭包 → `WKWebView.becomeFirstResponder()`。使用本轮独立Metro5275，默认入口、未启用diagnostics，不能把此结果解释为旧安装包未更新。Mac本轮补丁依赖检查4项通过，未重复运行Linux全量用例。

输入为idb HID模拟触摸、Escape(41)、Tab(43)、Shift+Tab；中文来自系统拼音软键与候选实际点击。PencilKit开关用accessibility press完成设置，其后的工具栏点击均为HID触摸。DOM仅安装只读事件监听和读取快照，原生LLDB只观察事件、responder及调用栈；没有构造DOM键盘事件、强制焦点或修改产品视口/CSS。

| 本轮项目                                               | 实际结果                                                                                                                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 默认入口：工具 / 缩放 / 设置，各Escape、Tab、Shift+Tab | **9项全部失败**：确认弹层已打开后发键，DOM无keydown、弹层不关闭。工具停在画笔菜单项，缩放停在range；设置Escape后BODY、Tab两向停在输入模式select，未完成遍历或焦点归还                |
| PencilKit开启后同一键盘矩阵                            | **9项全部失败**，与默认入口一致。两组共84条原生Escape/Tab按下/抬起记录，失效时均找到WKContentView first responder及所属Expo DomWKWebView                                             |
| 英文及文字框键盘阳性对照                               | **所测通过**：H175Alpha完整保留；相同HID路径Tab/Escape以isTrusted=true到达DOM，分别移到文字字号、取消草稿。Commit175完成后可一次撤销；取消另一草稿未新增历史                         |
| 系统中文IME / 完成 / 撤销 / 取消                       | **所测通过**：实际点拼音n/i/h/a/o，出现“你好”候选，可信compositionstart/update/end；点击选词后textarea为“你好”。完成生成恰一个“你好”对象，一次撤销归零，取消另一草稿仍零且未新增历史 |
| 软键盘布局                                             | **所测通过**：无键盘宿主高722，英文键盘353、中文约352；textarea / 完成 / 取消均在可见范围并可实际点击；不代表全部过渡帧或真机结论                                                    |
| PencilKit点击与横滚                                    | **所测通过**：收到gesture-ancestor、canvas402×622，原生起笔0；可实际点击打开三类弹层，内部横滚scrollLeft601→187、外页scrollX=0。不推导Apple Pencil书写通过                           |
| 前后台、离开 / 重进后的首键                            | **未验**：前后台launch自动化45秒超时，其工具命令带terminate-running-process，后续为新PID，未形成有效同进程对照；离开重进步骤未执行                                                   |
| Android / iOS27.2 / 实体iPad与Apple Pencil             | **本轮未验**                                                                                                                                                                         |

新的证据表明补丁已经执行，**仅补becomeFirstResponder不足以修复问题**。失效时已有 `WKContentView: 0x1026a3800`，祖先含同一 `ExpoDomWebView.DomWKWebView: 0x102688a00`；具体WebKit/UIKit传递根因仍未定，不应继续把“没有响应者”记作已证实原因。文字操作后关闭所有原生断点再试工具Escape仍失败，已保留DOM快照。

HAM-175评论附件 `HAM-175-b50496f-ios-evidence.zip` / `HAM-175-ios-validation.md` 保存原生 `native-events.jsonl`、18项 `matrix-summary.json`、各项open/result DOM快照与截图、可信文字/IME事件、原生调用栈、构建和安装身份及操作脚本。正式默认矩阵使用 `rerun-*`（工具/缩放）和 `settings-settled-*`（设置），PencilKit矩阵使用 `pencil-*`；初始观测表达式错误已修正并重跑，不以探索快照作为最终判定。

结论：HAM-175原生键盘回归不通过，PR #46继续Draft，开发agent需据此继续定位；HAM-164不能据此解除iOS键盘阻塞，归档4.2 / 4.3保持未勾选。

### HAM-175 分层诊断候选（2026-11-06）：等待 Mac 采集，未修复

已采纳 Mac 文档提交 `bf4611c`，继续使用 PR #46 / `agent/agent/16ee970f929f`。产品路径保留已构建的 `b50496f` 基线及 Tab 离开关闭逻辑，本轮没有新增焦点请求或合成 DOM 键盘事件，也没有修改既有 HID 输入 / 矩阵 / DOM 观测脚本。原生 18 项矩阵的最新有效结论仍为上节的 **全部失败**，不是待合并即可验收。

新增 `scripts/ios/trace_keyboard.py`，由 Mac 显式导入 LLDB 并启用。分别采集 UIApplication 分发 / action、WKContentView 与继承 responder 的 presses / keyCommands 查询、WebKit 内部入口 / 输入法分支 / completion、WebPageProxy 排队 / 发送 / 确认，以及正确 WebContent PID 内的接收 / WebCore 键盘分发。记录原始参数、时间、线程、调用栈、符号覆盖与读取错误；不改返回值、不消费或转发键盘事件。私有符号缺失或 getter 失败均是观测缺口，不能作为“该层没有事件”的证据。

Mac 的完整操作、符号检查、文字阳性对照、两个进程的日志对应、探针关闭后复测和必需回传项见 [iOS 键盘分层诊断](ios-keyboard-trace.md)。先用文字框与工具菜单的同一单键定位，再扩原 18 项矩阵；保留默认入口 / PencilKit 两组、真实 HID 输入、可信 DOM 事件与焦点判定。设备口径继续是 **iPhone 17 Pro / iOS 26.5 模拟器，idb 脚本输入**，不是实体键盘 / 真机 / Apple Pencil 验收。

本轮 Linux 没有 xcrun，没有编译 Swift，也没有运行 Apple LLDB / UIKit / WebContent 探针。Python 检查只能验证探针的宿主侧逻辑，不能证明 Apple 私有符号存在或事件路由通过。Mac 重建采集结果回传前，PR #46 保持 Draft，HAM-175 尚未完成，4.2 / 4.3 均保持未勾选。

本轮本机检查：`python3 -B -m unittest discover -s scripts/ios -p 'test_*.py' -v` 的 8 项通过，覆盖 ABI / 读取错误、函数入口断点、符号缺失、进程身份变化及只清理自有断点；`pnpm test` 100 套件 / 1322 项、responder 9 项、原生配置 4 项通过。typecheck、库 / Web build 通过，lint 0 errors / 原有 32 warnings。原有四份相关 Chromium spec 共 42 项通过（独立 5296 端口，2 workers，1.6 分钟），只调整临时服务配置，未修改测试断言。frozen install、Python 语法与 diff 检查通过。这些结果均不代表新的 iOS 模拟器或 Android 设备验收。

### HAM-175 Mac app 侧对照（2026-11-06，bb06548）：非编辑态仍失败

Mac 实际重建安装 `bb06548e85779ab2f26186290d6c9b2f0fcac714`，主程序 / debug dylib 的安装与构建哈希一致。环境为 macOS27.2 / Xcode27.2 / Apple LLDB2103.0.34.407，iPhone17 Pro / **iOS26.5模拟器**、默认入口、dev client0.1.0(1)，输入为 **idb脚本HID**。未修改业务或原 HID / DOM 观测脚本。

| 本轮操作 / 观测                   | 结果                                                                                                                                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 非组合输入的英文文字 Tab / Escape | 可信 DOM 事件正常；命中 WK `handleKeyEntry` / 内部 handler 与 proxy enqueue/send，分别移到字号和取消草稿                                                                                                          |
| 工具菜单同一单键                  | UIApplication 与 WK `_tryToHandlePressesEvent:` 命中，WK entry / proxy enqueue/send 无命中，DOM 无 keydown，菜单仍开；所有探针 stop/detach 后复现                                                                 |
| app 探针                          | 正式纯寄存器/栈会话1028命中、0读取错误；12类解析成功，proxy.completion unavailable。`--details` 在初始会话因短变量名d冲突、动态getter返回类型问题编译失败，保留原始错误；未取得_try返回值、HID元数据或handled解码 |
| WebContent                        | 现有WebView地址确认PID22141，app22062；kernel因hardened、无get-task-allow拒绝附加。没有接收侧JSONL，不据此判定接收方丢事件                                                                                        |
| 非键盘最小回归                    | 英文及系统拼音“你好”的提交/一次撤销、英文取消/组合输入取消所测通过；PencilKit原生接管时菜单HID点击、默认及原生接管横滚通过，起笔/提交计数0。仅开关设置使用AX press                                                |
| 正式18项矩阵                      | **未运行**：原流程双进程门槛未满足。缩放/设置、Shift+Tab、PencilKit键盘矩阵等均未验；不将b50496f的18项失败冒充为本SHA结果                                                                                         |

证据为本单附件 `HAM-175-bb06548-diagnostics.md` / `HAM-175-bb06548-ios-diagnostics.zip`，包含 app JSONL、`single-key-summary.json`、PID映射、符号清单、getter错误、kernel拒绝日志、DOM/open-result及关闭探针对照。原生缺陷仍存在，HAM-175保持blocked。

### HAM-175 下一候选：选择(a)，补页面 frame focus 并完成 app 侧返回值取证

本轮选择(a)，不启用原生→DOM事件桥。iOS非编辑控件交互期间，仅在页面可见、无编辑元素且 `document.hasFocus()` 为false时，通过公开 `window.focus()` 同步请求frame focus；不重设activeElement、不调用隐藏输入、不增加becomeFirstResponder、不合成键盘事件。原先 first responder 已有的事实不足以确认DOM frame与系统keyboard delegate全部正确；这是待Mac证伪的候选，不写成根因或修复通过。若页面本来已有focus，候选按设计不执行；若补齐后仍无可信DOM事件，就不能继续以此假设推进。

修正LLDB表达式的唯一局部变量名与显式动态返回类型，新增 `_tryToHandlePressesEvent:` / keyboard-required / async / 入队等BOOL返回采样，按线程、caller PC、SP与入口序号对应；`handled`直接读取寄存器，即便getter失败也不丢此读数。补充UIKit keyboard manager/delegate探针，以及WK已持有的inputDelegate/asyncInputDelegate、keyWindow/scene/focus状态；不调用可能创建键盘状态的singleton accessor。新增独立只读 `scripts/ios/page_focus.js`，不改原观察器和矩阵断言。

Mac步骤见更新后的 [诊断说明](ios-keyboard-trace.md)：**移除WebContent附加门槛**，以app侧文字阳性/工具菜单对照、返回值及页面focus快照推进，随后执行原18项矩阵并在无探针状态复核。WebContent限制不再作为等待条件。`--details`兼容性和新候选的原生效果仍需Mac实际执行；本机无xcrun/Apple LLDB，未编译Swift，不声称原生通过。PR #46保持Draft，HAM-175保持blocked，4.2 / 4.3均未勾选。

本轮Linux检查：Python探针逻辑14项通过（含BOOL返回寄存器、线程/栈匹配、递归调用、清理临时断点与getter表达式约束）；Jest101套件/1325项、responder9项、原生配置4项通过。新增页面focus单测覆盖同步请求、当前控件保持、编辑/隐藏/已有focus时跳过、重入和卸载；旧单测仅为jsdom缺失的window.focus提供mock，未放宽断言。typecheck、库/Web build通过，lint 0 errors/原有32 warnings。四份原有Chromium spec共42项通过（独立5296端口、2 workers、1.1分钟）；未修改UI断言或HID验收脚本。Python语法、变更文件格式与diff检查通过，未执行新的原生/Swift验收。

### HAM-175 Mac `e1b939a` 结果（2026-11-06）：页面 focus 候选不通过

实际 head `e1b939a838d0b4928be99aa7924c6d88615819ab`，iPhone 17 Pro / **iOS26.5模拟器，idb脚本HID**。Mac 已真实重建安装并核对构建身份。hasFocus 前后均 true，工具/缩放 `_tryToHandlePressesEvent:` 返回false；设置Escape began true/ended false，但同样没有delegate / WK entry / proxy send。菜单态两个input delegate为nil、keyboard-required=false，文字态为 `_UIKeyboardStateManager` / true。补 `window.focus()` 无效，不再继续该路线。

探针下原18项全部失败，stop/detach后重新跑18项也全部失败。文字Escape在探针下只有隐藏键盘，detach后可信DOM Escape正常取消，说明探针存在扰动；不得把探针下文字回退当成候选产品回退。英文/中文IME提交、取消、一次撤销、横滚、PencilKit点击的本轮所测操作通过，仍不代表实体键盘/真机/Apple Pencil验收。原始证据见本单附件 `HAM-175-e1b939a-diagnostics.md` / `HAM-175-e1b939a-ios-diagnostics.zip`。

本轮检查还发现旧探针的错误符号归属：`page.active/page.focused` 部分断点实际落在 `updateActivityState/setCursor/updateBackingStoreDiscardableState` 等外层函数。旧日志的110/121/51条未匹配返回必须保留为观测缺口，不从这些错误标签推导页面focus。页面hasFocus结论来自独立DOM快照。

### HAM-175 新候选：原生 UIKeyCommand 桥，尚待 Mac 重建

按优先顺序先验证页面focus sink。Chromium147中，透明裁剪textarea / contenteditable设 `aria-hidden=true` 和 `tabindex=-1`，聚焦后虽收到可信keydown，CDP辅助功能树仍有focused/editable节点（ignored=false）；inert / display:none / visibility:hidden可以隐藏节点，但无法持有焦点。脚本 `scripts/ios/probe_focus_sink.mjs` 与 [原始JSON](focus-sink-chromium.json) 已保存。这证伪所试sink满足“不可访问”的要求，**未声称在iOS上验证过sink能否转发**。

因此选择授权的(b)，移除已证伪的requestFocus/window.focus路径：仅iOS、仅打开面板的非文字编辑焦点，通过DomWKWebView公开UIKeyCommand响应Escape/Tab/Shift+Tab，再回传scope/sequence/key到DOM。事件如实为 **isTrusted=false**；不修改观察脚本、不将浏览器注入冒充HID。Escape复用现有关闭/归还焦点逻辑；Tab未被preventDefault时使用tabbable遍历实际控件，保留原先Tab离开关闭补充。文字/IME不启用桥；陈旧/重复回调拒绝，启停串行化，卸载/导航/内容进程退出清理。默认入口、PencilKit开关、Android/Web均保留原有宿主范围。

探针增加物理函数名/入口PC/非内联检查，默认关闭高频getter入口，只跟踪WK try返回；栈已退出/复用或5秒超时的临时断点会清理，但记录为return-unobserved并累计discardedReturns，不当成成功匹配。`--details`不再在按键回调内执行getter，改用显式暂停的 `ham175-focus` 快照，以降低文字Escape扰动。新的匹配与扰动效果仍须Mac实测。

Mac按 [操作说明](ios-keyboard-trace.md) 重建新head：**先完全不附加LLDB，执行原18项矩阵**，保存原DOM日志/矩阵结果和 `[HAM175 keyboard]` 原生action日志，核对每次真实HID至多一条keydown、焦点与关闭行为。单独标注isTrusted差异；若原判定因可信度失败，保留原始失败，不能改成绿。再检查快速菜单→文字首键、长按Tab、select/颜色控件、同进程前后台与离开重进，保留文字/IME/一次撤销和PencilKit最小回归。需要定位时另开薄探针单键日志，不等待WebContent附加。

本机没有xcrun / Apple LLDB，未编译Swift，未验证新的原生链路。此处交付的是候选，原生矩阵最新有效结果仍为e1b939a两轮18项全失败。HAM-175保持blocked、PR #46保持Draft；4.2 / 4.3保持未勾选，终点仍是原生矩阵通过。

本轮Linux验证：Jest100套件/1326项、responder9项、原生配置3项、Python探针18项通过；typecheck、库/Web build、frozen install通过，lint 0 errors/原有32 warnings。原有四份Chromium spec的42项通过；新增独立桥契约3项在最终源码上通过（真实页面组件、模拟原生传输，明确验证isTrusted=false，不算HID验收）。桥契约覆盖三个面板Escape归还焦点和双向Tab离开，单测另覆盖编辑/IME、陈旧/重复消息、异步启停与effect重挂载。初轮新增用例发现并修复颜色控件错误禁用；一次并行构建导致Metro连接被拒，构建结束后独立启动服务复跑3项通过。原HID矩阵/观察器和既有UI断言未修改；旧focus实现单测随已证伪路径移除，替换为新桥契约检查，不把测试数量变化包装成原生进展。

### HAM-175 Mac `c2f8700`（2026-11-06）：14项行为达成，4项行为失败，正式0/18

Mac 实际重建 `c2f87007aebb0ef1ffc36b67ffaaad1b62b23b14`，Swift编译0 errors，构建/安装哈希一致。环境为iPhone17 Pro / **iOS26.5模拟器、idb脚本HID**，不是实体键盘或真机。完全未附加LLDB的18项中，14项满足关闭/退出条件但因isTrusted=false仍失败；默认/PencilKit设置Escape与Tab共4项另有行为失败。36次矩阵HID对应30个合成keydown/原生命令，无重复。原矩阵判定仍为0/18，没有调整可信度门槛。

设置Escape前SELECT的程序化focus打开UIKit选项菜单，键没有到DOM；Tab首键由桥送达，focus到颜色输入，约3ms后颜色选择器使焦点变BODY，面板仍在、后续两键没有回调。其他面板Shift+Tab聚焦自由取色也会打开原生色板，这个副作用随原证据保留，不包装为完整功能通过。

快速菜单→文字的a/Tab/Escape各只有一个可信事件且未走桥；英文/IME提交、取消、一次撤销、横滚和PencilKit点击所测通过。之后重进菜单Escape及三个面板1.5秒Tab均无事件/命令；前后台缺发键前快照，不能判通过。单次默认薄探针下，文字Tab/Escape正常、菜单只到UIApplication/WK try，stop/detach后相同；6条presses入口被符号校验拒绝，返回pending/discarded均0。完整依据在附件 `HAM-175-c2f8700-ios-validation.md` / `HAM-175-c2f8700-ios-evidence.zip`。

### HAM-175 本轮修正：组合态生命周期与页面内设置控件

从原始 `dom-events-all.json` 找到重进故障的具体触发：06:11:20.158开始第二次composition，06:11:25.690取消时只收到focusout，没有compositionend。旧桥的全局composing布尔值因此永久为true，禁用了所有后续面板。现在记录composition所属元素，在它失焦或移除后清除；保护仍在编辑的元素，后到的旧compositionend不清除其他编辑器的状态。新增缺失compositionend的回归覆盖重进、重复消息与快速回到文字时的拒绝行为。**没有修改原生responder、扩大命令集合或生成计时重复键**；真实1.5秒按住与自动重复仍待Mac验证。

iOS桥宿主通过 `toolbarInlinePickers` 使用页面内控件：输入模式、压力、线型为有标签的radio组，颜色为#RRGGBB文字字段；所有原选项和任意24位颜色保留，仍调用原控制器，不增加文档历史。只有完整合法颜色提交，无效草稿离焦恢复。自由取色环打开同一设置面板，Tab聚焦不会弹系统色板。设置初始focus取已选radio，保证非默认模式也在实际Tab顺序里。Web/Android默认继续使用select/color。颜色字段由WebKit真实编辑路径处理Tab/Escape，离开后恢复非编辑桥；需要Mac确认软键盘布局和可信编辑事件。

新增只读 `window.__paintingToolbarKeyboard.snapshot()` 提供请求scope、已返回的Expo配置scope、composition元素连接状态与activeTag；不调用focus、不发布状态，也不改原观察器。若新head仍失效，用它区分DOM禁用与原生后续边界，勿再次盲改responder。

Mac按更新的 `ios-keyboard-trace.md` 重建/安装新head，先无LLDB跑原18项并复测“未选词IME取消→重进Escape→三个面板按住Tab”；保留快速菜单→文字首键和文字/IME/PencilKit回归，记录设置radio→颜色文字→range的逐步焦点、软键盘与事件可信度。原可信度门槛未变，是否接受桥的isTrusted=false由用户决定，不修改spec；4.2/4.3仍未勾。HAM-175保持blocked、PR #46保持Draft；本轮Swift补丁/探针未改，本机无xcrun/Apple LLDB，新候选没有原生运行结论。

本轮本机检查：Jest101套件/1332项、responder9项、配置3项通过；typecheck、库/Web build通过；lint 0 errors/原有32 warnings。原四份Chromium UI 42项及既有桥契约3项共45项通过（独立5296端口、2 workers）；测试/原HID观察器未修改。新iOS页面内控件由真实Toolbar的Jest集成用例覆盖：初始/非默认radio焦点、控制器选项与颜色更新、无效颜色草稿、Escape、Tab移入文字交接和Shift+Tab离开；Chromium旧入口没有启用iOS能力标志，不能据这45项推导新控件的iOS效果。格式/diff检查通过；未执行新的Swift或原生HID验收。

### HAM-175 Mac `dfccc31`（2026-11-06）：设置完整遍历仍失败

Mac从 `dfccc314c2957eaada725819c693abcaf3c2f223` 重建安装，iPhone17 Pro / **iOS26.5模拟器，idb脚本HID**，全轮无LLDB。Swift构建0 errors，主程序/debug dylib安装哈希与构建一致；该head未改Swift，哈希和前轮相同，新source/Metro与radio/HEX/snapshot记录JS身份。

18项均打开并最终关闭/退出，Escape归还触发器；但默认/PencilKit的设置Tab均radio→颜色→BODY，未经过range，关闭条件18/18不能代替完整遍历16/18。原可信度门槛下正式0/18。34次单键HID对应34个keydown（32 false / 2 true），无双发；全轮54个原生命令均accepted=1/error=nil。原结果及补充检查都保留。

未选词IME取消仍无compositionend，但composingConnected已清除，重进菜单首个Escape有效。工具/缩放/文字工具设置按住Tab1.5秒分别有8/1/4次回调；画笔/矩形设置只有1次，进入颜色文字后停止，不推导长按已全部通过。桥repeat=false不改写成实体键盘重复验收。

剩余两种缺陷：触摸radio或range更新值后落BODY、没有新focusin，request/ack scope均空，后续Escape/Tab无命令；颜色→已选radio同样失效。颜色文字实际可输入HEX、Escape可信且正常，但可信Tab默认遍历提前退出，跳过range。重开设置能聚焦已选finger。桥对象仍在，失效的是焦点与scope，不是已证明的UIKit缓存故障。

快速菜单→文字a/Tab/Escape各单次、可信、零桥命令；英文/IME提交取消/一次撤销、PencilKit点击与横滚所测通过。同进程回前台时菜单在发键前已消失，重开首个Escape有效，因果不混记。原始证据见附件 `HAM-175-dfccc31-ios-validation.md` / `HAM-175-dfccc31-ios-evidence.zip`；实体键盘、真机、Pencil仍未验。

### HAM-175 本轮候选：恢复触摸控件焦点，接管颜色 Tab 的默认遍历

iOS DOM helper在面板radio/checkbox/range的pointerup或click后，等待触摸默认操作完成，再恢复实际操作控件的focus，由现有sync发布新scope；支持label与range无click的拖动结束。新的交互会取消旧恢复，移除/卸载/隐藏/取消触摸或已进入文字、其他区域均不抢焦点。不在BODY保留旧scope，不阻止控件值更新，也不逐点发桥消息。

设置颜色字段的非组合态Tab/Shift+Tab保留原KeyboardEvent，仅preventDefault掉WebKit跳BODY的默认移动，微任务沿现有tabbable顺序前往range或已选radio。事件仍为原事件，可信度不改，不再dispatch第二次；面板离开关闭检查仍能看到原始焦点。外部文字编辑器、Escape、输入和IME处理保持原路径。Swift/命令集合/探针、本轮之前已验证的composition清理与scope/序号契约均未改。

Mac按更新runbook先无LLDB跑原18项，逐步确认完整遍历；重点增加radio改值/已选项、range拖动、checkbox触摸后紧接Escape/Tab，以及颜色→radio/range恢复和颜色Tab/Shift+Tab。保存真实触摸→focusin→request/ack→命令/DOM的顺序；快切文字/画布、触摸取消不得被迟到focus夺回。持续按住跨颜色字段另列，不以分次Tab通过推导。

本机无xcrun/Apple LLDB，新候选仍待Mac验证。原可信度门槛与spec不改，HAM-175保持blocked、PR #46保持Draft，4.2/4.3未勾。

本轮Linux检查：Jest102套件/1341项、responder9项、配置3项通过；typecheck、库/Web build通过，lint 0 errors/原有32 warnings。Chromium46项通过（独立5296端口、2 workers）：原45项保留，新增独立颜色字段契约用真实浏览器键盘确认Tab到range、Shift+Tab回已选radio，各保留一个可信事件，没有重发；这不是iOS HID验收。新增Jest覆盖radio/label、range无click、触摸取消/卸载/移除、快切文字/画布、键盘优先于过期触摸、颜色组合态与preventDefault保护；原Toolbar集成用例取消手工focus模拟，改为触发颜色Tab并断言实际移到range。原HID观察器/判定和既有UI断言未改。格式/diff检查通过；未执行新的Swift或原生设备验证。

### HAM-175 Mac `c21d53f`（2026-11-06）：基础行为通过，两个交接缺口

Mac从 `c21d53f5b10ee2255dc9d8f91dae648570c0ee02` 重建安装，iPhone17 Pro / **iOS26.5模拟器，idb脚本HID及模拟触摸**，全轮无LLDB。Debug构建0 errors，主程序/debug dylib安装哈希与构建一致；原输入、观察、矩阵和可信度判定脚本逐字节保留。不是实体键盘、真机或Apple Pencil验收。

关闭/焦点归还及完整遍历18/18，非编辑态radio/range/checkbox触摸后紧接按键32/32。44个单键HID对应44个DOM keydown（42 false / 2 true），无双发；包含补充检查的146个原生命令均accepted=1/error=nil。原可信度门槛下正式仍 **0/18**。颜色双向逐键Tab、真实HEX与颜色Escape、快速菜单→文字a/Tab/Escape首键、英文/IME提交取消/一次撤销、PencilKit点击/横滚所测通过。

补充检查仍有两个缺口：默认/PencilKit × 画笔/矩形持续按住Tab1.5秒，均只有首个桥回调，进入颜色后停止；颜色保持编辑焦点时实际拖动range，默认/PencilKit均0.95→0.1、有pointerup/change、无pointercancel，600ms后焦点仍在颜色、scope/ack均空。非编辑态同滑块正常。不能用逐键通过推导长按，也不能将颜色可信Escape关闭当作range已获焦点。原始证据见issue附件 `HAM-175-c21d53f-ios-validation.md` / `HAM-175-c21d53f-ios-evidence.zip`，无效点位和辅助监听重复的采集限制保留在报告中。

### HAM-175 新候选：旧颜色焦点交出与 Tab 命令连续性

触摸恢复记录操作开始时的颜色焦点及focus版本。完整pointerup后，只允许同面板、一直未变化的旧颜色编辑器让焦给实际操作控件；控件外抬起及其祖先click也保留这一手势身份。新交互、重新进入颜色/文字、取消、隐藏、移除仍拒绝旧恢复，不改变range数值。

长按候选在颜色字段保留同一scope，原生配置切到tabOnly，仅接管Tab/Shift+Tab；离开颜色到range切回完整命令。同一批UIKeyCommand对象贯穿往返，每次键仍由真实UIKit action驱动，无重复定时器、raw presses双路转发或伪造repeat/keyup。普通文字编辑/组合态关闭桥；颜色字符输入与Escape继续交给WebKit。**颜色Tab也可能变为isTrusted=false**，这是明确的路径变化，不修改原观察器、判定或spec来消除失败。

Swift补丁/API与lockfile同步更新，必须由Mac重建安装，不能只刷新Metro。本机没有xcrun，未编译Swift，长按修复尚未得到原生证明。只读snapshot新增tabOnly/acknowledgedTabOnly；原生命令payload带tabOnly，便于按scope/sequence与原DOM事件对应。Mac先无LLDB跑原18项，再做颜色焦点下range从滑块真正拖动（控件内/外抬起、紧接按键）及**持续按住**Tab1.5秒跨颜色，双向、松开静默和再按均保留；复测原32项、HEX/Escape、快切文字首键、IME与PencilKit，步骤详见 `ios-keyboard-trace.md`。

新增Chromium回归通过CDP真实触摸输入，在颜色仍获焦时把range从0.95拖到0.1、控件外抬起，确认可信input/change、完整pointerup且无cancel，随后range焦点与scope恢复、Tab前进。相同用例换回c21d53f helper明确失败在range获焦断言，新实现通过；没有用提前blur或手工focus规避。它证明DOM交接，不证明iOS长按或硬件验收。Jest补充旧颜色/新编辑焦点竞争、同scope连续Tab往返及颜色Escape/组合态拒绝；宿主契约同步覆盖新增tabOnly参数。

HAM-175保持blocked，PR #46保持Draft，4.2/4.3未勾。接受桥事件可信度差异的口径仍待修勾决定，不代替人类调整验收范围。

本轮Linux验证：Jest全量102套件/1345项、responder9项、依赖配置3项通过；最终追加颜色模式卸载/重挂载回归后，桥相关2套件/22项通过（含新增1项）。Chromium47项通过（独立5296端口、2 workers），含新增真实触摸拖动；旧helper对照在range获焦断言失败。typecheck、库/Web build、frozen install、代码格式/diff检查通过；lint 0 errors/原有32 warnings，最终生命周期改动定向lint通过。宿主/Toolbar单测同步新API和颜色Tab命令契约，原Mac HID输入/观察器/可信度断言均未修改。无本机Swift编译或新iOS原生验收结论。

### HAM-175 Mac `11893ba`（2026-11-06）：range与长按通过，兼容click恢复回退

Mac真实重建安装 `11893ba48cc7d81678ad2db71b03bac9a02e659a`，Swift/API编译482 warnings / 0 errors，主程序/debug dylib构建与安装哈希一致。环境为iPhone17 Pro / **iOS26.5模拟器、idb脚本HID/触摸**，全程无LLDB。原输入/观察/判定脚本逐字节沿用。

默认/PencilKit × 画笔/矩形的颜色焦点下range完整拖动12/12行为达成，内/外抬起、立即按键均有pointerup/change、无cancel，range获焦且tabOnly/ack=false。真实双向持续按住Tab1.5秒8/8跨颜色退出，同scope、颜色模式true、range模式false；松开后1.485–1.576秒窗口内无DOM或原生补发。原矩阵行为18/18，44个单键对应44个原生命令/DOM keydown、全部isTrusted=false，无双发，正式仍0/18；全轮213个命令均sequence唯一、accepted=1/error=nil。

radio/checkbox触摸交接回退24项：原32项为7项达成、24项失败、1项pointercancel；取消项另用完整手势重做达成，原取消记录不改。24项触摸后BODY、scope/ack空，700ms后仍不恢复、紧接Escape/Tab无效。原生重启、只留原观察器亦复现。原始顺序为pointerup→产品恢复focusin→兼容mousedown再次blur→mouseup/click→input/change仍BODY，released-click提前返回遗漏了后一次恢复。

颜色逐键双向Tab、HEX/可信Escape、快速菜单→文字首键、英文/IME提交取消撤销及未选词取消后重进Escape、PencilKit点击/横滚所测通过。颜色→checkbox诊断目标被软键盘裁剪，未验；不混入有效失败。原始报告/证据见issue附件 `HAM-175-11893ba-ios-validation.md` / `HAM-175-11893ba-ios-evidence.zip`。真机、实体键盘、真实Pencil及完整VoiceOver仍未验。

### HAM-175 新候选：click后复用原手势再次恢复

产品修复仅在released-click分支：以原Touch的origin/focusVersion再次安排下一帧恢复，覆盖兼容鼠标默认动作之后的状态。pointerup仍覆盖没有click的range拖动；祖先click也保留原手势，旧颜色让焦和新编辑焦点保护使用同一记录，取消/移除/卸载仍能作废恢复。原生命令、Swift/API和持续Tab路径沿用11893ba版本。

新增radio与checkbox各一条浏览器时序回归：等待pointerup恢复完成，重放Mac的兼容mousedown默认失焦，click实际更新checked后断言产品再次恢复焦点/scope并可Tab前进。旧helper两项均失败在click后获焦，新候选通过。Chromium不实现UIKit这段默认行为，fixture明确模拟失焦；不手工focus目标、不作为原生HID结果。既有CDP真实触摸range外抬起用例继续通过。单测另覆盖click后新颜色/文字获焦、pointercancel、移除及卸载保护。

Mac按runbook先无LLDB跑原18项，再重跑32项触摸及颜色→radio/label，保存pointerup恢复、兼容mousedown失焦、click后再次恢复和scope/命令的顺序；保留range12项、双向长按8项与松开静默、快切文字首键和IME/PencilKit。原判定不变，HAM-175保持blocked，PR #46仍Draft，4.2/4.3未勾；本机无xcrun，不声称验证Swift或新原生行为。

本轮Linux验证：Jest102套件/1353项、responder9项、依赖配置3项通过；Chromium49项通过（独立5296端口、2 workers）。新增两条兼容时序用例在11893ba上失败、新候选通过；既有真实触摸range外抬起及工具栏回归通过。typecheck、库/Web build、代码格式/diff检查通过，lint 0 errors/原有32 warnings。原HID输入、观察器、可信度判定、Swift/API和spec均未改。浏览器fixture的显式失焦重放只证明DOM恢复逻辑，iOS兼容事件及立即按键时序仍需Mac实测。

### HAM-175 Mac `5e5be90`（2026-11-06）：基础矩阵收敛，三个颜色交接边界待修

Mac从 `5e5be90cb637e42655b947e1582fc102ea058a53` 重建安装，编译482 warnings / 0 errors，安装产物哈希匹配。环境仍为iPhone17 Pro / **iOS26.5模拟器、idb脚本HID/触摸**，全程无LLDB。原18项行为18/18，44次单键对应44个命令/DOM keydown、全部false，无双发，正式0/18；全轮累计265个命令均sequence唯一、accepted=1/error=nil。

原32项触摸32/32，包含radio/checkbox24项；手势返回直接发HID，中间无读取、等待或scope轮询。颜色下range拖动12/12、双向真实长按1.5秒8/8，松开后1.502–1.526秒内无DOM/原生补发。英文键盘下HEX/可信Escape4/4、快速菜单→文字首键、英文/IME提交取消撤销及重进Escape、PencilKit点击/横滚所测通过。这些均为局部行为结果，不替代正式可信度或真机验收。

颜色→radio input/label补充16项中，首键焦点/scope16/16，完整行为14/16。默认入口/矩形的两个label用例未改选，Tab还提前退出BODY。11:09:22.074 pointerup目标LABEL，.075颜色focusout→未选finger focusin，.147兼容mousedown/click目标DIV；.163桥恢复未选radio焦点，.412 Tab退出。组件是原生HTML label/input，桥没有阻止指针默认事件；证据支持提前程序focus导致颜色失焦、布局变化赶在兼容命中之前的假设，原记录没有逐帧几何，尚不能称原生根因全部证实。focus并不等于checked，不能改遍历规则掩盖未激活。

另两处异常：拼音颜色Escape没有DOM投递，现场composingConnected=false、tabOnly/ack=true，切英文后同字段可信Escape有效；PencilKit颜色→radio→Tab回颜色时原生英文键盘仍可见，DOM innerHeight/visualViewport.height却622，设置按钮原生y794位于键盘下，清理点击实际输入Space。它们没有同序列旧head对照，不定性为新增回归。原始报告/证据为issue附件 `HAM-175-5e5be90-ios-validation.md` / `HAM-175-5e5be90-ios-evidence.zip`。

### HAM-175 新候选：延后label让焦、拼音Escape门控、按原生frame约束宿主

颜色→label的手势等真实click激活后再安排恢复，保留原origin/focusVersion；range及直接input的pointerup路径继续保留。新增浏览器回归固定触摸坐标，重放颜色blur引发重排及延迟兼容命中：旧helper命中背景、新helper命中label并由默认动作改选，随后Tab到颜色。没有改测试坐标、手工设置checked或补发激活。该fixture证明控制流及其布局后果，不冒充UIKit实测。

颜色请求tabOnly时，Swift候选读取该WebView内first responder的公开textInputMode与UITextInput.markedTextRange。仅primaryLanguage以zh开头、原生明确无marked text时注册Escape例外，payload标记colorEscape；DOM仍校验当前scope/焦点/composition再接收。未知原生编辑状态或正在组合时不接管；英文颜色Escape保留WebKit路径。拼音例外事件如实为false。新增`[HAM175 color-route]`状态日志及payload的inputLanguage/markedText用于辨别门控未开启和命令未回调，必须由Mac证实公开读数及实际路由。

iOS宿主改用原生will/did frame通知和measureInWindow的同一坐标系限制WebView高度，包含PencilKit头部与safe-area偏移；will阶段只提前收紧，确认did frame/hide后才释放，不在willHide时立即扩成全高。RN原KeyboardAvoidingView只监听willShow/willHide，现有日志未采原生frame，故这是基于代码缺口的候选，并非已证明现场通知顺序。新增`[HAM175 keyboard-frame]`/`[HAM175 keyboard-layout]`只记通知、坐标和高度，不记录输入文字。宿主测试覆盖中断hide、没有新willShow的frame变化、窗口偏移、旧measure回调和卸载；原生画面/DOM同步仍需Mac对照。

本版Swift补丁/lockfile已更新，需Mac重建安装。原输入/观察/矩阵判定不改，按runbook保留18/32/12/8组，增加颜色label固定点位、拼音空闲/组合/结束后的Escape与英文对照、PencilKit颜色往返时的原生frame/宿主高度/DOM/AX/截图联合证据。本机没有xcrun，不声称Swift编译或iOS通过；HAM-175保持blocked、PR #46保持Draft，spec与4.2/4.3不改。

本轮Linux：Jest103套件/1358项、responder9项、配置3项通过；Chromium50项通过（独立5296端口、2 workers）。最终宿主generation清理调整后，iOS宿主3项定向复测通过。typecheck、库/Web build、frozen install、代码格式/diff检查通过。新增可选`trace_toolbar_handoff.js`被动记录低频事件及下一帧/resize几何，不读取输入值；浏览器smoke确认不妨碍checked默认动作、包含矩形、无输入文本、stop后不再记录。此脚本仅用于原矩阵之后的诊断，原HID输入与observe/matrix/metrics均未修改。

最终lint为0 errors/原有32 warnings，新增宿主的cleanup告警已修正并定向验证，最终playground类型检查通过。

### HAM-175 Mac 96625b6：只剩拼音颜色Escape投递，正式判定仍未通过

Mac真实重建安装96625b64569dd53b753fa1a1ea8932ac9dc5b520，Swift编译482 warnings / 0 errors，主程序/debug dylib安装哈希匹配。iPhone17 Pro / **iOS26.5模拟器、idb脚本HID/触摸**，全程无LLDB；不是实体键盘、真机或Apple Pencil验收。原18项行为18/18、触摸32/32、range12/12、真正双向长按1.5秒8/8且松开无补发；颜色→radio input/固定点位label16/16，原失败点位恢复实际label默认改选。44次矩阵HID对应44原生命令/DOM事件，全部isTrusted=false、无双发，原正式判定仍 **0/18**。

拼音空闲/组合结束后4次，加先选拼音再新scope2次，均zh-Hans、marked=false、escapeBridge=true，scope/ack非空但零命令投递/DOM keydown，面板不关闭；这是行为失败，不能归入仅可信度失败。英文同字段和HEX可信Escape正常。组合中DOM已经主动清空scope/ack，Escape产生可信compositionend并恢复新scope，不能单独把“没桥关闭”归功于Swift门控。原始报告及ZIP见issue附件`HAM-175-96625b6-ios-validation.md`、`HAM-175-96625b6-ios-evidence.zip`（SHA256 7a61d0c65d9f11df0af0005d0818f256598acbb61f7fd309a3a722dca1b287e5）。

PencilKit颜色往返的稳定遮挡未复现：键盘显示时DOM/canvas280高，工具栏底部在键盘上24点；隐藏后622。宿主中间有约15/18ms未限制maxHeight状态，DOM没有记到中间全高；不能据稳定截图保证逐帧没有遮挡。快速菜单→文字首键、HEX、英文/真实拼音提交取消撤销、未选词取消重进、PencilKit点击横滚所测保留。

### HAM-175 新候选：命令选择分段取证，尚未修复拼音Escape

当前color-route是共享门控函数的状态日志，不能区分keyCommands查询、canPerformAction、target选择与真正action入口。本候选只增加默认关闭的Debug `HAM175KeyboardRouteTrace`，记录实际返回命令/对象身份/priority、公开responder next链、校验返回、super原target、guard前action入口及拒绝/转发边界。所有原返回值、命令集、中文门控、DOM组合scope和触摸交接保持原逻辑；不做无证据的responder替换，不加入raw presses双发路径。日志有上限与显式overflow，诊断开启/关闭须独立复测。

新增`check_color_escape.py`读取原Mac观察器产物与native NDJSON，另行核对拼音门控、实际投递、关闭归还、重复事件及组合scope；不改原输入/观察/矩阵断言。真实96625b6记录裁剪为离线回归fixture：zh-Hans门控已开但没有action/DOM仍判失败，英文不能代偿。完整原包复核6次拼音失败、2次组合取消和2次英文对照与报告一致。离线测试是证据判定器验证，不是中文IME或Swift执行。

新补丁/lockfile需Mac真实重建；本机无xcrun，未编译Swift、未获得新原生结果。Mac步骤见`ios-keyboard-trace.md`：先诊断关闭跑保留组，再诊断开启按默认/PencilKit重复拼音空闲/组合/结束/新scope及英文，保存scope、commands/validate/target/action、原DOM与真实HID时序，再关闭诊断对照。HAM-175保持blocked、PR #46保持Draft；spec及4.2/4.3不改，可信度验收口径仍待用户决定。

Linux本轮验证：Python26项（新增证据判定回归8项）、桥接/宿主Jest4套件36项、依赖契约3项、frozen install、新增文档片段/fixture格式与diff检查通过。新增Mac单键入口`probe_color_escape_hid.py`复用原harness，只发一次idb HID Escape，校验实际拼音日志而非英文代偿；本机只能验证参数入口及拒绝非macOS，未执行此原生用例。本轮未改DOM/宿主交互代码，未重复声称浏览器或原生保留组通过。

### HAM-175 Mac 4c4fec2：诊断代码编译失败，未安装

Mac arm64 / Xcode27.2面向iPhone17 Pro / iOS26.5模拟器真实构建4c4fec2，依赖/prebuild/Pods成功，143秒后Swift编译失败：诊断字段`NSStringFromSelector(command.action)`将`Selector?`直接传给非可选参数。未安装，18/32/12/8、拼音HID单键诊断及关闭诊断对照全部未验；不能沿用旧版本运行结果。证据为issue附件`HAM-175-4c4fec2-ios-validation.md`及同名evidence.zip。

修正仅为诊断字段安全解包：`command.action.map { NSStringFromSelector($0) } ?? "nil"`。同文件另一处command.action传入的参数本身是Selector?，记录前已有if let；command.input使用可选比较或guard解包，modifierFlags和wantsPriorityOverSystemBehavior为非可选。门控、命令及DOM路径不变。新补丁仍须Mac重建，本机无xcrun、不声称Swift编译通过；HAM-175保持blocked，PR #46为Draft，4.2/4.3未勾。

### HAM-175 Mac f21a1ee：编译恢复，拼音停在查询与action入口之间

Mac arm64 / Xcode27.2真实重建安装f21a1ee964a268186e16c8e1b37c530134ab6397，180秒、457 warnings / 0 errors，主程序/debug dylib构建与安装哈希匹配。环境仍为iPhone17 Pro / **iOS26.5模拟器、idb脚本HID/触摸**，全程无LLDB。关闭诊断的18/32/12/8组行为达成；44次矩阵HID对应44命令/DOM键、全false、无双发，正式仍0/18；长按松开后1.482–1.508秒无补发。额外label16项、独立文字提交/撤销/取消、横滚未在此head重跑，不继承旧结果。

两入口各五态、开/关诊断共20个窗口各一次Escape，10对结果/焦点一致。六个非组合拼音窗口均zh-Hans、marked=false、gate放行，返回Escape/priority=true、validate=true、target=当前WebView、owner在next链；无action-enter/guard/payload/DOM。关闭诊断后同六项失败；组合取消与英文可信Escape各四次成立。traceSequence1–1318连续、无overflow，有35次action正对照。证据只收窄到查询之后、action入口之前，尚未证明具体哪层终止。

统一日志长JSON严重截断，实际分析使用完整console及逐行核验的native-console-normalized.jsonl；4项事后解析错误只重做离线检查，未重发键。另有一次测量前Expo app-context丢失崩溃，重启后恢复，原因未定。原报告/ZIP为issue附件HAM-175-f21a1ee-ios-validation.md及HAM-175-f21a1ee-ios-evidence.zip，全部为模拟器脚本输入，非真机/物理键盘结果。

### HAM-175 最后一轮候选：公开容器对照与有界分层取证

新增默认关闭的Debug `HAM175EscapeCommandOwner` 实验：webview为原路径；color-container仅把原gate已放行的中文颜色Escape交给既有DomWebView容器，同一命令对象/selector/priority，原WebView不再认领该Escape；menu-container-control仅用于非编辑Escape的真实HID阳性对照。容器的真实UIKit action仍经过原处理函数/DOM校验，不添加raw presses转发、不改Tab/组合态/DOM触摸路径。原18/32/12/8先在默认模式无LLDB复验。

trace_keyboard.py新增escape预设：读取UIKeyboardImpl公开命令前处理的匹配BOOL返回、UIApplication sendAction的实际sender/target及返回、WK try匹配返回与entry/completion。私有方法先在暂停时校验实际ABI，缺失/不符只记entry或unavailable，不猜handled；键期间不执行getter。计划限定一次构建、最多30个单键窗口与一次结果交回，详见ios-pinyin-escape-final-round.md的假设/对照/停止表。

若全部证伪且有效A/B仍无action/DOM，记录“拼音 + 颜色字段下UIKeyCommand不可达”，限定于本机型/系统/宿主及已测owner；无法区分则如实保留根因未定，均不追加取证轮次。当前仅交付待Mac重建的实验候选，本机无xcrun、未编译Swift或执行新HID；HAM-175保持blocked，PR #46保持Draft，spec及4.2/4.3未改。接受桥事件与平台限制的口径仍由用户决定。

本轮Linux：Python探针/证据测试30项（新增4项校验私有ABI、派发身份和未知签名处理）、桥接/宿主Jest4套件36项、依赖契约3项、frozen install及新增文档格式/diff检查通过。既有输入、观察器、判定及DOM交互代码未改；这些检查不覆盖UIKit实际命令选择或Swift编译。
