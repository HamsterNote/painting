import { createSemanticWebAdapter } from '../layered/semanticWebAdapter';
import type { LassoPerformanceEvent } from '../core/layeredToolSession';
import { layeredRect, makeLayeredController } from './fixtures/layered';

describe('lasso capture routing does not end the gesture', () => {
  let host: HTMLDivElement;
  let adapter: ReturnType<typeof createSemanticWebAdapter>;
  let controller: ReturnType<typeof makeLayeredController>;
  let events: LassoPerformanceEvent[];
  let errors: jest.Mock;
  const perfWindow = window as Window & {
    __paintingTestLassoPerf?: (event: LassoPerformanceEvent) => void;
    __paintingTestLassoWarmup?: boolean;
  };
  const send = (type: string, target: EventTarget = window, x = -20, y = -20) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: x,
      clientY: y,
    });
    target.dispatchEvent(event);
  };
  const count = (event: LassoPerformanceEvent['event']) =>
    events.filter((e) => e.event === event).length;
  beforeEach(() => {
    jest.useFakeTimers();
    events = [];
    errors = jest.fn();
    perfWindow.__paintingTestLassoPerf = (event) => events.push(event);
    perfWindow.__paintingTestLassoWarmup = false;
    controller = makeLayeredController([
      layeredRect('second'),
      layeredRect('first'),
      { ...layeredRect('outside'), transform: { a: 1, b: 0, c: 0, d: 1, tx: 400, ty: 0 } },
    ]);
    controller.setSelection(['outside']);
    controller.setTool('lasso');
    host = document.createElement('div');
    document.body.append(host);
    // Explicit capture release may synchronously notify; owner is cleared first.
    host.setPointerCapture = jest.fn();
    host.releasePointerCapture = jest.fn(() => send('lostpointercapture', host));
    adapter = createSemanticWebAdapter({
      host,
      controller,
      allocateId: () => 'unused',
      onText: jest.fn(),
      onError: errors,
    });
    send('pointerdown', host);
    for (const [x, y] of [
      [120, -20],
      [120, 120],
      [-20, 120],
    ])
      send('pointermove', window, x, y);
    jest.runOnlyPendingTimers();
  });
  afterEach(() => {
    adapter.destroy();
    host.remove();
    delete perfWindow.__paintingTestLassoPerf;
    delete perfWindow.__paintingTestLassoWarmup;
    jest.useRealTimers();
  });

  test.each(['lost-before-up', 'up-before-lost'])(
    '%s commits ordered IDs exactly once, including duplicate terminal events',
    (order) => {
      const document = controller.getSnapshot('document');
      const history = controller.getSnapshot('history');
      expect(count('query-start')).toBe(0);
      if (order === 'lost-before-up') {
        send('lostpointercapture', host);
      }
      expect(count('cancel')).toBe(0);
      expect(controller.getSnapshot('preview').path.length).toBeGreaterThan(0);
      send('pointerup');
      send('lostpointercapture', host);
      send('pointerup');
      jest.runAllTimers();
      expect(controller.getSnapshot('selection')).toEqual(['second', 'first']);
      for (const name of ['query-start', 'query-complete', 'selection-submit'] as const)
        expect(count(name)).toBe(1);
      expect(count('cancel')).toBe(0);
      expect(controller.getSnapshot('document')).toBe(document);
      expect(controller.getSnapshot('history')).toEqual(history);
      expect(errors).not.toHaveBeenCalled();
    }
  );

  test.each(['pointercancel', 'blur', 'hidden', 'unmount'])(
    '%s still cancels after capture loss and rejects a late release',
    (reason) => {
      expect(count('query-start')).toBe(0);
      send('lostpointercapture', host);
      expect(count('cancel')).toBe(0);
      if (reason === 'hidden') {
        const spy = jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
        spy.mockRestore();
      } else if (reason === 'unmount') adapter.destroy();
      else send(reason);
      send('pointerup');
      jest.runAllTimers();
      expect(count('cancel')).toBe(1);
      expect(count('query-start')).toBe(0);
      expect(count('selection-submit')).toBe(0);
      expect(controller.getSnapshot('selection')).toEqual(['outside']);
      expect(controller.getSnapshot('preview').path).toEqual([]);
      expect(controller.getSnapshot('history').canUndo).toBe(false);
      expect(errors).not.toHaveBeenCalled();
    }
  );
});
