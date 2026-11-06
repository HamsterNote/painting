import { installNativeToolbarKeyboard } from '../../../../apps/playground/src/layered-editor/nativeToolbarKeyboard';

let dispose: () => void;
let setScope: jest.Mock<Promise<void>, [string]>;
let releaseHeldReset: (() => void) | undefined;
const button = () => document.querySelector<HTMLButtonElement>('#item')!;
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const holdReset = async () => {
  dispose();
  await flush();
  setScope.mockClear();
  let release!: () => void;
  setScope.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  dispose = installNativeToolbarKeyboard(document, setScope);
  await flush();
  releaseHeldReset = release;
  expect(setScope.mock.calls).toEqual([['', false]]);
  return release;
};
const currentScope = () => setScope.mock.calls.at(-1)![0];
const receive = (scope: string, sequence = 1, key: 'Escape' | 'Tab' = 'Escape', shiftKey = false) =>
  window.__paintingToolbarKeyboard!.receive({
    scope,
    sequence,
    key,
    shiftKey,
    source: 'ios-key-command',
  });

beforeEach(() => {
  document.body.innerHTML =
    '<button id="before">Trigger</button><div class="hn-painting-panel"><button id="item">Item</button><button hidden>Hidden</button><button disabled>Disabled</button><select><option>A</option></select><textarea></textarea></div><button id="after">After</button>';
  jest.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (
    this: HTMLElement
  ) {
    return (this.hidden ? [] : [new DOMRect(0, 0, 40, 40)]) as unknown as DOMRectList;
  });
  setScope = jest.fn(async () => {});
  dispose = installNativeToolbarKeyboard(document, setScope);
});
afterEach(async () => {
  releaseHeldReset?.();
  releaseHeldReset = undefined;
  dispose();
  await flush();
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

test('only an open panel with non-editing focus enables commands; real input is untouched', async () => {
  await flush();
  expect(currentScope()).toBe(''); // Clear native state left by a full DOM reload.
  button().focus();
  await flush();
  expect(currentScope()).not.toBe('');
  const old = currentScope();
  const input = document.querySelector('textarea')!;
  input.focus();
  input.value = '中文';
  await flush();
  expect(currentScope()).toBe('');
  expect(receive(old)).toBe(false);
  expect(input.value).toBe('中文');
  expect(document.activeElement).toBe(input);
});

test('delivers once to the focused element, honestly untrusted, and rejects stale scopes', async () => {
  button().focus();
  await flush();
  const old = currentScope();
  const events: KeyboardEvent[] = [];
  button().addEventListener('keydown', (event) => events.push(event));
  expect(receive(old)).toBe(true);
  expect(receive(old)).toBe(false);
  expect(events).toHaveLength(1);
  expect(events[0].isTrusted).toBe(false);
  document.querySelector<HTMLButtonElement>('#before')!.focus();
  button().focus();
  await flush();
  expect(currentScope()).not.toBe(old);
  expect(receive(old, 2)).toBe(false);
  expect(receive(currentScope(), 2)).toBe(true);
  dispose();
  expect(window.__paintingToolbarKeyboard).toBeUndefined();
});

test('Tab skips unavailable controls; Shift+Tab exits; preventDefault suppresses traversal', async () => {
  button().focus();
  await flush();
  receive(currentScope(), 1, 'Tab');
  expect(document.activeElement).toBe(document.querySelector('select'));
  button().focus();
  await flush();
  const prevent = (event: Event) => event.preventDefault();
  button().addEventListener('keydown', prevent);
  receive(currentScope(), 2, 'Tab');
  expect(document.activeElement).toBe(button());
  button().removeEventListener('keydown', prevent);
  receive(currentScope(), 3, 'Tab', true);
  expect(document.activeElement?.id).toBe('before');
});

test('composition and detached panels reject callbacks even before the async disable arrives', async () => {
  button().focus();
  await flush();
  const scope = currentScope();
  button().dispatchEvent(new Event('compositionstart', { bubbles: true }));
  expect(receive(scope)).toBe(false);
  button().dispatchEvent(new Event('compositionend', { bubbles: true }));
  await flush();
  const renewed = currentScope();
  document.querySelector('.hn-painting-panel')!.remove();
  expect(receive(renewed, 2)).toBe(false);
});

test('cancelling an IME editor without compositionend does not disable every later panel', async () => {
  const editor = document.querySelector('textarea')!;
  editor.focus();
  editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  editor.remove(); // Observed WebKit cancellation: no compositionend on document.
  button().focus();
  await flush();
  const scope = currentScope();
  expect(scope).not.toBe('');
  expect(window.__paintingToolbarKeyboard!.snapshot()).toMatchObject({
    scope,
    acknowledgedScope: scope,
    composingConnected: false,
  });
  expect(receive(scope)).toBe(true);
  // Repeated native deliveries must stay enabled while focus remains in-panel.
  button().addEventListener('keydown', (event) => event.preventDefault());
  for (let sequence = 2; sequence < 8; sequence++)
    expect(receive(scope, sequence, 'Tab')).toBe(true);
});

test('leaving a composition owner clears its guard while keeping text-first handoff disabled', async () => {
  const editor = document.querySelector('textarea')!;
  editor.focus();
  editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  button().focus();
  await flush();
  const scope = currentScope();
  expect(receive(scope)).toBe(true);
  editor.focus(); // A rapid return to typing must still reject queued menu keys.
  expect(receive(scope, 2)).toBe(false);
  await flush();
  expect(currentScope()).toBe('');
});

test('serializes native enables/disables and cleans up after an in-flight enable', async () => {
  await flush();
  setScope.mockClear();
  let resolve!: () => void;
  setScope.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      })
  );
  button().focus();
  await flush();
  dispose();
  await flush();
  expect(setScope).toHaveBeenCalledTimes(1);
  resolve();
  await flush();
  expect(currentScope()).toBe('');
});

test.each(['editor', 'composition', 'dispose'] as const)(
  'a delayed reset receipt cannot send a queued enable after %s takes ownership',
  async (transition) => {
    const release = await holdReset();
    button().focus();
    const queued = window.__paintingToolbarKeyboard!.snapshot().scope;
    expect(queued).not.toBe('');
    if (transition === 'editor') document.querySelector('textarea')!.focus();
    else if (transition === 'composition')
      button().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    else dispose();
    await flush();
    expect(setScope.mock.calls).toEqual([['', false]]);
    release();
    await flush();
    // Assert the native boundary, not receive(false) after UIKit consumed a key.
    expect(setScope.mock.calls).toEqual([
      ['', false],
      ['', false],
    ]);
    expect(setScope.mock.calls.some(([value]) => value === queued)).toBe(false);
  }
);

test('pending color modes coalesce to the live mode even when scope is reused', async () => {
  const release = await holdReset();
  const color = document.createElement('input');
  color.type = 'text';
  color.dataset.toolbarColorField = 'true';
  button().parentElement!.append(color);
  button().focus();
  const scope = window.__paintingToolbarKeyboard!.snapshot().scope;
  color.focus();
  button().focus();
  color.focus();
  expect(window.__paintingToolbarKeyboard!.snapshot()).toMatchObject({ scope, tabOnly: true });
  release();
  // Drain all four queued mode publications, including skipped promise links.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(setScope.mock.calls).toEqual([
    ['', false],
    [scope, true],
  ]);
});

test('queued color enable never reaches native after composition starts', async () => {
  const release = await holdReset();
  const color = document.createElement('input');
  color.type = 'text';
  color.dataset.toolbarColorField = 'true';
  button().parentElement!.append(color);
  color.focus();
  expect(window.__paintingToolbarKeyboard!.snapshot().tabOnly).toBe(true);
  color.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  release();
  await flush();
  expect(setScope.mock.calls).toEqual([
    ['', false],
    ['', false],
  ]);
});

test('queued color enable is discarded when focus moves to an ordinary editor', async () => {
  const release = await holdReset();
  const color = document.createElement('input');
  color.type = 'text';
  color.dataset.toolbarColorField = 'true';
  button().parentElement!.append(color);
  color.focus();
  document.querySelector('textarea')!.focus();
  release();
  await flush();
  expect(setScope.mock.calls).toEqual([
    ['', false],
    ['', false],
  ]);
});

test('queued enable rechecks live visibility before its observer notification', async () => {
  const release = await holdReset();
  button().focus();
  jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  // Deliberately no visibilitychange event: the send boundary must check it.
  release();
  await flush();
  expect(setScope.mock.calls).toEqual([
    ['', false],
    ['', false],
  ]);
});

test('an old installation cannot enable native commands after replacement', async () => {
  const release = await holdReset();
  button().focus();
  const old = window.__paintingToolbarKeyboard!.snapshot().scope;
  dispose();
  dispose = installNativeToolbarKeyboard(document, setScope);
  const replacement = window.__paintingToolbarKeyboard!.snapshot().scope;
  expect(replacement).not.toBe(old);
  release();
  await flush();
  expect(setScope.mock.calls).toEqual([
    ['', false],
    ['', false],
    [replacement, false],
  ]);
});

test('a queued focusout from a disposed bridge cannot disable its replacement', async () => {
  button().focus();
  await flush();
  const oldBridge = window.__paintingToolbarKeyboard!;
  const oldScope = currentScope();
  button().blur();
  dispose();
  button().focus();
  dispose = installNativeToolbarKeyboard(document, setScope);
  await flush();
  expect(currentScope()).not.toBe('');
  expect(currentScope()).not.toBe(oldScope);
  expect(
    oldBridge.receive({
      scope: oldScope,
      sequence: 1,
      key: 'Escape',
      shiftKey: false,
      source: 'ios-key-command',
    })
  ).toBe(false);
  expect(receive(currentScope())).toBe(true);
});
