import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';
import type { SkiaDrawingCanvasProps } from '@hamster-note/painting/skia';
import type SkiaFixtureSurfaceType from './SkiaFixtureSurface';

/**
 * Web `/skia-drawing-fixture` 路由实现。
 *
 * 严格时序（与任务约定一致）：
 *   1. `LoadSkiaWeb({ locateFile: (file) => \`/${file}\` })` 从本地静态资源
 *      （public/canvaskit.wasm）加载 CanvasKit，全程无 CDN 请求；
 *   2. 成功后才动态 `import('@hamster-note/painting/skia')` 取包级 SkiaDrawingCanvas；
 *   3. 再动态导入共享检验台 `./SkiaFixtureSurface`（其顶层静态导入 Skia）。
 * 加载中与失败均有可见反馈，失败提供用户可触发的重试入口。
 */
export default function SkiaDrawingFixtureRoute() {
  const [canvasComponent, setCanvasComponent] = useState<ComponentType<SkiaDrawingCanvasProps> | null>(null);
  const [Surface, setSurface] = useState<typeof SkiaFixtureSurfaceType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // attempt 仅作为重试触发器：变化时重新执行加载流程
    void attempt;
    let cancelled = false;

    setLoading(true);
    setError(null);
    setCanvasComponent(null);
    setSurface(null);

    let step = 'LoadSkiaWeb';
    (async () => {
      try {
        // 1) 先从本地静态资源加载 CanvasKit
        await LoadSkiaWeb({
          locateFile: (file: string) => `/${file}`,
        });
        step = 'import(painting/skia)';
        // 2) CanvasKit 就绪后动态导入包级 skia 子路径（不经根 barrel）。
        //    package build 已生成 ./skia 的 ESM/CJS/types 产物，故不保留绕过
        //    package export 的源码回退，以免 fixture 掩盖发布物缺失问题。
        const skiaModule = await import('@hamster-note/painting/skia');
        step = 'import(SkiaFixtureSurface)';
        // 3) 再动态导入共享检验台（顶层静态导入 Skia，必须在第 1 步之后）
        const surfaceModule = await import('./SkiaFixtureSurface');
        step = 'done';
        if (!cancelled) {
          setCanvasComponent(() => skiaModule.SkiaDrawingCanvas);
          setSurface(() => surfaceModule.default);
        }
      } catch (err) {
        if (!cancelled) {
          // 附带定位信息：标明失败发生在哪一步与错误堆栈首行
          const detail = `[${step}] ${err instanceof Error ? err.message : String(err)}`;
          setError(detail);
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

  // 加载成功：渲染共享检验台，并注入动态取得的 SkiaDrawingCanvas
  if (Surface && canvasComponent) {
    return <Surface canvasComponent={canvasComponent} />;
  }

  return (
    <View style={styles.container}>
      {loading ? (
        <>
          <ActivityIndicator size="large" color="#3B5BDB" />
          <Text testID="skia-fixture-loading" style={styles.message}>
            正在加载本地 CanvasKit…
          </Text>
        </>
      ) : null}

      {error ? (
        <>
          <Text testID="skia-fixture-error" style={styles.errorTitle}>
            CanvasKit 加载失败
          </Text>
          <Text style={styles.errorMessage}>{error}</Text>
          <Pressable
            testID="skia-fixture-retry"
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
