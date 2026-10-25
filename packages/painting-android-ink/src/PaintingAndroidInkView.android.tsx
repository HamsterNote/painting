import { requireOptionalNativeModule, requireNativeViewManager } from 'expo-modules-core';
import type { ComponentType } from 'react';
import type { PaintingAndroidInkViewProps } from './types';

const nativeModule = requireOptionalNativeModule('PaintingAndroidInk');
const NativeView: ComponentType<PaintingAndroidInkViewProps> | undefined =
  nativeModule?.probeVersion === 1
    ? requireNativeViewManager<PaintingAndroidInkViewProps>('PaintingAndroidInk')
    : undefined;

export function isAndroidInkProbeAvailable(): boolean {
  return NativeView !== undefined;
}

export function PaintingAndroidInkView(props: PaintingAndroidInkViewProps) {
  return NativeView ? <NativeView {...props} /> : null;
}
