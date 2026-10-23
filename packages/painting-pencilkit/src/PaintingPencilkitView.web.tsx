/**
 * Web 兜底：本模块是 iOS 专用 Expo Module（D4：Web/Android 入口不导入
 * 原生运行时）。正常路径下 playground 路由按平台拆分，Web 不会走到这里；
 * 此文件仅防御 Metro 在 Web bundle 中解析到模块出口时硬失败。
 */
import type { PaintingPencilkitViewProps, PencilkitStrokesLog } from './PaintingPencilkitView';

if (process.env.NODE_ENV !== 'production') {
  console.warn(
    '[painting-pencilkit] 仅支持 iOS；Web 端为空实现。' +
      '这通常意味着路由未按平台拆分，请检查导入方。'
  );
}

export function PaintingPencilkitView(_props: PaintingPencilkitViewProps) {
  return null;
}

export function isPencilkitDemoAvailable(): boolean {
  return false;
}

export function getStrokesLog(): Promise<PencilkitStrokesLog> {
  return Promise.reject(new Error('[painting-pencilkit] getStrokesLog 仅支持 iOS'));
}

export function clearStrokesLog(): Promise<void> {
  return Promise.reject(new Error('[painting-pencilkit] clearStrokesLog 仅支持 iOS'));
}
