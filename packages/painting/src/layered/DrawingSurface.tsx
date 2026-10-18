import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react';
import type { LayeredEditorController } from '../core/layeredEditorController';
import { createFreehandWebAdapter, type WebFreehandPolicy } from '../input/web/freehandWebAdapter';
import { DisplayLayer, type RenderObserver } from './DisplayLayer';
import { DrawingLayer } from './DrawingLayer';
import { PresentationCoordinator } from './PresentationCoordinator';
import { createSemanticWebAdapter } from './semanticWebAdapter';
import { TextEditor } from './TextEditor';
import { SelectionOverlay } from './SelectionOverlay';
import { useImageImport } from './useImageImport';
import type { Point } from '../model/document';
import { NavigationOverlay, VirtualPaper } from './NavigationOverlay';
import { createNavigationWebAdapter } from './navigationWebAdapter';
import type { DrawingSurfaceVirtualPaperOptions } from '../virtualPaperOptions';
import { observeGestureEvents, type GestureTraceObserver } from '../input/web/gestureTrace';
import { useInputInitialization } from './useInputInitialization';
import { createLayeredInputArbiter } from '../input/web/layeredInputArbiter';

export type LayeredDrawingSurfaceProps = {
  controller: LayeredEditorController;
  inputPolicy?: WebFreehandPolicy;
  style?: CSSProperties;
  onRender?: RenderObserver;
  historyReadyDelayMs?: number;
  virtualPaper?: boolean | DrawingSurfaceVirtualPaperOptions;
  onGestureTrace?: GestureTraceObserver;
};

let nextSurface = 0;

/** Surface owns DOM resources only. Document, input, settings and viewport live in the controller. */
export function LayeredDrawingSurface({
  controller,
  inputPolicy,
  style,
  onRender,
  historyReadyDelayMs,
  virtualPaper,
  onGestureTrace,
}: LayeredDrawingSurfaceProps) {
  const inputReady = useInputInitialization(controller, inputPolicy, true);
  const subscribeInput = useCallback(
    (listener: () => void) => controller.subscribe('input', listener),
    [controller]
  );
  const getInputMode = useCallback(() => controller.getSnapshot('input').mode, [controller]);
  const inputMode = useSyncExternalStore(subscribeInput, getInputMode, getInputMode);
  const host = useRef<HTMLDivElement>(null);
  const [presentation, setPresentation] = useState<PresentationCoordinator>();
  const [failure, setFailure] = useState<{ commitId: string; message: string }>();
  const [textPoint, setTextPoint] = useState<Point>();
  const [toolError, setToolError] = useState('');
  const closeText = useCallback(() => setTextPoint(undefined), []);
  const allocateId = useCallback(() => `object-${Date.now()}-${++nextSurface}`, []);
  const imageImport = useImageImport(controller, allocateId);
  const openImage = imageImport.openAt;
  const retry = useRef<(commitId: string) => void>(() => {});
  useEffect(() => {
    if (virtualPaper === undefined) return;
    const current = controller.getSnapshot('navigation').virtualPaper;
    const patch = typeof virtualPaper === 'boolean' ? { enabled: virtualPaper } : virtualPaper;
    controller.setNavigation({ virtualPaper: { ...current, ...patch } });
  }, [controller, virtualPaper]);
  useEffect(() => {
    if (!inputReady) return;
    const stopTrace = onGestureTrace
      ? observeGestureEvents(host.current!, onGestureTrace)
      : undefined;
    const queue = new PresentationCoordinator(controller, onGestureTrace);
    setPresentation(queue);
    const surfaceId = ++nextSurface;
    let sequence = 0;
    let arbiter: ReturnType<typeof createLayeredInputArbiter> | undefined;
    const canNavigate = () => !arbiter?.isWriting();
    const navigation = createNavigationWebAdapter(
      host.current!,
      controller,
      false,
      onGestureTrace,
      { listen: false, canNavigate }
    );
    const adapter = createFreehandWebAdapter({
      host: host.current!,
      controller,
      listen: false,
      onTrace: onGestureTrace,
      createSessionId: () => `surface-${surfaceId}-session-${++sequence}`,
      createCommitId: () => `surface-${surfaceId}-commit-${sequence}`,
      onResult: (notice) => {
        if (notice.phase !== 'commit') return;
        setFailure(
          notice.result.ok
            ? undefined
            : { commitId: notice.commitId, message: notice.result.error.code }
        );
      },
    });
    const semantic = createSemanticWebAdapter({
      host: host.current!,
      controller,
      listen: false,
      canNavigate,
      allocateId,
      beforeGesture: () => queue.confirmMounted(),
      onText: setTextPoint,
      onImage: openImage,
      onError: (error) => setToolError(String(error)),
      onTrace: onGestureTrace,
    });
    arbiter = createLayeredInputArbiter({
      host: host.current!,
      controller,
      tool: {
        dispatch(event) {
          (controller.getSnapshot('tools').activeTool === 'freehand' ? adapter : semantic).dispatch(
            event
          );
        },
        cancel() {
          const ink = adapter.cancel();
          const tool = semantic.cancel();
          return ink && tool;
        },
      },
      navigation,
      targetRole: navigation.targetRole,
      onDiagnostic: setToolError,
    });
    const surface = host.current!;
    surface.dataset.inputArbiter = 'ready';
    retry.current = (commitId) => {
      const result = adapter.retryCommit(commitId);
      setFailure(result.ok ? undefined : { commitId, message: result.error.code });
    };
    return () => {
      delete surface.dataset.inputArbiter;
      arbiter?.destroy();
      navigation.destroy();
      semantic.destroy();
      adapter.destroy();
      queue.destroy();
      stopTrace?.();
    };
  }, [controller, inputReady, allocateId, openImage, onGestureTrace]);
  return (
    <div
      ref={host}
      data-testid="layered-surface"
      data-input-ready={inputReady}
      data-input-mode={inputMode}
      style={{
        position: 'relative',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        background: '#fff',
        touchAction: 'none',
        ...style,
        // Browser selection is separate from touch-action; editing controls opt back in.
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        pointerEvents: inputReady ? style?.pointerEvents : 'none',
      }}
    >
      {presentation ? (
        <>
          <VirtualPaper controller={controller} />
          <DisplayLayer
            controller={controller}
            presentation={presentation}
            onRender={onRender}
            historyReadyDelayMs={historyReadyDelayMs}
          />
          <DrawingLayer controller={controller} presentation={presentation} />
          <SelectionOverlay controller={controller} />
          <NavigationOverlay controller={controller} />
        </>
      ) : null}
      {textPoint ? (
        <TextEditor
          controller={controller}
          point={textPoint}
          allocateId={allocateId}
          close={closeText}
        />
      ) : null}
      {imageImport.element}
      {toolError ? (
        <div role="alert" style={{ position: 'absolute', bottom: 8 }}>
          {toolError}
        </div>
      ) : null}
      {failure ? (
        <div
          role="alert"
          data-interactive="true"
          style={{ position: 'absolute', bottom: 8, left: 8 }}
        >
          提交失败：{failure.message}{' '}
          <button type="button" onClick={() => retry.current(failure.commitId)}>
            重试提交
          </button>
        </div>
      ) : null}
    </div>
  );
}
