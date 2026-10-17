import { SkiaSmokeSurface } from './skia';

/**
 * native（iOS / Android）`/` 路由实现（基名模块）。
 *
 * 使用不带平台后缀的基名，让 TypeScript（tsc）能直接解析，
 * 同时 Metro 在 web 端会优先选择同目录下的 `LegacyPlaygroundRoute.web.tsx`。
 *
 * native 端保持原有行为：直接渲染 Skia 冒烟画布，不加载 CanvasKit，
 * 因此无需动态导入或 loading 状态。
 */
export default function LegacyPlaygroundRoute() {
  return <SkiaSmokeSurface />;
}
