# iOS PencilKit Surface 验收 Runbook（HAM-66）

本文对应 OpenSpec change `add-ios-pencilkit-surface` 的 tasks 2.1–2.5。当前已交付 **tasks 2.1 的代码**（最小 Expo Module + RN host 原型），设备验证结论**待修勾回传**；G1–G3（tasks 2.2–2.4）各自需要后续原生代码增量，本文先固定执行步骤、证据清单与失败判据，每进入一道门槛前先由工程师交付对应增量并更新本文命令细节。

执行约定：不使用模拟器代替实体 Pencil 结论；不用 mock、固定等待或 Web ACK 充当设备证据；任一门槛失败即停止，按 design.md 修订方案再评审。

## 0. 前提与版本（tasks 1.2 记录表）

| 项           | 要求                                                            | 记录（执行时填写） |
| ------------ | --------------------------------------------------------------- | ------------------ |
| Mac / macOS  | 可运行 Xcode                                                    |                    |
| Xcode        | 支持 Expo SDK 57 / RN 0.86 的版本，含命令行工具                 |                    |
| CocoaPods    | 与 Xcode 配套                                                   |                    |
| Node / pnpm  | Node 24、pnpm 10.28.2                                           |                    |
| iPad         | 实体机，iPadOS ≥ 16.4，已开 Developer Mode                      |                    |
| Apple Pencil | 与该 iPad 配对可用的实体 Pencil                                 |                    |
| 高帧率拍摄   | 可录 ≥120fps 的外部设备（G3 必需；另一台手机慢动作模式即可）    |                    |
| 签名         | bundle ID `com.hamsternote.paintingplayground` 可用、设备已注册 |                    |

锁定依赖版本：Expo 57.0.24、RN 0.86.3、dev-client 57.0.20、`@expo/dom-webview` 57.0.1。生成的 iOS 工程最低系统已是 16.4，无需额外调整。

## 1. tasks 2.1：构建、安装与显示验证

前置：任务分支 `agent/agent/4b329d64789b`（含 commit `950d5b8` 起的提案与模块代码）。在 Mac 上（无 Mac 走第 1A 节 EAS 云构建路径）：

```bash
git clone git@github.com:HamsterNote/painting.git
cd painting
git checkout agent/agent/4b329d64789b
git log --oneline -1   # 记录此提交为「构建提交」，回传时附上

pnpm install --frozen-lockfile
pnpm run prepare:playground-artifacts
```

预期输出：`pnpm install` 无 ERR；prepare 产物结束于 `[typescript] Wrote definition files to lib/typescript`（warning 可忽略）。

### 1.1 确认 autolinking 能看到新模块

```bash
cd apps/playground
npx expo-modules-autolinking resolve --platform ios | grep -A3 PaintingPencilkit
```

预期输出包含：

```text
packageName: '@hamster-note/painting-pencilkit',
pods: [ { podName: 'PaintingPencilkit', podspecDir: '.../packages/painting-pencilkit/ios' } ],
modules: [ { name: null, class: 'PaintingPencilkitModule' } ],
```

注意：`pods` 只证明代码进了工程，`modules` 非空才证明模块类会注册进生成的 provider；若 `modules: []`，探测页会报 `Unimplemented component: <ViewManagerAdapter_PaintingPencilkit>`。

### 1.2 prebuild + 编译安装到真机

```bash
cd apps/playground
pnpm prebuild --platform ios --pnpm
grep -n "PaintingPencilkit" ios/Podfile.lock   # prebuild --pnpm 已执行 pod install 后应能搜到
pnpm native:ios --device
```

预期输出：

- `Podfile.lock` 中出现 `PaintingPencilkit (0.1.0)` 且在 `DEPENDENCIES` 段可见；
- `native:ios`（即 `expo run:ios --port 5266`）依次完成 Pods 安装、Xcode 编译、安装到所选 iPad 并启动，最后启动 Metro（5266）；
- 首次真机安装需在 iPad 上信任开发者证书并开启 Developer Mode（设置 → 隐私与安全性）。

只查配置不编译时可用 `pnpm prebuild --platform ios --no-install`（注意：与 `--pnpm` 互斥，且不会生成 Podfile.lock）。

### 1.3 打开探测页并记录预期结果

App 启动加载 Metro 后，在 iPad 的 Safari 地址栏输入并前往：

```text
painting-playground:///pencilkit-probe
```

通过判据（逐条记录）：

1. 页面顶部状态区从「等待原生模块就绪…」变为「原生模块已就绪」，并显示：
   - `moduleVersion: 0.1.0`
   - `osVersion:` 为 iPad 实际系统版本
   - `deviceModel:` iPad
   - `drawingPolicy: pencilOnly`
   - `toolPickerAttached: false`
   - `scrollingEnabled: false`
2. Apple Pencil 在下方区域绘制：出现蓝色（#1B6EF3）约 4pt 的平滑笔迹，随压感有粗细变化。
3. 手指在同一区域拖动：默认不落墨（pencilOnly）。注意：本页为独立探测页，手指事件被画布消费属预期；G2 才验证 RN/DOM 组合中的手指分流。
4. 无 PKToolPicker 工具条弹出；无双指缩放/滚动画布。
5. 回传首页 `/layered-editor`（深链接 `painting-playground:///layered-editor`）与 `/native-adapter-smoke` 行为与 main 一致（对照 native-run-verification/results.md 的既有结论）。

### 1.4 构建失败最可能的三类原因

| 类别                  | 症状                                                                                                        | 处理                                                                                                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. 原生模块未进二进制 | `Podfile.lock` 搜不到 PaintingPencilkit；或页面停在「等待原生模块就绪…」/ 红屏报 `PaintingPencilkit` 不可用 | 确认当前分支提交；重新 `pnpm prebuild --platform ios --pnpm` 后再 `pnpm native:ios --device`；已装旧 dev client 必须重装，仅刷新 JS 不会装原生模块                                            |
| 2. 签名 / 设备注册    | Xcode 阶段报 Signing for ... requires a development team / device not registered                            | 在 Xcode 打开 `apps/playground/ios/*.xcworkspace` 选择开发团队；确认设备已在开发者账号注册、iPad 已开 Developer Mode 并信任证书                                                               |
| 3. 依赖 / 缓存漂移    | pnpm 报 lockfile 不匹配；pod install 报版本冲突；Metro 加载旧 bundle                                        | 仓库根 `pnpm install --frozen-lockfile`（不要用 yarn/npm）；`cd ios && pod install --repo-update`；Metro 用 `--clear` 重启；仍异常时备份后 `pnpm prebuild --platform ios --clean --pnpm` 重建 |

其他：Swift 编译报错请保留完整错误原文回传，不要手改 `ios/` 生成工程（配置只落在 `app.json` / config plugin / podspec）。

## 1A. 备选路径：EAS 云构建（无 Mac，iPad + Windows/Linux）

没有 Mac 时用 EAS 在云端编译带 PaintingPencilkit 模块的 dev client。本地产物只有 JS；iOS 二进制由 EAS 生成。Metro 开发服务器仍在你自己的电脑上跑（Windows/Linux/macOS 均可，只需 Node 24 + pnpm），构建和装包不需要 Xcode。

### 1A.1 环境前提

| 项                   | 要求                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Expo 账号            | 免费注册，`eas login` 使用；EAS Build 免费层有构建额度与排队限制，高频使用需付费计划                                              |
| Apple Developer 账号 | **付费的 Apple Developer Program**（internal/ad hoc distribution 必需）；EAS 首次构建会引导登录 Apple 账号并自动管理证书/描述文件 |
| iPad UDID 注册       | ad hoc 描述文件在**构建时**固化设备列表，必须先注册 UDID 再构建（见 1A.2 第 3 步）                                                |
| 凭据边界             | 不把 Apple 密码、App Store Connect API Key 等秘密写入仓库或回帖；凭据只存在 EAS 服务端或你本机钥匙串                              |

### 1A.2 完整命令（从 `apps/playground` 执行）

```bash
git checkout agent/agent/4b329d64789b && git log --oneline -1
pnpm install --frozen-lockfile
pnpm run prepare:playground-artifacts
cd apps/playground

# 1. 安装并登录 eas-cli（推荐 npx 免全局安装）
npx eas-cli@latest login

# 2. 首次构建会提示关联 EAS 项目（把 projectId 写入 app.json 的 extra.eas）。
#    允许它写入；该改动属于构建配置，执行完提交回任务分支或随回传告知。
npx eas-cli@latest build:configure

# 3. 注册 iPad UDID：命令会给出链接/二维码，在 iPad 上打开完成登记
npx eas-cli@latest device:create

# 4. 云构建 development profile（developmentClient + internal distribution）
npx eas-cli@latest build --platform ios --profile development
```

预期输出：构建进入队列后给出 EAS 构建页链接；完成后该页提供安装链接与二维码。构建耗时通常数十分钟（含排队），日志在 EAS 网页可见；失败时下载完整日志回传，不要只截最后一行。

### 1A.3 安装与打开 `/pencilkit-probe`

1. 在 iPad Safari 打开 EAS 构建页的安装链接（或扫码），按提示安装 ad hoc 包；
2. 首次打开前：设置 → 通用 → VPN 与设备管理 → 信任开发者证书；设置 → 隐私与安全性 → 开启开发者模式（需要重启一次）；
3. 在你的电脑上启动 Metro（iPad 与电脑同一 Wi-Fi）：
   ```bash
   pnpm --filter @hamster-note/painting-playground dev:native
   ```
   多网卡/VPN 时显式指定：`REACT_NATIVE_PACKAGER_HOSTNAME=<电脑IP> pnpm --filter @hamster-note/painting-playground dev:native`；
4. 打开 dev client，在启动页输入 `http://<电脑IP>:5266` 加载项目（iPad Safari 访问 `http://<电脑IP>:5266/status` 应返回 `packager-status:running`，用于先验证连通性）；
5. 在 iPad Safari 打开 `painting-playground:///pencilkit-probe`，按第 1.3 节通过判据逐项验收并回传。

### 1A.4 与本地 Xcode 路径（第 1 节）的差异

| 维度                   | EAS 云构建                                                                                                                               | 本地 Xcode（有 Mac）                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| prebuild / pod install | 在 EAS 云端执行，本机不需要 CocoaPods                                                                                                    | 本机 `pnpm prebuild --platform ios --pnpm` |
| 签名                   | EAS 托管证书与 ad hoc 描述文件（含注册 UDID）                                                                                            | 本机钥匙串 + Xcode 选择开发团队            |
| 产物                   | 网页下载/扫码安装的 `.ipa`，重装需重新安装                                                                                               | `expo run:ios --device` 直接装机           |
| 设备日志               | **无 Mac 就没有 Console.app**：2.1 轮次以探测页 onReady 显示 + Metro 日志为主要证据；G1 起的采样日志增量会做成应用内导出，不依赖 Console | Console.app / Xcode Devices 实时日志       |
| 构建提交一致性         | 记录 EAS 构建页显示的 git commit，应与本地 `git log --oneline -1` 一致                                                                   | 本地提交即构建提交                         |

### 1A.5 三类失败判据

| 类别             | 症状                                                                                                      | 处理                                                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. 凭据缺失/失效 | `eas build` 在 credentials 步骤失败：未登录 Expo、Apple 账号无付费 Developer Program、或 EAS 无法生成证书 | `npx eas-cli@latest login` 重登；`npx eas-cli@latest credentials` 检查；确认 Apple 开发者计划有效，凭据只在 EAS 交互流程中提供，不写进仓库 |
| 2. UDID 未注册   | iPad 安装时报「无法安装此 App」/ 描述文件不包含设备；或构建完成但装机被拒                                 | `npx eas-cli@latest device:create` 登记 UDID 后**必须重新构建**（ad hoc 描述文件在构建时固化设备列表，重装旧包无效）                       |
| 3. 旧 dev client | 装的是不含 PaintingPencilkit 的旧包：探测页停在「等待原生模块就绪…」或红屏报模块不可用                    | 核对 EAS 构建页的 git commit 与构建时间，卸载旧包后安装本次 `.ipa`；仅刷新 JS/Metro 不会安装原生模块                                       |

判据 1–3 排除后仍失败：保留 EAS 构建完整日志与安装报错截图回传，不手改 `eas.json` 以外的生成产物。

## 2. G1–G3 执行 Runbook（tasks 2.2–2.5 预备）

每道门槛开工前，工程师先交付对应原生增量并更新本节命令；执行者按本文采证。

### 2.1 通用采证方法

- **构建信息**：每轮记录 `git log --oneline -1`（构建提交）、Xcode 版本（`xcodebuild -version`）、iPad 型号与 iPadOS 版本、Pencil 代次。
- **设备日志**：Mac 上 Console.app 选择 iPad，过滤 process 为 playground；或命令行：
  ```bash
  xcrun devicectl device copy sysdiagnose ... # 仅在需要完整诊断时
  ```
  常规轮次用 Xcode → Devices and Simulators → Open Recent Logs / Console.app 实时流即可，导出为文本附回。
- **屏幕录影**：iPad 自带录屏（控制中心的屏幕录制）作为补充证据。
- **≥120fps 外部视频（G3 必需）**：另一台设备慢动作模式（120/240fps）固定机位拍摄 iPad 屏幕，画面需同时包含 Pencil 落笔动作与屏幕墨迹；每段视频标注对应的笔序与场景。

### 2.2 G1（tasks 2.2）：真实 raw 采样

前置增量（待交付）：PKCanvasView 旁路采样器（公开 UIKit touches 接口，主/coalesced 事件按身份去重、pressure capability、统一时间基准、estimated updates 处理）+ 探测页日志导出。

执行步骤（增量交付后细化命令）：

1. 重建 dev client 并打开 G1 探测页；
2. 依次执行：Pencil 单击（tap）、快速短笔 ×5、快速长笔 ×2、慢速长笔 ×1、变化压力笔 ×2；
3. 导出采样日志。

通过判据：每笔 down/up 完整成对、无抢占 PK 手势（PK 预览正常）；coalesced 样本数 ≥ 主事件数；压力在 capability 可用时有真实分布（非恒值）；tap 有真实 down/up 而非合成；日志注明 estimated updates 的处理方式；提交后无迟到估计值改写。任一不满足 → 停止，回 D1 评审。

### 2.3 G2（tasks 2.3）：Pencil 与手指分流

前置增量（待交付）：RN host 中 PKCanvasView 与 DOM/WKWebView 的真实组合（含命中排除区上报的最小实现）。

执行步骤：

1. 重建后打开 G2 组合页；
2. Pencil 自由笔绘制（原生接）→ 换手指连续绘制（Web 接）→ 双指导航 → 工具栏/文字/尺子区域操作（排除区不被画布挡住）→ 中文键盘输入一段文字 → 回到 Pencil；
3. 全程录屏 + 导出事件归属日志。

通过判据：Pencil 与手指各归各层且都是真实输入（无伪造 DOM 轨迹）；排除区控件可点；中文 IME 正常；模式切换后工具/文档/history 不变。手指无法可靠交还 Web → 停止，提交 D2-B 范围变更评审。

### 2.4 G3（tasks 2.4）：墨迹交接无空窗

前置增量（待交付）：最小 raw→PF 历史接入 + 按 commit 身份的 ready/retire/visible 交接 + 延迟/Web 忙碌注入开关。

执行步骤：

1. 架设 ≥120fps 外部相机（见 2.1），同时开 iPad 录屏；
2. 场景各录 ≥3 次：空白首笔、快速连续短笔（≥5 笔）、长笔、半透明笔、注入交接延迟、Web 忙碌（注入开关）、乱序 ACK；
3. 视频逐帧核对交接瞬间。

通过判据：所有场景无可观察空窗（墨迹消失帧）与双重变深（同一笔两段同时可见导致加深）；未用固定帧数/超时清屏或 crossfade。任一场景失败 → 停止，回交接设计评审，不得以「已有 ACK」宣称通过。

### 2.5 门槛汇总（tasks 2.5）

G1–G3 证据齐后：整理设备/构建/日志/视频清单 + PK→PF 外观对照截图，由修勾确认形状收敛可接受，才进入 3.x 生产集成。

## 3. 回传模板（每轮复制填写）

```text
轮次（2.1 / G1 / G2 / G3）：
构建提交 / Xcode 版本：
Mac / macOS：
iPad 型号 / iPadOS 版本 / Pencil 代次：
pnpm install 与 prepare 结果：
autolinking 输出（1.1）：
Podfile.lock 中 PaintingPencilkit 行：
编译/安装结果（含完整错误原文，如有）：
探测页 onReady 六项值：
逐项操作结果（对照本文通过判据逐条）：
日志 / 截图 / 录屏 / ≥120fps 视频（附件清单与命名）：
结论（通过 / 不通过项 + 证据边界）：
```
