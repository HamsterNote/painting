import { StyleSheet, Text, View } from 'react-native';
import { SkiaSmokeSurface } from '../skia/SkiaSmokeSurface';

/**
 * `/canvas-runtime` 的 native（iOS / Android）实现（基名模块）。
 *
 * native 端 Skia 直接可用（无 CanvasKit 加载、无 legacy DOM 依赖），
 * 因此静态导入并渲染单一 Skia smoke 画布，并清晰标注其为验证画布。
 * Web 端由同目录 `CanvasRuntimeRoute.web.tsx` 覆盖。
 */
export default function CanvasRuntimeRoute() {
  return (
    <View testID="canvas-runtime-root" style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Canvas Runtime · 隔离验证入口</Text>
        <Text style={styles.note}>
          这是隔离的运行时验证入口，与默认画布无关。当前为 native 静态 Skia smoke
          验证画布，尚非完整生产编辑画布；默认切换需等待功能/性能门禁。
        </Text>
        <Text testID="canvas-runtime-mode" style={styles.mode}>
          当前模式：native-skia-smoke
        </Text>
      </View>
      {/* 单一画布：native 只挂这一个 Skia smoke 画布 */}
      <View testID="canvas-runtime-skia-surface" style={styles.canvasWrap}>
        <SkiaSmokeSurface />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    padding: 16,
    gap: 12,
    backgroundColor: '#F5F3EE',
  },
  header: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    gap: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#24252A',
  },
  note: {
    fontSize: 12,
    color: '#6B6F76',
    lineHeight: 17,
  },
  mode: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3B5BDB',
  },
  canvasWrap: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
});
