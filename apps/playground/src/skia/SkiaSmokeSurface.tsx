/**
 * SkiaSmokeSurface —— OpenSpec migrate-expo57-skia-surface 阶段 1 的冒烟画布。
 *
 * 目的：用最小可交互界面验证三条链路在三端（iOS / Android / Web）真实连通：
 *   1. @shopify/react-native-skia 的 <Canvas> 可以挂载并绘制；
 *   2. react-native-gesture-handler 的 GestureDetector + Pan 手势可以驱动输入；
 *   3. react-native-reanimated 的 shared value 可以在手势回调（UI 线程）中被写入，
 *      并被 Skia 图形属性（圆心坐标 / 派生路径）直接消费。
 *
 * 明确不做（留给后续任务）：
 *   - 真实 DrawingSurface / V1 / V2 文档模型；
 *   - CanvasKit 加载策略与 legacy SVG 回退；
 *   - 领域手势语义（绘制/导航/选区/尺子等仲裁逻辑）。
 *
 * 这里只有「拖动 → 圆点跟随 + 简易笔迹 + 坐标/状态文本」这一件事。
 */
import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import {
  Canvas,
  Circle,
  Path as SkiaPath,
  Skia,
  type SkPath,
} from '@shopify/react-native-skia';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import {
  runOnJS,
  useDerivedValue,
  useSharedValue,
} from 'react-native-reanimated';

/**
 * 对外暴露的稳定 testID 集合 —— E2E（Playwright / 原生 E2E）直接引用这些常量，
 * 避免在测试里硬编码字符串。Web 端 react-native-web 会把 testID 映射为 data-testid。
 */
export const SKIA_SMOKE_TEST_IDS = {
  /** 整个冒烟画布的根容器 */
  root: 'skia-smoke-surface',
  /** 手势交互容器（GestureDetector 直接包裹的测量视图） */
  interaction: 'skia-smoke-interaction',
  /** Skia Canvas 的包裹视图 */
  canvas: 'skia-smoke-canvas',
  /** 语义化坐标文本，例如「坐标：x 123 · y 45」 */
  coordinates: 'skia-smoke-coordinates',
  /** 语义化状态文本：「空闲」/「拖动中」 */
  status: 'skia-smoke-status',
  /** 清除笔迹按钮 */
  clear: 'skia-smoke-clear',
} as const;

/** 笔迹采样点：move=true 表示新一段笔迹的起点（对应 moveTo，不与上一段连线） */
interface TrailPoint {
  x: number;
  y: number;
  move: boolean;
}

/** 笔迹点数上限：冒烟用途，超出后丢弃最旧的点，避免长时间拖动造成无限增长 */
const MAX_TRAIL_POINTS = 800;

/** 初始把光标圆点藏在画布外（尚未开始绘制时不显示圆点） */
const CURSOR_HIDDEN = -100;

/** 墨蓝色主色 —— 克制、清晰的绘制入口视觉，全局只保留这一个强调色 */
const INK = '#3B5BDB';
/** 光标外圈光晕使用的浅墨色 */
const INK_HALO = 'rgba(59, 91, 219, 0.18)';

/**
 * 跨平台 Skia 冒烟画布（Web / iOS / Android 同一份实现）。
 *
 * 交互：在画布区域按住并拖动 ——
 *   - 圆点（光标）实时跟随指针位置；
 *   - 沿途留下简易圆头笔迹；
 *   - 下方文本实时显示坐标与「空闲 / 拖动中」状态，供 E2E 断言。
 */
export function SkiaSmokeSurface() {
  // ===== Reanimated shared values：手势回调运行在 UI 线程，直接写这些值 =====
  /** 笔迹采样点序列（含分段标记） */
  const trail = useSharedValue<TrailPoint[]>([]);
  /** 光标圆点中心坐标（shared value 直接喂给 Skia Circle 的 cx/cy） */
  const cursorX = useSharedValue(CURSOR_HIDDEN);
  const cursorY = useSharedValue(CURSOR_HIDDEN);

  // ===== React 状态：仅承载需要被 E2E 断言的语义化文本（经 runOnJS 回传） =====
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  /** 画布可用尺寸：由 onLayout 测量，宽度自适应窄屏 */
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);

  // UI 线程 → JS 线程的状态回传（文本渲染必须在 JS 线程完成）
  const syncDragBegin = useCallback((x: number, y: number) => {
    setCoords({ x: Math.round(x), y: Math.round(y) });
    setDragging(true);
    setHasDrawn(true);
  }, []);

  const syncDragMove = useCallback((x: number, y: number) => {
    setCoords({ x: Math.round(x), y: Math.round(y) });
  }, []);

  const syncDragEnd = useCallback(() => {
    setDragging(false);
  }, []);

  // ===== Pan 手势：单指/鼠标/手写笔按下并拖动 =====
  // onBegin/onUpdate/onFinalize 在 RNGH v2 + Reanimated 下自动成为 worklet，
  // 因此其中可以直接读写 shared value，并经由 runOnJS 同步语义文本。
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        // minDistance(0)：按下即触发，不需要先移动阈值，保证 E2E 小幅拖动也生效
        .minDistance(0)
        .onBegin((e) => {
          'worklet';
          // 新一段笔迹的起点（move=true → moveTo，不与上一段笔迹连线）
          const next = trail.value.concat({ x: e.x, y: e.y, move: true });
          trail.value =
            next.length > MAX_TRAIL_POINTS ? next.slice(next.length - MAX_TRAIL_POINTS) : next;
          cursorX.value = e.x;
          cursorY.value = e.y;
          runOnJS(syncDragBegin)(e.x, e.y);
        })
        .onUpdate((e) => {
          'worklet';
          const next = trail.value.concat({ x: e.x, y: e.y, move: false });
          trail.value =
            next.length > MAX_TRAIL_POINTS ? next.slice(next.length - MAX_TRAIL_POINTS) : next;
          cursorX.value = e.x;
          cursorY.value = e.y;
          runOnJS(syncDragMove)(e.x, e.y);
        })
        .onFinalize(() => {
          'worklet';
          runOnJS(syncDragEnd)();
        }),
    [trail, cursorX, cursorY, syncDragBegin, syncDragMove, syncDragEnd]
  );

  // ===== Skia 派生路径：在 UI 线程把采样点序列转成 SkPath =====
  // shared value 变化会触发重算，<Path> 直接消费派生值，无需经过 React re-render。
  const trailPath = useDerivedValue<SkPath>(() => {
    const path = Skia.Path.Make();
    const points = trail.value;
    for (const point of points) {
      if (point.move) {
        path.moveTo(point.x, point.y);
      } else {
        path.lineTo(point.x, point.y);
      }
    }
    return path;
  });

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    // 宽高都大于 0 才挂载 Canvas，避免首帧 0 尺寸导致 Skia 创建空 surface
    if (width > 0 && height > 0) {
      setCanvasSize({ width, height });
    }
  }, []);

  /** 清除笔迹：JS 线程直接写 shared value 是合法的 */
  const handleClear = useCallback(() => {
    trail.value = [];
    cursorX.value = CURSOR_HIDDEN;
    cursorY.value = CURSOR_HIDDEN;
    setCoords(null);
    setDragging(false);
    setHasDrawn(false);
  }, [trail, cursorX, cursorY]);

  // 语义化坐标文本：未绘制时给出明确的占位文案，方便 E2E 区分状态
  const coordinatesText = coords ? `坐标：x ${coords.x} · y ${coords.y}` : '坐标：尚未绘制';
  const statusText = dragging ? '拖动中' : '空闲';

  return (
    // 自包含的 GestureHandlerRootView：保证冒烟画布即使被挂在尚未接入
    // gesture-handler 的 app shell 里也能工作；外层 shell 接入后嵌套也无害。
    <GestureHandlerRootView style={styles.flex}>
      <View testID={SKIA_SMOKE_TEST_IDS.root} style={styles.container}>
        {/* 头部：清晰、克制的绘制入口说明 */}
        <View style={styles.header}>
          <Text style={styles.title}>Skia 冒烟画布</Text>
          <Text style={styles.subtitle}>
            验证 Skia Canvas · Gesture Handler · Reanimated 已连通
          </Text>
        </View>

        {/* 手势交互容器：GestureDetector 包裹的测量视图，宽度自适应窄屏 */}
        <GestureDetector gesture={panGesture}>
          <View
            testID={SKIA_SMOKE_TEST_IDS.interaction}
            style={styles.canvasWrap}
            onLayout={handleLayout}
            accessible
            accessibilityRole="image"
            accessibilityLabel="Skia 冒烟画布交互区域"
            accessibilityHint="按住并拖动即可绘制，圆点会跟随你的指针"
          >
            {canvasSize ? (
              <View testID={SKIA_SMOKE_TEST_IDS.canvas} style={canvasSize}>
                <Canvas style={canvasSize}>
                  {/* 简易笔迹：圆头圆角折线，墨色 */}
                  <SkiaPath
                    path={trailPath}
                    color={INK}
                    style="stroke"
                    strokeWidth={3}
                    strokeCap="round"
                    strokeJoin="round"
                  />
                  {/* 光标圆点：外圈光晕 + 实心内核，shared value 直接驱动圆心 */}
                  <Circle cx={cursorX} cy={cursorY} r={11} color={INK_HALO} />
                  <Circle cx={cursorX} cy={cursorY} r={4.5} color={INK} />
                </Canvas>
              </View>
            ) : null}

            {/* 首次绘制前的引导提示；绘制后隐藏。pointerEvents="none" 不拦截手势 */}
            {!hasDrawn ? (
              <View style={styles.hintOverlay} pointerEvents="none">
                <Text style={styles.hintText}>按住并拖动，圆点与笔迹将跟随指针</Text>
              </View>
            ) : null}
          </View>
        </GestureDetector>

        {/* 语义化状态区：坐标 + 状态徽标 + 清除按钮（供 E2E 断言与人工观察） */}
        <View style={styles.statusRow}>
          <View style={styles.statusTextGroup}>
            <Text testID={SKIA_SMOKE_TEST_IDS.coordinates} style={styles.coordinates}>
              {coordinatesText}
            </Text>
            <View style={[styles.statusChip, dragging && styles.statusChipActive]}>
              <Text
                testID={SKIA_SMOKE_TEST_IDS.status}
                style={[styles.statusChipText, dragging && styles.statusChipTextActive]}
              >
                {statusText}
              </Text>
            </View>
          </View>

          <Pressable
            testID={SKIA_SMOKE_TEST_IDS.clear}
            onPress={handleClear}
            accessibilityRole="button"
            accessibilityLabel="清除笔迹"
            style={({ pressed }) => [styles.clearButton, pressed && styles.clearButtonPressed]}
          >
            <Text style={styles.clearButtonText}>清除笔迹</Text>
          </Pressable>
        </View>
      </View>
    </GestureHandlerRootView>
  );
}

/**
 * 视觉基调：暖纸白页面 + 白色卡片 + 单一墨色强调。
 * 纯 React Native StyleSheet，不依赖 DOM / SVG / 现有 painting package。
 */
const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  // 根容器：宽度 100% 并设最大宽度，居中；窄屏下自然占满
  container: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E6E2D8',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    // 轻量投影营造卡片层次（Web/原生通用的 elevation 组合）
    shadowColor: '#1B1B18',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  header: {
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#24252A',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: '#6B6F76',
  },
  // 画布区域：纸面质感 + 细边框，高度固定、宽度随容器（窄屏适配）
  canvasWrap: {
    width: '100%',
    height: 320,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E6E2D8',
    backgroundColor: '#FBFAF6',
    overflow: 'hidden',
  },
  // 引导提示：绝对定位居中于画布上方
  hintOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintText: {
    fontSize: 14,
    color: '#9A9EA6',
  },
  statusRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusTextGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  // 坐标文本：等宽数字，避免拖动时数字宽度抖动
  coordinates: {
    fontSize: 13,
    color: '#3A3C41',
    fontVariant: ['tabular-nums'],
  },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#F1F0EB',
  },
  statusChipActive: {
    backgroundColor: 'rgba(59, 91, 219, 0.12)',
  },
  statusChipText: {
    fontSize: 12,
    color: '#6B6F76',
  },
  statusChipTextActive: {
    color: INK,
    fontWeight: '600',
  },
  clearButton: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D8D4C8',
    backgroundColor: '#FFFFFF',
  },
  clearButtonPressed: {
    backgroundColor: '#F1F0EB',
  },
  clearButtonText: {
    fontSize: 13,
    color: '#3A3C41',
  },
});

export default SkiaSmokeSurface;
