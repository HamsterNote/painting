# 工具栏验证

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

| 设备 / 系统 / 浏览器或宿主 | 输入来源 | 待验项与实际判定 |
| --- | --- | --- |
| iPhone 18 Pro 模拟器 / iOS 27.2 / 上述 dev client | 启动请求、深链接 | **失败**：UIKit 报 `UIScene life cycle is required for apps built with this SDK`，SIGTRAP，未进入编辑器；构建成功不等于启动通过 |
| iPhone 17 Pro 模拟器 / iOS 26.5 / 上述 dev client | idb 注入模拟触摸、HID 键盘 | **安全区 / 胶囊未通过**：状态行 y=10 与系统状态栏重叠；初次胶囊 AX 宽 26pt、仅露左缘，后续 x=16 / 宽 370pt；稳定底部位置仍需复验 |
| 同一 iPhone 17 Pro 模拟器 | 同上 | **内部横滚所测操作通过**：可从工具组滚到画布操作与调色板；独立收起按钮保留 |
| 同一 iPhone 17 Pro 模拟器 | 同上 | **键盘 / 文字部分通过、有缺陷**：能聚焦、显示英文软键盘、输入 `nihao` 并完成保留；靠右创建文字时完成按钮中心 x=430.5，超出 402pt 屏宽 |
| 同一 iPhone 17 Pro 模拟器 | 同上 | **弹层 / 焦点部分通过**：菜单打开、选择文字、聚焦成功；Tab / Escape / 焦点返回完整矩阵未覆盖 |
| 同一 iPhone 17 Pro 模拟器 / `pencilkit=1` | 模拟触摸；原生笔输入计数均为 0 | **PencilKit 工具栏触摸子项通过**：`gesture-ancestor` 状态可打开菜单、切文字，所测点击未吞；无法推导原生笔书写、压力、跨边界通过 |
| iPad Pro 11-inch (M5) 模拟器 / iPadOS 27.2 / Safari 27.2 (AppleWebKit 605.1.15) | idb 模拟触摸、HID 键盘，`pointerType=touch` / `pen=0` | **中文 IME 模拟器部分通过**：输入 `nihao` 出现“你好”候选，触摸选词并完成后保留；系统取色器面板外观通过，颜色提交未验 |
| 实体 iPad / 发现为离线设备，系统 18.7.11，型号与 Safari 版本无法读取 | 无可操作设备 / Apple Pencil | **无法验证**：30 笔快速短笔、跨工具栏边界、系统选词后首击、真机中文 IME 与原生取色器均待设备 |
| Android / 第一轮无在线 adb 设备、无 emulator 与 AVD | 无 | **第一轮无法验证**：第二轮已建立 API 36 AVD，最新结果见下表；不等待 Android 才交付 iOS 修复 |

第二轮 Mac 验证（HAM-164 评论 `01a1a5aa-d3b1-72b5-a78b-f7a36c3a4a9f`，2026-11-04，仍为修复前 `e97f9fe`）：

| 设备 / 系统 / 宿主 | 输入来源 | 实际判定 |
| --- | --- | --- |
| Pixel 7 配置 AVD / Android 16 API 36 ARM64 / Playground 0.1.0 (1)，Expo 57.0.24、RN 0.86.3、System WebView 133.0.6943.137 | ADB 模拟触摸与键盘，Gboard；Temurin 17 构建、ADB 安装并连接 `dev:native` Metro | **默认入口安全区 / 胶囊失败**：画布宽 0、胶囊仅露左缘 |
| 同一 Android AVD，诊断入口 | 同上 | **内部横滚子项通过**：scrollLeft 0→254→0，页面横向滚动为 0；不能替代默认入口验收 |
| 同一 Android AVD，默认入口 | 同上 | **文字提交子项通过、布局失败**：提交 `Android57` 成功；文字框右缘约 602px，屏宽约 412px，完成按钮在屏外并被键盘遮挡 |
| 同一 Android AVD | ADB 键盘 | **所测焦点子项通过**：Escape 关闭工具菜单 / 缩放弹层并回各自触发按钮；Tab 可遍历，末项离开并关闭，无弹层闭环 |
| iPhone 17 Pro / iOS 26.5 | idb HID 输入通道 | **无法验证键盘矩阵**：`dtuhidd connection ... invalidated`，换工具 / 重启仍无可信响应；不是产品通过或失败结论 |

第二轮结束已停止 Metro、AVD、代理与 iPhone 17 Pro，保留单一 API 36 AVD 和 dev client 供新 head 回归。以上均为模拟器结果，不替代实体设备结论。

第三轮设备回归（HAM-164 评论 `01a1a60a-7f4f-7925-ba00-ec1bcaabdb3d`，附件 `HAM-164-round3-validation.md`，head `7e7d062`）：

| 设备 / 项目 | 实际判定 |
| --- | --- |
| 同一 Pixel 7 AVD / Android 16 API 36 / System WebView 133，默认入口 | **所测布局恢复**：画布 412.19×839.24 CSS px，胶囊 x16、宽380.19、底823.24；内部横滚通过、外页 scrollX=0。顶部系统状态文字对比不足，未据此宣告安全区全部通过 |
| 同一 Android AVD / 弹层与焦点 | **Escape 与归还通过**：工具、缩放、设置分别关闭并回触发按钮；Tab 经过实际控件后离开并关闭，无层内闭环 |
| 同一 Android AVD / 系统键盘 | **仍失败**：Gboard 实际可见时 innerHeight / visualViewport 高仍约839.24，右下 textarea / 完成 / 取消被覆盖；退出再进默认页后仍复现。横向限位已通过，隐藏键盘后可完成提交 |
| 同一 Android AVD / 两处 P2 | **专项通过**：25% 提交并重开100个“汉”，文档与内容高度均300px；祖先仅 translate(20px,30px)，resize事件0，浮层同步移动。输入来自CDP，不是系统中文IME结论 |
| iPhone 17 Pro / iOS 26.5、iPhone 18 Pro / iOS 27.2 / 新 dev client | **构建与所测启动通过、稳定布局改善**：iOS27.2不再启动即SIGTRAP；实际进入默认编辑器，稳定画面的安全区与胶囊正常，26.5胶囊x16、宽370、底824。尚未覆盖全部冷启动瞬时首帧 |
| iOS 26.5 / 横滚、软键盘、焦点与 PencilKit 点击 | **无法验证，输入通道问题**：HID触摸 / Tab / Escape连接失效，Simulator前台System Events仍超时。PencilKit已启用并收到gesture-ancestor配置回执，但不能用AX激活替代真实点击结论；由人工或恢复通道后补验，不在本次Android修复范围 |

第四轮 Android Gboard 续修验证（HAM-164 评论 `01a1a61d-f7f7-7202-a2d4-b8c819c9e5f4`，附件 `HAM-164-round4-validation.md` / `HAM-164-round4-evidence.zip`，head `a97818e16a15b046eaabffe7cbd394799a2e33fb`）：

环境为 Pixel 7 配置 AVD / Android 16 / API 36 ARM64，Playground development client 0.1.0 (1)，Expo 57.0.24 / RN 0.86.3 / @expo/dom-webview 57.0.1，System WebView 133.0.6943.137，Gboard 15.1.08.726012951-preload-arm64-v8a。默认入口已确认加载新 Metro Android / DOM bundle，未启用 diagnostics，也未改写视口或 CSS。输入为 ADB 模拟触摸（含 Gboard 按键、完成 / 取消 / 撤销）与文本注入，菜单选文字使用 CDP 点击。**以下仅为模拟器所测场景通过，非 Android 真机、非中文 IME 或手写验收。**

| 场景 | 第四轮实际判定与证据 |
| --- | --- |
| 字母键盘 / 表情面板高度切换 | **通过**：无键盘 innerHeight / visualViewport.height 为839 / 839.238 CSS px，字母模式527 / 527.238，表情模式403 / 403.048。原生外层仍为完整高度，内部宿主及直接 WebView 底边实际从2337→1517→1192设备像素，缩至键盘上方；以稳定态记录，不宣告所有过渡帧无延迟或闪动。证据 `typed.*`、`keyboard-stable.png`、`emoji-stable.*` |
| 键盘可见时完成 / 一次撤销 | **通过**：完成 / 取消均在可见区域内并可实际触摸；完成提交恰一段 `AndroidRound4g`，一次撤销后对象归零、撤销禁用且重做可用。证据 `committed.*`、`undone.*` |
| 键盘可见时取消 | **通过**：新建 `CancelRound4` 草稿后实际触摸取消，编辑器关闭、对象仍零、撤销仍禁用且重做仍可用，未新增对象或历史。证据 `cancel-draft.*`、`cancelled.*` |
| 高度变化、隐藏 / 重开期间草稿与焦点 | **通过**：隐藏后高度恢复839，重开字母键盘回到527；同一 textarea 和页面观测标记保留，草稿不变、焦点持续为“文字内容”，未收到 focusout。完成 / 取消后 textarea 正常销毁、焦点 BODY，不描述为回到工具按钮。证据 `hidden.*`、`reopened.*` 及焦点观测 |
| 退出 / 重进默认页 | **行为已确认**：带 `LeaveDraft` 离开至另一原生路由再返回后，创建新编辑器、观测标记消失、未提交草稿不恢复，焦点 BODY、对象与历史均空；再次编辑可唤起 Gboard、缩至527并取消。不是跨页面草稿持久化通过。证据 `before-leave.*`、`away.*`、`reenter-default.*`、`reenter-keyboard.*` |

第四轮未扩大为全部4.3或真机结论。iOS26.5交互仍需人工 / 恢复输入通道，实体iPad + Apple Pencil仍缺；4.2 / 4.3保持未勾选，HAM-164继续 `blocked`。

### 修复范围与本机验证边界

- 通过 `apps/playground/plugins/with-ios-scene.cjs` 持久化 UIScene 迁移：Info.plist 注册 Expo 57 自带的 `EXExpoAppSceneDelegate`；AppDelegate 提供 RN factory，由 scene 创建窗口并启动 RN。保留 dev-client bundle URL 与冷 / 热深链接委托，移除 AppDelegate 重复启动。无需手改被忽略的生成工程；模板不兼容时 prebuild 显式报错。
- 原生编辑器宿主在 RN 层消费四边安全区，根 Provider 使用初始窗口 metrics；DOM 容器与 WebView 显式占满宿主宽度，关闭 WebView 的自动重复 inset。iOS 使用 KeyboardAvoidingView；Android 初版仅依赖系统 resize，第三轮证实 API 36 宿主未随 IME 收缩，现改为订阅 `keyboardDidShow` / `keyboardDidHide` 并读取已有 `Keyboard.metrics()`。用键盘顶部减容器实际窗口坐标，限制内部 WebView 宿主的 maxHeight，键盘变高 / 关闭与容器重排均更新。以高度上限避免已生效的系统 resize 被重复扣减；不重挂载 DOM，既有草稿与焦点保持。Web 路由保留原入口。
- 胶囊外壳改为明确的 left / right 约束，内部声明固有宽度再按宿主限宽，避免依赖首帧逻辑 inset / shrink-to-fit 的组合。实际 26pt 首帧问题是否完全消除，必须冷启动设备复验。
- 文字编辑 UI 改为独立 HTML 浮层，SVG 锚点保留对象 / viewport / 页面祖先变换的实际投影，操作面板保持正向并约束到所属画布与 visual viewport 的交集；随宿主 resize、可见视口 resize / scroll 更新。输入区可缩小并内部滚动，操作区换行，保持完成 / 取消可达；字号至少 16 CSS px 避免 iOS 聚焦自动放大。编辑浮层的避让不修改文档坐标、对象 transform、viewport 或撤销历史，提交仍走既有 IME session。
- 审查 P2 修复：长文字高度通过独立隐藏节点按文档宽度、字号及行高测量，避免 25% 缩放时用浮层换行高度写回导致裁切；已有对象的自定义行高保留。监听 SVG 锚点至页面祖先的属性 / 类变动、尺寸与 CSS 动画，纯平移、缩放、旋转无需额外触发 window resize 即可更新浮层，动画结束后停止逐帧跟随。

修复执行环境为 Linux / Node 24.15.0 / pnpm 10.28.2。调用模拟器工具返回 `spawn xcrun ENOENT`，本机没有 Xcode / iOS 运行时，**未在本机执行 iOS 26.5 / 27.2 启动与系统键盘自查**。Mac 第三轮已覆盖所测构建 / 启动，第四轮已在 `a97818e` 覆盖 Android Gboard 续修场景，结果见上；iOS交互输入通道缺口仍保留。各轮设备结果以各自 head 为准，`19a7d46` 仅作基线。浏览器测试使用独立 5276 端口，避免复用 HAM-156 的旧服务。

| 本轮命令 / 检查 | 结果 |
| --- | --- |
| `pnpm test` | 98 套件 / 1318 项通过（含新增 Android 键盘事件 2 项），responder 9 项通过，Expo 模板迁移 / 重复执行 / 异常模板测试 2 项通过 |
| `pnpm typecheck` | painting / painting-board / playground 全部通过 |
| `pnpm lint` | 0 errors，已有 32 warnings |
| `pnpm build` | 库构建 / 类型产物 / Expo Web export 全部通过；不等同原生 Swift 编译或设备启动 |
| iOS `expo prebuild --platform ios --no-install`，再次执行并比较哈希 | 通过：生成的 AppDelegate / Info.plist 重复生成不变；RN 仅由 Expo scene delegate 启动 |
| Chromium 专项 UI | 既有38项通过；新增Android宿主高度回归1项修正撤销版本号断言后单独重跑通过，共39项覆盖。`mobile-editor-layout`、`painting-toolbar`、`toolbar-round4`、`interaction-feedback` 四份 spec，2 workers |
| `pnpm --filter @hamster-note/painting-playground build:android` | 通过：Android Hermes bundle 与 Expo DOM bundle 均已导出；不等同 API 36 Gboard 设备验收 |
| WebKit 专项 UI | **无法运行**：默认 Ubuntu 26.04 不支持安装；下载 Ubuntu 24.04 兼容构建 WebKit 26.4 后仍缺 ICU74、libxml2、libevent、libflite、libavif、libmanette、libwoff、GStreamer 等宿主库。13 项在浏览器启动前失败，无页面行为结论 |

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

| 子项 | B 轮实际结论 |
| --- | --- |
| 胶囊内部横滚 | **所测场景通过**：scrollLeft 0→457→601→0，外页 scrollX / scrollY 始终为0 |
| 系统键盘与文字框 | **所测场景通过**：脚本触摸聚焦、输入英文；键盘出现时 innerHeight / visualViewport 722→353，完成 / 取消均可触摸；完成后一次撤销移除，取消另一草稿不新增历史 |
| PencilKit 不吞工具栏点击 | **所测点击通过**：显式启用并收到 `gesture-ancestor`，脚本触摸可打开工具菜单、缩放并横滚；原生笔计数0，不推导实体笔通过 |
| 工具菜单、缩放弹层 Escape / Tab | **不通过，已定位为产品缺陷**：原生 UIApplication 已接收 Escape（keyCode41）/ Tab（43），DOM 无 keydown，弹层保持打开，焦点停在菜单项或 BODY。触摸缩放滑条重试仍复现。不是“按键未进入模拟器”的工具链缺口 |
| 文字框 Escape / Tab 阳性对照 | **通过**：同一注入命令与记录器，Tab / Escape 到 DOM 约55 / 47ms，`isTrusted=true`；分别移到字号、取消草稿。不能推广为弹层键盘通过 |
| 设置弹层键盘、系统中文 IME | **本轮未覆盖** |

### b50496f 首版实现与验证边界（历史记录，后续原生回归已失败）

首版依据的 B 轮日志确认了原生→DOM传递中断，但当时没有记录失效时的 first responder；“需要补原生响应者”只是首版假设。下文 Mac 回归已确认失效时存在 WKContentView responder，首版假设不足以解释缺陷，不再沿此方向追加调用。

通过 pnpm 的 `@expo/dom-webview@57.0.1` 补丁增加 iOS 原生 `requestFocus` 方法，调用公开 `WKWebView.becomeFirstResponder()`，由 WebKit 将响应者交给内容视图。原生路由在 DOM 挂载就绪、非编辑控件 focusin 或工具栏 / 面板 pointerdown 后请求焦点；同一事件循环合并请求，非交互画布笔迹不产生逐点桥调用。监听卸载时清理，不替换 WebKit 的键盘事件或构造 DOM keydown。Android 不注册该 iOS action，Web 保留直接 DOM 入口。

采纳补充分支 `agent/ham175-toolbar-tab-supplement`（`24223be`）的DOM退出处理与双向Tab回归要点：保留浏览器默认遍历，待Tab默认操作完成后，焦点离开面板即关闭（含回到同一工具栏），不夺回新焦点；卸载时清理待执行检查。Escape仍归还原触发器。B轮证据合并在上表，仅保留本分支实际执行的测试结果，不重复记录补充分支的历史测试数字。

DOM 侧跳过正在输入的 textarea、文本 / 数字 input、select 和 contenteditable；原生方法在异步跨桥后重新读取当前 activeElement，再决定是否请求焦点，避免迟到的弹层请求打断文字或 IME。range / checkbox 等非文本控件允许获取响应者。此变更包含 Swift，**必须重新安装依赖并重建 iOS development client，单纯刷新 Metro 不会安装原生方法**。

本机为 Linux / Node 24.15.0 / pnpm 10.28.2。模拟器工具实际返回 `spawn xcrun ENOENT`，没有执行 iOS Swift 编译或 iPhone 17 Pro / iOS 26.5 回归。因此本次状态为：**修复实现已提交验证；修复后弹层键盘路由尚待模拟器确认，不能记为通过**。下列自动化只证明桥契约与浏览器行为，不证明原生按键可达。

| 本机检查 | 结果 |
| --- | --- |
| `pnpm test` | 100套件 / 1322项通过；responder 9项；原生配置 / 补丁依赖检查4项通过。包含真实 Expo action registry / ref 转发、DOM就绪请求、非编辑交互、编辑态保护、异步请求清理和原生侧JS守卫；不等于Swift运行测试 |
| `pnpm typecheck` | painting / painting-board / playground 通过 |
| `pnpm lint` | 0 errors，已有32 warnings |
| `pnpm build` | 两库构建与 Expo Web export 通过 |
| Chromium 专项 UI | 42项通过（既有39项及新增三类弹层Escape焦点归还 / Tab离开关闭）；使用独立5285端口，未复用其他任务服务。包括文字composition提交 / 取消、一次撤销、Android宿主高度变化和笔迹 / 工具栏回归 |
| iOS / Android `expo export` | 两端Hermes与DOM bundle均导出通过；只验证静态依赖解析，不证明Swift编译或原生运行 |
| WebKit | 无页面结论：本机缺少本版本所需的webkit-2272；安装命令失败，`Playwright does not support webkit on ubuntu26.04-x64`，不把其他已安装WebKit版本当作本版本测试 |
| `pnpm install --frozen-lockfile` / `git diff --check` | 通过；4.2 / 4.3仍未勾选，未改规格 |

### Mac 必须补齐的修复后回归

1. 取 HAM-175 的 PR head；执行 `pnpm install --frozen-lockfile`、`pnpm prepare:playground-artifacts`，重建并安装 iOS development client。只连接原来的0.1.0(1)安装包、刷新JS不足以验证Swift补丁；记录实际构建SHA。
2. iPhone 17 Pro / iOS 26.5 模拟器从默认入口进入，不启用 diagnostics。冷启动后，分别打开工具菜单、缩放、设置：用相同 idb HID 路径发 Escape，验证真实 DOM keydown、弹层关闭且 activeElement 回各自触发器；重开后用 Tab / Shift+Tab 经过实际控件并离开，验证自动关闭且不困住。同步保存原生 / DOM 事件、`isTrusted`、焦点和截图，不能以 `dispatchEvent` 替代原生输入。
3. 文字框英文与中文 IME 输入、候选选词、完成 / 取消 / 一次撤销；文字框 Tab 到字号、Escape 取消，再开三类弹层重复第2步，检查原生焦点可恢复且无重复键或软键盘误弹。补后台 / 前台及离开 / 重进后的首次按键。
4. 重新检查横滚、软键盘布局；显式启用 PencilKit 后重复工具栏点击与弹层键盘矩阵。Android 继续复用 API36 AVD 验证既有 Escape / Tab 和 Gboard 高度路径，不以iOS修复推导Android通过。

4.2 实体笔五项继续待 iPad + Apple Pencil。归档 `tasks.md` 的4.2 / 4.3保持未勾选；HAM-175 的原生回归结果应另行写入本节，HAM-164 最终验收以实际设备证据为准。

### HAM-175 Mac 原生候选回归（2026-11-05，b50496f）：不通过

实际构建 `b50496f30531e1275e821109518a9f0c2e506e28`（PR #46），arm64 / macOS 27.2 / Xcode 27.2，iPhone 17 Pro / iOS 26.5 **模拟器**，development client 0.1.0(1)。frozen install、库产物、iOS prebuild、pod install 通过；真实 Debug build / install / launch 成功（533704ms、编译错误0）。已核对安装的可执行文件及debug dylib与构建产物SHA-256一致，包含requestFocus符号；原生栈实际经过 `DomWebView.requestFocus()` 完成闭包 → `WKWebView.becomeFirstResponder()`。使用本轮独立Metro5275，默认入口、未启用diagnostics，不能把此结果解释为旧安装包未更新。Mac本轮补丁依赖检查4项通过，未重复运行Linux全量用例。

输入为idb HID模拟触摸、Escape(41)、Tab(43)、Shift+Tab；中文来自系统拼音软键与候选实际点击。PencilKit开关用accessibility press完成设置，其后的工具栏点击均为HID触摸。DOM仅安装只读事件监听和读取快照，原生LLDB只观察事件、responder及调用栈；没有构造DOM键盘事件、强制焦点或修改产品视口/CSS。

| 本轮项目 | 实际结果 |
| --- | --- |
| 默认入口：工具 / 缩放 / 设置，各Escape、Tab、Shift+Tab | **9项全部失败**：确认弹层已打开后发键，DOM无keydown、弹层不关闭。工具停在画笔菜单项，缩放停在range；设置Escape后BODY、Tab两向停在输入模式select，未完成遍历或焦点归还 |
| PencilKit开启后同一键盘矩阵 | **9项全部失败**，与默认入口一致。两组共84条原生Escape/Tab按下/抬起记录，失效时均找到WKContentView first responder及所属Expo DomWKWebView |
| 英文及文字框键盘阳性对照 | **所测通过**：H175Alpha完整保留；相同HID路径Tab/Escape以isTrusted=true到达DOM，分别移到文字字号、取消草稿。Commit175完成后可一次撤销；取消另一草稿未新增历史 |
| 系统中文IME / 完成 / 撤销 / 取消 | **所测通过**：实际点拼音n/i/h/a/o，出现“你好”候选，可信compositionstart/update/end；点击选词后textarea为“你好”。完成生成恰一个“你好”对象，一次撤销归零，取消另一草稿仍零且未新增历史 |
| 软键盘布局 | **所测通过**：无键盘宿主高722，英文键盘353、中文约352；textarea / 完成 / 取消均在可见范围并可实际点击；不代表全部过渡帧或真机结论 |
| PencilKit点击与横滚 | **所测通过**：收到gesture-ancestor、canvas402×622，原生起笔0；可实际点击打开三类弹层，内部横滚scrollLeft601→187、外页scrollX=0。不推导Apple Pencil书写通过 |
| 前后台、离开 / 重进后的首键 | **未验**：前后台launch自动化45秒超时，其工具命令带terminate-running-process，后续为新PID，未形成有效同进程对照；离开重进步骤未执行 |
| Android / iOS27.2 / 实体iPad与Apple Pencil | **本轮未验** |

新的证据表明补丁已经执行，**仅补becomeFirstResponder不足以修复问题**。失效时已有 `WKContentView: 0x1026a3800`，祖先含同一 `ExpoDomWebView.DomWKWebView: 0x102688a00`；具体WebKit/UIKit传递根因仍未定，不应继续把“没有响应者”记作已证实原因。文字操作后关闭所有原生断点再试工具Escape仍失败，已保留DOM快照。

HAM-175评论附件 `HAM-175-b50496f-ios-evidence.zip` / `HAM-175-ios-validation.md` 保存原生 `native-events.jsonl`、18项 `matrix-summary.json`、各项open/result DOM快照与截图、可信文字/IME事件、原生调用栈、构建和安装身份及操作脚本。正式默认矩阵使用 `rerun-*`（工具/缩放）和 `settings-settled-*`（设置），PencilKit矩阵使用 `pencil-*`；初始观测表达式错误已修正并重跑，不以探索快照作为最终判定。

结论：HAM-175原生键盘回归不通过，PR #46继续Draft，开发agent需据此继续定位；HAM-164不能据此解除iOS键盘阻塞，归档4.2 / 4.3保持未勾选。

### HAM-175 分层诊断候选（2026-11-06）：等待 Mac 采集，未修复

已采纳 Mac 文档提交 `bf4611c`，继续使用 PR #46 / `agent/agent/16ee970f929f`。产品路径保留已构建的 `b50496f` 基线及 Tab 离开关闭逻辑，本轮没有新增焦点请求或合成 DOM 键盘事件，也没有修改既有 HID 输入 / 矩阵 / DOM 观测脚本。原生 18 项矩阵的最新有效结论仍为上节的 **全部失败**，不是待合并即可验收。

新增 `scripts/ios/trace_keyboard.py`，由 Mac 显式导入 LLDB 并启用。分别采集 UIApplication 分发 / action、WKContentView 与继承 responder 的 presses / keyCommands 查询、WebKit 内部入口 / 输入法分支 / completion、WebPageProxy 排队 / 发送 / 确认，以及正确 WebContent PID 内的接收 / WebCore 键盘分发。记录原始参数、时间、线程、调用栈、符号覆盖与读取错误；不改返回值、不消费或转发键盘事件。私有符号缺失或 getter 失败均是观测缺口，不能作为“该层没有事件”的证据。

Mac 的完整操作、符号检查、文字阳性对照、两个进程的日志对应、探针关闭后复测和必需回传项见 [iOS 键盘分层诊断](ios-keyboard-trace.md)。先用文字框与工具菜单的同一单键定位，再扩原 18 项矩阵；保留默认入口 / PencilKit 两组、真实 HID 输入、可信 DOM 事件与焦点判定。设备口径继续是 **iPhone 17 Pro / iOS 26.5 模拟器，idb 脚本输入**，不是实体键盘 / 真机 / Apple Pencil 验收。

本轮 Linux 没有 xcrun，没有编译 Swift，也没有运行 Apple LLDB / UIKit / WebContent 探针。Python 检查只能验证探针的宿主侧逻辑，不能证明 Apple 私有符号存在或事件路由通过。Mac 重建采集结果回传前，PR #46 保持 Draft，HAM-175 尚未完成，4.2 / 4.3 均保持未勾选。

本轮本机检查：`python3 -B -m unittest discover -s scripts/ios -p 'test_*.py' -v` 的 8 项通过，覆盖 ABI / 读取错误、函数入口断点、符号缺失、进程身份变化及只清理自有断点；`pnpm test` 100 套件 / 1322 项、responder 9 项、原生配置 4 项通过。typecheck、库 / Web build 通过，lint 0 errors / 原有 32 warnings。原有四份相关 Chromium spec 共 42 项通过（独立 5296 端口，2 workers，1.6 分钟），只调整临时服务配置，未修改测试断言。frozen install、Python 语法与 diff 检查通过。这些结果均不代表新的 iOS 模拟器或 Android 设备验收。
