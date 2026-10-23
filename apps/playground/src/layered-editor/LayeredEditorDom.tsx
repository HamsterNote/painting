'use dom';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createEditor, type LayeredEditorController } from '@hamster-note/painting/layered';
import { LayeredPaintingBoard } from '@hamster-note/painting-board';
import { mixedFixture, resourceFixture } from './mixedFixture';
import { createGestureTrace, type GestureTrace } from './gestureTrace';
import { GestureTracePanel } from './GestureTracePanel';
import { InputDeviceDiagnostics } from './InputDeviceDiagnostics';
import type { PencilkitDemoConnection } from '@hamster-note/painting/input/native/pencilkitDemoBridge';
import type {
  PencilkitDemoMessage,
  PencilkitDemoReply,
  PencilkitDemoState,
} from '@hamster-note/painting/input/native/pencilkitDemoContract';

declare global {
  interface Window {
    __layeredEditor?: LayeredEditorController;
    __layeredRenders?: { display: number; objects: number };
    __layeredGestureTrace?: GestureTrace;
  }
}

export default function LayeredEditorDom(props: {
  dom?: import('expo/dom').DOMProps;
  nativePencilEnabled?: boolean;
  editorParams?: Record<string, string>;
  nativeMessage?: PencilkitDemoMessage;
  onNativeState?: (state: PencilkitDemoState) => Promise<void>;
  onNativeReply?: (reply: PencilkitDemoReply) => Promise<void>;
}) {
  const [receive, setReceive] = useState<(message: PencilkitDemoMessage) => void>();
  const { nativePencilEnabled, onNativeState, onNativeReply } = props;
  const actions = useRef({ onNativeState, onNativeReply });
  useLayoutEffect(() => {
    actions.current = { onNativeState, onNativeReply };
  }, [onNativeState, onNativeReply]);
  const hasActions = Boolean(onNativeState && onNativeReply);
  const nativeConnection = useMemo<PencilkitDemoConnection | undefined>(
    () =>
      nativePencilEnabled && hasActions
        ? {
            onState: (state) => {
              void actions.current.onNativeState?.(state);
            },
            onReply: (reply) => {
              void actions.current.onNativeReply?.(reply);
            },
            register: (receiver) => setReceive(() => receiver),
          }
        : undefined,
    [nativePencilEnabled, hasActions]
  );
  // Expo recreates action proxies and JSON objects on every host render.
  const messageJSON = JSON.stringify(props.nativeMessage);
  useEffect(() => {
    if (messageJSON) receive?.(JSON.parse(messageJSON) as PencilkitDemoMessage);
  }, [receive, messageJSON]);
  const [params] = useState(
    () =>
      new URLSearchParams(
        props.editorParams ?? (typeof window === 'undefined' ? '' : window.location.search)
      )
  );
  const [controller] = useState(() => {
    const editor = createEditor(
      params.get('fixture') === 'mixed'
        ? mixedFixture()
        : params.get('fixture') === 'resources'
          ? resourceFixture()
          : undefined
    );
    if (params.get('touchDraw') === '1') editor.initializeInputMode('finger');
    return editor;
  });
  const [renders] = useState(() => ({ display: 0, objects: 0 }));
  const diagnostics = params.get('diagnostics') === '1';
  const [trace] = useState(() =>
    diagnostics && params.get('traceGestures') === '1' ? createGestureTrace(controller) : undefined
  );
  useEffect(() => {
    if (!diagnostics) return;
    window.__layeredEditor = controller;
    window.__layeredRenders = renders;
    window.__layeredGestureTrace = trace;
    return () => {
      delete window.__layeredEditor;
      delete window.__layeredRenders;
      delete window.__layeredGestureTrace;
    };
  }, [controller, diagnostics, renders, trace]);
  return (
    <div
      style={{
        height: '100dvh',
        minHeight: 240,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'sans-serif',
      }}
    >
      <LayeredPaintingBoard
        controller={controller}
        nativePencilExperiment={nativeConnection}
        onGestureTrace={trace?.record}
        historyReadyDelayMs={
          diagnostics ? Math.min(1000, Math.max(0, Number(params.get('handoffDelay')) || 0)) : 0
        }
        onRender={
          diagnostics
            ? (scope) => {
                if (scope === 'display') renders.display++;
                else renders.objects++;
              }
            : undefined
        }
      />
      {diagnostics ? <InputDeviceDiagnostics /> : null}
      {trace ? <GestureTracePanel trace={trace} /> : null}
    </div>
  );
}
