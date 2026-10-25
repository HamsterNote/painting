import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { PaintingPencilkitView, isPencilkitDemoAvailable } from '@hamster-note/painting-pencilkit';
import {
  isPencilkitDemoSample,
  isPencilkitDemoStroke,
  type PencilkitDemoMessage,
  type PencilkitDemoReply,
  type PencilkitDemoState,
} from '@hamster-note/painting/input/native';
import LayeredEditorDom from './LayeredEditorDom';

type Outgoing<T = PencilkitDemoMessage> = T extends PencilkitDemoMessage
  ? Omit<T, 'messageId' | 'protocolVersion'>
  : never;

/** Explicit G2/G3 validation only; default enablement still requires device acceptance. */
export default function LayeredEditorRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    pencilkit?: string;
    diagnostics?: string;
    handoffDelay?: string;
    fixture?: string;
    touchDraw?: string;
    traceGestures?: string;
  }>();
  const requested = params.pencilkit === '1';
  const available = isPencilkitDemoAvailable();
  const connected = useRef(false);
  connected.current = requested && available;
  const [state, setState] = useState<PencilkitDemoState>();
  const [queue, setQueue] = useState<PencilkitDemoMessage[]>([]);
  const [retireIDs, setRetireIDs] = useState<number[]>([]);
  const [fault, setFault] = useState('');
  const [ready, setReady] = useState(false);
  const [nativeStatus, setNativeStatus] = useState<{
    contextKey: string;
    enabled: boolean;
    width: number;
    height: number;
    lastHit: string;
    routing: string;
    routingIssue?: string;
    toolBegins: number;
    toolFinishes?: number;
    drawingStrokes?: number;
    retireRequested?: number;
    retireAcknowledged?: number;
  }>();
  const [counts, setCounts] = useState({ began: 0, completed: 0, committed: 0 });
  const nextMessage = useRef(0);
  const transport = useRef<PencilkitDemoMessage[]>([]);
  const epoch = useRef('');
  const pending = useRef(new Set<number>());
  useEffect(() => {
    if (requested) return;
    transport.current = [];
    pending.current.clear();
    setQueue([]);
    setRetireIDs([]);
    setState(undefined);
    setNativeStatus(undefined);
    setFault('');
    setCounts({ began: 0, completed: 0, committed: 0 });
  }, [requested]);
  const enqueue = useCallback((message: Outgoing) => {
    if (transport.current.length >= 12) {
      setFault('transport-overflow');
      return;
    }
    const next = {
      ...message,
      protocolVersion: 1,
      messageId: ++nextMessage.current,
    } as PencilkitDemoMessage;
    transport.current = [...transport.current, next];
    setQueue(transport.current);
  }, []);
  const onState = useCallback(async (next: PencilkitDemoState) => {
    if (!connected.current) return;
    const nextEpoch = next.contextKey.split(':')[0];
    if (epoch.current !== nextEpoch) {
      epoch.current = nextEpoch;
      transport.current = [];
      pending.current.clear();
      setQueue([]);
      setRetireIDs([]);
      setFault('');
      setNativeStatus(undefined);
      setCounts({ began: 0, completed: 0, committed: 0 });
    }
    setState(next);
  }, []);
  const onReply = useCallback(async (reply: PencilkitDemoReply) => {
    if (!connected.current) return;
    if (reply.contextKey && reply.contextKey.split(':')[0] !== epoch.current) return;
    if (reply.messageId !== undefined) {
      const message = transport.current.find((entry) => entry.messageId === reply.messageId);
      if (message?.type === 'stroke' && reply.status === 'committed')
        setCounts((previous) => ({ ...previous, committed: previous.committed + 1 }));
      transport.current = transport.current.filter(
        (message) => message.messageId !== reply.messageId
      );
      setQueue(transport.current);
    }
    if (reply.status === 'retire') {
      setRetireIDs((previous) =>
        previous.includes(reply.id) ? previous : [...previous, reply.id]
      );
    }
    if (
      reply.reason &&
      ![
        'document-removed',
        'input-cancelled',
        'controller-cancelled',
        'cancelled-session',
        'layout-changed',
        'context-invalidated',
        'host-reset',
        'unmount',
      ].includes(reply.reason)
    )
      setFault(reply.reason);
    if (reply.status === 'visible') pending.current.delete(reply.id);
  }, []);
  useEffect(() => {
    if (!requested || !available) return;
    const sub = AppState.addEventListener('change', (value) => {
      if (value !== 'active') enqueue({ type: 'reset', contextKey: '', id: 0 });
    });
    return () => sub.remove();
  }, [available, enqueue, requested]);
  const headMessageId = queue[0]?.messageId;
  useEffect(() => {
    if (headMessageId === undefined) return;
    const timer = setTimeout(() => setFault('bridge-stalled'), 5000);
    return () => clearTimeout(timer);
  }, [headMessageId]);
  const editorParams = useMemo(
    () => ({
      diagnostics: params.diagnostics ?? '',
      handoffDelay: params.handoffDelay ?? '',
      fixture: params.fixture ?? '',
      touchDraw: params.touchDraw ?? '',
      traceGestures: params.traceGestures ?? '',
    }),
    [
      params.diagnostics,
      params.handoffDelay,
      params.fixture,
      params.touchDraw,
      params.traceGestures,
    ]
  );
  const outgoing = requested && available ? queue[0] : undefined;
  // Expo serializes every prop on every wrapper render, including an unacknowledged raw stroke.
  const editor = useMemo(
    () => (
      <LayeredEditorDom
        dom={{ style: { flex: 1 } }}
        nativePencilEnabled={requested && available}
        editorParams={editorParams}
        nativeMessage={outgoing}
        // Expo DOM messages can arrive after disabling the connection. Keep action names registered.
        onNativeState={onState}
        onNativeReply={onReply}
      />
    ),
    [requested, available, editorParams, outgoing, onState, onReply]
  );
  return (
    <View style={styles.root} testID="layered-ios-host">
      <View style={styles.status}>
        <View style={styles.statusRow}>
          <Text testID="layered-native-status" numberOfLines={2} style={styles.statusTitle}>
            {!requested
              ? 'Web / DOM'
              : !available
                ? 'PencilKit 构建不匹配，请安装新 development build'
                : fault
                  ? fault === 'dom-pencil-fallback'
                    ? 'PencilKit 断言失败：DOM Pencil 未收到原生起笔确认'
                    : `PencilKit 已暂停：${fault}`
                  : !state
                    ? 'PencilKit 等待 DOM 连接'
                    : !ready
                      ? 'PencilKit 等待原生视图'
                      : !nativeStatus || nativeStatus.contextKey !== state.contextKey
                        ? 'PencilKit 等待原生配置回执'
                        : !state.enabled
                          ? 'PencilKit 画布已停用'
                          : nativeStatus.routing !== 'gesture-ancestor'
                            ? 'PencilKit 原生宿主未连接'
                            : !nativeStatus.enabled
                              ? 'PencilKit 画布已停用'
                              : nativeStatus.width <= 0 || nativeStatus.height <= 0
                                ? 'PencilKit 等待画布布局'
                                : counts.began === 0
                                  ? 'PencilKit 已配置，等待原生起笔'
                                  : nativeStatus.toolBegins === 0
                                    ? 'PencilKit 已收到输入，等待原生预览'
                                    : counts.committed === 0
                                      ? 'PencilKit 已收到原生输入'
                                      : pending.current.size > 0
                                        ? 'PencilKit 已提交，等待历史交接'
                                        : 'PencilKit 历史交接已确认'}
          </Text>
          <Switch
            testID="layered-pencilkit-toggle"
            accessibilityLabel="PencilKit"
            value={requested}
            onValueChange={(value) => router.setParams({ pencilkit: value ? '1' : '0' })}
          />
        </View>
        {requested && available ? (
          <Text testID="layered-native-evidence" numberOfLines={6} style={styles.evidence}>
            {`原生起笔 ${counts.began} · 完成 ${counts.completed} · 文档提交 ${counts.committed}`}
            {` · 队列 ${queue.length} · 待交接 ${pending.current.size}`}
            {nativeStatus
              ? ` · PK预览 ${nativeStatus.toolBegins} · tool结束 ${nativeStatus.toolFinishes ?? '?'} · PK存量 ${nativeStatus.drawingStrokes ?? '?'} · 待退休/已确认 ${nativeStatus.retireRequested ?? '?'}/${nativeStatus.retireAcknowledged ?? '?'} · hit=${nativeStatus.lastHit} · canvas=${Math.round(nativeStatus.width)}x${Math.round(nativeStatus.height)} · ${nativeStatus.routing}${nativeStatus.routingIssue && nativeStatus.routingIssue !== 'none' ? `:${nativeStatus.routingIssue}` : ''}`
              : ''}
          </Text>
        ) : null}
        {requested && fault ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setFault('');
              transport.current = [];
              enqueue({ type: 'reset', contextKey: '', id: 0 });
            }}
          >
            <Text>重试</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.editor}>
        {available ? (
          <PaintingPencilkitView
            demoHost
            testID="layered-pencilkit-canvas"
            style={styles.editor}
            demoState={JSON.stringify({
              contextKey: state?.contextKey ?? '',
              enabled: requested && !!state?.enabled && !fault && pending.current.size < 4,
              retireIDs,
              exclusions: state?.exclusions ?? [],
              frame: state?.frame ?? { x: 0, y: 0, width: 0, height: 0 },
            })}
            pencilOnly
            inkColor={state?.brush.color ?? '#008060'}
            inkWidth={state ? state.brush.nominalSize * state.scale : 4}
            inkOpacity={state?.brush.opacity ?? 1}
            onReady={(event) => {
              if (typeof event?.nativeEvent?.moduleVersion === 'string') setReady(true);
            }}
            onDemoStatus={(event) => {
              const status = event?.nativeEvent;
              if (
                typeof status?.contextKey !== 'string' ||
                status.contextKey !== state?.contextKey ||
                typeof status.enabled !== 'boolean' ||
                !Number.isFinite(status.width) ||
                !Number.isFinite(status.height) ||
                typeof status.lastHit !== 'string' ||
                typeof status.routing !== 'string' ||
                !Number.isSafeInteger(status.toolBegins) ||
                status.toolBegins < 0
              )
                return;
              setNativeStatus({ ...status });
            }}
            onBegin={(event) => {
              const begin = event?.nativeEvent;
              if (typeof begin?.contextKey !== 'string') return;
              if (begin?.contextKey?.split(':')[0] !== epoch.current) return;
              if (
                !begin ||
                !isPencilkitDemoSample(begin.sample) ||
                !Number.isSafeInteger(begin.id)
              ) {
                setFault('invalid-native-begin');
                return;
              }
              setCounts((previous) => ({ ...previous, began: previous.began + 1 }));
              enqueue({
                type: 'begin',
                id: begin.id,
                contextKey: begin.contextKey,
                sample: begin.sample,
              });
            }}
            onStroke={(event) => {
              const stroke = event?.nativeEvent;
              const contextKey = (stroke as unknown as { contextKey?: string })?.contextKey;
              if (typeof contextKey !== 'string') return;
              if (contextKey?.split(':')[0] !== epoch.current) return;
              if (!isPencilkitDemoStroke(stroke) || !contextKey) {
                setFault('invalid-native-stroke');
                return;
              }
              pending.current.add(stroke.id);
              setCounts((previous) => ({ ...previous, completed: previous.completed + 1 }));
              enqueue({ type: 'stroke', id: stroke.id, contextKey, stroke });
            }}
            onPreviewRetired={(event) => {
              const retired = event?.nativeEvent;
              if (typeof retired?.contextKey !== 'string') return;
              if (retired?.contextKey?.split(':')[0] !== epoch.current) return;
              if (!retired || !Number.isSafeInteger(retired.id)) return;
              setRetireIDs((previous) => previous.filter((id) => id !== retired.id));
              enqueue({ type: 'retired', id: retired.id, contextKey: retired.contextKey });
            }}
          >
            {editor}
          </PaintingPencilkitView>
        ) : (
          editor
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  editor: { flex: 1 },
  status: {
    gap: 4,
    padding: 8,
    backgroundColor: '#e7f4ef',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    gap: 8,
    justifyContent: 'space-between',
  },
  statusTitle: { flex: 1, height: 36, fontSize: 14, lineHeight: 18 },
  evidence: { height: 96, fontSize: 12, lineHeight: 16 },
});
