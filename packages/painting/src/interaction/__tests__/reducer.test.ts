import type { InteractionState, InteractionTool } from '../reducer';
import { createInitialState, interactionReducer, isValidCompletion } from '../reducer';

const point = (x: number, y: number) => ({ x, y });

function enterFromIdle(tool: InteractionTool, firstPoint = point(0, 0), mode?: 'drag' | 'place') {
  return interactionReducer(createInitialState(tool), {
    type: 'POINTER_DOWN',
    point: firstPoint,
    mode,
  });
}

describe('interactionReducer', () => {
  it('creates an idle initial state for the requested tool', () => {
    expect(createInitialState('pen')).toEqual({ phase: 'idle', tool: 'pen' });
  });

  it('enters drawingPen from idle on pointer down', () => {
    const state = enterFromIdle('pen', point(10, 20));

    expect(state).toEqual({
      phase: 'drawingPen',
      tool: 'pen',
      points: [point(10, 20)],
      cursorPoint: point(10, 20),
      shiftHeld: false,
      pointerId: undefined,
    });
  });

  it('appends canvas-local points while drawingPen moves', () => {
    const state = interactionReducer(enterFromIdle('pen', point(10, 20)), {
      type: 'POINTER_MOVE',
      point: point(12, 24),
    });

    expect(state).toMatchObject({
      phase: 'drawingPen',
      points: [point(10, 20), point(12, 24)],
      cursorPoint: point(12, 24),
    });
  });

  it('returns to idle with a commit signal when drawingPen completes on pointer up', () => {
    const drawing = interactionReducer(enterFromIdle('pen', point(10, 20)), {
      type: 'POINTER_MOVE',
      point: point(12, 24),
    });

    const state = interactionReducer(drawing, { type: 'POINTER_UP' });

    expect(state).toEqual({
      phase: 'idle',
      tool: 'pen',
      completedStroke: {
        tool: 'pen',
        points: [point(10, 20), point(12, 24)],
      },
    });
  });

  it.each(['line', 'rect', 'ellipse'] as const)(
    'enters drawingDragShape for %s from idle',
    (tool) => {
      const state = enterFromIdle(tool, point(3, 4));

      expect(state).toEqual({
        phase: 'drawingDragShape',
        tool,
        startPoint: point(3, 4),
        cursorPoint: point(3, 4),
        shiftHeld: false,
        pointerId: undefined,
      });
    },
  );

  it('enters placingPolygon from idle with the first vertex', () => {
    const state = enterFromIdle('polygon', point(1, 2));

    expect(state).toEqual({
      phase: 'placingPolygon',
      tool: 'polygon',
      vertices: [point(1, 2)],
      cursorPoint: point(1, 2),
      shiftHeld: false,
    });
  });

  it('appends vertices while placingPolygon receives pointer down actions', () => {
    const state = interactionReducer(enterFromIdle('polygon', point(1, 2)), {
      type: 'POINTER_DOWN',
      point: point(10, 20),
    });

    expect(state).toMatchObject({
      phase: 'placingPolygon',
      vertices: [point(1, 2), point(10, 20)],
      cursorPoint: point(10, 20),
    });
  });

  it('commits polygon when clicking within 10 canvas px of the first vertex after three distinct vertices', () => {
    const first = enterFromIdle('polygon', point(0, 0));
    const second = interactionReducer(first, { type: 'POINTER_DOWN', point: point(30, 0) });
    const third = interactionReducer(second, { type: 'POINTER_DOWN', point: point(30, 30) });

    const state = interactionReducer(third, { type: 'POINTER_DOWN', point: point(2, 2) });

    expect(state).toEqual({
      phase: 'idle',
      tool: 'polygon',
      completedStroke: {
        tool: 'polygon',
        points: [point(0, 0), point(30, 0), point(30, 30)],
      },
    });
  });

  it('does not commit polygon close clicks before three distinct vertices', () => {
    const first = enterFromIdle('polygon', point(0, 0));
    const second = interactionReducer(first, { type: 'POINTER_DOWN', point: point(30, 0) });

    const state = interactionReducer(second, { type: 'POINTER_DOWN', point: point(2, 2) });

    expect(state).toEqual({
      phase: 'placingPolygon',
      tool: 'polygon',
      vertices: [point(0, 0), point(30, 0), point(2, 2)],
      cursorPoint: point(2, 2),
      shiftHeld: false,
    });
  });

  it('cancels in-progress polygon without commit on tool change', () => {
    const polygon = interactionReducer(enterFromIdle('polygon', point(0, 0)), {
      type: 'POINTER_DOWN',
      point: point(30, 0),
    });

    const state = interactionReducer(polygon, { type: 'TOOL_CHANGE', tool: 'bezier' });

    expect(state).toEqual({ phase: 'idle', tool: 'bezier' });
  });

  it.each([
    ['drawingPen', enterFromIdle('pen')],
    ['drawingDragShape', enterFromIdle('rect')],
    ['placingPolygon', enterFromIdle('polygon')],
    ['placingLine', enterFromIdle('line', point(0, 0), 'place')],
    ['placingBezier', enterFromIdle('bezier')],
    [
      'panning',
      interactionReducer(createInitialState('pen'), {
        type: 'POINTER_DOWN',
        gesture: 'pan',
        viewport: { scale: 1, tx: 0, ty: 0 },
        point: point(4, 5),
      }),
    ],
    [
      'pinching',
      interactionReducer(createInitialState('pen'), {
        type: 'POINTER_DOWN',
        gesture: 'pinch',
        viewport: { scale: 1, tx: 0, ty: 0 },
        pointerIds: [1, 2],
        centroid: point(4, 5),
      }),
    ],
  ] as Array<[string, InteractionState]>)(
    'Escape cancels %s back to idle with no commit',
    (_phase, inProgress) => {
      const state = interactionReducer(inProgress, { type: 'KEY_DOWN', key: 'Escape' });

      expect(state).toEqual({ phase: 'idle', tool: inProgress.tool });
    },
  );

  it.each([
    ['drawingPen', enterFromIdle('pen')],
    ['drawingDragShape', enterFromIdle('ellipse')],
    ['placingPolygon', enterFromIdle('polygon')],
    ['placingLine', enterFromIdle('line', point(0, 0), 'place')],
    ['placingBezier', enterFromIdle('bezier')],
  ] as Array<[string, InteractionState]>)(
    'window blur cancels %s back to idle with no commit',
    (_phase, inProgress) => {
      const state = interactionReducer(inProgress, { type: 'BLUR' });

      expect(state).toEqual({ phase: 'idle', tool: inProgress.tool });
    },
  );

  it('reset request cancels in-progress drawing and surfaces a viewport reset signal', () => {
    const state = interactionReducer(enterFromIdle('pen'), { type: 'RESET_REQUEST' });

    expect(state).toEqual({ phase: 'idle', tool: 'pen', shouldResetViewport: true });
  });

  it('commits continuous placingLine with three vertices on double-click finish', () => {
    const first = enterFromIdle('line', point(0, 0), 'place');
    const second = interactionReducer(first, { type: 'POINTER_DOWN', point: point(10, 0) });
    const third = interactionReducer(second, { type: 'POINTER_DOWN', point: point(20, 10) });

    const state = interactionReducer(third, { type: 'POINTER_DOWN', detail: 2 });

    expect(state).toEqual({
      phase: 'idle',
      tool: 'line',
      completedStroke: {
        tool: 'line',
        points: [point(0, 0), point(10, 0), point(20, 10)],
      },
    });
  });

  it('cancels single-vertex placingLine on Escape with no commit', () => {
    const state = interactionReducer(enterFromIdle('line', point(0, 0), 'place'), {
      type: 'KEY_DOWN',
      key: 'Escape',
    });

    expect(state).toEqual({ phase: 'idle', tool: 'line' });
  });

  it('Bezier drag 1 commits start/end line state without completed stroke', () => {
    const started = enterFromIdle('bezier', point(0, 0));
    const preview = interactionReducer(started, { type: 'POINTER_MOVE', point: point(30, 30) });

    const state = interactionReducer(preview, { type: 'POINTER_UP', point: point(30, 30) });

    expect(state).toEqual({
      phase: 'placingBezier',
      tool: 'bezier',
      creationPhase: 'control1',
      points: [point(0, 0), undefined, undefined, point(30, 30)],
      cursorPoint: point(30, 30),
      pointerId: undefined,
      dragging: false,
      shiftHeld: false,
    });
    expect(state).not.toHaveProperty('completedStroke');
  });

  it('Bezier drag 2 commits cp1 while cp2 remains unknown without completed stroke', () => {
    const lineCommitted = interactionReducer(
      interactionReducer(enterFromIdle('bezier', point(0, 0)), { type: 'POINTER_MOVE', point: point(30, 30) }),
      { type: 'POINTER_UP', point: point(30, 30) },
    );
    const controlStarted = interactionReducer(lineCommitted, { type: 'POINTER_DOWN', point: point(10, 0) });
    const controlPreview = interactionReducer(controlStarted, { type: 'POINTER_MOVE', point: point(12, 2) });

    const state = interactionReducer(controlPreview, { type: 'POINTER_UP', point: point(12, 2) });

    expect(state).toEqual({
      phase: 'placingBezier',
      tool: 'bezier',
      creationPhase: 'control2',
      points: [point(0, 0), point(12, 2), undefined, point(30, 30)],
      cursorPoint: point(12, 2),
      pointerId: undefined,
      dragging: false,
      shiftHeld: false,
    });
    expect(state).not.toHaveProperty('completedStroke');
  });

  it('Bezier drag 3 completes with start/cp1/cp2/end order and keeps bezier active', () => {
    const lineCommitted = interactionReducer(
      interactionReducer(enterFromIdle('bezier', point(0, 0)), { type: 'POINTER_MOVE', point: point(30, 30) }),
      { type: 'POINTER_UP', point: point(30, 30) },
    );
    const control1Committed = interactionReducer(
      interactionReducer(lineCommitted, { type: 'POINTER_DOWN', point: point(10, 0) }),
      { type: 'POINTER_UP', point: point(10, 0) },
    );
    const control2Preview = interactionReducer(
      interactionReducer(control1Committed, { type: 'POINTER_DOWN', point: point(20, 10) }),
      { type: 'POINTER_MOVE', point: point(22, 12) },
    );

    const state = interactionReducer(control2Preview, { type: 'POINTER_UP', point: point(22, 12) });

    expect(state).toEqual({
      phase: 'idle',
      tool: 'bezier',
      completedStroke: {
        tool: 'bezier',
        points: [point(0, 0), point(10, 0), point(22, 12), point(30, 30)],
      },
    });
  });

  it.each([
    ['Escape', { type: 'KEY_DOWN', key: 'Escape' }],
    ['blur', { type: 'BLUR' }],
    ['tool change', { type: 'TOOL_CHANGE', tool: 'pen' }],
    ['pointer cancel', { type: 'POINTER_CANCEL' }],
  ] as const)('cancels partial Bezier on %s with no commit', (_label, action) => {
    const partial = interactionReducer(
      interactionReducer(enterFromIdle('bezier', point(0, 0)), { type: 'POINTER_MOVE', point: point(30, 30) }),
      { type: 'POINTER_UP', point: point(30, 30) },
    );

    const state = interactionReducer(partial, action);

    expect(state).toEqual({ phase: 'idle', tool: action.type === 'TOOL_CHANGE' ? 'pen' : 'bezier' });
  });

  it('updates and clears shiftHeld on drawable in-progress states', () => {
    const shifted = interactionReducer(enterFromIdle('rect', point(1, 1)), {
      type: 'SHIFT_CHANGE',
      held: true,
    });
    const cleared = interactionReducer(shifted, { type: 'SHIFT_CHANGE', held: false });

    expect(shifted).toMatchObject({ phase: 'drawingDragShape', shiftHeld: true });
    expect(cleared).toMatchObject({ phase: 'drawingDragShape', shiftHeld: false });
  });

  it('reports valid completion for polygon, line, and Bezier minimum geometry', () => {
    const validPolygon: InteractionState = {
      phase: 'placingPolygon',
      tool: 'polygon',
      vertices: [point(0, 0), point(10, 0), point(10, 10)],
      shiftHeld: false,
    };
    const duplicatePolygon: InteractionState = {
      phase: 'placingPolygon',
      tool: 'polygon',
      vertices: [point(0, 0), point(10, 0), point(10, 0)],
      shiftHeld: false,
    };
    const validLine: InteractionState = {
      phase: 'placingLine',
      tool: 'line',
      vertices: [point(0, 0), point(10, 0)],
      shiftHeld: false,
    };
    const invalidLine: InteractionState = {
      phase: 'placingLine',
      tool: 'line',
      vertices: [point(0, 0)],
      shiftHeld: false,
    };
    const validBezier: InteractionState = {
      phase: 'placingBezier',
      tool: 'bezier',
      creationPhase: 'control2',
      points: [point(0, 0), point(10, 0), point(20, 10), point(30, 30)],
      dragging: false,
      shiftHeld: false,
    };
    const invalidBezier: InteractionState = {
      phase: 'placingBezier',
      tool: 'bezier',
      creationPhase: 'control2',
      points: [point(0, 0), point(10, 0), undefined, undefined],
      dragging: false,
      shiftHeld: false,
    };

    expect(isValidCompletion(validPolygon)).toBe(true);
    expect(isValidCompletion(duplicatePolygon)).toBe(false);
    expect(isValidCompletion(validLine)).toBe(true);
    expect(isValidCompletion(invalidLine)).toBe(false);
    expect(isValidCompletion(validBezier)).toBe(true);
    expect(isValidCompletion(invalidBezier)).toBe(false);
  });
});
