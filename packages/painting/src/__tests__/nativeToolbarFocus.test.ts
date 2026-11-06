import { installNativeToolbarKeyboard } from '../../../../apps/playground/src/layered-editor/nativeToolbarKeyboard';

let dispose: () => void;
let frames: Map<number, FrameRequestCallback>;
const input = (id: string) => document.getElementById(id) as HTMLInputElement;
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const paint = async () => {
  const ready = [...frames.values()];
  frames.clear();
  ready.forEach((frame) => frame(0));
  await flush();
};
const pointer = (target: Element, type: string) => {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
};
const tab = (target: Element, shiftKey = false, isComposing = false) => {
  const event = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey,
    isComposing,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
};

beforeEach(() => {
  document.body.innerHTML = `<button>Before</button><div class="hn-painting-panel">
    <label><input id="auto" type="radio" name="mode" checked>Auto</label>
    <label id="finger-label"><input id="finger" type="radio" name="mode">Finger</label>
    <input id="color" type="text" data-toolbar-color-field="true" value="#123456">
    <input id="range" type="range"><input id="check" type="checkbox">
  </div><textarea id="editor"></textarea>`;
  frames = new Map();
  let next = 0;
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation((frame) => {
    frames.set(++next, frame);
    return next;
  });
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    frames.delete(id);
  });
  jest
    .spyOn(HTMLElement.prototype, 'getClientRects')
    .mockReturnValue([new DOMRect(0, 0, 44, 44)] as unknown as DOMRectList);
  dispose = installNativeToolbarKeyboard(document, async () => {});
});
afterEach(async () => {
  dispose();
  await flush();
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

test('radio/label activation restores the touched control after UIKit leaves BODY', async () => {
  input('auto').focus();
  await flush();
  pointer(input('finger'), 'pointerdown');
  input('auto').blur();
  input('finger').checked = true;
  pointer(input('finger'), 'pointerup');
  document
    .getElementById('finger-label')!
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(document.activeElement).toBe(document.body);
  await paint();
  expect(document.activeElement).toBe(input('finger'));
  expect(input('finger').checked).toBe(true);
  const state = window.__paintingToolbarKeyboard!.snapshot();
  expect(state.scope).not.toBe('');
  expect(state.acknowledgedScope).toBe(state.scope);
});

test('range drag ending without click restores focus without changing its value', async () => {
  input('color').focus();
  pointer(input('range'), 'pointerdown');
  input('range').value = '37';
  input('range').dispatchEvent(new Event('input', { bubbles: true }));
  input('color').blur();
  pointer(input('range'), 'pointerup');
  await paint();
  expect(document.activeElement).toBe(input('range'));
  expect(input('range').value).toBe('37');
  expect(window.__paintingToolbarKeyboard!.snapshot().scope).not.toBe('');
});

test('new text/canvas interaction cancels a queued touch focus, including an AX click', async () => {
  pointer(input('range'), 'pointerdown');
  pointer(input('range'), 'pointerup');
  pointer(input('editor'), 'pointerdown');
  input('editor').focus();
  await paint();
  expect(document.activeElement).toBe(input('editor'));
  expect(window.__paintingToolbarKeyboard!.snapshot().scope).toBe('');
  input('editor').blur();
  pointer(input('range'), 'pointerdown');
  pointer(input('range'), 'pointerup');
  document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await paint();
  expect(document.activeElement).toBe(document.body);
});

test.each(['cancel', 'remove', 'dispose'])('%s invalidates pending panel focus', async (reason) => {
  const range = input('range');
  const focus = jest.spyOn(range, 'focus');
  pointer(range, 'pointerdown');
  pointer(range, 'pointerup');
  if (reason === 'cancel') pointer(range, 'pointercancel');
  if (reason === 'remove') range.closest('.hn-painting-panel')!.remove();
  if (reason === 'dispose') dispose();
  await paint();
  expect(focus).not.toHaveBeenCalled();
});

test('color Tab uses the original event, traverses both directions and restores scope', async () => {
  input('color').focus();
  await flush();
  const events: Event[] = [];
  const observe = (event: Event) => events.push(event);
  document.addEventListener('keydown', observe);
  try {
    const forward = tab(input('color'));
    expect(forward.defaultPrevented).toBe(true);
    await flush();
    expect(document.activeElement).toBe(input('range'));
    expect(window.__paintingToolbarKeyboard!.snapshot().scope).not.toBe('');
    input('color').focus();
    input('finger').checked = true;
    const backwards = tab(input('color'), true);
    await flush();
    expect(document.activeElement).toBe(input('finger'));
    expect(events).toEqual([forward, backwards]); // No redispatch or synthetic twin.
  } finally {
    document.removeEventListener('keydown', observe);
  }
});

test('color traversal respects cancellation/composition and leaves document text alone', async () => {
  input('color').focus();
  const prevent = (event: Event) => event.preventDefault();
  input('color').addEventListener('keydown', prevent);
  tab(input('color'));
  await flush();
  expect(document.activeElement).toBe(input('color'));
  input('color').removeEventListener('keydown', prevent);
  expect(tab(input('color'), false, true).defaultPrevented).toBe(false);
  await flush();
  expect(document.activeElement).toBe(input('color'));
  input('editor').focus();
  expect(tab(input('editor')).defaultPrevented).toBe(false);
  await flush();
  expect(document.activeElement).toBe(input('editor'));
});

test('a keyboard transition supersedes an earlier touch, and a later text focus supersedes Tab', async () => {
  input('color').focus();
  pointer(input('check'), 'pointerdown');
  pointer(input('check'), 'pointerup');
  tab(input('color'));
  await flush();
  await paint();
  expect(document.activeElement).toBe(input('range'));
  input('color').focus();
  tab(input('color'));
  input('editor').focus();
  await flush();
  expect(document.activeElement).toBe(input('editor'));
});
