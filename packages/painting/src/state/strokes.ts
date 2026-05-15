export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  id: string;
  points: Point[];
  finalized: boolean;
}

export interface StrokeState {
  strokes: Stroke[];
  activeStroke: Stroke | null;
  strokeCount: number;
}

let strokeIdCounter = 0;

function nextStrokeId(): string {
  strokeIdCounter += 1;
  return `stroke-${strokeIdCounter}`;
}

export function createStrokeState(): StrokeState {
  return {
    strokes: [],
    activeStroke: null,
    strokeCount: 0,
  };
}

export function startStroke(state: StrokeState, x: number, y: number): StrokeState {
  const stroke: Stroke = {
    id: nextStrokeId(),
    points: [{ x, y }],
    finalized: false,
  };

  return {
    ...state,
    activeStroke: stroke,
  };
}

export function appendPoint(state: StrokeState, x: number, y: number): StrokeState {
  if (!state.activeStroke) {
    return state;
  }

  const updatedActiveStroke: Stroke = {
    ...state.activeStroke,
    points: [...state.activeStroke.points, { x, y }],
  };

  return {
    ...state,
    activeStroke: updatedActiveStroke,
  };
}

export function endStroke(state: StrokeState): StrokeState {
  if (!state.activeStroke) {
    return state;
  }

  if (state.activeStroke.points.length <= 1) {
    return {
      ...state,
      activeStroke: null,
    };
  }

  const finalizedStroke: Stroke = {
    ...state.activeStroke,
    finalized: true,
  };

  return {
    ...state,
    strokes: [...state.strokes, finalizedStroke],
    activeStroke: null,
    strokeCount: state.strokeCount + 1,
  };
}

export function cancelStroke(state: StrokeState): StrokeState {
  if (!state.activeStroke) {
    return state;
  }

  return {
    ...state,
    activeStroke: null,
  };
}

export function getAllPoints(state: StrokeState): Point[] {
  const committedPoints = state.strokes.flatMap((stroke) => stroke.points);
  const activePoints = state.activeStroke ? state.activeStroke.points : [];
  return [...committedPoints, ...activePoints];
}
