# Native 与 PencilKit 原型归档验收（HAM-63）

2026-10-25，用户在 HAM-63 评论 `01a1715e-f826-70e5-8f77-84dea958d615` 确认“验收完毕”，随后要求同步归档已验收变更并完成 PR 与审核收尾。本次交付为 Native 运行验证及默认关闭的 iOS PencilKit opt-in 原型，保留完整生产集成的证据门槛。

## 已合并交付与审核

| 范围                   | 代码与结论                                                                                                                                                                                                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HAM-64 Native 运行验证 | [PR #28](https://github.com/HamsterNote/painting/pull/28) 已合并，merge commit `046ce0d`；Expo dev client 配置、LAN/5266 运行脚本及 `docs/implementation/native-run-verification/` 已交付。该阶段未单独建立 OpenSpec change。                                                                                           |
| HAM-66 PencilKit 原型  | [PR #29](https://github.com/HamsterNote/painting/pull/29) 已合并，merge commit `b605e2dd31261d9f3214346325ac30d210b3daa4`，最终 head `99fd16a51b2f9b1346d51e10a61b3e30a09e5971`。包含 Expo Module、G1 Probe、opt-in RN/DOM host、raw→PF 候选桥、按笔预览交接及回归。                                                    |
| 真实设备复测           | EAS development/internal build `3a34fe88-99f7-4889-8543-0e64efb98b4d` 基于 `db07021`、兼容标识 7，安装回执成功。用户在 HAM-66 评论 `01a170bb-f4da-7b49-8675-e4c47029a7c4` 回复“没有问题了”；指定复测涉及关闭后多笔自由笔/Line、笔刷变化、undo/redo、继续操作及重新开启原生输入。无逐项 trace 或旧冻结栈，不能扩大结论。 |
| 审核修复               | `99fd16a` 修复合法系统取消导致持续暂停，以及正常 `web-sibling` 被误报为宿主断连。代码审核员在 HAM-66 评论 `01a170e7-0968-7e8f-bd37-6f4f900c836d` 批准复审，P2/P3 均关闭；该 head 的 CI 4/4 通过。无需重复推送或重开实现 PR。                                                                                            |

Mac 的真实 SDK 编译、UIKit 层级与 setter 返回状态、Simulator 操作和本地自动回归证据保留在 [Demo 验证记录](./demo-validation.md)。这些是已有记录，本次文档收尾没有重跑实体 Pencil 或 Xcode 验证。最终 JS 取消修正晚于上述实体构建，依据为集成回归与代码复审，不能描述为该二进制已验证最终 JS 的系统取消行为。

## 规格同步与归档

归档位置：`openspec/changes/archive/2026-10-25-add-ios-pencilkit-surface/`，保留 proposal、design、tasks、四份 delta 和 `.openspec.yaml`。同步目标：

| 主规格                         | 同步内容                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| `ios-pencilkit-surface`        | 新增 8 条 requirement，描述平台边界、raw、分流、幂等桥、history、生命周期、交接及发布证据门槛。 |
| `input-session-viewport`       | 修改原生语义输入与自动笔检测两条 requirement；保留其余 Web viewport 与输入规则。                |
| `freehand-geometry-pressure`   | 修改共享最终几何规则，允许原生近似活动预览；保留原始样本、压力和缓存规则。                      |
| `web-platform-skia-retirement` | 修改三端入口边界，iOS 仅在原生就绪并显式启用时接管 Pencil；Web/Android 保持原路径。             |

主规格中的生产要求是后续实现和发布的约束，不是所有条文均已通过验收的声明。原 tasks 共 24 项，仅决策确认一项已勾选；其余保留原验收粒度，不将部分实现或用户原型复测伪装成完整生产门槛通过。用户明确授权在此范围归档，因此明确保留未完成任务，并执行 `openspec archive add-ios-pencilkit-surface --yes --json`，不跳过 specs 或 validation。CLI 返回新增 8 条、修改 4 条、删除 0 条、重命名 0 条 requirement。

## 未验范围与后续边界

- G1 压力变化、完整真实采样证据；G2 掌触、中文 IME、缩放/布局等完整设备矩阵；G3 至少 120fps 外部交接视频、延迟/忙碌下的物理呈现、形状收敛以及长期稳定性，均不能由本次验收推定通过。
- 原 3.x 生产桥及其完整故障/资源限额矩阵、全部 4.x/5.x 设备验收项，未逐项完成核验；原型不是默认生产路径。普通 `/layered-editor` 保持 Web/DOM，`?pencilkit=1` 才启用验证路径，默认启用需另行授权并通过原门槛。
- HAM-65 Android 原生接入已取消；A0 探针与草稿 [PR #31](https://github.com/HamsterNote/painting/pull/31) 保留，不合并、不恢复、不将其 delta 同步为已交付能力。保留既有 Android/Web 行为不等于恢复 Android 开发。
- NPM 测试版发布属 HAM-108 / [PR #30](https://github.com/HamsterNote/painting/pull/30)，不在本次修改版本号、发布或处理该草稿。

## 本次归档检查

归档前及归档后 `openspec validate --all --strict --no-interactive` 均为 6 passed / 0 failed；`openspec list --json` 返回无活动变更。同步一致性结果在收尾 PR 中记录；不把此前实现 CI 或设备结果列作本轮新执行的测试。
