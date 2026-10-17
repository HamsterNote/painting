# 阶段 4 验证报告：InputAdapter 与领域 GestureSession（移除 multi-drag/core）

- 变更：`migrate-expo57-skia-surface`
- 任务：4.1、4.3、4.4、4.5（阶段 4 主体）；4.2 保留为外部设备债务
- 验证所有者：父 orchestrator
- 状态：**阶段 4 已通过，Oracle Gate 4 attempt 2 APPROVE**
- 生成时间：2026-09-23
- 写入范围：仅本报告文件（`verification/`）。未修改产品源码、依赖、lockfile、测试或 CI。

## 结论速览

| 任务 | 结论 | 证据 |
| --- | --- | --- |
| 4.1 InputAdapter 契约与 Web Adapter | ✅ 通过 | canonical `src/input/web/normalizePointerInput.ts`；三类生产 controller 复用 |
| 4.2 Native Adapter（iOS/Android 真实运行） | ⏸ 未关闭（外部设备债务） | Linux 无模拟器/真机，无真实原生输入证据 |
| 4.3 纯 core 领域 GestureSession | ✅ 通过 | `core/gesture/{ownership,session}.ts` + controller 单测 |
| 4.4 移除 multi-drag 运行时依赖与 mock | ✅ 通过 | `pnpm why --recursive` 三包无活动路径；`pnpm test`/`pnpm build` 通过 |
| 4.5 virtual-paper Transform 等价、无 readerMode/bounds | ✅ 通过 | 内部 display-only `VirtualPaperSurfaceFrame`；真实 Chromium E2E |

**总体判定：阶段 4 通过（4.1 / 4.3 / 4.4 / 4.5）；4.2 作为外部设备债务保留未完成。Oracle Gate 4 attempt 2 APPROVE。**

## 4.1 InputAdapter 契约与 Web Adapter

- **canonical 归一化实现**：`src/input/web/normalizePointerInput.ts` 是唯一的 DOM Pointer Events → 归一化宿主局部 DIP 事件转换点；`src/input/web/webInputAdapter.ts` 与 `src/input/web/index.ts` 在其上暴露 adapter 入口。
- **三类生产 controller 复用同一 normalizer**（非测试 mock）：
  - `src/legacy-compat/rulerGestureController.ts`
  - `src/legacy-compat/selectionGestureController.ts`
  - `src/legacy-compat/viewportGestureController.ts`
- **职责边界**：
  - **Web / Native adapters** 负责平台机制——Web 的 capture / DOM 命中 / `resolveTargetRole`，native 的 RNGH 映射；把平台事件翻译为同一纯归一化契约。
  - **pure core session**（`core/gesture/session.ts`）只消费纯归一化宿主局部 DIP 事件与 `targetRole`；不引入 DOM `Element`/`PointerEvent`、RNGH/Reanimated/React。
- **验证方式**：core 单测使用合成归一化事件即可驱动几何与手势路径；`normalizePointerInput` 单测覆盖 `pointerdown`/`pointermove`、非指针事件返回 `null`、NaN 时间戳与非法坐标返回 `null`。

## 4.3 纯 core 领域 GestureSession

- **per-pointer ownership**：object owner 在逐 pointer down 时锁定，不同 owner 可并发；`core/gesture/ownership.ts` 承载归属语义。
- **pending → draw/navigate 仲裁**：paper 内部 `pending` 到 `drawing` / `navigate` 分开仲裁。
- **cancel 三态**：`completed` / `failed` / `cancelled` 明确区分；指针取消丢弃未提交笔迹（不产生 document commit）。
- **尺子会话**：抓取偏移保持；角度按 45° 吸附；双 touch 为刚体变换且**不缩放**（高度、刻度间距、PPI、无限长条几何不变）。
- **选区会话**：移动/缩放/旋转走高频 preview，pointer up 时**一次 commit**。
- **验证方式**：controller / core 单测覆盖单指/二指导航仲裁、指针取消、尺子抓取偏移与 45° 吸附、双指刚体、选区移动/缩放/旋转。

## 4.4 移除 multi-drag 运行时依赖

- **删除运行图**：`@system-ui-js/multi-drag`、`@system-ui-js/multi-drag-core` 以及 external virtual-paper 的运行时路径均已从生产运行图中移除；源码中仅剩历史说明性注释，无运行时引用。
- **`pnpm why --recursive` 无活动路径**：对以下三包均无输出（无依赖路径）：
  - `@system-ui-js/multi-drag`
  - `@system-ui-js/multi-drag-core`
  - `@hamster-note/virtual-paper`
- **残留说明**：`yarn.lock` / `node_modules` 孤儿条目与历史文字描述**不是活动运行图**，其物理清理归 **11.2**（legacy/Vite 清理阶段），不在本阶段顺带处理。
- **验证方式**：源码与打包产物检索不到 multi-drag 运行时引用，`pnpm test` 与 `pnpm build` 通过。

## 4.5 virtual-paper Transform 等价

- **内部 display-only Frame**：`VirtualPaperSurfaceFrame` 为纯展示视口渲染框，不监听手势、不消费交互配置（相关 props 标注 deprecated）。
- **wrapper / container contract**：wrapper（`data-testid="virtual-paper-wrapper"`、class `virtual-paper-wrapper`）与 container（`data-testid="virtual-paper-container"`、class `virtual-paper-container`）结构保留。
- **single transform**：container 上恰好一次精确 CSS transform：`translate3d(${tx}px, ${ty}px, 0) scale(${scale})`，`transform-origin: 0 0`；`containerStyle` 无法覆盖 transform。
- **无未使用路径**：不存在 `readerMode` / `bounds` 相关路径。
- **真实 Chromium E2E 命令**：

```bash
python3 /home/zhangxiao/.config/opencode/skills/webapp-testing/scripts/with_server.py \
  --server "pnpm --dir apps/playground run dev:web" \
  --port 5266 --timeout 90 \
  -- python3 /tmp/opencode/phase4_web_e2e.py
```

- **E2E 观察结果**：
  - Ctrl + wheel：scale `1 → 1.37713`。
  - trackpad 平移：scale 保持 `1.37713` 不变，translation 改变。
  - 双 touch 固定 pinch 对：scale 到 `2.3239`。
  - 第三根手指不替换已锁定 pinch 对；剩余触点不继续已完成的固定对。
  - 尺子双指操作未被 viewport 抢占（viewport transform 不变）。
  - 无 console error / page error。
  - `drawing-surface-uncontrolled` 内恰好一个 CSS viewport transform。
  - 导航过程中未提交绘画。

## 终验命令与结果

| 命令 | 结果 |
| --- | --- |
| `pnpm test` | **41 suites / 750 tests passed** |
| `pnpm typecheck` | **通过** |
| `pnpm build` | **通过** |
| `pnpm lint` | **0 error / 6 known warnings** |
| `git diff --check` | **通过（exit 0）** |

- `pnpm build` 仅有 `painting-board` Bob 的既有 exports warnings，无新增阻断。

## Oracle 非阻断风险（记录）

- normalizer 传入 `point` 时仍读取 `rect`（读取 rect 属既有行为，非本轮新增缺陷）。
- controllers 共享 normalizer，但尚未全部改用 `createWebInputAdapter` 的 lifecycle。
- controlled viewport 延迟拒绝场景的 E2E 主要由 component tests 覆盖，尚无独立真实浏览器用例。

## 边界与债务

- **4.2 外部设备债务**：Linux 环境无 iOS/Android 模拟器或真机，缺少真正「native input → Native Adapter → core GestureSession → 可观察绘制/导航」证据；Metro export 静态导出与单测不替代真实设备运行时门。4.2 保持未勾选。
- 任务 **1.4** 债务不变，本报告未修改其状态。
- 本报告不声称阶段 4 之外的后续产品实现；下一阶段勘查可开始，但不在本报告范围内启动实现。
