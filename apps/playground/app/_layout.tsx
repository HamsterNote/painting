import { Stack } from 'expo-router';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

// react-native 0.86 在类型与运行时移除了 `StyleSheet.absoluteFillObject`
// （Web 端 react-native-web 仍提供）。冒烟画布 `src/skia`（designer 所有）
// 使用了它；这里在 app shell 做一次幂等补齐，保证三端行为一致。
// 类型补齐见 `types/react-native-compat.d.ts`。
if (!StyleSheet.absoluteFillObject) {
  (StyleSheet as { absoluteFillObject?: typeof StyleSheet.absoluteFill }).absoluteFillObject =
    StyleSheet.absoluteFill;
}

/**
 * 根布局：用 GestureHandlerRootView 包裹整个应用，
 * 保证三端手势（Gesture Handler）都有正确的根容器。
 */
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <Stack screenOptions={{ headerShown: false }} />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
