import { SkiaDrawingCanvas } from '@hamster-note/painting/skia';
import SkiaFixtureSurface from './SkiaFixtureSurface';

/**
 * native（iOS / Android）`/skia-drawing-fixture` 路由实现（基名模块）。
 *
 * native 端 Skia 无需 CanvasKit 加载，直接静态导入包级子路径
 * `@hamster-note/painting/skia`（不经根 barrel），并把组件注入共享检验台。
 * Metro 在 web 端会优先选择同目录下的 `SkiaDrawingFixtureRoute.web.tsx`。
 */
export default function SkiaDrawingFixtureRoute() {
  return <SkiaFixtureSurface canvasComponent={SkiaDrawingCanvas} />;
}
