# Spec Delta

## ADDED Requirements

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
