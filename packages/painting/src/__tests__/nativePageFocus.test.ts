import { installNativeKeyboardFocus } from '../../../../apps/playground/src/layered-editor/nativeKeyboardFocus';

let dispose: () => void;
beforeEach(() => {
  jest.useFakeTimers();
  document.body.innerHTML =
    '<div data-interactive="true"><button>Tools</button><input type="range" /><textarea></textarea></div><canvas></canvas>';
});
afterEach(() => {
  dispose?.();
  jest.restoreAllMocks();
  jest.useRealTimers();
  document.body.innerHTML = '';
});

test('an unfocused page is focused synchronously without replacing the active control', () => {
  const request = jest.fn(async () => {});
  const pageFocus = jest.spyOn(window, 'focus').mockImplementation(() => {
    expect(request).not.toHaveBeenCalled();
    // Page focusing can synchronously send focus notifications.
    document.querySelector('button')!.dispatchEvent(new Event('focusin', { bubbles: true }));
  });
  jest.spyOn(document, 'hasFocus').mockReturnValue(false);
  dispose = installNativeKeyboardFocus(document, request);
  const button = document.querySelector('button')!;
  button.focus();
  expect(pageFocus).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(button);
  jest.runOnlyPendingTimers();
  expect(request).toHaveBeenCalledTimes(1);
});

test('focused or hidden pages, editing controls, and canvas strokes do not request page focus', () => {
  const pageFocus = jest.spyOn(window, 'focus').mockImplementation(() => {});
  const hasFocus = jest.spyOn(document, 'hasFocus').mockReturnValue(true);
  dispose = installNativeKeyboardFocus(
    document,
    jest.fn(async () => {})
  );
  const button = document.querySelector('button')!;
  button.focus();
  expect(pageFocus).not.toHaveBeenCalled();
  hasFocus.mockReturnValue(false);
  const textarea = document.querySelector('textarea')!;
  textarea.focus();
  textarea.value = '正在输入';
  textarea.dispatchEvent(new Event('compositionstart', { bubbles: true }));
  textarea.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(document.activeElement).toBe(textarea);
  expect(pageFocus).not.toHaveBeenCalled();
  textarea.blur();
  document.querySelector('canvas')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(pageFocus).not.toHaveBeenCalled();
  jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  button.focus();
  expect(pageFocus).not.toHaveBeenCalled();
  expect(textarea.value).toBe('正在输入');
});

test('touching a non-editing control requests missing page focus and cleanup removes the request', () => {
  const pageFocus = jest.spyOn(window, 'focus').mockImplementation(() => {});
  jest.spyOn(document, 'hasFocus').mockReturnValue(false);
  dispose = installNativeKeyboardFocus(
    document,
    jest.fn(async () => {})
  );
  const range = document.querySelector('input')!;
  range.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(pageFocus).toHaveBeenCalledTimes(1);
  dispose();
  range.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(pageFocus).toHaveBeenCalledTimes(1);
});
