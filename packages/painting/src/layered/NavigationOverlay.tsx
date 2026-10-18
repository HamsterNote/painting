import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LayeredEditorController } from '../core/layeredEditorController';
import { FreehandGeometryCache } from '../geometry/freehandCache';
import { deriveLayeredWorldBounds } from '../geometry/worldBounds';
import { getInfiniteRulerLayout } from '../ruler/geometry';
import { RulerTicks } from '../ruler/RulerTicks';
import { clampScale, type DrawingViewport } from '../viewport';
import { ObjectNode } from './DisplayLayer';
import { useEditorSnapshot } from './useEditorSnapshot';

export function NavigationOverlay({ controller }: { controller: LayeredEditorController }) {
  const navigation = useEditorSnapshot(controller, 'navigation');
  const { viewport } = useEditorSnapshot(controller, 'viewport');
  const placed = useRef<{ controller: LayeredEditorController; placement: string } | undefined>(
    undefined
  );
  const document = useEditorSnapshot(controller, 'document');
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const cache = useRef(new FreehandGeometryCache()).current;
  useLayoutEffect(() => {
    const measure = () => {
      const rect = root.current!.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(root.current!);
    measure();
    return () => observer?.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!navigation.virtualPaper.enabled || size.width <= 1) return;
    const placement = navigation.virtualPaper.initialPlacement;
    // Default placement applies when the paper first becomes visible. Hiding it
    // or resizing the surface must not reset a viewport the user has navigated.
    if (placement === 'top-center' && !navigation.paper) return;
    if (placed.current?.controller === controller && placed.current.placement === placement) return;
    if (placement === 'top-left') {
      placed.current = { controller, placement };
      return;
    }
    const current = controller.getSnapshot('viewport');
    const result = controller.updateViewport({
      type: 'replace',
      expectedRevision: current.revision,
      viewport: {
        ...current.viewport,
        tx: (size.width - 794 * current.viewport.scale) / 2,
        ty:
          placement === 'center'
            ? (size.height - 1123 * current.viewport.scale) / 2
            : current.viewport.ty,
      },
    });
    if (result.ok && (result.value.applied || result.value.reason === 'unchanged'))
      placed.current = { controller, placement };
  }, [
    controller,
    navigation.paper,
    navigation.virtualPaper.enabled,
    navigation.virtualPaper.initialPlacement,
    size,
  ]);
  const bounds = useMemo(() => {
    cache.syncDocument(document);
    const objects = document.objects
      .map((object) => deriveLayeredWorldBounds(object, cache)?.visualWorldBounds)
      .filter((entry) => entry !== undefined && entry !== null);
    return {
      minX: Math.min(0, ...objects.map((entry) => entry.minX)),
      minY: Math.min(0, ...objects.map((entry) => entry.minY)),
      maxX: Math.max(794, ...objects.map((entry) => entry.maxX)),
      maxY: Math.max(1123, ...objects.map((entry) => entry.maxY)),
    };
  }, [document, cache]);
  const ruler = navigation.ruler;
  const layout = getInfiniteRulerLayout({
    logicalCenter: ruler.center,
    rotationRad: ruler.rotationRad,
    height: ruler.height,
    viewport: size,
  });
  const visible = {
    x: -viewport.tx / viewport.scale,
    y: -viewport.ty / viewport.scale,
    width: size.width / viewport.scale,
    height: size.height / viewport.scale,
  };
  // Include the current viewport so the indicator remains reachable after panning outside content.
  const mapBounds = {
    minX: Math.min(bounds.minX, visible.x),
    minY: Math.min(bounds.minY, visible.y),
    maxX: Math.max(bounds.maxX, visible.x + visible.width),
    maxY: Math.max(bounds.maxY, visible.y + visible.height),
  };
  const mapWidth = mapBounds.maxX - mapBounds.minX + 80;
  const mapHeight = mapBounds.maxY - mapBounds.minY + 80;
  const mapScale = Math.min(176 / mapWidth, 126 / mapHeight);
  const mapOrigin = { x: mapBounds.minX - 40, y: mapBounds.minY - 40 };
  const drag = useRef<
    | {
        id: number;
        scale: number;
        origin: { x: number; y: number };
        offsetX: number;
        offsetY: number;
        mode: 'pan' | 'resize';
        start: { x: number; y: number };
        viewport: DrawingViewport;
        center: { x: number; y: number };
      }
    | undefined
  >(undefined);
  function navigate(event: React.PointerEvent<SVGSVGElement>) {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = state.origin.x + (event.clientX - rect.left - state.offsetX) / state.scale;
    const y = state.origin.y + (event.clientY - rect.top - state.offsetY) / state.scale;
    const latest = controller.getSnapshot('viewport');
    let next = {
      ...state.viewport,
      tx: state.viewport.tx - (x - state.start.x) * state.viewport.scale,
      ty: state.viewport.ty - (y - state.start.y) * state.viewport.scale,
    };
    if (state.mode === 'resize') {
      const startDistance = Math.hypot(
        state.start.x - state.center.x,
        state.start.y - state.center.y
      );
      const distance = Math.hypot(x - state.center.x, y - state.center.y);
      if (startDistance < 1 || distance < 1) return;
      const scale = clampScale((state.viewport.scale * startDistance) / distance);
      next = {
        scale,
        tx: size.width / 2 - state.center.x * scale,
        ty: size.height / 2 - state.center.y * scale,
      };
    }
    controller.updateViewport({
      type: 'replace',
      expectedRevision: latest.revision,
      viewport: next,
    });
  }
  function finishNavigation(event: React.PointerEvent<SVGSVGElement>) {
    if (drag.current?.id === event.pointerId) drag.current = undefined;
  }
  return (
    <div ref={root} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {ruler.visible ? (
        <svg
          data-testid="layered-ruler"
          width="100%"
          height="100%"
          style={{ position: 'absolute', inset: 0, color: '#374151' }}
        >
          <g
            transform={`translate(${layout.visualCenter.x} ${layout.visualCenter.y}) rotate(${(ruler.rotationRad * 180) / Math.PI})`}
          >
            <rect
              x={-layout.renderLength / 2}
              y={-ruler.height / 2}
              width={layout.renderLength}
              height={ruler.height}
              fill="#d1fae5"
              fillOpacity={0.65}
              stroke="#059669"
            />
            <RulerTicks
              length={layout.renderLength}
              height={ruler.height}
              originX={layout.tickOriginX}
            />
          </g>
        </svg>
      ) : null}
      {navigation.rotationFeedback ? (
        <output
          data-testid="ruler-angle-feedback"
          style={{
            position: 'absolute',
            left: Math.max(8, Math.min(size.width - 90, navigation.rotationFeedback.point.x + 12)),
            top: Math.max(8, Math.min(size.height - 30, navigation.rotationFeedback.point.y + 12)),
            background: '#20262d',
            color: '#fff',
            padding: '4px 8px',
            borderRadius: 4,
            fontSize: 13,
          }}
        >
          {Math.round((navigation.rotationFeedback.rotationRad * 180) / Math.PI)}°
        </output>
      ) : null}
      {navigation.zoomFeedback ? (
        <output
          data-testid="drawing-zoom-feedback"
          style={{
            position: 'absolute',
            left: Math.max(8, Math.min(size.width - 80, navigation.zoomFeedback.point.x - 32)),
            top: Math.max(8, Math.min(size.height - 32, navigation.zoomFeedback.point.y - 44)),
            background: '#20262d',
            color: '#fff',
            padding: '4px 8px',
            borderRadius: 4,
            pointerEvents: 'none',
          }}
        >
          {Math.round(navigation.zoomFeedback.scale * 100)}%
        </output>
      ) : null}
      {navigation.minimap ? (
        <svg
          data-testid="layered-minimap"
          aria-label="小地图"
          data-interactive="true"
          width={176}
          height={126}
          style={{
            position: 'absolute',
            right: 12,
            bottom: 12,
            width: 176,
            height: 126,
            background: navigation.paper ? '#e5e7eb' : '#fff',
            border: '1px solid #9ca3af',
            borderRadius: 4,
            pointerEvents: 'auto',
            touchAction: 'none',
          }}
          onPointerDown={(event) => {
            if (
              event.button !== 0 ||
              drag.current ||
              controller.getSnapshot('interaction').activeFreehand?.status === 'collecting'
            )
              return;
            // Snapshot map projection: moving the viewport cannot change a live drag's coordinate basis.
            const rect = event.currentTarget.getBoundingClientRect();
            const offsetX = (176 - mapWidth * mapScale) / 2;
            const offsetY = (126 - mapHeight * mapScale) / 2;
            const start = {
              x: mapOrigin.x + (event.clientX - rect.left - offsetX) / mapScale,
              y: mapOrigin.y + (event.clientY - rect.top - offsetY) / mapScale,
            };
            const target = event.target instanceof Element ? event.target : null;
            const onIndicator = target?.closest('[data-minimap-indicator], [data-minimap-edge]');
            const mode =
              event.pointerType === 'mouse' && target?.closest('[data-minimap-edge]')
                ? 'resize'
                : 'pan';
            let startViewport = controller.getSnapshot('viewport').viewport;
            if (!onIndicator) {
              const latest = controller.getSnapshot('viewport');
              controller.updateViewport({
                type: 'replace',
                expectedRevision: latest.revision,
                viewport: {
                  ...latest.viewport,
                  tx: size.width / 2 - start.x * latest.viewport.scale,
                  ty: size.height / 2 - start.y * latest.viewport.scale,
                },
              });
              startViewport = controller.getSnapshot('viewport').viewport;
            }
            drag.current = {
              id: event.pointerId,
              scale: mapScale,
              origin: mapOrigin,
              offsetX,
              offsetY,
              mode,
              start,
              viewport: startViewport,
              center: {
                x: (size.width / 2 - startViewport.tx) / startViewport.scale,
                y: (size.height / 2 - startViewport.ty) / startViewport.scale,
              },
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            event.preventDefault();
          }}
          onPointerMove={navigate}
          onPointerUp={finishNavigation}
          onPointerCancel={finishNavigation}
          onLostPointerCapture={finishNavigation}
        >
          <g
            transform={`translate(${(176 - mapWidth * mapScale) / 2} ${(126 - mapHeight * mapScale) / 2}) scale(${mapScale}) translate(${-mapOrigin.x} ${-mapOrigin.y})`}
            pointerEvents="none"
          >
            {navigation.paper ? (
              <rect data-minimap-paper="true" x={0} y={0} width={794} height={1123} fill="#fff" />
            ) : null}
            {document.objects.map((object) => {
              const t = object.transform;
              return (
                <g
                  key={object.objectId}
                  transform={`matrix(${t.a} ${t.b} ${t.c} ${t.d} ${t.tx} ${t.ty})`}
                >
                  <ObjectNode object={object} cache={cache} />
                </g>
              );
            })}
            <rect
              data-testid="minimap-viewport"
              data-minimap-indicator="true"
              pointerEvents="auto"
              {...visible}
              fill="#2563eb"
              fillOpacity={0.12}
              stroke="#2563eb"
              strokeWidth={1 / mapScale}
            />
            {[
              ['top', 0.5, 0],
              ['bottom', 0.5, 1],
              ['left', 0, 0.5],
              ['right', 1, 0.5],
              ['corner-tl', 0, 0],
              ['corner-tr', 1, 0],
              ['corner-bl', 0, 1],
              ['corner-br', 1, 1],
            ].map(([edge, x, y]) => (
              <rect
                key={edge}
                data-minimap-edge={edge}
                x={visible.x + Number(x) * visible.width - 4 / mapScale}
                y={visible.y + Number(y) * visible.height - 4 / mapScale}
                width={8 / mapScale}
                height={8 / mapScale}
                fill="#2563eb"
                fillOpacity={0.5}
                pointerEvents="auto"
                style={{
                  cursor:
                    edge === 'left' || edge === 'right'
                      ? 'ew-resize'
                      : edge === 'top' || edge === 'bottom'
                        ? 'ns-resize'
                        : 'nwse-resize',
                }}
              />
            ))}
          </g>
        </svg>
      ) : null}
    </div>
  );
}

export function VirtualPaper({ controller }: { controller: LayeredEditorController }) {
  const { paper } = useEditorSnapshot(controller, 'navigation');
  const { viewport } = useEditorSnapshot(controller, 'viewport');
  if (!paper) return null;
  return (
    <svg
      data-testid="layered-paper"
      width="100%"
      height="100%"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: '#e5e7eb' }}
    >
      <g
        transform={`matrix(${viewport.scale} 0 0 ${viewport.scale} ${viewport.tx} ${viewport.ty})`}
      >
        <rect
          width={794}
          height={1123}
          fill="#fff"
          stroke="#9ca3af"
          strokeWidth={1 / viewport.scale}
        />
      </g>
    </svg>
  );
}
