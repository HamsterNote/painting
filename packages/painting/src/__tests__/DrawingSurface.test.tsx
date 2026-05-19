import { DrawingSurface as DrawingSurfaceFromIndex } from '@hamster-note/painting';
import { act, render, screen } from '@testing-library/react';
import { type DrawingInputMethod, DrawingSurface, type DrawingTool } from '../components/DrawingSurface';

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
    pressure?: number;
    timestamp?: number;
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

function fingerWithTimestamps(
  points: { x: number; y: number }[],
  startTime = 0,
  interval = 16,
  event: MockInputEvent = { pointerType: 'pen', button: 0 }
): MockFinger {
  return {
    getPath: () =>
      points.map((point, index) => ({
        point,
        timestamp: startTime + index * interval,
        event,
      })),
  };
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

type MockInputEvent = { pointerType?: string; button?: number; clientX?: number; clientY?: number };

function emitCompletedStroke(instance: MockDragInstance, event: MockInputEvent) {
  act(() => {
    instance.emit(multiDragMock.DragOperationType.Move, [
      finger([
        { point: { x: 15, y: 25 }, event },
        { point: { x: 20, y: 35 }, event },
      ]),
    ]);
    instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
  });
}

function renderForInputMethods(inputMethods?: DrawingInputMethod[]) {
  const onChange = jest.fn();
  const { unmount } = render(
    <DrawingSurface
      testID="drawing-surface-host"
      value={{ strokes: [] }}
      onChange={onChange}
      inputMethods={inputMethods}
    />
  );
  const host = screen.getByTestId('drawing-surface-host');
  mockHostRect(host);

  return { instance: latestDragInstance(), onChange, unmount };
}

function expectInputAccepted(inputMethods: DrawingInputMethod[] | undefined, event: MockInputEvent) {
  const { instance, onChange, unmount } = renderForInputMethods(inputMethods);

  emitCompletedStroke(instance, event);

  expect(onChange).toHaveBeenCalledTimes(1);
  unmount();
}

function expectInputRejected(inputMethods: DrawingInputMethod[] | undefined, event: MockInputEvent) {
  const { instance, onChange, unmount } = renderForInputMethods(inputMethods);

  emitCompletedStroke(instance, event);

  expect(onChange).not.toHaveBeenCalled();
  unmount();
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

    expect(container.querySelector('path')?.getAttribute('d')).toBe('M 5 5 L 10 15');
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
    expect(container.querySelector('path')).toBeNull();
  });

  it('accepts pen, left mouse, and touch input by default', () => {
    expectInputAccepted(undefined, { pointerType: 'pen', button: 0 });
    expectInputAccepted(undefined, { pointerType: 'mouse', button: 0 });
    expectInputAccepted(undefined, { pointerType: 'touch' });
  });

  it('inputMethods pen accepts pen and rejects mouse and touch', () => {
    expectInputAccepted(['pen'], { pointerType: 'pen', button: 0 });
    expectInputRejected(['pen'], { pointerType: 'mouse', button: 0 });
    expectInputRejected(['pen'], { pointerType: 'touch' });
  });

  it('inputMethods mouse accepts only left mouse and rejects pen and touch', () => {
    expectInputAccepted(['mouse'], { pointerType: 'mouse', button: 0 });
    expectInputRejected(['mouse'], { pointerType: 'mouse', button: 1 });
    expectInputRejected(['mouse'], { pointerType: 'pen', button: 0 });
    expectInputRejected(['mouse'], { pointerType: 'touch' });
  });

  it('inputMethods touch accepts touch and undefined pointerType and rejects pen and mouse', () => {
    expectInputAccepted(['touch'], { pointerType: 'touch' });
    expectInputAccepted(['touch'], {});
    expectInputRejected(['touch'], { pointerType: 'pen', button: 0 });
    expectInputRejected(['touch'], { pointerType: 'mouse', button: 0 });
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

    const path = container.querySelector('path');
    expect(path?.getAttribute('stroke')).toBe('#ff0000');
    expect(path?.getAttribute('stroke-width')).toBe('7');
  });

  it('captures pen pressure and renders active and committed segment widths', () => {
    const onChange = jest.fn();
    const { container, rerender } = render(
      <DrawingSurface
        testID="drawing-surface-host"
        value={{ strokes: [] }}
        onChange={onChange}
        tool="pen"
        strokeWidth={10}
        strokeSmoothing={false}
        pressure={true}
      />
    );
    const host = screen.getByTestId('drawing-surface-host');
    mockHostRect(host);
    const instance = latestDragInstance();

    act(() => {
      instance.emit(multiDragMock.DragOperationType.Move, [
        finger([
          { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 }, pressure: 0.2 },
          { point: { x: 20, y: 35 }, event: { pointerType: 'pen', button: 0 }, pressure: 0.8 },
        ]),
      ]);
    });

    expect(container.querySelector('path')).toBeNull();
    expect(container.querySelector('line')?.getAttribute('stroke-width')).toBe('8');

    act(() => {
      instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
    });

    expect(onChange.mock.calls[0][0].strokes[0].points).toEqual([
      { x: 5, y: 5, pressure: 0.2 },
      { x: 10, y: 15, pressure: 0.8 },
    ]);

    rerender(
      <DrawingSurface
        testID="drawing-surface-host"
        value={onChange.mock.calls[0][0]}
        onChange={onChange}
        tool="pen"
        strokeWidth={10}
        strokeSmoothing={false}
        pressure={true}
      />
    );

    expect(container.querySelector('path')).toBeNull();
    expect(container.querySelector('line')?.getAttribute('stroke-width')).toBe('8');
  });

  it('ignores pressure input when pressure prop is false', () => {
    const onChange = jest.fn();
    const { container } = render(
      <DrawingSurface
        testID="drawing-surface-host"
        value={{ strokes: [] }}
        onChange={onChange}
        tool="pen"
        strokeWidth={10}
        strokeSmoothing={false}
        pressure={false}
      />
    );
    const host = screen.getByTestId('drawing-surface-host');
    mockHostRect(host);
    const instance = latestDragInstance();

    act(() => {
      instance.emit(multiDragMock.DragOperationType.Move, [
        finger([
          { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 }, pressure: 0.2 },
          { point: { x: 20, y: 35 }, event: { pointerType: 'pen', button: 0 }, pressure: 0.8 },
        ]),
      ]);
    });

    expect(container.querySelector('path')?.getAttribute('stroke-width')).toBe('10');

    act(() => {
      instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
    });

    expect(onChange.mock.calls[0][0].strokes[0].points).toEqual([
      { x: 5, y: 5 },
      { x: 10, y: 15 },
    ]);
  });

  it('ignores pressure input when pressure prop is omitted', () => {
    const onChange = jest.fn();
    const { container } = render(
      <DrawingSurface
        testID="drawing-surface-host"
        value={{ strokes: [] }}
        onChange={onChange}
        tool="pen"
        strokeWidth={10}
        strokeSmoothing={false}
      />
    );
    const host = screen.getByTestId('drawing-surface-host');
    mockHostRect(host);
    const instance = latestDragInstance();

    act(() => {
      instance.emit(multiDragMock.DragOperationType.Move, [
        finger([
          { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 }, pressure: 0.2 },
          { point: { x: 20, y: 35 }, event: { pointerType: 'pen', button: 0 }, pressure: 0.8 },
        ]),
      ]);
    });

    expect(container.querySelector('path')?.getAttribute('stroke-width')).toBe('10');
    expect(container.querySelector('line')).toBeNull();

    act(() => {
      instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
    });

    expect(onChange.mock.calls[0][0].strokes[0].points).toEqual([
      { x: 5, y: 5 },
      { x: 10, y: 15 },
    ]);
  });

  it('leaves non-pen tools unaffected by pressure input', () => {
    const onChange = jest.fn();
    const { container } = render(
      <DrawingSurface
        testID="drawing-surface-host"
        value={{ strokes: [] }}
        onChange={onChange}
        tool="line"
        strokeWidth={10}
        pressure={true}
      />
    );
    const host = screen.getByTestId('drawing-surface-host');
    mockHostRect(host);
    const instance = latestDragInstance();

    act(() => {
      instance.emit(multiDragMock.DragOperationType.Move, [
        finger([
          { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 }, pressure: 0.2 },
          { point: { x: 20, y: 35 }, event: { pointerType: 'pen', button: 0 }, pressure: 0.8 },
        ]),
      ]);
    });

    expect(container.querySelector('line')?.getAttribute('stroke-width')).toBe('10');

    act(() => {
      instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
    });

    expect(onChange.mock.calls[0][0].strokes[0].points).toEqual([
      { x: 5, y: 5 },
      { x: 10, y: 15 },
    ]);
  });

  it('renders zero pressure as zero-width pen segments', () => {
    const { container } = render(
      <DrawingSurface
        value={{
          strokes: [
            {
              id: 'zero-pressure-stroke',
              tool: 'pen' as const,
              strokeWidth: 10,
              points: [
                { x: 0, y: 0, pressure: 1 },
                { x: 10, y: 10, pressure: 0 },
              ],
            },
          ],
        }}
      />
    );

    expect(container.querySelector('line')?.getAttribute('stroke-width')).toBe('0');
  });

  it('falls back to base width for invalid pressure values', () => {
    const { container } = render(
      <DrawingSurface
        value={{
          strokes: [
            {
              id: 'invalid-pressure-stroke',
              tool: 'pen' as const,
              strokeWidth: 10,
              points: [
                { x: 0, y: 0, pressure: 0.5 },
                { x: 10, y: 10, pressure: NaN },
                { x: 20, y: 20, pressure: 2 },
                { x: 30, y: 30 },
              ],
            },
          ],
        }}
      />
    );

    const lines = container.querySelectorAll('line');
    expect(lines[0].getAttribute('stroke-width')).toBe('10');
    expect(lines[1].getAttribute('stroke-width')).toBe('10');
    expect(lines[2].getAttribute('stroke-width')).toBe('10');
  });

  it('does not set pressure when pathItem.pressure is undefined even with pressure prop enabled', () => {
    const onChange = jest.fn();
    const { container } = render(
      <DrawingSurface
        testID="drawing-surface-host"
        value={{ strokes: [] }}
        onChange={onChange}
        tool="pen"
        strokeWidth={10}
        strokeSmoothing={false}
        pressure={true}
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
    });

    // Active stroke should render as a single path (no pressure data)
    expect(container.querySelectorAll('path').length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector('line')).toBeNull();

    act(() => {
      instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
    });

    expect(onChange.mock.calls[0][0].strokes[0].points).toEqual([
      { x: 5, y: 5 },
      { x: 10, y: 15 },
    ]);
  });

  it('preserves historical pressure rendering without pressure prop', () => {
    const { container } = render(
      <DrawingSurface
        value={{
          strokes: [
            {
              id: 'historical-pressure-stroke',
              tool: 'pen' as const,
              strokeWidth: 10,
              points: [
                { x: 0, y: 0, pressure: 0.2 },
                { x: 10, y: 10, pressure: 0.8 },
              ],
            },
          ],
        }}
      />
    );

    expect(container.querySelector('path')).toBeNull();
    expect(container.querySelector('line')?.getAttribute('stroke-width')).toBe('8');
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
            : container.querySelector('path');
      expect(activeElement?.getAttribute('stroke')).toBe(color);
      expect(activeElement?.getAttribute('stroke-width')).toBe(String(width));
      unmount();
    };

    drawPreviewForTool('pen');
    drawPreviewForTool('line');
    drawPreviewForTool('rect');
  });

  it('renders paths from defaultValue', () => {
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
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(2);
    expect(paths[0].getAttribute('d')).toBe('M 10 20 L 30 40');
    expect(paths[1].getAttribute('d')).toBe('M 50 60 L 70 80');
  });

  it('renders paths from controlled value', () => {
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
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(1);
    expect(paths[0].getAttribute('d')).toBe('M 5 10 L 15 20');
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
    expect(container.querySelectorAll('path').length).toBe(1);

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
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(2);
    expect(paths[0].getAttribute('d')).toBe('M 3 4');
    expect(paths[1].getAttribute('d')).toBe('M 5 6');
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
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(2);
    expect(paths[0].getAttribute('d')).toBe('M 1 2');
    expect(paths[1].getAttribute('d')).toBe('M 5 5 L 10 15');
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
    const path = container.querySelector('path');
    expect(path).toBeTruthy();
    expect(path.getAttribute('stroke')).toBe('black');
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
    const path = container.querySelector('path');
    expect(path).toBeTruthy();
    expect(path.getAttribute('stroke')).toBe('black');
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
    const path = container.querySelector('path');
    expect(path).toBeTruthy();
    expect(path.getAttribute('stroke-width')).toBe('2');
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
    const path = container.querySelector('path');
    expect(path).toBeTruthy();
    expect(path.getAttribute('stroke-width')).toBe('2');
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

    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(2);
    expect(paths[0].getAttribute('stroke')).toBe('#ff0000');
    expect(paths[0].getAttribute('stroke-width')).toBe('5');
    expect(paths[1].getAttribute('stroke')).toBe('#0000ff');
    expect(paths[1].getAttribute('stroke-width')).toBe('10');
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

    const path = container.querySelector('path');
    expect(path?.getAttribute('stroke')).toBe('#ff0000');
    expect(path?.getAttribute('stroke-width')).toBe('5');

    rerender(
      <DrawingSurface defaultValue={defaultValue} strokeColor="#0000ff" strokeWidth={10} />
    );

    const pathAfter = container.querySelector('path');
    expect(pathAfter?.getAttribute('stroke')).toBe('#ff0000');
    expect(pathAfter?.getAttribute('stroke-width')).toBe('5');
  });

  it('samples at default ~8.333ms (120Hz) with interpolation', () => {
    const onChange = jest.fn();
    render(
      <DrawingSurface
        testID="drawing-surface-host"
        value={{ strokes: [] }}
        onChange={onChange}
        tool="pen"
        strokeSmoothing={false}
      />
    );
    const host = screen.getByTestId('drawing-surface-host');
    mockHostRect(host);
    const instance = latestDragInstance();

    // 10ms-interval points: should produce ~120Hz sampled output
    act(() => {
      instance.emit(multiDragMock.DragOperationType.Move, [
        fingerWithTimestamps(
          [
            { x: 15, y: 25 },
            { x: 20, y: 30 },
            { x: 25, y: 35 },
            { x: 30, y: 40 },
            { x: 35, y: 45 },
          ],
          0,
          10
        ),
      ]);
    });

    act(() => {
      instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const points = onChange.mock.calls[0][0].strokes[0].points;
    // First point always kept
    expect(points[0]).toEqual({ x: 5, y: 5, timestamp: 0 });
    // Should have interpolated points + flushed last point
    expect(points.length).toBeGreaterThanOrEqual(3);
    // Last point should be the flushed raw end point
    expect(points[points.length - 1].x).toBe(25);
    expect(points[points.length - 1].y).toBe(25);
  });

  it('respects custom samplingInterval prop', () => {
    const onChange = jest.fn();
    render(
      <DrawingSurface
        testID="drawing-surface-host"
        value={{ strokes: [] }}
        onChange={onChange}
        tool="pen"
        strokeSmoothing={false}
        samplingInterval={20}
      />
    );
    const host = screen.getByTestId('drawing-surface-host');
    mockHostRect(host);
    const instance = latestDragInstance();

    act(() => {
      instance.emit(multiDragMock.DragOperationType.Move, [
        fingerWithTimestamps(
          [
            { x: 15, y: 25 },
            { x: 20, y: 30 },
            { x: 25, y: 35 },
            { x: 30, y: 40 },
            { x: 35, y: 45 },
          ],
          0,
          10
        ),
      ]);
    });

    act(() => {
      instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
    });

    const points = onChange.mock.calls[0][0].strokes[0].points;
    expect(points[0]).toEqual({ x: 5, y: 5, timestamp: 0 });
    // With 20ms interval on 10ms-spaced points, expect fewer samples than default
    expect(points.length).toBeLessThanOrEqual(4);
  });

  it('interpolates coordinates on fixed time grid', () => {
    const onChange = jest.fn();
    render(
      <DrawingSurface
        testID="drawing-surface-host"
        value={{ strokes: [] }}
        onChange={onChange}
        tool="pen"
        strokeSmoothing={false}
        samplingInterval={10}
      />
    );
    const host = screen.getByTestId('drawing-surface-host');
    mockHostRect(host);
    const instance = latestDragInstance();

    act(() => {
      instance.emit(multiDragMock.DragOperationType.Move, [
        fingerWithTimestamps(
          [
            { x: 15, y: 25 },
            { x: 25, y: 35 },
            { x: 35, y: 45 },
            { x: 45, y: 55 },
            { x: 55, y: 65 },
          ],
          0,
          10
        ),
      ]);
    });

    act(() => {
      instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
    });

    const points = onChange.mock.calls[0][0].strokes[0].points;
    // At 10ms interval on 10ms-spaced points: 0, 10, 20, 30, 40
    // Local coords: 5,15,25,35,45
    expect(points).toHaveLength(5);
    expect(points[0]).toEqual({ x: 5, y: 5, timestamp: 0 });
    expect(points[1]).toEqual({ x: 15, y: 15, timestamp: 10 });
    expect(points[2]).toEqual({ x: 25, y: 25, timestamp: 20 });
    expect(points[3]).toEqual({ x: 35, y: 35, timestamp: 30 });
    expect(points[4]).toEqual({ x: 45, y: 45, timestamp: 40 });
  });

  it('AllEnd flushes the last raw point even if it is within interval', () => {
    const onChange = jest.fn();
    render(
      <DrawingSurface
        testID="drawing-surface-host"
        value={{ strokes: [] }}
        onChange={onChange}
        tool="pen"
        strokeSmoothing={false}
        samplingInterval={50}
      />
    );
    const host = screen.getByTestId('drawing-surface-host');
    mockHostRect(host);
    const instance = latestDragInstance();

    act(() => {
      instance.emit(multiDragMock.DragOperationType.Move, [
        fingerWithTimestamps(
          [
            { x: 15, y: 25 },
            { x: 20, y: 30 },
            { x: 25, y: 35 },
          ],
          0,
          10
        ),
      ]);
    });

    act(() => {
      instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
    });

    const points = onChange.mock.calls[0][0].strokes[0].points;
    expect(points[0]).toEqual({ x: 5, y: 5, timestamp: 0 });
    // Last raw point should be flushed
    expect(points[points.length - 1]).toEqual({ x: 15, y: 15, timestamp: 20 });
  });

  it('passes all points through when no timestamps are present', () => {
    const onChange = jest.fn();
    const { container } = render(
      <DrawingSurface
        testID="drawing-surface-host"
        value={{ strokes: [] }}
        onChange={onChange}
        tool="pen"
        strokeSmoothing={false}
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
          { point: { x: 25, y: 45 }, event: { pointerType: 'pen', button: 0 } },
        ]),
      ]);
    });

    const activePath = container.querySelector('path');
    expect(activePath?.getAttribute('d')).toBe(
      'M 5 5 C 6.666666666666667 8.333333333333334 8.333333333333334 11.666666666666666 10 15 C 11.666666666666666 18.333333333333332 15 25 15 25'
    );

    act(() => {
      instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
    });

    expect(onChange.mock.calls[0][0].strokes[0].points).toEqual([
      { x: 5, y: 5 },
      { x: 10, y: 15 },
      { x: 15, y: 25 },
    ]);
  });

  it('resets sampling on new stroke after AllEnd', () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <DrawingSurface
        testID="drawing-surface-host"
        value={{ strokes: [] }}
        onChange={onChange}
        tool="pen"
        strokeSmoothing={false}
        samplingInterval={10}
      />
    );
    const host = screen.getByTestId('drawing-surface-host');
    mockHostRect(host);
    const instance = latestDragInstance();

    act(() => {
      instance.emit(multiDragMock.DragOperationType.Move, [
        fingerWithTimestamps([
          { x: 15, y: 25 },
          { x: 25, y: 35 },
        ], 0, 10),
      ]);
      instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
    });

    const firstStrokeValue = onChange.mock.calls[0][0];
    expect(firstStrokeValue.strokes[0].points).toEqual([
      { x: 5, y: 5, timestamp: 0 },
      { x: 15, y: 15, timestamp: 10 },
    ]);

    rerender(
      <DrawingSurface
        testID="drawing-surface-host"
        value={firstStrokeValue}
        onChange={onChange}
        tool="pen"
        strokeSmoothing={false}
        samplingInterval={10}
      />
    );

    act(() => {
      instance.emit(multiDragMock.DragOperationType.Move, [
        fingerWithTimestamps([
          { x: 50, y: 60 },
          { x: 60, y: 70 },
        ], 100, 10),
      ]);
      instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
    });

    expect(onChange).toHaveBeenCalledTimes(2);
    const secondStrokeValue = onChange.mock.calls[1][0];
    expect(secondStrokeValue.strokes).toHaveLength(2);
    expect(secondStrokeValue.strokes[1].points).toEqual([
      { x: 40, y: 40, timestamp: 100 },
      { x: 50, y: 50, timestamp: 110 },
    ]);
  });

  it('produces consistent stroke regardless of rAF refresh rate', () => {
    const onChange60 = jest.fn();
    const onChange120 = jest.fn();
    const onChange144 = jest.fn();

    const { unmount: unmount60 } = render(
      <DrawingSurface
        testID="drawing-surface-host"
        value={{ strokes: [] }}
        onChange={onChange60}
        tool="pen"
        strokeSmoothing={false}
      />
    );
    const host60 = screen.getByTestId('drawing-surface-host');
    mockHostRect(host60);
    const instance60 = latestDragInstance();

    // Simulate 60Hz rAF batches: ~16.67ms apart
    act(() => {
      instance60.emit(multiDragMock.DragOperationType.Move, [
        fingerWithTimestamps(
          [
            { x: 15, y: 25 },
            { x: 20, y: 30 },
            { x: 25, y: 35 },
            { x: 30, y: 40 },
            { x: 35, y: 45 },
            { x: 40, y: 50 },
          ],
          0,
          16.667
        ),
      ]);
    });
    act(() => {
      instance60.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
    });

    multiDragMock.__mockDragInstances.length = 0;
    unmount60();

    const { unmount: unmount120 } = render(
      <DrawingSurface
        testID="drawing-surface-host"
        value={{ strokes: [] }}
        onChange={onChange120}
        tool="pen"
        strokeSmoothing={false}
      />
    );
    const host120 = screen.getByTestId('drawing-surface-host');
    mockHostRect(host120);
    const instance120 = latestDragInstance();

    // Simulate 120Hz rAF batches: ~8.33ms apart
    act(() => {
      instance120.emit(multiDragMock.DragOperationType.Move, [
        fingerWithTimestamps(
          [
            { x: 15, y: 25 },
            { x: 17.5, y: 27.5 },
            { x: 20, y: 30 },
            { x: 22.5, y: 32.5 },
            { x: 25, y: 35 },
            { x: 27.5, y: 37.5 },
            { x: 30, y: 40 },
            { x: 32.5, y: 42.5 },
            { x: 35, y: 45 },
            { x: 37.5, y: 47.5 },
            { x: 40, y: 50 },
          ],
          0,
          8.333
        ),
      ]);
    });
    act(() => {
      instance120.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
    });

    multiDragMock.__mockDragInstances.length = 0;
    unmount120();

    const { unmount: unmount144 } = render(
      <DrawingSurface
        testID="drawing-surface-host"
        value={{ strokes: [] }}
        onChange={onChange144}
        tool="pen"
        strokeSmoothing={false}
      />
    );
    const host144 = screen.getByTestId('drawing-surface-host');
    mockHostRect(host144);
    const instance144 = latestDragInstance();

    // Simulate 144Hz rAF batches: ~6.94ms apart
    act(() => {
      instance144.emit(multiDragMock.DragOperationType.Move, [
        fingerWithTimestamps(
          [
            { x: 15, y: 25 },
            { x: 17.143, y: 27.143 },
            { x: 19.286, y: 29.286 },
            { x: 21.429, y: 31.429 },
            { x: 23.571, y: 33.571 },
            { x: 25.714, y: 35.714 },
            { x: 27.857, y: 37.857 },
            { x: 30, y: 40 },
            { x: 32.143, y: 42.143 },
            { x: 34.286, y: 44.286 },
            { x: 36.429, y: 46.429 },
            { x: 38.571, y: 48.571 },
            { x: 40, y: 50 },
          ],
          0,
          6.944
        ),
      ]);
    });
    act(() => {
      instance144.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
    });

    const points60 = onChange60.mock.calls[0][0].strokes[0].points;
    const points120 = onChange120.mock.calls[0][0].strokes[0].points;
    const points144 = onChange144.mock.calls[0][0].strokes[0].points;

    // All should start at the same place
    expect(points60[0]).toEqual({ x: 5, y: 5, timestamp: 0 });
    expect(points120[0]).toEqual({ x: 5, y: 5, timestamp: 0 });
    expect(points144[0]).toEqual({ x: 5, y: 5, timestamp: 0 });

    // Counts should be similar (within 1-2 points)
    expect(Math.abs(points60.length - points120.length)).toBeLessThanOrEqual(2);
    expect(Math.abs(points120.length - points144.length)).toBeLessThanOrEqual(2);

    unmount60();
    unmount120();
    unmount144();
  });
});
