// Web 端全局样式（Popover / Button / Icon 等）
import '@hamster-note/components/styles.css';
import LegacyApp from './App';

/**
 * Web `/legacy` 路由实现。
 *
 * 该文件带 `.web.tsx` 后缀，Metro 在 Web 平台优先解析它，因此只有 Web
 * 才会载入 `src/App.tsx` 这个 legacy DOM Demo，以及其顶层的 CSS 副作用导入；
 * native 端则由同目录基名 `LegacyPlaygroundRoute.tsx` 覆盖，不会把这些
 * legacy DOM/CSS 模块带进 Android/iOS 的模块图。
 */
export default function LegacyPlaygroundRoute() {
  return <LegacyApp />;
}
