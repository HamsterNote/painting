/**
 * @hamster-note/painting-pencilkit —— HAM-66 tasks 2.1/2.2 的 PencilKit
 * Expo Module 出口：PKCanvasView 封装 view（onReady/onStroke 事件）与 G1
 * 采样诊断函数。iOS 专用；Web 端由 ./PaintingPencilkitView.web 兜底为空
 * 实现，Android 无原生实现（expo-module.config.json 只声明 ios），宿主
 * 路由必须按平台拆分、只在 iOS 导入本包。
 */
export {
  PaintingPencilkitView,
  clearStrokesLog,
  getStrokesLog,
  isPencilkitDemoAvailable,
} from './PaintingPencilkitView';
export type {
  PaintingPencilkitReadyEvent,
  PaintingPencilkitViewProps,
  PencilkitSample,
  PencilkitStrokeSummary,
  PencilkitStrokesLog,
} from './PaintingPencilkitView';
