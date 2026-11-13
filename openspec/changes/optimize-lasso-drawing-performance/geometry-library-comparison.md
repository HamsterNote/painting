# 套索几何库选型（2026-11-13）

结论：本轮保留已在产品中使用的 `polyclip-ts@0.16.8` 与现有命中适配层，不新增或替换产品依赖。现有工作包括候选索引、nonzero 规范化、边界/距离补判及兼容回退，换一个面积裁剪函数不能替代这些语义。

## 候选对比

包体积为本机 esbuild 0.28.0、browser/ESM/minify、入口全部导出及运行时依赖打包的原始/gzip KiB（1024 字节）；不是 npm 下载大小，也不代表按单函数 tree-shake 的最终增量。Clipper 使用 `web/index.js`，含内嵌 WASM/Asm.js。原始字节数及独立安装 lockfile 随证据交付。

| 候选 | 许可证与本轮限制 | 维护证据（最新 npm / 默认分支 commit） | 包体积 | 自交与退化 | 点、线、margin 与现有语义 |
| --- | --- | --- | --- | --- | --- |
| [polyclip-ts 0.16.8](https://github.com/luizbarboza/polyclip-ts) | MIT；bignumber.js MIT；splaytree-ts 的 package.json 把 BSD 拼成 BDS，实际 LICENSE 是 BSD-3-Clause，符合允许范围 | 2024-12-17 / 2025-11-09；未归档，近期默认分支提交是依赖维护，发布频率低 | 41.4 / 15.1 KiB；npm 解包 452.0 KiB | 文档明确 self-touch/self-cross，nonzero；重复点忽略、无需手动闭环；单点/线/共线输入实测 union 为 []，空 ring 抛错 | 多边形布尔操作，不直接提供点/线命中或 margin；面积交集不能表示仅边界接触。已是本项目 canonicalizer/精确回退核心；保留 |
| [polygon-clipping 0.15.7](https://github.com/mfogel/polygon-clipping) | 顶层 MIT；传递依赖 robust-predicates 为 Unlicense，若严格执行 MIT/Apache/BSD 白名单则不能直接新增 | 2023-12-18 / 2024-04-19；未归档，维护较静态 | 28.9 / 9.5 KiB；npm 解包 342.0 KiB | 同样声明 nonzero、自交、重复点、未闭环；本次退化探针与 polyclip 相同，但这不证明数值等价 | 无点/线/margin API；基于浮点数与 robust orientation，而 polyclip-ts 使用 BigNumber。不能因更小就认定更快或等价；只作为未来差分候选 |
| [js-angusj-clipper 1.3.1](https://github.com/xaviergonz/js-angusj-clipper) | 包装层 MIT，内嵌 Clipper 6.4.2 的源文件为 **BSL-1.0（Boost）**；不符合本轮白名单。宽松可商用与符合指定许可证列表是两回事 | 2023-02-04 / 2024-01-02；未归档。仓库 pushed_at 为 2026-10-14，不能把它冒充默认分支代码更新 | 525.7 / 169.5 KiB；npm 解包 1.83 MiB | 布尔操作支持复杂环，可指定 NonZero/EvenOdd；点测试与 offset 文档要求简单多边形，自交需先 simplify/union；闭合点/线/共线抛 invalid path，开放线须显式 closed:false | 有 pointInPolygon、开放 subject 线裁剪和 offset；clip 必须闭合。整数坐标需定标/舍入；offset 的 join/arcTolerance 不等价于精确最近距离≤margin。需要异步初始化和数据复制；本轮排除 |
| [@turf/boolean-intersects 7.4.0](https://github.com/Turfjs/turf/tree/master/packages/turf-boolean-intersects) | 顶层 MIT；tslib 0BSD；传递依赖 robust-predicates **Unlicense**、tinyqueue **ISC**，严格白名单不通过 | 2026-08-03 / 单包目录最近提交 2026-08-07；整个 Turf 默认分支 2026-11-11，仍活跃，不能把 monorepo 活跃度全部算到本函数 | 16.7 / 5.2 KiB；单包 npm 解包 11.7 KiB（不含依赖） | `ignoreSelfIntersections=true` 控制交点检测，不是任意自交区域的 nonzero 规范化保证；点测试走 point-in-polygon-hao 的奇偶规则。空 ring 可抛 TypeError，点/线退化 Polygon 不应依赖其偶然结果 | 直接支持 GeoJSON Point/LineString/Polygon 与边界命中；无 margin 参数。需要按对象类型、闭环/孔/非有限输入适配。不能用地理坐标 buffer 代替画布世界坐标 .25 容差；非直接替代品 |
| [clipping 0.1.9](https://github.com/hyzhak/clipping) | MIT | 2015-03-26 / 2015-03-28 | npm tarball 4151 字节；不做几何 bundle 测量 | 不适用 | 这是压缩文字长度的服务，不是 Clipper；名称排除 |

现有仓库也直接依赖 Unlicense 的 robust-predicates；这是继承基线，并非本次新增许可决策。本轮保持原依赖不动，不据此擅自扩大白名单。

## 必须保留的产品契约

`layeredObjectQuery.ts` 对笔画使用实际可见区域轮廓，对形状、图片、文字使用已变换到世界坐标的几何；套索填充为 nonzero。`intersects` 包括面积交集、互相包含、边界接触和边界最短距离 ≤ margin；shape margin 为 0.25 世界单位，其余为 0。形状线宽已计入几何，不能再用中心线粗略替代。`contains` 是另一个契约，不能混成普通相交。

旧 P2、共线分离的历史正判定及 seed245/index9180 都有明确兼容测试。即便某个历史正判定不符合通常的数学定义，也不能在性能修改里顺手改掉它。替换时必须逐个对照输入、完整有序 ID、错误和取消语义，再决定是否另行批准行为迁移。

## 实测探针，不等价于完整正确性证明

`scripts/perf/lasso-library-probe.mjs` 使用固定版本、独立 node_modules，覆盖正常正方形、重复点、蝴蝶结、同向绕两圈、点、线、共线、空 ring 和仅贴边。

- 同向绕两圈：polyclip-ts、polygon-clipping、Clipper NonZero union 保留正方形；Turf 对中心点返回 **false**。这是实际语义反例。
- 两个仅贴边正方形：两种面积布尔 intersection 返回 `[]`，Turf 返回 **true**。不能用 `intersection.length > 0` 实现本产品 intersects。
- 单点、两点、共线闭合路径：两种面积库返回 `[]`，Clipper 抛错；空 ring 的错误也不同。因此输入过滤与退化策略必须由适配层统一。
- 本次未测任意浮点数、极大/极小坐标和全部 P2 的跨库行为，未做跨库性能排名。包体积不是运行性能证据。

重跑（只写 research 目录）：

```sh
npm install --prefix artifacts/research/lasso-release/libraries --ignore-scripts --no-audit --no-fund polyclip-ts@0.16.8 polygon-clipping@0.15.7 js-angusj-clipper@1.3.1 @turf/boolean-intersects@7.4.0
node scripts/perf/lasso-library-probe.mjs
```

npm metadata、GitHub 默认分支 SHA、原始 tarballs、包体积、LICENSE 和探针输出见附件 `libraries/`。关键来源：

- [polyclip-ts 输入语义](https://github.com/luizbarboza/polyclip-ts/blob/bef480bf8b035777d64a4ea857df109b5931aa61/README.md)、[polygon-clipping 输入语义](https://github.com/mfogel/polygon-clipping/blob/82b0ac2c35304bfea9cac24eabcbda32a808ee55/README.md)。
- [Clipper 原生代码 Boost 许可](https://github.com/xaviergonz/js-angusj-clipper/blob/984c5a0e17982cac8b59a3a77171962038f9b2e7/src/wasm/clipper.hpp)、[点/offset API](https://github.com/xaviergonz/js-angusj-clipper/blob/984c5a0e17982cac8b59a3a77171962038f9b2e7/src/index.ts)。
- [Turf boolean-intersects 源码](https://github.com/Turfjs/turf/tree/4970f9f5276576e5eafddc26d9b6dc96f5af1d7f/packages/turf-boolean-intersects)、[点判定源码](https://github.com/Turfjs/turf/tree/4970f9f5276576e5eafddc26d9b6dc96f5af1d7f/packages/turf-boolean-point-in-polygon)。
