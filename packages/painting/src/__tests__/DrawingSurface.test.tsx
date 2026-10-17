// Retained surface behavior now exercises the schema3 runtime.
import { act, render, screen } from '@testing-library/react';
import { LayeredDrawingSurface } from '../layered/DrawingSurface';
import { makeLayeredController } from './fixtures/layered';
import { layeredPointer as pointer, mockLayeredDom } from './fixtures/layeredDom';

beforeEach(() => {
  mockLayeredDom();
});
afterEach(() => jest.restoreAllMocks());

test('tap persists a dot with real pen pressure and a single reversible transaction', () => {
  const controller = makeLayeredController();
  render(<LayeredDrawingSurface controller={controller} />);
  const host = screen.getByTestId('layered-surface');
  pointer(host, 'down', 50, 50);
  pointer(window, 'up', 50, 50);
  const objects = controller.getSnapshot('document').objects;
  expect(objects).toHaveLength(1);
  expect(objects[0]).toMatchObject({
    kind: 'freehand',
    resolvedPressureMode: 'real',
    samples: [
      { x: 50, y: 50, phase: 'down', pressure: 0.5 },
      { x: 50, y: 50, phase: 'up', pressure: 0 },
    ],
  });
  act(() => {
    controller.undo();
  });
  expect(controller.getSnapshot('document').objects).toHaveLength(0);
  expect(controller.getSnapshot('history').canUndo).toBe(false);
  act(() => {
    controller.redo();
  });
  expect(controller.getSnapshot('document').objects).toEqual(objects);
});

test.each(['line', 'rect', 'ellipse', 'polygon', 'bezier'] as const)(
  '%s updates preview before release and cancels without writing history',
  (tool) => {
    const controller = makeLayeredController();
    controller.setTool(tool);
    render(<LayeredDrawingSurface controller={controller} />);
    const host = screen.getByTestId('layered-surface');
    pointer(host, 'down', 20, 20);
    pointer(window, 'move', 120, 20);
    pointer(window, 'move', 120, 100);
    pointer(window, 'move', 20, 100);
    expect(controller.getSnapshot('preview').objects).toHaveLength(1);
    expect(controller.getSnapshot('document').objects).toHaveLength(0);
    pointer(window, 'cancel', 120, 100);
    expect(controller.getSnapshot('preview').objects).toHaveLength(0);
    expect(controller.getSnapshot('history').canUndo).toBe(false);
  }
);

test('brush changes affect the next stroke and competing input cannot change frozen viewport', () => {
  const controller = makeLayeredController();
  render(<LayeredDrawingSurface controller={controller} />);
  const host = screen.getByTestId('layered-surface');
  const viewport = controller.getSnapshot('viewport');
  pointer(host, 'down', 20, 20);
  act(() => {
    controller.setFreehandSettings({
      ...controller.getSnapshot('tools').settings.freehand,
      color: '#ff0000',
      nominalSize: 30,
    });
  });
  pointer(host, 'down', 400, 400, 'touch', 2);
  pointer(window, 'move', 500, 500, 'touch', 2);
  pointer(window, 'up', 500, 500, 'touch', 2);
  pointer(window, 'up', 120, 20);
  expect(controller.getSnapshot('document').objects[0]).toMatchObject({
    brushSnapshot: { color: '#008060', nominalSize: 12 },
  });
  expect(controller.getSnapshot('viewport')).toEqual(viewport);
  pointer(host, 'down', 20, 100);
  pointer(window, 'up', 120, 100);
  expect(controller.getSnapshot('document').objects[1]).toMatchObject({
    brushSnapshot: { color: '#ff0000', nominalSize: 30 },
  });
});

test.each(['cancel', 'blur', 'pagehide', 'unmount', 'tool'] as const)(
  '%s discards active ink and rejects late release',
  (reason) => {
    const controller = makeLayeredController();
    const surface = render(<LayeredDrawingSurface controller={controller} />);
    const host = screen.getByTestId('layered-surface');
    pointer(host, 'down', 20, 20);
    pointer(window, 'move', 120, 20);
    act(() => {
      if (reason === 'unmount') surface.unmount();
      else if (reason === 'tool') controller.setTool('rect');
      else if (reason === 'cancel') pointer(window, 'cancel', 120, 20);
      else window.dispatchEvent(new Event(reason));
    });
    pointer(window, 'up', 120, 20);
    expect(controller.getSnapshot('document').objects).toHaveLength(0);
    expect(controller.getSnapshot('history').canUndo).toBe(false);
  }
);

test('mouse policy can disable drawing without globally forcing pen-only behavior', () => {
  const controller = makeLayeredController();
  const surface = render(
    <LayeredDrawingSurface
      controller={controller}
      inputPolicy={{ mouse: 'none', pen: 'draw', touch: 'none' }}
    />
  );
  const host = screen.getByTestId('layered-surface');
  pointer(host, 'down', 20, 20, 'mouse');
  pointer(window, 'up', 120, 20, 'mouse');
  expect(controller.getSnapshot('document').objects).toHaveLength(0);
  surface.rerender(
    <LayeredDrawingSurface
      controller={controller}
      inputPolicy={{ mouse: 'draw', pen: 'draw', touch: 'none' }}
    />
  );
  pointer(host, 'down', 20, 20, 'mouse');
  pointer(window, 'up', 120, 20, 'mouse');
  expect(controller.getSnapshot('document').objects[0]).toMatchObject({
    resolvedPressureMode: 'simulated',
  });
});
