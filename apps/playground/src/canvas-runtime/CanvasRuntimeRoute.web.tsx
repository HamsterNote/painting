// Web 端全局样式（legacy DrawingSurface 依赖的组件样式；仅本 web 文件导入）
import '@hamster-note/components/styles.css';
import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';
import { DrawingSurface } from '@hamster-note/painting';

/**
 * `/canvas-runtime` 的 Web 实现（隔离运行时验证入口，非默认路由）。
 *
 * 画布互斥（由 React 条件渲染结构保证，任一时刻至多一个画布挂载）：
 *   - 默认 mode = legacy：只挂一个最小真实 legacy `DrawingSurface`；
 *   - 用户显式点击「切换到 Skia」→ mode=loading，legacy 立即卸载，
 *     然后从本地 public WASM 加载 CanvasKit，成功后动态 import Skia smoke 画布；
 *   - Skia smoke 是验证画布（拖动圆点/笔迹），不是完整生产编辑画布；
 *   - 失败进入 error（不拖垮路由）：「重试」必须整页 reload（Skia 2.6.2 的
 *     LoadSkiaWeb 失败 promise 会被缓存，重新调用不会重试）；
 *   - 「返回 legacy 画布」只出现在 skia/error 态，由用户触发，绝不自动回退；
 *   - 默认切换 Skia 属后续功能/性能门禁事项，本入口不声明 7.4 / production ready。
 */
type RuntimeMode = 'legacy' | 'loading' | 'skia' | 'error';

const MODE_LABEL: Record<RuntimeMode, string> = {
  legacy: 'legacy（暂时可见回退）',
  loading: '正在加载 CanvasKit…',
  skia: 'skia（smoke 验证画布）',
  error: 'skia 加载失败',
};

/**
 * 本隔离入口私有的一次性重试标记（sessionStorage）。
 * 用户在 error 态点「重试」时先写入它再整页刷新；下次挂载时同步消费（读取即清除），
 * 使刷新后的初始模式直接是 loading 并重新加载 CanvasKit——而不是回默认 legacy。
 */
const RETRY_SKIA_KEY = 'canvas-runtime:retry-skia';

/** 同步读取并消费重试标记；SSR/存储异常一律安全回落到 legacy，不让路由崩溃 */
function consumeRetryMarker(): boolean {
  try {
    if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') {
      return false;
    }
    const marked = window.sessionStorage.getItem(RETRY_SKIA_KEY) !== null;
    if (marked) {
      window.sessionStorage.removeItem(RETRY_SKIA_KEY);
    }
    return marked;
  } catch {
    return false;
  }
}

/** 防御性清除重试标记（写入/清除失败都静默忽略） */
function clearRetryMarker(): void {
  try {
    if (typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined') {
      window.sessionStorage.removeItem(RETRY_SKIA_KEY);
    }
  } catch {
    // 存储不可用时无需处理
  }
}

export default function CanvasRuntimeRoute() {
  // 惰性初始化在任何渲染前同步执行：若存在重试标记，初始模式直接为 loading，
  // legacy DrawingSurface 从第一帧起就不会挂载（不存在短暂闪现）。
  const [mode, setMode] = useState<RuntimeMode>(() => (consumeRetryMarker() ? 'loading' : 'legacy'));
  const [error, setError] = useState<string | null>(null);
  const [SkiaSurface, setSkiaSurface] = useState<ComponentType | null>(null);

  // 切到 Skia：先把 mode 置为 loading（legacy 立即随条件渲染卸载），再加载
  const switchToSkia = useCallback(() => {
    setError(null);
    setMode('loading');
  }, []);

  // 返回 legacy：用户显式触发；Skia smoke 立即卸载，绝不自动回退。
  // 同时清除重试标记，确保之后不会意外自动加载 Skia。
  const backToLegacy = useCallback(() => {
    clearRetryMarker();
    setError(null);
    setMode('legacy');
  }, []);

  // 仅在 loading 态执行加载流程；失败保留 error 态与可见反馈
  useEffect(() => {
    if (mode !== 'loading') {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // 1) 只从本地静态资源（public/canvaskit.wasm）加载 CanvasKit
        await LoadSkiaWeb({ locateFile: (file: string) => `/${file}` });
        // 2) CanvasKit 就绪后才动态导入 Skia smoke 画布
        const mod = await import('../skia/SkiaSmokeSurface');
        if (!cancelled) {
          setSkiaSurface(() => mod.SkiaSmokeSurface);
          setMode('skia');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setMode('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  // Skia 2.6.2 会缓存 LoadSkiaWeb 的 rejected promise，仅重置 state 重调不会真正
  // 重试；因此重试 = 写入一次性标记 + 整页刷新。刷新后首次渲染消费标记并直接进入
  // loading 重新加载（见 useState 惰性初始化）；若仍失败则回到 error 态，可再次重试。
  const retry = useCallback(() => {
    try {
      window.sessionStorage.setItem(RETRY_SKIA_KEY, '1');
    } catch {
      // 存储不可用时仍刷新；刷新后无标记则回落默认 legacy，行为安全
    }
    window.location.reload();
  }, []);

  return (
    <View testID="canvas-runtime-root" style={styles.root}>
      <View style={styles.card}>
        {/* 头部：隔离入口声明 + 当前模式（E2E 可断言） */}
        <View style={styles.header}>
          <Text style={styles.title}>Canvas Runtime · 隔离验证入口</Text>
          <Text style={styles.note}>
            这是隔离的运行时验证入口，与默认画布无关；legacy 为门禁通过前的暂时可见回退，
            Skia 为 smoke 验证画布。默认切换需等待后续功能/性能门禁，本入口不声明生产就绪。
          </Text>
          <Text testID="canvas-runtime-mode" style={styles.mode}>
            当前模式：{MODE_LABEL[mode]}
          </Text>
        </View>

        {/* 画布互斥区：四个分支由 mode 条件渲染保证至多一个挂载 */}
        {mode === 'legacy' ? (
          <View style={styles.canvasWrap}>
            <View testID="canvas-runtime-legacy-surface" style={styles.legacySurface}>
              <DrawingSurface testID="canvas-runtime-legacy-drawing" />
            </View>
            <Pressable
              testID="canvas-runtime-switch-skia"
              onPress={switchToSkia}
              accessibilityRole="button"
              accessibilityLabel="切换到 Skia"
              style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.primaryButtonText}>切换到 Skia（卸载 legacy 后加载 CanvasKit）</Text>
            </Pressable>
          </View>
        ) : null}

        {mode === 'loading' ? (
          <View testID="canvas-runtime-loading" style={styles.statusWrap}>
            <ActivityIndicator size="large" color="#3B5BDB" />
            <Text style={styles.statusText}>legacy 已卸载，正在加载本地 CanvasKit…</Text>
          </View>
        ) : null}

        {mode === 'skia' && SkiaSurface ? (
          <View style={styles.canvasWrap}>
            <View testID="canvas-runtime-skia-surface" style={styles.skiaSurface}>
              <SkiaSurface />
            </View>
            <Pressable
              testID="canvas-runtime-back-legacy"
              onPress={backToLegacy}
              accessibilityRole="button"
              accessibilityLabel="返回 legacy 画布"
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.secondaryButtonText}>返回 legacy 画布（卸载 Skia）</Text>
            </Pressable>
          </View>
        ) : null}

        {mode === 'error' ? (
          <View style={styles.statusWrap}>
            <Text testID="canvas-runtime-error" style={styles.errorTitle}>
              CanvasKit 加载失败：{error ?? '未知错误'}
            </Text>
            <Text style={styles.note}>
              Skia 2.6.2 会缓存失败的加载结果；重试将整页刷新并直接进入加载流程，刷新后若仍失败可再次重试。
            </Text>
            <View style={styles.buttonRow}>
              <Pressable
                testID="canvas-runtime-retry"
                onPress={retry}
                accessibilityRole="button"
                accessibilityLabel="刷新页面重试"
                style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
              >
                <Text style={styles.primaryButtonText}>刷新页面重试</Text>
              </Pressable>
              <Pressable
                testID="canvas-runtime-back-legacy"
                onPress={backToLegacy}
                accessibilityRole="button"
                accessibilityLabel="返回 legacy 画布"
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
              >
                <Text style={styles.secondaryButtonText}>返回 legacy 画布</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** 视觉与既有 smoke/fixture 一致：暖纸白页面、白卡片、细边框、墨色强调；窄屏自适应 */
const styles = StyleSheet.create({
  root: {
    flex: 1,
    padding: 16,
    backgroundColor: '#F5F3EE',
  },
  card: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E6E2D8',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  header: {
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
    fontVariant: ['tabular-nums'],
  },
  canvasWrap: {
    gap: 10,
  },
  // legacy DrawingSurface 需要一个确定高度的宿主（DIP）
  legacySurface: {
    width: '100%',
    height: 360,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E6E2D8',
    overflow: 'hidden',
  },
  skiaSurface: {
    width: '100%',
  },
  statusWrap: {
    minHeight: 200,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E6E2D8',
    backgroundColor: '#FBFAF6',
    padding: 16,
  },
  statusText: {
    fontSize: 13,
    color: '#3A3C41',
  },
  errorTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#C0392B',
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
  },
  primaryButton: {
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
  secondaryButton: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D8D4C8',
    backgroundColor: '#FFFFFF',
  },
  secondaryButtonText: {
    fontSize: 13,
    color: '#3A3C41',
  },
  buttonPressed: {
    opacity: 0.85,
  },
});
