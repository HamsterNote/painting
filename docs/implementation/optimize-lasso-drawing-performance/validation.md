# 套索性能验证（HAM-245）

## 可复现命令

```sh
pnpm install --frozen-lockfile
pnpm run prepare:playground-artifacts
pnpm --filter @hamster-note/painting-playground exec expo export --platform web --source-maps
node scripts/perf/lasso-production.mjs baseline-coalesced
node scripts/perf/lasso-report.mjs artifacts/research/lasso/baseline-coalesced-chromium
# 修改后用相同命令构建；runner 的 label 改为 optimized。
# 独立 WebKit：LASSO_BROWSER=webkit node scripts/perf/lasso-production.mjs optimized
```

runner 自动启动并在结束时关闭 production 静态服务。默认 seed=245、1280×800、DPR=1，局部/密集场景为 0/100/500/1000 笔，混合场景为 0 与 500 笔+20文字+20形状+10图片。每笔64点；600个轨迹样本按照5秒的绝对120Hz时间表生成，主线程繁忙时将全部到期样本通过 getCoalescedEvents 成批投递，不丢样本、不按 rAF 投递。记录 due 与实际投递 start/end，输入延迟须同时考虑队列迟到。每档每场景两轮预热、五轮测量，空/非空交替；保留全部原始数据。

`environment.json` 保存提交、环境、命令；`bundles/` 保存实际执行的 production bundle 与 source map；每轮 JSON 保存原始 rAF、输入/preview/selection 时间戳及 DOM 路径、begin/end、历史 render 和注册扫描计数。最后一轮保存 CDP trace 与 sampling profile；report 根据同一构建 source map 符号化。rAF 与下一帧机会只是呈现代理，不证明物理显示或真实 Apple Pencil 质量。未变化的选区不通知，因此 selection 通知延迟不能单独证明每次查询都在100ms内完成。

FPS=1000×帧间隔数量/间隔总时长；每个间隔 d 的 missing=max(0,round(d/T)-1)，掉帧率=missing/(observed+missing)。T 为同轮空闲前台页面的间隔中位数。相应空画布 FPS<0.9×1000/T 时该组环境无效，不能给出性能验收通过结论。所有轮次与失败指标均需保留，不挑最好一轮。

## 真机入口（未验证）

本运行环境为 Linux，无可用 iPad Safari、iOS WebView 或实体 Apple Pencil。不能将 Chromium/WebKit 合成 PointerEvent 结果视为真机证据。

在 iPad Safari 与 iOS WebView 分别运行同一 fixture：`/layered-editor?diagnostics=1&fixture=lasso&lassoCount=1000&lassoScenario=dense`；对照 lassoCount=0，另测 local、100/500及 mixed（500）。记录机型、iOS/浏览器或宿主版本、DPR、稳定刷新周期、触摸/实体笔方式、构建SHA和设备设置。使用 Safari Web Inspector Timeline 采集脚本、layout/paint/composite、GC及长任务，两轮预热、五轮记录。验证实时轨迹和临时选区、抬起最终结果、取消恢复、选区移动/缩放/旋转、undo/redo。逐轮核对方案门槛后再验收。

## 状态

基线采集中；尚未修改优化代码，尚无性能通过结论。
