# World bounds（geometry/worldBounds.ts）验证证据

- 日期：2026-10-14 ｜ 范围：仅测试与文档；未改 source/tasks。
- 记录**当前 hash 与测试支持边界**；不代表 5.2 完成，不勾 tasks。

## 1. Hash 与验证

| 对象                                          | sha256                                                             | 规模              |
| --------------------------------------------- | ------------------------------------------------------------------ | ----------------- |
| `geometry/worldBounds.ts`                     | `0754477961dd6144ac049a24b807f6886eccc627549f7d87835b75b18135edac` | 当前落盘          |
| `__tests__/core/layered-world-bounds.test.ts` | `3644caa81326bdb141812253f7fc7ab08e04846f2e02ac520525927b352e20d5` | 581 行 / 35 tests |

- `core-node` focused：**35 tests PASS，EXIT_CODE=0**
- 直接 strict tsc：EXIT 0；`--listTests` 收集 1
- 日志：`~/.cache/opencode-tmp/opencode/pf-world-bounds-{jest,tsc,listTests,hashes}.log`
- 主编排冻结联合验证：10 个 core suites（277 tests）及 Web adapter（71 tests）全部通过，painting 包 typecheck 通过；日志 `pf-world-text-accepted-{core,dom,typecheck}.log`。这不是全仓或浏览器像素验证。

## 2. 冻结 2 exports

- `LayeredWorldBounds { worldBounds; visualWorldBounds }`
- `deriveLayeredWorldBounds(object: DocumentObject, cache: FreehandGeometryCache): LayeredWorldBounds | null`

## 3. 覆盖语义

- `worldBounds`：对象局部几何经对象 transform 后的**精确 AABB**（非变换 local box）。
- image/text：四角变换 exact（rotate/shear/mirror/zero-area）；非法 localBounds（无序/缺失）→ null。
- shape：line/rect/polygon 顶点或端点变换；bezier 旋转后按**导数极值**求真实 AABB，并与 dense oracle bounds 一致、**代表性采样点**含于 bounds（1e-9）；identity bezier ymax=75。
- ellipse：rotate45 extent `sqrt(62.5)`（非 box 10.6066）、shear/non-uniform/mirror/平移解析；竖/横/点退化。
- `visualWorldBounds`（shape）：`worldBounds` 按 `halfWidth * σmax` 保守外扩；σmax 为 transform 线性部分最大奇异值。
  - **极端合法有限 scale 稳定**：scale(1e100,1e-100) det1 → world 轴比 ≈1e100/1e-100、padding≈1e100，均 finite 非 null（另一轴同理）；大但 finite 参数下 padding 真溢出（width 1e308）→ null。
- freehand：与真实 `FreehandGeometryCache.getPresentation(object,'final')` 的 worldBounds 一致；`getGeometry(final)` 调用前后同引用。
- 其他：非法/奇异/overflow transform → null；unknown kind → null；结果与两个 bounds 深冻结。

## 4. 边界与未做

- headless 几何证据：无 DOM/renderer、无像素/真机；不接 controller/UI。
- Task 5.2 的命中/选择/编辑接线等**尚未完成**；本文件仅为 world bounds 纯几何证据。
- 无 V2/Skia/legacy 依赖；不勾 tasks，等主编排最终联合验收。
