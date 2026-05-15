import { DrawingSurface as DrawingSurfaceFromIndex } from '@hamster-note/painting';
import { act, render, screen } from '@testing-library/react';
import { DrawingSurface, type DrawingTool } from '../components/DrawingSurface';

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

  it('committed pen stroke respects strokeColor and strokeWidth', () => {
    const onChange = jest.fn();
    const { container, rerender } = render(
      <DrawingSurface testID="drawing-surface-host" value={{ strokes: [] }} onChange={onChange} tool="pen" strokeColor="#ff0000" strokeWidth={7} />
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
      instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
    });

    const committed = onChange.mock.calls[0][0];
    rerender(
      <DrawingSurface
        testID="drawing-surface-host"
        value={committed}
        onChange={onChange}
        tool="pen"
        strokeColor="#ff0000"
        strokeWidth={7}
      />
    );

    const polyline = container.querySelector('polyline');
    expect(polyline?.getAttribute('stroke')).toBe('#ff0000');
    expect(polyline?.getAttribute('stroke-width')).toBe('7');
  });

  it('active preview respects strokeColor and strokeWidth for pen/line/rect', () => {
    const hostTestId = 'drawing-surface-active-style-host';
    const color = '#00ff00';
    const width = 9;
    const drawPreviewForTool = (tool: 'pen' | 'line' | 'rect') => {
      const { container, unmount } = render(
        <DrawingSurface
          testID={hostTestId}
          value={{ strokes: [] }}
          tool={tool}
          strokeColor={color}
          strokeWidth={width}
        />
      );
      const host = screen.getByTestId(hostTestId);
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

      const activeElement =
        tool === 'rect'
          ? container.querySelector('rect')
          : tool === 'line'
            ? container.querySelector('line')
            : container.querySelector('polyline');
      expect(activeElement?.getAttribute('stroke')).toBe(color);
      expect(activeElement?.getAttribute('stroke-width')).toBe(String(width));
      unmount();
    };

    drawPreviewForTool('pen');
    drawPreviewForTool('line');
    drawPreviewForTool('rect');
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

  it('renders with blank strokeColor and uses black as default', () => {
    const { container } = render(
      <DrawingSurface
        strokeColor=""
        value={{
          strokes: [{ id: 'stroke-1', tool: 'pen' as const, points: [{ x: 0, y: 0 }] }],
        }}
      />
    );
    const polyline = container.querySelector('polyline');
    expect(polyline).toBeTruthy();
    expect(polyline.getAttribute('stroke')).toBe('black');
  });

  it('renders with invalid strokeColor (whitespace only) and uses black as default', () => {
    const { container } = render(
      <DrawingSurface
        strokeColor="   "
        value={{
          strokes: [{ id: 'stroke-1', tool: 'pen' as const, points: [{ x: 0, y: 0 }] }],
        }}
      />
    );
    const polyline = container.querySelector('polyline');
    expect(polyline).toBeTruthy();
    expect(polyline.getAttribute('stroke')).toBe('black');
  });

  it('renders with invalid strokeWidth (non-finite) and uses 2 as default', () => {
    const { container } = render(
      <DrawingSurface
        strokeWidth={NaN}
        value={{
          strokes: [{ id: 'stroke-1', tool: 'pen' as const, points: [{ x: 0, y: 0 }] }],
        }}
      />
    );
    const polyline = container.querySelector('polyline');
    expect(polyline).toBeTruthy();
    expect(polyline.getAttribute('stroke-width')).toBe('2');
  });

  it('renders with invalid strokeWidth (< 1) and uses 2 as default', () => {
    const { container } = render(
      <DrawingSurface
        strokeWidth={0.5}
        value={{
          strokes: [{ id: 'stroke-1', tool: 'pen' as const, points: [{ x: 0, y: 0 }] }],
        }}
      />
    );
    const polyline = container.querySelector('polyline');
    expect(polyline).toBeTruthy();
    expect(polyline.getAttribute('stroke-width')).toBe('2');
  });

  it('renders with valid strokeColor and strokeWidth', () => {
    const { container } = render(<DrawingSurface strokeColor="red" strokeWidth={5} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('commits completed rect stroke on drag all-end', () => {
    const onChange = jest.fn();
    const { container } = render(<DrawingSurface testID="drawing-surface-host" value={{ strokes: [] }} onChange={onChange} tool="rect" />);
    const host = screen.getByTestId('drawing-surface-host');
    mockHostRect(host);
    const instance = latestDragInstance();

    act(() => {
      instance.emit(multiDragMock.DragOperationType.Move, [
        finger([
          { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 } },
          { point: { x: 40, y: 55 }, event: { pointerType: 'pen', button: 0 } },
        ]),
      ]);
    });

    const rectEl = container.querySelector('rect');
    expect(rectEl).toBeTruthy();
    expect(Number(rectEl.getAttribute('x'))).toBeGreaterThan(0);
    expect(Number(rectEl.getAttribute('y'))).toBeGreaterThan(0);
    expect(Number(rectEl.getAttribute('width'))).toBeGreaterThan(0);
    expect(Number(rectEl.getAttribute('height'))).toBeGreaterThan(0);
    expect(rectEl.getAttribute('fill')).toBe('none');
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].strokes).toHaveLength(1);
    expect(onChange.mock.calls[0][0].strokes[0].tool).toBe('rect');
    expect(container.querySelector('rect')).toBeNull();
  });

  it('reverse drag renders normalized rect', () => {
    const onChange = jest.fn();
    const { container } = render(<DrawingSurface testID="drawing-surface-host" value={{ strokes: [] }} onChange={onChange} tool="rect" />);
    const host = screen.getByTestId('drawing-surface-host');
    mockHostRect(host);
    const instance = latestDragInstance();

    act(() => {
      instance.emit(multiDragMock.DragOperationType.Move, [
        finger([
          { point: { x: 60, y: 70 }, event: { pointerType: 'pen', button: 0 } },
          { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 } },
        ]),
      ]);
    });

    const rectEl = container.querySelector('rect');
    expect(rectEl).toBeTruthy();
    expect(Number(rectEl.getAttribute('x'))).toBe(5);
    expect(Number(rectEl.getAttribute('y'))).toBe(5);
    expect(Number(rectEl.getAttribute('width'))).toBe(45);
    expect(Number(rectEl.getAttribute('height'))).toBe(45);
    expect(Number(rectEl.getAttribute('width'))).toBeGreaterThan(0);
    expect(Number(rectEl.getAttribute('height'))).toBeGreaterThan(0);
  });

  it('active rect preview renders during drag', () => {
    const { container } = render(<DrawingSurface testID="drawing-surface-host" tool="rect" />);
    const host = screen.getByTestId('drawing-surface-host');
    mockHostRect(host);
    const instance = latestDragInstance();

    act(() => {
      instance.emit(multiDragMock.DragOperationType.Move, [
        finger([
          { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 } },
          { point: { x: 40, y: 55 }, event: { pointerType: 'pen', button: 0 } },
        ]),
      ]);
    });

    const rectEl = container.querySelector('rect');
    expect(rectEl).toBeTruthy();
    expect(rectEl.getAttribute('fill')).toBe('none');
    expect(rectEl.getAttribute('opacity')).toBe('0.7');
  });

  it('commits completed line stroke on drag all-end', () => {
    const onChange = jest.fn();
    const { container } = render(<DrawingSurface testID="drawing-surface-host" value={{ strokes: [] }} onChange={onChange} tool="line" />);
    const host = screen.getByTestId('drawing-surface-host');
    mockHostRect(host);
    const instance = latestDragInstance();

    act(() => {
      instance.emit(multiDragMock.DragOperationType.Move, [
        finger([
          { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 } },
          { point: { x: 40, y: 55 }, event: { pointerType: 'pen', button: 0 } },
        ]),
      ]);
    });

    const lineEl = container.querySelector('line');
    expect(lineEl).toBeTruthy();
    expect(Number(lineEl.getAttribute('x1'))).toBe(5);
    expect(Number(lineEl.getAttribute('y1'))).toBe(5);
    expect(Number(lineEl.getAttribute('x2'))).toBe(30);
    expect(Number(lineEl.getAttribute('y2'))).toBe(35);
    expect(lineEl.getAttribute('fill')).toBe('none');
    expect(lineEl.getAttribute('stroke-linecap')).toBe('round');
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].strokes).toHaveLength(1);
    expect(onChange.mock.calls[0][0].strokes[0].tool).toBe('line');
    expect(onChange.mock.calls[0][0].strokes[0].points).toEqual([
      { x: 5, y: 5 },
      { x: 30, y: 35 },
    ]);
    expect(container.querySelector('line')).toBeNull();
    expect(container.querySelector('polyline')).toBeNull();
  });

  it('active line preview renders during drag', () => {
    const { container } = render(<DrawingSurface testID="drawing-surface-host" tool="line" />);
    const host = screen.getByTestId('drawing-surface-host');
    mockHostRect(host);
    const instance = latestDragInstance();

    act(() => {
      instance.emit(multiDragMock.DragOperationType.Move, [
        finger([
          { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 } },
          { point: { x: 40, y: 55 }, event: { pointerType: 'pen', button: 0 } },
        ]),
      ]);
    });

    const lineEl = container.querySelector('line');
    expect(lineEl).toBeTruthy();
    expect(lineEl.getAttribute('fill')).toBe('none');
    expect(lineEl.getAttribute('opacity')).toBe('0.7');
    expect(lineEl.getAttribute('stroke-linecap')).toBe('round');
  });

  it('tap/no-move still rejected for line tool', () => {
    const onChange = jest.fn();
    render(<DrawingSurface testID="drawing-surface-host" value={{ strokes: [] }} onChange={onChange} tool="line" />);
    const host = screen.getByTestId('drawing-surface-host');
    mockHostRect(host);
    const instance = latestDragInstance();

    act(() => {
      instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('changing strokeColor and strokeWidth props only affects new strokes, not existing ones', () => {
    const onChange = jest.fn();
    const { container, rerender } = render(
      <DrawingSurface
        testID="drawing-surface-host"
        value={{ strokes: [] }}
        onChange={onChange}
        tool="pen"
        strokeColor="#ff0000"
        strokeWidth={5}
      />
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
      instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
    });

    const firstStroke = onChange.mock.calls[0][0].strokes[0];
    expect(firstStroke.strokeColor).toBe('#ff0000');
    expect(firstStroke.strokeWidth).toBe(5);

    rerender(
      <DrawingSurface
        testID="drawing-surface-host"
        value={{ strokes: [firstStroke] }}
        onChange={onChange}
        tool="pen"
        strokeColor="#0000ff"
        strokeWidth={10}
      />
    );

    act(() => {
      instance.emit(multiDragMock.DragOperationType.Move, [
        finger([
          { point: { x: 50, y: 60 }, event: { pointerType: 'pen', button: 0 } },
          { point: { x: 55, y: 70 }, event: { pointerType: 'pen', button: 0 } },
        ]),
      ]);
      instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
    });

    const secondStroke = onChange.mock.calls[1][0].strokes[1];
    expect(secondStroke.strokeColor).toBe('#0000ff');
    expect(secondStroke.strokeWidth).toBe(10);

    const committedBoth = onChange.mock.calls[1][0];
    rerender(
      <DrawingSurface
        testID="drawing-surface-host"
        value={committedBoth}
        onChange={onChange}
        tool="pen"
        strokeColor="#0000ff"
        strokeWidth={10}
      />
    );

    const polylines = container.querySelectorAll('polyline');
    expect(polylines.length).toBe(2);
    expect(polylines[0].getAttribute('stroke')).toBe('#ff0000');
    expect(polylines[0].getAttribute('stroke-width')).toBe('5');
    expect(polylines[1].getAttribute('stroke')).toBe('#0000ff');
    expect(polylines[1].getAttribute('stroke-width')).toBe('10');
  });

  it('uncontrolled defaultValue snapshots current props and is unaffected by later prop changes', () => {
    const defaultValue = {
      strokes: [
        {
          id: 'old-stroke',
          tool: 'pen' as const,
          points: [
            { x: 10, y: 20 },
            { x: 30, y: 40 },
          ],
        },
      ],
    };
    const { container, rerender } = render(
      <DrawingSurface defaultValue={defaultValue} strokeColor="#ff0000" strokeWidth={5} />
    );

    const polyline = container.querySelector('polyline');
    expect(polyline?.getAttribute('stroke')).toBe('#ff0000');
    expect(polyline?.getAttribute('stroke-width')).toBe('5');

    rerender(
      <DrawingSurface defaultValue={defaultValue} strokeColor="#0000ff" strokeWidth={10} />
    );

    const polylineAfter = container.querySelector('polyline');
    expect(polylineAfter?.getAttribute('stroke')).toBe('#ff0000');
    expect(polylineAfter?.getAttribute('stroke-width')).toBe('5');
  });
});
