import { makeLayeredController } from '../../../__tests__/fixtures/layered';
import { createLayeredInputArbiter } from '../layeredInputArbiter';
import { createFreehandWebAdapter } from '../freehandWebAdapter';
import { createNavigationWebAdapter } from '../../../layered/navigationWebAdapter';

function setup() {
  const host = document.createElement('div');
  const control = document.createElement('button');
  host.append(control);
  document.body.append(host);
  const controller = makeLayeredController();
  const tool = { dispatch: jest.fn(), cancel: jest.fn(() => true) };
  const navigation = { dispatch: jest.fn(), cancel: jest.fn(() => true), begin: jest.fn() };
  const diagnostic = jest.fn();
  const arbiter = createLayeredInputArbiter({
    host,
    controller,
    tool,
    navigation,
    onDiagnostic: diagnostic,
  });
  const send = (
    type = 'pointerdown',
    id = 1,
    source = 'touch',
    target: EventTarget = host,
    overrides = {}
  ) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, {
      pointerId: id,
      pointerType: source,
      clientX: id * 10,
      clientY: 10,
      button: 0,
      pressure: 0.5,
      ...overrides,
    });
    target.dispatchEvent(event);
    return event;
  };
  return {
    host,
    control,
    controller,
    tool,
    navigation,
    diagnostic,
    send,
    destroy: () => {
      arbiter.destroy();
      host.remove();
    },
  };
}

test('routes once, cancels before pair, and suppresses late up', () => {
  const h = setup();
  const event = h.send();
  h.host.dispatchEvent(event);
  expect(h.tool.dispatch).toHaveBeenCalledTimes(1);
  h.send('pointermove', 1, 'touch', window);
  h.send('pointerdown', 2);
  expect(h.tool.cancel).toHaveBeenCalledTimes(1);
  expect(h.navigation.begin).toHaveBeenCalledTimes(1);
  expect(h.tool.cancel.mock.invocationCallOrder[0]).toBeLessThan(
    h.navigation.begin.mock.invocationCallOrder[0]
  );
  h.send('pointerup', 1, 'touch', window);
  h.send('pointerup', 2, 'touch', window);
  expect(h.tool.dispatch).toHaveBeenCalledTimes(2);
  h.destroy();
});

test('only valid canvas pen down latches; controls, hover and invalid sources do not', () => {
  const h = setup();
  h.send('pointerdown', 1, 'pen', h.control);
  h.send('pointermove', 2, 'pen');
  h.send('pointerdown', 3, 'unknown');
  h.send('pointerdown', 4, 'pen', h.host, { clientX: NaN });
  expect(h.controller.getSnapshot('input').penSeen).toBe(false);
  h.send('pointerdown', 5, 'pen', h.host, { pressure: 0 });
  expect(h.controller.getSnapshot('input').penSeen).toBe(true);
  expect(h.tool.dispatch).toHaveBeenCalledTimes(1);
  h.destroy();
});

test('mode change cancels old input and permits a fresh down without reviving old contacts', () => {
  const h = setup();
  h.send();
  h.controller.setInputMode('pen');
  h.send('pointermove', 1, 'touch', window);
  h.send('pointerup', 1, 'touch', window);
  expect(h.tool.cancel).toHaveBeenCalledTimes(1);
  expect(h.tool.dispatch).toHaveBeenCalledTimes(1);
  h.send('pointerdown', 2);
  expect(h.navigation.dispatch).toHaveBeenCalledTimes(1);
  h.controller.setInputMode('finger');
  h.send('pointerdown', 3);
  expect(h.tool.dispatch).toHaveBeenCalledTimes(2);
  h.destroy();
});

test('failed cancel refuses navigation and reports a diagnostic', () => {
  const h = setup();
  h.tool.cancel.mockReturnValue(false);
  h.send();
  h.send('pointerdown', 2);
  expect(h.navigation.begin).not.toHaveBeenCalled();
  expect(h.diagnostic).toHaveBeenCalledTimes(1);
  h.destroy();
});

test.each(['blur', 'pagehide', 'visibilitychange'])(
  '%s cancels and recovers without the old terminal event',
  (kind) => {
    const h = setup();
    h.send();
    if (kind === 'visibilitychange') {
      jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      document.dispatchEvent(new Event(kind));
      jest.restoreAllMocks();
    } else window.dispatchEvent(new Event(kind));
    expect(h.tool.cancel).toHaveBeenCalledTimes(1);
    h.tool.dispatch.mockClear();
    // No terminal event is delivered for the interrupted contact.
    for (const id of [1, 2, 3]) {
      h.send('pointerdown', id);
      h.send('pointermove', id, 'touch', window);
      h.send('pointerup', id, 'touch', window);
    }
    expect(h.tool.dispatch).toHaveBeenCalledTimes(9);
    h.destroy();
    const routed = h.tool.dispatch.mock.calls.length;
    h.send('pointerdown', 3);
    expect(h.tool.dispatch).toHaveBeenCalledTimes(routed);
  }
);

test('destroy cancels without committing and removes all listeners', () => {
  const h = setup();
  h.send();
  h.destroy();
  expect(h.tool.cancel).toHaveBeenCalledTimes(1);
  h.send('pointerdown', 2);
  h.send('pointermove', 1, 'touch', window);
  h.send('pointerup', 1, 'touch', window);
  expect(h.tool.dispatch).toHaveBeenCalledTimes(1);
  h.destroy();
});

describe.each(['blur', 'pagehide', 'hidden'] as const)('%s real ink recovery', (kind) => {
  test.each(['mouse', 'touch'] as const)(
    '%s commits consecutive fresh strokes without old up',
    (source) => {
      const host = document.createElement('div');
      document.body.append(host);
      const controller = makeLayeredController();
      let sequence = 0;
      const ink = createFreehandWebAdapter({
        host,
        controller,
        listen: false,
        createSessionId: () => `s${++sequence}`,
        createCommitId: () => `c${sequence}`,
      });
      const navigation = createNavigationWebAdapter(host, controller, false, undefined, {
        listen: false,
      });
      const arbiter = createLayeredInputArbiter({ host, controller, tool: ink, navigation });
      const send = (phase: string, id: number, x = 10) => {
        const event = new Event(`pointer${phase}`, { bubbles: true, cancelable: true });
        Object.assign(event, {
          pointerId: id,
          pointerType: source,
          clientX: x,
          clientY: 10,
          button: 0,
          buttons: phase === 'up' ? 0 : 1,
          pressure: 0.5,
        });
        (phase === 'down' ? host : window).dispatchEvent(event);
      };
      send('down', source === 'mouse' ? 1 : -20);
      send('move', source === 'mouse' ? 1 : -20, 40);
      if (kind === 'hidden') {
        const visibility = jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
        visibility.mockRestore();
      } else window.dispatchEvent(new Event(kind));
      expect(controller.getSnapshot('document').objects).toHaveLength(0);
      expect(controller.getSnapshot('history').canUndo).toBe(false);
      for (const [index, id] of (source === 'mouse' ? [1, 1, 1] : [-21, -22, -23]).entries()) {
        send('down', id);
        send('move', id, 40);
        send('up', id, 80);
        expect(controller.getSnapshot('document').objects).toHaveLength(index + 1);
      }
      arbiter.destroy();
      ink.destroy();
      navigation.destroy();
      host.remove();
    }
  );
});

test.each(['pen', 'touch'] as const)(
  'negative %s IDs commit through the real arbiter and controller',
  (source) => {
    const host = document.createElement('div');
    document.body.append(host);
    const controller = makeLayeredController();
    const ink = createFreehandWebAdapter({
      host,
      controller,
      listen: false,
      createSessionId: () => 'signed',
      createCommitId: () => 'signed',
    });
    const navigation = createNavigationWebAdapter(host, controller, false, undefined, {
      listen: false,
    });
    const arbiter = createLayeredInputArbiter({ host, controller, tool: ink, navigation });
    for (const phase of ['down', 'move', 'up']) {
      const event = new Event(`pointer${phase}`, { bubbles: true, cancelable: true });
      Object.assign(event, {
        pointerId: -765894345,
        pointerType: source,
        clientX: phase === 'down' ? 10 : 80,
        clientY: 10,
        button: 0,
        buttons: phase === 'up' ? 0 : 1,
        pressure: 0.5,
      });
      (phase === 'down' ? host : window).dispatchEvent(event);
    }
    expect(controller.getSnapshot('document').objects).toHaveLength(1);
    const object = controller.getSnapshot('document').objects[0];
    expect(object.kind).toBe('freehand');
    if (object.kind !== 'freehand') throw new Error('missing ink');
    expect(object.samples.every((sample) => sample.source === source)).toBe(true);
    expect(controller.getSnapshot('history').canUndo).toBe(true);
    arbiter.destroy();
    ink.destroy();
    navigation.destroy();
    host.remove();
  }
);
