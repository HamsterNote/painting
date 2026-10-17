import CanvasRuntimeRoute from '../src/canvas-runtime/CanvasRuntimeRoute';

/**
 * `/canvas-runtime` 路由（平台无关薄入口，隔离验证入口，非默认路由）。
 *
 * Expo Router 会急切解析 `app/**` 下所有平台文件的顶层 import，因此本文件
 * 不含任何顶层平台专用依赖（无 Skia/CanvasKit/DOM/CSS）；实际实现放到
 * `app/` 之外，交由 Metro 按平台选择：
 *   - native 基名：`src/canvas-runtime/CanvasRuntimeRoute.tsx`（Skia 静态 smoke）
 *   - web 覆盖：`src/canvas-runtime/CanvasRuntimeRoute.web.tsx`（legacy 默认 + 显式 Skia 切换）
 */
export default CanvasRuntimeRoute;
