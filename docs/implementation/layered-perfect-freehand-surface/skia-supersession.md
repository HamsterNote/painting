# 旧 change 剩余义务核对（HAM-40）

起点：PR #24 `a4b3c54`，本次 checkout 初始 tracked/untracked 工作树为空。
`migrate-expo57-skia-surface` 的 38/46 是历史状态，不作为新实现验收证据。
旧目录曾在新入口能力及删除条件满足前保留，之后按 6.5 退役；没有继续实施或勾选其未完成任务。

| 旧任务              | 当前 change 对应任务      | 处理                                                                  |
| ------------------- | ------------------------- | --------------------------------------------------------------------- |
| 9.2 legacy 测试映射 | 6.3、7.1、7.2             | 按保留能力映射测试，再退出旧运行路由                                  |
| 10.1 性能           | 7.6                       | 新 PF 全轮廓/Canvas replay 测量；旧 Skia 100k/frame 预算不继承        |
| 10.2 Web 功能验收   | 7.1、7.2、7.5、7.8        | 新入口实际行为、像素及设备证据                                        |
| 10.3 默认切换决策   | 6.3、7.9                  | 依据新入口验证及未验证风险决定，不沿用 Skia 默认切换结论              |
| 11.1 legacy 退休    | 6.3、6.4                  | 新 proposal 明确取消未上线 V1/V2 fallback，先迁保留能力               |
| 11.3 文档           | 7.7                       | 采用 schema3、四压力模式、三平台 Web 承载的最终边界                   |
| 11.4 CI             | 新增 7.10                 | 原清单只有本地打包命令；补明确 CI Web/移动静态门，退出 CanvasKit 检查 |
| 12.1 移交           | 7.9，辅以 7.2/7.4/7.5/7.8 | 保留命令结果、删除清单、静态/自动化/真机证据区别                      |

本次执行 `pnpm install --frozen-lockfile`：exit 0，锁文件未改变；安装 1160 packages。
设备观察和 CI 运行结果不能由本地单测代替。

## 退役复核（2026-10-18）

再次从已推提交读取旧 tasks，未完成恰为表中八项。9.2/11.1 由调用方、测试迁移与运行时退役承接；10.2/10.3 采用当前分层功能与默认入口验收；11.3/11.4/12.1 分别由当前文档、CI 和证据移交承接。10.1 的旧 Skia/100k 固定预算明确不做，改按 7.6 测量真实设备的 PF/Canvas 成本，没有转记旧通过结果。

`git diff --exit-code c57de0a -- openspec/changes/migrate-expo57-skia-surface` 在开始删除前 exit 0，确认 33 文件由已推 Git 历史完整保存。失败树 WIP 曾删除该目录，不把 WIP 的当前树当作备份。当前退出全部 33 文件，没有归档或把旧 38/46 改成完成。

实跑 `openspec list --json` 仅列出 `layered-perfect-freehand-surface`；`openspec validate layered-perfect-freehand-surface --strict` exit 0。当前 proposal 的 supersedes、规范和历史说明仍有意提及旧名称；活动脚本已不读取旧目录，独立数学 spike 输出到 `artifacts/research/`。因此没有可执行路径或活动 change 断链。

`73431a4` 退役批的完整 Chromium 49/49、独立 WebKit 49/49 已实跑通过；设备观察仍未执行，见人工清单。6.4 的源码、包清单、锁文件与产物检查已在 `retirement-verification.md` 记录，不重复实现。

## 当前归档状态（2026-10-18）

`layered-perfect-freehand-surface` 已归档至 `openspec/changes/archive/2026-10-18-layered-perfect-freehand-surface/`，五份 capability 已同步到 `openspec/specs/`。`migrate-expo57-skia-surface` 仍按 6.5 退役，未恢复、未伪造完成归档；上文旧路径与校验命令仅为删除前/当轮历史证据。

当前 CI 使用 `pnpm dlx @fission-ai/openspec@1.13.1 validate --all --strict --no-interactive`，不再依赖已归档的活动 change 路径。源码、脚本、CI 没有读取这两个旧活动目录；文档中的历史备份路径与 supersedes 名称保留。设备预算和观察按修勾 2026-10-18 决策延后、未验证，详见 `manual-acceptance.md`；本轮完整命令结果见 `archive-verification.md`。
