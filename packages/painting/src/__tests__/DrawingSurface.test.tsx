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

  it('pinch feasibility two pointer default-off gesture ignores second pointer while preserving one pointer drawing', () => {
    const onChange = jest.fn();
    const { container } = render(
      <DrawingSurface
        testID="drawing-surface-host"
        value={{ strokes: [] }}
        onChange={onChange}
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
        ]),
      ]);
    });

    expect(container.querySelector('path')?.getAttribute('d')).toBe('M 5 5 L 10 15');

    act(() => {
      instance.emit(multiDragMock.DragOperationType.Move, [
        finger([
          { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 } },
          { point: { x: 20, y: 35 }, event: { pointerType: 'pen', button: 0 } },
        ]),
        finger([
          { point: { x: 80, y: 90 }, event: { pointerType: 'touch' } },
          { point: { x: 85, y: 95 }, event: { pointerType: 'touch' } },
        ]),
      ]);
    });

    expect(container.querySelector('path')?.getAttribute('d')).toBe('M 5 5 L 10 15');

    act(() => {
      instance.emit(multiDragMock.DragOperationType.Move, [
        finger([
          { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 } },
          { point: { x: 20, y: 35 }, event: { pointerType: 'pen', button: 0 } },
          { point: { x: 30, y: 45 }, event: { pointerType: 'pen', button: 0 } },
        ]),
      ]);
    });

    expect(container.querySelector('path')).toBeTruthy();

    act(() => {
      instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].strokes[0].points).toEqual([
      { x: 5, y: 5 },
      { x: 10, y: 15 },
      { x: 20, y: 25 },
    ]);
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

  it('renders dashed open line from DrawingSurface props with fill none', () => {
    const onChange = jest.fn();
    const { container, rerender } = render(
      <DrawingSurface
        testID="drawing-surface-host"
        value={{ strokes: [] }}
        onChange={onChange}
        tool="line"
        dashArray={[5, 2]}
        dashOffset={1}
      />
    );
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
      instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].strokes[0]).toMatchObject({
      dashArray: [5, 2],
      dashOffset: 1,
    });

    rerender(
      <DrawingSurface
        testID="drawing-surface-host"
        value={onChange.mock.calls[0][0]}
        onChange={onChange}
        tool="line"
        dashArray={[5, 2]}
        dashOffset={1}
      />
    );

    const line = container.querySelector('line');
    expect(line?.getAttribute('stroke-dasharray')).toBe('5 2');
    expect(line?.getAttribute('stroke-dashoffset')).toBe('1');
    expect(line?.getAttribute('fill')).toBe('none');
  });

  it('renders fill-only rect with no stroke when strokeWidth is zero', () => {
    const { container } = render(
      <DrawingSurface
        value={{
          strokes: [
            {
              id: 'fill-only-rect',
              tool: 'rect' as const,
              points: [
                { x: 0, y: 0 },
                { x: 20, y: 10 },
              ],
            },
          ],
        }}
        strokeWidth={0}
        fillColor="#ff0000"
      />
    );

    const rect = container.querySelector('rect');
    expect(rect?.getAttribute('fill')).toBe('#ff0000');
    expect(rect?.getAttribute('fill-opacity')).toBe('1');
    expect(rect?.hasAttribute('stroke')).toBe(false);
    expect(rect?.hasAttribute('stroke-width')).toBe(false);
  });

  it('defaults closed-shape stroke width to one when omitted', () => {
    const { container } = render(
      <DrawingSurface
        value={{
          strokes: [
            {
              id: 'default-width-rect',
              tool: 'rect' as const,
              points: [
                { x: 0, y: 0 },
                { x: 20, y: 10 },
              ],
            },
          ],
        }}
      />
    );

    expect(container.querySelector('rect')?.getAttribute('stroke-width')).toBe('1');
  });

  it('normalizes invalid dash arrays from DrawingSurface props to solid strokes', () => {
    for (const dashArray of [[], [0], [Number.NaN, 2]]) {
      const { container, unmount } = render(
        <DrawingSurface
          value={{
            strokes: [
              {
                id: `solid-line-${dashArray.length}`,
                tool: 'line' as const,
                points: [
                  { x: 0, y: 0 },
                  { x: 20, y: 10 },
                ],
              },
            ],
          }}
          dashArray={dashArray}
        />
      );

      expect(container.querySelector('line')?.hasAttribute('stroke-dasharray')).toBe(false);
      unmount();
    }
  });

  it('eraser deletes a fill-only rect by clicking inside the fill', () => {
    const onChange = jest.fn();
    render(
      <DrawingSurface
        testID="drawing-surface-host"
        value={{
          strokes: [
            {
              id: 'erasable-fill-only-rect',
              tool: 'rect' as const,
              points: [
                { x: 0, y: 0 },
                { x: 40, y: 40 },
              ],
              strokeWidth: 0,
              fillColor: '#ff0000',
            },
          ],
        }}
        onChange={onChange}
        tool="eraser"
      />
    );
    const host = screen.getByTestId('drawing-surface-host');
    mockHostRect(host);
    const instance = latestDragInstance();

    act(() => {
      instance.emit(multiDragMock.DragOperationType.Move, [
        finger([
          {
            point: { x: 30, y: 40 },
            event: { pointerType: 'pen', button: 0, clientX: 30, clientY: 40 },
          },
        ]),
      ]);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].strokes).toEqual([]);
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

  // Sampling rate tests
  describe('samplingRate', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('samplingRate=0 preserves immediate RAF-synced behavior (default)', () => {
      const onChange = jest.fn();
      const { container } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          samplingRate={0}
          strokeSmoothing={false}
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);
      const instance = latestDragInstance();

      // Emit multiple rapid move events
      act(() => {
        instance.emit(multiDragMock.DragOperationType.Move, [
          finger([
            { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 }, timestamp: 100 },
          ]),
        ]);
        instance.emit(multiDragMock.DragOperationType.Move, [
          finger([
            { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 }, timestamp: 100 },
            { point: { x: 20, y: 35 }, event: { pointerType: 'pen', button: 0 }, timestamp: 100 },
          ]),
        ]);
        instance.emit(multiDragMock.DragOperationType.Move, [
          finger([
            { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 }, timestamp: 100 },
            { point: { x: 20, y: 35 }, event: { pointerType: 'pen', button: 0 }, timestamp: 100 },
            { point: { x: 25, y: 45 }, event: { pointerType: 'pen', button: 0 }, timestamp: 110 },
          ]),
        ]);
      });

      // With samplingRate=0, points should be processed immediately (current behavior)
      const activePath = container.querySelector('path');
      expect(activePath).toBeTruthy();
      // Should contain the last point coordinates
      expect(activePath?.getAttribute('d')).toContain('10');
      expect(activePath?.getAttribute('d')).toContain('15');
    });

    it('samplingRate=30 buffers input and samples at configured FPS', () => {
      const onChange = jest.fn();
      const { container } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          samplingRate={30}
          strokeSmoothing={false}
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);
      const instance = latestDragInstance();

      // Emit rapid move events with timestamps 50ms apart ( > 33ms threshold for 30fps)
      act(() => {
        instance.emit(multiDragMock.DragOperationType.Move, [
          finger([
            { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 }, timestamp: 100 },
          ]),
        ]);
      });

      act(() => {
        instance.emit(multiDragMock.DragOperationType.Move, [
          finger([
            { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 }, timestamp: 100 },
            { point: { x: 20, y: 35 }, event: { pointerType: 'pen', button: 0 }, timestamp: 150 },
          ]),
        ]);
      });

      // With samplingRate=30, active stroke should be updated immediately (display always refreshes)
      const activePath = container.querySelector('path');
      expect(activePath).toBeTruthy();

      // Complete the stroke
      act(() => {
        instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
      });

      expect(onChange).toHaveBeenCalledTimes(1);
      const committedStroke = onChange.mock.calls[0][0].strokes[0];
      // Both points have timestamp 100 and 150 (50ms apart > 33ms threshold), so both kept
      expect(committedStroke.points.length).toBe(2);
    });

    it('AllEnd flushes pending samples before committing', () => {
      const onChange = jest.fn();
      render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          samplingRate={10}
          strokeSmoothing={false}
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);
      const instance = latestDragInstance();

      // Emit move events with timestamps far enough apart for samplingRate=10 (100ms interval)
      act(() => {
        instance.emit(multiDragMock.DragOperationType.Move, [
          finger([
            { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 }, timestamp: 100 },
            { point: { x: 20, y: 35 }, event: { pointerType: 'pen', button: 0 }, timestamp: 200 },
          ]),
        ]);
      });

      // End immediately
      act(() => {
        instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
      });

      // Should commit the stroke with downsampled points
      expect(onChange).toHaveBeenCalledTimes(1);
      const committedStroke = onChange.mock.calls[0][0].strokes[0];
      // Both points are 100ms apart, which meets the 100ms threshold for samplingRate=10
      expect(committedStroke.points.length).toBe(2);
      expect(committedStroke.points[0]).toMatchObject({ x: 5, y: 5 });
      expect(committedStroke.points[1]).toMatchObject({ x: 10, y: 15 });
    });

    it('changing samplingRate during drawing updates scheduler without losing pending points', () => {
      const onChange = jest.fn();
      const { rerender, container } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          samplingRate={30}
          strokeSmoothing={false}
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);
      const instance = latestDragInstance();

      // Start drawing with samplingRate=30 (33ms interval)
      act(() => {
        instance.emit(multiDragMock.DragOperationType.Move, [
          finger([
            { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 }, timestamp: 100 },
          ]),
        ]);
      });

      // Change sampling rate to 10 mid-draw (100ms interval)
      rerender(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          samplingRate={10}
          strokeSmoothing={false}
        />
      );

      // Continue drawing with timestamps 150ms apart ( > 100ms threshold)
      act(() => {
        instance.emit(multiDragMock.DragOperationType.Move, [
          finger([
            { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 }, timestamp: 100 },
            { point: { x: 20, y: 35 }, event: { pointerType: 'pen', button: 0 }, timestamp: 250 },
          ]),
        ]);
      });

      // Display should always be updated
      const activePath = container.querySelector('path');
      expect(activePath).toBeTruthy();

      // Complete stroke
      act(() => {
        instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
      });

      expect(onChange).toHaveBeenCalledTimes(1);
      const committedStroke = onChange.mock.calls[0][0].strokes[0];
      // Both points are 150ms apart > 100ms threshold, so both kept
      expect(committedStroke.points.length).toBe(2);
    });

    it('changing samplingRate from 0 to fixed mid-draw starts sampling loop', () => {
      const onChange = jest.fn();
      const { rerender, container } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          samplingRate={0}
          strokeSmoothing={false}
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);
      const instance = latestDragInstance();

      // Start drawing with samplingRate=0 (auto mode, keep all points)
      act(() => {
        instance.emit(multiDragMock.DragOperationType.Move, [
          finger([
            { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 }, timestamp: 100 },
          ]),
        ]);
      });

      // In auto mode, active stroke should be visible immediately
      const activePathAuto = container.querySelector('path');
      expect(activePathAuto).toBeTruthy();

      // Change to fixed rate mid-draw
      rerender(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          samplingRate={10}
          strokeSmoothing={false}
        />
      );

      // Continue drawing with timestamps 150ms apart ( > 100ms threshold)
      act(() => {
        instance.emit(multiDragMock.DragOperationType.Move, [
          finger([
            { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 }, timestamp: 100 },
            { point: { x: 30, y: 45 }, event: { pointerType: 'pen', button: 0 }, timestamp: 250 },
          ]),
        ]);
      });

      // Display should always be updated
      const activePath = container.querySelector('path');
      expect(activePath).toBeTruthy();

      // Complete stroke
      act(() => {
        instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
      });

      expect(onChange).toHaveBeenCalledTimes(1);
      const committedStroke = onChange.mock.calls[0][0].strokes[0];
      // Both points are 150ms apart > 100ms threshold, so both kept
      expect(committedStroke.points.length).toBe(2);
    });

    it('invalid samplingRate values normalize to 0 (auto)', () => {
      const onChange = jest.fn();
      const { container } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          samplingRate={-1}
          strokeSmoothing={false}
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);
      const instance = latestDragInstance();

      // Should behave like samplingRate=0 (immediate processing)
      act(() => {
        instance.emit(multiDragMock.DragOperationType.Move, [
          finger([
            { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 }, timestamp: 100 },
            { point: { x: 20, y: 35 }, event: { pointerType: 'pen', button: 0 }, timestamp: 110 },
          ]),
        ]);
      });

      const activePath = container.querySelector('path');
      expect(activePath).toBeTruthy();
      expect(activePath?.getAttribute('d')).toContain('10');
      expect(activePath?.getAttribute('d')).toContain('15');
    });

    it('samplingRate omits prop defaults to 0 (auto)', () => {
      const onChange = jest.fn();
      const { container } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          strokeSmoothing={false}
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);
      const instance = latestDragInstance();

      // Should behave like samplingRate=0 (immediate processing)
      act(() => {
        instance.emit(multiDragMock.DragOperationType.Move, [
          finger([
            { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 }, timestamp: 100 },
            { point: { x: 20, y: 35 }, event: { pointerType: 'pen', button: 0 }, timestamp: 110 },
          ]),
        ]);
      });

      const activePath = container.querySelector('path');
      expect(activePath).toBeTruthy();
      expect(activePath?.getAttribute('d')).toContain('10');
      expect(activePath?.getAttribute('d')).toContain('15');
    });
  });

  describe('ellipse tool', () => {
    function emitEllipseDrag(
      instance: MockDragInstance,
      startX: number,
      startY: number,
      endX: number,
      endY: number,
    ) {
      act(() => {
        instance.emit(multiDragMock.DragOperationType.Move, [
          finger([
            { point: { x: startX, y: startY }, event: { pointerType: 'pen', button: 0 } },
            { point: { x: endX, y: endY }, event: { pointerType: 'pen', button: 0 } },
          ]),
        ]);
      });
    }

    it('renders active ellipse preview during drag', () => {
      const { container } = render(<DrawingSurface testID="drawing-surface-host" tool="ellipse" />);
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);
      const instance = latestDragInstance();

      emitEllipseDrag(instance, 20, 40, 120, 90);

      const ellipseEl = container.querySelector('ellipse');
      expect(ellipseEl).toBeTruthy();
      expect(ellipseEl.getAttribute('fill')).toBe('none');
      expect(ellipseEl.getAttribute('opacity')).toBe('0.7');
    });

    it('commits completed ellipse stroke on drag all-end', () => {
      const onChange = jest.fn();
      const { container } = render(
        <DrawingSurface testID="drawing-surface-host" value={{ strokes: [] }} onChange={onChange} tool="ellipse" />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);
      const instance = latestDragInstance();

      emitEllipseDrag(instance, 20, 40, 120, 90);

      expect(container.querySelector('ellipse')).toBeTruthy();
      expect(onChange).not.toHaveBeenCalled();

      act(() => {
        instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
      });

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0][0].strokes).toHaveLength(1);
      expect(onChange.mock.calls[0][0].strokes[0].tool).toBe('ellipse');
      expect(container.querySelector('ellipse')).toBeNull();
    });

    it('ellipse bbox produces correct cx cy rx ry from drag corners', () => {
      const onChange = jest.fn();
      const { container } = render(
        <DrawingSurface testID="drawing-surface-host" value={{ strokes: [] }} onChange={onChange} tool="ellipse" />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);
      const instance = latestDragInstance();

      // local (10,20) -> (110,70) after subtracting host rect (left=10, top=20)
      emitEllipseDrag(instance, 20, 40, 120, 90);

      const ellipseEl = container.querySelector('ellipse');
      expect(ellipseEl).toBeTruthy();
      expect(Number(ellipseEl.getAttribute('cx'))).toBe(60);
      expect(Number(ellipseEl.getAttribute('cy'))).toBe(45);
      expect(Number(ellipseEl.getAttribute('rx'))).toBe(50);
      expect(Number(ellipseEl.getAttribute('ry'))).toBe(25);
    });

    it('reverse drag ellipse normalizes to non-negative rx ry', () => {
      const { container } = render(<DrawingSurface testID="drawing-surface-host" tool="ellipse" />);
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);
      const instance = latestDragInstance();

      // drag from bottom-right to top-left
      emitEllipseDrag(instance, 120, 90, 20, 40);

      const ellipseEl = container.querySelector('ellipse');
      expect(ellipseEl).toBeTruthy();
      expect(Number(ellipseEl.getAttribute('rx'))).toBe(50);
      expect(Number(ellipseEl.getAttribute('ry'))).toBe(25);
      expect(Number(ellipseEl.getAttribute('cx'))).toBe(60);
      expect(Number(ellipseEl.getAttribute('cy'))).toBe(45);
    });

    it('active ellipse preview respects strokeColor and strokeWidth', () => {
      const { container } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          tool="ellipse"
          strokeColor="#00ff00"
          strokeWidth={9}
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);
      const instance = latestDragInstance();

      emitEllipseDrag(instance, 20, 40, 120, 90);

      const ellipseEl = container.querySelector('ellipse');
      expect(ellipseEl).toBeTruthy();
      expect(ellipseEl.getAttribute('stroke')).toBe('#00ff00');
      expect(ellipseEl.getAttribute('stroke-width')).toBe('9');
    });

    it('committed ellipse tool stroke uses closed-shape default strokeWidth of 1', () => {
      const onChange = jest.fn();
      render(
        <DrawingSurface testID="drawing-surface-host" value={{ strokes: [] }} onChange={onChange} tool="ellipse" />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);
      const instance = latestDragInstance();

      emitEllipseDrag(instance, 20, 40, 120, 90);

      act(() => {
        instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
      });

      expect(onChange.mock.calls[0][0].strokes[0].strokeWidth).toBe(1);
    });

    it('eraser deletes a filled ellipse by clicking inside the fill', () => {
      const onChange = jest.fn();
      render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{
            strokes: [
              {
                id: 'erasable-ellipse',
                tool: 'ellipse' as const,
                points: [
                  { x: 0, y: 0 },
                  { x: 40, y: 40 },
                ],
                strokeWidth: 0,
                fillColor: '#ff0000',
              },
            ],
          }}
          onChange={onChange}
          tool="eraser"
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);
      const instance = latestDragInstance();

      act(() => {
        instance.emit(multiDragMock.DragOperationType.Move, [
          finger([
            {
              point: { x: 30, y: 40 },
              event: { pointerType: 'pen', button: 0, clientX: 30, clientY: 40 },
            },
          ]),
        ]);
      });

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0][0].strokes).toEqual([]);
    });
  });

  describe('Shift constraint', () => {
    function shiftDown() {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
    }

    function shiftUp() {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
    }

    it('Shift+rect produces square (equal width/height)', () => {
      const onChange = jest.fn();
      const { container } = render(
        <DrawingSurface testID="drawing-surface-host" value={{ strokes: [] }} onChange={onChange} tool="rect" />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);
      const instance = latestDragInstance();

      shiftDown();
      act(() => {
        instance.emit(multiDragMock.DragOperationType.Move, [
          finger([
            { point: { x: 20, y: 40 }, event: { pointerType: 'pen', button: 0 } },
            // drag 100x50 -> constrained to 100x100 (max abs delta preserves sign)
            { point: { x: 120, y: 90 }, event: { pointerType: 'pen', button: 0 } },
          ]),
        ]);
      });

      const rectEl = container.querySelector('rect');
      expect(rectEl).toBeTruthy();
      const w = Number(rectEl.getAttribute('width'));
      const h = Number(rectEl.getAttribute('height'));
      expect(w).toBe(h);
      expect(w).toBe(100);
      // constrained: x=10, y=20, size=100 (drag dy positive so y unchanged)
      expect(Number(rectEl.getAttribute('x'))).toBe(10);
      expect(Number(rectEl.getAttribute('y'))).toBe(20);
    });

    it('Shift+ellipse produces circle (equal rx/ry)', () => {
      const onChange = jest.fn();
      const { container } = render(
        <DrawingSurface testID="drawing-surface-host" value={{ strokes: [] }} onChange={onChange} tool="ellipse" />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);
      const instance = latestDragInstance();

      shiftDown();
      act(() => {
        instance.emit(multiDragMock.DragOperationType.Move, [
          finger([
            { point: { x: 20, y: 40 }, event: { pointerType: 'pen', button: 0 } },
            // drag 100x50 -> constrained to 100x100
            { point: { x: 120, y: 90 }, event: { pointerType: 'pen', button: 0 } },
          ]),
        ]);
      });

      const ellipseEl = container.querySelector('ellipse');
      expect(ellipseEl).toBeTruthy();
      const rx = Number(ellipseEl.getAttribute('rx'));
      const ry = Number(ellipseEl.getAttribute('ry'));
      expect(rx).toBe(ry);
      expect(rx).toBe(50);
      // cx = 10 + 100/2 = 60, cy = 20 + 100/2 = 70
      expect(Number(ellipseEl.getAttribute('cx'))).toBe(60);
      expect(Number(ellipseEl.getAttribute('cy'))).toBe(70);
    });

    it('Shift not held leaves rect unconstrained', () => {
      const { container } = render(<DrawingSurface testID="drawing-surface-host" tool="rect" />);
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);
      const instance = latestDragInstance();

      act(() => {
        instance.emit(multiDragMock.DragOperationType.Move, [
          finger([
            { point: { x: 20, y: 40 }, event: { pointerType: 'pen', button: 0 } },
            { point: { x: 120, y: 90 }, event: { pointerType: 'pen', button: 0 } },
          ]),
        ]);
      });

      const rectEl = container.querySelector('rect');
      expect(Number(rectEl.getAttribute('width'))).toBe(100);
      expect(Number(rectEl.getAttribute('height'))).toBe(50);
    });

    it('Shift+rect commits square stroke', () => {
      const onChange = jest.fn();
      render(
        <DrawingSurface testID="drawing-surface-host" value={{ strokes: [] }} onChange={onChange} tool="rect" />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);
      const instance = latestDragInstance();

      shiftDown();
      act(() => {
        instance.emit(multiDragMock.DragOperationType.Move, [
          finger([
            { point: { x: 20, y: 40 }, event: { pointerType: 'pen', button: 0 } },
            { point: { x: 120, y: 90 }, event: { pointerType: 'pen', button: 0 } },
          ]),
        ]);
      });
      act(() => {
        instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
      });
      shiftUp();

      expect(onChange).toHaveBeenCalledTimes(1);
      const stroke = onChange.mock.calls[0][0].strokes[0];
      const dx = Math.abs(stroke.points[1].x - stroke.points[0].x);
      const dy = Math.abs(stroke.points[1].y - stroke.points[0].y);
      expect(dx).toBe(dy);
      expect(dx).toBe(100);
    });

    it('Shift+ellipse commits circle stroke', () => {
      const onChange = jest.fn();
      render(
        <DrawingSurface testID="drawing-surface-host" value={{ strokes: [] }} onChange={onChange} tool="ellipse" />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);
      const instance = latestDragInstance();

      shiftDown();
      act(() => {
        instance.emit(multiDragMock.DragOperationType.Move, [
          finger([
            { point: { x: 20, y: 40 }, event: { pointerType: 'pen', button: 0 } },
            { point: { x: 120, y: 90 }, event: { pointerType: 'pen', button: 0 } },
          ]),
        ]);
      });
      act(() => {
        instance.emit(multiDragMock.DragOperationType.AllEnd, [finger([])]);
      });
      shiftUp();

      expect(onChange).toHaveBeenCalledTimes(1);
      const stroke = onChange.mock.calls[0][0].strokes[0];
      const dx = Math.abs(stroke.points[1].x - stroke.points[0].x);
      const dy = Math.abs(stroke.points[1].y - stroke.points[0].y);
      expect(dx).toBe(dy);
      expect(dx).toBe(100);
    });

    it('Shift state resets on window blur', () => {
      const onChange = jest.fn();
      const { container } = render(
        <DrawingSurface testID="drawing-surface-host" value={{ strokes: [] }} onChange={onChange} tool="rect" />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);
      const instance = latestDragInstance();

      shiftDown();
      window.dispatchEvent(new Event('blur'));

      act(() => {
        instance.emit(multiDragMock.DragOperationType.Move, [
          finger([
            { point: { x: 20, y: 40 }, event: { pointerType: 'pen', button: 0 } },
            { point: { x: 120, y: 90 }, event: { pointerType: 'pen', button: 0 } },
          ]),
        ]);
      });

      const rectEl = container.querySelector('rect');
      expect(Number(rectEl.getAttribute('width'))).toBe(100);
      expect(Number(rectEl.getAttribute('height'))).toBe(50);
    });

    it('pen tool is not affected by Shift constraint', () => {
      const onChange = jest.fn();
      const { container } = render(
        <DrawingSurface testID="drawing-surface-host" value={{ strokes: [] }} onChange={onChange} tool="pen" />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);
      const instance = latestDragInstance();

      shiftDown();
      act(() => {
        instance.emit(multiDragMock.DragOperationType.Move, [
          finger([
            { point: { x: 20, y: 40 }, event: { pointerType: 'pen', button: 0 } },
            { point: { x: 120, y: 90 }, event: { pointerType: 'pen', button: 0 } },
          ]),
        ]);
      });

      const path = container.querySelector('path');
      expect(path).toBeTruthy();
      // Pen should render as path, not constrained shape
      expect(path.getAttribute('d')).toBe('M 10 20 L 110 70');
    });
  });

  describe('line click-to-place tool', () => {
    function pointerDown(host: HTMLElement, clientX: number, clientY: number, pointerId = 1) {
      const event = new Event('pointerdown', { bubbles: true, cancelable: true });
      Object.assign(event, { clientX, clientY, pointerId, button: 0, detail: 1 });
      act(() => {
        host.dispatchEvent(event);
      });
    }

    function pointerUp(host: HTMLElement, clientX: number, clientY: number, pointerId = 1) {
      const event = new Event('pointerup', { bubbles: true, cancelable: true });
      Object.assign(event, { clientX, clientY, pointerId, button: 0, detail: 1 });
      act(() => {
        host.dispatchEvent(event);
      });
    }

    function pointerMove(host: HTMLElement, clientX: number, clientY: number, pointerId = 1) {
      const event = new Event('pointermove', { bubbles: true, cancelable: true });
      Object.assign(event, { clientX, clientY, pointerId });
      act(() => {
        host.dispatchEvent(event);
      });
    }

    function clickVertex(host: HTMLElement, clientX: number, clientY: number) {
      pointerDown(host, clientX, clientY);
      pointerUp(host, clientX, clientY);
    }

    function doubleClick(host: HTMLElement, clientX: number, clientY: number) {
      const event = new Event('dblclick', { bubbles: true, cancelable: true });
      Object.assign(event, { clientX, clientY });
      act(() => {
        host.dispatchEvent(event);
      });
    }

    function escapeKey() {
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
    }

    it('commits one v2 multi-segment line from clicks plus dblclick', () => {
      const onChange = jest.fn();
      render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="line"
        />,
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      clickVertex(host, 20, 30);
      clickVertex(host, 60, 30);
      clickVertex(host, 60, 80);
      doubleClick(host, 100, 80);

      expect(onChange).toHaveBeenCalledTimes(1);
      const committed = onChange.mock.calls[0][0].strokes[0];
      expect(committed).toMatchObject({ tool: 'line', schemaVersion: 2 });
      expect(committed.points).toEqual([
        { x: 10, y: 10 },
        { x: 50, y: 10 },
        { x: 50, y: 60 },
        { x: 90, y: 60 },
      ]);
    });

    it('single line click then Escape commits no stroke', () => {
      const onChange = jest.fn();
      render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="line"
        />,
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      clickVertex(host, 20, 30);
      escapeKey();

      expect(onChange).not.toHaveBeenCalled();
    });

    it('renders dashed continuous line preview across every segment', () => {
      const { container } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          tool="line"
          dashArray={[5, 2]}
          dashOffset={1}
        />,
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      clickVertex(host, 20, 30);
      clickVertex(host, 60, 30);
      pointerMove(host, 60, 80);

      const path = container.querySelector('path');
      expect(path).toBeTruthy();
      expect(path?.getAttribute('d')).toBe('M 10 10 L 50 10 L 50 60');
      expect(path?.getAttribute('stroke-dasharray')).toBe('5 2');
      expect(path?.getAttribute('stroke-dashoffset')).toBe('1');
      expect(path?.getAttribute('fill')).toBe('none');
    });

    it('ignores sub-threshold pointer movement as a click vertex', () => {
      const onChange = jest.fn();
      render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="line"
        />,
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      pointerDown(host, 20, 30);
      pointerMove(host, 22, 31);
      pointerUp(host, 22, 31);
      clickVertex(host, 60, 30);
      doubleClick(host, 60, 30);

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0][0].strokes[0].points).toEqual([
        { x: 12, y: 11 },
        { x: 50, y: 10 },
      ]);
    });
  });

  describe('polygon tool', () => {
    // jsdom does not implement PointerEvent constructor; dispatch a synthetic Event
    // with pointer-shaped fields (clientX/Y, pointerId, button) — the polygon listener
    // only reads property values, not prototype membership.
    function pointerDown(host: HTMLElement, clientX: number, clientY: number, detail = 1) {
      const event = new Event('pointerdown', { bubbles: true, cancelable: true });
      Object.assign(event, { clientX, clientY, pointerId: 1, button: 0, detail });
      act(() => {
        host.dispatchEvent(event);
      });
    }

    function pointerMove(host: HTMLElement, clientX: number, clientY: number) {
      const event = new Event('pointermove', { bubbles: true, cancelable: true });
      Object.assign(event, { clientX, clientY, pointerId: 1 });
      act(() => {
        host.dispatchEvent(event);
      });
    }

    function doubleClick(host: HTMLElement, clientX: number, clientY: number) {
      const event = new Event('dblclick', { bubbles: true, cancelable: true });
      Object.assign(event, { clientX, clientY });
      act(() => {
        host.dispatchEvent(event);
      });
    }

    function escapeKey() {
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
    }

    it('commits a polygon stroke after four clicks plus dblclick finish', () => {
      const onChange = jest.fn();
      const { container } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="polygon"
        />,
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      pointerDown(host, 20, 30);
      pointerDown(host, 60, 30);
      pointerDown(host, 60, 80);
      pointerDown(host, 20, 80);
      // dblclick finishes when >= 3 distinct vertices
      doubleClick(host, 20, 80);

      expect(onChange).toHaveBeenCalledTimes(1);
      const committed = onChange.mock.calls[0][0].strokes[0];
      expect(committed.tool).toBe('polygon');
      expect(committed.schemaVersion).toBe(2);
      expect(committed.points).toEqual([
        { x: 10, y: 10 },
        { x: 50, y: 10 },
        { x: 50, y: 60 },
        { x: 10, y: 60 },
      ]);
      // Active polygon preview cleared after commit
      expect(container.querySelectorAll('polygon').length).toBe(0);
    });

    it('does not commit polygon when dblclick fires with fewer than three distinct vertices', () => {
      const onChange = jest.fn();
      render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="polygon"
        />,
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      pointerDown(host, 20, 30);
      pointerDown(host, 60, 30);
      doubleClick(host, 60, 30);

      expect(onChange).not.toHaveBeenCalled();
    });

    it('Escape cancels in-progress polygon without committing', () => {
      const onChange = jest.fn();
      render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="polygon"
        />,
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      pointerDown(host, 20, 30);
      pointerDown(host, 60, 30);
      pointerDown(host, 60, 80);
      escapeKey();

      expect(onChange).not.toHaveBeenCalled();
    });

    it('clicking within 10 canvas px of first vertex closes polygon when >= 3 distinct vertices', () => {
      const onChange = jest.fn();
      render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="polygon"
        />,
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      // First vertex at canvas (10, 10); host offset adds (10, 20) -> client (20, 30)
      pointerDown(host, 20, 30);
      pointerDown(host, 60, 30);
      pointerDown(host, 60, 80);
      // Click near first vertex (within 10 px) — should close
      pointerDown(host, 25, 35);

      expect(onChange).toHaveBeenCalledTimes(1);
      const committed = onChange.mock.calls[0][0].strokes[0];
      expect(committed.tool).toBe('polygon');
      // Closing click is NOT added as a vertex — first three remain
      expect(committed.points).toEqual([
        { x: 10, y: 10 },
        { x: 50, y: 10 },
        { x: 50, y: 60 },
      ]);
    });

    it('renders polygon preview with placed vertices plus cursor edge', () => {
      const { container } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          tool="polygon"
        />,
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      pointerDown(host, 20, 30);
      pointerDown(host, 60, 30);
      pointerMove(host, 80, 80);

      const polygon = container.querySelector('polygon');
      expect(polygon).toBeTruthy();
      // Preview includes 2 placed vertices + cursor as third point
      expect(polygon?.getAttribute('points')).toBe('10,10 50,10 70,60');
      expect(polygon?.getAttribute('opacity')).toBe('0.7');
    });

    it('switching tool mid-polygon cancels the in-progress placement', () => {
      const onChange = jest.fn();
      const { container, rerender } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="polygon"
        />,
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      pointerDown(host, 20, 30);
      pointerDown(host, 60, 30);
      pointerDown(host, 60, 80);

      // Switch to pen — polygon state must reset, no commit
      rerender(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="pen"
        />,
      );

      expect(onChange).not.toHaveBeenCalled();
      expect(container.querySelector('polygon')).toBeNull();
    });

    it('eraser deletes a filled polygon by clicking inside the fill', () => {
      const onChange = jest.fn();
      render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{
            strokes: [
              {
                id: 'erasable-polygon',
                tool: 'polygon' as const,
                points: [
                  { x: 0, y: 0 },
                  { x: 40, y: 0 },
                  { x: 40, y: 40 },
                  { x: 0, y: 40 },
                ],
                strokeWidth: 0,
                fillColor: '#ff0000',
              },
            ],
          }}
          onChange={onChange}
          tool="eraser"
        />,
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);
      const instance = latestDragInstance();

      act(() => {
        instance.emit(multiDragMock.DragOperationType.Move, [
          finger([
            {
              point: { x: 30, y: 40 },
              event: { pointerType: 'pen', button: 0, clientX: 30, clientY: 40 },
            },
          ]),
        ]);
      });

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0][0].strokes).toEqual([]);
    });

    it('commits polygon with v2 schemaVersion and respects strokeColor/strokeWidth/fill props', () => {
      const onChange = jest.fn();
      render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="polygon"
          strokeColor="#00aa00"
          strokeWidth={3}
          fillColor="#aabbcc"
          fillOpacity={0.5}
        />,
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      pointerDown(host, 20, 30);
      pointerDown(host, 60, 30);
      pointerDown(host, 60, 80);
      doubleClick(host, 60, 80);

      const committed = onChange.mock.calls[0][0].strokes[0];
      expect(committed).toMatchObject({
        tool: 'polygon',
        schemaVersion: 2,
        strokeColor: '#00aa00',
        strokeWidth: 3,
        fillColor: '#aabbcc',
        fillOpacity: 0.5,
      });
    });
  });

  describe('bezier tool', () => {
    // Four clicks (start, cp1, cp2, end) commit one BezierStrokeV2.
    // Same jsdom workaround as polygon: dispatch synthetic Event with pointer-shaped fields.
    function pointerDown(host: HTMLElement, clientX: number, clientY: number, detail = 1) {
      const event = new Event('pointerdown', { bubbles: true, cancelable: true });
      Object.assign(event, { clientX, clientY, pointerId: 1, button: 0, detail });
      act(() => {
        host.dispatchEvent(event);
      });
    }

    function pointerMove(host: HTMLElement, clientX: number, clientY: number) {
      const event = new Event('pointermove', { bubbles: true, cancelable: true });
      Object.assign(event, { clientX, clientY, pointerId: 1 });
      act(() => {
        host.dispatchEvent(event);
      });
    }

    function escapeKey() {
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
    }

    it('commits one v2 bezier stroke from four clicks with cubic path d attribute', () => {
      const onChange = jest.fn();
      const { container, rerender } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="bezier"
        />,
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      // Host rect offset (10, 20). Client coords below become canvas (10,10), (30,40), (70,40), (90,10).
      pointerDown(host, 20, 30);
      pointerDown(host, 40, 60);
      pointerDown(host, 80, 60);
      pointerDown(host, 100, 30);

      expect(onChange).toHaveBeenCalledTimes(1);
      const committed = onChange.mock.calls[0][0].strokes[0];
      expect(committed).toMatchObject({ tool: 'bezier', schemaVersion: 2 });
      expect(committed.points).toEqual([
        { x: 10, y: 10 },
        { x: 30, y: 40 },
        { x: 70, y: 40 },
        { x: 90, y: 10 },
      ]);
      // No fill on open tool, regardless of any fillColor fallback prop.
      expect(committed.fillColor).toBeUndefined();
      expect(committed.fillOpacity).toBeUndefined();

      // Re-render with the committed strokes so the renderer draws the final path.
      rerender(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [committed] }}
          onChange={onChange}
          tool="bezier"
        />,
      );

      const path = container.querySelector('path');
      expect(path).toBeTruthy();
      expect(path?.getAttribute('d')).toBe('M 10 10 C 30 40 70 40 90 10');
      expect(path?.getAttribute('fill')).toBe('none');
    });

    it('Escape after two bezier clicks commits no stroke', () => {
      const onChange = jest.fn();
      render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="bezier"
        />,
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      pointerDown(host, 20, 30);
      pointerDown(host, 40, 60);
      escapeKey();

      expect(onChange).not.toHaveBeenCalled();
    });

    it('switching tool after one bezier click commits no stroke', () => {
      const onChange = jest.fn();
      const { rerender } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="bezier"
        />,
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      pointerDown(host, 20, 30);

      rerender(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="pen"
        />,
      );

      expect(onChange).not.toHaveBeenCalled();
    });

    it('bezier stroke renders dashed when dashArray is provided', () => {
      const onChange = jest.fn();
      const { container, rerender } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="bezier"
          dashArray={[6, 3]}
          dashOffset={2}
        />,
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      pointerDown(host, 20, 30);
      pointerDown(host, 40, 60);
      pointerDown(host, 80, 60);
      pointerDown(host, 100, 30);

      const committed = onChange.mock.calls[0][0].strokes[0];
      expect(committed.dashArray).toEqual([6, 3]);
      expect(committed.dashOffset).toBe(2);

      rerender(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [committed] }}
          onChange={onChange}
          tool="bezier"
          dashArray={[6, 3]}
          dashOffset={2}
        />,
      );

      const path = container.querySelector('path');
      expect(path?.getAttribute('stroke-dasharray')).toBe('6 3');
      expect(path?.getAttribute('stroke-dashoffset')).toBe('2');
    });

    it('renders bezier preview as control polyline while clicking', () => {
      const { container } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          tool="bezier"
        />,
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      pointerDown(host, 20, 30);
      pointerDown(host, 40, 60);
      pointerMove(host, 80, 60);

      // Preview reuses the v2 line branch — 2 placed + cursor → `M ... L ... L ...`.
      const path = container.querySelector('path');
      expect(path).toBeTruthy();
      expect(path?.getAttribute('d')).toBe('M 10 10 L 30 40 L 70 40');
      expect(path?.getAttribute('opacity')).toBe('0.7');
    });
  });

  describe('cursor crosshair overlay', () => {
    // jsdom does not implement PointerEvent — dispatch a plain Event and assign
    // pointer-shaped fields. React's synthetic pointer event normalization reads
    // these values without doing an instanceof check.
    function pointerEvent(
      type: 'pointerenter' | 'pointermove' | 'pointerleave' | 'pointerdown' | 'pointerup',
      props: { clientX?: number; clientY?: number; pointerType?: string; pointerId?: number } = {},
    ): Event {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, {
        clientX: 0,
        clientY: 0,
        pointerType: 'mouse',
        pointerId: 1,
        button: 0,
        isPrimary: true,
        ...props,
      });
      return event;
    }

    it('default mouse hover renders [data-crosshair] sized 10x10 outside the SVG', () => {
      const { container } = render(
        <DrawingSurface testID="drawing-surface-host" value={{ strokes: [] }} />,
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      expect(container.querySelector('[data-crosshair]')).toBeNull();

      act(() => {
        host.dispatchEvent(
          pointerEvent('pointerenter', { clientX: 50, clientY: 60, pointerType: 'mouse' }),
        );
      });

      const crosshair = container.querySelector('[data-crosshair]') as SVGSVGElement | null;
      expect(crosshair).toBeTruthy();
      expect(crosshair?.getAttribute('width')).toBe('10');
      expect(crosshair?.getAttribute('height')).toBe('10');
      // Crosshair element lives OUTSIDE the drawing SVG — the host's first child is
      // the drawing surface SVG; the crosshair sits in a sibling overlay div.
      const overlay = container.querySelector('[data-crosshair-layer]') as HTMLElement | null;
      expect(overlay).toBeTruthy();
      expect(overlay?.tagName).toBe('DIV');
      expect(overlay?.contains(crosshair as Node)).toBe(true);
      const drawingSvg = host.querySelector(':scope > svg');
      expect(drawingSvg?.contains(crosshair as Node)).toBe(false);

      act(() => {
        host.dispatchEvent(pointerEvent('pointerleave', { pointerType: 'mouse' }));
      });
      expect(container.querySelector('[data-crosshair]')).toBeNull();
    });

    it('cursor={false} removes [data-crosshair] entirely', () => {
      const { container } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          cursor={false}
        />,
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      act(() => {
        host.dispatchEvent(
          pointerEvent('pointerenter', { clientX: 50, clientY: 60, pointerType: 'mouse' }),
        );
        host.dispatchEvent(
          pointerEvent('pointermove', { clientX: 70, clientY: 80, pointerType: 'mouse' }),
        );
      });

      expect(container.querySelector('[data-crosshair]')).toBeNull();
      expect(container.querySelector('[data-crosshair-layer]')).toBeNull();
    });

    it('custom render prop receives screen + canvas coords and pointerType', () => {
      const renderSpy = jest.fn(() => <span data-testid="custom-cursor">x</span>);
      const { container } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          cursor={{ render: renderSpy }}
          tool="pen"
        />,
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      act(() => {
        host.dispatchEvent(
          pointerEvent('pointerenter', { clientX: 50, clientY: 70, pointerType: 'pen' }),
        );
      });

      // Host rect offset (left=10, top=20); screen and canvas coincide pre-Task-13.
      expect(renderSpy).toHaveBeenCalled();
      const lastCall = renderSpy.mock.calls[renderSpy.mock.calls.length - 1][0] as {
        screen: { x: number; y: number };
        canvas: { x: number; y: number };
        pointerType: string;
        activeTool: string;
        visible: boolean;
      };
      expect(lastCall.screen).toEqual({ x: 40, y: 50 });
      expect(lastCall.canvas).toEqual({ x: 40, y: 50 });
      expect(lastCall.pointerType).toBe('pen');
      expect(lastCall.activeTool).toBe('pen');
      expect(lastCall.visible).toBe(true);

      // Custom render replaces the default crosshair entirely.
      expect(container.querySelector('[data-crosshair]')).toBeNull();
      expect(screen.getByTestId('custom-cursor')).toBeTruthy();
    });

    it('touch shows crosshair only while pointer is down', () => {
      const { container } = render(
        <DrawingSurface testID="drawing-surface-host" value={{ strokes: [] }} />,
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      act(() => {
        host.dispatchEvent(
          pointerEvent('pointerenter', { clientX: 50, clientY: 60, pointerType: 'touch' }),
        );
      });
      expect(container.querySelector('[data-crosshair]')).toBeNull();

      act(() => {
        host.dispatchEvent(
          pointerEvent('pointerdown', { clientX: 55, clientY: 65, pointerType: 'touch' }),
        );
      });
      expect(container.querySelector('[data-crosshair]')).toBeTruthy();

      act(() => {
        host.dispatchEvent(
          pointerEvent('pointermove', { clientX: 60, clientY: 70, pointerType: 'touch' }),
        );
      });
      expect(container.querySelector('[data-crosshair]')).toBeTruthy();

      act(() => {
        host.dispatchEvent(
          pointerEvent('pointerup', { clientX: 60, clientY: 70, pointerType: 'touch' }),
        );
      });
      expect(container.querySelector('[data-crosshair]')).toBeNull();
    });
  });
});
