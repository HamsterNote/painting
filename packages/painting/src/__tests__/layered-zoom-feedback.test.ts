import { createZoomFeedback } from '../layered/zoomFeedback';
import { makeLayeredController } from './fixtures/layered';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('latest wheel or touch feedback owns timeout; older source cannot clear it', () => {
  const controller = makeLayeredController();
  const wheel = createZoomFeedback(controller, window);
  const touch = createZoomFeedback(controller, window);
  wheel.show(2, { x: 10, y: 20 });
  jest.advanceTimersByTime(400);
  touch.show(3, { x: 30, y: 40 });
  jest.advanceTimersByTime(300);
  expect(controller.getSnapshot('navigation').zoomFeedback).toMatchObject({
    scale: 3,
    point: { x: 30, y: 40 },
  });
  jest.advanceTimersByTime(400);
  expect(controller.getSnapshot('navigation').zoomFeedback).toBeNull();
  expect(controller.getSnapshot('history').canUndo).toBe(false);
});

test('dispose clears feedback and timer; invalid values are rejected', () => {
  const controller = makeLayeredController();
  const feedback = createZoomFeedback(controller, window);
  feedback.show(2, { x: 10, y: 20 });
  feedback.clear();
  expect(jest.getTimerCount()).toBe(0);
  expect(controller.getSnapshot('navigation').zoomFeedback).toBeNull();
  expect(
    controller.setNavigation({ zoomFeedback: { scale: NaN, point: { x: 0, y: 0 }, token: 1 } }).ok
  ).toBe(false);
});
