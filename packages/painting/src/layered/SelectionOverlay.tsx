import { deriveLayeredSelectionGeometry } from '../core/layeredSelectionGeometry';
import type { LayeredEditorController } from '../core/layeredEditorController';
import { useEditorSnapshot } from './useEditorSnapshot';

export function SelectionOverlay({ controller }: { controller: LayeredEditorController }) {
  useEditorSnapshot(controller, 'document');
  useEditorSnapshot(controller, 'preview');
  const selection = useEditorSnapshot(controller, 'selection');
  useEditorSnapshot(controller, 'viewport');
  const { activeTool } = useEditorSnapshot(controller, 'tools');
  if (!selection.length || activeTool !== 'selection') return null;
  const geometry = deriveLayeredSelectionGeometry(controller);
  if (!geometry) return null;
  const { frame, region, resize, rotate } = geometry;
  const x = frame.minX,
    y = frame.minY;
  const width = frame.maxX - x,
    height = frame.maxY - y;
  return (
    <svg
      width="100%"
      height="100%"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      <rect
        data-selection-operation="move"
        x={region.minX}
        y={region.minY}
        width={region.maxX - region.minX}
        height={region.maxY - region.minY}
        fill="transparent"
        style={{ pointerEvents: 'auto', cursor: 'move' }}
      />
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
        x={resize.minX}
        y={resize.minY}
        width={10}
        height={10}
        fill="#fff"
        stroke="#059669"
        style={{ pointerEvents: 'auto', cursor: 'nwse-resize' }}
      />
      <circle
        data-selection-operation="rotate"
        aria-label="旋转选区"
        cx={rotate.x}
        cy={rotate.y}
        r={rotate.radius}
        fill="#fff"
        stroke="#059669"
        style={{ pointerEvents: 'auto', cursor: 'grab' }}
      />
    </svg>
  );
}
