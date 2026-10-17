# 压力模式 begin 解析验证（Task 2.3 子项证据）

- 变更：`openspec/changes/layered-perfect-freehand-surface`
- 任务：`tasks.md` 2.3 —— begin 时 auto 来源/能力解析及显式 real/simulated/constant 模式锁定
- 验证对象：`packages/painting/src/model/document.ts` 的纯函数 `resolvePressureMode`
- 新增测试：`packages/painting/src/__tests__/core/layered-pressure-mode.test.ts`
- 状态：**仅作为 2.3 子项证据**。2.3 完整任务未经 session controller 核对前不勾选；本文件不勾选任何 checkbox。

## 1. 范围与边界

- 本验证只覆盖 `resolvePressureMode(requestedMode, source, capability)` 这一个纯函数，即“落笔解析”。
- resolver 入参**不包含压力值**；测试中保留真实压力序列仅用于证明解析结果与压力大小/变化率无关。
- 本测试**不宣称** controller 在 mid-stroke 已按解析结果执行模拟——那属于 2.4（raw-to-PF 派生视图与几何）范围。
- 未修改任何生产代码、model/reader/protocol/manifests/lock；未删除任何 commit。

## 2. 契约来源

- `document.ts` 字段与语义：
  - `PressureMode = 'auto' | 'real' | 'simulated' | 'constant'`
  - `ResolvedPressureMode = 'real' | 'simulated' | 'constant'`
  - `PressureCapability = 'available' | 'unavailable' | 'unknown'`（注释明确：不得由 `pressure > 0` 或变化率推断）
  - `InputSource = 'mouse' | 'touch' | 'pen' | 'native'`
- spec `freehand-geometry-pressure` Requirement "Pressure mode locks at stroke begin"：
  - auto 落笔按 pointerSource + adapter capability 解析并锁定。
  - 报告压力的 pen → real；mouse/touch 及明确不可报告压力的原生 pen → simulated。
  - 不按压力是否大于零、恒为 0.5 或是否变化推断/中途切换。
  - 显式 real 不模拟；constant 不因压力改变宽度。
- tasks.md 2.3：以恒 0.5 pen、正压力 mouse/touch、pressure unavailable adapter、显式 real/constant fixture 验证不通过 `p > 0` 或变化率中途切模式。

## 3. 已覆盖用例（6 项）

| 用例                                             | 断言                                           |
| ------------------------------------------------ | ---------------------------------------------- |
| auto pen + available / unknown（恒 0.5）         | `real` / `real`                                |
| auto pen + unavailable                           | `simulated`                                    |
| auto mouse/touch + available / unknown（正压力） | 均 `simulated`                                 |
| auto native + available                          | `real`                                         |
| auto native + unavailable / unknown              | `simulated` / `simulated`                      |
| 显式 real/simulated/constant × 4 来源 × 3 能力   | 全 36 组合原样返回                             |
| 恒定 0.5 / 正压力 / 剧变 / 零压力 fixture        | 同来源·能力下结果恒定（real 或 simulated）     |
| resolver 签名                                    | `resolvePressureMode.length === 3`，无压力入参 |

## 4. 环境

- Node：`v24.15.0`
- pnpm：`10.28.2`
- Jest：`29.7.0`
- 项目：`core-node`（node 测试环境，非 jsdom）

## 5. 实际执行结果

### 5.1 focused run

命令：

```bash
pnpm exec jest --selectProjects core-node --runInBand \
  --runTestsByPath packages/painting/src/__tests__/core/layered-pressure-mode.test.ts
```

输出摘要：

```text
PASS core-node packages/painting/src/__tests__/core/layered-pressure-mode.test.ts
  resolvePressureMode: auto 来源/能力路由（begin 解析）
    ✓ pen + available/unknown 恒 0.5 仍解析为 real；unavailable 解析为 simulated (2 ms)
    ✓ mouse/touch + available/unknown 即使报告正压力仍解析为 simulated (1 ms)
    ✓ native + available 解析为 real；unavailable/unknown 解析为 simulated
  resolvePressureMode: 显式模式对 source/capability 全量锁定
    ✓ real/simulated/constant 在任意来源与能力下原样返回 (3 ms)
  resolvePressureMode: 不依据 p>0 或变化率判定
    ✓ 同来源/能力下，恒定 0.5、正压力、剧变、零压力得到同一结果 (1 ms)
    ✓ resolver 仅接受 (mode, source, capability) 三个参数，无压力入参

Test Suites: 1 passed, 1 total
Tests:       6 passed, 6 total
Snapshots:   0 total
Time:        0.852 s
```

- exit code：`0`

### 5.2 收集确认

命令：

```bash
pnpm exec jest --selectProjects core-node --listTests
```

- 输出包含：`/home/zhangxiao/frontend/HamsterNote/painting.feat-use-perfect-freehand/packages/painting/src/__tests__/core/layered-pressure-mode.test.ts`
- exit code：`0`
- 结论：新测试文件已被 `core-node` project 收集。

## 6. 未执行项（按指示跳过）

- 未运行完整 `fullsuite`/`legacy-web`/`native`/Skia project，避免长时间运行。
- 未验证 controller mid-stroke 行为（属 2.4 范围）。
- 未勾选 tasks.md 任何条目：完整 task 是否完成须由主编排/session controller 核对。
