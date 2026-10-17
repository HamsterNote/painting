import EditorCandidateRoute from '../src/editor-candidate/EditorCandidateRoute';

/**
 * `/editor-candidate` 的平台无关薄入口。
 *
 * Expo Router 会解析 app 目录下所有路由，因此这里不引入 CanvasKit、Skia、DOM 或 CSS。
 * Web 实现在 `EditorCandidateRoute.web.tsx` 中延后加载；native 基名模块只提供
 * compat-static 说明页，不把尚未验收的原生能力伪装成编辑器。
 */
export default EditorCandidateRoute;
