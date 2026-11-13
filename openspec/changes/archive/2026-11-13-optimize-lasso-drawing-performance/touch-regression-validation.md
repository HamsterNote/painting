# 松手选不中：触摸排查与待补证据

**后续已定位并修复：** 两份Mac Edge156鼠标录制暴露lostpointercapture先于up的误取消。修复及原始输出见 `capture-loss-fix-validation.md`，修复版改用6275；以下保留上轮尚未复现时的调查记录。

2026-11-13 修勾反馈 PR #53 的拖动已流畅，但松手没有选中图形。**P0 尚未复现、未修复，不能将以下本地通过记录当作真机问题消失。** 性能优化及自动重试已停止；PR #53 保持草稿。本轮只补浏览器回归、独立诊断工具及记录，产品代码仍为 d8189c2。

## 观察结果

全部使用 6273 的冻结 production 资源（快照 c23d4ca），500 笔 seed245 文档。40 点闭合椭圆的固定结果为 115 个对象；600 点轨迹为 116 个对象，采样不同，不是相同输入结果不一致。没有实际失败轨迹，不能把故障归因于 iOS 取消或版本检查。

| 验证                                                                | 结果                                                                                   | 证据边界                                                    |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| headed Chromium 鼠标、CDP `Input.dispatchTouchEvent` 触摸           | 同一 40 点路径均选中 115；拖动查询 0，松手查询开始/完成/提交各 1；documentRevision 0→0 | 原生可信事件；正常 pointerup 后 lostpointercapture 未误取消 |
| 移除性能钩子，仅保留控制器诊断访问                                  | 鼠标、触摸仍各选中 115                                                                 | 排除本地性能钩子恰好掩盖故障                                |
| 实际公开 URL，无诊断参数或性能钩子，1024×768、DPR2、600 点 CDP 触摸 | 选中 116，revision 不变                                                                | 通过 React fiber 只读观察状态；不是实体 iPad                |
| 新增 Chromium UI 回归                                               | 5/5 通过：鼠标、真实触摸、touchCancel、双指缩放、工具切换                              | 中断保留原选区/文档/history，随后下一次触摸圈选成功         |
| headed WebKit GTK 鼠标                                              | 选中 115，最终查询/提交各 1                                                            | Linux WebKit，不是 Safari 真机                              |
| WebKit 原生触摸 down/up/touchend，中间移动由 DOM 注入               | 选中 115，最终查询/提交各 1                                                            | 只验证原生松手/捕获释放；不能宣称完整原生触摸拖动通过       |

5 项 UI 回归在原冻结构建上通过，没有“修复前失败、修复后通过”的产品回归用例。当前缺口是实际设备失败时的事件序列、输入类型和轨迹。捕获/取消路径及 session/document 保护未作猜测性放宽。所有运行只用于功能排查，不提供合格性能样本或门槛结论。

最初 WebKit 辅助脚本把移动排在原生 tap 结束之后，只有 3 点、pathVersion=0，形成无效套索；修正为 down 后同步投递移动后通过。该失败是探针错误，原始记录保留为 `webkit-tap-without-moves.json`，不算产品根因。

## 真机诊断入口

使用 **http://192.168.0.145:6274/**，在同一局域网打开，选择套索，用原来失败的输入方式圈选。若再次选不中，保持页面，点击右上角“保存诊断”，在 issue 回复保存编号，并注明手指还是 Apple Pencil。若本次成功，也可以保存记录供对照。

这是原产品加记录的诊断入口，不是修复版。代理固定指向 127.0.0.1:6273，应用 JS 未变；不要继续把 6273 当作可验收的新构建。诊断脚本只在 6274 注入，记录最近 5000 个事件（超出时报告 dropped）：指针与合并样本、松手/取消/捕获释放、查询会话和阶段、选区提交、文档 revision、工具和输入模式、viewport/画布坐标、浏览器信息。只在用户点保存时发送到测试机器，没有自动上传或 issue 消息。

诊断入口已完成 CDP 触摸圈选→触摸保存→读取落盘 JSON 的冒烟：选中 115；拖动查询 0，开始/完成/提交各 1；trusted touch pointerup；revision=0；页面错误 0；无效 JSON 返回 400。保存按钮直接处理 touchend，覆盖绘图后兼容 click 被抑制的已观察情况；此改动只在诊断控件，不是产品 P0 修复。

### 服务维护

- 服务监听 0.0.0.0:6274，tmux 会话 `ham245-touch-6274`；依赖原 6273 静态服务。仓库未声明 Multica 环境，tmux 尽力保持运行，不保证主机重启后恢复。
- 启动：在仓库根目录执行 `node scripts/perf/lasso-touch-server.mjs`；独立维护时用 tmux 启动并重定向日志。
- 日志：`artifacts/research/lasso-touch/server.log`；记录：`artifacts/research/lasso-touch/recordings/<保存编号>.json`。
- 停止：`tmux kill-session -t ham245-touch-6274`。最终 PID、启动信息与脚本哈希在证据包 `service.json`，清理时只操作此专用会话。
- 服务只代理固定上游、禁缓存；保存接口限制 4MiB、5000 事件，随机 UUID 文件名；记录目录不对外提供读取接口。

上述路径用于运行机维护；供读者使用的证据通过 issue 附件交付。

## 复验命令与记录

```sh
LASSO_EXPORT_ROOT=artifacts/research/lasso-measurement/lan-pr53/site \
  pnpm exec playwright test --config=playwright.lasso.config.ts --project=chromium \
  tests/ui/lasso-touch-release.spec.ts
pnpm exec eslint scripts/perf/lasso-touch-recorder.js scripts/perf/lasso-touch-server.mjs tests/ui/lasso-touch-release.spec.ts
pnpm exec prettier --check scripts/perf/lasso-touch-recorder.js scripts/perf/lasso-touch-server.mjs tests/ui/lasso-touch-release.spec.ts
openspec validate optimize-lasso-drawing-performance --strict
```

UI 5/5 通过，修改文件 ESLint/格式检查通过。产品源码及依赖未改，本轮没有重跑 10,000 条几何差分、全量构建或性能矩阵。WebKit 所缺依赖仅下载解包至本次 artifacts，未修改系统或共享浏览器缓存；辅助脚本和依赖来源清单随证据交付，不把混合注入触摸算作完整 Safari 覆盖。

当前阻塞：尚无原设备失败录制，无法区分手势未正常结束、查询失败、结果失效或设备特有交互。收到保存编号后，先沿该次 session 对照原始事件→查询开始→完成→选区提交，再用同一轨迹构造失败回归和修复。OpenSpec 的 P0 修复及实体设备验收保持未完成。
