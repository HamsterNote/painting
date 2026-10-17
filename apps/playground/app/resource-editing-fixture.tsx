import ResourceEditingFixtureRoute from '../src/resource-editing-fixture/ResourceEditingFixtureRoute';

/**
 * `/resource-editing-fixture` 路由（平台无关薄入口，隔离验证入口，非默认路由）。
 *
 * Expo Router 会急切解析 `app/**` 下所有平台文件的顶层 import，因此本文件不含
 * 任何顶层平台专用依赖（无 Skia/CanvasKit/DOM/CSS）；实际实现放到 `app/` 之外：
 *   - native 基名：`src/resource-editing-fixture/ResourceEditingFixtureRoute.tsx`（诚实说明页）
 *   - web 覆盖：`src/resource-editing-fixture/ResourceEditingFixtureRoute.web.tsx`
 */
export default ResourceEditingFixtureRoute;
