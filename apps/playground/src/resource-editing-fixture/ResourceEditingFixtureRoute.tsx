import { StyleSheet, Text, View } from 'react-native';

/**
 * `/resource-editing-fixture` 的 native（iOS / Android）实现（基名模块）。
 *
 * 诚实说明页：本 fixture 的核心验收点是真实 TextInput/IME 组合输入与平台图片
 * 导入（文件/媒体选择器），这些必须在 iOS/Android 真机或模拟器上验证。
 * 当前原生端不挂载任何编辑画布，也不伪装功能已完成。
 */
export default function ResourceEditingFixtureRoute() {
  return (
    <View testID="resource-editing-fixture-root" style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.title}>资源/文本编辑 Fixture · 隔离验证入口</Text>
        <Text testID="resource-editing-fixture-native-notice" style={styles.notice}>
          此 fixture 用于验证 TextEditSession 与 resourceRegistry。文本的 IME 组合输入
          （含中文 composition）与图片导入的平台选择器需要在 iOS/Android 真机或模拟器上
          验证；当前原生端仅呈现本说明，不代表这些功能已在原生完成。
        </Text>
        <Text style={styles.note}>
          Web 端同路由提供基于真实 CanvasKit 的可交互验证（文本编辑会话、单会话撤销、
          图片资源注册与渲染回退）。
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    padding: 16,
    backgroundColor: '#F5F3EE',
    justifyContent: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E6E2D8',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#24252A',
  },
  notice: {
    fontSize: 13,
    color: '#3A3C41',
    lineHeight: 19,
  },
  note: {
    fontSize: 12,
    color: '#6B6F76',
    lineHeight: 17,
  },
});
