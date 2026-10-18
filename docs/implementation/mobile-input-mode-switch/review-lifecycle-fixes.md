# PR #25 生命周期与坐标回归修复

2026-10-18，修复基线 `33334eb`，分支 `feat/mobile-input-mode-switch`。
对应 HAM-44 审核评论 `01a14e1f-3f49-7d08-9d52-03d764579d4c` 的编号 1–4。
六条冻结口径、主规格与已归档的 19/19 tasks 保持不变。

## 1. 后台中断后恢复

窄 reducer 的 reset 区分 `policy` 与 `lifecycle`：切档/换工具保留旧触点隔离，
blur/pagehide/hidden 则丢弃旧 ownership、contacts、pending、suppression 与原事件缓存。
迟到 move/up 没有归属，不会提交；新的 down 不等待窗口外永不到达的旧终止事件。

加强 `layeredInputArbiter.test.ts` 中的三种中断恢复断言，销毁监听单独验证。
新增 `real ink recovery` 矩阵在真实 arbiter/freehand/controller 组合上验证三种中断：
同 ID 鼠标连续提交三笔、不同负 ID touch 连续提交三笔，全程不补旧 up。
UI `touch cancellation and page blur recover input without committing partial ink` 同样移除旧 up，
验证鼠标 ID 复用和 touch 20 丢终止后 21/22/23 连续落文档。
另补 DOM arbiter 的负 pen/touch 实际提交单测。

## 2. 分阶段语义事务

reset 无条件取消工具和导航两种业务事务，不再以当前是否持有 pointer gesture 判断。
`semanticWebAdapter` 的 blur/visibility 取消恢复为无条件监听，`listen:false` 只关闭指针监听。
贝塞尔/多边形的未提交业务事务在抬指后仍会被切档、blur、hidden 清除。

单测 `%s staged cancellation` 与 UI `staged-lifecycle` 覆盖两工具 × 三种中断，
核对预览清空、迟到 up/dblclick 不提交、后续两次点击不能补成旧形状；
UI 还完成新形状并核对起点来自新的操作。
adapter-matrix 的第二指取消矩阵在 auto/finger 下加入 bezier/polygon。

## 3. 尺子取消与隔离

统一 reset 携带原因到 navigation adapter，并取消独立的 ruler controller。
普通纸面导航交接不取消尺子，保留尺子与纸面的独立归属。
切档隔离尺子的旧 ID，释放 capture 本身不会解除隔离；终止事件才排空该 ID。
窗口中断则释放旧身份，避免永久等待终止事件。尺子的 blur/pagehide/hidden 清理
在组合和独立 adapter 下均有效。

单测 `composed ruler %s cancels old contacts and accepts a fresh pair without old up`
及 UI `ruler-lifecycle` 覆盖切档、blur、hidden：旧 pair 移动无效，新负 ID pair
可正常移动尺子，文档、历史与 viewport 不变。
`policy cancellation isolates old mouse through capture loss until up; lifecycle releases its ID`
直接验证 capture loss 不解除切档隔离、生命周期清理后同鼠标 ID 可重用。

## 4. WebKit 坐标预期

`acceptance-feedback.spec.ts` 的纸张居中用例捕获真实 down 的 clientX/clientY，
以及当时的 host rect/clientLeft/clientTop，按已断言的 viewport 手算世界坐标。
保留原 `toBeCloseTo` 精度，没有改产品坐标转换、取整、加 0.5 或扩大容差。

新增 `synthetic fractional coordinates retain the exact content-box to world transform`，
在带 border、半像素 rect 和非单位 viewport 下发送小数坐标，使用精确 `toBe` 断言。
WebKit 对真实输入坐标的取整不能成为产品坐标丢失小数精度的理由。

## 实跑

修复前新增定向回归：3 suites / 12 failed / 21 passed，确实复现三种生命周期缺陷。
修复后同命令：3 suites / 33 passed。补齐 core 与 ruler 定向矩阵后：5 suites / 59 passed。

| 命令 | 本轮结果 |
| --- | --- |
| `pnpm exec jest --selectProjects legacy-web --runInBand --runTestsByPath packages/painting/src/input/web/__tests__/layeredInputArbiter.test.ts packages/painting/src/__tests__/layered-semantic-adapter.test.ts packages/painting/src/__tests__/layered-navigation.test.ts` | 修复前 12 failed / 21 passed；修复后 33 passed |
| `pnpm exec jest --selectProjects core-node legacy-web --runInBand --runTestsByPath packages/painting/src/__tests__/core/layered-input-arbitration.test.ts packages/painting/src/input/web/__tests__/layeredInputArbiter.test.ts packages/painting/src/__tests__/layered-semantic-adapter.test.ts packages/painting/src/__tests__/layered-navigation.test.ts packages/painting/src/input/web/__tests__/rulerGestureController.test.ts` | 5 suites / 59 passed（后续新增的 capture-loss 单测包含在最终全量中） |
| `CI=true pnpm exec playwright test tests/ui/mobile-input-mode.spec.ts tests/ui/touch-drawing-arbitration.spec.ts tests/ui/acceptance-feedback.spec.ts --project=chromium --workers=1 --retries=0 --trace=off` | 58 passed |
| `pnpm run test` | 87 suites / 1150 tests passed，三个既有 projects |
| `pnpm run typecheck` | exit 0，三个 workspace |
| `pnpm run lint` | exit 0，0 errors / 32 条既有 warnings；初跑发现新增条件断言，拆分用例后重跑通过 |
| `CI=true pnpm exec playwright test --project=chromium --workers=1 --retries=0 --trace=off` | 115 passed / 0 failed / 0 skipped，3.8m |
| Podman WebKit 全量（下文） | 110 passed / 2 skipped / 0 failed，3.9m，禁用重试 |
| `openspec validate --all --strict --no-interactive` | 5 passed / 0 failed |
| `git diff --exit-code HEAD -- openspec/specs openspec/changes`（提交前） | exit 0，规格和归档未动 |

本轮新增 14 条 UI 用例：Chromium 从 101 增至 115，WebKit 从 98 增至 112。
WebKit 两条跳过仍是已有 Chromium-only CDP touch-action 实验，未新增跳过。
原 CI 失败的两条 width 390 居中用例本轮均通过；之前 CI 的真实集合为
98 = 94 passed + 2 skipped + 2 failed，不能把 retry 序号当成用例总数。
测试结束后本轮 Podman 容器已退出，5266/5278 均无监听。

WebKit 实际命令（Ubuntu 24 rootless Podman，非宿主 Ubuntu 26）：

```sh
podman run --rm --name ham44-webkit-review-check --network host \
  -v "$PWD:$PWD" -w "$PWD" \
  -v /home/zhangxiao/.cache/ms-playwright:/ms-playwright:ro \
  -v /home/zhangxiao/.nvm/versions/node/v24.15.0:/node:ro \
  -v /home/zhangxiao/.cache/node/corepack:/corepack:ro \
  -e PATH=/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  -e COREPACK_HOME=/corepack -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -e PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 -e CI=true \
  localhost/ham40-webkit:noble \
  pnpm exec playwright test --config=playwright.webkit.config.ts --workers=1 --retries=0 --trace=off
```

本轮未重做实体设备验收，不将既有 iPad 手指/手写笔通过扩展为本轮真机结果。
压力档位、硬件掌触、原生壳与长笔性能/内存/刷新率预算仍未验证。
CI 的推送确认与复跑按小队分工交下一轮，本轮不主动复跑或等待 GitHub CI。
