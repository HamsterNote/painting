# Expo Dev Client 运行与设备验收

本文对应 HAM-64。当前结论见 [results.md](./results.md)：已验证配置生成、打包和开发服务器响应；尚无 iOS / Android 设备运行证据。

## 运行边界与前提

- Node 24、pnpm 10.28.2（根 `packageManager`），从仓库根目录安装。下文命令除特别说明外均从根目录执行。
- 锁定版本为 Expo 57.0.24、React Native 0.86.3、React 19.2.3、RNGH 2.32.0、Reanimated 4.5.1、Worklets 0.10.1；新增 dev client 57.0.20，直接声明 DOM WebView 57.0.1。
- 已构建客户端必须包含这些原生模块及相容的 React Native / Expo SDK。仅刷新 JS 不会安装原生依赖；缺模块、SDK 或 Worklets 不匹配时需要重新构建。先记录旧客户端的构建提交与模块版本，再判断是否能复用。
- 本次设置 bundle ID / Android package 为 `com.hamsternote.paintingplayground`，scheme 为 `painting-playground`，dev launcher 也生成 `exp+painting-playground`。旧客户端若使用别的标识或 scheme，需按其实际配置打开，或用本配置重新构建。
- `/layered-editor` 与首页均通过 `'use dom'` 承载 Web 编辑器。Expo 57 默认使用 `@expo/dom-webview`，无需为本路由切换到 `react-native-webview`；前者原本已由 `expo` 间接安装。
- `/native-adapter-smoke` 是 RN View + RNGH + 输入 adapter + 旧 GestureSession 的调试面板，能观察文档提交计数，但不渲染笔迹，也不等于 schema 3 产品画板。

```bash
pnpm install --frozen-lockfile
pnpm run prepare:playground-artifacts
pnpm --filter @hamster-note/painting-playground exec expo config --type public
```

必须先构建 workspace 库产物：DOM 的 Web 导入会解析到包的 `lib/module`。仓库保留旧 `yarn.lock`，如需通过 Expo 安装依赖，明确使用 `expo install <package> --pnpm`；不要混用锁文件。

## 已有 dev client：启动 Metro

```bash
pnpm --filter @hamster-note/painting-playground dev:native
```

固定参数为 `expo start --dev-client --lan --port 5266`。另有 `dev:ios` / `dev:android`，会请求打开本地模拟器或设备；使用远端真机时用 `dev:native`。不要同时启动 Web 和 Native 两个 Metro 占用 5266；已有 Metro 时先在其终端 Ctrl-C，再切换启动方式。用 `--clear` 可重置 Metro 缓存。

Mac 用 `ipconfig getifaddr en0` 获取 Wi-Fi 地址（接口不同则在系统网络设置查看）。开发机与手机需要互通；多网卡或 VPN 选错地址时显式指定，例如：

```bash
REACT_NATIVE_PACKAGER_HOSTNAME=192.168.1.20 pnpm --filter @hamster-note/painting-playground dev:native
```

将示例 IP 换为手机实际能访问的开发机地址。手机浏览器访问 `http://<开发机IP>:5266/status` 应返回 `packager-status:running`。这只检查连通性；浏览器中的 Web 页面不能验证 native。iOS 允许应用访问本地网络，防火墙允许 TCP 5266，避免访客 Wi-Fi 隔离。远端 Linux/WSL 地址不一定能被手机访问，需要可路由的宿主地址及端口转发。

在已安装的 dev client 的启动页手动输入 `http://<开发机IP>:5266`，或扫描 Metro 的 development build 二维码。也可在设备浏览器打开：

```text
painting-playground://expo-development-client/?url=http%3A%2F%2F192.168.1.20%3A5266
```

先让客户端加载此 Metro 项目，再用应用路由深链接进入目标页：

```text
painting-playground:///layered-editor
painting-playground:///native-adapter-smoke
```

iOS 模拟器（在 macOS 执行）：

```bash
xcrun simctl openurl booted 'painting-playground:///layered-editor'
xcrun simctl openurl booted 'painting-playground:///native-adapter-smoke'
```

Android（启用 USB 调试并授权开发机）：

```bash
adb devices -l
adb shell am start -W -a android.intent.action.VIEW -d 'painting-playground:///layered-editor' com.hamsternote.paintingplayground
adb shell am start -W -a android.intent.action.VIEW -d 'painting-playground:///native-adapter-smoke' com.hamsternote.paintingplayground
```

有多个 Android 设备时每个 `adb` 命令添加 `-s <serial>`。无法使用 LAN 时可 `adb reverse tcp:5266 tcp:5266`，在客户端输入 `http://127.0.0.1:5266`；用完执行 `adb reverse --remove tcp:5266`。不能用手机自己的 localhost 代替开发机地址，除非已建立该反向转发。

## 需要重建：本地原生构建

iOS 需要 macOS、支持此 Expo/RN 版本的 Xcode 及命令行工具、CocoaPods；真机还需签名配置、配对和 Developer Mode。生成的工程最低 iOS 16.4。Android 需要 Android Studio/SDK、API 36、相容的 JDK（生成的 Gradle 9.3.1 需 Java 17+）、已连接设备或已启动 AVD；NDK/CMake 以生成工程和 Gradle 的要求为准。

工程采用 prebuild 生成，不提交 `apps/playground/ios/` 和 `android/`。配置改在 `app.json` / config plugin 中；不要把手工修改生成工程当成可复现配置。已有手工原生改动时先备份，勿直接 `prebuild --clean`。

macOS / iOS：

```bash
pnpm --filter @hamster-note/painting-playground prebuild --platform ios --pnpm
pnpm --filter @hamster-note/painting-playground native:ios --device
```

Android（macOS / Linux / Windows）：

```bash
pnpm --filter @hamster-note/painting-playground prebuild --platform android --pnpm
pnpm --filter @hamster-note/painting-playground native:android --device
```

`native:*` 编译、安装并启动 Metro；已有 5266 Metro 时可添加 `--no-bundler` 复用它。只检查配置生成而不安装 Pods/编译时使用 `prebuild --no-install`；该参数不能与 `--pnpm` 一起传入。

也可使用 `apps/playground/eas.json` 的 `development` profile（真机 internal distribution），或 iOS `development-simulator` profile。尚未绑定 EAS 项目，需在 `apps/playground` 中由项目所有者运行 `eas login`、`eas build:configure` 后构建：

```bash
eas build --profile development --platform ios
eas build --profile development --platform android
eas build --profile development-simulator --platform ios
```

这些是备选构建命令，本次没有触发云构建或签名。iOS internal distribution 需注册设备并具备相应 Apple 签名权限；模拟器包不能安装到真机。安装得到的客户端后，回到 Metro 连接步骤。

## 两条路由的设备验收

每个平台分别记录结果，不用浏览器或 mock 测试替代：

| 项目         | 操作与通过条件                                                                               | 记录内容                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 启动         | 打开 dev client，加载 5266 Metro，无缺原生模块/红屏                                          | 平台、设备、OS、构建提交、SDK、Metro 日志                                                     |
| DOM 编辑器   | 深链接 `/layered-editor`，工具栏与画布出现；选择自由笔，输入模式选“强制手指绘制”，拖动后松手 | 页面截图或录屏、笔迹可见且松手后保留；是否有 WebView 空白或异常                               |
| DOM 历史     | 撤销刚才笔迹后消失，重做后恢复                                                               | 操作结果与截图；不能只凭首屏认定可绘制                                                        |
| Native 输入  | 进入 `/native-adapter-smoke`，在虚线区域单指连续拖动后松手                                   | 同一 pointer 的 down/move/up（列表最新在上，仅保留 12 条），状态 completed，活跃触点归零      |
| Native 提交  | 从新打开的面板拖动 1 笔，再拖动第 2 笔                                                       | `document-commit 次数` 和 `document 笔迹数` 应分别从 0 到 1 再到 2；无可见笔迹属当前设计      |
| 重置         | 点击重置，再拖动一笔                                                                         | 状态先回 idle；新 session 文档从空开始，下次提交笔迹数为 1；累计事件/commit/cancel 计数不清零 |
| 取消（补充） | 手势中断/切后台后返回，再尝试输入                                                            | 记录实际 cancel/finalize 和有无残留，不假定不同 OS 会派发同样的取消事件                       |

真笔类型、压力、掌触与高刷新率需另记设备观察；手指拖动成功不能证明这些能力。

如加载失败，先保留错误原文和 Metro 日志，再判断是网络、客户端版本、原生模块或 DOM 页面错误。启动时本地 DevTools GUI 报错也应与 Metro / 手机运行结果分开记录；不要为了排错关闭系统沙箱。

## 回传模板

```text
平台 / 设备型号 / OS：
客户端构建提交 / Expo SDK / dev-client / RNGH / DOM WebView 版本：
bundle ID 或 Android package / scheme：
Metro 所在机器与手机可访问 IP：
/status 结果：
layered-editor：加载 / 绘制保留 / undo / redo：
native-adapter-smoke：down-move-up / completed / active=0：
第 1、2 笔的 commit 与 document 笔迹数：
重置后结果：
错误原文、Metro 日志、截图或录屏：
```
