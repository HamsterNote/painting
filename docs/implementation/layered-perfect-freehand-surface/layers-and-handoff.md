# HAM-40 工具栏与呈现交接

## 本次实际验证

- `pnpm install --frozen-lockfile`：exit 0，1160 packages，锁文件无变化。
- `pnpm exec jest --selectProjects core-node --runInBand --silent`：42 suites / 777 tests PASS（本轮新增测试前基线）。
- `pnpm exec jest --runInBand --testPathPattern 'layered-(toolbar|canvas|presentation)'`：3 suites / 7 tests PASS。
- `pnpm --filter @hamster-note/painting typecheck`：exit 0（修正组件库 Icon API 后）。

## 任务证据

- 3.2：`layered-toolbar.test.tsx` 真实组件/控制器组合覆盖 shape dash → freehand → shape、独立宽度、四压力模式；自由笔仅一个 opacity slider，未传入 pressureMultiplier 或算法参数。
- 3.4：`layered-canvas.test.tsx` 追加 30 个样本时历史 render observer 计数不变、原历史节点身份稳定；DPR 2 backing store、重复可恢复重绘、viewport 更新、取消及延迟历史挂载。raw append buffer 仍由 controller/session 持有，Canvas 在 rAF 读取一次；PF 活动轮廓可能全笔重算/replay，不声称纯增量算法。
- 4.5：`layered-presentation.test.ts` 覆盖连续两笔后 ACK 乱序、旧 document revision、错误 geometry revision、重复/卸载 ACK、追加形状、撤销 pending 与下一笔 collecting。新 SVG 后缀在前缀尚未就绪时隐藏，避免旧 Canvas 笔盖过新 SVG 对象；交接同一 JS 任务更新 visibility 与 repaint，不 crossfade。

## 尚未证明

本文上述命令为早期 Node/jsdom 合约证据。后续 Chromium 像素/录帧已完成 4.6，见 `ham40-verification.md`；3.3、7.2、7.5、7.6、7.8 仍缺其各自要求的全量 UI、WebKit/设备或性能证据。
