import { act, render } from '@testing-library/react';
import { DisplayLayer } from '../layered/DisplayLayer';
import { createDrawingCanvas } from '../layered/drawingCanvas';
import { PresentationCoordinator } from '../layered/PresentationCoordinator';
import { commitLayeredStroke, layeredRect, makeLayeredController } from './fixtures/layered';

test('raw append/resize/zoom repaint Canvas while history never reconciles per sample', () => {
  const controller = makeLayeredController([layeredRect()]);
  const queue = new PresentationCoordinator(controller);
  const onRender = jest.fn();
  const history = render(
    <DisplayLayer controller={controller} presentation={queue} onRender={onRender} />
  );
  const stableNode = history.container.querySelector('[data-object-id="rect"]');
  const canvas = document.createElement('canvas');
  const context = Object.fromEntries(
    [
      'setTransform',
      'clearRect',
      'save',
      'restore',
      'transform',
      'beginPath',
      'moveTo',
      'lineTo',
      'closePath',
      'fill',
    ].map((key) => [key, jest.fn()])
  );
  jest.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  jest
    .spyOn(canvas, 'getBoundingClientRect')
    .mockReturnValue({ width: 300, height: 200 } as DOMRect);
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
  const driver = createDrawingCanvas(canvas, controller, queue);
  const initialRenderCount = onRender.mock.calls.length;
  const base = {
    sessionId: 'live',
    pointerId: 1,
    source: 'pen' as const,
    coordinateSpace: 'world' as const,
    viewportRevision: 0,
  };
  controller.beginFreehand({
    type: 'begin',
    commitId: 'live',
    pressureCapability: 'available',
    batch: {
      ...base,
      batchSequence: 0,
      samples: [{ sequence: 0, x: 10, y: 10, phase: 'down', time: 0 }],
    },
  });
  for (let sequence = 1; sequence <= 30; sequence++)
    controller.updateFreehand({
      type: 'update',
      batch: {
        ...base,
        batchSequence: sequence,
        samples: [{ sequence, x: sequence + 10, y: 10, phase: 'move', time: sequence }],
      },
    });
  driver.paintNow();
  expect(canvas.width).toBe(600);
  expect(canvas.height).toBe(400);
  expect(context.fill).toHaveBeenCalledTimes(1);
  expect(onRender).toHaveBeenCalledTimes(initialRenderCount);
  expect(history.container.querySelector('[data-object-id="rect"]')).toBe(stableNode);
  driver.paintNow();
  expect(context.fill).toHaveBeenCalledTimes(2);
  controller.cancelFreehand({
    type: 'cancel',
    sessionId: 'live',
    pointerId: 1,
    source: 'pen',
    batchSequence: 31,
    reason: 'explicit',
  });
  act(() =>
    controller.updateViewport({
      type: 'replace',
      expectedRevision: 0,
      viewport: { scale: 2, tx: 5, ty: 6 },
    })
  );
  driver.paintNow();
  expect(context.fill).toHaveBeenCalledTimes(2);
  driver.destroy();
  queue.destroy();
  history.unmount();
});

test('a delayed history mount keeps final ink through resize then hands off once', () => {
  const controller = makeLayeredController();
  const queue = new PresentationCoordinator(controller);
  const canvas = document.createElement('canvas');
  const context = Object.fromEntries(
    [
      'setTransform',
      'clearRect',
      'save',
      'restore',
      'transform',
      'beginPath',
      'moveTo',
      'lineTo',
      'closePath',
      'fill',
    ].map((key) => [key, jest.fn()])
  );
  jest.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  jest
    .spyOn(canvas, 'getBoundingClientRect')
    .mockReturnValue({ width: 300, height: 200 } as DOMRect);
  const driver = createDrawingCanvas(canvas, controller, queue);
  commitLayeredStroke(controller, 'final');
  context.fill.mockClear();
  driver.paintNow();
  expect(context.fill).toHaveBeenCalledTimes(1);
  jest
    .spyOn(canvas, 'getBoundingClientRect')
    .mockReturnValue({ width: 300.25, height: 200.25 } as DOMRect);
  driver.paintNow();
  expect(context.setTransform).toHaveBeenLastCalledWith(
    canvas.width / 300.25,
    0,
    0,
    canvas.height / 200.25,
    0,
    0
  );
  const history = render(<DisplayLayer controller={controller} presentation={queue} />);
  expect(queue.getPending()).toHaveLength(0);
  context.fill.mockClear();
  driver.paintNow();
  expect(context.fill).not.toHaveBeenCalled();
  expect(history.container.querySelector('[data-object-id]')?.getAttribute('style')).toContain(
    'visible'
  );
  driver.destroy();
  history.unmount();
  queue.destroy();
});
