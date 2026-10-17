# 分层 WebKit 实测与迁移回归

## 实际执行

- `pnpm exec playwright test --config=playwright.webkit.config.ts --workers=1 --trace=off`：WebKit 16/16 PASS，31.0 秒。
- `pnpm test:ui tests/ui/layered-editor.spec.ts --workers=1 --trace=off`：Chromium 16/16 PASS，27.7 秒。
- `pnpm exec jest --runInBand --testPathPattern 'rulerGestureController|layered-navigation'`：2 suites / 10 tests PASS。原尺子测试已完整搬到 `input/web/__tests__`，未丢弃断言。
- `pnpm test:ui tests/ui/resource-editing-fixture.spec.ts --workers=1 --trace=off`：2/2 PASS；原两个文本编辑回归已迁至 `/layered-editor?fixture=resources`。仍验证多次 draft 不改文档、每次提交 revision 只加一、图片不变、两次独立撤销、取消无事务，并补 redo。
- `pnpm test:ui tests/ui/ruler-edge-inputs.spec.ts --workers=1 --trace=off`：3/3 PASS；mouse/pen/touch 均验证 raw 坐标原样保存、实际 SVG bounds 受物理尺边约束、undo/redo 保真。新模型不再把投影坐标写回 raw 文档。
- `pnpm typecheck`：完整三个 workspace 检查 exit 0。

尺子并发与旋转中心新增两条回归：尺子双触点与纸张双触点分别归属并可并发；鼠标旋转使用可视裁切段中点，触摸角度反馈投影到中线。

## 环境与修正

宿主 Ubuntu 26 缺少受支持的 WebKit 系统库且无法 sudo；使用 rootless Podman 的 Ubuntu 24.04 镜像安装 Playwright 1.59.1 WebKit 依赖（`install-deps webkit` exit 0），运行缓存中的 WebKit 2272 / 26.4。容器使用 host 网络，复用宿主本次临时 Expo 5266 服务。没有部署或留下用户验收服务。

初次运行发现独立配置继承了 Chromium 的 `--no-sandbox` 参数，浏览器启动前退出。WebKit 项目现显式使用空 launch args。修正后实际启动并完成全部用例。

活动 Canvas 在 rAF 绘制；WebKit screenshot 不保证已执行下一 rAF，因此活动像素断言等待像素出现，再执行 up。半透明 Canvas 与 SVG 合成通道有 1/255 的舍入差，交接/短笔比较允许每通道最多 1；空白或双重叠加仍远超该容差。内部 ACK 与一次截图都不作为 physical paint 原子同步的证明。

## 合并后复核

- `pnpm test:ui tests/ui/layered-editor.spec.ts tests/ui/resource-editing-fixture.spec.ts tests/ui/ruler-edge-inputs.spec.ts --workers=1 --trace=off`：Chromium 21/21 PASS，38.3 秒。
- 独立 WebKit 配置现也收集两个已迁移的回归文件；上述 WebKit 命令最终 21/21 PASS，44.6 秒。
- `pnpm exec jest --listTests --runInBand --json`：实际收集 88 文件，其中 22 个分层测试文件；新尺子路径被收集、旧路径未重复收集。`pnpm test`：88 suites / 1474 tests PASS。
- `pnpm lint`：首次 124 errors / 36 warnings；五份新增测试的条件断言改为前置条件不符即 throw，移除未使用类型并格式化后，最终 exit 0（0 errors / 36 warnings），未禁用规则。
- `pnpm build`、`pnpm pack:dry`：均 exit 0。构建仍有旧 Skia 入口与导出，不能据此勾选 7.3 的退役验收。
- `pnpm --filter @hamster-note/painting-playground build:android` 和 `pnpm --filter @hamster-note/painting-playground exec expo export --platform ios`：均 exit 0，生成 DOM bundle 与平台静态产物；不是设备启动证据。
- `openspec validate layered-perfect-freehand-surface --strict`：PASS；apply 仍为 30/45，未以规划校验替代实现。

已核对移动端截图无横向溢出或工具控件重叠。全部浏览器用例结束后停止本轮临时 Expo 服务，不影响其他工作区进程。

## 待人工验收清单

- Safari 和 iOS WebView：foreignObject 混排、焦点、中文 IME、软键盘遮挡、缩放、图像、选择/擦除。
- iOS/Android 真机启动：Expo DOM 承载及对应平台入口，不能用 mock 挂载或静态 export 代替。
- Web 实际笔与移动真机：四压力模式、单点/短笔/up=0/掌触、viewport 冻结和高刷新率交接录帧。
- 目标设备长笔 CPU、内存、rAF、历史 render/reconcile 和 WebView 交接预算。

3.3 / 6.1 / 7.5 / 7.6 / 7.8 涉及以上未执行设备项目，保持未勾选。6.3 / 7.1 / 7.2 仍需完成其他旧调用方与测试迁移；本轮仅迁移上述明确列出的套件，旧组件、Skia 与旧 change 均保留至完整切换。
