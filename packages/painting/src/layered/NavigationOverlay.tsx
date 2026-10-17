import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LayeredEditorController } from '../core/layeredEditorController';
import { FreehandGeometryCache } from '../geometry/freehandCache';
import { deriveLayeredWorldBounds } from '../geometry/worldBounds';
import { getInfiniteRulerLayout } from '../ruler/geometry';
import { RulerTicks } from '../ruler/RulerTicks';
import { ObjectNode } from './DisplayLayer';
import { useEditorSnapshot } from './useEditorSnapshot';

export function NavigationOverlay({ controller }: { controller: LayeredEditorController }) {
  const navigation = useEditorSnapshot(controller, 'navigation');
  const { viewport } = useEditorSnapshot(controller, 'viewport');
  const placed = useRef<string | undefined>(undefined);
  const document = useEditorSnapshot(controller, 'document');
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const cache = useRef(new FreehandGeometryCache()).current;
  useLayoutEffect(() => {
    const measure = () => {
      const rect = root.current!.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root.current!);
    measure();
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!navigation.virtualPaper.enabled || size.width <= 1) {
      placed.current = undefined;
      return;
    }
    const placement = navigation.virtualPaper.initialPlacement;
    if (placed.current === placement) return;
    placed.current = placement;
    if (placement !== 'center') return;
    const current = controller.getSnapshot('viewport');
    controller.updateViewport({
      type: 'replace',
      expectedRevision: current.revision,
      viewport: {
        ...current.viewport,
        tx: (size.width - 794 * current.viewport.scale) / 2,
        ty: (size.height - 1123 * current.viewport.scale) / 2,
      },
    });
  }, [controller, navigation.virtualPaper.enabled, navigation.virtualPaper.initialPlacement, size]);
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
    controller.updateViewport({
      type: 'replace',
      expectedRevision: latest.revision,
      viewport: {
        ...latest.viewport,
        tx: size.width / 2 - x * latest.viewport.scale,
        ty: size.height / 2 - y * latest.viewport.scale,
      },
    });
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
            background: '#f3f4f6',
            border: '1px solid #9ca3af',
            borderRadius: 4,
            pointerEvents: 'auto',
            touchAction: 'none',
          }}
          onPointerDown={(event) => {
            if (
              event.button !== 0 ||
              controller.getSnapshot('interaction').activeFreehand?.status === 'collecting'
            )
              return;
            // Snapshot map projection: moving the viewport cannot change a live drag's coordinate basis.
            drag.current = {
              id: event.pointerId,
              scale: mapScale,
              origin: mapOrigin,
              offsetX: (176 - mapWidth * mapScale) / 2,
              offsetY: (126 - mapHeight * mapScale) / 2,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            navigate(event);
            event.preventDefault();
          }}
          onPointerMove={navigate}
          onPointerUp={() => {
            drag.current = undefined;
          }}
          onPointerCancel={() => {
            drag.current = undefined;
          }}
          onLostPointerCapture={() => {
            drag.current = undefined;
          }}
        >
          <g
            transform={`translate(${(176 - mapWidth * mapScale) / 2} ${(126 - mapHeight * mapScale) / 2}) scale(${mapScale}) translate(${-mapOrigin.x} ${-mapOrigin.y})`}
            pointerEvents="none"
          >
            <rect x={0} y={0} width={794} height={1123} fill="#fff" />
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
              {...visible}
              fill="#2563eb"
              fillOpacity={0.12}
              stroke="#2563eb"
              strokeWidth={1 / mapScale}
            />
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
