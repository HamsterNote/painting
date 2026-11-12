import { createEraserTrail } from '../layered/eraserTrail';
import { createSemanticWebAdapter } from '../layered/semanticWebAdapter';
import { layeredRect, makeLayeredController } from './fixtures/layered';

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  document.body.innerHTML = '';
});

test('one continuous trail follows viewport and fades within 1s of release without animation frames', () => {
  const controller = makeLayeredController();
  const host = document.createElement('div');
  const raf = jest.spyOn(window, 'requestAnimationFrame');
  const trail = createEraserTrail(host, controller);
  const documentBefore = controller.getSnapshot('document');
  const historyBefore = controller.getSnapshot('history');
  expect(jest.getTimerCount()).toBe(0);
  trail.begin({ x: 10, y: 20 });
  jest.advanceTimersByTime(1000);
  trail.append([{ x: 30, y: 40 }]);
  expect(host.querySelectorAll('path')).toHaveLength(1);
  expect(host.querySelector('path')?.getAttribute('d')).toBe('M 10 20 L 10 20 L 30 40');
  expect(host.querySelector('svg')?.style.opacity).toBe('0.45');
  expect(jest.getTimerCount()).toBe(0);
  controller.updateViewport({
    type: 'replace',
    expectedRevision: 0,
    viewport: { scale: 2, tx: 50, ty: -10 },
  });
  expect(host.querySelector('g')?.getAttribute('transform')).toBe('translate(50 -10) scale(2)');
  expect(host.querySelector('path')?.getAttribute('vector-effect')).toBe('non-scaling-stroke');
  trail.finish(() => {});
  expect(host.querySelector('g')?.style.animation).toBe('hn-eraser-fade 1000ms linear forwards');
  jest.advanceTimersByTime(999);
  expect(host.querySelectorAll('path')).toHaveLength(1);
  jest.advanceTimersByTime(1);
  expect(host.querySelector('svg')).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
  expect(controller.getSnapshot('document')).toBe(documentBefore);
  expect(controller.getSnapshot('history')).toBe(historyBefore);
  expect(raf).not.toHaveBeenCalled();
  trail.destroy();
  raf.mockRestore();
});

function send(target: EventTarget, phase: string, x = 50, y = 50) {
  const event = new Event(`pointer${phase}`, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: 1, pointerType: 'pen', clientX: x, clientY: y, button: 0 });
  target.dispatchEvent(event);
}

test('starting a new erase retires the old fade timer without clearing the new trail', () => {
  const host = document.createElement('div');
  const trail = createEraserTrail(host, makeLayeredController());
  trail.begin({ x: 10, y: 20 });
  trail.finish(() => {});
  jest.advanceTimersByTime(500);
  trail.begin({ x: 30, y: 40 });
  expect(jest.getTimerCount()).toBe(0);
  jest.advanceTimersByTime(500);
  expect(host.querySelector('path')?.getAttribute('d')).toBe('M 30 40 L 30 40');
  trail.finish(() => {});
  jest.advanceTimersByTime(1000);
  expect(host.querySelector('svg')).toBeNull();
  trail.destroy();
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
    if (reason === 'expiry') jest.advanceTimersByTime(1000);
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
