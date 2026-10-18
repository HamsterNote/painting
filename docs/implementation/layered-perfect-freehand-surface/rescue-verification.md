# 失败运行抢救与复验

失败残留已提交到仅本地分支 `agent/ham40-wip-failed-run`（`97ccfac`），包含未完成的删除和迁移，不推送该分支。功能分支按本轮明确指令恢复至 `d78159a`，全部旧调用方和测试保留。

本轮实际重跑：

- `pnpm test`：88 suites / 1472 tests PASS（四 projects）。
- `pnpm typecheck`：第一次在 board 的 `/layered` 类型解析失败；为 board/playground 添加源码子路径映射后，完整命令 exit 0。
- `pnpm test:ui tests/ui/layered-editor.spec.ts --workers=1 --trace=off`：Chromium 15/15 PASS。
- 两份新增测试已执行 Prettier 格式修正。

这里的静态检查与桌面合成输入不代替真机、真实笔、Safari 或高刷新率交接验收。剩余任务仍按 tasks.md 推进，旧目录在调用方与测试完成迁移前保留。
