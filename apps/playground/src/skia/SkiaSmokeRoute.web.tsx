import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';

/** 动态导入后拿到的 smoke surface 组件类型 */
type SurfaceComponent = ComponentType;

/**
 * Web `/skia-smoke` 路由实现。
 *
 * Web 端 Skia 依赖 CanvasKit：必须先调用 `LoadSkiaWeb({ locateFile })`
 * 从本地静态资源（`public/canvaskit.wasm`）加载 CanvasKit，**之后**才能
 * 动态导入 `./SkiaSmokeSurface`（该模块在顶层静态导入 Skia）。
 *
 * 这样既满足「不在 app 目录静态 import Skia」，也保证加载前不触碰 Skia 运行时。
 * 加载中与失败均有可见反馈，失败时提供用户可触发的重试入口。
 */
export default function SkiaSmokeRoute() {
  const [Surface, setSurface] = useState<SurfaceComponent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // attempt 仅作为重试触发器：变化时重新执行加载流程
    void attempt;
    let cancelled = false;

    setLoading(true);
    setError(null);
    setSurface(null);

    (async () => {
      try {
        // 1) 先加载本地 CanvasKit（相对站点根路径 /canvaskit.wasm）
        await LoadSkiaWeb({
          locateFile: (file: string) => `/${file}`,
        });
        // 2) CanvasKit 就绪后再动态导入 smoke surface
        const mod = await import('./SkiaSmokeSurface');
        if (!cancelled) {
          setSurface(() => mod.SkiaSmokeSurface);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  // 加载成功：渲染真正的 Skia 冒烟画布
  if (Surface) {
    return <Surface />;
  }

  return (
    <View style={styles.container}>
      {loading ? (
        <>
          <ActivityIndicator size="large" color="#3B5BDB" />
          <Text testID="skia-smoke-loading" style={styles.message}>
            正在加载本地 CanvasKit…
          </Text>
        </>
      ) : null}

      {error ? (
        <>
          <Text testID="skia-smoke-error" style={styles.errorTitle}>
            CanvasKit 加载失败
          </Text>
          <Text style={styles.errorMessage}>{error}</Text>
          <Pressable
            testID="skia-smoke-retry"
            onPress={retry}
            accessibilityRole="button"
            accessibilityLabel="重试加载 CanvasKit"
            style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
          >
            <Text style={styles.retryText}>重试</Text>
          </Pressable>
        </>
      ) : null}
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
  message: {
    fontSize: 14,
    color: '#3A3C41',
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#C0392B',
  },
  errorMessage: {
    fontSize: 13,
    color: '#6B6F76',
    textAlign: 'center',
    maxWidth: 480,
  },
  retryButton: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D8D4C8',
    backgroundColor: '#FFFFFF',
  },
  retryButtonPressed: {
    backgroundColor: '#F1F0EB',
  },
  retryText: {
    fontSize: 14,
    color: '#3A3C41',
  },
});
