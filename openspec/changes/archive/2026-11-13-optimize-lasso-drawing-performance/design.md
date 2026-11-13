# Design

## Context

最新优先级为松手选不中P0，停止性能优化与自动重试。两份Mac Edge156鼠标录制已定位lostpointercapture误取消；移除此错误绑定，捕获仅作路由，保留window owner直到up或真正中断。83项回归、156可信捕获试验及8次轨迹oracle回放已验证，原设备仍待修勾复验；见 `capture-loss-fix-validation.md`。下述性能协议保留但暂不继续执行。

最新测量约束以 `measurement-protocol.md` 为准：6核主机一分钟load超过3直接废弃整对样本，记录空闲CPU；两版在同一时段相邻AB/BA执行。主指标是查询边界的Chromium线程CPU时钟与独立操作计数，Paint墙钟仅作端到端验收证据。旧高负载读数不用于前后对比。本轮只改测量与交付工具，不改几何算法、预热或产品代码；PR #53静态服务与原版、main并列供人类先验证拖动手感。

动机见 proposal.md。当前 `layeredToolSession.update` 在每批输入对累计轨迹调用 `queryObjectLasso`，再调用 `setSelection`、`setPreview`。查询每次规范化完整多边形并遍历 prepared.entries，候选再执行几何相交；prepared 已在 begin 构建，不应误写为每次 move 重建几何。

`DisplayLayer` 订阅整个 preview，每次轨迹变化都会 map 历史对象；其 layout effect 依赖 preview，会扫描所有 `[data-object-id]` 并重建 presentation 注册。`ObjectNode` 虽有 memo，不能免除父层遍历及 effect。`SelectionOverlay` 在判定套索工具无需选区框之前先 syncDocument；controller 的 document/preview 是分频道稳定快照，没有发现 move 自动复制全量文档的证据。文本或图层快照仅为待 trace 排除的假设，不新增栅格截图机制。

已阅读 layered-web-rendering、document-object-interaction 全部规格及现有 layered-tools、layered-display-regression 等测试入口；项目无随仓库 propose 命令/技能副本，使用本次安装的 openspec-propose 技能及 CLI 返回模板。配置为 spec-driven，无额外 context/rules。当前独立 change `replace-pdf-painting-core` 已列为任务完成，本方案不修改其产物。

## Goals / Non-Goals

**Goals:** 静态历史不随路径更新扫描；将轨迹呈现与昂贵选择查询解耦；选择结果保持当前 intersects 几何语义；为共享 DOM 路径提供可复现同机证据。

**Non-Goals:** 替换 SVG/绘图引擎、重设计选择规则、迁移文档、优化所有绘图工具、承诺 100k 全可见笔画或所有设备固定 60/120fps。不削减轨迹样本。2026-11-13 修勾明确取消实时选区：拖动只显示轨迹、松手一次查询；这是产品契约变更，不是把旧实时指标算作通过。

## Decisions

### 1. 分离轨迹预览与历史对象预览

将仅 path 变化的订阅和绘制隔离在独立覆盖组件/选择性订阅，历史层只响应 document、viewport、对象替换/隐藏及 presentation 生命周期变化。保持混排顺序、同一 viewport 和交接 token 契约。presentation 挂载确认绑定真实对象/版本/隐藏状态，不因轨迹变化重新扫描。SelectionOverlay 在无关工具下避免历史 cache 同步；相同 selection 不通知。

仅 memo ObjectNode 已存在，不能解决父层开销；整层截图会引入文本、缩放、遮挡与失效复杂度，不采用。

### 2. 采样只发布轨迹，松手一次查询（2026-11-13 决策覆盖原实时方案）

输入层保留完整有序样本，每个显示帧最多发布一次最新轨迹。begin/update 不准备几何、不创建查询、不调度 query work、不提交临时选区；同步无 scheduler 的调用也遵守这个契约。先前的 prepared 几何复用、文档版本关联 bounds 索引和精确相交规则保留，延迟到正常 end 使用。现有独立查询 API 的分批能力不删除。

end 停止排队呈现，使用包括末批输入在内的完整轨迹同步执行一次最终查询，查询成功后提交 selection，非空则切换选择工具。取消实时查询意味着不再需要在途 query/completed/evaluatedVersion 状态；保留会话对象身份、document revision、destroyed 防护和 pathVersion/perfSession 诊断关联，旧预览回调不能覆盖新会话。最终计算前后检查会话有效性，防止观察者重入取消或改变文档。cancel/destroy、工具切换、捕获丢失、失焦及文档变化继续清理旧手势，保留有效原选区。纯圈选不新增 undo。

几何 preparation 也移到 end，因此第一次松手可能更慢；必须独立披露冷、热最终延迟，100ms 的最终呈现目标保留，不能把只绘制流畅宣称为整体达标。DOM 与语义批次共用 session，不增加 core 对 window 的依赖。不替换几何库或改变 margin/退化语义。

### 3. 端到端测量方案

新增当前 `/layered-editor` 路径的专用性能 fixture/runner，复用 `window.__layeredEditor` 诊断入口和已有 pointer 事件通道。固定种子 245、viewport 1280×800、zoom=1、笔宽 3、每笔 64 点；几何在视口内。均匀网格上圈选约 10% 对象，另设密集分布、圈选全部对象的长轨迹；空画布重复各自相同轨迹。混合场景的对象比例按 spec，图像预加载完成后计时。轨迹由固定 600 个点、120Hz 时间表构成，包含闭合长轨迹；输入生成与渲染循环分别调度，记录实际投递时刻，不能每 rAF 只投一个点掩盖过载。固定 DPR=1 的自动化运行与真机原生 DPR 各自成组比较。

预热两轮、每格测五轮，空/非空交替顺序；从 down 结束开始记录到 up 前，begin 查询成本单独记录 down 到首次轨迹延迟并纳入输入延迟，end 阶段单独测最终选区。使用 rAF 原始时间戳按 spec 公式计算 FPS/估算掉帧，记录每轮和汇总（不只最好一轮）。以预览路径对应样本序号、DOM 更新后下一次绘制机会估算输入到呈现延迟，选区同理；明确这是呈现代理，结合浏览器 Performance trace 的主线程、layout/paint/composite 证据，避免把 rAF 采样当作物理帧率。

记录 tool query、候选数量、几何计算、selection/preview 发布、历史 render 和 presentation 注册次数及耗时。仅 path 更新时历史遍历/注册次数应为零，用已有 RenderObserver 加针对性计数证实；同时捕获 GC 和长任务。用优化前后同机 trace 区分 query 与历史层占比，再报告收益；提案阶段无实测数值。

Chromium 与 WebKit 自动化执行功能与性能对照；当前 webkit 配置使用白名单，新测试必须显式加入。iPad Safari 和 iOS WebView 各做同机真机对照，记录机型、系统、刷新率和实体笔/触摸输入方式，使用 Safari Web Inspector Timeline；自动化数据不宣称代表实体 Apple Pencil。若设备不可用，交付时列为未验证项，不能报全平台通过。性能采用 production 构建与独立静态服务配置，现有 Playwright 默认开发服务仅用于功能回归，不混用开发/生产报告。旧 scripts/perf 的 V2 pen oracle 和纯 Node spatialIndex benchmark 不作为本次端到端证据。

## Risks / Trade-offs

- [全量候选和长自交多边形仍昂贵] → 保留完整轨迹 oracle，分批精算并测密集场景；最终查询保留既有规则，不把新的松手选择契约误报为旧实时验收通过。
- [调度导致过时选择覆盖] → session/document/path 版本检查，覆盖 end-before-frame、取消后新手势和文档变更测试。
- [拆层破坏交接或形状预览] → 保留 delayed acknowledgement、半透明单次显示、擦除隐藏、选择变换和混排回归。
- [相对帧率掩盖本来就慢的环境] → 空白基线低于刷新率 90% 判环境无效，保存原始数据与 trace；固定构建、负载和刷新周期。
- [真机刷新周期动态变化] → 前台稳定负载测 T，保存每轮基线和设备设置，不跨设备比较百分比。

## Migration Plan

无存储或公开 API 迁移。先采集基线，再按历史层隔离、查询调度分步落地并同机复测；以现有库发布流程交付。回退时还原该性能改动即可，用户文档无需转换。

## Open Questions

无阻断方案的问题。用户原始复现设备尚未提供，默认验证矩阵见上；具体可用机型和 trace 中各热点占比由实施报告记录，不作为已验证事实。

## 2026-11-13 完整输入诊断补充

基于最新 main 的 production export，使用 headed Chromium、6× CPU throttle、trusted CDP 鼠标输入，固定主机时钟投递 600 点/5 秒，保存实际合并后事件、预览 DOM 更新、CPU profile、Paint/Commit/Raster trace 与源码 maps。使用虚拟 X 显示，不能声称物理手势或 iPad 验证。冷/热轮分开，无效或被取消的手势显式标记；profiling 结果用于归因，不替代原完整验收矩阵。见 `release-only-validation.md`。

## 首次真实套索（2026-11-13最新决策）

第6节实现已将最终查询分批并保留等待反馈，覆盖上文早期同步end设计。最新授权允许首屏之后空闲预热合成查询及当前文档派生索引；begin/update的零真实查询契约不变。空闲工作可被所有输入打断，不在pointermove偷偷继续；没有预热机会时照常走带反馈的最终路径，不阻断输入等待预热。验收记录从加载/预热到首次实际圈选的完整trace，预热成本与真实圈选延迟分别列出；不把第二次真实圈选冒充冷态。

空闲分片最多使用8ms（Safari定时器回退4ms），构造合成样本也按预算让出。已完成和未完成的当前文档准备都可转交最终查询；回调由epoch及一次性守卫失效，不能共享正在前进的准备游标。真实松手先发布保留轨迹与处理状态，再调度分片任务，不额外等待一帧才开始计算。预算为协作式让出，不能抢占单个几何操作；实际任务时长由trace验证。
