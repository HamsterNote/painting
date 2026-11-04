# 工具栏验证

对应 HAM-156 / OpenSpec change `polish-painting-toolbar` / PR #44。本轮在同一 change 和分支落实已采纳的五条验收意见，先更新 spec/design 并严格校验后实施。

## 行为与实现

- `PaintingBoard` 在自身定位上下文内承载底部悬浮工具栏；空白覆盖区域透传，真实控件与面板保留输入安全边界。
- 十种工具合并到统一菜单；设置、套索、移动、清空画布为独立组。保留全部十二工具、输入模式、导航和独立笔刷/形状参数。
- 缩放使用25–800%滑动条和百分比读数；命令带最新revision，拒绝后恢复权威值，不补执行。
- 收起/展开按钮为胶囊上方独立44px圆形按钮，不参与横向滚动；收起隐藏胶囊与面板，恢复焦点与设置，不写入文档、历史或输入偏好。
- 黑色最左、新编辑器默认黑色；不覆盖现有编辑器快照。24px色面之间留白约6.67px（原20px的1/3），命中区域约30.67×44px且不重叠；其他按钮至少44×44px。
- 最右自由取色环使用原生颜色输入，多色内部、当前颜色外轮廓；预设/自定义颜色仅更新当前支持的工具族，不重涂对象。
- 清空通过已有对象事务一次删除全部对象，一次撤销可全部恢复，重做再次清空；空画布禁用，活动书写/版本冲突遵循控制器拒绝。
- 旧识别入口与固定功能及相应规格条目已移除。未新增生产依赖、文档模型或原生桥变更；组件库转Expo仍不在本次范围。
- 独立 `Toolbar` 默认inline、可选floating；`toolbar={false}` 有效。实现可用于Web/Expo DOM/WebView，不能直接渲染到原生RN View。

## 自动化验证

环境：Linux，Node 24.15.0，pnpm 10.28.2，Playwright 1.59.1 / Chromium 147.0.7727.15。本机浏览器安装使用Ubuntu24.04兼容构建。

| 命令                                                 | 结果                                                    |
| ---------------------------------------------------- | ------------------------------------------------------- |
| `pnpm run test`                                      | 96套件、1297项通过；responder依赖回归9项通过            |
| `pnpm run typecheck`                                 | painting、painting-board、playground通过                |
| `pnpm run lint`                                      | 0 errors，已有32 warnings                               |
| `pnpm run build`                                     | 库构建与Expo Web export通过                             |
| `pnpm run test:ui --workers=4 --shard=1/2`           | 94项通过；2项旧默认色像素断言修正后，单独补跑2项通过    |
| `pnpm run test:ui --workers=4 --shard=2/2`           | 94项通过；1项旧默认色/半透明断言修正后，单独补跑1项通过 |
| `openspec validate polish-painting-toolbar --strict` | 通过                                                    |

两分片共191个不同用例均取得通过结果。补跑命令：`pnpm run test:ui tests/ui/editor-candidate-canvas2d-pen.spec.ts --workers=4`（2项）、`pnpm run test:ui tests/ui/layered-editor.spec.ts --grep "dot, pressure width" --workers=4`（1项）；没有跳过用例。

新版工具栏专项10项已通过：320/390/768/1024/1280/1440宽度、横向滚动与焦点可达、独立收起位置、1/3色面留白、键盘菜单、笔宽编辑、滑动缩放、外部首击起笔、30笔单次提交及跨工具栏真实Chromium笔事件、自定义色轮廓、清空/撤销/重做。2×页面比例与可视区缩小用于浏览器模拟，不作为实体键盘证据。

本轮新截图包含宽屏、工具菜单、缩放滑动条、文字选中及禁用调色板、收起、390宽设置面板；通过issue附件交付。1280宽截图已目视核对，局域网页面HTTP200及实际操作验证通过。tmux验证服务的会话、日志与停止方式在issue交接。

## 实机待验

无已连接的iPad Safari、iOS或Android Expo DOM实机；OpenSpec任务4.2/4.3保持未勾选，不以Chromium/CDP结果代替：

- iPad Safari实体笔：30笔快速短笔、跨工具栏边界、无原生选词、后续首击、中文IME及系统取色器。
- iOS/Android Expo DOM：安全区、横滚、系统软键盘、弹层和焦点。
- 显式启用iOS PencilKit原型：原生覆盖层不吞工具栏。
