import { GestureController, GesturePhase, PointerPhase } from '@system-ui-js/multi-drag-core';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { normalizePointerInput } from '../gestures/normalizePointerInput';
import { createGLStrokeRenderer, type GLStrokeRenderer } from '../rendering/glStrokeRenderer';
import {
  appendPoint,
  cancelStroke,
  createStrokeState,
  endStroke,
  startStroke,
  type Stroke,
  type StrokeState,
} from '../state/strokes';

export type HamsterPaintingProps = {
  testID?: string;
  // eslint-disable-next-line no-unused-vars
  onStrokeCountChange?: (count: number) => void;
};

export type DrawingSurfaceProps = HamsterPaintingProps;

const surfaceStyle: React.CSSProperties = {
  flex: 1,
  position: 'relative',
  touchAction: 'none',
};

const canvasStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'block',
};

function getRenderableStrokes(state: StrokeState): Stroke[] {
  return state.activeStroke ? [...state.strokes, state.activeStroke] : state.strokes;
}

export default function HamsterPainting({ testID, onStrokeCountChange }: HamsterPaintingProps) {
  const controllerRef = useRef<GestureController | null>(null);
  const rendererRef = useRef<GLStrokeRenderer | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dimensionsRef = useRef({ width: 0, height: 0 });
  const strokeCountRef = useRef(0);
  const [strokeState, setStrokeState] = useState<StrokeState>(() => createStrokeState());

  if (!controllerRef.current) {
    controllerRef.current = new GestureController({
      features: { drag: true, rotate: false, scale: false },
    });
  }

  const updateStrokeState = useCallback(
    (/* eslint-disable-line */ updater: (current: StrokeState) => StrokeState) => {
      setStrokeState((current) => updater(current));
    },
    []
  );

  const updateDimensions = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const { width, height } = container.getBoundingClientRect();
    dimensionsRef.current = { width, height };
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = width;
      canvas.height = height;
    }
    rendererRef.current?.setDimensions(width, height);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    rendererRef.current?.cleanup();

    const renderer = createGLStrokeRenderer(ctx);
    rendererRef.current = renderer;
    updateDimensions();
    renderer.updateStrokes(getRenderableStrokes(strokeState));
    renderer.start();

    const resizeObserver = new ResizeObserver(updateDimensions);
    const container = containerRef.current;
    if (container) resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [updateDimensions, strokeState]);

  const processPointerEvent = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, pointerPhase: PointerPhase) => {
      const controller = controllerRef.current;

      if (!controller) {
        return;
      }

      const normalizedInput = normalizePointerInput(event, pointerPhase);
      const { width, height } = dimensionsRef.current;
      const snapshot = controller.process(normalizedInput, {
        features: { drag: true, rotate: false, scale: false },
        pose: {
          position: { x: 0, y: 0 },
          width,
          height,
        },
      });

      updateStrokeState((current) => {
        if (snapshot.phase === GesturePhase.Start) {
          return startStroke(current, normalizedInput.point.x, normalizedInput.point.y);
        }

        if (snapshot.phase === GesturePhase.Move) {
          return appendPoint(current, normalizedInput.point.x, normalizedInput.point.y);
        }

        if (snapshot.phase === GesturePhase.End) {
          return endStroke(current);
        }

        if (snapshot.phase === GesturePhase.Cancel) {
          return cancelStroke(current);
        }

        return current;
      });
    },
    [updateStrokeState]
  );

  useEffect(() => {
    rendererRef.current?.updateStrokes(getRenderableStrokes(strokeState));

    if (strokeState.strokeCount !== strokeCountRef.current) {
      strokeCountRef.current = strokeState.strokeCount;
      onStrokeCountChange?.(strokeState.strokeCount);
    }
  }, [onStrokeCountChange, strokeState]);

  useEffect(() => {
    return () => {
      controllerRef.current?.reset();
      rendererRef.current?.cleanup();
      rendererRef.current = null;
    };
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      processPointerEvent(event, PointerPhase.Start);
    },
    [processPointerEvent]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      processPointerEvent(event, PointerPhase.Move);
    },
    [processPointerEvent]
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      processPointerEvent(event, PointerPhase.End);
    },
    [processPointerEvent]
  );

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      processPointerEvent(event, PointerPhase.Cancel);
    },
    [processPointerEvent]
  );

  return (
    <div
      ref={containerRef}
      data-testid={testID}
      style={surfaceStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <canvas ref={canvasRef} style={canvasStyle} />
    </div>
  );
}

export { HamsterPainting as DrawingSurface };
