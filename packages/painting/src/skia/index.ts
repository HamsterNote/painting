export { SkiaDrawingCanvas } from './SkiaDrawingCanvas';
export {
  describeScreenOverlays,
  describeSkiaDocument,
  describeSkiaStroke,
  type ScreenOverlayDescriptor,
  type SkiaStrokeDescriptor,
} from './descriptors';
// Web shaped-run provider：模块自身不顶层 import CanvasKit，仅 type import core，
// 因此可安全地经 skia 子路径导出，不会把 CanvasKit 带进 native bundle。
export {
  WebShapedRunProvider,
  canUseParagraphWindow,
  type WebShapingContinuation,
  type WebShapingParagraphFactory,
  type WebShapingResult,
} from './shapedRunProvider.web';
export type {
  SkiaDrawingCanvasProps,
  SkiaDrawingResources,
  SkiaOverlay,
  SkiaOverlayStyle,
  SkiaPoint,
  SkiaStrokeStyle,
} from './types';
