/**
 * NativeAdapterSmokeSurface —— OpenSpec migrate-expo57-skia-surface 阶段 4.2 的可观测冒烟 UI。
 *
 * 目的：在 iOS / Android 上用真实 RNGH 2.32 触摸回调驱动
 * `packages/painting/src/input/native` 的 `createNativeInputAdapter`，
 * 并把规范化输入逐条喂给纯 core 的 `reduceGestureSession`，让验收者可以直接观察到：
 *   - pointer 生命周期事件流（down/move/up/cancel，格式 `phase:id:device`）；
 *   - GestureSession 状态（idle/active/completed/cancelled/failed）；
 *   - 活跃触点、document-commit 次数、cancel 次数；
 *   - reset 时 adapter.destroy() 对残留触点触发的可观察取消。
 *
 * 明确不做：
 *   - 这不是产品 DrawingSurface：不渲染笔迹、不做命中/视口/业务手势仲裁；
 *   - 本 surface 的 targetRole 固定为 'paper'，重点验证 pointer 生命周期而非领域语义；
 *   - 原生触摸事件不携带修饰键，adapter 写入的 modifiers 恒为 false（已知限制，UI 明示）。
 *
 * 导入约定：不经过包根 barrel，直接相对引用 painting 源码的 core / input/native
 * 入口（纯 TS、无平台依赖，Metro 与 tsc 都可解析）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
  PointerType,
  State,
  type GestureStateChangeEvent,
  type GestureTouchEvent,
  type PanGestureHandlerEventPayload,
} from 'react-native-gesture-handler';
import {
  createGestureSession,
  reduceGestureSession,
  DRAWING_STROKE_SCHEMA_VERSION,
  type DrawingValueV2,
  type GestureSession,
  type GestureSessionStatus,
  type NormalizedPointerInput,
} from '../../../../packages/painting/src/core/internal';
import {
  createNativeInputAdapter,
  type NativeInputAdapter,
} from '../../../../packages/painting/src/input/native/index';

/** 对外暴露的稳定 testID 集合，供 iOS/Android 端 E2E 与人工验收引用 */
export const NATIVE_ADAPTER_SMOKE_TEST_IDS = {
  root: 'native-adapter-smoke-root',
  interaction: 'native-adapter-smoke-interaction',
  status: 'native-adapter-smoke-status',
  events: 'native-adapter-smoke-events',
  reset: 'native-adapter-smoke-reset',
} as const;

/** 事件流最多保留的条数（最近在前） */
const MAX_EVENTS = 12;

/** 稳定的最小 V2 文档：空笔迹，作为每一代 session 的起点 */
const SMOKE_DOCUMENT: DrawingValueV2 = {
  schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
  strokes: [],
};

/**
 * 构造一代全新的纯 GestureSession。
 * createPenStroke 是确定性的：同一输入必得同一笔迹（无随机数、无平台对象）。
 */
function createSmokeSession(): GestureSession {
  return createGestureSession({
    document: SMOKE_DOCUMENT,
    tool: 'pen',
    createPenStroke: (request) => ({
      schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
      id: `smoke-pen-${String(request.pointerId)}-${request.startedAt}`,
      tool: 'pen',
      points: request.points.map((point) => ({ ...point })),
    }),
  });
}

/** 面板可观察状态：全部来自 adapter/session 的真实输出，无任何伪造 */
interface SmokeViewModel {
  /** GestureSession 最近生命周期状态 */
  status: GestureSessionStatus;
  /** 最近 N 条规范化输入，格式 `phase:id:device`；seq 为单调递增序号，供列表 key 使用 */
  events: readonly { seq: number; text: string }[];
  /** adapter 当前活跃触点 id 列表（逗号连接，空串表示无） */
  activeIds: string;
  /** 收到的 document-commit effect 总数 */
  commitCount: number;
  /** 收到的 cancel 阶段输入总数 */
  cancelCount: number;
  /** 最近一次 effect 类型（无则为 '-'） */
  lastEffect: string;
  /** finalize 时残留触点的关闭方式说明（无残留为 '-'） */
  lastFinalize: string;
  /** 当前 session document 中的笔迹数（pen up 提交后应 +1） */
  strokeCount: number;
  /** 最近一次 reset 的说明 */
  resetNote: string;
}

const INITIAL_VIEW_MODEL: SmokeViewModel = {
  status: 'idle',
  events: [],
  activeIds: '',
  commitCount: 0,
  cancelCount: 0,
  lastEffect: '-',
  lastFinalize: '-',
  strokeCount: 0,
  resetNote: '-',
};

export default function NativeAdapterSmokeSurface() {
  // ===== 生命周期管理：adapter/session 存 ref，绝不随 render 重建 =====
  // generation 仅由「重置会话」显式递增；useMemo 依赖它，保证一次 render 内
  // 不会重复创建 adapter，卸载/换代时才销毁旧实例（destroy 幂等）。
  const [generation, setGeneration] = useState(0);
  const sessionRef = useRef<GestureSession>(createSmokeSession());
  const adapterRef = useRef<NativeInputAdapter | null>(null);
  /** 事件流条目的单调递增序号（跨代不归零，保证列表 key 稳定唯一） */
  const eventSeqRef = useRef(0);
  const [vm, setVm] = useState<SmokeViewModel>(INITIAL_VIEW_MODEL);

  /**
   * adapter 的唯一出口：把规范化输入喂给最新 session。
   * 稳定引用（空依赖）：内部始终读 sessionRef.current，因此 adapter 回调
   * 每次都以最新 session 执行 reduceGestureSession；transition.session 已携带
   * document-commit 后的新 document，写回 ref 即把 effect 作用到下一代 session。
   */
  const dispatchInput = useCallback((input: NormalizedPointerInput) => {
    const { session, effects } = reduceGestureSession(sessionRef.current, input);
    sessionRef.current = session;
    const commitEffects = effects.filter((effect) => effect.type === 'document-commit');
    setVm((prev) => ({
      ...prev,
      status: session.status,
      events: [
        {
          seq: ++eventSeqRef.current,
          text: `${input.phase}:${String(input.pointerId)}:${input.device}`,
        },
        ...prev.events,
      ].slice(0, MAX_EVENTS),
      activeIds: adapterRef.current?.getActivePointerIds().join(', ') ?? '',
      commitCount: prev.commitCount + commitEffects.length,
      cancelCount: prev.cancelCount + (input.phase === 'cancel' ? 1 : 0),
      lastEffect:
        effects.length > 0 ? effects.map((effect) => effect.type).join(', ') : prev.lastEffect,
      strokeCount: session.document.strokes.length,
    }));
  }, []);

  // 每一代创建一对全新 adapter/session；session 起点恒为最小 V2 文档，
  // role 固定 'paper'（本 surface 验证 pointer 生命周期，不做命中仲裁）。
  const adapter = useMemo<NativeInputAdapter>(() => {
    // generation 是显式的换代触发器：只有重置时才新建 adapter/session 对
    void generation;
    sessionRef.current = createSmokeSession();
    const created = createNativeInputAdapter({
      onInput: dispatchInput,
      resolveTargetRole: () => 'paper',
    });
    adapterRef.current = created;
    return created;
  }, [generation, dispatchInput]);

  // 卸载或换代时销毁旧 adapter：destroy 会把残留触点以 cancel 关闭，
  // 这些 cancel 仍会进入上面的 dispatchInput，从而可观察。destroy 幂等，
  // 与重置按钮中的显式 destroy 不会相互重复取消。
  useEffect(() => {
    return () => {
      adapter.destroy();
    };
  }, [adapter]);

  /**
   * RNGH 触摸回调 → adapter.handleTouches。
   * 桥接说明（不伪造数据）：
   *   - eventType / changedTouches 与 adapter 的 NativeTouchEvent 结构兼容，直接透传；
   *   - RNGH 2.32 的 pointerType 是数值枚举，用数值枚举的反向映射得到 'TOUCH' 等
   *     字符串名，对齐 adapter 的设备识别契约；
   *   - 有意不读取 absoluteX/absoluteY/allTouches/numberOfTouches。
   */
  const handleTouches = useCallback((event: GestureTouchEvent) => {
    adapterRef.current?.handleTouches({
      eventType: event.eventType,
      pointerType: PointerType[event.pointerType],
      changedTouches: event.changedTouches,
    });
  }, []);

  /**
   * 手势 finalize → adapter.handleFinalize。
   * adapter 语义：success 且 state=END 时残留触点按 up 关闭，否则按 cancel 关闭。
   * 这里在调用前快照活跃数，仅当存在残留时更新可观察文案。
   */
  const handleFinalize = useCallback(
    (event: GestureStateChangeEvent<PanGestureHandlerEventPayload>, success: boolean) => {
      const current = adapterRef.current;
      if (!current) {
        return;
      }
      const residual = current.getActivePointerIds().length;
      current.handleFinalize({ state: event.state }, success);
      if (residual > 0) {
        const closedAs = success && event.state === State.END ? 'up' : 'cancel';
        setVm((prev) => ({
          ...prev,
          lastFinalize: `${closedAs}（${residual} 个残留触点）`,
        }));
      }
    },
    []
  );

  // 唯一注册的手势：单个 Pan，只在它上面挂 touches 回调，避免多手势重复 pointer 流。
  // runOnJS(true)：回调在 JS 线程执行，不引入 Reanimated worklet 之外的多线程复杂度。
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .runOnJS(true)
        .onTouchesDown(handleTouches)
        .onTouchesMove(handleTouches)
        .onTouchesUp(handleTouches)
        .onTouchesCancelled(handleTouches)
        .onFinalize(handleFinalize),
    [handleTouches, handleFinalize]
  );

  /**
   * 重置：先 destroy（残留触点触发可观察的 cancel），再换代新建 adapter/session。
   * 事件流与计数刻意保留，让 destroy 产生的 cancel 在面板上仍然可见。
   */
  const handleReset = useCallback(() => {
    const current = adapterRef.current;
    const residual = current ? current.getActivePointerIds().length : 0;
    current?.destroy();
    setVm((prev) => ({
      ...prev,
      status: 'idle',
      activeIds: '',
      resetNote:
        residual > 0
          ? `第 ${generation} 代已 destroy：取消 ${residual} 个残留触点`
          : `第 ${generation} 代已 destroy：无残留触点`,
    }));
    setGeneration((prev) => prev + 1);
  }, [generation]);

  return (
    // 局部 GestureHandlerRootView：根布局已有全局容器，这里再加一层保证
    // 该路由被独立挂载（深链接/独立入口）时手势仍可用，嵌套无害。
    <GestureHandlerRootView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View testID={NATIVE_ADAPTER_SMOKE_TEST_IDS.root} style={styles.container}>
          {/* 头部：说明这是开发验收面板，而非产品画布 */}
          <View style={styles.header}>
            <Text style={styles.title}>Native Input Adapter 冒烟</Text>
            <Text style={styles.subtitle}>
              RNGH 触摸回调 → createNativeInputAdapter → 纯 GestureSession；观察 pointer
              生命周期与提交/取消。
            </Text>
          </View>

          {/* 交互区域：单指按下并拖动即可产生 down/move/up 事件流 */}
          <GestureDetector gesture={gesture}>
            <View
              testID={NATIVE_ADAPTER_SMOKE_TEST_IDS.interaction}
              style={styles.interaction}
              accessible
              accessibilityRole="image"
              accessibilityLabel="Native adapter 冒烟交互区域"
              accessibilityHint="在此区域按住并拖动，面板会实时显示 pointer 事件"
            >
              <Text style={styles.interactionHint} pointerEvents="none">
                在此区域按住并拖动（单指即可）
              </Text>
            </View>
          </GestureDetector>

          {/* 状态面板：层级分明的只读观察区 */}
          <View style={styles.panel}>
            <View style={styles.row}>
              <Text style={styles.label}>会话状态</Text>
              <Text testID={NATIVE_ADAPTER_SMOKE_TEST_IDS.status} style={styles.valueStrong}>
                {vm.status}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>活跃触点</Text>
              <Text style={styles.value}>{vm.activeIds || '无'}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>document 笔迹数</Text>
              <Text style={styles.value}>{vm.strokeCount}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>document-commit 次数</Text>
              <Text style={styles.value}>{vm.commitCount}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>cancel 次数</Text>
              <Text style={styles.value}>{vm.cancelCount}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>最近 effect</Text>
              <Text style={styles.value}>{vm.lastEffect}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>finalize 残留关闭</Text>
              <Text style={styles.value}>{vm.lastFinalize}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>最近重置</Text>
              <Text style={styles.value}>{vm.resetNote}</Text>
            </View>
            {/* 已知限制明示：原生触摸事件不含修饰键 */}
            <Text style={styles.note}>
              限制：原生触摸事件不携带修饰键，adapter 写入的 alt/ctrl/meta/shift 恒为 false。
            </Text>
          </View>

          {/* 事件流：最近 12 条 `phase:id:device`，最新在前 */}
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>事件流（最近 {MAX_EVENTS} 条）</Text>
            <View testID={NATIVE_ADAPTER_SMOKE_TEST_IDS.events}>
              {vm.events.length === 0 ? (
                <Text style={styles.eventEmpty}>尚无输入事件</Text>
              ) : (
                vm.events.map((entry) => (
                  <Text key={entry.seq} style={styles.eventLine}>
                    {entry.text}
                  </Text>
                ))
              )}
            </View>
          </View>

          {/* 重置：先 destroy 触发可观察取消，再新建 adapter/session */}
          <Pressable
            testID={NATIVE_ADAPTER_SMOKE_TEST_IDS.reset}
            onPress={handleReset}
            accessibilityRole="button"
            accessibilityLabel="重置会话"
            style={({ pressed }) => [styles.resetButton, pressed && styles.resetButtonPressed]}
          >
            <Text style={styles.resetButtonText}>重置会话（先 destroy 取消残留）</Text>
          </Pressable>
        </View>
      </ScrollView>
    </GestureHandlerRootView>
  );
}

/** 视觉与 Skia 冒烟画布一致：暖纸白、细边框、单一墨色强调；面板化、不花哨 */
const INK = '#3B5BDB';

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scroll: {
    padding: 16,
    backgroundColor: '#F5F3EE',
  },
  container: {
    width: '100%',
    maxWidth: 640,
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
  subtitle: {
    fontSize: 13,
    color: '#6B6F76',
    lineHeight: 18,
  },
  interaction: {
    width: '100%',
    height: 240,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#B9B4A4',
    backgroundColor: '#FBFAF6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  interactionHint: {
    fontSize: 14,
    color: '#9A9EA6',
  },
  panel: {
    borderWidth: 1,
    borderColor: '#E6E2D8',
    borderRadius: 10,
    padding: 12,
    gap: 6,
    backgroundColor: '#FFFFFF',
  },
  panelTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3A3C41',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  label: {
    fontSize: 13,
    color: '#6B6F76',
  },
  value: {
    fontSize: 13,
    color: '#3A3C41',
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
    textAlign: 'right',
  },
  valueStrong: {
    fontSize: 13,
    fontWeight: '600',
    color: INK,
  },
  note: {
    fontSize: 12,
    color: '#9A9EA6',
    lineHeight: 16,
    marginTop: 4,
  },
  eventEmpty: {
    fontSize: 13,
    color: '#9A9EA6',
  },
  eventLine: {
    fontSize: 12,
    color: '#3A3C41',
    fontVariant: ['tabular-nums'],
    lineHeight: 18,
  },
  resetButton: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D8D4C8',
    backgroundColor: '#FFFFFF',
  },
  resetButtonPressed: {
    backgroundColor: '#F1F0EB',
  },
  resetButtonText: {
    fontSize: 14,
    color: '#3A3C41',
  },
});
