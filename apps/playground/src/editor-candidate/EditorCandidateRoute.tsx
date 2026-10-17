import { StyleSheet, Text, View } from 'react-native';

/**
 * 候选编辑器的 native compat-static 路由。
 *
 * 本纵切只对 Web CanvasKit 路径验收；iOS/Android export 可以解析此模块，但没有挂载
 * Skia 编辑器，也没有任何原生交互验收。保持静态说明能防止把构建可用误报为功能可用。
 */
export default function EditorCandidateRoute() {
  return (
    <View testID="editor-candidate-root" style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.title}>候选编辑器 · compat-static</Text>
        <Text testID="editor-candidate-status" style={styles.notice}>
          此路由的首条纵切仅在 Web 端通过 CanvasKit 验收。当前 iOS/Android 仅提供兼容静态页，
          未挂载 Skia 画布，未进行原生输入、导航或历史记录验收。
        </Text>
        <Text style={styles.note}>请在 Web 端访问同一路由验证 Pen、导航与历史记录。</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
    backgroundColor: '#F4F5F7',
  },
  card: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    gap: 10,
    padding: 20,
    borderWidth: 1,
    borderColor: '#D9DEE7',
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
  },
  title: {
    color: '#172033',
    fontSize: 20,
    fontWeight: '700',
  },
  notice: {
    color: '#374151',
    fontSize: 14,
    lineHeight: 21,
  },
  note: {
    color: '#6B7280',
    fontSize: 12,
    lineHeight: 18,
  },
});
