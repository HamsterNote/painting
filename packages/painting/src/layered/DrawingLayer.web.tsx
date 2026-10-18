import { useLayoutEffect, useRef } from 'react';
import type { LayeredEditorController } from '../core/layeredEditorController';
import type { PresentationCoordinator } from './PresentationCoordinator';
import { createDrawingCanvas } from './drawingCanvas';

export type DrawingLayerProps = {
  controller: LayeredEditorController;
  presentation: PresentationCoordinator;
};

export function DrawingLayer({ controller, presentation }: DrawingLayerProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const driver = createDrawingCanvas(canvas.current!, controller, presentation);
    return () => driver.destroy();
  }, [controller, presentation]);
  return (
    <canvas
      ref={canvas}
      data-testid="layered-drawing"
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    />
  );
}
