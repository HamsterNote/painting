import type { NativeSyntheticEvent, StyleProp, ViewStyle } from 'react-native';

export type AndroidInkProbeReady = Readonly<{
  probeVersion: number;
  inkVersion: string;
  sdkInt: number;
  density: number;
  widthPx: number;
  heightPx: number;
}>;

export type PaintingAndroidInkViewProps = Readonly<{
  retireId?: number;
  onReady?: (event: NativeSyntheticEvent<AndroidInkProbeReady>) => void;
  onStrokeFinished?: (event: NativeSyntheticEvent<{ id: number }>) => void;
  onRetired?: (event: NativeSyntheticEvent<{ id: number }>) => void;
  onCancelled?: (event: NativeSyntheticEvent<{ id: number; reason: string }>) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;
