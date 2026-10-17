/**
 * legacy 多 demo 的 Playwright 路径常量。
 *
 * 根切换已完成：候选编辑器现挂在根 `/`，legacy 多 demo 固定从 `/legacy` 访问。
 * 全部 legacy spec 只通过本常量导航，不参与任何产品路由决策，也不提供回指
 * 根 `/` 的覆盖开关。
 */
export const LEGACY_PATH = '/legacy';
