# 工具栏验证

对应 OpenSpec change：`polish-painting-toolbar`，HAM-156。

## 行为与实现

- `PaintingBoard` 在自身定位上下文内承载底部悬浮工具栏；空白覆盖区域透传，工具栏与面板标记安全交互边界。
- 独立 `Toolbar` 默认 `placement="inline"`；可指定 `floating`，由定位父容器承载。`toolbar={false}` 隐藏整个工具栏。两个画板各自绑定 controller，不共享局部状态。
- 文字直接选择；形状和对象菜单包含直线、矩形、椭圆、多边形、贝塞尔、图片；绘图菜单包含自由笔、选择、套索、橡皮擦、平移与设置。
- 设置保留输入模式、导航开关，以及适用工具的自定义颜色、笔宽、不透明度、压力或线型。自由笔和形状的六色/自定义色配置互相独立。
- 收起、固定、面板状态仅在本次组件挂载期间有效。固定时不能收起。OCR 固定禁用，辅助说明为「OCR 暂未接入」。
- 继续复用 `@hamster-note/components` 的 Icon，未新增生产依赖，未修改版本和锁文件。工具栏依赖 DOM，仅可用于 Web 与 Expo DOM/WebView，不能直接渲染在 RN View 树中；组件库转换仍为独立建议。

## 自动化验证

环境：Linux，Node 24.15.0，pnpm 10.28.2，Playwright 1.59.1 / Chromium 147。以下为实际执行结果：

| 命令                                                 | 结果                                                   |
| ---------------------------------------------------- | ------------------------------------------------------ |
| `pnpm run test`                                      | 96 套件、1295 项通过；额外 responder 依赖回归 9 项通过 |
| `pnpm run typecheck`                                 | painting、painting-board、playground 均通过            |
| `pnpm run lint`                                      | 通过，0 errors；保留已有 32 warnings                   |
| `pnpm run build`                                     | 库构建与 Expo Web export 通过                          |
| `pnpm run test:ui --workers=4`                       | 完整运行后记录结果                                     |
| `openspec validate polish-painting-toolbar --strict` | 通过                                                   |

已人工对照1280宽截图，胶囊/分组/浅灰底/文字紫底白字与提案一致；完整宽屏、菜单、收起及390宽设置面板截图通过附件交付。局域网 HTTP 200 与实际页面操作验证通过。

完整浏览器执行曾收到 SIGTERM 中止；最终以两批分片运行收集完整190项通过结果，未跳过用例。

浏览器用例覆盖 320/390/768/1024/1280/1440 CSS px、胶囊高度/圆角/底色、44px命中区、横向滚动与 Tab 可达、菜单键盘选择、数值替换、Escape 焦点回归、外部首击起笔、30笔单次提交以及跨工具栏的真实 Chromium pen 事件。页面比例模拟使用 CDP 2× page scale，可视区域缩小模拟键盘遮挡；它不是实体软键盘证据。

## 实机待验

本次环境为 Linux + Chromium 自动化，无已连接的 iPad Safari、iOS 或 Android Expo DOM 实机。以下不以浏览器结果替代，任务 4.2/4.3 保留未勾选供评审验收：

- iPad Safari + 实体笔：30笔快速短笔、跨工具栏边界结束、无原生选词、后续首击、中文 IME。
- iOS/Android Expo DOM：底部安全区、单行横滚、系统软键盘、面板可达与焦点。
- 显式启用 iOS PencilKit 原型：原生覆盖层不吞工具栏。

截图通过 issue 附件交付；验证服务与停止命令在 issue 最终评论中提供。
