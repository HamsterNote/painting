import {
  appendPoint,
  cancelStroke,
  createStrokeState,
  endStroke,
  getAllPoints,
  startStroke,
} from '../strokes';

describe('stroke state', () => {
  it('commits a dragged stroke with all points', () => {
    let state = createStrokeState();

    state = startStroke(state, 0, 0);
    state = appendPoint(state, 1, 1);
    state = appendPoint(state, 2, 2);
    state = endStroke(state);

    expect(state.strokes).toHaveLength(1);
    expect(state.strokeCount).toBe(1);
    expect(state.activeStroke).toBeNull();
    expect(state.strokes[0].finalized).toBe(true);
    expect(state.strokes[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
  });

  it('discards tap-only strokes', () => {
    let state = createStrokeState();

    state = startStroke(state, 10, 20);
    state = endStroke(state);

    expect(state.strokes).toHaveLength(0);
    expect(state.strokeCount).toBe(0);
    expect(state.activeStroke).toBeNull();
  });

  it('discards canceled strokes', () => {
    let state = createStrokeState();

    state = startStroke(state, 1, 1);
    state = appendPoint(state, 2, 2);
    state = cancelStroke(state);

    expect(state.strokes).toHaveLength(0);
    expect(state.strokeCount).toBe(0);
    expect(state.activeStroke).toBeNull();
  });

  it('accumulates multiple committed strokes', () => {
    let state = createStrokeState();

    state = startStroke(state, 0, 0);
    state = appendPoint(state, 1, 0);
    state = endStroke(state);

    state = startStroke(state, 5, 5);
    state = appendPoint(state, 6, 6);
    state = appendPoint(state, 7, 7);
    state = endStroke(state);

    expect(state.strokes).toHaveLength(2);
    expect(state.strokeCount).toBe(2);
    expect(state.strokes[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    expect(state.strokes[1].points).toEqual([
      { x: 5, y: 5 },
      { x: 6, y: 6 },
      { x: 7, y: 7 },
    ]);
  });

  it('returns active and committed points while drawing', () => {
    let state = createStrokeState();

    state = startStroke(state, 1, 1);
    state = appendPoint(state, 2, 2);
    state = endStroke(state);

    state = startStroke(state, 10, 10);
    state = appendPoint(state, 11, 11);

    expect(getAllPoints(state)).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 10, y: 10 },
      { x: 11, y: 11 },
    ]);
  });
});
