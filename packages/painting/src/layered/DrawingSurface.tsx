import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
import {
  createPageCoordinateSpace,
  type PageGeometry,
  type GetClientToLocal,
} from '../geometry/pageCoordinates';
import { NavigationOverlay, VirtualPaper } from './NavigationOverlay';
import { createNavigationWebAdapter } from './navigationWebAdapter';
import type { DrawingSurfaceVirtualPaperOptions } from '../virtualPaperOptions';
import { observeGestureEvents, type GestureTraceObserver } from '../input/web/gestureTrace';
import { useInputInitialization } from './useInputInitialization';
import { createLayeredInputArbiter } from '../input/web/layeredInputArbiter';
import {
  connectPencilkitDemo,
  type PencilkitDemoConnection,
} from '../input/native/pencilkitDemoBridge';

export type LayeredDrawingSurfaceProps = {
  controller: LayeredEditorController;
  /** Disabling cancels unfinished input and lets the underlying page receive events. */
  enabled?: boolean;
  inputPolicy?: WebFreehandPolicy;
  style?: CSSProperties;
  onRender?: RenderObserver;
  historyReadyDelayMs?: number;
  virtualPaper?: boolean | DrawingSurfaceVirtualPaperOptions;
  onGestureTrace?: GestureTraceObserver;
  nativePencilExperiment?: PencilkitDemoConnection;
  /** Prefer PageDrawingSurface for externally navigated document pages. */
  page?: PageGeometry;
};

let nextSurface = 0;

/** Surface owns DOM resources only. Document, input, settings and viewport live in the controller. */
export function LayeredDrawingSurface({
  controller,
  enabled = true,
  inputPolicy,
  style,
  onRender,
  historyReadyDelayMs,
  virtualPaper,
  onGestureTrace,
  nativePencilExperiment,
  page,
}: LayeredDrawingSurfaceProps) {
  const inputReady = useInputInitialization(controller, inputPolicy, true);
  const subscribeInput = useCallback(
    (listener: () => void) => controller.subscribe('input', listener),
    [controller]
  );
  const getInputMode = useCallback(() => controller.getSnapshot('input').mode, [controller]);
  const inputMode = useSyncExternalStore(subscribeInput, getInputMode, getInputMode);
  const host = useRef<HTMLDivElement>(null);
  const pageHost = useRef<HTMLDivElement>(null);
  const pageSpace = page && createPageCoordinateSpace(page);
  const pageState = useRef({ page, pageSpace });
  pageState.current = { page, pageSpace };
  const getClientToLocal = useCallback<GetClientToLocal>(() => {
    const { pageSpace } = pageState.current;
    const outer = pageHost.current;
    if (!outer || !pageSpace) return () => null;
    const rect = outer.getBoundingClientRect();
    // Rect includes ancestor CSS zoom; layout dimensions do not. Read once per batch.
    const computed = outer.ownerDocument.defaultView!.getComputedStyle(outer);
    // offsetWidth rounds fractional PDF page sizes. Use resolved CSS pixels when available.
    const layoutWidth = computed.width.endsWith('px')
      ? parseFloat(computed.width)
      : outer.offsetWidth;
    const layoutHeight = computed.height.endsWith('px')
      ? parseFloat(computed.height)
      : outer.offsetHeight;
    const sx = layoutWidth ? rect.width / layoutWidth : 1;
    const sy = layoutHeight ? rect.height / layoutHeight : 1;
    return (point) =>
      pageSpace.toPage({
        x: (point.x - rect.left) / sx - outer.clientLeft,
        y: (point.y - rect.top) / sy - outer.clientTop,
      });
  }, []);
  const pageMode = page !== undefined;
  useLayoutEffect(() => {
    if (!pageMode) return;
    const reset = () => {
      const current = controller.getSnapshot('viewport');
      if (current.viewport.scale === 1 && current.viewport.tx === 0 && current.viewport.ty === 0)
        return;
      const result = controller.updateViewport({
        type: 'replace',
        expectedRevision: current.revision,
        viewport: { scale: 1, tx: 0, ty: 0 },
      });
      if (!result.ok) throw new Error(`Cannot anchor page viewport: ${result.error.code}`);
    };
    reset();
    return controller.subscribe('viewport', reset);
  }, [controller, pageMode]);
  const [presentationState, setPresentation] = useState<{
    controller: LayeredEditorController;
    onGestureTrace: GestureTraceObserver | undefined;
    queue: PresentationCoordinator;
  }>();
  const presentation =
    presentationState?.controller === controller &&
    presentationState.onGestureTrace === onGestureTrace
      ? presentationState.queue
      : undefined;
  const inputEnabled = enabled && inputReady && (!pageMode || Boolean(pageSpace));
  const [failure, setFailure] = useState<{ commitId: string; message: string }>();
  const [textRequest, setTextRequest] = useState<{
    controller: LayeredEditorController;
    point: Point;
  }>();
  const [toolError, setToolError] = useState('');
  const closeText = useCallback(() => setTextRequest(undefined), []);
  useLayoutEffect(() => {
    if (textRequest && (!inputEnabled || textRequest.controller !== controller)) closeText();
  }, [controller, inputEnabled, textRequest, closeText]);
  const allocateId = useCallback(() => `object-${Date.now()}-${++nextSurface}`, []);
  const imageImport = useImageImport(controller, allocateId);
  const openImage = imageImport.openAt;
  const retry = useRef<(commitId: string) => void>(() => {});
  useEffect(() => {
    if (pageMode || virtualPaper === undefined) return;
    const current = controller.getSnapshot('navigation').virtualPaper;
    const patch = typeof virtualPaper === 'boolean' ? { enabled: virtualPaper } : virtualPaper;
    controller.setNavigation({ virtualPaper: { ...current, ...patch } });
  }, [controller, virtualPaper, pageMode]);
  useEffect(() => {
    // Saved content stays mounted and subscribed even when input is disabled.
    const queue = new PresentationCoordinator(controller, onGestureTrace);
    setPresentation({ controller, onGestureTrace, queue });
    return () => queue.destroy();
  }, [controller, onGestureTrace]);
  useEffect(() => {
    if (!inputEnabled || !presentation) return;
    const stopTrace = onGestureTrace
      ? observeGestureEvents(host.current!, onGestureTrace)
      : undefined;
    const queue = presentation;
    const surfaceId = ++nextSurface;
    let sequence = 0;
    let arbiter: ReturnType<typeof createLayeredInputArbiter> | undefined;
    const canNavigate = () => !pageMode && !arbiter?.isWriting();
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
      getClientToLocal: pageMode ? getClientToLocal : undefined,
      onTrace: onGestureTrace,
      createSessionId: () => {
        do {
          sequence += 1;
        } while (
          controller
            .getSnapshot('document')
            .objects.some(
              (object) =>
                object.kind === 'freehand' &&
                object.commitId === `surface-${surfaceId}-commit-${sequence}`
            )
        );
        return `surface-${surfaceId}-session-${sequence}`;
      },
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
      getClientToLocal: pageMode ? getClientToLocal : undefined,
      canNavigate,
      allocateId,
      beforeGesture: () => queue.confirmMounted(),
      onText: (point) => setTextRequest({ controller, point }),
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
      navigation: pageMode ? { dispatch() {}, begin() {}, cancel: () => true } : navigation,
      targetRole: pageMode ? undefined : navigation.targetRole,
      getClientToLocal: pageMode ? getClientToLocal : undefined,
      onDiagnostic: setToolError,
    });
    const surface = host.current!;
    surface.dataset.inputArbiter = 'ready';
    const stopNative = nativePencilExperiment
      ? connectPencilkitDemo({
          host: surface,
          controller,
          presentation: queue,
          arbiter,
          connection: nativePencilExperiment,
        })
      : undefined;
    retry.current = (commitId) => {
      const result = adapter.retryCommit(commitId);
      setFailure(result.ok ? undefined : { commitId, message: result.error.code });
    };
    return () => {
      delete surface.dataset.inputArbiter;
      stopNative?.();
      arbiter?.destroy();
      navigation.destroy();
      semantic.destroy();
      adapter.destroy();
      stopTrace?.();
    };
  }, [
    controller,
    inputEnabled,
    presentation,
    allocateId,
    openImage,
    onGestureTrace,
    nativePencilExperiment,
    pageMode,
    getClientToLocal,
  ]);
  const surface = (
    <div
      ref={host}
      data-testid="layered-surface"
      data-drawing-viewport="true"
      data-input-ready={inputReady}
      data-input-mode={inputMode}
      style={{
        position: 'relative',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        background: nativePencilExperiment ? 'transparent' : '#fff',
        touchAction: 'none',
        ...style,
        ...(page
          ? {
              position: 'absolute' as const,
              left: 0,
              top: 0,
              width: page.width,
              height: page.height,
              transformOrigin: '0 0',
              transform: `matrix(${page.pageToSurface.a},${page.pageToSurface.b},${page.pageToSurface.c},${page.pageToSurface.d},${page.pageToSurface.tx},${page.pageToSurface.ty})`,
              background: 'transparent',
            }
          : {}),
        // Browser selection is separate from touch-action; editing controls opt back in.
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        pointerEvents: inputEnabled ? style?.pointerEvents : 'none',
      }}
    >
      {presentation ? (
        <>
          {pageMode ? null : <VirtualPaper controller={controller} />}
          <DisplayLayer
            controller={controller}
            presentation={presentation}
            onRender={onRender}
            historyReadyDelayMs={historyReadyDelayMs}
            interactive={inputEnabled}
          />
          <DrawingLayer controller={controller} presentation={presentation} />
          {inputEnabled ? <SelectionOverlay controller={controller} /> : null}
          {inputEnabled && !pageMode ? <NavigationOverlay controller={controller} /> : null}
        </>
      ) : null}
      {inputEnabled && textRequest?.controller === controller ? (
        <TextEditor
          controller={controller}
          point={textRequest.point}
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
  return pageMode ? (
    <div
      ref={pageHost}
      data-testid="page-drawing-surface"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        pointerEvents: inputEnabled ? style?.pointerEvents : 'none',
      }}
    >
      {surface}
    </div>
  ) : (
    surface
  );
}

export type PageDrawingSurfaceProps = Omit<
  LayeredDrawingSurfaceProps,
  'page' | 'virtualPaper' | 'nativePencilExperiment'
> & {
  pageId: string;
  geometry: PageGeometry;
};

/** One controller per page. Navigation belongs to the host PDF/document viewer. */
export function PageDrawingSurface({ pageId, geometry, ...props }: PageDrawingSurfaceProps) {
  const t = geometry.pageToSurface;
  const key = JSON.stringify([
    pageId,
    geometry.width,
    geometry.height,
    t?.a,
    t?.b,
    t?.c,
    t?.d,
    t?.tx,
    t?.ty,
  ]);
  return <LayeredDrawingSurface key={key} {...props} page={geometry} />;
}
