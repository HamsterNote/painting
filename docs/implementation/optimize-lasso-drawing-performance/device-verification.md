# 套索设备与 WebKit 待验清单

本清单供设备验证执行者照做。所有项目目前待验；桌面 Chromium、桌面 WebKit、iPad Safari、iOS WKWebView 分开记结果，不能互相替代。六个缺完整原版对照的历史场景标记“未覆盖”，不计入通过或失败率。阈值保持不变。

## 设备与构建

- [ ] 一台60Hz iPad及一台支持ProMotion的iPad Pro，分别测试Safari与应用内WKWebView；Apple Pencil使用设备兼容型号，另测单指触摸。记录精确机型、iPadOS/Safari/WebKit及应用版本。覆盖项目实际支持的最低系统版本与当前系统，最低版本须从项目支持策略确认，不以猜测版本代替。
- [ ] 一台iPhone的应用内WKWebView测试单指触摸共享DOM路径；若产品不支持该设备，明确记录适用范围。
- [ ] 一台可运行所需依赖的macOS/Linux主机跑Playwright WebKit回归；它只覆盖桌面引擎，不代替上述实体设备。
- [ ] 使用PR #52指定待验SHA的production导出/Release宿主，记录JS bundle/maps SHA256、原生宿主SHA、DPR、CSS viewport和缩放。关闭开发热更新/React开发模式，不使用Expo开发服务器的帧率作为验收值。
- [ ] 前台、供电/低电量模式/温度状态一致，关闭录屏等额外负载。ProMotion不得假定120Hz，逐轮测空闲rAF中位数T并附Safari Timeline。若切换刷新设置，另开一组数据。

## 进入场景和安装测试记录器

1. 构建：`pnpm run build:lib`，然后在playground执行`expo export --platform web --output-dir <待验目录>`。将该production目录通过设备可访问的测试静态站点提供；仓库`static-spa-server.mjs`只监听127.0.0.1，不能把该地址当作iPad可访问地址。禁止为此修改正式部署。
2. Safari打开`/layered-editor?diagnostics=1&lassoPerf=1&fixture=lasso&lassoCount=1000&lassoScenario=local`。100/500/1000与local/dense逐一替换；mixed使用500（另加20文字、20形状、10图片）；独立空控制用`lassoCount=0&lassoScenario=empty`。
3. Web Inspector中粘贴`scripts/perf/lasso-device-marks.js`的完整内容，再开始手势。`lassoPerf=1`仅启用可选测试观察入口；不装记录器不会产生计时。WKWebView测试宿主可在文档创建时以`WKUserScript(..., injectionTime: .atDocumentStart, forMainFrameOnly: true)`装载同一脚本；Expo DOM宿主须注入实际承载画布的DOM文档，而非外层空页面。通过`window.__layeredEditor`和input/query标记存在确认上下文。
4. 选择套索。Pencil采用pen模式；触摸需先切到允许单指绘制的finger模式，确认事件`pointerType=touch`且进入套索，而非滚动/平移。每轮开始前等待字体、全部图片解码完成，核对对象数和每笔64点。仅在上一手势已结束时调用`window.__paintingLassoPerfReset()`清空记录，再先采40个空闲rAF；同一文档不要反复重装记录器。
5. Safari/宿主Inspector开启Timeline保存主线程任务、User Timing和实际render/paint；正式帧率采集与profile轮分开，不能把profile轮混进正式统计。记录器输出调用`window.__paintingLassoPerfExport()`，将完整JSON保存为带设备/场景/规模/轮次名称的文件。结束调用`window.__paintingLassoPerfStop()`。

## 输入矩阵和轮次

- [ ] 可重复基准：seed245，local/dense各0/100/500/1000；mixed为0及500+50。相同CSS viewport、viewport变换、600点/5秒/120Hz源时刻表，每笔64点。沿用`lassoTrajectory`与production runner的合批输入逻辑；触控合批不得丢样本。设备viewport若容纳不下轨迹，统一设置两版相同的viewport变换并记录，不能裁掉样本。设备上合成回放必须标注`isTrusted=false`。
- [ ] 每场景两轮预热、五轮正式，每轮独立空控制；前后版本先后顺序及空/非空顺序交替。仅两版空控制均达`FPS≥0.9×1000/T`才共同保留；任一失败整对剔除、保留原始记录，不补采好样本。完整五对前不作该场景改善或验收判断。
- [ ] 实体Pencil/触摸：沿相同局部椭圆、密集全量椭圆与混合内容圈选约5秒，记录实际事件时间戳、频率、合批和轨迹。不能声称手画恰好120Hz或两轮轨迹完全相同；将捕获轨迹按原时刻表回放至两版/空控制作可重复对照，实体操作本身另列交互证据。原生PencilKit路径不作为共享DOM路径的代测。
- [ ] 附加长尾：密集1000在约150点的半完成轨迹停留、局部500完整轨迹、混合500完整轨迹；分别记录查询与提交长任务。不得只测全命中、跳过中途边界相交阶段。

## 必须核对的读数

| 读数         | 计算/判据                                                                  | 必须保留的原始证据                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 空控制有效性 | 绘制中FPS≥0.9×1000/T；失败则共同未覆盖                                     | 空闲rAF、完整绘制起止、实际回调时间、两版共同mask                                                                                                   |
| 平均FPS      | 帧间隔数/完整观察时长；≥同轮空控制90%                                      | 首尾阻塞必须留在观察区间                                                                                                                            |
| 掉帧率       | 每间隔d贡献max(0,round(d/T)-1)；missing/(observed+missing)，增量≤5pp       | 每个rAF间隔及首尾边界                                                                                                                               |
| 轨迹反馈     | 输入→对应预览呈现机会p95≤2T                                                | 接受的输入前缀、预览DOM路径、后续rAF，附Timeline实际paint；不把rAF代理当物理显示                                                                    |
| 实时选区     | 输入→对应查询完成、实际setSelection返回与呈现机会均报告；选区更新p95≤100ms | 同一session/version/pointCount的input/start/complete/submit标记；实际硬件sample.timeStamp及投递时刻，未覆盖输入留在分母，最终up结果不得回填实时缺口 |
| 查询诊断     | 报setup/单对象step/完整查询墙钟p95及2T，单独记录yield与提交                | 仅在独立诊断轮profile，不把总查询时间与预览SLA混同                                                                                                  |
| 最终选区     | up→最终呈现p95≤100ms                                                       | up起止、最终提交、DOM/paint机会，明确代理与物理paint                                                                                                |
| 补充频率     | gap p95、最大静默、首尾静默、提交/通知次数                                 | 保留既有111～182ms最大静默事实；gap不替换100ms延迟判据                                                                                              |

p95采用公开排序秩并记录分母；未出现实时结果的样本记Infinity（JSON汇总为null），不可删除后再求p95。实际设备硬件时间戳需与performance.timeOrigin归一，不用“完成时当前输入索引”代替查询固化前缀。记录器仅提供原始输入/标记/rAF，不能独自证明物理paint或历史DOM身份；其余证据由Timeline和回归检查补齐。

## 交互和正确性

- [ ] 按住持续圈选时能看到轨迹及临时选区；不等到up才反馈。相同选择集合仍保留提交时序。
- [ ] 最后move与up在同任务内，最终有序ID与完整原查询oracle一致，文档及undo计数不变；非空切回选择，空结果保持套索。
- [ ] Escape、pointercancel、捕获丢失、失焦、切换工具、卸载恢复旧选区；文档已变时不恢复已删ID，旧异步回调不得覆盖新手势。
- [ ] 混合对象移动/缩放/旋转后撤销重做；边界接触、自交、退化轨迹；历史DOM身份/顺序和viewport不变。
- [ ] 重跑已有delayed acknowledgement、半透明交接、擦除预览、页面坐标用例。桌面命令：`LASSO_EXPORT_ROOT=<production目录> pnpm exec playwright test --config=playwright.lasso.config.ts --project=webkit tests/ui/lasso-performance-regression.spec.ts tests/ui/layered-editor.spec.ts tests/ui/page-integration.spec.ts`，另将已有对应用例纳入同一次报告，不能把未运行项填通过。

## 回传与结论

- [ ] 每轮文件名含设备/系统/引擎/输入/场景/规模/版本/轮次，附完整JSON、Timeline、准确bundle/maps、命令原始输出及环境；包内给raw-index和SHA256。
- [ ] 分列“通过”“失败”“未覆盖”“待验”，不将后两者纳入达标率。保留原版六个场景未覆盖、WebKit/真机待验，直到相应数据补齐。
- [ ] PR #52仍为草稿，设备侧结论与阈值取舍交由评审确认，不自行合入或降标。
