// V2 core 纯入口：只依赖同目录纯状态模块，以及已批准的纯 model/viewport 模块，
// 不能反向导入包根入口、组件、hooks、render、utils 或任何平台依赖。
export * from './document';
export * from './transient';
export * from './geometry';
export * from './input';
export * from './gesture/ownership';
export * from './gesture/session';
export * from './viewportTransform';
export * from './preparedDocument';
export * from './spatialIndex';
export * from './frameClipping';
export * from './frameBudget';
export * from './polygonBoolean';
export * from './drawingFrame';
export * from './resourceRegistry';
export * from './textEditSession';
export * from './selectionTransform';
export * from './selectionFrame';
export * from './selectionOverlay';
// 与 selectionTransform 的同名 legacy target 类型保持隔离；候选 UI 通过下列 frame-only API
// 获得 index/id/tool 稳定目标，不能绕回 document geometry。
export {
  queryDrawingFrameEraserTargets,
  queryDrawingFrameLassoTargets,
  type DrawingFrameQueryCoordinateSpace,
  type DrawingFrameRenderableQueryInput,
  type DrawingFrameTarget,
  type DrawingFrameTargetQuery,
  type DrawingFrameTargetQueryOptions,
  type EraserTargetQueryOptions,
  type SelectionQueryDiagnostic,
} from './selectionQuery';
export * from './editorDocument';
export * from './editorRuntime';
export * from './editorInteraction';
export * from './editorToolSession';
export * from './editorController';

// 重导出 V2 文档模型（类型与 schema 版本），使 @hamster-note/painting/core 成为 canonical API。
export * from '../model/strokes';

// 直接重导出既有纯 viewport 数学与类型，不复制实现、不移动模块。
export * from '../viewport';
