# @hamster-note/painting-board

基于 `@hamster-note/painting/layered` 的分层画板入口，提供工具栏、SVG 历史层、Canvas 活动笔、尺子、virtual paper 与 minimap。两个包采用 lockstep 版本。

## 使用

```tsx
import { useMemo } from 'react';
import { createEditor, PaintingBoard } from '@hamster-note/painting-board';

export function Board() {
  const controller = useMemo(() => createEditor(), []);
  return (
    <div style={{ height: 600 }}>
      <PaintingBoard controller={controller} />
    </div>
  );
}
```

父容器必须有确定高度。`toolbar={false}` 可隐藏工具栏；`virtualPaper={false}` 关闭画布漫游，或传入 `{ minScale: 0.5, maxScale: 4 }` 配置。导航意图只修改 controller 拥有的唯一 viewport，不依赖外部 virtual-paper 状态。

## BREAKING

`controller` 为必传属性，由 `createEditor()` 或底层控制器工厂创建。文档使用 schema 3，V1/V2、旧受控 props 与 ref handle 不再是公开 API。已有数据需由消费方显式转换，没有自动迁移或旧中心线 fallback。请以公开 TypeScript 类型审核旧选项，避免直接透传旧 props。

自由笔支持 `auto` / `real` / `simulated` / `constant`；模式在 begin 时锁定，真实释放零压力保留。初始 PF preset 为 0.5 thinning/smoothing/streamline、identity easing、圆帽与零 taper，constant 的 thinning 为 0；活动笔 last=false，最终笔 last=true。自由笔不提供 dash；形状 dash 独立保留。未新增 PNG/SVG 导出。

## 平台与验收

此组件使用 Web DOM。iOS/Android 应通过 Expo DOM/WebView 承载整个编辑器，不能直接挂到原生 View；三个 DrawingLayer 平台入口本期都委托 Web。可运行宿主示例见仓库 `apps/playground/src/layered-editor/LayeredEditorDom.tsx`，没有本期 native ink 或逐点 RN props bridge。

Safari/iOS WebView 混排、系统 IME/软键盘、实际 pen 压力/掌触、高刷新交接和目标设备长笔预算仍需人工验收。静态导出、合成输入及自动化 WebKit 不能代替这些证据。根 README 与 `docs/implementation/layered-perfect-freehand-surface/manual-acceptance.md` 记录完整边界。
