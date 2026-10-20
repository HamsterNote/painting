/**
 * Web 兜底：本模块是 iOS 专用 Expo Module（D4：Web/Android 入口不导入
 * 原生运行时）。正常路径下 playground 路由按平台拆分，Web 不会走到这里；
 * 此文件仅防御 Metro 在 Web bundle 中解析到模块出口时硬失败。
 */
import type { PaintingPencilkitViewProps } from './PaintingPencilkitView';

export function PaintingPencilkitView(_props: PaintingPencilkitViewProps) {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      '[painting-pencilkit] PaintingPencilkitView 仅支持 iOS；Web 端渲染为空。' +
        '这通常意味着路由未按平台拆分，请检查导入方。'
    );
  }
  return null;
}
