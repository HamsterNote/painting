/**
 * PaintingPencilkitView —— native（iOS）TS view 接口（tasks 2.1）。
 *
 * 通过 Expo Modules 的 requireNativeViewManager 绑定 Swift 端
 * `PaintingPencilkitView`。本文件只会在 native bundle 中被引用：
 * playground 路由按平台拆分，Web/Android 入口不会导入本模块。
 */
import { requireNativeViewManager } from 'expo-modules-core';
import type * as React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

/** onReady 事件的 nativeEvent 载荷：证明原生侧配置已生效的可观察事实 */
export type PaintingPencilkitReadyEvent = Readonly<{
  moduleVersion: string;
  osVersion: string;
  deviceModel: string;
  drawingPolicy: 'pencilOnly' | 'anyInput';
  toolPickerAttached: boolean;
  scrollingEnabled: boolean;
}>;

export type PaintingPencilkitViewProps = Readonly<{
  /** true（默认）：仅 Apple Pencil 落墨；false：允许任意输入（诊断用） */
  pencilOnly?: boolean;
  /** 预览墨迹颜色（CSS 颜色字符串），默认系统蓝 */
  inkColor?: string;
  /** 预览墨迹宽度（pt），默认 4 */
  inkWidth?: number;
  /** 原生 view 上屏后回调一次，携带配置事实 */
  onReady?: (event: { nativeEvent: PaintingPencilkitReadyEvent }) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

const NativeView: React.ComponentType<PaintingPencilkitViewProps> =
  requireNativeViewManager<PaintingPencilkitViewProps>('PaintingPencilkit');

export function PaintingPencilkitView(props: PaintingPencilkitViewProps) {
  return <NativeView {...props} />;
}
