import { StyleSheet, Text, View } from 'react-native';

/**
 * Web/Android `/pencilkit-probe` 路由实现（基名模块，只读说明页）。
 *
 * Metro 在 iOS 上优先选择同目录 `PencilkitProbeRoute.ios.tsx`（导入原生
 * PaintingPencilkit 模块的 RN host 原型）；本基名文件被 tsc 直接解析，
 * 并被 Web/Android bundle 使用——不导入 @hamster-note/painting-pencilkit，
 * 不声称任何原生验证已完成（design D4：Web/Android 无原生模块导入）。
 */
export default function PencilkitProbeRoute() {
  return (
    <View testID="pencilkit-probe-non-ios-note" style={styles.container}>
      <Text style={styles.title}>PencilKit 探测（仅 iOS dev client）</Text>
      <Text style={styles.message}>
        此页是 HAM-66 tasks 2.1 的原生验证入口，必须在包含 PaintingPencilkit 原生模块的 iOS dev
        client 中通过深链接 painting-playground:///pencilkit-probe 打开。
      </Text>
      <Text style={styles.message}>
        当前平台只验证路由隔离：本页未加载任何 PencilKit 原生代码，Web/Android
        行为与既有路由一致、不受影响。
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
