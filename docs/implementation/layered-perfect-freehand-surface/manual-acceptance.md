# 待人工验收清单

状态：以下均未验证，不得写成 PASS。自动化通过与开发交付审核不能替代这些观察。执行人：修勾；设备可用后填写设备/系统/浏览器版本、输入设备、刷新率、提交 SHA、录像与问题记录。

| 任务     | 待验收内容                                                                                                                                                         | 为何需要人工/设备                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| 3.3、7.8 | Safari 与 iOS WebView 打开 `/?diagnostics=1&fixture=mixed`；观察 ink/text/image/shape/ink 混排以及新墨迹覆盖文字。旋转/缩放后检查相同顺序                          | Linux WebKit 自动化不等于 Safari/UIKit WebView 的实际合成                                             |
| 6.1      | iOS、Android 真机启动 Expo DOM 编辑器，绘制/编辑/导航，切后台再恢复                                                                                                | Expo export 只检查静态打包；native Jest 仅检查整个 DOM 宿主的 layout-only props，不能启动系统 WebView |
| 7.5      | Safari/iOS/Android 中真实文字 focus、中文 IME、组合期间完成/取消、软键盘出现/隐藏与 viewport 稳定；图片导入/选择/擦除                                              | 合成 composition 事件和桌面键盘不覆盖系统输入法、软键盘与 WebView 焦点交互                            |
| 7.5      | Web 真笔逐一执行 auto/real/simulated/constant 的 dot/短笔/长笔、release pressure=0；实际掌触不夺取所有权、书写中 viewport 冻结、结束无跳变；在目标高刷新率录制交接 | 合成 pen PointerEvent 不能证明硬件压力、采样密度、掌触行为或 physical paint                           |
| 7.6      | 在每台目标设备测量不同样本长度的 PF 全轮廓重算、Canvas replay CPU、内存、rAF 与历史 reconcile，建立可接受预算；观察 WebView 交接                                   | 服务器计时和 mock ACK 无法建立设备性能预算；未来 native bridge 延迟不在本期实现范围                   |

## 长笔测量方法

1. 记录设备、系统、输入来源、DPR、刷新率、模式、笔宽/透明度、提交 SHA。分别在空文档和大量历史对象场景执行；诊断开关只用于观测，不改变算法。
2. 用真实笔输入形成短/中/长笔，保存 raw 样本数与输入时长。开发者工具录制主线程，分别检查 `deriveFreehandGeometry` 和 Canvas path replay 的 CPU；记录 rAF 间隔分布、长任务、峰值/稳定内存与释放后内存。不要把输入批次总耗时当作 PF CPU。
3. 对照 `window.__layeredRenders` 检查活动笔采样前后历史 display/object 计数不变。提交、undo/redo、导航本来允许 render，不混入逐点计数。
4. 同步拍摄屏幕/设备录屏，检查 active→pending→history 在目标刷新率下有无空白、双深或跳位；记录后台恢复、连续两笔和 IME 场景。内部 ACK 只证明几何节点就绪。
5. 根据设备实测填写 CPU/rAF/内存阈值与超预算处理；未测之前不设虚假通用门槛，不沿用旧 Skia/折线 append 预算。

`editor-candidate-canvas2d-pen.spec.ts` 已迁到分层入口，在 DPR 1/2 用 1000 个真实接受的合成 move 样本检查 raw 数量、历史 render 计数和最终像素，并附十批输入到 rAF 的宿主观测。它不拆分 PF/Canvas CPU、不代表真笔频率，也不满足上述设备预算验收。
