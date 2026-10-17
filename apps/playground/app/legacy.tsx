import LegacyPlaygroundRoute from '../src/LegacyPlaygroundRoute';

/**
 * `/legacy` 路由（legacy 多 demo 薄入口）。
 *
 * 根切换已完成：`/` 现由候选编辑器承载（见 `app/index.tsx`），legacy 多 demo
 * 继续经 `/legacy` 访问，供既有 legacy spec 直接验证。
 *
 * 与 `app/index.tsx` 保持一致：这里只保留平台无关的薄路由，
 * 仅 re-export `src/LegacyPlaygroundRoute`，实际平台实现交由 Metro 选择：
 *   - native 基名：`src/LegacyPlaygroundRoute.tsx`（Skia 冒烟画布）
 *   - web 覆盖：`src/LegacyPlaygroundRoute.web.tsx`（载入 legacy DOM Demo）
 *
 * 约束：本文件不得引入任何 DOM/CSS/CanvasKit 顶层依赖，否则会污染
 * Android/iOS 的模块图。
 */
export default LegacyPlaygroundRoute;
