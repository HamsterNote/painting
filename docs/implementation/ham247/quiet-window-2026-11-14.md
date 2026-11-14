# HAM-247 安静窗口基线尝试（2026-11-14 09:56–09:59 UTC）

**首个轮内门禁不通过，已停止；有效性能样本为 0。** 第 1 条 63 个 p95、第 2 条松手延迟和第 3 条 20% 回退占比均未取得新读数，不作通过或失败的性能判定。

## 冻结对象与测量控制

- 产品 A/B 都是 `521aada3fb330ce632d22c1385ead6cab5b23770`，纯基线 A/A。
- 被执行 runner：`7b67b2b02ae9a7d543dcee3a6b8bb4a831678fed`。
- Node 24.15.0，Chromium Headless Shell 147.0.7727.15，Intel i7-8700，6 个可用核。
- 按本次指令显式设置 `LASSO_CPU_RATE=6`；此前内核入口默认 1×。本次将实际 rate 写入元数据并对 A/B 页面设置 CDP 6×。这不是与旧 1× 数据可直接比较的性能改善。
- 内核仍计划 2 预热 + 5 正式 + 1 诊断；新指令要求轮内污染即停止，因此移除污染后的自动重试行为。启动前 60s × 最多 20 次等待保持。
- `sampleHost` / `hostVerdict` 和产品源码未改；门限仍为六核 load≤3、idle≥50%。

## 命令与退出记录

第一次启动：

```sh
LASSO_CPU_RATE=6 node scripts/perf/lasso-prefix-paired.mjs artifacts/research/ham247/quiet-window-1 521aada3fb330ce632d22c1385ead6cab5b23770 521aada3fb330ce632d22c1385ead6cab5b23770
```

09:56:59.354Z 预检通过：load=2.21，idle=64.49511400651465%。
随后 Playwright 找不到 v1217 浏览器，退出码 1，未执行任何测量查询。原始错误：

```text
browserType.launch: Executable doesn't exist at /home/zhangxiao/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell
```

补齐运行依赖：

```sh
pnpm exec playwright install chromium
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 pnpm exec playwright install chromium
```

第一条退出码 1：Playwright 尚不支持主机报告的 ubuntu26.04-x64；
第二条使用 Ubuntu 24.04 的浏览器包下载目标，成功安装锁定的 Chromium 147.0.7727.15。
这里只选择下载包平台，未改 CPU、负载门限或产品依赖。两个安装日志均保留。

新目录再次启动（尚无污染测量轮，此次是修复启动依赖后重启）：

```sh
LASSO_CPU_RATE=6 node scripts/perf/lasso-prefix-paired.mjs artifacts/research/ham247/quiet-window-2 521aada3fb330ce632d22c1385ead6cab5b23770 521aada3fb330ce632d22c1385ead6cab5b23770
```

| 阶段 | UTC 开始 | 1/5/15 分钟 load | idle | 结果 |
| --- | --- | --- | ---: | --- |
| 启动预检 | 09:58:43.337 | 2.47 / 2.97 / 5.08 | 64.70588235294117% | 通过 |
| local-0-r0-a0 轮前 | 09:58:44.456 | 2.47 / 2.97 / 5.08 | 32.61538461538461% | 拒绝：idle-cpu-below-50-percent |

退出码 **2**。这是第一个预热轮的轮前门禁，未执行该轮任何前缀查询，且没有自动重试。
`attempts.json` 保存了这条 `accepted=false / timingValid=false` 的记录，
`pairs.json` 是 `[]`。拒绝发生在轮前，记录里的 `after` 复用了 `before`，
不代表第二次独立采样。不能仅凭这些主机读数归因于其他通道或浏览器启动。

第 2 条 UI 和第 3 条 round 7 诊断均未启动。没有绕开首个污染轮继续采样。

## 第 1 条：完整 63 项覆盖表

每格对应一个独立的场景/前缀组合；“未测”不是 0ms，也不是通过。
不存在可报告的幸存性能样本。

| 场景/笔数 | p3 | p30 | p150 | p300 | p450 | p599 | p600 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| local/0 | 未测 | 未测 | 未测 | 未测 | 未测 | 未测 | 未测 |
| local/100 | 未测 | 未测 | 未测 | 未测 | 未测 | 未测 | 未测 |
| local/500 | 未测 | 未测 | 未测 | 未测 | 未测 | 未测 | 未测 |
| local/1000 | 未测 | 未测 | 未测 | 未测 | 未测 | 未测 | 未测 |
| dense/100 | 未测 | 未测 | 未测 | 未测 | 未测 | 未测 | 未测 |
| dense/500 | 未测 | 未测 | 未测 | 未测 | 未测 | 未测 | 未测 |
| dense/1000 | 未测 | 未测 | 未测 | 未测 | 未测 | 未测 | 未测 |
| mixed/500 | 未测 | 未测 | 未测 | 未测 | 未测 | 未测 | 未测 |
| mixed/1000 | 未测 | 未测 | 未测 | 未测 | 未测 | 未测 | 未测 |

## 第 2、3 条

| 松手档位 | 冷态 p95 | 判据 | 本轮裁定 |
| --- | --- | --- | --- |
| 0 | 未测 | ≤150ms | 无有效数据 |
| 100 | 未测 | ≤150ms | 无有效数据 |
| 500 | 未测 | ≤150ms | 无有效数据 |
| 1000 | 未测 | 不设阈值，给相对 500 增量 | 两档均未采集，增量不可得 |

逐候选回退诊断：没有进入 `round === 7`，没有新候选耗时或 20% 占比判定。
历史 23.16%–70.55% 仍为受污染观察，不能拿来补本轮数据。

## 验证与交付状态

本轮测量控制改动的 ESLint、Prettier、Node 语法与 diff 检查通过。
真实启动也验证了轮前污染后立即退出，浏览器已由 runner 的 finally 关闭。

PR #57 描述同步以上数据，保持草稿：完整测量未跑完，尚不满足“跑完后转 ready”。
性能工作继续等待有效窗口；没有修改算法、放宽门限或提速声明。
