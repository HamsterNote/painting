/**
 * CSS side-effect import 的类型声明。
 *
 * Web 端路由会使用 `import '@hamster-note/components/styles.css';` 这类
 * 仅产生副作用的样式导入。tsc 本身不认识 `.css` 模块，这里用通配声明让
 * 这类导入通过类型检查（运行时解析交由 Metro 处理）。
 */
declare module '*.css';
