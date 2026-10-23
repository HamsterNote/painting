/**
 * PaintingPencilkitView —— native（iOS）TS view 接口（tasks 2.1/2.2）。
 *
 * 通过 Expo Modules 绑定 Swift 端 PaintingPencilkitModule：
 *   - requireNativeViewManager 提供 PKCanvasView 封装 view；
 *   - requireNativeModule 提供 G1 诊断函数（getStrokesLog/clearStrokesLog）。
 * 本文件只会在 native bundle 中被引用：playground 路由按平台拆分，
 * Web/Android 入口不会导入本模块。
 */
import { requireOptionalNativeModule, requireNativeViewManager } from 'expo-modules-core';
import type * as React from 'react';
import type { NativeSyntheticEvent, StyleProp, ViewStyle } from 'react-native';

/** onReady 事件的 nativeEvent 载荷：证明原生侧配置已生效的可观察事实 */
export type PaintingPencilkitReadyEvent = Readonly<{
  moduleVersion: string;
  osVersion: string;
  deviceModel: string;
  drawingPolicy: 'pencilOnly' | 'anyInput';
  toolPickerAttached: boolean;
  scrollingEnabled: boolean;
}>;

/** G1 单一样本（字段与 Swift 端 PencilkitG1Sampler 一致；t/tabs 为毫秒） */
export type PencilkitSample = Readonly<{
  seq: number;
  kind: 'main' | 'coalesced';
  phase: 'down' | 'move' | 'up' | 'cancel';
  /** 相对本笔首个样本的毫秒 */
  t: number;
  /** UIKit monotonic 绝对毫秒 */
  tabs: number;
  x: number;
  y: number;
  /** UITouch.force 原值 */
  f: number;
  /** UITouch.maximumPossibleForce 原值 */
  mf: number;
  /** f/mf；capability 缺失时为 null，不 clamp */
  p: number | null;
  /** estimatedProperties rawValue */
  est: number;
  /** estimatedPropertiesExpectingUpdates rawValue */
  estUpd: number;
  fBeforePencilkit?: number;
  mfBeforePencilkit?: number;
}>;

/** G1 单笔摘要（onStroke 事件与导出日志共用） */
export type PencilkitStrokeSummary = Readonly<{
  id: number;
  touchType: 'pencil';
  durationMs: number;
  bounds: Readonly<{ w: number; h: number }>;
  counts: Readonly<{
    down: number;
    up: number;
    main: number;
    coalesced: number;
    total: number;
  }>;
  pressure: Readonly<{ capability: boolean | null; min?: number; max?: number }>;
  estimated: Readonly<{
    flagsUnion: number;
    expectingUnion: number;
    lateEstimateEvents: number;
  }>;
  overflow: boolean;
  cancelled: boolean;
  samples: readonly PencilkitSample[];
}>;

/** getStrokesLog 的返回结构 */
export type PencilkitStrokesLog = Readonly<{
  moduleVersion: string;
  gate: 'G1';
  osVersion: string;
  deviceModel: string;
  capturedAtUptimeMs: number;
  ignoredNonPencilTouches: number;
  rules: readonly string[];
  strokeCount: number;
  strokes: readonly PencilkitStrokeSummary[];
}>;

export type PaintingPencilkitViewProps = Readonly<{
  children?: React.ReactNode;
  demoHost?: boolean;
  onDemoStatus?: (
    event: NativeSyntheticEvent<{
      contextKey: string;
      enabled: boolean;
      width: number;
      height: number;
      lastHit: string;
      routing: 'gesture-ancestor' | 'unattached';
      toolBegins: number;
    }>
  ) => void;
  /** Serialized, bounded G2/G3 experimental control state. Omit for the G1 Probe. */
  demoState?: string;
  onBegin?: (
    event: NativeSyntheticEvent<{ id: number; contextKey: string; sample: PencilkitSample }>
  ) => void;
  onPreviewRetired?: (event: NativeSyntheticEvent<{ id: number; contextKey: string }>) => void;
  /** true（默认）：仅 Apple Pencil 落墨；false：允许任意输入（诊断用） */
  pencilOnly?: boolean;
  /** 预览墨迹颜色（CSS 颜色字符串），默认系统蓝 */
  inkColor?: string;
  /** 预览墨迹宽度（pt），默认 4 */
  inkWidth?: number;
  inkOpacity?: number;
  /** 原生 view 上屏后回调一次，携带配置事实 */
  onReady?: (event: { nativeEvent: PaintingPencilkitReadyEvent }) => void;
  /** 每笔完成的 RN 事件；在回调内提取 nativeEvent，勿在延迟 updater 中读取事件。 */
  onStroke?: (event: NativeSyntheticEvent<PencilkitStrokeSummary>) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

const NativeModule = requireOptionalNativeModule('PaintingPencilkit');

const NativeView: React.ComponentType<PaintingPencilkitViewProps> | undefined = NativeModule
  ? requireNativeViewManager<PaintingPencilkitViewProps>('PaintingPencilkit')
  : undefined;

export function isPencilkitDemoAvailable(): boolean {
  return NativeModule?.demoBridgeVersion === 3;
}

export function PaintingPencilkitView(props: PaintingPencilkitViewProps) {
  return NativeView ? <NativeView {...props} /> : null;
}

/** 导出 G1 采样日志（保留最近 20 笔，含样本与采样规则说明） */
export function getStrokesLog(): Promise<PencilkitStrokesLog> {
  if (!NativeModule) return Promise.reject(new Error('PaintingPencilkit module missing'));
  return NativeModule.getStrokesLog() as Promise<PencilkitStrokesLog>;
}

/** 清空采样器缓冲（活动笔与已保留完成笔） */
export function clearStrokesLog(): Promise<void> {
  if (!NativeModule) return Promise.reject(new Error('PaintingPencilkit module missing'));
  return NativeModule.clearStrokesLog() as Promise<void>;
}
