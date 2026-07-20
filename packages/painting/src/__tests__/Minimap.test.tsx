import { fireEvent, render, screen } from '@testing-library/react';
import { DrawingSurface } from '../components/DrawingSurface';
import { Minimap } from '../components/Minimap';

describe('minimap regression coverage', () => {
  const originalResizeObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalResizeObserver) {
      Object.defineProperty(globalThis, 'ResizeObserver', originalResizeObserver);
    } else {
      Reflect.deleteProperty(globalThis, 'ResizeObserver');
    }
  });

  it('mounts DrawingSurface without ResizeObserver when minimap is omitted', () => {
    render(<DrawingSurface testID="drawing-surface" />);

    expect(screen.getByTestId('drawing-surface')).toBeTruthy();
  });

  it('does not render or observe the host when minimap.enabled is false', () => {
    const observe = jest.fn();
    const resizeObserver = jest.fn(() => ({
      observe,
      disconnect: jest.fn(),
      unobserve: jest.fn(),
    }));
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: resizeObserver,
    });
    jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640);
    jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(480);

    render(
      <DrawingSurface testID="drawing-surface" minimap={{ enabled: false, testID: 'minimap' }} />
    );

    expect(screen.queryByTestId('minimap')).toBeNull();
    expect(resizeObserver).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();
  });

  it('clips an oversized viewport indicator and its handles to the minimap bounds', () => {
    render(
      <Minimap
        strokes={[]}
        viewport={{ scale: 0.25, tx: 0, ty: 0 }}
        onViewportChange={jest.fn()}
        hostSize={{ width: 1000, height: 800 }}
        width={200}
        height={150}
        testID="minimap"
      />
    );

    const minimap = screen.getByTestId('minimap');
    const indicator = minimap.querySelector<HTMLElement>('[data-minimap-indicator]');
    const rightHandle = minimap.querySelector<HTMLElement>('[data-minimap-edge="right"]');
    const indicatorLeft = Number.parseFloat(indicator?.style.left ?? 'NaN');
    const indicatorTop = Number.parseFloat(indicator?.style.top ?? 'NaN');
    const indicatorWidth = Number.parseFloat(indicator?.style.width ?? 'NaN');
    const indicatorHeight = Number.parseFloat(indicator?.style.height ?? 'NaN');

    expect(minimap.style.overflow).toBe('hidden');
    expect(indicatorLeft).toBeGreaterThanOrEqual(0);
    expect(indicatorTop).toBeGreaterThanOrEqual(0);
    expect(indicatorLeft + indicatorWidth).toBeLessThanOrEqual(200);
    expect(indicatorTop + indicatorHeight).toBeLessThanOrEqual(150);
    expect(rightHandle?.style.right).toBe('0px');
  });

  it('zooms in when an inward drag starts from a clipped resize handle', () => {
    const onViewportChange = jest.fn();

    render(
      <Minimap
        strokes={[]}
        viewport={{ scale: 0.25, tx: 0, ty: 0 }}
        onViewportChange={onViewportChange}
        hostSize={{ width: 1000, height: 800 }}
        width={200}
        height={150}
        testID="minimap"
      />
    );

    const minimap = screen.getByTestId('minimap');
    Object.defineProperty(minimap, 'setPointerCapture', {
      configurable: true,
      value: jest.fn(),
    });
    const cornerHandle = minimap.querySelector<HTMLElement>('[data-minimap-edge="corner-br"]');
    expect(cornerHandle).not.toBeNull();
    if (!cornerHandle) throw new Error('Bottom-right minimap resize handle not found');

    const pointerDown = new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 200,
      clientY: 150,
    });
    Object.defineProperties(pointerDown, {
      pointerId: { value: 1 },
      pointerType: { value: 'mouse' },
    });
    fireEvent(cornerHandle, pointerDown);

    const pointerMove = new MouseEvent('pointermove', {
      bubbles: true,
      clientX: 150,
      clientY: 100,
    });
    Object.defineProperties(pointerMove, {
      pointerId: { value: 1 },
      pointerType: { value: 'mouse' },
    });
    fireEvent(minimap, pointerMove);

    expect(onViewportChange).toHaveBeenCalledWith(
      expect.objectContaining({ scale: expect.any(Number) })
    );
    expect(onViewportChange.mock.calls[0][0].scale).toBeGreaterThan(0.25);
  });
});
