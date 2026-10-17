import { memo, useLayoutEffect, useRef } from 'react';
import type { LayeredEditorController } from '../core/layeredEditorController';
import { commandsToSvgPath } from '../geometry/closedPath';
import { FreehandGeometryCache } from '../geometry/freehandCache';
import { deriveShapeGeometry, shapeCommandsToSvgPath } from '../geometry/shape';
import type { DocumentObject } from '../model/document';
import type { PresentationCoordinator } from './PresentationCoordinator';
import { useEditorSnapshot } from './useEditorSnapshot';

export type RenderObserver = (scope: 'display' | 'object', objectId?: string) => void;

export const ObjectNode = memo(function ObjectNode({
  object,
  cache,
  onRender,
}: {
  object: DocumentObject;
  cache: FreehandGeometryCache;
  onRender?: RenderObserver;
}) {
  onRender?.('object', object.objectId);
  switch (object.kind) {
    case 'freehand':
      return (
        <path
          data-geometry-revision={cache.getGeometry(object, 'final').geometryRevision}
          d={commandsToSvgPath(cache.getGeometry(object, 'final').commands)}
          fill={object.brushSnapshot.color}
          fillRule="nonzero"
          opacity={object.brushSnapshot.opacity}
        />
      );
    case 'shape': {
      const geometry = deriveShapeGeometry(object);
      return geometry ? (
        <path
          d={shapeCommandsToSvgPath(geometry.commands)}
          stroke={object.style.color}
          strokeWidth={object.style.width}
          opacity={object.style.opacity}
          fill={object.style.fill ?? 'none'}
          strokeDasharray={object.style.dash?.join(' ')}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null;
    }
    case 'image': {
      const bounds = object.localBounds;
      return (
        <image
          href={object.src}
          x={bounds.minX}
          y={bounds.minY}
          width={bounds.maxX - bounds.minX}
          height={bounds.maxY - bounds.minY}
        />
      );
    }
    case 'text': {
      const bounds = object.localBounds;
      return (
        <foreignObject
          x={bounds.minX}
          y={bounds.minY}
          width={bounds.maxX - bounds.minX}
          height={bounds.maxY - bounds.minY}
        >
          <div
            style={{
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              fontSize: object.fontSize,
              color: object.color,
              fontFamily: 'sans-serif',
              lineHeight: 1.25,
            }}
          >
            {object.content}
          </div>
        </foreignObject>
      );
    }
  }
});

export function DisplayLayer({
  controller,
  presentation,
  onRender,
  historyReadyDelayMs = 0,
}: {
  controller: LayeredEditorController;
  presentation: PresentationCoordinator;
  onRender?: RenderObserver;
  historyReadyDelayMs?: number;
}) {
  const document = useEditorSnapshot(controller, 'document');
  const preview = useEditorSnapshot(controller, 'preview');
  const { viewport } = useEditorSnapshot(controller, 'viewport');
  const root = useRef<SVGSVGElement>(null);
  const cache = useRef(new FreehandGeometryCache()).current;
  onRender?.('display');
  useLayoutEffect(() => {
    cache.syncDocument(document);
    const cleanups: (() => void)[] = [];
    for (const node of root.current!.querySelectorAll<SVGGElement>('[data-object-id]')) {
      const objectId = node.dataset.objectId!;
      cleanups.push(
        presentation.mount(objectId, {
          matches: (identity) =>
            document.documentRevision === identity.documentRevision &&
            node.querySelector('path')?.getAttribute('data-geometry-revision') ===
              identity.geometryRevision &&
            Boolean(node.querySelector('path')?.getAttribute('d')),
          setVisible: (visible) => {
            node.style.visibility =
              visible &&
              (!preview.hiddenIds.includes(objectId) ||
                preview.objects.some((object) => object.objectId === objectId))
                ? 'visible'
                : 'hidden';
          },
        })
      );
      const token = presentation.getIdentity(objectId);
      const path = node.querySelector('path');
      if (
        token &&
        path?.getAttribute('data-geometry-revision') === token.geometryRevision &&
        path.getAttribute('d')
      ) {
        if (historyReadyDelayMs > 0) {
          const timer = setTimeout(() => presentation.acknowledge(token), historyReadyDelayMs);
          cleanups.push(() => clearTimeout(timer));
        } else presentation.acknowledge(token);
      }
    }
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [document, cache, presentation, preview, historyReadyDelayMs]);
  return (
    <svg
      ref={root}
      data-testid="layered-display"
      width="100%"
      height="100%"
      style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
    >
      <g
        transform={`matrix(${viewport.scale} 0 0 ${viewport.scale} ${viewport.tx} ${viewport.ty})`}
      >
        {[
          ...document.objects,
          ...preview.objects.filter(
            (object) => !document.objects.some((current) => current.objectId === object.objectId)
          ),
        ].map((original) => {
          const object =
            preview.objects.find((entry) => entry.objectId === original.objectId) ?? original;
          const t = object.transform;
          return (
            <g
              key={object.objectId}
              data-object-id={object.objectId}
              transform={`matrix(${t.a} ${t.b} ${t.c} ${t.d} ${t.tx} ${t.ty})`}
              style={{
                pointerEvents: 'auto',
                visibility:
                  presentation.isHidden(object.objectId) ||
                  (preview.hiddenIds.includes(object.objectId) && !preview.objects.includes(object))
                    ? 'hidden'
                    : 'visible',
              }}
            >
              <ObjectNode object={object} cache={cache} onRender={onRender} />
            </g>
          );
        })}
        {preview.path.length > 1 ? (
          <polyline
            points={preview.path.map((point) => `${point.x},${point.y}`).join(' ')}
            fill="none"
            stroke="#2563eb"
            strokeWidth={1.5 / viewport.scale}
            strokeDasharray={`${4 / viewport.scale} ${3 / viewport.scale}`}
          />
        ) : null}
      </g>
    </svg>
  );
}
