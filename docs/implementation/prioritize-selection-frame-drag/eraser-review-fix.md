# 擦除轨迹回归修复

审核发现新增的文档订阅在擦除自身提交时同步调用 `cancel()`，绕过轨迹模块的提交保护，导致松手立即清除反馈。

`semanticWebAdapter` 现在通过 `endToolGesture()` 为自身正常结束设置同步提交标记，并在 `finally` 中复位。文档订阅仅在标记未设置时取消；擦除自身提交继续由轨迹模块管理两秒逐段淡出。外部文档修改、撤销、取消和生命周期中断仍清理预览、轨迹及 owner。

复现命令：

```sh
pnpm exec jest --watchman=false --runInBand --runTestsByPath packages/painting/src/__tests__/eraser-trail.test.ts
```

修复前原始摘要：

```text
Test Suites: 1 failed, 1 total
Tests:       10 failed, 2 passed, 12 total
```

修复后运行原有擦除套件及选区相关套件，没有新增测试：

```sh
pnpm exec jest --watchman=false --runInBand --runTestsByPath packages/painting/src/__tests__/eraser-trail.test.ts packages/painting/src/__tests__/core/layered-selection-geometry.test.ts packages/painting/src/__tests__/core/layered-tools.test.ts packages/painting/src/__tests__/layered-selection-overlay.test.tsx packages/painting/src/__tests__/layered-semantic-adapter.test.ts packages/painting/src/__tests__/core/layered-input-arbitration.test.ts
```

```text
Test Suites: 6 passed, 6 total
Tests:       85 passed, 85 total
Snapshots:   0 total
Time:        15.87 s
```

既有擦除测试覆盖正常提交后的淡出、外部修改时取消、迟到 move/up 无效和计时器回收；选区 adapter 测试继续覆盖外部 revision 变更后的归属清理及后续手势。完整修复后原始输出见 `eraser-review-tests.txt`。

另运行修改文件的 ESLint、Prettier 和 painting 包类型检查。本轮未复跑浏览器和真实设备测试；此前浏览器结果仍只对应原实现。
