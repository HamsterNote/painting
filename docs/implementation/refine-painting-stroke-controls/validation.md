# HAM-258 实现与验收记录

实现基线：`2f96fc64524ed62c1b4494e7ae4df26e50da74f1`，来源 `agent/agent/4fad8d7762b7`；包含同名 OpenSpec change，未归档，随 PR 交付。

环境：2026-11-13，Linux x86_64，Node v24.15.0，pnpm 10.28.2，Playwright 1.59.1，Chromium 147.0.7727.15，Jest 29.7.0，React 19.2.3。下述 Web/Jest 均指这些版本。实际 Expo DOM 宿主与压感笔设备未提供。

## 实现

- 首层笔宽输入与尾部颜色区改为动态 S 曲线「笔触设置」入口。颜色、宽度、不透明度来自当前工具族快照；预览用设计中的 1–6px 对数映射，真实笔宽仍由菜单显示。
- 笔触 dialog 提供笔宽滑条＋右侧 64×44 输入、六色、自由取色、自定义编辑、不透明度及压力四模式／形状线型。一般设置保留输入模式和导航开关。复用权威提交和回读，不新增持久状态。
- range 使用 6px 灰轨／紫色进度、18px 白色紫边滑块及 44px 交互区，覆盖缩放、笔宽及不透明度；保留原生键盘语义。
- 弹层对工具栏整体（含独立收起按钮）避让，防止笔触菜单遮住唯一收起入口；沿用所属栏边界与焦点机制。

## S1 默认色：通过

步骤：在实现修改前打开实际 `/layered-editor?diagnostics=1` 新建入口；读取 tools，合成 pen 自由笔一笔，通过真实工具菜单切矩形，再画一个形状。另在 Jest 将显式绿色 controller 和已有绿色笔迹挂载／重挂载 Toolbar。

期望：两族默认与首笔对象均为 #2D2D2D；显式颜色与已有对象不变。

实际：入口两族为 #2D2D2D，首自由笔 brushSnapshot.color 和首矩形 style.color 均为 #2D2D2D；显式绿色 #008060 在两次挂载后保持不变，文档快照身份不变。当前基线未复现默认绿色，未修改初始化链路，不能据此推断用户旧截图的来源。

证据：`evidence/S1-baseline.json`（入口、tools 和首两个对象），`evidence/S1-baseline-report.json`（实现前运行时间与断言），`tests/ui/stroke-default-evidence.spec.ts`（1 passed，exit 0），`stroke-default-evidence.test.tsx`（1 passed，exit 0）。环境：Web/Jest（见开头）。

入口代码链：`apps/playground/src/layered-editor/LayeredEditorDom.tsx` → `createEditor()` → `packages/painting/src/layered/createEditor.ts`；后者两族初始化已有 #2D2D2D。诊断参数仅开放只读／测试探针，不向默认色注入值。

## S2 入口迁移：通过

步骤：打开笔触入口，查询首层、dialog 与六色顺序；切一般设置及文件菜单。
期望：首层无数字输入、调色板或空组；全部笔触项归属同一 dialog；一般设置仅全局项，文件菜单互斥。
证据与实际结果见最终命令表、`layered-toolbar.test.tsx`、`painting-toolbar.spec.ts` 及 `tests/toolbar/pane-toolbar.spec.ts`。环境：Web/Jest。

## S3 笔宽与预览：通过

步骤：依次设置 0.5／3.5／12／200；滑条调 12，数字调 3.5；输入空／0／201 后 Enter 或失焦；直接输入 3.55；拒绝更新；外部改宽为 8、颜色 #123456、不透明度 0.5；两族切换。
期望：预览严格单调且在 1–6px；两个控件及后续对象同步，非法草稿不提交且恢复；保留合法小数精度；拒绝回读，外部更新和族间草稿不串。
实际：Jest 断言均通过；预览颜色和 opacity 与快照相同，宽度极值有界。浏览器与固定视口截图结果见最终命令表及 evidence。
环境：Web/Jest。证据：`layered-toolbar.test.tsx` 新增 stroke entry 测试、原对象历史／重载测试；浏览器 stroke smoke 用例。

## S4 工具族与颜色：通过

步骤：形状设虚线；自由笔设宽 24、constant、自定义色 #123456、opacity 0.7；切族回读；切蓝／自定义／黑；进入文字、选择、橡皮擦、移动，检查一般设置。
期望：两族独立，预设与自定义环互斥；不支持工具禁用入口并关闭现有笔触面板；修改参数不改旧对象、document revision 或 history。
实际：Jest 两族值及 document/history 身份断言通过，外部切不支持工具会关闭面板，一般设置仍可使用。浏览器色环回归结果见最终命令表。
环境：Web/Jest。证据：保留的 palette updates、freehand settings、input preference 测试，以及新增 stroke entry 测试。

## S5 缩放视觉与语义：Chromium 通过，其他引擎未验证

步骤：1280×900／390×900／320×900 下打开缩放；Home／方向键调 25、125、800 等值，测入口、胶囊、scrollWidth、组位置；平移／缩放并改尺寸后再调节。
期望：灰轨紫色进度、白色紫边滑块、44px 命中区；入口 72px 且所有尺寸严格稳定；世界中心点投影误差 ≤1 CSS px；文档历史不变。
证据：`toolbar-round4.spec.ts` 三档严格尺寸比较、`painting-toolbar.spec.ts` 的中心锚定和 stroke smoke，固定视口截图见 evidence。WebKit 启动失败，缺少 libicu*.so.74、libxml2.so.2 等依赖，exit 1（3 个用例均未运行到断言），见 `logs/webkit.txt`。WebKit 与 Expo DOM 视觉明确为未验证，任务 3.1 的跨引擎截图验收保留未完成。
环境：Chromium；WebKit／Expo DOM 未验证。

## S6 弹层、键盘与窄屏：Chromium 通过

步骤：Tab 聚焦入口，Enter／Space 打开；编辑并 Escape 返回；遍历边缘，切其他弹层，直接点击收起再展开；320／390 宽度及 200% 页面缩放仿真后缩小可视区，聚焦菜单首尾表单。
期望：同一时间一个弹层；Escape 回入口；原生选择替换、键盘滑条可用；菜单内可滚动，文档无横向溢出，收起关闭且保留参数。
实际与证据：最终浏览器结果及 `painting-toolbar.spec.ts`。检查中发现笔触弹层遮挡收起按钮，已修改共享 Popover 对 shell 整体避让；保留直接点击收起的自动化断言。200% 使用 CDP 页面缩放和可视区仿真，不当作实际系统 IME／设备证据。
环境：Chromium。

## S7 新笔、历史与保存：快照部分通过，真实压力未验证

步骤：菜单分别设置四个压力模式、4／8／12／16 宽度与黑／蓝色，每次提交一笔；逐笔撤销／重做；序列化再解析并创建新 controller；另按 4／16／3 绘制自由笔两笔及矩形。
期望：新对象记录当前设置，旧对象不重涂，设置不新增历史，一次撤销对应一次原事务，重载对象一致。
实际：四种 pressureMode／宽度／颜色均冻结在各笔 brushSnapshot；设置前后 history 和旧对象不变，逐次 undo/redo 与保存重载对象完全相等；两笔＋形状宽度 [4,16,3] 的原验证保留。所有单测通过。合成 pen／鼠标不证明真实压感效果。
证据：`layered-toolbar.test.tsx` 的 S7、primary width 测试及 `toolbar-round4.spec.ts`。环境：Jest／Chromium；有压感笔设备四模式真实效果未验证。

## S8 输入与宿主：浏览器合约通过，实际宿主未验证

步骤：画 30 笔后用 CDP pen 从画布跨过笔触按钮抬起，再主动首击；在两块独立画板分别 top／bottom 打开笔触菜单并编辑 inline 颜色与压力；书写冻结时提交缩放并结束／取消会话。
期望：跨界不打开菜单、首击有效；弹层与表单均属于本栏且不串栏；inline 不挂载原生 select/color；冻结缩放回读且不补执行。
证据：浏览器 crossing 用例、`tests/toolbar/pane-toolbar.spec.ts` 新增双栏用例、inline 单测及原 zoom 拒绝／冻结单测。实际浏览器结果见最终命令表。真实 Expo DOM 宿主／软键盘／HID 未验证；浏览器 fixture 与桥接替身仅证明 DOM 合约，不能替代宿主录屏。
环境：Chromium／Jest；实际 Expo DOM 未验证。

## 规格文字遗留差异

delta 的 wide-board 场景仍写底边距 16px；现有实现、README 与 `docs/toolbar.md` 的默认底部间距为 8px。design 已要求沿用现有布局，不重新定义此间距，本次保留 8px，未把 16px 条目写成通过。请规格负责人统一这处已有文字差异；本次没有修改／降低该验收文字。

## 截图及断言输出

`evidence/chromium-stroke-{1280,390,320}.png`、`chromium-zoom-{1280,390,320}.png` 为固定 CSS 视口宽度、高 900 的页面截图。另有六张 `chromium-{width}-preview-{0.5,200}.png` 记录极值预览。已人工检查 320px 笔触和 390px 缩放截图：无控件裁切，灰轨紫色进度、白色紫边滑块可见，收起按钮未被遮挡。

S2/S3/S5/S6 的 Chromium stroke smoke 三档均通过；S5 的入口／胶囊／scrollWidth／组位置使用严格相等，中心误差采用现有 ≤1px 断言。S2/S8 文件互斥与两个独立画板、inline 表单归属均通过。完整命令输出位于 `logs/`；命令最终退出码表在下方。

已知验证缺口：WebKit 缺动态库无法启动；真实压感笔、Expo DOM/WebView 宿主、系统 IME/HID 没有设备证据。浏览器桥接使用替身，真实压力效果不能由合成笔输入推断。任务 3.1 因缺跨引擎截图保持未勾选；不宣称全部规格已验收。

## 最终命令与原始退出码

| 命令                                                                                                                                                                                  | 最终退出码 | 结果                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------- |
| `pnpm exec jest --runInBand packages/painting/src/__tests__/layered-toolbar.test.tsx packages/painting/src/__tests__/toolbar-inline-pickers.test.tsx`                                 | `0`        | 25 passed                                                |
| `pnpm exec playwright test --config=playwright.config.ts tests/ui/painting-toolbar.spec.ts tests/ui/toolbar-round4.spec.ts tests/ui/native-toolbar-bridge.spec.ts --project=chromium` | `0`        | 40 passed；环境变量 PLAYWRIGHT_PORT=53258 隔离开发服务   |
| `pnpm typecheck`                                                                                                                                                                      | `0`        | painting、painting-board、playground 类型检查通过        |
| `pnpm build:lib`                                                                                                                                                                      | `0`        | 最终源码串行构建通过；Bob 的既有 exports／esm 警告仍存在 |
| `pnpm test:toolbar`                                                                                                                                                                   | `0`        | 14 passed，包含新增双画板与文件互斥                      |
| `pnpm exec playwright test --config=playwright.stroke-webkit.config.ts`                                                                                                               | `1`        | 3 个用例因缺系统库未运行到断言，未验证                   |
| `openspec validate refine-painting-stroke-controls --strict`                                                                                                                          | `0`        | valid                                                    |

早期运行情况保留说明：Jest 初次为 1，修正迁移后的 Tab 预期后为 0；Chromium 早期为 1（旧测试的桥接／子像素断言）、143（运行中断）、1（服务断开导致 ERR_CONNECTION_REFUSED）。使用独立端口最终为 0。`build:lib` 曾为 1（两个构建并发清理同一产物目录），串行复跑为 0；最终源码版本再次串行构建的结果补在下方。`test:toolbar` 曾在打印 14 passed 后返回 143，换 bash 前台包装复跑明确获得原命令退出码 0，未把前次 143 当通过。

补充：`pnpm exec jest --runInBand packages/painting/src/__tests__/pane-toolbar.test.tsx` exit `0`，8 passed；改动文件 ESLint、Prettier 及 `git diff --check` 均通过。

交付进度：13/14。3.1 已实现 CSS 并提供 Chromium 三档截图，但缺 WebKit 或 Expo DOM 的第二套视觉证据，保留未勾选。其余任务按已完成实现／验证记录勾选；真实设备项仍明确未验证。
