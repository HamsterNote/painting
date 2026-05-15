import PaintingDefault, {
  DrawingSurface as DrawingSurfaceFromIndex,
  HamsterPainting as HamsterPaintingFromIndex,
} from '@hamster-note/painting';
import type React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import DrawingSurfaceDefault, {
  DrawingSurface,
  HamsterPainting,
} from '../components/DrawingSurface';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderSurface(props: React.ComponentProps<typeof DrawingSurface> = {}) {
  let renderer: TestRenderer.ReactTestRenderer | null = null;

  act(() => {
    renderer = TestRenderer.create(<DrawingSurface {...props} />);
  });

  if (!renderer) {
    throw new Error('Unable to render DrawingSurface');
  }

  return renderer;
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createPointerEvent(
  x: number,
  y: number
): {
  pointerId: number;
  pointerType: string;
  timeStamp: number;
  nativeEvent: { offsetX: number; offsetY: number };
  preventDefault: jest.Mock;
  currentTarget: { setPointerCapture: jest.Mock };
} {
  return {
    pointerId: 1,
    pointerType: 'mouse',
    timeStamp: 123,
    nativeEvent: { offsetX: x, offsetY: y },
    preventDefault: jest.fn(),
    currentTarget: { setPointerCapture: jest.fn() },
  };
}

function findSurfaceDiv(renderer: TestRenderer.ReactTestRenderer, testID: string) {
  const surface = renderer.root
    .findAllByType('div')
    .find((div) => div.props['data-testid'] === testID);

  if (!surface) {
    throw new Error(`Unable to find surface div: ${testID}`);
  }

  return surface;
}

describe('DrawingSurface', () => {
  it('resolves default and named exports to the same component', () => {
    expect(typeof DrawingSurfaceDefault).toBe('function');
    expect(DrawingSurface).toBe(DrawingSurfaceDefault);
    expect(HamsterPainting).toBe(DrawingSurfaceDefault);
  });

  it('resolves index exports to the same implementation', () => {
    expect(PaintingDefault).toBe(DrawingSurfaceDefault);
    expect(DrawingSurfaceFromIndex).toBe(DrawingSurfaceDefault);
    expect(HamsterPaintingFromIndex).toBe(DrawingSurfaceDefault);
  });

  it('accepts testID prop and renders the canvas host', async () => {
    const renderer = renderSurface({ testID: 'drawing-surface-smoke' });
    await flushPromises();

    expect(renderer.root.findByProps({ 'data-testid': 'drawing-surface-smoke' })).toBeTruthy();
    expect(renderer.root.findByType('canvas')).toBeTruthy();
  });

  it('accepts onStrokeCountChange prop', async () => {
    const onStrokeCountChange = jest.fn();

    expect(renderSurface({ onStrokeCountChange })).toBeTruthy();
    await flushPromises();
    expect(onStrokeCountChange).not.toHaveBeenCalled();
  });

  it('reports stroke count after a drag sequence', async () => {
    const onStrokeCountChange = jest.fn();
    const renderer = renderSurface({
      testID: 'drawing-surface',
      onStrokeCountChange,
    });
    await flushPromises();
    const surface = findSurfaceDiv(renderer, 'drawing-surface');

    act(() => {
      surface.props.onPointerDown(createPointerEvent(10, 12));
    });
    act(() => {
      surface.props.onPointerMove(createPointerEvent(20, 24));
    });
    act(() => {
      surface.props.onPointerUp(createPointerEvent(30, 36));
    });

    expect(onStrokeCountChange).toHaveBeenCalledWith(1);
  });

  it('cleans up on unmount during active draw', async () => {
    const renderer = renderSurface({ testID: 'drawing-surface' });
    await flushPromises();
    const surface = findSurfaceDiv(renderer, 'drawing-surface');

    act(() => {
      surface.props.onPointerDown(createPointerEvent(10, 12));
    });
    act(() => {
      renderer.unmount();
    });

    expect(() => renderer.unmount()).not.toThrow();
  });

  it('does not report stroke count for tap-only input', async () => {
    const onStrokeCountChange = jest.fn();
    const renderer = renderSurface({
      testID: 'drawing-surface',
      onStrokeCountChange,
    });
    await flushPromises();
    const surface = findSurfaceDiv(renderer, 'drawing-surface');

    act(() => {
      surface.props.onPointerDown(createPointerEvent(10, 12));
    });
    act(() => {
      surface.props.onPointerUp(createPointerEvent(10, 12));
    });

    expect(onStrokeCountChange).not.toHaveBeenCalled();
  });
});
