# HamsterNote Painting

React 分层画板：历史对象按文档顺序进入 SVG，活动自由笔与待交接笔进入 Canvas，headless controller 统一管理文档、事务历史、工具和 viewport。

## 使用

```tsx
import { useMemo } from 'react';
import { createEditor, PaintingBoard } from '@hamster-note/painting-board';

export function Board() {
  const controller = useMemo(() => createEditor(), []);
  return (
    <div style={{ height: 600 }}>
      <PaintingBoard controller={controller} />
    </div>
  );
}
```

`@hamster-note/painting` 根入口也提供 `createEditor`、`PaintingBoard`、`DrawingSurface`；`/layered` 提供显式分层名称，`/core` 提供无 DOM 的 schema 3 控制器与几何 API。组件必须接收同一 controller，不能每次 render 创建新实例。完整可运行示例位于 `apps/playground/src/layered-editor/LayeredEditorDom.tsx`。

## BREAKING：文档与 API

新文档为 `schemaVersion: 3`，保存真实 raw samples、不可变笔刷快照及对象变换；PF outline 和呈现缓存不进入保存数据。`readLayeredDocument` / `serializeLayeredDocument` 返回带 `ok` 的结果，调用方应处理校验失败。V1/V2 文档与旧 `value/onChange`、`PaintingController`、ref handle API 已退役；没有旧渲染 fallback，普通 reader 仍不自动迁移。0.8.0 新增显式 `migrateLegacyDocument`，消费方只调用库内迁移 API 并迁移到 controller API。旧 props 中未进入新公开类型的选项也应由消费方审核迁移。

## 工具栏

`PaintingBoard` 默认在所属画板底部显示悬浮胶囊工具栏，`toolbar={false}` 隐藏。独立使用 `Toolbar` 时默认 `placement="inline"`；指定 `placement="floating"` 时请放在有 `position: relative` 和明确尺寸的父容器中。工具栏定位不修改 controller 的 viewport。

底部工具栏距画板底边为 8px 加安全区；默认读取 `env(safe-area-inset-bottom)`，WebView 宿主可用 CSS 变量 `--hn-toolbar-safe-area-bottom` 提供已知安全区，避免额外叠加容器留白。显式 `layout` 仍优先使用传入的 inset；顶部间距保持 16px 加 inset。

工具菜单以「画笔」（原自由笔）为首项，保留形状、文字与图片；设置、选择、橡皮擦、套索、移动、清空画布为独立操作组。套索完成且命中对象后自动切换到选择，直接拖动即可移动；空套索或取消不切换。清空可一次撤销恢复全部对象，空画布时禁用。输入模式、尺子/虚拟纸张/小地图及其他笔刷和形状参数在设置中。笔宽在工具菜单后的独立组直接调节，自由笔和形状参数分别保留；不支持的工具下禁用。缩放比例按钮固定72px宽、使用等宽数字，打开 25–800% 滑动条，以所属绘图可视区中心为锚点缩放，平移与窗口大小改变后仍保持中心内容不动。

橡皮擦的淡紫轨迹按每个采样点的绘制时间逐帧线性衰减，点龄到1秒消失；持续擦除时最早的部分也会不断退去，抬手不重置计时。接缝、交叉和连续多笔的重叠处取较新的残留强度，不叠色加深。切工具、清空、撤销/重做和离开页面立即清理轨迹。拖尾不进入文档或撤销栈，尾迹全部过期后停止动画循环。

调色板从黑色开始，新编辑器默认黑色；色点之间的留白压缩至原来的三分之一。预设色激活环与本色一致；最右多色圆环仅在非预设自定义色激活时显示当前色轮廓，否则不显示轮廓。预设/自定义颜色只影响后续自由笔或形状，其他工具下禁用，笔刷与形状配置互相独立，已有编辑器颜色不会被挂载覆盖。

窄屏可在胶囊内横向滚动；Tab 会将焦点控件滚入视野。菜单支持上下方向键、Enter/空格选择和 Escape 返回入口。收起按钮为胶囊上方独立圆形按钮；收起后隐藏胶囊，仅保留展开按钮。这些展示状态不进入文档、历史或持久化。

工具栏可在 Web 和 Expo DOM/WebView 中使用，不能直接作为原生 RN View。`@hamster-note/components` 的原生转换不属于本次改动。[验证记录与实机待验项](docs/implementation/polish-painting-toolbar/validation.md)。

## 自由笔

| 压力模式    | 行为                                                                         |
| ----------- | ---------------------------------------------------------------------------- |
| `auto`      | begin 时按输入来源和适配器能力锁定 real 或 simulated，不按压力是否大于零猜测 |
| `real`      | 使用设备实际压力，关闭 PF 模拟；保留 release 的零压力样本                    |
| `simulated` | 由 perfect-freehand 模拟压力                                                 |
| `constant`  | thinning 为 0，保持标称宽度                                                  |

初始 preset 为 thinning / smoothing / streamline 各 0.5、identity easing、圆帽、taper 0；活动笔 `last=false`，最终笔 `last=true`。笔刷设置在 begin 冻结。自由笔无 dash，形状虚线是独立设置。活动 PF 轮廓可能整笔重算与 Canvas replay；长笔性能仍需目标设备实测。

形状、文字、图片、选择/套索、变换、整对象擦除、undo/redo、尺子、virtual paper 和 minimap 共用同一文档与 viewport。没有增加 PNG/SVG 导出功能。

贝塞尔先按下拖动松手确定直线两端，再点击两次确定两个控制点；多边形逐次点击顶点，最后双击闭合。完成前只有临时预览，Escape 或切换工具可取消，完成后仅形成一次撤销事务。关闭虚拟纸张时，主画布和小地图都使用纯白背景。

## 输入模式

工具栏“输入模式”提供三档，鼠标始终跟随当前工具，三档均保留双指缩放/移动：

| 档位             | 单指                                                 | 手写笔                       |
| ---------------- | ---------------------------------------------------- | ---------------------------- |
| 自动（首次默认） | 首次有效画布 pen down 前使用当前工具，检测后拖动画布 | 使用当前工具                 |
| 强制手指绘制     | 使用当前工具                                         | 使用当前工具，不改变手指策略 |
| 强制手写笔绘制   | 拖动画布                                             | 使用当前工具                 |

自动检测只在 controller 实例内锁定，没有抬笔超时；失焦、后台、换工具和 Surface 重挂载不清除。强制手指立即覆盖 latch，切回自动仍使用本会话 latch；新建 controller 才重置检测。手指事务中加入第二个纸面触点会先取消未提交笔迹/工具预览，再导航，不增加对象或 undo；实际笔书写时冻结视口，掌触直到排空都不重放。切档也会取消未提交事务，旧触点不能复活。

初始化优先级为 `createEditor(document, { inputMode })` / core factory 的显式 `inputMode` > 有效已存档位 > 旧 `inputPolicy.touch` 提示 > `auto`。只把菜单选择的档位以 JSON 字符串写入本机键 `hamster-note.painting.input-mode.v1`，不保存 `penSeen`，不进入文档或 undo。读取、解析、写入或访问存储失败时，本实例仍以内存状态工作，不承诺失败写入后跨新会话保存。

Web factory 同步恢复；SSR 的 Surface 和 Toolbar 在客户端初始化完成前不开放交互。直接 core 宿主可在 factory options 指定 `inputMode`，或在首次交互挂载前调用一次 `controller.initializeInputMode(mode)`；core 不访问浏览器存储。宿主自行提供偏好时应在挂载前完成恢复。

**BREAKING：组合入口 `inputPolicy`** 的 `touch: draw/none` 只作为一次性 `finger/pen` 初始化提示，后续 prop 变化不会覆盖菜单。组合入口忽略旧 mouse/pen 来源限制，不能形成隐藏第四档；需要静态来源过滤的宿主使用独立 freehand/semantic adapter 的 `policy`。示例旧 `touchDraw=1` 仅作低优先级 finger 初始化兼容，正常使用直接选菜单。

逐任务命令、结果与规格对应关系见 `docs/implementation/mobile-input-mode-switch/validation.md`。Chromium 合成输入不能证明真实设备的笔与掌触质量。

## 平台边界

Web 使用 SVG + Canvas。Web/iOS/Android 三个平台 DrawingLayer 入口第一期均委托 Web；Expo native 应用通过 Expo DOM/WebView 承载整个编辑器，参考 `apps/playground/src/layered-editor/LayeredEditorDom.tsx` 和 `apps/playground/src/App.tsx`。宿主项目需要 Expo DOM 配置，不能把含 DOM 的 board 直接当作原生 View 使用。本期没有 native ink，也没有逐点 RN props bridge；未来 native adapter 只定义了语义契约，mock ACK 不证明跨桥或 physical paint 同步。

Chromium 与独立 WebKit 自动化不等同 Safari/iOS 真机。系统 IME/软键盘、真笔四模式与掌触、高刷新率交接、iOS/Android 启动及长笔 CPU/内存/rAF 预算按修勾 2026-10-18 决定均为本期范围外/延后的未验证项，完整后续验收清单见 `docs/implementation/layered-perfect-freehand-surface/manual-acceptance.md`。

## 开发与验证

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm typecheck
pnpm lint
pnpm test:ui
pnpm test:webkit
pnpm build
pnpm pack:dry
pnpm verify:layered
```

开发端口为 5266，使用 Expo 支持的 `BROWSER=none` 禁止自动打开浏览器。WebKit 需要 Playwright 对应浏览器和受支持系统依赖。Android/iOS 的 `expo export` 只验证静态依赖解析，不是原生运行证据。

Expo dev client 的构建、局域网连接与两条路由的设备验收步骤见 [Native 运行验证](docs/implementation/native-run-verification/README.md)，本次实际观察与未验证项见该目录的 `results.md`。

## 文档页接入（0.8.0）

新增 `migrateLegacyDocument`、`createPageGeometry`、`createPageCoordinateSpace` 和 `PageDrawingSurface`，由库集中处理旧数据迁移、PDF 页面显示与输入逆变换。[接入说明](docs/page-integration.md) 包含 API、存储边界与可运行示例。

## 共享文件工具栏（0.9.0）

`@hamster-note/painting/toolbar` 提供轻量外壳、文件菜单、异步宿主请求与按栏 safe area 类型。painting 的 Toolbar / PaintingBoard 支持相同的可选文件与布局 props；旧宿主默认保持原样。见 [接入契约与验证](docs/toolbar.md)。
