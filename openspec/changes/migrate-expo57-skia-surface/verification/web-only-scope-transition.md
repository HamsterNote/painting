# 范围过渡记录：Web-only 正式验收 + 移动 `compat-static`

- 变更：`migrate-expo57-skia-surface`
- 性质：**范围过渡记录（transition record）**，非阶段门禁通过报告
- 日期：2026-09-25
- 验证所有者：父 orchestrator
- 关联决定：`decisions/web-only-acceptance-scope.md`
- 写入范围：仅规划/状态工件。**未修改任何历史验证报告**；**未修改产品源码、测试、`package.json`、lockfile、CI**。

## 1. 本记录目的

记录从旧范围（iOS/Android/Web 三端真实运行、性能、E2E 为验收 MUST）到新范围
（**Web-only 正式验收 + 移动端 `compat-static` 静态兼容门**）的过渡，
并区分 **PASS / CANCELLED / REPLACED / OPEN**，避免把被取消的原生运行任务伪装成原生通过。

## 2. 过渡前后的规范性变化

- 旧：spec 要求「iOS、Android 与 Web 统一运行时并完成可交互启动」「原生不得静默 no-op」
  「三端功能对等验收」「真实原生 E2E 是门禁」。→ 这些原生运行 MUST **CANCELLED / REPLACED**。
- 新：**Web 交互启动 MUST** + **iOS/Android 静态目标兼容要求（`compat-static`）**；
  Web 功能/性能为正式验收面；原生保留开发但**不做自动验收**。

## 3. 移动端 `compat-static` 门（精确要求）

1. 根 `pnpm typecheck` 通过；
2. `expo export --platform ios` 与 `expo export --platform android` **静态导出成功**；
3. native Jest/RNTL **最小挂载**通过。

**证据标签**：`[evidence:compat-static][target:ios|android][executor:linux]`。
**禁止**标注为平台运行证据，**禁止**声称安装、启动、RNGH、Skia 渲染、IME、picker、权限或性能通过。

## 4. 任务状态对照（摘要）

| 任务 | 过渡后状态 | 说明 |
| --- | --- | --- |
| 1.4 | `CANCELLED` + `REPLACED` → 静态 PASS | 原生启动取消；替换为 iOS/Android 静态导出兼容 |
| 4.2 | `CANCELLED` + `REPLACED` → 静态 PASS | 真手势取消；替换为 Native Adapter 静态模块 + RNTL 最小挂载 |
| 6.3 | `OPEN` | 安全几何支持继续（partial curve/ellipse、复杂/自交闭合、contour cap） |
| 7.4 | `OPEN` | Web 默认 Skia 编辑面，未取消 |
| 8.1 / 8.2 / 8.5 | `OPEN` | 原生运行取消；改为 Web 编辑/组合/导入验收面，尚未覆盖正式 Web 编辑面 |
| 9.2 | `OPEN` | legacy 先替代后退役 |
| 9.4 | `OPEN` | 三端 E2E 取消；改为 Web E2E，正式 Web 编辑面覆盖仍欠 |
| 10.1 / 10.2 / 10.3 | `OPEN` | 原生条件被覆盖；Web 性能合同已批准但未执行，Web 默认切换依赖 7.4 |
| 11.1 | `OPEN` | 仅 7.4 完成后才涉及 legacy 删除 |
| 11.3 / 11.4 / 12.1 | `OPEN` | 改为 Web 交付 + 移动静态兼容 |

完整矩阵见 `decisions/web-only-acceptance-scope.md` 第 3 节。

## 5. 仍 OPEN 的 Web 阻塞项

1. **6.3**：安全几何支持（partial curve/ellipse、复杂/自交闭合路径、contour cap、完整 f32 预算）。
2. **正式 Web Skia 编辑面 + 7.4**：Web 最终默认切换尚未实施。
3. **8.1 / 8.2 / 8.5**：正式 Web 编辑面、组合/多行/emoji、Web shell importer 覆盖。
4. **9.4**：正式 Web 编辑面的 Web E2E 覆盖（现仅有隔离 fixture）。
5. **9.2**：legacy DOM/SVG 测试与 multi-drag mock 的等价覆盖后退役。
6. **10.1 / 10.2 / 10.3**：Web 性能合同执行、Web 功能验收、Web 默认切换门。

## 6. 不宣称

- **不**声称 change 完成，**不**声称任何阶段整体完成。
- **不**声称原生运行/触控/手势/Skia/IME/picker/性能/E2E 已通过（这些已 CANCELLED）。
- **不**以 `compat-static` 静态门冒充运行时/功能通过。
