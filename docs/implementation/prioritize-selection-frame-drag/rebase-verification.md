# 合入前 rebase 验证

人类已验收 HAM-246。分支 rebase 到 `3ac6e58`，冲突解决保留 main 新增的套索查询缓存、异步任务调度、MessageChannel 清理和性能诊断，再叠加本需求的选中框命中与正常提交保护。HAM-249 不在本次范围。

排查原 PR 的 CI 失败发现：首指从纸面开始、生成选区预览后，第二指可能命中该预览区域，被误分类为 selection，阻断原双指导航。现在只在尚无活动手势时执行选中框起点分类；从已有选区开始的 owner 仍保持保护。保留原浏览器测试及断言，不通过修改测试放宽契约。

实际运行：

```sh
pnpm exec jest --watchman=false --runInBand --runTestsByPath packages/painting/src/__tests__/eraser-trail.test.ts packages/painting/src/__tests__/core/layered-selection-geometry.test.ts packages/painting/src/__tests__/core/layered-tools.test.ts packages/painting/src/__tests__/layered-selection-overlay.test.tsx packages/painting/src/__tests__/layered-semantic-adapter.test.ts packages/painting/src/__tests__/core/layered-input-arbitration.test.ts packages/painting/src/__tests__/core/layered-lasso-scheduling.test.ts packages/painting/src/__tests__/core/layered-lasso-query.test.ts packages/painting/src/__tests__/core/layered-lasso-compatibility.test.ts
CI=1 PLAYWRIGHT_PORT=6256 pnpm test:ui --grep 'selection frame|lasso, move, resize, rotate|adapter-matrix: .* selection|down-role-ownership' --workers=1 --retries=0
pnpm typecheck
pnpm exec eslint packages/painting/src/core/layeredToolSession.ts packages/painting/src/layered/SelectionOverlay.tsx packages/painting/src/layered/semanticWebAdapter.ts packages/painting/src/input/web/layeredInputArbiter.ts
pnpm exec prettier --check packages/painting/src/core/layeredToolSession.ts packages/painting/src/layered/SelectionOverlay.tsx packages/painting/src/layered/semanticWebAdapter.ts packages/painting/src/input/web/layeredInputArbiter.ts
```

原始摘要：

```text
Test Suites: 9 passed, 9 total
Tests:       111 passed, 111 total
Snapshots:   0 total
Time:        15.34 s
8 passed (50.0s)
All matched files use Prettier code style!
```

类型检查及列出的 ESLint、Prettier 命令退出码均为 0。浏览器使用本分支在独立 6256 端口构建的服务，覆盖鼠标/模拟触摸移动、手柄、双指导航、页面坐标映射和套索/擦除回归。本轮不重复声称执行真实移动设备验收。
