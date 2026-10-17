import SkiaSmokeRoute from '../src/skia/SkiaSmokeRoute';

/**
 * `/skia-smoke` 路由（不带平台后缀的薄入口）。
 *
 * Expo Router 只认 `app/**` 下的文件，而 web 端需要顶层静态导入 CanvasKit
 * （`@shopify/react-native-skia/lib/module/web`），这会让 Android/iOS 打包时
 * Metro 把它一起解析而失败。因此这里只保留一个平台无关的薄路由，实际的
 * 平台实现放在 `src/skia/SkiaSmokeRoute.tsx`（native 基名）与
 * `src/skia/SkiaSmokeRoute.web.tsx`（web 覆盖），交由 Metro 在 `app/` 之外按平台选择。
 */
export default SkiaSmokeRoute;
