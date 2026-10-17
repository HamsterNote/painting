# Document round-trip（model/documentReader）验证证据

- 日期：2026-10-14 ｜ 范围：schema3 reader、往返测试与文档。
- 主编排已核对源码、测试及最终日志，验收任务 2.2；不代表完整 UI 或 Phase 2 总审核通过。

## 1. Hash 与验证

| 对象 | sha256 | 规模 |
|------|--------|------|
| `model/documentReader.ts` | `d0697f862b2da8ccfe9c0fd38c47b734cfc202c7bad171ef5786982573e90a7c` | 当前落盘 |
| `__tests__/core/layered-document-roundtrip.test.ts` | `4acff0f84f9c565cf5dec694e13d9c0cd1406b19a1cbba576a7944c78d7d1077` | 26 tests |

- `core-node` focused：**26 tests PASS，EXIT_CODE=0**
- 直接 strict tsc：EXIT 0；`--listTests` 收集 1
- 日志：`~/.cache/opencode-tmp/opencode/pf-document-{jest,tsc,listTests,hashes}.log`
- 最终联合验证：7 个 core-node suites / 169 tests 与 1 个 jsdom suite / 71 tests，合计 **240 tests PASS**；painting 包 typecheck、两个新增测试的直接 strict tsc 均 exit 0，新增测试各收集一次。
- 最终日志：`~/.cache/opencode-tmp/opencode/pf-document-affine-final-{core,dom,typecheck,testtsc,listTests,hashes}.log`。这些证据只覆盖所列测试，不是全仓或浏览器像素验收。

## 2. 冻结 API（5 exports）

- `DocumentReadError { code: 'invalid-json' | 'invalid-document'; path: string }`
- `DocumentReadResult<T> = { ok:true; value:T } | { ok:false; error:DocumentReadError }`
- `readLayeredDocument(unknown)` / `parseLayeredDocument(json:string)` / `serializeLayeredDocument(unknown)`

## 3. 覆盖语义

- **schema/修订/顺序**：仅 schemaVersion 3；documentRevision 与各对象/transform/samples/brush revision 为安全非负整数；objects 顺序即 round-trip 顺序。
- **身份**：objectId 唯一；freehand commitId 唯一（重复即 invalid-document）。
- **白名单 + 深冻结**：逐层只保留 known 字段并深 copy/freeze；注入的真实 `strokePoints`/`predicted`/`interpolated`/`cache`/`sessionId`/`pointerId`/`pressureMultiplier` 与各处 extra 字段在 `serialize→parse` 后全部剔除；freehand brush 不含 dash。
- **affine/bounds**：transform 各分量有限且矩阵非奇异；bounds 有限且 min<=max。
- **freehand raw**：>=2 且 seq 从 0 连续、首 down 末 up、中间 move、单一 source；x/y/time 有限；pressure 可选——缺失保持缺失、`0` 保留、有限越界原值保留；time 不排序、重复坐标不去重；单点 tap（相同 xy 的 down/up）保持。
- **mode**：显式 `resolvedPressureMode` 必须与 brush `pressureMode` 一致（`auto` 不重新解析）。
- **shape/image/text**：shape style（dash 非负有限，fill 可选）points 数量不额外约束；image src 非空、resourceId 可选非空；text content 允许空、fontSize>0、color 非空。
- **JSON 故障**：不可解析 JSON/非字符串 → `invalid-json`；结构非法 → `invalid-document`，`error.path` 指向已知字段（如 `$.objects[0].samples[1].pressure`）。
- **真实 controller round-trip**：真实 controller commit → `serialize` → `parse` → 新 controller；已保存的 commitId 查询返回 `duplicate`，registry 从当前文档恢复；可继续 commit 并真实 undo；`serialize→parse→serialize` 幂等。测试使用真实 `LayeredBeginInput`/`FreehandSessionEnd`/`LayeredEditorResult`，每阶段失败即 throw。没有声称撤销历史或已删除对象的 tombstone 跨存档恢复。

## 4. 边界与未做

- reader 为**纯内存 typed document 读写**：无 disk/网络、无 UI/React/DOM、无 V2/strokeMigration、无预测/插值/PF 轮廓/缓存/transport 持久化。
- `core/layeredEditorController.ts` 的 typed adopter 是 controller 内部另存路径，**不等于已接入完整 UI/绘制入口**。
- 本证据为 headless core-node 单元/集成证据，不代表 UI、三平台或真机验收。

## 5. 状态

- 任务 2.2 已验收；5.2 的 affine 基础仅有纯函数证据，选择/变换/命中集成仍未完成。
