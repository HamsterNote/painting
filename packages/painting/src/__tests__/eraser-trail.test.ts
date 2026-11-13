import { createEraserTrail } from '../layered/eraserTrail';
import { createSemanticWebAdapter } from '../layered/semanticWebAdapter';
import { layeredRect, makeLayeredController } from './fixtures/layered';

beforeEach(() => {
  jest.useFakeTimers();
  // These assertions own eraser feedback timers, not the independent lasso
  // idle-preparation scheduler (covered by layered-lasso-scheduling.test.ts).
  Object.assign(window, { __paintingTestLassoWarmup: false });
});
afterEach(() => {
  delete (window as Window & { __paintingTestLassoWarmup?: boolean }).__paintingTestLassoWarmup;
  jest.useRealTimers();
  document.body.innerHTML = '';
});

test('points fade and expire while held, retaining only the live suffix across viewport changes', () => {
  const controller = makeLayeredController();
  const host = document.createElement('div');
  const trail = createEraserTrail(host, controller);
  const documentBefore = controller.getSnapshot('document');
  const historyBefore = controller.getSnapshot('history');
  trail.begin({ x: 10, y: 20, time: 0 });
  jest.advanceTimersByTime(400);
  trail.append([{ x: 110, y: 20, time: 400 }]);
  // The first point already lost 40% of its opacity, without a pointerup.
  expect(host.querySelector('stop')?.getAttribute('stop-color')).toBe('rgb(153,153,153)');
  jest.advanceTimersByTime(400);
  trail.append([{ x: 210, y: 20, time: 800 }]);
  jest.advanceTimersByTime(400);
  // At 1200ms, the 0ms dot is gone and the 0..400ms segment starts at 200ms.
  expect(host.querySelectorAll('path')).toHaveLength(2);
  expect(host.querySelector('path')?.getAttribute('d')).toBe('M 60 20 L 110 20');
  expect(host.querySelector('stop')?.getAttribute('stop-color')).toBe('rgb(0,0,0)');
  expect(
    host.querySelector('linearGradient:last-child stop:last-child')?.getAttribute('stop-color')
  ).toBe('rgb(153,153,153)');
  controller.updateViewport({
    type: 'replace',
    expectedRevision: 0,
    viewport: { scale: 2, tx: 50, ty: -10 },
  });
  expect(host.querySelector('g')?.getAttribute('transform')).toBe('translate(50 -10) scale(2)');
  expect(host.querySelector('path')?.getAttribute('vector-effect')).toBe('non-scaling-stroke');
  jest.advanceTimersByTime(608);
  expect(host.querySelector('svg')).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
  // Expiry stops rendering, not the active gesture: a later move can resume it.
  trail.append([{ x: 310, y: 20, time: 1808 }]);
  expect(host.querySelector('svg')).not.toBeNull();
  expect(controller.getSnapshot('document')).toBe(documentBefore);
  expect(controller.getSnapshot('history')).toBe(historyBefore);
  trail.destroy();
  expect(jest.getTimerCount()).toBe(0);
});

function send(target: EventTarget, phase: string, x = 50, y = 50) {
  const event = new Event(`pointer${phase}`, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: 1, pointerType: 'pen', clientX: x, clientY: y, button: 0 });
  Object.defineProperty(event, 'timeStamp', { value: performance.now() });
  target.dispatchEvent(event);
}

test('release and repeated stationary samples never restart a point lifetime', () => {
  const host = document.createElement('div');
  const trail = createEraserTrail(host, makeLayeredController());
  trail.begin({ x: 10, y: 20, time: 0 });
  jest.advanceTimersByTime(800);
  trail.append([{ x: 10, y: 20, time: 800 }]);
  trail.finish(() => {});
  expect(host.querySelectorAll('path')).toHaveLength(1);
  expect(host.querySelector('stop')?.getAttribute('stop-color')).toBe('rgb(51,51,51)');
  jest.advanceTimersByTime(208);
  expect(host.querySelector('svg')).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
  trail.destroy();
});

test.each([true, false])(
  'resuming after a 5s hold draws a complete fresh segment (stationary sample=%s)',
  (stationarySample) => {
    const host = document.createElement('div');
    const trail = createEraserTrail(host, makeLayeredController());
    trail.begin({ x: 0, y: 100, time: 0 });
    jest.advanceTimersByTime(5000);
    if (stationarySample) trail.append([{ x: 0, y: 100, time: 5000 }]);
    expect(host.querySelector('svg')).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(10);
    trail.append([{ x: 100, y: 100, time: 5010 }]);
    expect(host.querySelector('path')?.getAttribute('d')).toBe('M 0 100 L 100 100');
    const intensity = () =>
      Number(host.querySelector('stop')!.getAttribute('stop-color')!.match(/\d+/)![0]);
    expect(intensity()).toBeGreaterThanOrEqual(252);
    jest.advanceTimersByTime(500);
    expect(host.querySelector('path')?.getAttribute('d')).toBe('M 0 100 L 100 100');
    expect(intensity()).toBeGreaterThan(120);
    expect(intensity()).toBeLessThan(140);
    trail.finish(() => {});
    jest.advanceTimersByTime(510);
    expect(host.querySelector('svg')).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
    trail.destroy();
  }
);

test('separate gestures keep their own ages and never connect across the gap', () => {
  const host = document.createElement('div');
  const trail = createEraserTrail(host, makeLayeredController());
  trail.begin({ x: 10, y: 20, time: 0 });
  trail.finish(() => {});
  jest.advanceTimersByTime(400);
  trail.begin({ x: 30, y: 40, time: 400 });
  expect([...host.querySelectorAll('path')].map((path) => path.getAttribute('d'))).toEqual([
    'M 10 20 L 10 20',
    'M 30 40 L 30 40',
  ]);
  jest.advanceTimersByTime(608);
  expect(host.querySelectorAll('path')).toHaveLength(1);
  expect(host.querySelector('path')?.getAttribute('d')).toBe('M 30 40 L 30 40');
  trail.finish(() => {});
  jest.advanceTimersByTime(400);
  expect(host.querySelector('svg')).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
  trail.destroy();
});

test('five seconds of continuous movement retain at most one second of feedback', () => {
  const host = document.createElement('div');
  const trail = createEraserTrail(host, makeLayeredController());
  trail.begin({ x: 0, y: 20, time: 0 });
  for (let time = 16; time <= 5008; time += 16) {
    jest.advanceTimersByTime(16);
    trail.append([{ x: time, y: 20, time }]);
  }
  expect(host.querySelectorAll('path').length).toBeLessThanOrEqual(63);
  expect(host.querySelector('path')?.getAttribute('d')).toBe('M 4008 20 L 4016 20');
  trail.destroy();
  expect(jest.getTimerCount()).toBe(0);
});

test('coalesced input keeps each sample timestamp instead of the delivery time', () => {
  const controller = makeLayeredController();
  controller.setTool('eraser');
  const host = document.createElement('div');
  document.body.append(host);
  const adapter = createSemanticWebAdapter({
    host,
    controller,
    allocateId: () => 'unused',
    onText: jest.fn(),
    onError: jest.fn(),
  });
  send(host, 'down', 10, 20);
  jest.advanceTimersByTime(800);
  const event = new Event('pointermove', { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerId: 1,
    pointerType: 'pen',
    getCoalescedEvents: () => [
      { clientX: 50, clientY: 20, timeStamp: 400 },
      { clientX: 90, clientY: 20, timeStamp: 600 },
    ],
  });
  window.dispatchEvent(event);
  const ends = [...host.querySelectorAll('linearGradient stop:last-child')].map((stop) =>
    stop.getAttribute('stop-color')
  );
  expect(ends).toEqual(['rgb(51,51,51)', 'rgb(153,153,153)', 'rgb(204,204,204)']);
  adapter.destroy();
  expect(jest.getTimerCount()).toBe(0);
});

test('clearing during a live erase does not recreate feedback or commit on late move/up', () => {
  const controller = makeLayeredController([layeredRect('a')]);
  controller.setTool('eraser');
  const host = document.createElement('div');
  document.body.append(host);
  const error = jest.fn();
  const adapter = createSemanticWebAdapter({
    host,
    controller,
    allocateId: () => 'unused',
    onText: jest.fn(),
    onError: error,
  });
  send(host, 'down');
  expect(host.querySelector('[data-eraser-trail]')).not.toBeNull();
  controller.editObjects({ expectedDocumentRevision: 0, removeIds: ['a'] });
  const cleared = controller.getSnapshot('document');
  const history = controller.getSnapshot('history');
  expect(host.querySelector('[data-eraser-trail]')).toBeNull();
  send(window, 'move', 100, 100);
  send(window, 'up', 120, 120);
  expect(host.querySelector('[data-eraser-trail]')).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
  expect(controller.getSnapshot('document')).toBe(cleared);
  expect(controller.getSnapshot('history')).toBe(history);
  expect(error).not.toHaveBeenCalled();
  adapter.destroy();
});

test.each([
  'expiry',
  'tool',
  'clear',
  'undo',
  'redo',
  'cancel',
  'blur',
  'hidden',
  'pagehide',
  'destroy',
])(
  'accepted erasure retains transient feedback until %s, then leaves no timers or stale gesture',
  (reason) => {
    const controller = makeLayeredController([layeredRect('a'), layeredRect('b')]);
    controller.setTool('eraser');
    const host = document.createElement('div');
    document.body.append(host);
    const error = jest.fn();
    const adapter = createSemanticWebAdapter({
      host,
      controller,
      allocateId: () => 'unused',
      onText: jest.fn(),
      onError: error,
    });
    send(host, 'down');
    send(window, 'move', 60, 60);
    send(window, 'up', 60, 60);
    expect(host.querySelector('[data-eraser-trail]')).not.toBeNull();
    expect(controller.getSnapshot('document').objects).toHaveLength(0);
    if (reason === 'expiry') jest.advanceTimersByTime(1008);
    else if (reason === 'tool') controller.setTool('rect');
    else if (reason === 'undo') controller.undo();
    else if (reason === 'redo') {
      controller.undo();
      send(host, 'down', 300, 300);
      send(window, 'up', 300, 300);
      controller.redo();
    } else if (reason === 'clear') {
      controller.undo();
      send(host, 'down', 300, 300);
      send(window, 'up', 300, 300);
      controller.editObjects({
        expectedDocumentRevision: controller.getSnapshot('document').documentRevision,
        removeIds: ['a', 'b'],
      });
    } else if (reason === 'cancel') {
      send(host, 'down', 300, 300);
      send(window, 'cancel', 310, 300);
    } else if (reason === 'hidden') {
      const visibility = jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      visibility.mockRestore();
    } else if (reason === 'destroy') adapter.destroy();
    else window.dispatchEvent(new Event(reason));
    expect(host.querySelector('[data-eraser-trail]')).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
    send(window, 'move', 320, 300);
    expect(host.querySelector('[data-eraser-trail]')).toBeNull();
    expect(error).not.toHaveBeenCalled();
    if (reason !== 'destroy') adapter.destroy();
  }
);
