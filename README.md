# HamsterNote Painting

React 分层画板：历史对象按文档顺序进入 SVG，活动自由笔与待交接笔进入 Canvas，headless controller 统一管理文档、事务历史、工具和 viewport。

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

`@hamster-note/painting` 根入口也提供 `createEditor`、`PaintingBoard`、`DrawingSurface`；`/layered` 提供显式分层名称，`/core` 提供无 DOM 的 schema 3 控制器与几何 API。组件必须接收同一 controller，不能每次 render 创建新实例。完整可运行示例位于 `apps/playground/src/layered-editor/LayeredEditorDom.tsx`。

## BREAKING：文档与 API

新文档为 `schemaVersion: 3`，保存真实 raw samples、不可变笔刷快照及对象变换；PF outline 和呈现缓存不进入保存数据。`readLayeredDocument` / `serializeLayeredDocument` 返回带 `ok` 的结果，调用方应处理校验失败。V1/V2 文档与旧 `value/onChange`、`PaintingController`、ref handle API 已退役；没有旧中心线渲染保底或自动迁移承诺。消费方须显式转换已有数据并迁移到 controller API。旧 props 中未进入新公开类型的选项也应由消费方审核迁移。

## 自由笔

| 压力模式    | 行为                                                                         |
| ----------- | ---------------------------------------------------------------------------- |
| `auto`      | begin 时按输入来源和适配器能力锁定 real 或 simulated，不按压力是否大于零猜测 |
| `real`      | 使用设备实际压力，关闭 PF 模拟；保留 release 的零压力样本                    |
| `simulated` | 由 perfect-freehand 模拟压力                                                 |
| `constant`  | thinning 为 0，保持标称宽度                                                  |

初始 preset 为 thinning / smoothing / streamline 各 0.5、identity easing、圆帽、taper 0；活动笔 `last=false`，最终笔 `last=true`。笔刷设置在 begin 冻结。自由笔无 dash，形状虚线是独立设置。活动 PF 轮廓可能整笔重算与 Canvas replay；长笔性能仍需目标设备实测。

形状、文字、图片、选择/套索、变换、整对象擦除、undo/redo、尺子、virtual paper 和 minimap 共用同一文档与 viewport。没有增加 PNG/SVG 导出功能。

## 平台边界

Web 使用 SVG + Canvas。Web/iOS/Android 三个平台 DrawingLayer 入口第一期均委托 Web；Expo native 应用通过 Expo DOM/WebView 承载整个编辑器，参考 `apps/playground/src/layered-editor/LayeredEditorDom.tsx` 和 `apps/playground/src/App.tsx`。宿主项目需要 Expo DOM 配置，不能把含 DOM 的 board 直接当作原生 View 使用。本期没有 native ink，也没有逐点 RN props bridge；未来 native adapter 只定义了语义契约，mock ACK 不证明跨桥或 physical paint 同步。

Chromium 与独立 WebKit 自动化不等同 Safari/iOS 真机。系统 IME/软键盘、真笔四模式与掌触、高刷新率交接、iOS/Android 启动及长笔 CPU/内存/rAF 预算均待人工验收，详见 `docs/implementation/layered-perfect-freehand-surface/manual-acceptance.md`。

## 开发与验证

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm typecheck
pnpm lint
pnpm test:ui
pnpm test:webkit
pnpm build
pnpm pack:dry
pnpm verify:layered
```

开发端口为 5266，使用 Expo 支持的 `BROWSER=none` 禁止自动打开浏览器。WebKit 需要 Playwright 对应浏览器和受支持系统依赖。Android/iOS 的 `expo export` 只验证静态依赖解析，不是原生运行证据。
