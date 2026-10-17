import { StyleSheet, Text, View } from 'react-native';

/**
 * Web `/native-adapter-smoke` 路由实现（只读说明页）。
 *
 * 该检查面向 react-native-gesture-handler 的原生触摸回调链路
 * （createNativeInputAdapter + 纯 GestureSession），必须在 iOS / Android
 * 模拟器或真机上运行验收。Web 端本页仅验证路由隔离：
 *   - 不导入 RNGH native adapter、不导入 CanvasKit；
 *   - 不代表、也不声称原生验证已完成。
 */
export default function NativeAdapterSmokeRoute() {
  return (
    <View testID="native-adapter-smoke-web-note" style={styles.container}>
      <Text style={styles.title}>Native Adapter 冒烟（仅 iOS / Android）</Text>
      <Text style={styles.message}>
        此检查需在 iOS / Android 模拟器或真机上运行，用于验收 RNGH 触摸回调驱动
        createNativeInputAdapter 与纯 GestureSession 的链路。
      </Text>
      <Text style={styles.message}>
        Web 端这里只验证路由隔离：本页面不加载原生 adapter 或 CanvasKit，原生验证未在此完成。
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
    backgroundColor: '#FFFFFF',
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#24252A',
  },
  message: {
    fontSize: 13,
    color: '#6B6F76',
    lineHeight: 19,
    textAlign: 'center',
    maxWidth: 480,
  },
});
