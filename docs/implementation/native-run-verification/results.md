# HAM-64 实际验证记录

验证日期：2026-10-19。代码基线：`f667e16`，加本次 dev client 配置改动。结论：开发准备和静态检查已完成，**尚未完成 iOS / Android dev client 的实际加载、绘制与触摸提交验证**。

## 环境与已核实事实

- Linux x86_64，Node 24.15.0，pnpm 10.28.2。无 Xcode / xcrun，无法编译或启动 iOS。
- Android SDK 位于用户目录但不在 PATH；调用其 `platform-tools/adb devices -l` 返回空设备列表，`emulator -list-avds` 无 AVD；无 `/dev/kvm`，PATH 无 Java。没有用户已构建的客户端文件、构建版本或可访问设备信息。
- 检出基线没有受版本控制的 `ios/`、`android/` 和 `expo-dev-client`，没有 EAS 配置。`expo` 已间接包含 `@expo/dom-webview@57.0.1`，所以应用缺少直接声明不等于模块原先缺失。
- 本次添加 SDK 相容的 `expo-dev-client@57.0.20` 和直接 DOM WebView 依赖、dev-client plugin、应用标识、EAS development profiles；启动脚本统一为 LAN / 5266，生成工程按路径忽略。
- 本机 LAN 候选地址为 `192.168.0.145`，另有 VPN 接口。以下 LAN 请求从开发机自身发起，不能证明手机能访问。

## 已执行检查

| 命令/检查                                                                                                               | 实际结果                                                                                                         | 证据边界                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`（改动前及更新锁文件后）                                                                | 成功                                                                                                             | 依赖可安装；存在既有 peer warnings                                                                           |
| `pnpm run prepare:playground-artifacts`                                                                                 | 成功                                                                                                             | painting / painting-board 的库和声明产物生成；Bob 提示 painting-board 既有 exports/esm 配置警告              |
| `pnpm --filter @hamster-note/painting-playground exec expo prebuild --no-install`                                       | 成功生成 iOS / Android 工程                                                                                      | 未安装 Pods、未调用 Xcode/Gradle、未生成可安装二进制；提示缺少 expo-system-ui，automatic UI style 未保证生效 |
| 生成配置检查                                                                                                            | iOS 最低 16.4；包含本地网络说明和 Bonjour 服务；Android debug 允许 cleartext，main 含 INTERNET 权限及两个 scheme | 配置存在，不证明设备授权或系统网络策略生效                                                                   |
| `pnpm --filter @hamster-note/painting-playground exec expo export --platform all --output-dir dist/native-verification` | 成功；Web 1350、iOS 1592、Android 1694 modules，DOM 子包成功导出                                                 | iOS/Android Hermes bundle 和 DOM HTML/JS 可生成；不是原生构建或运行证据                                      |
| `pnpm exec jest --selectProjects native --runInBand`                                                                    | 3 suites、6 tests 全通过                                                                                         | RNGH 和 DOM host 被 mock，仅验证挂载、props、reset；未触发真实触摸、WebView 或提交                           |
| `pnpm typecheck`                                                                                                        | 成功                                                                                                             | workspace 类型检查                                                                                           |
| `pnpm lint`                                                                                                             | 成功，0 errors / 32 个既有 Jest assertion warnings                                                               | 无新增错误                                                                                                   |
| `pnpm --filter @hamster-note/painting-playground dev:native`                                                            | Metro 在 5266 启动成功                                                                                           | 本地服务启动证据，验收结束后关闭，不提供持续服务                                                             |
| `http://192.168.0.145:5266/status`                                                                                      | HTTP 200，`packager-status:running`                                                                              | 本机经 LAN 地址请求                                                                                          |
| 带 `expo-platform: ios/android` 的 manifest 请求                                                                        | 两者均 HTTP 200，`hostUri=192.168.0.145:5266`，bundle URL 使用同地址                                             | 服务器响应，不证明客户端消费成功                                                                             |
| 继续获取 manifest 中的 development bundle URL                                                                           | 两平台均 HTTP 200；iOS 9,471,823 bytes，Android 9,847,308 bytes                                                  | JS bundle 可下载，不证明 Hermes 执行、WebView 加载或 RNGH 输入成功                                           |

初次 `expo install` 自动选择 Yarn 并因根目录 pnpm 配置失败；改用 `expo install expo-dev-client @expo/dom-webview --pnpm` 成功。`prebuild --no-install --pnpm` 会被 CLI 拒绝，实际验证改用单独 `--no-install`。

启动 Metro 时 React Native DevTools Linux GUI 因 `chrome-sandbox` 所有者/权限配置失败；Metro 仍继续监听且上述 HTTP 请求成功。没有降低浏览器沙箱权限，也没有将该错误当成设备运行失败或成功的证据。

`expo install --check --pnpm` 未通过：在线版本建议将既有 `@expo/metro-runtime 57.0.16` 更新至 `~57.0.17`、`expo 57.0.24` 至 `~57.0.30`、`expo-constants 57.0.19` 至 `~57.0.22`、`expo-linking 57.0.10` 至 `~57.0.13`、`expo-router 57.0.22` 至 `~57.0.28`。本次未批量升级，避免在用户客户端版本未知时扩大原生版本差异；真机仍须核对模块兼容性。

## 设备验收状态

| 必验项                                    | iOS dev client | Android dev client |
| ----------------------------------------- | -------------- | ------------------ |
| 客户端连接 Metro 并启动                   | 未验证         | 未验证             |
| `/layered-editor` 真正加载 DOM 编辑器     | 未验证         | 未验证             |
| 自由笔绘制、松手保留、撤销/重做           | 未验证         | 未验证             |
| `/native-adapter-smoke` 真实 down/move/up | 未验证         | 未验证             |
| completed / 活跃触点归零 / 连续两笔提交   | 未验证         | 未验证             |
| 重置后继续输入                            | 未验证         | 未验证             |

阻碍：本机没有连接设备或可用 AVD，无法运行 iOS；用户已构建客户端的 SDK、原生模块、应用标识尚未知。需在用户 macOS / 真机上执行 [运行说明](./README.md) 并按模板回传，或提供可连接且已授权的设备及相容客户端。收到结果前不能将本任务视为“双平台已跑通”。

## 当前 Native 缺口

1. `DrawingLayer.ios.tsx` / `.android.tsx` 仍 re-export Web，产品编辑器没有独立 native ink、PencilKit 或 Android 原生绘制。
2. 冒烟面板只归一化 RNGH 触点并提交旧 V2 GestureSession；它不是 schema 3 产品 controller 的原生绘制链路，也没有 native ink 呈现与 ACK 同步证据。
3. native input adapter 不携带修饰键，时间戳由 JS 时钟取得；此冒烟输入没有真实笔压力、倾角、coalesced/predicted samples 的完整验证链路。
4. WebView 中真实手写笔、掌触、软键盘、后台恢复以及长笔 CPU/内存/交接延迟仍需设备验收；导出和 Jest 不能覆盖。
5. 本次没有运行 Pods/Xcode/Gradle，没有签名、安装二进制或执行 EAS 构建；这些步骤的成功与否仍未知。

未实现 PencilKit 或 Android 原生墨迹。
