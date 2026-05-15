/// <reference path="../multi-drag.d.ts" />

import { Drag, DragOperationType } from '@system-ui-js/multi-drag';
import { useCallback, useEffect, useRef, useState } from 'react';
import { appendPoint, createStroke, isValidStroke, pointsToPolyline } from '../stroke-helpers';

// Public drawing contract types
export type DrawingTool = 'pen' | 'line' | 'rect';

export type DrawingPoint = {
  x: number;
  y: number;
};

export type DrawingStroke = {
  id: string;
  tool: DrawingTool;
  points: DrawingPoint[];
};

export type DrawingValue = {
  strokes: DrawingStroke[];
};

export type DrawingSurfaceProps = {
  /** The drawing tool to use. Defaults to 'pen'. */
  tool?: DrawingTool;
  /** Controlled drawing value. */
  value?: DrawingValue;
  /** Initial drawing value for uncontrolled usage. */
  defaultValue?: DrawingValue;
  /** Callback fired when drawing changes (controlled mode). */
  onChange?: (nextValue: DrawingValue) => void;
  /** Stroke color. Defaults to 'black'. Invalid/empty values resolve to 'black'. */
  strokeColor?: string;
  /** Stroke width. Defaults to 2. Non-finite or < 1 values resolve to 2. */
  strokeWidth?: number;
  /** Test identifier. */
  testID?: string;
};

type DragInputEvent = {
  pointerType?: string;
  button?: number;
  clientX?: number;
  clientY?: number;
};

type DragPathItem = {
  point: DrawingPoint;
  event?: DragInputEvent;
};

type DragFinger = {
  getPath: () => DragPathItem[];
};

function isDrawingToolSupported(tool: unknown): tool is DrawingTool {
  return tool === 'pen' || tool === 'line' || tool === 'rect';
}

function isDrawingInput(event: DragInputEvent | undefined): boolean {
  if (!event) {
    return false;
  }

  if (event.pointerType === 'pen') {
    return true;
  }

  if (event.pointerType !== undefined && event.pointerType !== 'mouse') {
    return false;
  }

  return event.button === 0;
}

export function DrawingSurface(props: DrawingSurfaceProps) {
  const { tool, value, defaultValue, onChange, strokeColor, strokeWidth, testID } = props;
  const hostRef = useRef<HTMLDivElement>(null);

  const effectiveTool: DrawingTool = isDrawingToolSupported(tool) ? tool : 'pen';
  const isDrawingEnabled = tool === undefined || isDrawingToolSupported(tool);

  const resolvedColor = strokeColor && strokeColor.trim() !== '' ? strokeColor : 'black';
  const resolvedWidth = typeof strokeWidth === 'number' && Number.isFinite(strokeWidth) && strokeWidth >= 1 ? strokeWidth : 2;

  const isControlled = value !== undefined;
  const [internalStrokes, setInternalStrokes] = useState<DrawingStroke[]>(defaultValue?.strokes ?? []);

  const strokes = isControlled ? value?.strokes ?? [] : internalStrokes;
  const [activeStroke, setActiveStroke] = useState<DrawingStroke | null>(null);
  const activeStrokeRef = useRef<DrawingStroke | null>(null);
  const isDrawingRef = useRef(false);
  const processedPathLengthRef = useRef(0);
  const effectiveToolRef = useRef(effectiveTool);
  const isDrawingEnabledRef = useRef(isDrawingEnabled);
  const isControlledRef = useRef(isControlled);
  const valueRef = useRef(value);
  const previousValueRef = useRef(value);
  const onChangeRef = useRef(onChange);

  effectiveToolRef.current = effectiveTool;
  isDrawingEnabledRef.current = isDrawingEnabled;
  isControlledRef.current = isControlled;
  valueRef.current = value;
  onChangeRef.current = onChange;

  const getLocalCoordinates = useCallback(
    (clientX: number, clientY: number): DrawingPoint => {
      if (!hostRef.current) {
        return { x: 0, y: 0 };
      }
      const rect = hostRef.current.getBoundingClientRect();
      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
      };
    },
    []
  );

  const clearActiveStroke = useCallback(() => {
    activeStrokeRef.current = null;
    isDrawingRef.current = false;
    processedPathLengthRef.current = 0;
    setActiveStroke(null);
  }, []);

  useEffect(() => {
    if (previousValueRef.current !== value && isControlled && isDrawingRef.current) {
      clearActiveStroke();
    }
    previousValueRef.current = value;
  }, [clearActiveStroke, isControlled, value]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }

    const drag = new Drag(host, {
      maxFingerCount: 1,
      getPose: () => ({ position: { x: 0, y: 0 }, width: 0, height: 0 }),
      setPose: () => {},
    });

    drag.addEventListener(DragOperationType.Move, (fingers: DragFinger[]) => {
      if (!isDrawingEnabledRef.current) {
        clearActiveStroke();
        return;
      }

      if (fingers.length !== 1) {
        if (fingers.length > 1) {
          clearActiveStroke();
        }
        return;
      }

      const finger = fingers[0];
      const path = finger.getPath();
      const firstPathItem = path[0];

      if (!firstPathItem || !isDrawingInput(firstPathItem.event)) {
        clearActiveStroke();
        return;
      }

      let nextStroke = activeStrokeRef.current;
      if (!nextStroke) {
        nextStroke = createStroke(effectiveToolRef.current);
        activeStrokeRef.current = nextStroke;
        isDrawingRef.current = true;
        processedPathLengthRef.current = 0;
      }

      for (const pathItem of path.slice(processedPathLengthRef.current)) {
        const sourcePoint =
          pathItem.event?.clientX !== undefined && pathItem.event.clientY !== undefined
            ? { x: pathItem.event.clientX, y: pathItem.event.clientY }
            : pathItem.point;
        nextStroke = appendPoint(nextStroke, getLocalCoordinates(sourcePoint.x, sourcePoint.y));
      }

      processedPathLengthRef.current = path.length;
      activeStrokeRef.current = nextStroke;
      setActiveStroke(nextStroke);
    });

    drag.addEventListener(DragOperationType.AllEnd, (fingers: DragFinger[]) => {
      if (fingers.length > 1) {
        clearActiveStroke();
        return;
      }

      const stroke = activeStrokeRef.current;
      if (stroke && isValidStroke(stroke)) {
        if (isControlledRef.current) {
          onChangeRef.current?.({ strokes: [...(valueRef.current?.strokes ?? []), stroke] });
        } else {
          setInternalStrokes((currentStrokes) => {
            const nextStrokes = [...currentStrokes, stroke];
            onChangeRef.current?.({ strokes: nextStrokes });
            return nextStrokes;
          });
        }
      }

      clearActiveStroke();
    });

    return () => {
      drag.destroy();
    };
  }, [clearActiveStroke, getLocalCoordinates]);

  return (
    <div
      ref={hostRef}
      data-testid={testID}
      data-tool={effectiveTool}
      data-enabled={String(isDrawingEnabled)}
      style={{
        width: '100%',
        height: '100%',
        minHeight: '200px',
        border: '1px solid #ccc',
        position: 'relative',
        touchAction: 'none',
      }}
    >
      <svg
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
        }}
      >
        <title>Drawing surface</title>
        {strokes.map((stroke) => {
          if (stroke.points.length === 0) {
            return null;
          }
          const first = stroke.points[0];
          const last = stroke.points[stroke.points.length - 1];
          if (stroke.tool === 'rect') {
            const x = Math.min(first.x, last.x);
            const y = Math.min(first.y, last.y);
            const width = Math.abs(last.x - first.x);
            const height = Math.abs(last.y - first.y);
            return (
              <rect
                key={stroke.id}
                x={x}
                y={y}
                width={width}
                height={height}
                fill="none"
                stroke={resolvedColor}
                strokeWidth={resolvedWidth}
              />
            );
          }
          if (stroke.tool === 'line') {
            return (
              <line
                key={stroke.id}
                x1={first.x}
                y1={first.y}
                x2={last.x}
                y2={last.y}
                fill="none"
                stroke={resolvedColor}
                strokeWidth={resolvedWidth}
                strokeLinecap="round"
              />
            );
          }
          return (
            <polyline
              key={stroke.id}
              points={pointsToPolyline(stroke.points)}
              fill="none"
              stroke={resolvedColor}
              strokeWidth={resolvedWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}

        {activeStroke && activeStroke.points.length > 0 && (
          activeStroke.tool === 'rect' ? (() => {
            const first = activeStroke.points[0];
            const last = activeStroke.points[activeStroke.points.length - 1];
            const x = Math.min(first.x, last.x);
            const y = Math.min(first.y, last.y);
            const width = Math.abs(last.x - first.x);
            const height = Math.abs(last.y - first.y);
            return (
              <rect
                x={x}
                y={y}
                width={width}
                height={height}
                fill="none"
                stroke={resolvedColor}
                strokeWidth={resolvedWidth}
                opacity="0.7"
              />
            );
          })() : activeStroke.tool === 'line' ? (() => {
            const first = activeStroke.points[0];
            const last = activeStroke.points[activeStroke.points.length - 1];
            return (
              <line
                x1={first.x}
                y1={first.y}
                x2={last.x}
                y2={last.y}
                fill="none"
                stroke={resolvedColor}
                strokeWidth={resolvedWidth}
                strokeLinecap="round"
                opacity="0.7"
              />
            );
          })() : (
            <polyline
              points={pointsToPolyline(activeStroke.points)}
              fill="none"
              stroke={resolvedColor}
              strokeWidth={resolvedWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.7"
            />
          )
        )}
      </svg>
    </div>
  );
}
