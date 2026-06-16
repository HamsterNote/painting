import { assertNever } from '../model/assertNever';
import type { DrawingPointV2, DrawingStrokeToolV2, DrawingToolModeV2 } from '../model/strokes';
import type { DrawingViewport } from '../viewport';

export type CanvasPoint = Pick<DrawingPointV2, 'x' | 'y'>;
export type InteractionTool = DrawingToolModeV2;
export type DragShapeTool = 'line' | 'rect' | 'ellipse';
export type BezierControlPoints = [
  start?: CanvasPoint,
  cp1?: CanvasPoint,
  cp2?: CanvasPoint,
  end?: CanvasPoint,
];

export type CompletedInteractionStroke = {
  tool: DrawingStrokeToolV2;
  points: CanvasPoint[];
};

export type IdleInteractionState = {
  phase: 'idle';
  tool: InteractionTool;
  completedStroke?: CompletedInteractionStroke;
  shouldResetViewport?: true;
};

export type DrawingPenInteractionState = {
  phase: 'drawingPen';
  tool: 'pen';
  pointerId?: number;
  points: CanvasPoint[];
  cursorPoint: CanvasPoint;
  shiftHeld: boolean;
};

export type DrawingDragShapeInteractionState = {
  phase: 'drawingDragShape';
  tool: DragShapeTool;
  pointerId?: number;
  startPoint: CanvasPoint;
  cursorPoint: CanvasPoint;
  shiftHeld: boolean;
};

export type PlacingPolygonInteractionState = {
  phase: 'placingPolygon';
  tool: 'polygon';
  vertices: CanvasPoint[];
  cursorPoint?: CanvasPoint;
  shiftHeld: boolean;
};

export type PlacingLineInteractionState = {
  phase: 'placingLine';
  tool: 'line';
  vertices: CanvasPoint[];
  cursorPoint?: CanvasPoint;
  shiftHeld: boolean;
};

export type BezierCreationPhase = 'line' | 'control1' | 'control2';

export type PlacingBezierInteractionState = {
  phase: 'placingBezier';
  tool: 'bezier';
  creationPhase: BezierCreationPhase;
  points: BezierControlPoints;
  cursorPoint?: CanvasPoint;
  pointerId?: number;
  dragging: boolean;
  shiftHeld: boolean;
};

export type PanningInteractionState = {
  phase: 'panning';
  tool: InteractionTool;
  viewport: DrawingViewport;
  pointerId?: number;
  centroid: CanvasPoint;
};

export type PinchingInteractionState = {
  phase: 'pinching';
  tool: InteractionTool;
  viewport: DrawingViewport;
  pointerIds: readonly [number, number];
  centroid: CanvasPoint;
};

export type InteractionState =
  | IdleInteractionState
  | DrawingPenInteractionState
  | DrawingDragShapeInteractionState
  | PlacingPolygonInteractionState
  | PlacingLineInteractionState
  | PlacingBezierInteractionState
  | PanningInteractionState
  | PinchingInteractionState;

export type PointerDownInteractionAction = {
  type: 'POINTER_DOWN';
  point?: CanvasPoint;
  pointerId?: number;
  detail?: number;
  mode?: 'drag' | 'place';
  gesture?: 'pan' | 'pinch';
  viewport?: DrawingViewport;
  pointerIds?: readonly [number, number];
  centroid?: CanvasPoint;
};

export type PointerMoveInteractionAction = {
  type: 'POINTER_MOVE';
  point?: CanvasPoint;
  pointerId?: number;
  viewport?: DrawingViewport;
  centroid?: CanvasPoint;
};

export type PointerUpInteractionAction = {
  type: 'POINTER_UP';
  point?: CanvasPoint;
  pointerId?: number;
  detail?: number;
};

export type InteractionAction =
  | PointerDownInteractionAction
  | PointerMoveInteractionAction
  | PointerUpInteractionAction
  | { type: 'POINTER_CANCEL'; pointerId?: number }
  | { type: 'KEY_DOWN'; key: string }
  | { type: 'TOOL_CHANGE'; tool: InteractionTool }
  | { type: 'BLUR' }
  | { type: 'RESET_REQUEST' }
  | { type: 'SHIFT_CHANGE'; held: boolean };

const POLYGON_CLOSE_RADIUS = 10;

export function createInitialState(tool: InteractionTool): InteractionState {
  return { phase: 'idle', tool };
}

export function isValidCompletion(state: InteractionState): boolean {
  switch (state.phase) {
    case 'idle':
      return state.completedStroke !== undefined && hasDistinctPointCount(state.completedStroke.points, 2);
    case 'drawingPen':
      return hasDistinctPointCount(state.points, 2);
    case 'drawingDragShape':
      return hasDistinctPointCount([state.startPoint, state.cursorPoint], 2);
    case 'placingPolygon':
      return hasDistinctPointCount(state.vertices, 3);
    case 'placingLine':
      return hasDistinctPointCount(state.vertices, 2);
    case 'placingBezier':
      return isCompleteBezierPoints(state.points);
    case 'panning':
    case 'pinching':
      return false;
    default:
      return assertNever(state);
  }
}

export function interactionReducer(
  state: InteractionState,
  action: InteractionAction,
): InteractionState {
  switch (action.type) {
    case 'TOOL_CHANGE':
      if (state.phase === 'placingLine' && isValidCompletion(state)) {
        return completedIdle(action.tool, { tool: 'line', points: state.vertices });
      }
      return createInitialState(action.tool);
    case 'BLUR':
      return createInitialState(state.tool);
    case 'RESET_REQUEST':
      return { phase: 'idle', tool: state.tool, shouldResetViewport: true };
    case 'KEY_DOWN':
      if (action.key === 'Escape' && state.phase === 'placingLine') {
        return isValidCompletion(state)
          ? completedIdle(state.tool, { tool: 'line', points: state.vertices })
          : createInitialState(state.tool);
      }
      if (action.key === 'Escape' && state.phase !== 'idle') {
        return createInitialState(state.tool);
      }
      return state;
    case 'POINTER_CANCEL':
      return state.phase === 'idle' ? state : createInitialState(state.tool);
    case 'SHIFT_CHANGE':
      return setShiftHeld(state, action.held);
    case 'POINTER_DOWN':
      return reducePointerDown(state, action);
    case 'POINTER_MOVE':
      return reducePointerMove(state, action);
    case 'POINTER_UP':
      return reducePointerUp(state, action);
    default:
      return assertNever(action);
  }
}

function reducePointerDown(
  state: InteractionState,
  action: PointerDownInteractionAction,
): InteractionState {
  if (state.phase === 'idle') {
    return enterFromIdle(state, action);
  }

  switch (state.phase) {
    case 'drawingPen':
    case 'drawingDragShape':
    case 'panning':
    case 'pinching':
      return state;
    case 'placingPolygon':
      return reducePolygonPointerDown(state, action);
    case 'placingLine':
      return reduceLinePointerDown(state, action);
    case 'placingBezier':
      return reduceBezierPointerDown(state, action);
    default:
      return assertNever(state);
  }
}

function enterFromIdle(
  state: IdleInteractionState,
  action: PointerDownInteractionAction,
): InteractionState {
  if (action.gesture === 'pan' && action.viewport && (action.point || action.centroid)) {
    const centroid = action.centroid ?? action.point;
    if (!centroid) {
      return state;
    }

    return {
      phase: 'panning',
      tool: state.tool,
      viewport: action.viewport,
      pointerId: action.pointerId,
      centroid: clonePoint(centroid),
    };
  }

  if (action.gesture === 'pinch' && action.viewport && action.pointerIds && (action.point || action.centroid)) {
    const centroid = action.centroid ?? action.point;
    if (!centroid) {
      return state;
    }

    return {
      phase: 'pinching',
      tool: state.tool,
      viewport: action.viewport,
      pointerIds: action.pointerIds,
      centroid: clonePoint(centroid),
    };
  }

  if (!action.point) {
    return state;
  }

  const point = clonePoint(action.point);

  switch (state.tool) {
    case 'pen':
      return {
        phase: 'drawingPen',
        tool: 'pen',
        pointerId: action.pointerId,
        points: [point],
        cursorPoint: point,
        shiftHeld: false,
      };
    case 'line':
      if (action.mode === 'place') {
        return {
          phase: 'placingLine',
          tool: 'line',
          vertices: [point],
          cursorPoint: point,
          shiftHeld: false,
        };
      }
      return {
        phase: 'drawingDragShape',
        tool: 'line',
        pointerId: action.pointerId,
        startPoint: point,
        cursorPoint: point,
        shiftHeld: false,
      };
    case 'rect':
    case 'ellipse':
      return {
        phase: 'drawingDragShape',
        tool: state.tool,
        pointerId: action.pointerId,
        startPoint: point,
        cursorPoint: point,
        shiftHeld: false,
      };
    case 'polygon':
      return {
        phase: 'placingPolygon',
        tool: 'polygon',
        vertices: [point],
        cursorPoint: point,
        shiftHeld: false,
      };
    case 'bezier':
      return {
        phase: 'placingBezier',
        tool: 'bezier',
        creationPhase: 'line',
        points: [point, undefined, undefined, undefined],
        cursorPoint: point,
        pointerId: action.pointerId,
        dragging: true,
        shiftHeld: false,
      };
    case 'eraser':
      // eraser 和 lasso 由 DrawingSurface 外部处理，reducer 不产生新状态
    case 'lasso':
      return state;
    default:
      return assertNever(state.tool);
  }
}

function reducePointerMove(
  state: InteractionState,
  action: PointerMoveInteractionAction,
): InteractionState {
  switch (state.phase) {
    case 'idle':
      return state;
    case 'drawingPen': {
      if (!isSamePointer(state.pointerId, action.pointerId) || !action.point) {
        return state;
      }

      const nextPoint = clonePoint(action.point);
      return {
        ...state,
        points: appendDistinctPoint(state.points, nextPoint),
        cursorPoint: nextPoint,
      };
    }
    case 'drawingDragShape':
      if (!isSamePointer(state.pointerId, action.pointerId) || !action.point) {
        return state;
      }
      return { ...state, cursorPoint: clonePoint(action.point) };
    case 'placingPolygon':
    case 'placingLine':
      return action.point ? { ...state, cursorPoint: clonePoint(action.point) } : state;
    case 'placingBezier':
      return reduceBezierPointerMove(state, action);
    case 'panning':
      return {
        ...state,
        viewport: action.viewport ?? state.viewport,
        centroid: clonePoint(action.centroid ?? action.point ?? state.centroid),
      };
    case 'pinching':
      return {
        ...state,
        viewport: action.viewport ?? state.viewport,
        centroid: clonePoint(action.centroid ?? action.point ?? state.centroid),
      };
    default:
      return assertNever(state);
  }
}

function reducePointerUp(
  state: InteractionState,
  action: PointerUpInteractionAction,
): InteractionState {
  switch (state.phase) {
    case 'idle':
    case 'placingPolygon':
    case 'placingLine':
      return state;
    case 'placingBezier':
      return reduceBezierPointerUp(state, action);
    case 'drawingPen': {
      if (!isSamePointer(state.pointerId, action.pointerId)) {
        return state;
      }

      const points = action.point
        ? appendDistinctPoint(state.points, clonePoint(action.point))
        : state.points;
      return completeIfValid('pen', points, state.tool);
    }
    case 'drawingDragShape': {
      if (!isSamePointer(state.pointerId, action.pointerId)) {
        return state;
      }

      const cursorPoint = action.point ? clonePoint(action.point) : state.cursorPoint;
      return completeIfValid(state.tool, [state.startPoint, cursorPoint], state.tool);
    }
    case 'panning':
      return isSamePointer(state.pointerId, action.pointerId) ? createInitialState(state.tool) : state;
    case 'pinching':
      return action.pointerId === undefined || state.pointerIds.includes(action.pointerId)
        ? createInitialState(state.tool)
        : state;
    default:
      return assertNever(state);
  }
}

function reducePolygonPointerDown(
  state: PlacingPolygonInteractionState,
  action: PointerDownInteractionAction,
): InteractionState {
  if (action.detail === 2 && isValidCompletion(state)) {
    return completedIdle(state.tool, { tool: 'polygon', points: state.vertices });
  }

  if (!action.point) {
    return state;
  }

  const point = clonePoint(action.point);
  const firstVertex = state.vertices[0];
  if (firstVertex && distance(firstVertex, point) <= POLYGON_CLOSE_RADIUS && isValidCompletion(state)) {
    return completedIdle(state.tool, { tool: 'polygon', points: state.vertices });
  }

  return {
    ...state,
    vertices: [...state.vertices, point],
    cursorPoint: point,
  };
}

function reduceLinePointerDown(
  state: PlacingLineInteractionState,
  action: PointerDownInteractionAction,
): InteractionState {
  if (action.detail === 2 && isValidCompletion(state)) {
    const points = action.point
      ? appendDistinctPoint(state.vertices, clonePoint(action.point))
      : state.vertices;
    return completedIdle(state.tool, { tool: 'line', points });
  }

  if (!action.point) {
    return state;
  }

  const point = clonePoint(action.point);
  return {
    ...state,
    vertices: appendDistinctPoint(state.vertices, point),
    cursorPoint: point,
  };
}

function reduceBezierPointerDown(
  state: PlacingBezierInteractionState,
  action: PointerDownInteractionAction,
): InteractionState {
  if (!action.point || state.dragging) {
    return state;
  }

  return {
    ...state,
    cursorPoint: clonePoint(action.point),
    pointerId: action.pointerId,
    dragging: true,
  };
}

function reduceBezierPointerMove(
  state: PlacingBezierInteractionState,
  action: PointerMoveInteractionAction,
): InteractionState {
  if (!state.dragging || !isSamePointer(state.pointerId, action.pointerId) || !action.point) {
    return state;
  }

  return { ...state, cursorPoint: clonePoint(action.point) };
}

function reduceBezierPointerUp(
  state: PlacingBezierInteractionState,
  action: PointerUpInteractionAction,
): InteractionState {
  if (!state.dragging || !isSamePointer(state.pointerId, action.pointerId)) {
    return state;
  }

  const committedPoint = clonePoint(action.point ?? state.cursorPoint);
  if (!committedPoint) {
    return state;
  }

  switch (state.creationPhase) {
    case 'line': {
      const start = state.points[0];
      if (!start) {
        return state;
      }

      return {
        ...state,
        creationPhase: 'control1',
        points: [clonePoint(start), undefined, undefined, committedPoint],
        cursorPoint: committedPoint,
        pointerId: undefined,
        dragging: false,
      };
    }
    case 'control1': {
      const start = state.points[0];
      const end = state.points[3];
      if (!start || !end) {
        return state;
      }

      return {
        ...state,
        creationPhase: 'control2',
        points: [clonePoint(start), committedPoint, undefined, clonePoint(end)],
        cursorPoint: committedPoint,
        pointerId: undefined,
        dragging: false,
      };
    }
    case 'control2': {
      const start = state.points[0];
      const cp1 = state.points[1];
      const end = state.points[3];
      if (!start || !cp1 || !end) {
        return state;
      }

      return completedIdle(state.tool, {
        tool: 'bezier',
        points: [clonePoint(start), clonePoint(cp1), committedPoint, clonePoint(end)],
      });
    }
    default:
      return assertNever(state.creationPhase);
  }
}

function completeIfValid(
  completedTool: DrawingStrokeToolV2,
  points: CanvasPoint[],
  currentTool: InteractionTool,
): InteractionState {
  return hasDistinctPointCount(points, 2)
    ? completedIdle(currentTool, { tool: completedTool, points })
    : createInitialState(currentTool);
}

function completedIdle(
  currentTool: InteractionTool,
  completedStroke: CompletedInteractionStroke,
): IdleInteractionState {
  return {
    phase: 'idle',
    tool: currentTool,
    completedStroke: {
      tool: completedStroke.tool,
      points: completedStroke.points.map((point) => clonePoint(point)),
    },
  };
}

function setShiftHeld(state: InteractionState, held: boolean): InteractionState {
  switch (state.phase) {
    case 'idle':
    case 'panning':
    case 'pinching':
      return state;
    case 'drawingPen':
    case 'drawingDragShape':
    case 'placingPolygon':
    case 'placingLine':
    case 'placingBezier':
      return { ...state, shiftHeld: held };
    default:
      return assertNever(state);
  }
}

function appendDistinctPoint(points: CanvasPoint[], point: CanvasPoint): CanvasPoint[] {
  const lastPoint = points[points.length - 1];
  if (lastPoint && lastPoint.x === point.x && lastPoint.y === point.y) {
    return points;
  }

  return [...points, point];
}

function hasDistinctPointCount(points: readonly CanvasPoint[], minimumCount: number): boolean {
  return new Set(points.map((point) => `${point.x}:${point.y}`)).size >= minimumCount;
}

function isSamePointer(statePointerId: number | undefined, actionPointerId: number | undefined): boolean {
  return statePointerId === undefined || actionPointerId === undefined || statePointerId === actionPointerId;
}

function clonePoint(point: CanvasPoint): CanvasPoint;
function clonePoint(point: CanvasPoint | undefined): CanvasPoint | undefined;
function clonePoint(point: CanvasPoint | undefined): CanvasPoint | undefined {
  return point ? { x: point.x, y: point.y } : undefined;
}

function distance(a: CanvasPoint, b: CanvasPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isCompleteBezierPoints(points: BezierControlPoints): points is [CanvasPoint, CanvasPoint, CanvasPoint, CanvasPoint] {
  return points.every((point) => point !== undefined);
}
