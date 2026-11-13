import { createSemanticWebAdapter } from '../layered/semanticWebAdapter';
import { createLayeredInputArbiter } from '../input/web/layeredInputArbiter';
import { prepareLayeredObjectQuery, queryObjectLasso } from '../core/layeredObjectQuery';
import { FreehandGeometryCache } from '../geometry/freehandCache';
import type { LassoPerformanceEvent } from '../core/layeredToolSession';
import { layeredRect, makeLayeredController } from './fixtures/layered';

describe.each(['direct', 'arbitrated'] as const)('%s stale semantic owner', (mode) => {
  const path = [
    { x: -20, y: -20 },
    { x: 120, y: -20 },
    { x: 120, y: 120 },
    { x: -20, y: 120 },
    { x: -20, y: -20 },
  ];
  let host: HTMLDivElement;
  let controller: ReturnType<typeof makeLayeredController>;
  let adapter: ReturnType<typeof createSemanticWebAdapter>;
  let arbiter: ReturnType<typeof createLayeredInputArbiter> | undefined;
  let events: LassoPerformanceEvent[];
  const trace = jest.fn();
  const error = jest.fn();
  const navigation = {
    dispatch: jest.fn(),
    begin: jest.fn<void, [readonly PointerEvent[]]>(),
    cancel: jest.fn(() => true),
  };
  const perfWindow = window as Window & {
    __paintingTestLassoPerf?: (event: LassoPerformanceEvent) => void;
    __paintingTestLassoWarmup?: boolean;
  };
  function send(
    type: string,
    id: number,
    source: string,
    primary: boolean | undefined = true,
    point = path[0]
  ) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, {
      pointerId: id,
      pointerType: source,
      isPrimary: primary,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: point.x,
      clientY: point.y,
    });
    (type === 'pointerdown' || type === 'lostpointercapture' ? host : window).dispatchEvent(event);
  }
  const count = (name: LassoPerformanceEvent['event']) =>
    events.filter((e) => e.event === name).length;
  const begins = () => trace.mock.calls.filter(([e]) => e.action === 'begin').length;
  function finish(id: number, source: string) {
    path.slice(1, -1).forEach((point) => send('pointermove', id, source, true, point));
    send('pointerup', id, source);
    send('pointerup', id, source);
    jest.runAllTimers();
  }
  function expectSelection() {
    const prepared = prepareLayeredObjectQuery(
      controller.getSnapshot('document'),
      new FreehandGeometryCache()
    );
    if (!prepared.ok) throw new Error(prepared.error.code);
    const oracle = queryObjectLasso(prepared.value, path, 'intersects');
    if (!oracle.ok) throw new Error(oracle.error.code);
    expect(controller.getSnapshot('selection')).toEqual(oracle.value.map((hit) => hit.objectId));
    expect(controller.getSnapshot('selection')).toEqual(['second', 'first']);
    expect(count('query-start')).toBe(1);
    expect(count('query-complete')).toBe(1);
    expect(count('selection-submit')).toBe(1);
    expect(error).not.toHaveBeenCalled();
  }
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    events = [];
    perfWindow.__paintingTestLassoPerf = (event) => events.push(event);
    perfWindow.__paintingTestLassoWarmup = false;
    controller = makeLayeredController([layeredRect('second'), layeredRect('first')]);
    controller.setTool('lasso');
    host = document.createElement('div');
    document.body.append(host);
    host.setPointerCapture = jest.fn();
    host.releasePointerCapture = jest.fn();
    adapter = createSemanticWebAdapter({
      host,
      controller,
      allocateId: () => 'unused',
      onText: jest.fn(),
      onError: error,
      onTrace: trace,
      listen: mode === 'direct',
    });
    if (mode === 'arbitrated')
      arbiter = createLayeredInputArbiter({ host, controller, tool: adapter, navigation });
  });
  afterEach(() => {
    arbiter?.destroy();
    arbiter = undefined;
    adapter.destroy();
    host.remove();
    delete perfWindow.__paintingTestLassoPerf;
    delete perfWindow.__paintingTestLassoWarmup;
    jest.useRealTimers();
  });

  test.each(['mouse', 'pen', 'touch'])(
    '%s missing terminal cancels old session then commits a fresh one',
    (source) => {
      send('pointerdown', 1, source);
      send('pointermove', 1, source, true, path[1]);
      send('lostpointercapture', 1, source);
      expect(count('cancel')).toBe(0);
      send('pointerdown', 2, source);
      expect(begins()).toBe(2);
      expect(count('cancel')).toBe(1);
      // Late old terminal must not end the new owner.
      send('pointerup', 1, source);
      expect(count('query-start')).toBe(0);
      finish(2, source);
      expectSelection();
    }
  );

  test('mouse pointer ID reuse starts a new cycle', () => {
    send('pointerdown', 1, 'mouse');
    send('lostpointercapture', 1, 'mouse');
    send('pointerdown', 1, 'mouse');
    expect(begins()).toBe(2);
    expect(count('cancel')).toBe(1);
    finish(1, 'mouse');
    expectSelection();
  });

  test.each(['touch', 'pen'])(
    'secondary %s does not cancel a pen lasso after capture loss',
    (secondary) => {
      send('pointerdown', 1, 'pen');
      send('lostpointercapture', 1, 'pen');
      send('pointerdown', 2, secondary, false);
      expect(begins()).toBe(1);
      expect(count('cancel')).toBe(0);
      finish(1, 'pen');
      expectSelection();
      expect(navigation.begin).not.toHaveBeenCalled();
    }
  );

  test('second touch keeps existing navigation arbitration', () => {
    send('pointerdown', 1, 'touch');
    send('lostpointercapture', 1, 'touch');
    send('pointerdown', 2, 'touch', false);
    expect(begins()).toBe(1);
    expect(count('cancel')).toBe(mode === 'arbitrated' ? 1 : 0);
    expect(navigation.begin).toHaveBeenCalledTimes(mode === 'arbitrated' ? 1 : 0);
    expect((navigation.begin.mock.calls[0]?.[0] ?? []).map((e) => e.pointerId)).toEqual(
      mode === 'arbitrated' ? [1, 2] : []
    );
    finish(1, 'touch');
    expect(count('query-start')).toBe(mode === 'arbitrated' ? 0 : 1);
    expect(controller.getSnapshot('selection')).toEqual(
      mode === 'arbitrated' ? [] : ['second', 'first']
    );
  });
});
