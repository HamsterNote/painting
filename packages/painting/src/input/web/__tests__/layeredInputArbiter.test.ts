import { makeLayeredController } from '../../../__tests__/fixtures/layered';
import { createLayeredInputArbiter } from '../layeredInputArbiter';

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

test.each(['blur', 'pagehide', 'visibilitychange', 'destroy'])(
  '%s cancels without committing and removes listeners on destroy',
  (kind) => {
    const h = setup();
    h.send();
    if (kind === 'visibilitychange') {
      jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      document.dispatchEvent(new Event(kind));
      jest.restoreAllMocks();
    } else if (kind === 'destroy') h.destroy();
    else window.dispatchEvent(new Event(kind));
    expect(h.tool.cancel).toHaveBeenCalledTimes(1);
    h.destroy();
    h.send('pointerdown', 3);
    expect(h.tool.dispatch).toHaveBeenCalledTimes(1);
  }
);
