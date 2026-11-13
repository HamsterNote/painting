# layered-web-rendering Specification

## Purpose

定义活动输入与历史显示分层、文档有序混排和幂等提交的可观察契约，确保历史文字与图形共同绘制并避免活动笔迹逐点更新导致全历史重建或错误清屏。

## Requirements

### Requirement: Independent controls and rendering responsibilities

系统 SHALL 分离独立工具栏、无界面编辑控制器、活动绘制层与历史显示交互层；控制器统一拥有文档、history、工具、selection、输入会话和 viewport，不将全部状态逻辑塞入显示组件。活动输入 SHALL 增量接收样本，不因每个 pointer 样本驱动全体历史对象重新 reconcile。

#### Scenario: Active input does not replace history

- **WHEN** 连续向活动笔迹追加多个 pointer 样本且文档未改变
- **THEN** 历史对象身份与显示保持稳定，追加不作为全历史逐点 props/state 更新

### Requirement: Ordered mixed document display

系统 SHALL 按文档顺序绘制历史自由笔、形状、图片和 HTML 文字，任意类型可以交错，document order 等于 paint order；每个自由笔历史对象 SHALL 为单笔填充轮廓而非分段线集合。新笔 SHALL 添加到文档顶层，不提供直接在现有文字之下书写或任意层插入。

#### Scenario: Interleaved types keep paint order

- **WHEN** 文档顺序为自由笔、文字、图片、形状、另一笔自由笔
- **THEN** 显示按同一顺序叠放，文字保留真实 DOM 编辑能力，两笔分别为单笔填充对象

#### Scenario: New ink covers earlier text

- **WHEN** 用户在已有文字覆盖区域开始并完成新笔
- **THEN** 新笔追加顶层，活动预览和历史最终位置均不被错误插到文字之下

### Requirement: Idempotent commit and acknowledged render handoff

系统 SHALL 用 session 关联的 commitId 将原始批次转换成最终几何并只提交一次；活动覆盖 SHALL 在对应历史对象挂载且最终渲染内容确认后移交，不得仅设置状态就清空。交接 SHALL 防止丢失笔迹、无历史时的空白和可观察的半透明双重叠加，不默认用 crossfade 掩盖；迟到/重复确认 MUST 不清除下一笔。该确认只证明 Web 内部渲染交接，不声称浏览器或跨进程 physical paint 原子同步。

#### Scenario: Delayed history render preserves active ink

- **WHEN** pointerup 已提交但历史挂载/渲染确认被延迟
- **THEN** 活动最终笔迹仍保留，收到匹配确认后只显示一份最终笔迹，半透明颜色不因两份同时可见而变深

#### Scenario: Duplicate commit and stale acknowledgement

- **WHEN** 同一 commitId 重发，且旧确认在下一笔开始后到达
- **THEN** 文档和 undo history 仅新增一次，旧确认不能清空新笔或重复提交

### Requirement: Lasso response remains comparable with populated history

系统 SHALL 在同设备、浏览器、构建、viewport、输入轨迹及输入速率下，对 0、100、500、1000 笔文档执行套索性能对照。每笔包含 64 个确定性样本，场景包含均匀分布的局部圈选和密集分布的全量圈选；每个场景中非空文档绘制阶段平均帧率 MUST 不低于空画布对照的 90%，估算掉帧率 MUST 不高于空画布对照加 5 个百分点，输入到轨迹呈现延迟 p95 MUST 不超过两个显示刷新周期，抬起到最终选区呈现 p95 MUST 不超过 100ms。混合对象场景 SHALL 使用 500 笔加 20 个文字、20 个形状、10 张已加载图片并满足相同门槛。

#### Scenario: Reproducible populated canvas comparison

- **WHEN** 在前台页面，以固定 120Hz 输入持续绘制同一 5 秒轨迹，每场景预热两轮、测量五轮
- **THEN** 每一轮均满足上述帧率、掉帧率与延迟门槛，文档数量、历史内容及绘制顺序不变

### Requirement: Lasso measurements expose timing and workload evidence

性能验收 SHALL 保存构建提交、运行命令、设备、浏览器版本、DPR、刷新周期、viewport、输入类型、确定性数据种子、轨迹和每轮原始时间戳及汇总；平均帧率 SHALL 为观察区间帧间隔数量除以总时长，估算掉帧率 SHALL 为 `missing / (observed + missing)`，其中每个帧间隔 d 贡献 `max(0, round(d / T) - 1)` 个 missing，T 为同次空闲前台页面测得的刷新周期。系统 MUST 同时提供浏览器性能轨迹验证主线程与实际绘制，并区分 rAF 帧间隔估算与物理显示帧；不得以 Node 微基准或单纯 rAF 心跳代替套索呈现证据。

#### Scenario: Timing report can be independently checked

- **WHEN** 工程师提交优化前后的同机报告
- **THEN** 报告包含每一轮的分子分母、原始时间戳、输入到对应轨迹更新的延迟、抬起到选区呈现延迟及 trace，可按公开公式重算；空画布平均帧率低于显示刷新率的 90% 时标为环境无效并排除通过结论
