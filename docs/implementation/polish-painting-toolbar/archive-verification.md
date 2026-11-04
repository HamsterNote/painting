# 工具栏归档记录

2026-11-04，HAM-156 用户评论 `01a1a4eb-a8d1-7bb1-b3a3-10279c915f39` 确认“验收通过”，收尾指令为 `01a1a4ec-3488-7749-bed4-40bd3ae7547e`。实现基线为 PR #44 原分支 `agent/agent/09b8a022c769` 的 `dac5c91`。

## 规格同步与归档

按 `openspec-archive-change` 工作流，先内联执行 `openspec-sync-specs`，校验同步结果后移动 change。使用当前 specs instructions；没有额外 artifact rules。新建主规格 `openspec/specs/painting-toolbar/spec.md`，从 delta 保留 Purpose 原文，并将全部12条 requirement、25个场景合并到单一 `## Requirements` 下。主规格没有 delta 操作标题或 TBD 占位。

对比确认主规格全部 requirement/scenario 内容与归档 delta 一致，其他既有主规格的文件哈希不变。归档位置：`openspec/changes/archive/2026-11-04-polish-painting-toolbar/`，保留 `.openspec.yaml`、proposal、design、delta spec 和 tasks。活动 change 列表中已无本 change；独立的 `replace-pdf-painting-core` 不受本次归档影响。

## 实机待验仍为未完成

任务完成度保持14/16。归档允许携带未完成任务，按本次收尾授权归档；4.2/4.3继续保留 `- [ ]` 并标注“待设备验证”，没有将用户的一般验收确认扩展为以下设备验证结论：

- 4.2：iPad Safari实体笔30笔快速短笔、跨工具栏边界、系统选词与后续首击、中文IME及原生取色器。
- 4.3：iOS/Android Expo DOM宿主的安全区、横滚、软键盘、弹层/焦点；显式启用的iOS PencilKit原生覆盖层。

设备到位后仍需记录设备/系统/浏览器或宿主版本、输入来源、操作结果及证据。浏览器自动化和截图不替代这些待验项。完整验收范围见 [验证记录](validation.md)。

## 本轮验证

| 检查                                                         | 结果                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------- |
| `openspec validate --specs --strict --no-interactive --json` | 7份主规格通过，0失败                                       |
| `openspec validate --all --strict --no-interactive --json`   | 7份主规格及1个其他活动change通过，共8项，0失败             |
| `openspec list --json`                                       | `polish-painting-toolbar` 已移出活动列表                   |
| 内容逐段比对                                                 | 12条 requirement/25个场景及Purpose完整同步，其他主规格不变 |

本轮为规格同步与归档。实现验收的97套件/1316项单测、responder 9项、Chromium 199项和typecheck/lint/build结果保留在验证记录中。
