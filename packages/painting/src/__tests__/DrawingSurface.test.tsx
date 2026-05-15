import { DrawingSurface as DrawingSurfaceFromIndex } from '@hamster-note/painting';
import { act, render, screen } from '@testing-library/react';
import { DrawingSurface } from '../components/DrawingSurface';
import type { DrawingTool } from '../components/DrawingSurface';

jest.mock(
  '@system-ui-js/multi-drag',
  () => {
    const DragOperationType = {
      Move: 'Move',
      AllEnd: 'AllEnd',
    };
    const mockDragInstances: Array<{
      element: Element;
      options: Record<string, unknown>;
      listeners: Record<string, Array<(fingers: unknown[]) => void>>;
      addEventListener: jest.Mock;
      destroy: jest.Mock;
      emit: (type: string, fingers: unknown[]) => void;
    }> = [];
    const Drag = jest.fn((element: Element, options: Record<string, unknown>) => {
      const listeners: Record<string, Array<(fingers: unknown[]) => void>> = {};
      const instance = {
        element,
        options,
        listeners,
        addEventListener: jest.fn((type: string, listener: (fingers: unknown[]) => void) => {
          listeners[type] = [...(listeners[type] ?? []), listener];
        }),
        destroy: jest.fn(),
        emit: (type: string, fingers: unknown[]) => {
          for (const listener of listeners[type] ?? []) {
            listener(fingers);
          }
        },
      };

      mockDragInstances.push(instance);
      return instance;
    });

    return { Drag, DragOperationType, __mockDragInstances: mockDragInstances };
  },
  { virtual: true }
);

type MockDragInstance = {
  element: Element;
  options: {
    maxFingerCount?: number;
    getPose?: () => unknown;
    setPose?: () => void;
  };
  destroy: jest.Mock;
  emit: (type: string, fingers: MockFinger[]) => void;
};

type MockFinger = {
  getPath: () => Array<{
    point: { x: number; y: number };
    event?: { pointerType?: string; button?: number; clientX?: number; clientY?: number };
  }>;
};

const multiDragMock = jest.requireMock('@system-ui-js/multi-drag') as {
  Drag: jest.Mock;
  DragOperationType: { Move: string; AllEnd: string };
  __mockDragInstances: MockDragInstance[];
};

function latestDragInstance(): MockDragInstance {
  return multiDragMock.__mockDragInstances[multiDragMock.__mockDragInstances.length - 1];
}

function finger(path: ReturnType<MockFinger['getPath']>): MockFinger {
  return { getPath: () => path };
}

function mockHostRect(element: HTMLElement) {
  element.getBoundingClientRect = jest.fn(() => ({
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    right: 210,
    bottom: 220,
    width: 200,
    height: 200,
    toJSON: () => ({}),
  }));
}

beforeEach(() => {
  multiDragMock.Drag.mockClear();
  multiDragMock.__mockDragInstances.splice(0, multiDragMock.__mockDragInstances.length);
});

describe('DrawingSurface', () => {
  it('renders host container with data-testid', () => {
    render(<DrawingSurface testID="drawing-surface-host" />);
    expect(screen.getByTestId('drawing-surface-host')).toBeTruthy();
  });

  it('renders without props', () => {
    const { container } = render(<DrawingSurface />);
    expect(container.querySelector('div')).toBeTruthy();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders svg element', () => {
    const { container } = render(<DrawingSurface />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('creates drag instance on mount', () => {
    render(<DrawingSurface testID="drawing-surface-host" />);
    const host = screen.getByTestId('drawing-surface-host');
    const instance = latestDragInstance();

    expect(multiDragMock.Drag).toHaveBeenCalledWith(host, expect.any(Object));
    expect(instance.element).toBe(host);
    expect(instance.options.maxFingerCount).toBe(1);
    expect(instance.options.getPose?.()).toEqual({ position: { x: 0, y: 0 }, width: 0, height: 0 });
    expect(instance.options.setPose?.()).toBeUndefined();
  });

  it('destroys drag instance on unmount', () => {
    const { unmount } = render(<DrawingSurface />);
    const instance = latestDragInstance();

    unmount();

    expect(instance.destroy).toHaveBeenCalledTimes(1);
  });

  it('commits completed pen stroke on drag all-end', () => {
    const onChange = jest.fn();
    const { container } = render(<DrawingSurface testID="drawing-surface-host" value={{ strokes: [] }} onChange={onChange} />);
    const host = screen.getByTestId('drawing-surface-host');
    mockHostRect(host);
    const instance = latestDragInstance();

    act(() => {
      instance.emit(multiDragMock.DragOperationType.Move, [
        finger([
          { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 } },
          { point: { x: 20, y: 35 }, event: { pointerType: 'pen', button: 0 } },
        ]),
      ]);
    });

    expect(container.querySelector('polyline')?.getAttribute('points')).toBe('5,5 10,15');
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].strokes).toHaveLength(1);
    expect(onChange.mock.calls[0][0].strokes[0].points).toEqual([
      { x: 5, y: 5 },
      { x: 10, y: 15 },
    ]);
    expect(container.querySelector('polyline')).toBeNull();
  });

  it('renders polylines from defaultValue', () => {
    const defaultValue = {
      strokes: [
        {
          id: 'stroke-1',
          tool: 'pen' as const,
          points: [
            { x: 10, y: 20 },
            { x: 30, y: 40 },
          ],
        },
        {
          id: 'stroke-2',
          tool: 'pen' as const,
          points: [
            { x: 50, y: 60 },
            { x: 70, y: 80 },
          ],
        },
      ],
    };
    const { container } = render(<DrawingSurface defaultValue={defaultValue} />);
    const polylines = container.querySelectorAll('polyline');
    expect(polylines.length).toBe(2);
    expect(polylines[0].getAttribute('points')).toBe('10,20 30,40');
    expect(polylines[1].getAttribute('points')).toBe('50,60 70,80');
  });

  it('renders polylines from controlled value', () => {
    const value = {
      strokes: [
        {
          id: 'controlled-stroke',
          tool: 'pen' as const,
          points: [
            { x: 5, y: 10 },
            { x: 15, y: 20 },
          ],
        },
      ],
    };
    const { container } = render(<DrawingSurface value={value} />);
    const polylines = container.querySelectorAll('polyline');
    expect(polylines.length).toBe(1);
    expect(polylines[0].getAttribute('points')).toBe('5,10 15,20');
  });

  it('controlled value updates replace previous strokes while idle', () => {
    const { container, rerender } = render(
      <DrawingSurface
        value={{
          strokes: [
            {
              id: 'stroke-a',
              tool: 'pen' as const,
              points: [{ x: 1, y: 2 }],
            },
          ],
        }}
      />
    );
    expect(container.querySelectorAll('polyline').length).toBe(1);

    rerender(
      <DrawingSurface
        value={{
          strokes: [
            {
              id: 'stroke-b',
              tool: 'pen' as const,
              points: [{ x: 3, y: 4 }],
            },
            {
              id: 'stroke-c',
              tool: 'pen' as const,
              points: [{ x: 5, y: 6 }],
            },
          ],
        }}
      />
    );
    const polylines = container.querySelectorAll('polyline');
    expect(polylines.length).toBe(2);
    expect(polylines[0].getAttribute('points')).toBe('3,4');
    expect(polylines[1].getAttribute('points')).toBe('5,6');
  });

  it('unsupported tool renders without crashing and does not enable drawing', () => {
    const { container } = render(<DrawingSurface tool={"marker" as unknown as DrawingTool} />);
    const host = container.querySelector('div');
    expect(host).toBeTruthy();
    expect(host?.getAttribute('data-enabled')).toBe('false');
  });

  it('uncontrolled mode calls onChange exactly once when stroke completes on AllEnd', () => {
    const onChange = jest.fn();
    const defaultValue = {
      strokes: [
        {
          id: 'existing-stroke',
          tool: 'pen' as const,
          points: [{ x: 1, y: 2 }],
        },
      ],
    };
    const { container } = render(
      <DrawingSurface testID="drawing-surface-host" defaultValue={defaultValue} onChange={onChange} />
    );
    const host = screen.getByTestId('drawing-surface-host');
    mockHostRect(host);
    const instance = latestDragInstance();

    act(() => {
      instance.emit(multiDragMock.DragOperationType.Move, [
        finger([
          { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 } },
          { point: { x: 20, y: 35 }, event: { pointerType: 'pen', button: 0 } },
        ]),
      ]);
    });

    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].strokes).toHaveLength(2);
    expect(onChange.mock.calls[0][0].strokes[0].id).toBe('existing-stroke');
    expect(onChange.mock.calls[0][0].strokes[1].points).toEqual([
      { x: 5, y: 5 },
      { x: 10, y: 15 },
    ]);
    const polylines = container.querySelectorAll('polyline');
    expect(polylines.length).toBe(2);
    expect(polylines[0].getAttribute('points')).toBe('1,2');
    expect(polylines[1].getAttribute('points')).toBe('5,5 10,15');
  });

  it('module import does not crash in jsdom', () => {
    expect(() => {
      const { container } = render(<DrawingSurfaceFromIndex />);
      expect(container.querySelector('svg')).toBeTruthy();
    }).not.toThrow();
  });
});
