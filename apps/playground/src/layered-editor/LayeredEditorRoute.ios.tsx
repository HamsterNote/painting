import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
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
  const [state, setState] = useState<PencilkitDemoState>();
  const [queue, setQueue] = useState<PencilkitDemoMessage[]>([]);
  const [retireIDs, setRetireIDs] = useState<number[]>([]);
  const [fault, setFault] = useState('');
  const [ready, setReady] = useState(false);
  const nextMessage = useRef(0);
  const transport = useRef<PencilkitDemoMessage[]>([]);
  const epoch = useRef('');
  const pending = useRef(new Set<number>());
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
    const nextEpoch = next.contextKey.split(':')[0];
    if (epoch.current !== nextEpoch) {
      epoch.current = nextEpoch;
      transport.current = [];
      pending.current.clear();
      setQueue([]);
      setRetireIDs([]);
      setFault('');
      setReady(false);
    }
    setState(next);
  }, []);
  const onReply = useCallback(async (reply: PencilkitDemoReply) => {
    if (reply.contextKey && reply.contextKey.split(':')[0] !== epoch.current) return;
    if (reply.messageId !== undefined) {
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
  useEffect(() => {
    if (!queue.length) return;
    const timer = setTimeout(() => setFault('bridge-stalled'), 5000);
    return () => clearTimeout(timer);
  }, [queue]);
  return (
    <View style={styles.root} testID="layered-ios-host">
      {requested ? (
        <View style={styles.status}>
          <Text testID="layered-native-status">
            {!available
              ? 'PencilKit 构建不匹配，请安装新 development build'
              : fault
                ? `PencilKit 已暂停：${fault}`
                : ready && state
                  ? 'PencilKit · G2/G3 验证'
                  : 'PencilKit 等待就绪'}
          </Text>
          {fault ? (
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
      ) : null}
      <View style={styles.editor}>
        <LayeredEditorDom
          dom={{ style: { flex: 1 } }}
          {...(requested && available
            ? {
                nativePencilEnabled: true,
                editorParams: {
                  diagnostics: params.diagnostics ?? '',
                  handoffDelay: params.handoffDelay ?? '',
                  fixture: params.fixture ?? '',
                  touchDraw: params.touchDraw ?? '',
                  traceGestures: params.traceGestures ?? '',
                },
                nativeMessage: queue[0],
                onNativeState: onState,
                onNativeReply: onReply,
              }
            : {})}
        />
        {requested && available && state ? (
          <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            <PaintingPencilkitView
              key={state.contextKey.split(':')[0]}
              testID="layered-pencilkit-canvas"
              style={{
                position: 'absolute',
                left: state.frame.x,
                top: state.frame.y,
                width: state.frame.width,
                height: state.frame.height,
              }}
              demoState={JSON.stringify({
                contextKey: state.contextKey,
                enabled: state.enabled && !fault && pending.current.size < 4,
                retireIDs,
                exclusions: state.exclusions,
              })}
              pencilOnly
              inkColor={state.brush.color}
              inkWidth={state.brush.nominalSize * state.scale}
              inkOpacity={state.brush.opacity}
              onReady={() => setReady(true)}
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
                pending.current.add(begin.id);
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
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  editor: { flex: 1 },
  status: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 8,
    backgroundColor: '#e7f4ef',
  },
});
