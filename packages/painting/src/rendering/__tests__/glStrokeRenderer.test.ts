import type { Stroke } from '../../state/strokes';
import { createGLStrokeRenderer } from '../glStrokeRenderer';

type RAFCallback = () => void;

interface MockCanvas2DContext {
  clearRect: jest.Mock;
  fillRect: jest.Mock;
  beginPath: jest.Mock;
  moveTo: jest.Mock;
  lineTo: jest.Mock;
  stroke: jest.Mock;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
}

const stroke: Stroke = {
  id: 'stroke-1',
  finalized: true,
  points: [
    { x: 0, y: 0 },
    { x: 50, y: 100 },
    { x: 100, y: 200 },
  ],
};

function createMockCanvas2DContext(): MockCanvas2DContext {
  return {
    clearRect: jest.fn(),
    fillRect: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: '',
    lineJoin: '',
  };
}

describe('createGLStrokeRenderer', () => {
  let callbacks: RAFCallback[];
  let requestAnimationFrameMock: jest.Mock<number, [RAFCallback]>;
  let cancelAnimationFrameMock: jest.Mock<void, [number]>;

  beforeEach(() => {
    callbacks = [];
    requestAnimationFrameMock = jest.fn((callback: RAFCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    cancelAnimationFrameMock = jest.fn();

    Object.assign(globalThis, {
      requestAnimationFrame: requestAnimationFrameMock,
      cancelAnimationFrame: cancelAnimationFrameMock,
    });
  });

  it('schedules RAF on start', () => {
    const mockCtx = createMockCanvas2DContext();
    const renderer = createGLStrokeRenderer(mockCtx as unknown as CanvasRenderingContext2D);

    renderer.start();

    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);
  });

  it('renders a frame with white background and black strokes', () => {
    const mockCtx = createMockCanvas2DContext();
    const renderer = createGLStrokeRenderer(mockCtx as unknown as CanvasRenderingContext2D);

    renderer.setDimensions(100, 200);
    renderer.updateStrokes([stroke]);
    renderer.start();
    callbacks.shift()?.();

    expect(mockCtx.clearRect).toHaveBeenCalledWith(0, 0, 100, 200);
    expect(mockCtx.fillRect).toHaveBeenCalledWith(0, 0, 100, 200);
    expect(mockCtx.fillStyle).toBe('#ffffff');
    expect(mockCtx.strokeStyle).toBe('#000000');
    expect(mockCtx.lineWidth).toBe(2);
    expect(mockCtx.lineCap).toBe('round');
    expect(mockCtx.lineJoin).toBe('round');
    expect(mockCtx.beginPath).toHaveBeenCalled();
    expect(mockCtx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(mockCtx.lineTo).toHaveBeenCalledWith(50, 100);
    expect(mockCtx.lineTo).toHaveBeenCalledWith(100, 200);
    expect(mockCtx.stroke).toHaveBeenCalled();
  });

  it('cancels RAF and makes queued renders a no-op during cleanup', () => {
    const mockCtx = createMockCanvas2DContext();
    const renderer = createGLStrokeRenderer(mockCtx as unknown as CanvasRenderingContext2D);

    renderer.setDimensions(100, 200);
    renderer.updateStrokes([stroke]);
    renderer.start();
    const queuedFrame = callbacks.shift();
    renderer.cleanup();
    queuedFrame?.();

    expect(cancelAnimationFrameMock).toHaveBeenCalledWith(1);
    expect(mockCtx.clearRect).not.toHaveBeenCalled();
    expect(mockCtx.stroke).not.toHaveBeenCalled();
    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);
  });

  it('skips rendering while dimensions are zero', () => {
    const mockCtx = createMockCanvas2DContext();
    const renderer = createGLStrokeRenderer(mockCtx as unknown as CanvasRenderingContext2D);

    renderer.setDimensions(0, 200);
    renderer.updateStrokes([stroke]);
    renderer.start();
    callbacks.shift()?.();

    expect(mockCtx.clearRect).not.toHaveBeenCalled();
    expect(mockCtx.stroke).not.toHaveBeenCalled();
    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(2);
  });
});
