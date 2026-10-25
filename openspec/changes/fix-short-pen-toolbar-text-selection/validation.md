# Web 实施与验证记录

## 范围和授权

2026-10-25，按 HAM-109 评论 `01a1717a-ab80-7692-bf88-8a0596a0c096` 授权，不等待 HAM-63，先交付 Web 局部修复。基线 `046ce0db315f4c1b97bacdd3397fbba1b04e3a1d`；实际 Web 入口仍通过 PaintingBoard 将 Toolbar 与 DrawingSurface 渲染为兄弟节点。

仅修改 Toolbar 的样式：根节点设置标准/WebKit 禁选和 callout 防护，笔宽及缩放数值输入显式恢复 text/default。不修改画布、TextEditor、输入适配器、模式仲裁或 native 后端。不新增事件监听、会话状态、全局选区清理或笔后时间窗，因此没有新增监听及会话清理需求。

## 自动化结果

环境：Linux、Playwright 1.59.1、Chromium 147。浏览器输入由 Playwright 鼠标/键盘和 CDP pen/touch 生成；合成 PointerEvent、composition 另行标记，不代表实体笔或系统 IME。

| 命令                                                                                                                                                                                                      | 实际结果                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`                                                                                                                                                                          | 通过，无锁文件变更                                           |
| `pnpm exec jest --runInBand --selectProjects legacy-web --runTestsByPath packages/painting/src/__tests__/layered-toolbar.test.tsx packages/painting/src/input/web/__tests__/freehandWebAdapter.test.ts`   | 77/77 通过                                                   |
| `pnpm exec playwright test tests/ui/interaction-feedback.spec.ts tests/ui/layered-editor.spec.ts tests/ui/mobile-input-mode.spec.ts tests/ui/mobile-input-mode-real-input.spec.ts --workers=2`            | 首轮 74/74 通过；当时尚未加载后加的两项 pen/touch 工具栏测试 |
| `pnpm exec playwright test tests/ui/mobile-input-mode-real-input.spec.ts --grep 'toolbar first actions' --workers=2 --output=test-results/toolbar-input --reporter=list`                                  | 最终 2/2 通过，含浏览器级 pen 跨界及 pen/touch 首次主动操作  |
| `pnpm exec playwright test tests/ui/interaction-feedback.spec.ts --grep 'text permits\|rapid synthetic' --workers=2 --output=test-results/toolbar-final --reporter=list`                                  | 最终修改后 3/3 通过，含原生剪贴板粘贴和 30 笔序列            |
| `pnpm typecheck`                                                                                                                                                                                          | 三个 workspace 类型检查通过                                  |
| `pnpm exec eslint packages/painting/src/layered/Toolbar.tsx packages/painting/src/__tests__/layered-toolbar.test.tsx tests/ui/interaction-feedback.spec.ts tests/ui/mobile-input-mode-real-input.spec.ts` | 通过                                                         |

共覆盖 76 项不同 Chromium 用例。最终受修改影响的用例已重跑；没有把重跑次数重复计数。

覆盖内容：

- 独立工具栏样式与卸载重挂；组合工具栏 label/按钮计算样式；浏览器鼠标双击/拖选静态标签不产生标签选区。
- 工具栏外文字仍可选择，合成笔事件未主动清除已有合法选区；笔宽选择替换、数值焦点、Tab/滑块方向键、Enter 激活按钮正常。
- 颜色 change 路径、压力/输入模式更新正常，不新增文档对象。颜色系统弹层未自动化验证。
- 空白/含文字画布顶部各 30 笔，相近落点交替零 move/1px move，每笔一次事务，可逐笔 undo/redo，既有对象和工具设置未变。
- 浏览器鼠标及 CDP pen 从画布跨界抬笔不误切换工具，随后首次主动点击生效；CDP pen/touch 可修改笔宽、透明度、压力/输入模式并撤销重做。
- 合成 pointercancel、blur、lostpointercapture 后首击有效；既有适配器测试覆盖 destroy 与清理。
- 文字选择替换、Chromium 原生剪贴板粘贴、合成 composition 完成/取消后返回绘图；多边形双击闭合、对象选择/移动/变换、笔指导航及移动端换行回归通过。

新增测试初次要求触摸滑块自动聚焦，未通过；无样式原生 range 的独立对照同样为 value=0.8、focused=false。这是浏览器原生触摸行为，最终测试验证参数更新，pen 与键盘用例验证焦点，不强制改变原生触摸焦点策略。

## 未验证项

`pnpm exec playwright test --config=playwright.webkit.config.ts tests/ui/interaction-feedback.spec.ts --workers=2` 尝试启动 10 项测试，均在浏览器启动阶段被环境阻塞：缺少 `libicudata.so.74`。未进入应用断言，不能报告 WebKit 通过；需在系统依赖完整的环境重跑。

尚无同机 iPad Safari + 实体笔基线/候选对照。保留任务 1.2、2.3、4.1、4.2 未完成：普通入口空白/含文字画布、auto 见笔前后及 pen 模式各组 30 次顶部短笔，抬笔后观察 1 秒；横竖屏、跨界及随后笔/手指首击；颜色/下拉原生弹层、滑块、数值选择菜单、文字复制粘贴及中文系统 IME；取消/中断恢复。届时登记设备、iPadOS/Safari/笔型号、输入模式、短笔节奏和结果。

当前仅交付局部防护和自动化通过证据，不能宣称 Safari 实体笔误选问题已完成验收。若真机仍出现默认选择或误激活，再依据事件路径评估局部事件防护。
