import { SkiaSmokeSurface } from './SkiaSmokeSurface';

/**
 * native（iOS / Android）`/skia-smoke` 路由实现（基名模块）。
 *
 * 使用不带平台后缀的基名，让 TypeScript（tsc）能直接解析，
 * 同时 Metro 在 web 端会优先选择同目录下的 `SkiaSmokeRoute.web.tsx`。
 *
 * native 端不需要加载 CanvasKit，`SkiaSmokeSurface` 可直接静态渲染，
 * 因此无需动态导入或 loading 状态。
 */
export default function SkiaSmokeRoute() {
  return <SkiaSmokeSurface />;
}
