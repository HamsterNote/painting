import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';
import type { SkiaDrawingCanvasProps } from '@hamster-note/painting/skia';
import type ResourceEditingSurfaceType from './ResourceEditingSurface';

/**
 * `/resource-editing-fixture` 的 Web 实现。
 *
 * 严格时序（与任务约定一致）：
 *   1. `LoadSkiaWeb({ locateFile: (file) => \`/${file}\` })` 从本地 public WASM 加载；
 *   2. 成功后动态 `import('@hamster-note/painting/skia')` 取包级 SkiaDrawingCanvas；
 *   3. 再动态导入 `./ResourceEditingSurface`（其顶层静态导入 Skia 与 DOM textarea 覆盖层，
 *      仅在本 web 链路出现）。
 *
 * 重试可靠性：Skia 2.6.2 会缓存 LoadSkiaWeb 的 rejected promise，仅重置 state 重调
 * 不会真正重试。因此「重试」先写入本路由私有的一次性 sessionStorage 标记再整页刷新；
 * 刷新后首次渲染同步消费标记并直接进入 loading（不闪现任何中间态），仍失败则回到
 * error 态且可再次重试。
 */
const RETRY_KEY = 'resource-editing-fixture:retry-skia';

/** 同步读取并消费一次性重试标记；SSR/存储异常一律安全回落，不让路由崩溃 */
function consumeRetryMarker(): boolean {
  try {
    if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') {
      return false;
    }
    const marked = window.sessionStorage.getItem(RETRY_KEY) !== null;
    if (marked) {
      window.sessionStorage.removeItem(RETRY_KEY);
    }
    return marked;
  } catch {
    return false;
  }
}

export default function ResourceEditingFixtureRoute() {
  type Loaded = { canvas: ComponentType<SkiaDrawingCanvasProps>; surface: typeof ResourceEditingSurfaceType };
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 惰性初始化在任何渲染前同步执行：有重试标记时首帧即 loading
  const [loading, setLoading] = useState(() => consumeRetryMarker());

  useEffect(() => {
    if (!loading) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await LoadSkiaWeb({ locateFile: (file: string) => `/${file}` });
        const skiaModule = await import('@hamster-note/painting/skia');
        const surfaceModule = await import('./ResourceEditingSurface');
        if (!cancelled) {
          setLoaded({ canvas: skiaModule.SkiaDrawingCanvas, surface: surfaceModule.default });
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
  }, [loading]);

  const retry = useCallback(() => {
    try {
      window.sessionStorage.setItem(RETRY_KEY, '1');
    } catch {
      // 存储不可用时仍刷新；刷新后无标记则回到初始说明态，行为安全
    }
    window.location.reload();
  }, []);

  // 首屏：无重试标记时显示一个明确的就绪入口（不在未确认时自动加载 CanvasKit）
  if (!loading && !loaded && !error) {
    return (
      <View testID="resource-editing-fixture-root" style={styles.centerPage}>
        <View style={styles.card}>
          <Text style={styles.title}>资源/文本编辑 Fixture · 隔离验证入口</Text>
          <Text style={styles.note}>
            这是隔离的运行时验证入口，与默认画布无关。点击下方按钮后才会从本地资源加载
            CanvasKit 并进入验证界面。
          </Text>
          <Pressable
            testID="resource-editing-fixture-enter"
            onPress={() => setLoading(true)}
            accessibilityRole="button"
            accessibilityLabel="进入验证"
            style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
          >
            <Text style={styles.primaryButtonText}>进入验证（加载本地 CanvasKit）</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View testID="resource-editing-fixture-root" style={styles.centerPage}>
        <ActivityIndicator size="large" color="#3B5BDB" />
        <Text testID="resource-editing-fixture-loading" style={styles.note}>
          正在加载本地 CanvasKit…
        </Text>
      </View>
    );
  }

  if (error || !loaded) {
    return (
      <View testID="resource-editing-fixture-root" style={styles.centerPage}>
        <View style={styles.card}>
          <Text testID="resource-editing-fixture-error" style={styles.errorTitle}>
            CanvasKit 加载失败：{error ?? '未知错误'}
          </Text>
          <Text style={styles.note}>
            Skia 2.6.2 会缓存失败的加载结果；重试将整页刷新并直接进入加载流程，刷新后若仍失败可再次重试。
          </Text>
          <Pressable
            testID="resource-editing-fixture-retry"
            onPress={retry}
            accessibilityRole="button"
            accessibilityLabel="刷新页面重试"
            style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
          >
            <Text style={styles.primaryButtonText}>刷新页面重试</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const { canvas: CanvasComponent, surface: Surface } = loaded;
  return <Surface canvasComponent={CanvasComponent} />;
}

const styles = StyleSheet.create({
  centerPage: {
    flex: 1,
    padding: 16,
    gap: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F3EE',
  },
  card: {
    width: '100%',
    maxWidth: 640,
    backgroundColor: '#FFFFFF',
    borderColor: '#E6E2D8',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 10,
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
  errorTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#C0392B',
  },
  primaryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: '#3B5BDB',
  },
  primaryButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  buttonPressed: {
    opacity: 0.85,
  },
});
