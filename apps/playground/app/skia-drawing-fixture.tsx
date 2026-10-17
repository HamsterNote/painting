import SkiaDrawingFixtureRoute from '../src/skia-fixture/SkiaDrawingFixtureRoute';

/**
 * `/skia-drawing-fixture` 路由（平台无关薄入口，独立非默认路由）。
 *
 * 与既有路由同理：Expo Router 会急切解析 `app/**` 下所有平台文件的顶层
 * import，因此这里不含任何顶层 Skia/平台专用依赖；实际实现放到 `app/` 之外，
 * 交由 Metro 按平台选择：
 *   - native 基名：`src/skia-fixture/SkiaDrawingFixtureRoute.tsx`
 *   - web 覆盖：`src/skia-fixture/SkiaDrawingFixtureRoute.web.tsx`
 */
export default SkiaDrawingFixtureRoute;
