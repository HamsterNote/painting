# HAM-246 验证记录

实现提交：`4d049a930f6429259e82c197f000bb468cad5141`。PR：https://github.com/HamsterNote/painting/pull/51。

实现 change：`prioritize-selection-frame-drag`。讨论已批准具体缩放/旋转手柄保留原操作；完整外接矩形的其余部分用于移动。

## 实现

schema3 的 `layeredSelectionGeometry` 从文档/预览、选择集合和 viewport 派生可见框、10×10 缩放手柄、半径 6 DIP 且上移 20 DIP 的旋转手柄及完整外接矩形。SelectionOverlay 与工具会话、输入仲裁共用此几何；框命中绕过 DOM/普通对象改选，在 begin 快照原对象和 revision。预览、提交、撤销仍用既有引擎。文档变更和模式切换额外清理语义适配器 owner。

## 命令与原始输出

完整原始日志保存为本目录的 `.txt` 文件，并随任务评论的证据附件提供；附件 JSON 按上表任务顺序逐项记录提交 SHA、完整命令、退出码和原始输出。命令均在本分支仓库根目录运行。

```sh
pnpm exec jest --runInBand --watchman=false --runTestsByPath packages/painting/src/__tests__/core/layered-selection-geometry.test.ts packages/painting/src/__tests__/core/layered-tools.test.ts packages/painting/src/__tests__/layered-selection-overlay.test.tsx packages/painting/src/__tests__/layered-semantic-adapter.test.ts packages/painting/src/__tests__/core/layered-input-arbitration.test.ts
```

```text
Test Suites: 5 passed, 5 total
Tests:       73 passed, 73 total
Snapshots:   0 total
Time:        7.282 s, estimated 13 s
```

`--watchman=false` 避开机器共享 Watchman 因 inotify 额度耗尽而进入的失败状态。

```sh
CI=1 PLAYWRIGHT_PORT=5276 pnpm test:ui --grep 'selection frame|lasso, move, resize, rotate' --workers=1 --retries=0
pnpm lint
pnpm typecheck
pnpm format:check
openspec validate prioritize-selection-frame-drag --type change --strict --json
```

最终独立服务运行原始输出：

```text
4 passed (2.1m)
```

浏览器使用当前分支构建的独立 5276 服务；5266 属于其他任务，首次误复用它的结果不作为本次功能证据。CI 模式关闭 Metro 文件监听，避免共享机器 inotify 上限；不修改系统设置和其他任务的进程。

`pnpm typecheck`：退出码 0。`pnpm lint`：退出码 0，32 条既有警告、0 错误。`pnpm format:check`：退出码 1，共 36 个既有文件不符格式；检查告警文件与本次修改/新增文件的交集为空。保留无关文件，单独检查本次所有修改/新增文件。

## 按 OpenSpec 任务顺序的证据索引

任务 API 返回的 issue、properties、metadata 中没有独立「验收标准」seq 列表，当前 CLI 也没有对应读写命令。以下按已交付 tasks.md 的顺序组织，供逐条验收，不声称已更新不可用的结构化字段。

| 顺序 | 任务           | 对应证据                                                                                                        |
| ---- | -------------- | --------------------------------------------------------------------------------------------------------------- |
| 1    | 1.1 统一几何   | `layered-selection-geometry.test.ts`：空心/斜线、空白、外扩带、边界、框外、无选择                               |
| 2    | 1.2 Overlay    | `layered-selection-overlay.test.tsx`：共用矩形、保留手柄、其他工具隐藏                                          |
| 3    | 1.3 坐标       | 几何和 adapter 的 0.5/1/2 zoom、tx/ty、旋转缩放、多选间隙、宿主仿射映射测试                                     |
| 4    | 2.1 起点锁定   | `layered-tools.test.ts`：被覆盖低层、多选、穿越其他对象/框外、不改图层、单次 undo/redo                          |
| 5    | 2.2 语义入口   | `layered-semantic-adapter.test.ts`：覆盖 DOM 目标、Shift、框外、手柄坐标优先、安全控件、点击无历史              |
| 6    | 2.3 输入仲裁   | adapter + arbitration：三档模式、mouse/pen/touch、auto 笔检测、第二指针、纸面双指导航                           |
| 7    | 3.1 生命周期   | adapter：最终 up、cancel/Escape/blur/hidden/tool/mode/revision/unmount、迟到事件、后续手势                      |
| 8    | 3.2 浏览器入口 | `layered-editor.spec.ts`：鼠标、Chromium CDP 触摸、空白/外扩/低层覆盖/拖出框、undo/redo；既有缩放/旋转/擦除回归 |
| 9    | 3.3 页面与设备 | `page-integration.spec.ts`：页面 zoom + rotation 的空白拖动；实机触摸待验，见下                                 |
| 10   | 3.4 检查       | 上述实际命令和原始日志；全仓格式基线缺口已列出                                                                  |

## 真实设备触摸待验

设备/浏览器：当前运行环境为 Linux + Chromium 自动化；没有可访问的真实移动设备，未执行 Safari/iOS/Android 实机触摸。CDP 触摸与 DOM 合成 pointer 用例均属于模拟结果。

待验步骤：

1. 记录设备型号、系统、浏览器版本，选择允许手指绘制的模式。
2. 画空心椭圆并选中，从框内空白、各外扩带拖动；确认选区跟手、手柄直接拖动仍缩放/旋转。
3. 在选中椭圆上覆盖另一个图形，从重叠区域拖出框，确认只有低层选中对象移动，图层不变。
4. 多选两个相隔对象，从中间空白拖动，确认整体位移相同；一次撤销/重做恢复。
5. 分别正常结束、取消、切工具/模式和切后台；确认没有半成品历史，后续手势有效。
6. 在选区外进行双指导航；切仅笔绘制模式，确认单指仍导航。检查页面 zoom/rotation 宿主下的相同步骤。

实际结果：未执行，留待验收；不能据自动化结果推断真实设备体验。
