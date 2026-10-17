# 自由笔几何 bug remediation（Task 2.4 / 2.5 子项证据）

- 变更：`openspec/changes/layered-perfect-freehand-surface`
- 任务：`tasks.md` 2.4（raw→PF 派生）与 2.5（共享闭合路径）——**仅为两个 P0 bug 的局部修复证据**
- 修复对象：
  - `packages/painting/src/geometry/freehand.ts`：`derivePressureSamples` 接触压力语义 + `StrokeOptions` 显式类型 + 删除未用 `PressureMode` import
  - `packages/painting/src/geometry/closedPath.ts`：`ClosedPathTarget` 去掉 `beginPath`、回放不再 begin、顶点有限校验
- 新增测试：`packages/painting/src/__tests__/core/layered-freehand-regressions.test.ts`（15 项）
- 状态：本文件记录局部修复与纯几何证据。主编排结合依赖 preset 核对及联合测试验收了 2.4/2.5 的派生和共享命令要求；真实 Canvas/SVG 像素、显式 nonzero 渲染与交接留在 3.x/4.6/7.x，**仍未验证**。

## 1. 范围与边界

- 本修复只改三处生产语义：real 模式接触压力更新规则、结构性回放 target 形状、polygon 顶点有限校验。
- 纯几何、headless：只读 `model/document.ts`、`geometry/freehand.ts`、`geometry/closedPath.ts`，不依赖 DOM/Canvas/Skia/RN 运行时。
- **不做 `Path2D` 运行时 mock**：node/jsdom 均无真实 `Path2D` 实现，用 mock 冒充浏览器会得到假证据；真实 DOM lib assignability 由独立 `tsc` probe 确认（见 §5）。
- 未改 path 格式、未额外加 smoothing、未改 tasks.md、未提交 commit。

## 2. 修复 1（P0）：real 模式接触压力语义

原实现存在两个缺陷：

1. `lastContactPressure` 只在 `basePressure > 0` 时更新，导致**合法的 0 压力未被记为接触**，`down0 → up0` 错误地回退到中性 0.5。
2. `up` 上的非零压力会被当成“非 release”而**写入接触压力**，污染后续 `up0` 的收尾值。

修复后规则：

- 只有 `down`/`move` 更新 `lastContactPressure`，且**合法 0 也算一次接触**；
- `up` 上无论压力取值都不更新，非零 `up` 压力原样输出；
- `up` 且压力为 0 → 读取最近一次 `down`/`move` 的接触压力；无 prior 才用中性 0.5；
- raw 缺失 → 0.5；有限越界 → clamp 到 `[0,1]`，**不写回 raw**；派生结果冻结。测试传入冻结的 raw，证明派生不修改它；派生函数不替调用方冻结原始文档。

判定用例：

| 输入序列                                | 期望派生压力                          |
| --------------------------------------- | ------------------------------------- |
| `down0.7 → move0 → up0`                 | `0.7, 0, 0`                           |
| `down0 → up0`                           | `0, 0`                                |
| `仅 up0`                                | `0.5`                                 |
| `down0.3 → up0.9 → up0`                 | `0.3, 0.9, 0.3`（up0.9 不作 contact） |
| `down undefined → move undefined → up0` | `0.5, 0.5, 0.5`                       |
| `down1.5 → move-0.25 → up0`             | `1, 0, 0`（raw 仍为 `1.5,-0.25,0`）   |

## 3. 修复 2（P0）：`ClosedPathTarget` 去掉 `beginPath`

问题：接口要求 `beginPath()`，而真实 DOM `Path2D` **没有该方法**，导致无法直接把 `Path2D` 作为回放 target。`CanvasRenderingContext2D` 需要 `beginPath` 只是调用方职责。

修复后：

- `ClosedPathTarget` 只要求 `moveTo` / `lineTo` / `closePath`；
- `replayClosedPath` **不再调用 `beginPath`**，重置路径由 Canvas context 调用方负责，离线 `Path2D` 可直接使用；
- 命令仍是单一闭合轮廓（`moveTo` 开头、`closePath` 收尾），SVG `d` 与 Canvas target 共用同一序列；
- 新增 polygon 顶点有限校验（非有限抛 `TypeError`），**不改变 path 格式**；
- 中文注释明确：nonzero 填充由渲染端显式执行，**本期尚无 render 实现，不宣称任何填充/像素结果已验证**。

## 4. 已覆盖用例（15 项）

| 组           | 用例                                                                                                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 修复 1       | `down0.7→move0→up0`＝`0.7,0,0`；`down0→up0`＝`0,0`；仅 `up0`＝`0.5`；非零 up 不作 contact；missing＝0.5 且越界 clamp 不写回；派生/raw 冻结且 raw 不变                                    |
| 修复 2       | polygon→单一 M/L/Z；空→空、单点→`moveTo+closePath`；无 `beginPath` 的 recorder 回放一致；SVG `d` 与 recorder 序列一致；非有限顶点抛错                                                    |
| fixture 补证 | 单点/短笔/零位移几何有限且闭合；active/final 均可派生且 revision 区分 state；simulated/constant 下 raw 压力/time 变化不改变 outline；同 final 重复派生 commands 精确一致、SVG 与回放一致 |

## 5. 环境与执行结果

- Node：`v24.x`；Jest：`29.7.0`；TypeScript：项目 v5.x
- 项目：`core-node`（node 测试环境，非 jsdom）

### 5.1 focused run

```bash
pnpm exec jest --selectProjects core-node --runInBand \
  --runTestsByPath packages/painting/src/__tests__/core/layered-freehand-regressions.test.ts
```

```text
PASS core-node packages/painting/src/__tests__/core/layered-freehand-regressions.test.ts
Test Suites: 1 passed, 1 total
Tests:       15 passed, 15 total
```

- exit code：`0`

### 5.2 收集确认

```bash
pnpm exec jest --selectProjects core-node --listTests
```

- 输出包含 `.../core/layered-freehand-regressions.test.ts`；exit code：`0`

### 5.3 生产代码类型检查

```bash
pnpm --filter @hamster-note/painting typecheck
```

- exit code：`0`（`StrokeOptions` 显式返回类型与删除未用 import 均通过；注意该命令按包约定排除 `__tests__`）

回归测试文件本身的类型检查（`tsc --strict --lib ES2020 --types jest`）同样 exit code：`0`。

### 5.4 真实 DOM `Path2D` assignability probe（lib: DOM）

```bash
pnpm exec tsc --noEmit --strict --lib ES2020,DOM --moduleResolution bundler \
  --module ESNext --target ES2020 --skipLibCheck <path2d-assignability-probe.ts>
```

probe 内容（编译期，不运行时求值）：

```ts
import type { ClosedPathTarget } from '.../geometry/closedPath';
declare const domPath2D: Path2D;
const path2dTarget: ClosedPathTarget = domPath2D; // 修复后：通过
declare const ctx: CanvasRenderingContext2D;
const ctxTarget: ClosedPathTarget = ctx; // 也通过
```

- 结果：exit code `0`，真实 DOM `Path2D` 可直接满足 `ClosedPathTarget`。

反证（若接口仍含 `beginPath`）：

```text
error TS2741: Property 'beginPath' is missing in type 'Path2D' but required in type 'WithBeginPath'.
```

- 结果：exit code `2`，证明上述通过不是空证据。

## 6. 未执行项（按指示跳过）

- 未运行 `legacy-web` / `native` / Skia project，未运行全仓 `test`/UI。
- 未做 `Path2D` 运行时 mock，未验证真实浏览器填充像素。
- 子 Agent 未改 `tasks.md`。主编排最终核对源码 hash 与缓存验证时点一致，并联合运行压力解析、几何回归、缓存三套测试：3 suites / 41 tests passed（exit 0）；按实际任务边界验收 2.4/2.5/2.6，不代表真实浏览器或 controller 已验收。
