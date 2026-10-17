import NativeAdapterSmokeRoute from '../src/native-adapter/NativeAdapterSmokeRoute';

/**
 * `/native-adapter-smoke` 路由（平台无关薄入口）。
 *
 * 与 `/skia-smoke` 同理：Expo Router 会急切解析 `app/**` 下所有平台文件的
 * 顶层 import，因此这里不含任何顶层平台专用依赖；实际实现放到 `app/` 之外，
 * 交由 Metro 按平台选择：
 *   - native 基名：`src/native-adapter/NativeAdapterSmokeRoute.tsx`（可观测冒烟面板）
 *   - web 覆盖：`src/native-adapter/NativeAdapterSmokeRoute.web.tsx`（只读说明页）
 */
export default NativeAdapterSmokeRoute;
