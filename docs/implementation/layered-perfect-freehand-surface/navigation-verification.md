# 导航、尺子与文字验收

## 本轮实际执行

- `pnpm exec jest --runInBand --testPathPattern 'layered-|freehandWebAdapter|ruler'`：25 suites / 434 tests PASS（添加导航测试前）。
- `pnpm exec jest --runInBand --testPathPattern 'layered-navigation|layered-text-editor'`：2 suites / 5 tests PASS。
- `pnpm --filter @hamster-note/painting typecheck`：exit 0。
- `pnpm test:ui tests/ui/layered-editor.spec.ts --workers=1 --trace=off`：Chromium 7/7 PASS。

文字使用 foreignObject 内真实 textarea；Canvas pointer-events=none，交互控件由输入 adapter 排除。UI 验证 focus、composition 延迟 Done、Escape 取消、Ctrl+Enter 单次提交、undo。合成 composition 不是设备输入法和软键盘验证，见人工验收清单。

## 接入约束

导航开关和尺子位姿只有 controller 的 navigation 一个真源；所有平移缩放均走 updateViewport。Canvas、主 SVG、纸张只读取同一个 viewport。小地图重用同一 ObjectNode 和 PF 几何，不回退旧中心线；拖动期间冻结地图投影，避免 viewport 改变造成反馈漂移。默认 touch 导航，显式 inputPolicy.touch=draw 可选择触摸书写。

尺子在 begin 时将屏幕姿态转换为对象局部快照。实际 raw samples 不投影、不插值；几何派生沿用已测试的物理尺边约束。快照进入 JSON/canonical identity/cache 失效判定，撤销重做保留原始样本身份。鼠标 Ctrl/Meta 平移、Alt 旋转与固定双指尺子手势复用 core gesture session，不加载旧 renderer。

## 完成后的保留能力映射

后续补齐并执行：`pnpm test` 88 suites / 1472 tests PASS；上述 Chromium 命令 15/15 PASS；native route 最小挂载 1/1 PASS（DOM host mock，不是 WebView 启动）。

| 保留能力                              | 分层实现                                                                                               | 实际覆盖                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| 尺子平移/旋转/双指固定 pair/45 度吸附 | input/web/rulerGestureController + core gesture/session；navigation 持有姿态和角度反馈                 | 原 rulerGestureController 5 tests、geometry/ticks；新增导航鼠标位姿测试                     |
| 尺边约束                              | begin 锁定 rulerSnapshot，PF 派生前投影，raw 保真                                                      | 非单位 viewport、原 raw、JSON/undo/redo、cache 失效测试                                     |
| 虚拟纸张                              | VirtualPaper 只读 controller viewport，NavigationOverlay 支持 center/top-left 初始放置                 | UI 与主 SVG matrix 完全一致；不再叠包 CSS transform                                         |
| 交互配置                              | virtualPaper.enabled/minScale/maxScale/enabledInteractions；Surface virtualPaper props 委托 controller | 单独 mouseDragPan/penPan/wheel/touch 开关和缩放限制测试；默认固定双指和第三触点 suppression |
| 小地图                                | 同一 ObjectNode/有序 SVG/PF 缓存；真实内容 bounds，点击/捕获拖动发 viewport replace                    | UI 点击、唯一 viewport revision、主 SVG 对齐，书写期拒绝更新                                |
| 非笔工具                              | semantic adapter + layeredToolSession                                                                  | 五种 shape 的 preview/cancel/undo、lasso/move/resize/rotate、快速 sweep erase、设置隔离 UI  |

Expo57 `--no-open` 等效：`BROWSER=none`，见 CLI `build/src/utils/open.js` 的明确分支；webServer 的 `pnpm dev` 实测 LAN 非 loopback IPv4:5266 HTTP 200。未启动供用户验收的持久服务。

## 待人工验收清单

- Web 实际 pen、iOS/Android 真机：单点、短笔、长笔，四压力模式、up=0、掌触抑制、书写期间 viewport 冻结。
- Safari 与 iOS WebView：foreignObject 混排像素、文字焦点、中文输入法、软键盘遮挡与 viewport，图像解码和选择/擦除。
- 真机高刷新率录帧：半透明交接无空窗/双深；不能用内部 ACK 或 25fps Chromium 录屏替代。
- 目标设备长笔 CPU、内存、rAF 与历史对象 render 预算，WebView 交接观察。

这些项目未执行，7.5/7.6/7.8 的设备部分保持未完成。
