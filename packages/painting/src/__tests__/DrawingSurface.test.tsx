import { DrawingSurface as DrawingSurfaceFromIndex } from '@hamster-note/painting';
import { act, render, screen } from '@testing-library/react';
import { createRef, useState } from 'react';
import type {
  DrawingInputMethod,
  DrawingSurfaceHandle,
  DrawingStroke,
  DrawingTool,
  DrawingValue,
} from '../components/DrawingSurface';
import { DrawingSurface } from '../components/DrawingSurface';

type MockInputEvent = {
  pointerType?: string;
  button?: number;
  clientX?: number;
  clientY?: number;
  pointerId?: number;
  isPrimary?: boolean;
};

type PointerPathItem = {
  point: { x: number; y: number };
  event?: MockInputEvent;
  pressure?: number;
  timestamp?: number;
};

const activePointerIdsByHost = new WeakMap<HTMLElement, Set<number>>();
const dispatchedPathLengthByHost = new WeakMap<HTMLElement, Map<number, number>>();

function finger(path: PointerPathItem[]): PointerPathItem[] {
  return path;
}

function activePointerIds(host: HTMLElement): Set<number> {
  const existing = activePointerIdsByHost.get(host);
  if (existing) {
    return existing;
  }
  const created = new Set<number>();
  activePointerIdsByHost.set(host, created);
  return created;
}

function dispatchedPathLengths(host: HTMLElement): Map<number, number> {
  const existing = dispatchedPathLengthByHost.get(host);
  if (existing) {
    return existing;
  }
  const created = new Map<number, number>();
  dispatchedPathLengthByHost.set(host, created);
  return created;
}

function pointerIdForPath(path: PointerPathItem[], fallback: number): number {
  return path.find((item) => item.event?.pointerId !== undefined)?.event?.pointerId ?? fallback;
}

function createPointerEvent(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'pointerleave',
  item: PointerPathItem,
  pointerId: number
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const source = item.event ?? {};
  Object.assign(event, {
    clientX: source.clientX ?? item.point.x,
    clientY: source.clientY ?? item.point.y,
    pointerId,
    pointerType: source.pointerType,
    button: source.button ?? 0,
    pressure: item.pressure,
    isPrimary: source.isPrimary ?? pointerId === 1,
  });
  Object.defineProperty(event, 'timeStamp', { value: item.timestamp ?? 0 });
  return event;
}

function dispatchDragMove(host: HTMLElement, paths: PointerPathItem[][]) {
  const activeIds = activePointerIds(host);
  const pathLengths = dispatchedPathLengths(host);

  act(() => {
    paths.forEach((path, index) => {
      const firstItem = path[0];
      if (!firstItem) {
        return;
      }

      const pointerId = pointerIdForPath(path, index + 1);
      if (!activeIds.has(pointerId)) {
        host.dispatchEvent(createPointerEvent('pointerdown', firstItem, pointerId));
        activeIds.add(pointerId);
        pathLengths.set(pointerId, 1);
      }

      const previousLength = pathLengths.get(pointerId) ?? 0;
      const nextItems = path.slice(Math.max(previousLength, 1));
      const itemsToMove = nextItems.length > 0 ? nextItems : path.length === 1 ? [firstItem] : [];
      for (const item of itemsToMove) {
        host.dispatchEvent(createPointerEvent('pointermove', item, pointerId));
      }
      pathLengths.set(pointerId, Math.max(previousLength, path.length));
    });
    host.dispatchEvent(createPointerEvent('pointerleave', { point: { x: 0, y: 0 } }, 1));
  });
}

function dispatchDragEnd(host: HTMLElement, pointerId?: number) {
  const activeIds = activePointerIds(host);
  const pathLengths = dispatchedPathLengths(host);
  const pointerIds = pointerId !== undefined ? [pointerId] : Array.from(activeIds);

  act(() => {
    for (const activePointerId of pointerIds.length > 0 ? pointerIds : [1]) {
      host.dispatchEvent(
        createPointerEvent('pointerup', { point: { x: 0, y: 0 } }, activePointerId)
      );
      activeIds.delete(activePointerId);
      pathLengths.delete(activePointerId);
    }
  });
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

function emitCompletedStroke(host: HTMLElement, event: MockInputEvent) {
  dispatchDragMove(host, [
    finger([
      { point: { x: 15, y: 25 }, event },
      { point: { x: 20, y: 35 }, event },
    ]),
  ]);
  dispatchDragEnd(host);
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

  return { host, onChange, unmount };
}

function expectInputAccepted(
  inputMethods: DrawingInputMethod[] | undefined,
  event: MockInputEvent
) {
  const { host, onChange, unmount } = renderForInputMethods(inputMethods);

  emitCompletedStroke(host, event);

  expect(onChange).toHaveBeenCalledTimes(1);
  unmount();
}

function expectInputRejected(
  inputMethods: DrawingInputMethod[] | undefined,
  event: MockInputEvent
) {
  const { host, onChange, unmount } = renderForInputMethods(inputMethods);

  emitCompletedStroke(host, event);

  expect(onChange).not.toHaveBeenCalled();
  unmount();
}

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

  it('mounts native pointer input without legacy drag setup', () => {
    render(<DrawingSurface testID="drawing-surface-host" />);
    const host = screen.getByTestId('drawing-surface-host');

    expect(host.getAttribute('data-scale')).toBe('1');
    expect(host.getAttribute('data-tx')).toBe('0');
    expect(host.getAttribute('data-ty')).toBe('0');
  });

  it('unmounts after native pointer input setup', () => {
    const { unmount } = render(<DrawingSurface />);

    expect(() => unmount()).not.toThrow();
  });

  it('commits completed pen stroke on drag all-end', () => {
    const onChange = jest.fn();
    const { container } = render(
      <DrawingSurface testID="drawing-surface-host" value={{ strokes: [] }} onChange={onChange} />
    );
    const host = screen.getByTestId('drawing-surface-host');
    mockHostRect(host);

    act(() => {
      dispatchDragMove(host, [
        finger([
          { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 } },
          { point: { x: 20, y: 35 }, event: { pointerType: 'pen', button: 0 } },
        ]),
      ]);
    });

    expect(container.querySelector('path')?.getAttribute('d')).toBe('M 5 5 L 10 15');
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      dispatchDragEnd(host);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].strokes).toHaveLength(1);
    expect(onChange.mock.calls[0][0].strokes[0].points).toEqual([
      { x: 5, y: 5 },
      { x: 10, y: 15 },
    ]);
    expect(container.querySelector('path')).toBeNull();
  });

  it('commits an active pen stroke when pointerup is received on document', () => {
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

    act(() => {
      host.dispatchEvent(
        createPointerEvent(
          'pointerdown',
          { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 } },
          1
        )
      );
      document.dispatchEvent(
        createPointerEvent(
          'pointermove',
          { point: { x: 20, y: 35 }, event: { pointerType: 'pen', button: -1 } },
          1
        )
      );
      document.dispatchEvent(
        createPointerEvent(
          'pointerup',
          { point: { x: 20, y: 35 }, event: { pointerType: 'pen', button: 0 } },
          1
        )
      );
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].strokes[0].points).toEqual([
      { x: 5, y: 5 },
      { x: 10, y: 15 },
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
      <DrawingSurface
        testID="drawing-surface-host"
        value={{ strokes: [] }}
        onChange={onChange}
        tool="pen"
        strokeColor="#ff0000"
        strokeWidth={7}
      />
    );
    const host = screen.getByTestId('drawing-surface-host');
    mockHostRect(host);

    act(() => {
      dispatchDragMove(host, [
        finger([
          { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 } },
          { point: { x: 20, y: 35 }, event: { pointerType: 'pen', button: 0 } },
        ]),
      ]);
      dispatchDragEnd(host);
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

    act(() => {
      dispatchDragMove(host, [
        finger([
          { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 }, pressure: 0.2 },
          { point: { x: 20, y: 35 }, event: { pointerType: 'pen', button: 0 }, pressure: 0.8 },
        ]),
      ]);
    });

    expect(container.querySelector('path')).toBeNull();
    expect(container.querySelector('line')?.getAttribute('stroke-width')).toBe('8');

    act(() => {
      dispatchDragEnd(host);
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

  it('pressureMultiplier doubles active and committed pressure widths while stored pressure stays raw', () => {
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
        pressureMultiplier={2}
      />
    );
    const host = screen.getByTestId('drawing-surface-host');
    mockHostRect(host);

    act(() => {
      dispatchDragMove(host, [
        finger([
          { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 }, pressure: 0.2 },
          { point: { x: 20, y: 35 }, event: { pointerType: 'pen', button: 0 }, pressure: 0.8 },
        ]),
      ]);
    });

    expect(container.querySelector('path')).toBeNull();
    expect(container.querySelector('line')?.getAttribute('stroke-width')).toBe('16');

    act(() => {
      dispatchDragEnd(host);
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
        pressureMultiplier={2}
      />
    );

    expect(container.querySelector('path')).toBeNull();
    expect(container.querySelector('line')?.getAttribute('stroke-width')).toBe('16');
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

    act(() => {
      dispatchDragMove(host, [
        finger([
          { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 }, pressure: 0.2 },
          { point: { x: 20, y: 35 }, event: { pointerType: 'pen', button: 0 }, pressure: 0.8 },
        ]),
      ]);
    });

    expect(container.querySelector('path')?.getAttribute('stroke-width')).toBe('10');

    act(() => {
      dispatchDragEnd(host);
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

    act(() => {
      dispatchDragMove(host, [
        finger([
          { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 }, pressure: 0.2 },
          { point: { x: 20, y: 35 }, event: { pointerType: 'pen', button: 0 }, pressure: 0.8 },
        ]),
      ]);
    });

    expect(container.querySelector('path')?.getAttribute('stroke-width')).toBe('10');
    expect(container.querySelector('line')).toBeNull();

    act(() => {
      dispatchDragEnd(host);
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

    act(() => {
      dispatchDragMove(host, [
        finger([
          { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 }, pressure: 0.2 },
          { point: { x: 20, y: 35 }, event: { pointerType: 'pen', button: 0 }, pressure: 0.8 },
        ]),
      ]);
    });

    expect(container.querySelector('line')?.getAttribute('stroke-width')).toBe('10');

    act(() => {
      dispatchDragEnd(host);
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

    act(() => {
      dispatchDragMove(host, [
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
      dispatchDragEnd(host);
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

      act(() => {
        dispatchDragMove(host, [
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

    act(() => {
      dispatchDragMove(host, [
        finger([
          { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 } },
          { point: { x: 40, y: 55 }, event: { pointerType: 'pen', button: 0 } },
        ]),
      ]);
      dispatchDragEnd(host);
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

    act(() => {
      dispatchDragMove(host, [
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
    const { container } = render(<DrawingSurface tool={'marker' as unknown as DrawingTool} />);
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
      <DrawingSurface
        testID="drawing-surface-host"
        defaultValue={defaultValue}
        onChange={onChange}
      />
    );
    const host = screen.getByTestId('drawing-surface-host');
    mockHostRect(host);

    act(() => {
      dispatchDragMove(host, [
        finger([
          { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 } },
          { point: { x: 20, y: 35 }, event: { pointerType: 'pen', button: 0 } },
        ]),
      ]);
    });

    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      dispatchDragEnd(host);
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

  it('uncontrolled eraser deletion can notify a parent state update without render-phase warnings', () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const observedValues: DrawingStroke[][] = [];
    const defaultValue = {
      strokes: [
        {
          id: 'seed-1',
          tool: 'pen' as const,
          points: [
            { x: 10, y: 10 },
            { x: 100, y: 100 },
          ],
          strokeWidth: 20,
        },
      ],
    };

    function Parent() {
      const [, setLatestValue] = useState<DrawingValue>(defaultValue);

      return (
        <DrawingSurface
          testID="drawing-surface-host"
          defaultValue={defaultValue}
          onChange={(nextValue) => {
            observedValues.push(nextValue.strokes);
            setLatestValue(nextValue);
          }}
          tool="eraser"
          strokeWidth={20}
          eraserTrajectory={{ visible: true }}
        />
      );
    }

    const { container } = render(<Parent />);
    const host = screen.getByTestId('drawing-surface-host');
    mockHostRect(host);

    act(() => {
      dispatchDragMove(host, [
        finger([
          {
            point: { x: 20, y: 30 },
            event: { pointerType: 'pen', button: 0, clientX: 20, clientY: 30 },
          },
          {
            point: { x: 110, y: 120 },
            event: { pointerType: 'pen', button: 0, clientX: 110, clientY: 120 },
          },
        ]),
      ]);
    });

    expect(observedValues).toEqual([[]]);
    expect(container.querySelectorAll('path')).toHaveLength(0);
    const errorMessages = consoleErrorSpy.mock.calls.map((call) => call.join(' '));
    expect(errorMessages).not.toEqual(
      expect.arrayContaining([expect.stringContaining('Cannot update a component')])
    );
    consoleErrorSpy.mockRestore();
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
    const { container } = render(
      <DrawingSurface
        testID="drawing-surface-host"
        value={{ strokes: [] }}
        onChange={onChange}
        tool="rect"
      />
    );
    const host = screen.getByTestId('drawing-surface-host');
    mockHostRect(host);

    act(() => {
      dispatchDragMove(host, [
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
      dispatchDragEnd(host);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].strokes).toHaveLength(1);
    expect(onChange.mock.calls[0][0].strokes[0].tool).toBe('rect');
    expect(container.querySelector('rect')).toBeNull();
  });

  it('reverse drag renders normalized rect', () => {
    const onChange = jest.fn();
    const { container } = render(
      <DrawingSurface
        testID="drawing-surface-host"
        value={{ strokes: [] }}
        onChange={onChange}
        tool="rect"
      />
    );
    const host = screen.getByTestId('drawing-surface-host');
    mockHostRect(host);

    act(() => {
      dispatchDragMove(host, [
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

    act(() => {
      dispatchDragMove(host, [
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
    const { container } = render(
      <DrawingSurface
        testID="drawing-surface-host"
        value={{ strokes: [] }}
        onChange={onChange}
        tool="line"
      />
    );
    const host = screen.getByTestId('drawing-surface-host');
    mockHostRect(host);

    act(() => {
      dispatchDragMove(host, [
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
      dispatchDragEnd(host);
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

    act(() => {
      dispatchDragMove(host, [
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
    render(
      <DrawingSurface
        testID="drawing-surface-host"
        value={{ strokes: [] }}
        onChange={onChange}
        tool="line"
      />
    );
    const host = screen.getByTestId('drawing-surface-host');
    mockHostRect(host);

    act(() => {
      dispatchDragEnd(host);
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

    act(() => {
      dispatchDragMove(host, [
        finger([
          { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 } },
          { point: { x: 20, y: 35 }, event: { pointerType: 'pen', button: 0 } },
        ]),
      ]);
      dispatchDragEnd(host);
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
      dispatchDragMove(host, [
        finger([
          { point: { x: 50, y: 60 }, event: { pointerType: 'pen', button: 0 } },
          { point: { x: 55, y: 70 }, event: { pointerType: 'pen', button: 0 } },
        ]),
      ]);
      dispatchDragEnd(host);
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

    rerender(<DrawingSurface defaultValue={defaultValue} strokeColor="#0000ff" strokeWidth={10} />);

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

      // Emit multiple rapid move events
      act(() => {
        dispatchDragMove(host, [
          finger([
            { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 }, timestamp: 100 },
          ]),
        ]);
        dispatchDragMove(host, [
          finger([
            { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 }, timestamp: 100 },
            { point: { x: 20, y: 35 }, event: { pointerType: 'pen', button: 0 }, timestamp: 100 },
          ]),
        ]);
        dispatchDragMove(host, [
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

      // Emit rapid move events with timestamps 50ms apart ( > 33ms threshold for 30fps)
      act(() => {
        dispatchDragMove(host, [
          finger([
            { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 }, timestamp: 100 },
          ]),
        ]);
      });

      act(() => {
        dispatchDragMove(host, [
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
        dispatchDragEnd(host);
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

      // Emit move events with timestamps far enough apart for samplingRate=10 (100ms interval)
      act(() => {
        dispatchDragMove(host, [
          finger([
            { point: { x: 15, y: 25 }, event: { pointerType: 'pen', button: 0 }, timestamp: 100 },
            { point: { x: 20, y: 35 }, event: { pointerType: 'pen', button: 0 }, timestamp: 200 },
          ]),
        ]);
      });

      // End immediately
      act(() => {
        dispatchDragEnd(host);
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

      // Start drawing with samplingRate=30 (33ms interval)
      act(() => {
        dispatchDragMove(host, [
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
        dispatchDragMove(host, [
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
        dispatchDragEnd(host);
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

      // Start drawing with samplingRate=0 (auto mode, keep all points)
      act(() => {
        dispatchDragMove(host, [
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
        dispatchDragMove(host, [
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
        dispatchDragEnd(host);
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

      // Should behave like samplingRate=0 (immediate processing)
      act(() => {
        dispatchDragMove(host, [
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

      // Should behave like samplingRate=0 (immediate processing)
      act(() => {
        dispatchDragMove(host, [
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
      host: HTMLElement,
      startX: number,
      startY: number,
      endX: number,
      endY: number
    ) {
      act(() => {
        dispatchDragMove(host, [
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

      emitEllipseDrag(host, 20, 40, 120, 90);

      const ellipseEl = container.querySelector('ellipse');
      expect(ellipseEl).toBeTruthy();
      expect(ellipseEl.getAttribute('fill')).toBe('none');
      expect(ellipseEl.getAttribute('opacity')).toBe('0.7');
    });

    it('commits completed ellipse stroke on drag all-end', () => {
      const onChange = jest.fn();
      const { container } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="ellipse"
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      emitEllipseDrag(host, 20, 40, 120, 90);

      expect(container.querySelector('ellipse')).toBeTruthy();
      expect(onChange).not.toHaveBeenCalled();

      act(() => {
        dispatchDragEnd(host);
      });

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0][0].strokes).toHaveLength(1);
      expect(onChange.mock.calls[0][0].strokes[0].tool).toBe('ellipse');
      expect(container.querySelector('ellipse')).toBeNull();
    });

    it('ellipse bbox produces correct cx cy rx ry from drag corners', () => {
      const onChange = jest.fn();
      const { container } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="ellipse"
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      // local (10,20) -> (110,70) after subtracting host rect (left=10, top=20)
      emitEllipseDrag(host, 20, 40, 120, 90);

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

      // drag from bottom-right to top-left
      emitEllipseDrag(host, 120, 90, 20, 40);

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

      emitEllipseDrag(host, 20, 40, 120, 90);

      const ellipseEl = container.querySelector('ellipse');
      expect(ellipseEl).toBeTruthy();
      expect(ellipseEl.getAttribute('stroke')).toBe('#00ff00');
      expect(ellipseEl.getAttribute('stroke-width')).toBe('9');
    });

    it('committed ellipse tool stroke uses closed-shape default strokeWidth of 1', () => {
      const onChange = jest.fn();
      render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="ellipse"
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      emitEllipseDrag(host, 20, 40, 120, 90);

      act(() => {
        dispatchDragEnd(host);
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

      act(() => {
        dispatchDragMove(host, [
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
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="rect"
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      shiftDown();
      act(() => {
        dispatchDragMove(host, [
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
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="ellipse"
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      shiftDown();
      act(() => {
        dispatchDragMove(host, [
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

      act(() => {
        dispatchDragMove(host, [
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
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="rect"
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      shiftDown();
      act(() => {
        dispatchDragMove(host, [
          finger([
            { point: { x: 20, y: 40 }, event: { pointerType: 'pen', button: 0 } },
            { point: { x: 120, y: 90 }, event: { pointerType: 'pen', button: 0 } },
          ]),
        ]);
      });
      act(() => {
        dispatchDragEnd(host);
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
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="ellipse"
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      shiftDown();
      act(() => {
        dispatchDragMove(host, [
          finger([
            { point: { x: 20, y: 40 }, event: { pointerType: 'pen', button: 0 } },
            { point: { x: 120, y: 90 }, event: { pointerType: 'pen', button: 0 } },
          ]),
        ]);
      });
      act(() => {
        dispatchDragEnd(host);
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
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="rect"
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      shiftDown();
      act(() => {
        window.dispatchEvent(new Event('blur'));
      });

      act(() => {
        dispatchDragMove(host, [
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
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="pen"
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      shiftDown();
      act(() => {
        dispatchDragMove(host, [
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
        />
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
        />
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
        />
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
        />
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
        />
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
        />
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
        />
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
        />
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
        <DrawingSurface testID="drawing-surface-host" value={{ strokes: [] }} tool="polygon" />
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
        />
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
        />
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
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      act(() => {
        dispatchDragMove(host, [
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
        />
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
    function pointerDown(host: HTMLElement, clientX: number, clientY: number, pointerId = 1) {
      const event = new Event('pointerdown', { bubbles: true, cancelable: true });
      Object.assign(event, {
        clientX,
        clientY,
        pointerId,
        button: 0,
        detail: 1,
        pointerType: 'pen',
      });
      act(() => {
        host.dispatchEvent(event);
      });
    }

    function pointerMove(host: HTMLElement, clientX: number, clientY: number, pointerId = 1) {
      const event = new Event('pointermove', { bubbles: true, cancelable: true });
      Object.assign(event, { clientX, clientY, pointerId, pointerType: 'pen' });
      act(() => {
        host.dispatchEvent(event);
      });
    }

    function pointerUp(host: HTMLElement, clientX: number, clientY: number, pointerId = 1) {
      const event = new Event('pointerup', { bubbles: true, cancelable: true });
      Object.assign(event, {
        clientX,
        clientY,
        pointerId,
        button: 0,
        detail: 1,
        pointerType: 'pen',
      });
      act(() => {
        host.dispatchEvent(event);
      });
    }

    function dragBezierPoint(
      host: HTMLElement,
      from: { x: number; y: number },
      to: { x: number; y: number },
      pointerId = 1
    ) {
      pointerDown(host, from.x, from.y, pointerId);
      pointerMove(host, to.x, to.y, pointerId);
      pointerUp(host, to.x, to.y, pointerId);
    }

    function escapeKey() {
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
    }

    it('renders drag 1 preview as the start to end line', () => {
      const onChange = jest.fn();
      const { container } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="bezier"
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      pointerDown(host, 20, 30);
      pointerMove(host, 100, 30);

      const line = container.querySelector('line');
      expect(line).toBeTruthy();
      expect(line?.getAttribute('x1')).toBe('10');
      expect(line?.getAttribute('y1')).toBe('10');
      expect(line?.getAttribute('x2')).toBe('90');
      expect(line?.getAttribute('y2')).toBe('10');
      expect(line?.getAttribute('opacity')).toBe('0.7');
      expect(onChange).not.toHaveBeenCalled();
    });

    it('commits one v2 bezier stroke from three drags with cubic path and keeps bezier active', () => {
      const onChange = jest.fn();
      const { container, rerender } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="bezier"
          fillColor="#aabbcc"
          fillOpacity={0.4}
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      dragBezierPoint(host, { x: 20, y: 30 }, { x: 100, y: 30 });
      dragBezierPoint(host, { x: 35, y: 55 }, { x: 40, y: 60 });
      dragBezierPoint(host, { x: 75, y: 55 }, { x: 80, y: 60 });

      expect(onChange).toHaveBeenCalledTimes(1);
      const committed = onChange.mock.calls[0][0].strokes[0];
      expect(committed).toMatchObject({ tool: 'bezier', schemaVersion: 2 });
      expect(committed.points).toEqual([
        { x: 10, y: 10 },
        { x: 30, y: 40 },
        { x: 70, y: 40 },
        { x: 90, y: 10 },
      ]);
      expect(committed.fillColor).toBeUndefined();
      expect(committed.fillOpacity).toBeUndefined();
      expect(host.getAttribute('data-active-tool')).toBe('bezier');

      rerender(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [committed] }}
          onChange={onChange}
          tool="bezier"
          fillColor="#aabbcc"
          fillOpacity={0.4}
        />
      );

      const path = container.querySelector('path');
      expect(path).toBeTruthy();
      expect(path?.getAttribute('d')).toBe('M 10 10 C 30 40 70 40 90 10');
      expect(path?.getAttribute('fill')).toBe('none');

      dragBezierPoint(host, { x: 120, y: 120 }, { x: 140, y: 140 });
      expect(container.querySelector('line')).toBeTruthy();
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('Escape after partial bezier drags commits no stroke', () => {
      const onChange = jest.fn();
      render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="bezier"
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      dragBezierPoint(host, { x: 20, y: 30 }, { x: 100, y: 30 });
      pointerDown(host, 35, 55);
      pointerMove(host, 40, 60);
      escapeKey();

      expect(onChange).not.toHaveBeenCalled();
    });

    it('switching tool after one bezier drag commits no stroke', () => {
      const onChange = jest.fn();
      const { rerender } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="bezier"
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      dragBezierPoint(host, { x: 20, y: 30 }, { x: 100, y: 30 });

      rerender(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="pen"
        />
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
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      dragBezierPoint(host, { x: 20, y: 30 }, { x: 100, y: 30 });
      dragBezierPoint(host, { x: 35, y: 55 }, { x: 40, y: 60 });
      dragBezierPoint(host, { x: 75, y: 55 }, { x: 80, y: 60 });

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
        />
      );

      const path = container.querySelector('path');
      expect(path?.getAttribute('stroke-dasharray')).toBe('6 3');
      expect(path?.getAttribute('stroke-dashoffset')).toBe('2');
    });

    it('renders drag 2 preview with transient cp2=end and updates while dragging', () => {
      const onChange = jest.fn();
      const { container } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="bezier"
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      dragBezierPoint(host, { x: 20, y: 30 }, { x: 100, y: 30 });
      pointerDown(host, 30, 50);
      pointerMove(host, 40, 60);

      let path = container.querySelector('path');
      expect(path).toBeTruthy();
      expect(path?.getAttribute('d')).toBe('M 10 10 C 30 40 90 10 90 10');
      expect(path?.getAttribute('opacity')).toBe('0.7');

      pointerMove(host, 50, 70);
      path = container.querySelector('path');
      expect(path?.getAttribute('d')).toBe('M 10 10 C 40 50 90 10 90 10');
      expect(onChange).not.toHaveBeenCalled();

      pointerUp(host, 50, 70);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('renders drag 3 preview with full cubic control order before final commit', () => {
      const onChange = jest.fn();
      const { container } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          onChange={onChange}
          tool="bezier"
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      dragBezierPoint(host, { x: 20, y: 30 }, { x: 100, y: 30 });
      dragBezierPoint(host, { x: 35, y: 55 }, { x: 40, y: 60 });
      pointerDown(host, 75, 55);
      pointerMove(host, 80, 60);

      const path = container.querySelector('path');
      expect(path).toBeTruthy();
      expect(path?.getAttribute('d')).toBe('M 10 10 C 30 40 70 40 90 10');
      expect(path?.getAttribute('opacity')).toBe('0.7');
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('cursor crosshair overlay', () => {
    // jsdom does not implement PointerEvent — dispatch a plain Event and assign
    // pointer-shaped fields. React's synthetic pointer event normalization reads
    // these values without doing an instanceof check.
    function pointerEvent(
      type: 'pointerenter' | 'pointermove' | 'pointerleave' | 'pointerdown' | 'pointerup',
      props: { clientX?: number; clientY?: number; pointerType?: string; pointerId?: number } = {}
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
        <DrawingSurface testID="drawing-surface-host" value={{ strokes: [] }} />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      expect(container.querySelector('[data-crosshair]')).toBeNull();

      act(() => {
        host.dispatchEvent(
          pointerEvent('pointerenter', { clientX: 50, clientY: 60, pointerType: 'mouse' })
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
        <DrawingSurface testID="drawing-surface-host" value={{ strokes: [] }} cursor={false} />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      act(() => {
        host.dispatchEvent(
          pointerEvent('pointerenter', { clientX: 50, clientY: 60, pointerType: 'mouse' })
        );
        host.dispatchEvent(
          pointerEvent('pointermove', { clientX: 70, clientY: 80, pointerType: 'mouse' })
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
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      act(() => {
        host.dispatchEvent(
          pointerEvent('pointerenter', { clientX: 50, clientY: 70, pointerType: 'pen' })
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
        <DrawingSurface testID="drawing-surface-host" value={{ strokes: [] }} />
      );
      const host = screen.getByTestId('drawing-surface-host');
      mockHostRect(host);

      act(() => {
        host.dispatchEvent(
          pointerEvent('pointerenter', { clientX: 50, clientY: 60, pointerType: 'touch' })
        );
      });
      expect(container.querySelector('[data-crosshair]')).toBeNull();

      act(() => {
        host.dispatchEvent(
          pointerEvent('pointerdown', { clientX: 55, clientY: 65, pointerType: 'touch' })
        );
      });
      expect(container.querySelector('[data-crosshair]')).toBeTruthy();

      act(() => {
        host.dispatchEvent(
          pointerEvent('pointermove', { clientX: 60, clientY: 70, pointerType: 'touch' })
        );
      });
      expect(container.querySelector('[data-crosshair]')).toBeTruthy();

      act(() => {
        host.dispatchEvent(
          pointerEvent('pointerup', { clientX: 60, clientY: 70, pointerType: 'touch' })
        );
      });
      expect(container.querySelector('[data-crosshair]')).toBeNull();
    });
  });

  // Behavior-lock test: single-finger pen draw commits a stroke with
  // canvas-local coordinates derived from mockHostRect (clientX - left, clientY - top).
  it('single-finger draw commits a pen stroke (behavior lock)', () => {
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

    // mockHostRect has left=10, top=20 → canvas-local = client - offset
    // clientX:30,clientY:50 → {x:20,y:30}  clientX:60,clientY:90 → {x:50,y:70}
    act(() => {
      dispatchDragMove(host, [
        finger([
          {
            point: { x: 30, y: 50 },
            event: { pointerType: 'pen', button: 0, clientX: 30, clientY: 50 },
          },
          {
            point: { x: 60, y: 90 },
            event: { pointerType: 'pen', button: 0, clientX: 60, clientY: 90 },
          },
        ]),
      ]);
      dispatchDragEnd(host);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const lastStroke = onChange.mock.calls[0][0].strokes.at(-1);
    expect(lastStroke).toMatchObject({ tool: 'pen' });
    expect(lastStroke.points).toEqual([
      { x: 20, y: 30 },
      { x: 50, y: 70 },
    ]);
  });

  describe('lasso selection', () => {
    const lassoFixture = (): DrawingValue => ({
      strokes: [
        {
          id: 'lasso-target',
          tool: 'pen',
          points: [
            { x: 20, y: 20 },
            { x: 60, y: 20 },
          ],
          strokeWidth: 6,
        },
        {
          id: 'lasso-other',
          tool: 'pen',
          points: [
            { x: 130, y: 130 },
            { x: 160, y: 130 },
          ],
          strokeWidth: 6,
        },
      ],
    });

    const zeroHostRect = (host: HTMLElement) => {
      host.getBoundingClientRect = jest.fn(() => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 200,
        bottom: 200,
        width: 200,
        height: 200,
        toJSON: () => ({}),
      }));
    };

    const lassoPathAroundTarget = (): PointerPathItem[] => [
      {
        point: { x: 10, y: 10 },
        event: { pointerType: 'pen', button: 0, clientX: 10, clientY: 10 },
      },
      {
        point: { x: 70, y: 10 },
        event: { pointerType: 'pen', button: 0, clientX: 70, clientY: 10 },
      },
      {
        point: { x: 70, y: 40 },
        event: { pointerType: 'pen', button: 0, clientX: 70, clientY: 40 },
      },
      {
        point: { x: 10, y: 40 },
        event: { pointerType: 'pen', button: 0, clientX: 10, clientY: 40 },
      },
    ];

    const lassoPathAwayFromStrokes = (): PointerPathItem[] => [
      {
        point: { x: 80, y: 80 },
        event: { pointerType: 'pen', button: 0, clientX: 80, clientY: 80 },
      },
      {
        point: { x: 100, y: 80 },
        event: { pointerType: 'pen', button: 0, clientX: 100, clientY: 80 },
      },
      {
        point: { x: 100, y: 100 },
        event: { pointerType: 'pen', button: 0, clientX: 100, clientY: 100 },
      },
      {
        point: { x: 80, y: 100 },
        event: { pointerType: 'pen', button: 0, clientX: 80, clientY: 100 },
      },
    ];

    const dispatchPointerDown = (target: EventTarget, item: PointerPathItem, pointerId = 1) => {
      act(() => {
        target.dispatchEvent(createPointerEvent('pointerdown', item, pointerId));
      });
    };

    it('selects strokes intersecting the drawn lasso', () => {
      const onSelectionChange = jest.fn();
      render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={lassoFixture()}
          tool="lasso"
          onSelectionChange={onSelectionChange}
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      zeroHostRect(host);

      dispatchDragMove(host, [finger(lassoPathAroundTarget())]);
      dispatchDragEnd(host);

      expect(onSelectionChange).toHaveBeenCalledWith(['lasso-target']);
    });

    it('clears an existing selection when lasso hits nothing', () => {
      const onSelectionChange = jest.fn();
      render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={lassoFixture()}
          tool="lasso"
          defaultSelectedStrokeIds={['lasso-target']}
          onSelectionChange={onSelectionChange}
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      zeroHostRect(host);

      dispatchDragMove(host, [finger(lassoPathAwayFromStrokes())]);
      dispatchDragEnd(host);

      expect(onSelectionChange).toHaveBeenCalledWith([]);
    });

    it('moves selected strokes as one lasso selection', () => {
      const onChange = jest.fn();
      render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={lassoFixture()}
          onChange={onChange}
          tool="lasso"
          selectedStrokeIds={['lasso-target']}
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      zeroHostRect(host);

      dispatchDragMove(host, [
        finger([
          {
            point: { x: 25, y: 20 },
            event: { pointerType: 'pen', button: 0, clientX: 25, clientY: 20 },
          },
          {
            point: { x: 35, y: 30 },
            event: { pointerType: 'pen', button: 0, clientX: 35, clientY: 30 },
          },
        ]),
      ]);
      dispatchDragEnd(host);

      expect(onChange).toHaveBeenCalled();
      const movedStroke = onChange.mock.calls[0][0].strokes.find(
        (stroke: DrawingStroke) => stroke.id === 'lasso-target'
      );
      expect(movedStroke?.points).toEqual([
        { x: 30, y: 30 },
        { x: 70, y: 30 },
      ]);
    });

    it('renders a padded selection box after lasso selection and clears the preview', () => {
      const { container } = render(
        <DrawingSurface testID="drawing-surface-host" value={lassoFixture()} tool="lasso" />
      );
      const host = screen.getByTestId('drawing-surface-host');
      zeroHostRect(host);

      dispatchDragMove(host, [finger(lassoPathAroundTarget())]);
      dispatchDragEnd(host);

      const selectionBox = container.querySelector('[data-testid="lasso-selection-box"]');
      expect(selectionBox?.getAttribute('x')).toBe('9');
      expect(selectionBox?.getAttribute('y')).toBe('9');
      expect(selectionBox?.getAttribute('width')).toBe('62');
      expect(selectionBox?.getAttribute('height')).toBe('22');
      expect(selectionBox?.getAttribute('data-padding')).toBe('8');
      expect(selectionBox?.getAttribute('fill')).toBe('rgba(59,130,246,0.2)');
      expect(selectionBox?.getAttribute('stroke')).toBe('rgb(59,130,246)');
      expect(selectionBox?.getAttribute('stroke-width')).toBe('3');
      expect(selectionBox?.getAttribute('stroke-dasharray')).toBe('4 4');
      expect(selectionBox?.getAttribute('vector-effect')).toBe('non-scaling-stroke');
      expect(container.querySelector('[data-testid="lasso-preview"]')).toBeNull();
    });

    it('does not render a selection box when lasso selection is empty', () => {
      const { container } = render(
        <DrawingSurface testID="drawing-surface-host" value={lassoFixture()} tool="lasso" />
      );
      const host = screen.getByTestId('drawing-surface-host');
      zeroHostRect(host);

      dispatchDragMove(host, [finger(lassoPathAwayFromStrokes())]);
      dispatchDragEnd(host);

      expect(container.querySelector('[data-testid="lasso-selection-box"]')).toBeNull();
      expect(container.querySelector('[data-testid="lasso-preview"]')).toBeNull();
    });

    it('moves selected strokes when dragging from empty padded box interior', () => {
      const onChange = jest.fn();
      render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={lassoFixture()}
          onChange={onChange}
          tool="lasso"
          selectedStrokeIds={['lasso-target']}
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      zeroHostRect(host);

      dispatchDragMove(host, [
        finger([
          {
            point: { x: 15, y: 25 },
            event: { pointerType: 'pen', button: 0, clientX: 15, clientY: 25 },
          },
          {
            point: { x: 25, y: 35 },
            event: { pointerType: 'pen', button: 0, clientX: 25, clientY: 35 },
          },
        ]),
      ]);
      dispatchDragEnd(host);

      expect(onChange).toHaveBeenCalled();
      const movedStroke = onChange.mock.calls[0][0].strokes.find(
        (stroke: DrawingStroke) => stroke.id === 'lasso-target'
      );
      expect(movedStroke?.points).toEqual([
        { x: 30, y: 30 },
        { x: 70, y: 30 },
      ]);
    });

    it('renders a padded ellipse selection box from shape extent instead of raw endpoints only', () => {
      const ellipseFixture: DrawingValue = {
        strokes: [
          {
            id: 'selected-ellipse',
            tool: 'ellipse',
            points: [
              { x: 30, y: 40 },
              { x: 90, y: 80 },
            ],
            strokeWidth: 4,
          },
        ],
      };
      const { container } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={ellipseFixture}
          tool="lasso"
          selectedStrokeIds={['selected-ellipse']}
        />
      );

      const selectionBox = container.querySelector('[data-testid="lasso-selection-box"]');
      expect(selectionBox?.getAttribute('x')).toBe('20');
      expect(selectionBox?.getAttribute('y')).toBe('30');
      expect(selectionBox?.getAttribute('width')).toBe('80');
      expect(selectionBox?.getAttribute('height')).toBe('60');
    });

    it('deleteSelectedStrokes removes selected strokes and clears selection', () => {
      const onChange = jest.fn();
      const onSelectionChange = jest.fn();
      const ref = createRef<DrawingSurfaceHandle>();
      render(
        <DrawingSurface
          ref={ref}
          value={lassoFixture()}
          onChange={onChange}
          selectedStrokeIds={['lasso-target']}
          onSelectionChange={onSelectionChange}
        />
      );

      act(() => {
        ref.current?.deleteSelectedStrokes();
      });

      expect(onChange.mock.calls[0][0].strokes.map((stroke: DrawingStroke) => stroke.id)).toEqual([
        'lasso-other',
      ]);
      expect(onSelectionChange).toHaveBeenCalledWith([]);
    });

    it('clearSelection clears selected ids through the imperative handle', () => {
      const onSelectionChange = jest.fn();
      const ref = createRef<DrawingSurfaceHandle>();
      render(
        <DrawingSurface
          ref={ref}
          value={lassoFixture()}
          defaultSelectedStrokeIds={['lasso-target']}
          onSelectionChange={onSelectionChange}
        />
      );

      act(() => {
        ref.current?.clearSelection();
      });

      expect(onSelectionChange).toHaveBeenCalledWith([]);
    });

    it('getSelectedStrokeIds returns the current selection snapshot', () => {
      const ref = createRef<DrawingSurfaceHandle>();
      render(
        <DrawingSurface
          ref={ref}
          value={lassoFixture()}
          defaultSelectedStrokeIds={['lasso-target']}
        />
      );

      expect(ref.current?.getSelectedStrokeIds()).toEqual(['lasso-target']);
    });

    it('does not create a drawing stroke when completing a lasso', () => {
      const onChange = jest.fn();
      const onSelectionChange = jest.fn();
      render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={lassoFixture()}
          onChange={onChange}
          tool="lasso"
          onSelectionChange={onSelectionChange}
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      zeroHostRect(host);

      dispatchDragMove(host, [finger(lassoPathAroundTarget())]);
      dispatchDragEnd(host);

      expect(onChange).not.toHaveBeenCalled();
      expect(onSelectionChange).toHaveBeenCalledWith(['lasso-target']);
    });

    it('clears the lasso preview when switching tools mid-draw', () => {
      const { container, rerender } = render(
        <DrawingSurface testID="drawing-surface-host" value={lassoFixture()} tool="lasso" />
      );
      const host = screen.getByTestId('drawing-surface-host');
      zeroHostRect(host);

      dispatchDragMove(host, [finger(lassoPathAroundTarget().slice(0, 2))]);

      expect(container.querySelector('[data-testid="lasso-preview"]')).toBeTruthy();

      rerender(<DrawingSurface testID="drawing-surface-host" value={lassoFixture()} tool="pen" />);

      expect(container.querySelector('[data-testid="lasso-preview"]')).toBeNull();
    });

    it('clears an uncontrolled lasso selection and hides the box when switching to pen', () => {
      const onSelectionChange = jest.fn();
      const { container, rerender } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={lassoFixture()}
          tool="lasso"
          defaultSelectedStrokeIds={['lasso-target']}
          onSelectionChange={onSelectionChange}
        />
      );

      expect(container.querySelector('[data-testid="lasso-selection-box"]')).toBeTruthy();

      rerender(
        <DrawingSurface
          testID="drawing-surface-host"
          value={lassoFixture()}
          tool="pen"
          defaultSelectedStrokeIds={['lasso-target']}
          onSelectionChange={onSelectionChange}
        />
      );

      expect(onSelectionChange).toHaveBeenCalledWith([]);
      expect(container.querySelector('[data-testid="lasso-selection-box"]')).toBeNull();
    });

    it('clears selection on inside-host pointerdown outside the selection box without creating a preview', () => {
      const onSelectionChange = jest.fn();
      const { container } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={lassoFixture()}
          tool="lasso"
          selectedStrokeIds={['lasso-target']}
          onSelectionChange={onSelectionChange}
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      zeroHostRect(host);

      dispatchPointerDown(host, {
        point: { x: 100, y: 100 },
        event: { pointerType: 'pen', button: 0, clientX: 100, clientY: 100 },
      });

      expect(onSelectionChange).toHaveBeenCalledWith([]);
      expect(container.querySelector('[data-testid="lasso-preview"]')).toBeNull();
    });

    it('clears lasso selection on document body pointerdown outside the host', () => {
      const onSelectionChange = jest.fn();
      render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={lassoFixture()}
          tool="lasso"
          selectedStrokeIds={['lasso-target']}
          onSelectionChange={onSelectionChange}
        />
      );

      dispatchPointerDown(document.body, {
        point: { x: 5, y: 5 },
        event: { pointerType: 'mouse', button: 0, clientX: 5, clientY: 5 },
      });

      expect(onSelectionChange).toHaveBeenCalledWith([]);
    });

    it('does not clear lasso selection when pointerdown originates on an external button', () => {
      const onSelectionChange = jest.fn();
      render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={lassoFixture()}
          tool="lasso"
          selectedStrokeIds={['lasso-target']}
          onSelectionChange={onSelectionChange}
        />
      );

      const externalButton = document.createElement('button');
      document.body.appendChild(externalButton);
      try {
        dispatchPointerDown(externalButton, {
          point: { x: 5, y: 5 },
          event: { pointerType: 'mouse', button: 0, clientX: 5, clientY: 5 },
        });

        expect(onSelectionChange).not.toHaveBeenCalled();
      } finally {
        document.body.removeChild(externalButton);
      }
    });

    it('ignores inside-host pointerdown in the document listener', () => {
      const onSelectionChange = jest.fn();
      render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={lassoFixture()}
          tool="lasso"
          selectedStrokeIds={['lasso-target']}
          onSelectionChange={onSelectionChange}
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      zeroHostRect(host);

      dispatchPointerDown(host, {
        point: { x: 15, y: 25 },
        event: { pointerType: 'pen', button: 0, clientX: 15, clientY: 25 },
      });

      expect(onSelectionChange).not.toHaveBeenCalled();
      dispatchDragEnd(host);
    });

    it('cleans up the document pointerdown listener after rerender without selection and unmount', () => {
      const onSelectionChange = jest.fn();
      const { rerender, unmount } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={lassoFixture()}
          tool="lasso"
          selectedStrokeIds={['lasso-target']}
          onSelectionChange={onSelectionChange}
        />
      );

      rerender(
        <DrawingSurface
          testID="drawing-surface-host"
          value={lassoFixture()}
          tool="lasso"
          selectedStrokeIds={[]}
          onSelectionChange={onSelectionChange}
        />
      );
      dispatchPointerDown(document.body, {
        point: { x: 5, y: 5 },
        event: { pointerType: 'mouse', button: 0, clientX: 5, clientY: 5 },
      });

      unmount();
      dispatchPointerDown(document.body, {
        point: { x: 6, y: 6 },
        event: { pointerType: 'mouse', button: 0, clientX: 6, clientY: 6 },
      });

      expect(onSelectionChange).not.toHaveBeenCalled();
    });

    it('fires controlled selection clearing callback and hides the box after selected ids rerender empty', () => {
      const onSelectionChange = jest.fn();
      const { container, rerender } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={lassoFixture()}
          tool="lasso"
          selectedStrokeIds={['lasso-target']}
          onSelectionChange={onSelectionChange}
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      zeroHostRect(host);

      dispatchPointerDown(host, {
        point: { x: 80, y: 50 },
        event: { pointerType: 'pen', button: 0, clientX: 80, clientY: 50 },
      });

      expect(onSelectionChange).toHaveBeenCalledWith([]);
      expect(container.querySelector('[data-testid="lasso-selection-box"]')).toBeTruthy();

      rerender(
        <DrawingSurface
          testID="drawing-surface-host"
          value={lassoFixture()}
          tool="lasso"
          selectedStrokeIds={[]}
          onSelectionChange={onSelectionChange}
        />
      );

      expect(container.querySelector('[data-testid="lasso-selection-box"]')).toBeNull();
    });

    it('does not clear selection from the document listener while a lasso draw is active', () => {
      const onSelectionChange = jest.fn();
      const { container } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={lassoFixture()}
          tool="lasso"
          onSelectionChange={onSelectionChange}
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      zeroHostRect(host);

      dispatchDragMove(host, [finger(lassoPathAroundTarget().slice(0, 2))]);
      expect(container.querySelector('[data-testid="lasso-preview"]')).toBeTruthy();

      dispatchPointerDown(document.body, {
        point: { x: 5, y: 5 },
        event: { pointerType: 'mouse', button: 0, clientX: 5, clientY: 5 },
      });

      expect(onSelectionChange).not.toHaveBeenCalledWith([]);
      expect(container.querySelector('[data-testid="lasso-preview"]')).toBeTruthy();
      dispatchDragEnd(host);
    });

    it('does not clear selection from the document listener while a multitouch lasso path is active', () => {
      const onSelectionChange = jest.fn();
      render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={lassoFixture()}
          tool="lasso"
          selectedStrokeIds={['lasso-target']}
          onSelectionChange={onSelectionChange}
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      zeroHostRect(host);

      dispatchDragMove(host, [
        finger([
          {
            point: { x: 15, y: 25 },
            event: { pointerType: 'touch', button: 0, clientX: 15, clientY: 25, pointerId: 1 },
          },
        ]),
        finger([
          {
            point: { x: 16, y: 26 },
            event: { pointerType: 'touch', button: 0, clientX: 16, clientY: 26, pointerId: 2 },
          },
        ]),
      ]);

      dispatchPointerDown(document.body, {
        point: { x: 5, y: 5 },
        event: { pointerType: 'mouse', button: 0, clientX: 5, clientY: 5 },
      });

      expect(onSelectionChange).not.toHaveBeenCalledWith([]);
      dispatchDragEnd(host, 1);
      dispatchDragEnd(host, 2);
    });
  });
});

describe('eraserCommitMode', () => {
  // 三笔位于不同 y 带的水平短线，每条 pen 笔画长度 10px。
  // strokeWidth=20 → 橡皮半径 = 20/2/1 = 10，足够覆盖采样落点；
  // 各笔画 y 间距 50px，确保单个落点只可能命中唯一笔画。
  const buildFixtureStrokes = () => ({
    strokes: [
      {
        id: 'stroke-A',
        tool: 'pen' as const,
        points: [
          { x: 50, y: 30 },
          { x: 60, y: 30 },
        ],
        strokeColor: 'black',
        strokeWidth: 20,
      },
      {
        id: 'stroke-B',
        tool: 'pen' as const,
        points: [
          { x: 50, y: 80 },
          { x: 60, y: 80 },
        ],
        strokeColor: 'black',
        strokeWidth: 20,
      },
      {
        id: 'stroke-C',
        tool: 'pen' as const,
        points: [
          { x: 50, y: 130 },
          { x: 60, y: 130 },
        ],
        strokeColor: 'black',
        strokeWidth: 20,
      },
    ],
  });

  // 起点 (10,10) 不落在任何笔画上：adapter 在 start 阶段返回 idle，
  // 后续 3 个 move 各自把 latest 落到 A/B/C 上，分别触发命中。
  const eraserSweepPath = (): PointerPathItem[] => [
    { point: { x: 10, y: 10 }, event: { pointerType: 'pen', button: 0, clientX: 10, clientY: 10 } },
    { point: { x: 55, y: 30 }, event: { pointerType: 'pen', button: 0, clientX: 55, clientY: 30 } },
    { point: { x: 55, y: 80 }, event: { pointerType: 'pen', button: 0, clientX: 55, clientY: 80 } },
    {
      point: { x: 55, y: 130 },
      event: { pointerType: 'pen', button: 0, clientX: 55, clientY: 130 },
    },
  ];

  // 不通过 mockHostRect 偏移：橡皮坐标系与笔画坐标系直接对齐到 (0,0)。
  const mountWithFixture = (commitMode?: 'while-sliding' | 'on-release') => {
    const onChange = jest.fn();
    const { unmount } = render(
      <DrawingSurface
        testID="drawing-surface-host"
        defaultValue={buildFixtureStrokes()}
        onChange={onChange}
        tool="eraser"
        strokeWidth={20}
        eraserCommitMode={commitMode}
      />
    );
    const host = screen.getByTestId('drawing-surface-host');
    host.getBoundingClientRect = jest.fn(() => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 200,
      width: 200,
      height: 200,
      toJSON: () => ({}),
    }));
    return { host, onChange, unmount };
  };

  const buildSparseTargetStroke = () => ({
    strokes: [
      {
        id: 'sparse-sweep-target',
        tool: 'pen' as const,
        points: [
          { x: 90, y: 100 },
          { x: 110, y: 100 },
        ],
        strokeColor: 'black',
        strokeWidth: 2,
      },
    ],
  });

  const sparseCrossingPath = (): PointerPathItem[] => [
    {
      point: { x: 100, y: 70 },
      event: { pointerType: 'pen', button: 0, clientX: 100, clientY: 70 },
    },
    {
      point: { x: 100, y: 130 },
      event: { pointerType: 'pen', button: 0, clientX: 100, clientY: 130 },
    },
  ];

  const nearParallelSweepPath = (): PointerPathItem[] => [
    {
      point: { x: 80, y: 112 },
      event: { pointerType: 'pen', button: 0, clientX: 80, clientY: 112 },
    },
    {
      point: { x: 120, y: 112 },
      event: { pointerType: 'pen', button: 0, clientX: 120, clientY: 112 },
    },
  ];

  const mountWithSparseTarget = (
    strokeWidth: number,
    commitMode: 'while-sliding' | 'on-release' = 'while-sliding'
  ) => {
    const onChange = jest.fn();
    const { unmount } = render(
      <DrawingSurface
        testID="drawing-surface-host"
        defaultValue={buildSparseTargetStroke()}
        onChange={onChange}
        tool="eraser"
        strokeWidth={strokeWidth}
        eraserCommitMode={commitMode}
      />
    );
    const host = screen.getByTestId('drawing-surface-host');
    host.getBoundingClientRect = jest.fn(() => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 200,
      width: 200,
      height: 200,
      toJSON: () => ({}),
    }));
    return { host, onChange, unmount };
  };

  it('AC-E1 while-sliding: deletes hit strokes immediately during pointer moves', () => {
    const { host, onChange, unmount } = mountWithFixture('while-sliding');

    dispatchDragMove(host, [finger(eraserSweepPath())]);

    // 每个 move 触发一次 onChange，三次删除后内部 strokes 应为空。
    expect(onChange).toHaveBeenCalledTimes(3);
    const finalCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(finalCall.strokes).toHaveLength(0);
    // 验证每次调用都比上一次少一笔（while-sliding 的核心契约）。
    expect(onChange.mock.calls[0][0].strokes).toHaveLength(2);
    expect(onChange.mock.calls[1][0].strokes).toHaveLength(1);
    expect(onChange.mock.calls[2][0].strokes).toHaveLength(0);

    dispatchDragEnd(host);
    expect(onChange).toHaveBeenCalledTimes(3);
    unmount();
  });

  it('AC-E2 on-release: queues hits during moves, deletes all on pointerup', () => {
    const { host, onChange, unmount } = mountWithFixture('on-release');

    dispatchDragMove(host, [finger(eraserSweepPath())]);

    // 关键断言：滑动过程中不能有任何 onChange（队列还未提交）。
    expect(onChange).not.toHaveBeenCalled();

    dispatchDragEnd(host);

    // pointerup 后队列一次性 flush，最终状态应当少 3 笔。
    expect(onChange).toHaveBeenCalled();
    const finalCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(finalCall.strokes).toHaveLength(0);
    unmount();
  });

  // 稀疏移动的两个端点都离目标 30px，但连线穿过目标；while-sliding 必须在 pointerup 前删除。
  it('while-sliding sparse sweep deletes a target before pointerup when only the segment crosses it', () => {
    const { host, onChange, unmount } = mountWithSparseTarget(10, 'while-sliding');

    dispatchDragMove(host, [finger(sparseCrossingPath())]);

    expect(host.getAttribute('data-stroke-count')).toBe('0');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].strokes).toHaveLength(0);

    dispatchDragEnd(host);
    expect(onChange).toHaveBeenCalledTimes(1);
    unmount();
  });

  // 同样的稀疏穿越在 on-release 下只能排队：移动中保留目标，pointerup 后再统一删除。
  it('on-release sparse sweep keeps the target mid-gesture and deletes it after pointerup', () => {
    const { host, onChange, unmount } = mountWithSparseTarget(10, 'on-release');

    dispatchDragMove(host, [finger(sparseCrossingPath())]);

    expect(host.getAttribute('data-stroke-count')).toBe('1');
    expect(onChange).not.toHaveBeenCalled();

    dispatchDragEnd(host);

    expect(host.getAttribute('data-stroke-count')).toBe('0');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].strokes).toHaveLength(0);
    unmount();
  });

  // 同一条平行擦除轨迹距离目标 12px；窄橡皮半径 5px，不应误删。
  it('narrow eraser width does not delete a nearby target outside the hit radius', () => {
    const { host, onChange, unmount } = mountWithSparseTarget(10, 'while-sliding');

    dispatchDragMove(host, [finger(nearParallelSweepPath())]);
    dispatchDragEnd(host);

    expect(host.getAttribute('data-stroke-count')).toBe('1');
    expect(onChange).not.toHaveBeenCalled();
    unmount();
  });

  // 同一条平行擦除轨迹配合宽橡皮半径 15px，应因 lineWidth 扩大判定面积而删除目标。
  it('wide eraser width deletes the same nearby target by expanding the hit radius', () => {
    const { host, onChange, unmount } = mountWithSparseTarget(30, 'while-sliding');

    dispatchDragMove(host, [finger(nearParallelSweepPath())]);

    expect(host.getAttribute('data-stroke-count')).toBe('0');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].strokes).toHaveLength(0);

    dispatchDragEnd(host);
    expect(onChange).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('AC-E3 on-release + pointercancel: queue is dropped without deletion', () => {
    const { host, onChange, unmount } = mountWithFixture('on-release');

    dispatchDragMove(host, [finger(eraserSweepPath())]);
    expect(onChange).not.toHaveBeenCalled();

    // 中途 pointercancel：清空队列且不调用 onChange。
    act(() => {
      const cancelEvent = createPointerEvent(
        'pointercancel',
        {
          point: { x: 55, y: 130 },
          event: { pointerType: 'pen', button: 0, clientX: 55, clientY: 130 },
        },
        1
      );
      host.dispatchEvent(cancelEvent);
    });

    expect(onChange).not.toHaveBeenCalled();
    // 内部 stroke 数仍是初始 3。
    expect(host.getAttribute('data-stroke-count')).toBe('3');
    unmount();
  });

  it('AC-E4 on-release + second pointer mid-path: multi-start drops the queue', () => {
    const { host, onChange, unmount } = mountWithFixture('on-release');

    dispatchDragMove(host, [finger(eraserSweepPath())]);
    expect(onChange).not.toHaveBeenCalled();

    // 第二根手指按下：adapter 升级到 multi-start，应丢弃队列。
    act(() => {
      const secondDown = createPointerEvent(
        'pointerdown',
        {
          point: { x: 150, y: 150 },
          event: { pointerType: 'touch', button: 0, clientX: 150, clientY: 150, pointerId: 2 },
        },
        2
      );
      host.dispatchEvent(secondDown);
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(host.getAttribute('data-stroke-count')).toBe('3');

    // 收尾：抬起两根手指避免泄漏。
    act(() => {
      host.dispatchEvent(createPointerEvent('pointerup', { point: { x: 55, y: 130 } }, 1));
      host.dispatchEvent(createPointerEvent('pointerup', { point: { x: 150, y: 150 } }, 2));
    });
    // multi-start → multi-end → single-end 序列不应产生 onChange（队列已清）。
    expect(onChange).not.toHaveBeenCalled();
    unmount();
  });
});

describe('rendered-width eraser collision', () => {
  const zeroHostRect = (host: HTMLElement) => {
    host.getBoundingClientRect = jest.fn(() => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 200,
      width: 200,
      height: 200,
      toJSON: () => ({}),
    }));
  };

  const eraserPathNearRenderedStroke = (y: number): PointerPathItem[] => [
    { point: { x: 20, y }, event: { pointerType: 'pen', button: 0, clientX: 20, clientY: y } },
    { point: { x: 80, y }, event: { pointerType: 'pen', button: 0, clientX: 80, clientY: y } },
  ];

  const eraseWithRenderedCollision = (
    stroke: DrawingStroke,
    options: { y?: number; pressureMultiplier?: number } = {}
  ) => {
    const onChange = jest.fn();
    const { unmount } = render(
      <DrawingSurface
        testID="drawing-surface-host"
        defaultValue={{ strokes: [stroke] }}
        onChange={onChange}
        tool="eraser"
        strokeWidth={2}
        pressureMultiplier={options.pressureMultiplier}
      />
    );
    const host = screen.getByTestId('drawing-surface-host');
    zeroHostRect(host);

    dispatchDragMove(host, [finger(eraserPathNearRenderedStroke(options.y ?? 59))]);
    dispatchDragEnd(host);

    return { host, onChange, unmount };
  };

  const renderedWidthTargets: Array<{ name: string; stroke: DrawingStroke; y?: number }> = [
    {
      name: 'pen',
      stroke: {
        id: 'rendered-eraser-pen',
        tool: 'pen',
        points: [
          { x: 20, y: 50 },
          { x: 80, y: 50 },
        ],
        strokeWidth: 20,
      },
    },
    {
      name: 'line',
      stroke: {
        id: 'rendered-eraser-line',
        tool: 'line',
        points: [
          { x: 20, y: 50 },
          { x: 80, y: 50 },
        ],
        strokeWidth: 20,
      },
    },
    {
      name: 'rect',
      y: 11,
      stroke: {
        id: 'rendered-eraser-rect',
        tool: 'rect',
        points: [
          { x: 20, y: 20 },
          { x: 80, y: 80 },
        ],
        strokeWidth: 20,
      },
    },
    {
      name: 'ellipse',
      y: 11,
      stroke: {
        id: 'rendered-eraser-ellipse',
        tool: 'ellipse',
        points: [
          { x: 20, y: 20 },
          { x: 80, y: 80 },
        ],
        strokeWidth: 20,
      },
    },
    {
      name: 'polygon',
      y: 11,
      stroke: {
        id: 'rendered-eraser-polygon',
        tool: 'polygon',
        points: [
          { x: 20, y: 20 },
          { x: 80, y: 20 },
          { x: 80, y: 80 },
          { x: 20, y: 80 },
        ],
        strokeWidth: 20,
      },
    },
    {
      name: 'bezier',
      stroke: {
        id: 'rendered-eraser-bezier',
        tool: 'bezier',
        points: [
          { x: 20, y: 50 },
          { x: 40, y: 50 },
          { x: 60, y: 50 },
          { x: 80, y: 50 },
        ],
        strokeWidth: 20,
      },
    },
  ];

  it.each(renderedWidthTargets)(
    'deletes $name by rendered-width intersection without persisting an eraser stroke',
    ({ stroke, y }) => {
      const { host, onChange, unmount } = eraseWithRenderedCollision(stroke, { y });

      expect(host.getAttribute('data-stroke-count')).toBe('0');
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0][0].strokes).toEqual([]);

      unmount();
    }
  );

  it('deletes a centerline miss when the eraser intersects the rendered stroke width', () => {
    const { host, onChange, unmount } = eraseWithRenderedCollision({
      id: 'centerline-miss-rendered-hit',
      tool: 'pen',
      points: [
        { x: 20, y: 50 },
        { x: 80, y: 50 },
      ],
      strokeWidth: 20,
    });

    expect(host.getAttribute('data-stroke-count')).toBe('0');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].strokes).toEqual([]);
    unmount();
  });

  it('keeps a stroke when the eraser misses the rendered stroke width', () => {
    const { host, onChange, unmount } = eraseWithRenderedCollision(
      {
        id: 'rendered-width-miss',
        tool: 'pen',
        points: [
          { x: 20, y: 50 },
          { x: 80, y: 50 },
        ],
        strokeWidth: 20,
      },
      { y: 62 }
    );

    expect(host.getAttribute('data-stroke-count')).toBe('1');
    expect(onChange).not.toHaveBeenCalled();
    unmount();
  });

  it('uses pressureMultiplier when hit-testing pressure pen rendered widths', () => {
    const pressureStroke: DrawingStroke = {
      id: 'pressure-rendered-threshold',
      tool: 'pen',
      points: [
        { x: 20, y: 50, pressure: 0.8 },
        { x: 80, y: 50, pressure: 0.8 },
      ],
      strokeWidth: 10,
    };

    const miss = eraseWithRenderedCollision(pressureStroke, {
      y: 57,
      pressureMultiplier: 1,
    });
    expect(miss.host.getAttribute('data-stroke-count')).toBe('1');
    expect(miss.onChange).not.toHaveBeenCalled();
    miss.unmount();

    const hit = eraseWithRenderedCollision(pressureStroke, {
      y: 57,
      pressureMultiplier: 2,
    });
    expect(hit.host.getAttribute('data-stroke-count')).toBe('0');
    expect(hit.onChange).toHaveBeenCalledTimes(1);
    expect(hit.onChange.mock.calls[0][0].strokes).toEqual([]);
    hit.unmount();
  });
});

describe('eraserCursorAndTrajectory', () => {
  // 与 eraserCommitMode 套件相同的 fixture/sweep，方便复用既有时序假设：
  // 起点 (10,10) 不命中任何笔画 → 后续 3 个 move 各产生 1 个 single-move。
  const buildFixtureStrokes = () => ({
    strokes: [
      {
        id: 'traj-stroke-A',
        tool: 'pen' as const,
        points: [
          { x: 50, y: 30 },
          { x: 60, y: 30 },
        ],
        strokeColor: 'black',
        strokeWidth: 20,
      },
      {
        id: 'traj-stroke-B',
        tool: 'pen' as const,
        points: [
          { x: 50, y: 80 },
          { x: 60, y: 80 },
        ],
        strokeColor: 'black',
        strokeWidth: 20,
      },
      {
        id: 'traj-stroke-C',
        tool: 'pen' as const,
        points: [
          { x: 50, y: 130 },
          { x: 60, y: 130 },
        ],
        strokeColor: 'black',
        strokeWidth: 20,
      },
    ],
  });

  const eraserSweepPath = (): PointerPathItem[] => [
    { point: { x: 10, y: 10 }, event: { pointerType: 'pen', button: 0, clientX: 10, clientY: 10 } },
    { point: { x: 55, y: 30 }, event: { pointerType: 'pen', button: 0, clientX: 55, clientY: 30 } },
    { point: { x: 55, y: 80 }, event: { pointerType: 'pen', button: 0, clientX: 55, clientY: 80 } },
    {
      point: { x: 55, y: 130 },
      event: { pointerType: 'pen', button: 0, clientX: 55, clientY: 130 },
    },
  ];

  // jsdom 没有 PointerEvent；用普通 Event + 字段赋值的方式构造（与 cursor crosshair overlay 套件同源）。
  function rawPointerEvent(
    type: 'pointerenter' | 'pointermove' | 'pointerleave' | 'pointerdown' | 'pointerup',
    props: { clientX?: number; clientY?: number; pointerType?: string; pointerId?: number } = {}
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

  // AC-E5 — default eraser cursor renders an SVG with r = strokeWidth/2.
  it('AC-E5 default cursor renders [data-testid="eraser-cursor"] with circle r = strokeWidth/2 when tool=eraser', () => {
    const { container } = render(
      <DrawingSurface
        testID="drawing-surface-host"
        value={{ strokes: [] }}
        tool="eraser"
        strokeWidth={20}
      />
    );
    const host = screen.getByTestId('drawing-surface-host');
    mockHostRect(host);

    // 鼠标 hover 前 cursor 不可见，因此 SVG 不应被渲染。
    expect(container.querySelector('[data-testid="eraser-cursor"]')).toBeNull();

    act(() => {
      host.dispatchEvent(
        rawPointerEvent('pointerenter', { clientX: 50, clientY: 60, pointerType: 'mouse' })
      );
    });

    const eraserCursor = container.querySelector(
      '[data-testid="eraser-cursor"]'
    ) as SVGSVGElement | null;
    expect(eraserCursor).toBeTruthy();
    // 默认 crosshair 不应同时存在；eraser 工具走专属分支。
    expect(container.querySelector('[data-crosshair]')).toBeNull();

    const circle = eraserCursor?.querySelector('circle');
    expect(circle).toBeTruthy();
    // strokeWidth=20 → resolvedOpenWidth=20 → eraserRadius=10
    expect(circle?.getAttribute('r')).toBe(String(20 / 2));
    expect(circle?.getAttribute('fill')).toBe('none');
  });

  // AC-E6 — trajectory polyline is OFF by default; never appears during eraser gesture.
  it('AC-E6 trajectory polyline absent during eraser gesture when eraserTrajectory is undefined', () => {
    const onChange = jest.fn();
    const { container, unmount } = render(
      <DrawingSurface
        testID="drawing-surface-host"
        defaultValue={buildFixtureStrokes()}
        onChange={onChange}
        tool="eraser"
        strokeWidth={20}
      />
    );
    const host = screen.getByTestId('drawing-surface-host');
    host.getBoundingClientRect = jest.fn(() => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 200,
      width: 200,
      height: 200,
      toJSON: () => ({}),
    }));

    expect(container.querySelector('[data-testid="eraser-trajectory"]')).toBeNull();

    dispatchDragMove(host, [finger(eraserSweepPath())]);
    // 关键断言：手势进行中 polyline 仍然为 null（visible 默认 false）。
    expect(container.querySelector('[data-testid="eraser-trajectory"]')).toBeNull();

    dispatchDragEnd(host);
    expect(container.querySelector('[data-testid="eraser-trajectory"]')).toBeNull();
    unmount();
  });

  // AC-E7 — trajectory polyline renders with custom color/width during gesture,
  // and is cleared on pointerup.
  it('AC-E7 trajectory polyline renders with custom color/lineWidth during gesture, disappears on pointerup', () => {
    const onChange = jest.fn();
    const { container, unmount } = render(
      <DrawingSurface
        testID="drawing-surface-host"
        defaultValue={buildFixtureStrokes()}
        onChange={onChange}
        tool="eraser"
        strokeWidth={20}
        eraserTrajectory={{ visible: true, color: '#ff0000', lineWidth: 3 }}
      />
    );
    const host = screen.getByTestId('drawing-surface-host');
    host.getBoundingClientRect = jest.fn(() => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 200,
      width: 200,
      height: 200,
      toJSON: () => ({}),
    }));

    dispatchDragMove(host, [finger(eraserSweepPath())]);

    const polyline = container.querySelector(
      'polyline[data-testid="eraser-trajectory"]'
    ) as SVGPolylineElement | null;
    expect(polyline).toBeTruthy();
    expect(polyline?.getAttribute('stroke')).toBe('#ff0000');
    expect(polyline?.getAttribute('stroke-width')).toBe('3');
    // 至少 3 个点（3 次 single-move 各推一个 canvas 点）。
    const pointsAttr = polyline?.getAttribute('points') ?? '';
    expect(pointsAttr.trim().split(/\s+/).length).toBeGreaterThanOrEqual(3);

    dispatchDragEnd(host);
    // 单 pointerup → single-end 清空轨迹。
    expect(container.querySelector('[data-testid="eraser-trajectory"]')).toBeNull();
    unmount();
  });

  describe('eraser trajectory defaults', () => {
    function eraserSweepPath(): PointerPathItem[] {
      return [
        { point: { x: 20, y: 30 }, event: { pointerType: 'pen', button: 0 } },
        { point: { x: 40, y: 30 }, event: { pointerType: 'pen', button: 0 } },
        { point: { x: 60, y: 30 }, event: { pointerType: 'pen', button: 0 } },
      ];
    }

    function buildFixtureStrokes() {
      return {
        strokes: [
          {
            id: 'eraser-defaults-target',
            tool: 'pen' as const,
            points: [
              { x: 0, y: 30 },
              { x: 100, y: 30 },
            ],
            strokeWidth: 2,
          },
        ],
      };
    }

    it('default rendered eraser trajectory has stroke="#ccc" and opacity="0.5" when visible is true', () => {
      const { container, unmount } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          defaultValue={buildFixtureStrokes()}
          tool="eraser"
          strokeWidth={20}
          eraserTrajectory={{ visible: true }}
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      host.getBoundingClientRect = jest.fn(() => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 200,
        bottom: 200,
        width: 200,
        height: 200,
        toJSON: () => ({}),
      }));

      dispatchDragMove(host, [finger(eraserSweepPath())]);

      const polyline = container.querySelector(
        'polyline[data-testid="eraser-trajectory"]'
      ) as SVGPolylineElement | null;
      expect(polyline).toBeTruthy();
      expect(polyline?.getAttribute('stroke')).toBe('#ccc');
      expect(polyline?.getAttribute('opacity')).toBe('0.5');

      dispatchDragEnd(host);
      unmount();
    });

    it('eraserTrajectory color and opacity overrides defaults', () => {
      const { container, unmount } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          defaultValue={buildFixtureStrokes()}
          tool="eraser"
          strokeWidth={20}
          eraserTrajectory={{ visible: true, color: '#f00', opacity: 1 }}
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      host.getBoundingClientRect = jest.fn(() => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 200,
        bottom: 200,
        width: 200,
        height: 200,
        toJSON: () => ({}),
      }));

      dispatchDragMove(host, [finger(eraserSweepPath())]);

      const polyline = container.querySelector(
        'polyline[data-testid="eraser-trajectory"]'
      ) as SVGPolylineElement | null;
      expect(polyline).toBeTruthy();
      expect(polyline?.getAttribute('stroke')).toBe('#f00');
      expect(polyline?.getAttribute('opacity')).toBe('1');

      dispatchDragEnd(host);
      unmount();
    });

    it('while-sliding deletion keeps eraser trajectory points monotonic until pointerup', () => {
      const onChange = jest.fn();
      const { container, unmount } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          defaultValue={buildFixtureStrokes()}
          onChange={onChange}
          tool="eraser"
          strokeWidth={10}
          eraserCommitMode="while-sliding"
          eraserTrajectory={{ visible: true }}
        />
      );
      const host = screen.getByTestId('drawing-surface-host');
      host.getBoundingClientRect = jest.fn(() => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 200,
        bottom: 200,
        width: 200,
        height: 200,
        toJSON: () => ({}),
      }));
      const crossingPath: PointerPathItem[] = [
        {
          point: { x: 100, y: 10 },
          event: { pointerType: 'pen', button: 0, clientX: 100, clientY: 10 },
        },
        {
          point: { x: 100, y: 20 },
          event: { pointerType: 'pen', button: 0, clientX: 100, clientY: 20 },
        },
        {
          point: { x: 100, y: 30 },
          event: { pointerType: 'pen', button: 0, clientX: 100, clientY: 30 },
        },
        {
          point: { x: 100, y: 40 },
          event: { pointerType: 'pen', button: 0, clientX: 100, clientY: 40 },
        },
      ];
      const pointTokenCount = () => {
        const points = container
          .querySelector('polyline[data-testid="eraser-trajectory"]')
          ?.getAttribute('points')
          ?.trim();
        return points ? points.split(/\s+/).length : 0;
      };

      dispatchDragMove(host, [finger(crossingPath.slice(0, 2))]);
      const beforeDeletionCount = pointTokenCount();
      expect(beforeDeletionCount).toBeGreaterThanOrEqual(2);
      expect(onChange).not.toHaveBeenCalled();

      dispatchDragMove(host, [finger(crossingPath.slice(0, 3))]);
      const afterDeletionCount = pointTokenCount();
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(host.getAttribute('data-stroke-count')).toBe('0');
      expect(afterDeletionCount).toBeGreaterThan(beforeDeletionCount);
      expect(afterDeletionCount).toBeGreaterThan(1);

      dispatchDragMove(host, [finger(crossingPath)]);
      const afterContinuationCount = pointTokenCount();
      expect(afterContinuationCount).toBeGreaterThan(afterDeletionCount);
      expect(afterContinuationCount).toBeGreaterThan(1);

      dispatchDragEnd(host);
      expect(container.querySelector('[data-testid="eraser-trajectory"]')).toBeNull();
      unmount();
    });
  });

  describe('pressureMultiplier normalization', () => {
    it('invalid pressureMultiplier values (0, -1, NaN, Infinity) resolve to multiplier 1', () => {
      const invalidValues = [0, -1, NaN, Infinity];
      for (const value of invalidValues) {
        const { container, unmount } = render(
          <DrawingSurface
            testID="drawing-surface-host"
            value={{ strokes: [] }}
            tool="pen"
            pressureMultiplier={value}
          />
        );
        const svg = container.querySelector('svg');
        expect(svg?.getAttribute('data-pressure-multiplier')).toBe('1');
        unmount();
      }
    });

    it('omitted pressureMultiplier matches pressureMultiplier={1}', () => {
      const { container: containerOmitted, unmount: unmountOmitted } = render(
        <DrawingSurface testID="drawing-surface-host" value={{ strokes: [] }} tool="pen" />
      );
      const { container: containerExplicit, unmount: unmountExplicit } = render(
        <DrawingSurface
          testID="drawing-surface-host-2"
          value={{ strokes: [] }}
          tool="pen"
          pressureMultiplier={1}
        />
      );

      const svgOmitted = containerOmitted.querySelector('svg');
      const svgExplicit = containerExplicit.querySelector('svg');
      expect(svgOmitted?.getAttribute('data-pressure-multiplier')).toBe('1');
      expect(svgExplicit?.getAttribute('data-pressure-multiplier')).toBe('1');

      unmountOmitted();
      unmountExplicit();
    });

    it('valid pressureMultiplier passes through', () => {
      const { container, unmount } = render(
        <DrawingSurface
          testID="drawing-surface-host"
          value={{ strokes: [] }}
          tool="pen"
          pressureMultiplier={2.5}
        />
      );
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('data-pressure-multiplier')).toBe('2.5');
      unmount();
    });
  });
});
