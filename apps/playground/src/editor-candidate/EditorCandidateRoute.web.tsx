import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';
import type { SkiaDrawingCanvasProps } from '@hamster-note/painting/skia';
import type EditorCandidateSurfaceType from './EditorCandidateSurface.web';

/** Skia 失败 promise 被缓存时，通过整页刷新获得一次真正的新加载尝试。 */
const RETRY_KEY = 'editor-candidate:retry-skia';

function consumeRetryMarker(): boolean {
  try {
    const marked = window.sessionStorage.getItem(RETRY_KEY) !== null;
    if (marked) {
      window.sessionStorage.removeItem(RETRY_KEY);
    }
    return marked;
  } catch {
    return false;
  }
}

/** D1 路由分段诊断允许的隔离阶段。 */
type RouteDiagnosticStage = 'load-skia' | 'imports';

/**
 * 路由实际到达的阶段。它只描述已经真实发生的步骤，不做任何超时伪造：
 *  - `load-skia-start`：调用 LoadSkiaWeb 之前；
 *  - `load-skia-ready`：LoadSkiaWeb 成功 resolve；
 *  - `skia-import-ready`：`@hamster-note/painting/skia` 动态 import 成功；
 *  - `surface-import-ready`：`./EditorCandidateSurface.web` 动态 import 成功；
 *  - `error`：任一步骤抛错；原始错误与发生阶段一并暴露。
 */
type RoutePhase =
  'load-skia-start' | 'load-skia-ready' | 'skia-import-ready' | 'surface-import-ready' | 'error';

/** 诊断配置：仅当 query 同时含 `diagnostics=1` 与合法 `diagStage` 时才启用。 */
type RouteDiagnostics = Readonly<{ enabled: boolean; stage: RouteDiagnosticStage | null }>;

/**
 * 解析 D1 诊断 query。缺少 `diagnostics=1`、缺少 / 非法 `diagStage` 时一律返回未启用，
 * 从而让带 `diagnostics=1`（无 diagStage）的既有生命周期诊断继续走完整产品路径。
 */
function readRouteDiagnostics(): RouteDiagnostics {
  if (typeof window === 'undefined') {
    return { enabled: false, stage: null };
  }
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('diagnostics') !== '1') {
      return { enabled: false, stage: null };
    }
    const stage = params.get('diagStage');
    if (stage === 'load-skia' || stage === 'imports') {
      return { enabled: true, stage };
    }
    return { enabled: false, stage: null };
  } catch {
    return { enabled: false, stage: null };
  }
}

/**
 * Web 端仅在 CanvasKit 成功初始化后解析 painting 的 Skia renderer 与真实 surface。
 * 不提供 legacy 回退，避免失败时静默验证到另一套运行时。
 */
export default function EditorCandidateRoute() {
  type Loaded = {
    canvas: ComponentType<SkiaDrawingCanvasProps>;
    surface: typeof EditorCandidateSurfaceType;
  };

  // 诊断配置首帧读取一次即可：query 在会话期间不会变化。
  const [diagnostics] = useState(readRouteDiagnostics);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // error 同时携带失败发生阶段与原始错误消息，供诊断与默认错误态如实展示。
  const [error, setError] = useState<{ phase: RoutePhase; message: string } | null>(null);
  // 路由真实到达的阶段；默认从加载起点开始。
  const [phase, setPhase] = useState<RoutePhase>('load-skia-start');
  // 首次和带重试标记的刷新都直接进入本地 CanvasKit 加载，不闪现其它运行时。
  const [loading, setLoading] = useState(() => {
    // 消费标记使刷新后的首帧明确属于一次 retry；本路由始终自动加载 CanvasKit。
    consumeRetryMarker();
    return true;
  });

  useEffect(() => {
    if (!loading) {
      return;
    }
    let cancelled = false;
    void (async () => {
      // 记录当前阶段，使 catch 能如实报告错误发生在哪一步，而不是笼统报错。
      let currentPhase: RoutePhase = 'load-skia-start';
      try {
        await LoadSkiaWeb({ locateFile: (file: string) => `/${file}` });
        currentPhase = 'load-skia-ready';
        if (!cancelled) {
          setPhase(currentPhase);
        }
        // load-skia 阶段：只证明 CanvasKit 成功，不动态 import 包与 Surface。
        if (diagnostics.enabled && diagnostics.stage === 'load-skia') {
          return;
        }

        const skiaModule = await import('@hamster-note/painting/skia');
        currentPhase = 'skia-import-ready';
        if (!cancelled) {
          setPhase(currentPhase);
        }

        const surfaceModule = await import('./EditorCandidateSurface.web');
        currentPhase = 'surface-import-ready';
        if (!cancelled) {
          setPhase(currentPhase);
        }
        // imports 阶段：证明两个动态 import 可解析，但绝不挂载 Surface。
        if (diagnostics.enabled && diagnostics.stage === 'imports') {
          return;
        }

        if (!cancelled) {
          setLoaded({ canvas: skiaModule.SkiaDrawingCanvas, surface: surfaceModule.default });
        }
      } catch (caught) {
        if (!cancelled) {
          setError({
            phase: currentPhase,
            message: caught instanceof Error ? caught.message : String(caught),
          });
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
  }, [loading, diagnostics]);

  const retry = useCallback(() => {
    try {
      window.sessionStorage.setItem(RETRY_KEY, '1');
    } catch {
      // 存储被禁用时仍刷新；不会回退到 legacy runtime。
    }
    window.location.reload();
  }, []);

  // D1 分段诊断：仅在 ?diagnostics=1&diagStage=<value> 下渲染。
  // 它用命令式 DOM 属性暴露真实阶段，绝不挂载 Surface，也不走 legacy 回退。
  if (diagnostics.enabled) {
    const reportedPhase: RoutePhase = error ? 'error' : phase;
    return (
      <View testID="editor-candidate-root" style={styles.page}>
        <div
          data-testid="editor-candidate-route-diagnostics"
          data-route-phase={reportedPhase}
          data-diag-stage={diagnostics.stage ?? 'none'}
          {...(error ? { 'data-route-error-stage': error.phase } : {})}
          aria-hidden="true"
          style={{ display: 'none' }}
        />
        {loading ? (
          <>
            <ActivityIndicator size="large" color="#2563EB" />
            <Text testID="editor-candidate-route-loading" style={styles.note}>
              诊断阶段 {phase}：正在加载同源 CanvasKit…
            </Text>
          </>
        ) : null}
        {error ? (
          <View style={styles.card}>
            <Text testID="editor-candidate-route-error" style={styles.errorTitle}>
              诊断阶段 {error.phase} 失败：{error.message}
            </Text>
            <Text style={styles.note}>
              失败发生在阶段：{error.phase}。重试会写入本路由的一次性 sessionStorage
              标记后刷新页面；不会自动回退到 legacy 画布。
            </Text>
            <Pressable
              testID="editor-candidate-route-retry"
              accessibilityRole="button"
              accessibilityLabel="刷新页面重试 CanvasKit"
              onPress={retry}
              style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.retryText}>刷新页面重试</Text>
            </Pressable>
          </View>
        ) : null}
        {!loading && !error ? (
          <View style={styles.card}>
            <Text testID="editor-candidate-route-diagnostics-phase" style={styles.note}>
              诊断阶段：{phase}
            </Text>
            <Text testID="editor-candidate-route-diagnostics-stage" style={styles.note}>
              诊断范围：{diagnostics.stage}（未挂载 Surface）
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  if (loading) {
    return (
      <View testID="editor-candidate-root" style={styles.page}>
        <ActivityIndicator size="large" color="#2563EB" />
        <Text testID="editor-candidate-route-loading" style={styles.note}>
          正在加载同源 CanvasKit…
        </Text>
      </View>
    );
  }

  if (error || !loaded) {
    return (
      <View testID="editor-candidate-root" style={styles.page}>
        <View style={styles.card}>
          <Text testID="editor-candidate-route-error" style={styles.errorTitle}>
            CanvasKit 加载失败：{error?.message ?? '未知错误'}
          </Text>
          {error ? (
            <Text testID="editor-candidate-route-error-stage" style={styles.note}>
              错误发生在阶段：{error.phase}
            </Text>
          ) : null}
          <Text style={styles.note}>
            重试会写入本路由的一次性 sessionStorage 标记后刷新页面，以避开 Skia
            对失败加载的缓存；不会自动回退到 legacy 画布。
          </Text>
          <Pressable
            testID="editor-candidate-route-retry"
            accessibilityRole="button"
            accessibilityLabel="刷新页面重试 CanvasKit"
            onPress={retry}
            style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}
          >
            <Text style={styles.retryText}>刷新页面重试</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const { canvas: CanvasComponent, surface: Surface } = loaded;
  return <Surface canvasComponent={CanvasComponent} />;
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 20,
    backgroundColor: '#F4F5F7',
  },
  card: {
    width: '100%',
    maxWidth: 600,
    gap: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#D9DEE7',
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
  },
  errorTitle: {
    color: '#B42318',
    fontSize: 15,
    fontWeight: '700',
  },
  note: {
    color: '#667085',
    fontSize: 13,
    lineHeight: 19,
  },
  retryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#1D4ED8',
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  buttonPressed: {
    opacity: 0.82,
  },
});
