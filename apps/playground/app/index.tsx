import EditorCandidateRoute from '../src/editor-candidate/EditorCandidateRoute';

/**
 * `/` 路由（平台无关薄入口，已切为候选编辑器）。
 *
 * Expo Router 的 sync `require.context` 会急切解析 `app/` 内的所有平台文件
 * 顶层 import，若把 Web 专用的 CanvasKit / DOM 实现直接放在 `app/index.web.tsx`，
 * 其顶层导入也会进入 Android/iOS 的模块图。因此这里只保留一个平台无关的
 * 薄路由，实际平台实现放到 `app/` 之外，交由 Metro 按平台选择：
 *   - native 基名：`src/editor-candidate/EditorCandidateRoute.tsx`（compat-static 说明页）
 *   - web 覆盖：`src/editor-candidate/EditorCandidateRoute.web.tsx`（延后加载 CanvasKit）
 *
 * legacy 多 demo 现挂在 `/legacy`（见 `app/legacy.tsx`），`/editor-candidate`
 * 仅作为不动作的诊断/兼容别名保留（见 `app/editor-candidate.tsx`）。
 */
export default EditorCandidateRoute;
