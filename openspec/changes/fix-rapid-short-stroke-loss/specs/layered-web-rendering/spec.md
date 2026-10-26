# Spec Delta

## MODIFIED Requirements

### Requirement: Idempotent commit and acknowledged render handoff

系统 SHALL 用 session 关联的 commitId 将原始批次转换成最终几何并只提交一次；活动覆盖 SHALL 在对应历史对象挂载且最终渲染内容确认后移交，不得仅设置状态就清空。交接 SHALL 防止丢失笔迹、无历史时的空白和可观察的半透明双重叠加，不默认用 crossfade 掩盖；迟到/重复确认 MUST 不清除下一笔。该确认只证明 Web 内部渲染交接，不声称浏览器或跨进程 physical paint 原子同步。首笔尚未交接时，后续正常完成笔 SHALL 各自保有待交接呈现且允许新笔开始；确认 SHALL 按每笔身份生效，最终显示顺序与文档一致。等待交接的笔被撤销后 SHALL 不再显示，迟到确认不得使其复活。

#### Scenario: Delayed history render preserves active ink

- **WHEN** pointerup 已提交但历史挂载/渲染确认被延迟
- **THEN** 活动最终笔迹仍保留，收到匹配确认后只显示一份最终笔迹，半透明颜色不因两份同时可见而变深

#### Scenario: Duplicate commit and stale acknowledgement

- **WHEN** 同一 commitId 重发，且旧确认在下一笔开始后到达
- **THEN** 文档和 undo history 仅新增一次，旧确认不能清空新笔或重复提交

#### Scenario: Several short strokes finish before the first handoff

- **WHEN** 三笔独立短笔在第一笔历史确认前完成，确认延迟 300 ms，并在等待期间开始第四笔
- **THEN** 三笔已完成墨迹各自持续可见，第四笔可正常绘制；确认完成后每笔只显示一份，旧确认不清除第四笔，最终顺序与文档一致

#### Scenario: Reordered and duplicate acknowledgements preserve translucent ink

- **WHEN** 连续 opacity 0.5 的短笔跨越已有文字、图片和形状，后笔确认先到、旧确认重复到达或身份不匹配
- **THEN** 不发生丢笔空窗、重复变深或混排顺序颠倒，错误身份确认不退休其他笔，匹配确认最终到齐后待交接呈现收敛

#### Scenario: Undo before handoff cannot resurrect a short stroke

- **WHEN** 已提交短笔尚未交接时被撤销，下一笔开始后收到被撤销笔的迟到确认，再通过有效历史重做恢复原笔
- **THEN** 撤销后原笔及其覆盖消失，迟到确认不使其复活或清除新笔；合法重做仅恢复历史对应的一笔
