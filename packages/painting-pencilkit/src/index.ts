/**
 * @hamster-note/painting-pencilkit —— HAM-66 tasks 2.1 的最小 PencilKit
 * Expo Module 出口。iOS 专用；Web 端由 ./PaintingPencilkitView.web 兜底为
 * 空渲染，Android 无原生实现（expo-module.config.json 只声明 ios），
 * 宿主路由必须按平台拆分、只在 iOS 导入本包。
 */
export { PaintingPencilkitView } from './PaintingPencilkitView';
export type {
  PaintingPencilkitReadyEvent,
  PaintingPencilkitViewProps,
} from './PaintingPencilkitView';
