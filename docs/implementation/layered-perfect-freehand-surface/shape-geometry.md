# Shape geometry（geometry/shape.ts）验证证据

- 日期：2026-10-14 ｜ 范围：仅测试与文档；未改 source/tasks。
- 记录**当前 hash 与测试支持边界**；不代表 5.1 完整完成。

## 1. Hash 与验证

| 对象 | sha256 | 规模 |
|------|--------|------|
| `geometry/shape.ts` | `23e5f6b02beba5fd005164bf6d4d453859cd053691aaa0cd865459a9b1822ac4` | 终态 |
| `__tests__/core/layered-shape-geometry.test.ts` | `c1e1b327fd9c4afa5ec747b173b12ea769c5555a9bc0aed910100f2b62136244` | 513 行 / 38 tests |

- `core-node` focused：**38 tests PASS，EXIT_CODE=0**
- 直接 strict tsc（`lib ES2020,DOM`）：EXIT 0（含 `CanvasRenderingContext2D`/`Path2D` 结构兼容）
- `--listTests` 收集 1
- 日志：`~/.cache/opencode-tmp/opencode/pf-shape-{jest,tsc,listTests,hashes}.log`
- 主编排冻结联合验证：8 个 core-node suites / 207 tests + 1 个 DOM suite / 71 tests，共 278 tests PASS；painting 包 typecheck exit 0。日志 `pf-shape-final-{core,dom,typecheck}.log`，不代表全仓或浏览器像素通过。

## 2. 冻结 6 exports

- 类型：`ShapeCommand`、`ShapePathTarget`、`DerivedShapeGeometry`
- 函数：`deriveShapeGeometry(shape)`、`shapeCommandsToSvgPath(commands)`、`replayShapeCommands(target, commands)`

## 3. 覆盖语义（local 纯几何）

- line：2 点 → moveTo+lineTo；相同点退化有效；点数/非有限 → null。
- rect：2 角点（含 reverse）；零 area 仍有效；点数不为 2 → null。
- polygon：≥3；差值法共线判定（origin 10,10 / dir 10,20 / third 10,30 → null；third 20,30 → 有效）；首/中重复允许，重复末点拒绝；巨坐标 cross 溢出 → reject；<3 null。
- ellipse：二角点；canonical moveTo+ellipse+closePath；rx0 竖线退化 `(cx,cy+ry)/(cx,cy-ry)`；ry0 横线；双零点退化；角点溢出 null。
- bezier：四点 P0/C1/C2/P3 → moveTo+bezierCurveTo；精确 AABB 用导数根（端点 CP(0,100)/(100,100) 的 ymax=75 非 100；双极值 ±100√3/6）；a=0 线性与恒导数；有限系数但 discriminant 溢出 → null；系数溢出 → null。
- bounds：`localBounds` 精确；`visualLocalBounds` 外扩 width/2，外扩溢出 → null。
- style：color 非空、width>0 有限、opacity 0..1、dash 非负有限、fill 为字符串；非法 → null；未知 shapeType/非有限 points → null；不改 caller、输出深冻结。

## 4. SVG 与回放

- SVG 输出准确 M/L/C，无自主平滑；ellipse 展开为**两段 A（large-arc=1, sweep=1）**且**不额外 M/Z**（M/Z 由周边 moveTo/closePath 命令提供）。
- replay 与 commands 一对一：line/rect/polygon/bezier 精确坐标；**不 beginPath、不自主 close**；ellipse 命令只调 `ellipse(cx,cy,rx,ry,0,0,2π,false)`，move/close 由周边命令负责（与 SVG sweep=1 方向一致）。

## 5. 边界与未做

- 仅 local 几何：**不 apply 对象 transform**，不接 controller/UI/渲染入口，不做浏览器 pixel/真机。
- Task 5.1 的 shape/image/text 创建编辑接线、命中与事务等**尚未完成**，本文件仅为 shape 纯几何证据。
- 无 V2/Skia/legacy 依赖；不勾 tasks。
