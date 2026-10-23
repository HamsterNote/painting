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

#### 包管理器预检与已有 Mac 工作树的重试

EAS 的 `development` profile（模拟器 profile 也继承）启用 Corepack，并将 pnpm 固定为根 `package.json` 声明的 `10.28.2`。版本配置不会改变按锁文件检测包管理器的优先级：根 `.easignore` 沿用 `.gitignore` 的排除规则，再额外排除上传包中的 `/yarn.lock`，让远端从根 `pnpm-lock.yaml` 和 `pnpm-workspace.yaml` 识别 pnpm 工作区。仓库内两个锁文件都保留；以后修改 `.gitignore` 时应同步 `.easignore`。

官方参考：[EAS 配置的 `pnpm` / `corepack`](https://docs.expo.dev/eas/json/#common-properties-for-native-platforms)、[`.easignore` 替代 `.gitignore` 的规则](https://docs.expo.dev/build-reference/easignore/)、[monorepo 中从应用目录运行 EAS](https://docs.expo.dev/build-reference/build-with-monorepos/)。

Mac 已有关联项目、router 和加密声明时，从仓库根执行：

```bash
# 确认仍在 agent/agent/4b329d64789b；保留 app.json 的未提交改动。
git status --short --branch
git diff -- apps/playground/app.json
git fetch origin
git merge --ff-only origin/agent/agent/4b329d64789b
git diff -- apps/playground/app.json
pnpm --version   # 10.28.2
pnpm install --frozen-lockfile
pnpm run prepare:playground-artifacts
cd apps/playground
npx eas-cli@25.3.0 build:inspect --platform ios --profile development --stage archive --output /tmp/ham66-eas-archive
# 检查输出归档：根 pnpm-lock.yaml、pnpm-workspace.yaml、patches/ 应存在，yarn.lock 不应存在。
npx eas-cli@25.3.0 build --platform ios --profile development --clear-cache --no-wait
```

修复只更新 `.easignore`、`eas.json` 与本文；快进合并不会覆盖 `apps/playground/app.json`。合并前后核对该文件仍包含既有 `extra.eas.projectId`、`extra.router` 与用户确认的 `ios.infoPlist.ITSAppUsesNonExemptEncryption`。若不能快进或 Git 报本地改动冲突，停止并保留工作树，不使用 reset/覆盖文件。归档检查目录应选一个不存在的新路径；归档包含本地项目配置，不要上传或公开整份归档。

远端复测通过的本项判据：构建环境显示 pnpm `10.28.2`，`Install dependencies` 在仓库根执行 `pnpm install --frozen-lockfile` 并成功完成，不再运行 `yarn install`。记录新 build URL、提交 SHA 与安装阶段日志；这一项通过不代表后续原生编译或 G1 真机采样已通过。

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

前置增量（**已交付**）：`PencilkitG1Sampler`（PKCanvasView 子类公开 UIKit touches 重写 + super，主/coalesced 按事件身份去重、pressure capability、统一 UIKit 时间基准、estimated updates 只计数不改写）+ 探测页笔迹摘要与「导出日志」（系统分享导出 JSON，不依赖 Console.app）。

执行步骤：

1. 本增量含原生改动，必须重新 prebuild + 构建安装（命令同第 1 / 1A 节），确认构建提交为本增量提交；
2. 打开 `painting-playground:///pencilkit-probe`，点「清空」重置采样器；
3. 依次执行用例（每画一笔，屏幕列表最新一行即该笔摘要）：
   - Pencil 单击 tap ×3；
   - 快速短笔 ×5、快速长笔 ×2、慢速长笔 ×1；
   - 同一条笔内由轻到重变化压力 ×2；
4. 点「导出日志」，经系统分享（AirDrop / 存储到文件 / 邮件）导出 JSON 并回传，同时回传屏幕摘要列表截图；
5. 全程 PK 墨迹应正常显示——采样器旁路工作、不抢占 PK 手势；若墨迹异常（断笔、不跟手），即判失败。

通过判据（对照导出 JSON 逐笔核验）：

- 每笔 `counts.down == 1` 且 `counts.up == 1`（cancel 笔除外，需说明触发原因）；tap 也有真实 down/up，非合成；
- `samples` 按 `seq` 连续无重号；主/coalesced 重叠采样按 `tabs` 去重，跨批次重叠也只接收一次，不按坐标去重。真实 `up/cancel` 是独立生命周期边界，即使与先前 down/move 的 `tabs` 相同也必须保留，不能仅凭 timestamp 把真实结束事件丢弃；结束批次内同 timestamp 的 coalesced 副本不另记；
- 快速笔 `counts.coalesced > 0`（证明 coalesced 通道在工作）；样本只有 `kind: main/coalesced` 两类，无预测/插值样本；
- `pressure.capability == true` 时变化压力笔的 `pressure.min/max` 有明显区间（非恒值、非 clamp 的 0/1）；`p` 恒在合理范围但不强制截断；能力缺失设备则 `p` 全为 `null` 并在回传注明；
- 日志 `rules` 字段完整列出采样/去重/时间/压力/估计/限额六条规则；`estimated.lateEstimateEvents` 仅为计数，已收样本不被迟到估计值改写；
- 屏幕 PK 墨迹与采样同时正常（不抢占手势）；`ignoredNonPencilTouches` 如实记录手指触摸次数（pencilOnly 下手指数 > 0 属预期）。

任一不满足 → 停止后续接入，带日志回 D1 评审；不允许用 PKStrokePath 枚举或私有 API 补造 raw 顶替。

#### G1 Probe 的 `onStroke` 回归复测

Swift `EventDispatcher` 发送单笔字典，Expo 将其作为 RN 事件的 `nativeEvent` 传入 JS。Probe 必须在回调内提取并校验摘要，不能在延迟执行的 state updater 内读取事件对象（RN 回收后 `nativeEvent` 可为 null）。空值或显示字段畸形的事件不加入摘要列表；不填造样本、不修改原生采样器或 `getStrokesLog()` 导出内容。

本次修复仅改 JS/TS，可继续使用 EAS build `f4d24c50-b888-4672-8601-52f27b838d5e` 的 custom development client，无需重建 IPA：

1. Mac 在原任务分支执行 `git fetch origin`、`git merge --ff-only origin/agent/agent/4b329d64789b`，保留未提交的 `apps/playground/app.json` projectId/router/加密声明；冲突时停止，不覆盖。
2. 继续使用 `ham66-metro` 的 LAN Metro（当前 `192.168.0.105:5266`），在 iPad dev client 执行完整 Reload，重新打开 `painting-playground:///pencilkit-probe`，记录 JS SHA 与原生 build ID。
3. 清空后连续画 tap、快速短笔、压力变化笔；每笔完成后摘要应更新，包含计数、时长、压力和迟到估计，无 `counts of null` 或 `toFixed` 红屏。
4. 导出 JSON，对照摘要与原始 `strokes` 的 id/计数/压力；再清空并重画，确认列表恢复。G1 的完整采证与通过判据仍按上节执行。

最小自动回归：`pnpm exec jest --selectProjects native --runInBand --runTestsByPath tests/jest/native/pencilkit-probe.native.test.tsx`。测试模拟事件回收、空/畸形事件和有效事件交错，只证明 JS 接收与渲染安全，不替代真机采样结论。

#### G1 terminal 样本与去重修复复测

`finish()` 曾先写入结束批次的 coalesced，再按末个 timestamp 去重，误丢同 timestamp 的真实 main/up。现跳过结束批次中与 terminal 同 timestamp 的 coalesced 副本，并独立接收真实 main/up 或 main/cancel；不从旧样本复制、不修改已收 move，也不生成时间戳。普通主/coalesced 重叠按整笔已收 timestamp 去重（不限相邻样本）。50,000 总样本上限保留一个 terminal 槽位；超限仍标记 overflow，不作为完整采样通过。

自动回归：在装有 Swift 编译器的 Mac/Linux 执行 `node scripts/test-pencilkit-g1.mjs`；也可用 `SWIFTC=/path/to/swiftc` 指定编译器。它编译生产 `PencilkitG1Sampler.swift`，仅用 host UIKit/PencilKit 替身提供输入，覆盖同 timestamp 的 coalesced/up、既有 move/up、cancel、tap、重复 finish、跨批次重复采样与超限 terminal，以及原始压力/迟到估计规则。这不是 UIKit 或真机行为验证。

**本次改动含 Swift，必须重建并安装新的 custom development build；仅 Reload Metro 或重装旧 IPA 无效。** Mac 保留现有 `app.json` 配置并快进任务分支，按第 1A 节重新提交 EAS development build，记录新 build ID/SHA，再安装到目标 iPad、连接 LAN Metro。清空 Probe 后按第 2.2 节完整用例重新导出 JSON 和摘要截图，逐笔确认：

- `counts.down == 1`、`counts.up == 1`；`samples` 第一项 `main/down`、最后一项 `main/up`（真实取消为 `main/cancel` 且 `cancelled=true`）。
- `counts.main + counts.coalesced == counts.total == samples.length`，`seq` 连续，terminal 原始时间/压力如实保留；快速笔仍有真实 coalesced。
- 保留原始失败日志作为对照，不改写旧日志或将本地确定性测试当作 G1 真机通过。

### 2.3 G2（tasks 2.3）：Pencil 与手指分流

前置原型已交付：`/layered-editor?pencilkit=1` 的 RN host + PKCanvasView + DOM/WKWebView、控件排除区与 raw→controller 桥。重建/入口/压力定位和证据边界见 [Demo 验证说明](./demo-validation.md)。设备门槛尚未通过。

执行步骤：

1. 重建后打开 G2 组合页；
2. Pencil 自由笔绘制（原生接）→ 换手指连续绘制（Web 接）→ 双指导航 → 工具栏/文字/尺子区域操作（排除区不被画布挡住）→ 中文键盘输入一段文字 → 回到 Pencil；
3. 全程录屏 + 导出事件归属日志。

通过判据：Pencil 与手指各归各层且都是真实输入（无伪造 DOM 轨迹）；排除区控件可点；中文 IME 正常；模式切换后工具/文档/history 不变。手指无法可靠交还 Web → 停止，提交 D2-B 范围变更评审。

### 2.4 G3（tasks 2.4）：墨迹交接无空窗

前置候选原型已交付最小 raw→PF 历史接入与按笔身份 ready/retire/visible 交接；原有 `diagnostics=1&handoffDelay=...` 仍可用于 DOM 延迟诊断。完整延迟/忙碌/乱序故障注入和设备视频验收仍待完成，不能认定 G3 通过。

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
