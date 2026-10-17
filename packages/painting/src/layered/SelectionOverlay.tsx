import { FreehandGeometryCache } from '../geometry/freehandCache';
import { deriveLayeredWorldBounds } from '../geometry/worldBounds';
import type { LayeredEditorController } from '../core/layeredEditorController';
import { useEditorSnapshot } from './useEditorSnapshot';
import { useRef } from 'react';

export function SelectionOverlay({ controller }: { controller: LayeredEditorController }) {
  const document = useEditorSnapshot(controller, 'document');
  const preview = useEditorSnapshot(controller, 'preview');
  const selection = useEditorSnapshot(controller, 'selection');
  const { viewport: v } = useEditorSnapshot(controller, 'viewport');
  const { activeTool } = useEditorSnapshot(controller, 'tools');
  const cache = useRef(new FreehandGeometryCache()).current;
  cache.syncDocument(document);
  if (!selection.length || activeTool !== 'selection') return null;
  const bounds = document.objects
    .filter((object) => selection.includes(object.objectId))
    .map(
      (original) =>
        deriveLayeredWorldBounds(
          preview.objects.find((object) => object.objectId === original.objectId) ?? original,
          cache
        )?.visualWorldBounds
    );
  if (!bounds.length || bounds.some((entry) => !entry)) return null;
  const x = Math.min(...bounds.map((b) => b!.minX)) * v.scale + v.tx;
  const y = Math.min(...bounds.map((b) => b!.minY)) * v.scale + v.ty;
  const width =
    (Math.max(...bounds.map((b) => b!.maxX)) - Math.min(...bounds.map((b) => b!.minX))) * v.scale;
  const height =
    (Math.max(...bounds.map((b) => b!.maxY)) - Math.min(...bounds.map((b) => b!.minY))) * v.scale;
  return (
    <svg
      width="100%"
      height="100%"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="none"
        stroke="#059669"
        strokeDasharray="4 3"
      />
      <rect
        data-selection-operation="resize"
        aria-label="缩放选区"
        x={x + width - 5}
        y={y + height - 5}
        width={10}
        height={10}
        fill="#fff"
        stroke="#059669"
        style={{ pointerEvents: 'auto', cursor: 'nwse-resize' }}
      />
      <circle
        data-selection-operation="rotate"
        aria-label="旋转选区"
        cx={x + width / 2}
        cy={y - 20}
        r={6}
        fill="#fff"
        stroke="#059669"
        style={{ pointerEvents: 'auto', cursor: 'grab' }}
      />
    </svg>
  );
}
