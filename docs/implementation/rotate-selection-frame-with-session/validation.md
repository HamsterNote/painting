HAM-249 实施与验证记录（2026-11-13）

基线：main `5ee0925`，包含 #51（HAM-246，整体选区优先及共享几何）与祖先提交 `3ac6e58`（#52）。实现提交为 `d7e0802`。2026-11-13 修勾在 HAM-249 回复“验证通过”（评论 `01a1d2db-50b4-7a8d-a8d8-e547a25ac4c2`）；获准同步主规格、归档，并推送分支向 main 提交 PR。

实现

- 控制器保存临时 `selectionFrame`：稳定选择集合、会话标识、起始文档 AABB 与累计变换。只在选择工具需要时派生初始几何，避免套索路径上的历史 cache 扫描。
- 每次手势冻结起始框与对象，基于同一个增量更新预览；旋转按相邻采样解包。自身提交原子保留最终方向，取消恢复已提交方向，集合变化、工具切换、卸载、历史或外部文档编辑使旧会话失效。
- SVG、语义适配器与输入仲裁复用共享几何，在局部坐标中判断旋转手柄、缩放手柄、包含外扩带的完整区域，拒绝宿主 AABB 假阳性。页面映射继续使用既有路径，不重复累计页面角度。
- 纯选框状态不进入 schema3 文档与 undo；无变化点击不提交对象事务。输入模式切换取消未完成操作，自动检测笔输入本身不取消现有 owner。

验收场景与证据

| 场景                                                                                | 测试入口与断言                                                                                                                                                          |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 单选/不同初始方向多选，30°+20°，移动/中心缩放                                       | `core/layered-selection-session.test.ts`：角点方向、框尺寸、对象变换、单次事务及 undo 恢复                                                                              |
| 跨 ±π 连续旋转，松手无正交闪回                                                      | 同上：多批采样解包、document 通知中检查方向                                                                                                                             |
| 集合重排/viewport 保留；清空重选/集合变化/历史/外部修改重置                         | 同上：稳定 snapshot、会话标识、历史与文档内容                                                                                                                           |
| 0/30/45/90° 边界、外扩带、手柄、旧位置与 AABB 假阳性                                | 同上及 `core/layered-selection-geometry.test.ts`                                                                                                                        |
| pointercancel、Escape、失焦、捕获丢失、隐藏、工具/模式切换、卸载、非 owner/迟到事件 | `layered-semantic-adapter.test.ts`：旋转 30° 提交后预览到 60°，取消回滚且后续操作可用；包含输入仲裁和页面逆映射                                                         |
| 实际 DOM 预览/提交、连续旋转后移动/缩放、覆盖对象、多选空白、框外取消               | `tests/ui/layered-editor.spec.ts`：真实 mouse，SVG 四角与文档 revision/对象变换断言                                                                                     |
| 页面方向 0/90/180/270° × zoom 0.5/1/2，非零平移                                     | `tests/ui/page-integration.spec.ts`：12 组，真实 client 坐标操作多选旋转、拖动、缩放和旋转手柄；重选相对文档轴正交                                                      |
| #52 历史层隔离、套索调度/结果一致性                                                 | `layered-display-regression.test.tsx`、`core/layered-lasso-scheduling.test.ts`、`core/layered-lasso-compatibility.test.ts`；套索 path 不遍历/注册历史，选择工具恢复手柄 |

执行结果

- `pnpm install --frozen-lockfile`：通过。
- `pnpm exec jest --watchman=false --runInBand --selectProjects core-node legacy-web`：101 suites / 1422 tests 通过，执行输出 `jest.txt`（日志仅移除 ANSI 颜色和尾空白）。末次补充 pen detection owner 回归后，相关 session/adapter/lasso scheduling 三套共 62 项通过（`final-regression.txt`）；完整测试计数不包含这一个后补用例。
- `pnpm exec playwright test tests/ui/layered-editor.spec.ts tests/ui/page-integration.spec.ts --workers=2`：44 项全部通过，1.6 分钟（包含 12 组页面矩阵）。首次运行 43 过/1 失败：测试选取的 AABB 角点位于画布上方，修正为可见区域内的外接矩形角点后全量通过，产品代码无需为此修改。
- `CI=1 pnpm exec playwright test tests/ui/lasso-performance-regression.spec.ts --workers=1 --retries=0`：6 项通过，44.9 秒，见 `lasso-ui-final.txt`。验证鼠标/笔圈选时历史不遍历、取消后无迟到反馈。
- `node --test scripts/perf/lasso-*.test.mjs`：20 项通过，见 `lasso-tools.txt`。这些是统计工具回归，不代表设备性能阈值通过。
- `pnpm run typecheck`：painting、painting-board、playground 均通过，见 `typecheck.txt`。
- 全部变更 TS/TSX 的 ESLint 与 Prettier 检查通过；`git diff --check` 通过。
- `openspec validate rotate-selection-frame-with-session --strict`：通过。

环境与验证边界

系统 Watchman/inotify 达到共享监听上限，Jest 使用 `--watchman=false`；额外套索 UI 入口的首次服务器启动遇到 ENOSPC，原始记录 `lasso-ui.txt`。CI 模式重试结果另存 `lasso-ui-final.txt`。

本次验证为 Web Chromium 与无 DOM/模拟 DOM 测试；未执行 WebKit、iPad Safari、iOS WebView 实体设备验收，也不替代 #52 尚未验收的整套设备性能矩阵。人工验收已通过；规格同步及归档位于 `openspec/changes/archive/2026-11-13-rotate-selection-frame-with-session/`，产品代码保持已验收的 `d7e0802` 不变，后续进入 PR 代码审查。
