import { installNativeKeyboardFocus } from '../../../../apps/playground/src/layered-editor/nativeKeyboardFocus';

beforeEach(() => {
  jest.useFakeTimers();
  // jsdom has no window activation; page-focus behavior has its own unit cases.
  jest.spyOn(window, 'focus').mockImplementation(() => {});
  document.body.innerHTML =
    '<div data-interactive="true"><button>Tools</button><input type="range" /></div><textarea></textarea><canvas></canvas>';
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  document.body.innerHTML = '';
});

test('ready, non-editing focus and a touched unfocused panel reacquire the native responder', () => {
  const request = jest.fn(async () => {});
  const dispose = installNativeKeyboardFocus(document, request);
  jest.runOnlyPendingTimers();
  expect(request).toHaveBeenCalledTimes(1);
  document.querySelector('button')!.focus();
  jest.runOnlyPendingTimers();
  expect(request).toHaveBeenCalledTimes(2);
  document.querySelector('input')!.focus();
  jest.runOnlyPendingTimers();
  expect(request).toHaveBeenCalledTimes(3);
  document.querySelector<HTMLInputElement>('input')!.blur();
  document.querySelector('input')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  jest.runOnlyPendingTimers();
  expect(request).toHaveBeenCalledTimes(4);
  document.querySelector('canvas')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  jest.runOnlyPendingTimers();
  expect(request).toHaveBeenCalledTimes(4);
  dispose();
});

test('delayed requests never steal an active text editor or survive cleanup', () => {
  const request = jest.fn(async () => {});
  const dispose = installNativeKeyboardFocus(document, request);
  const textarea = document.querySelector('textarea')!;
  textarea.focus();
  textarea.value = '正在输入';
  textarea.dispatchEvent(new Event('compositionstart', { bubbles: true }));
  jest.runOnlyPendingTimers();
  expect(request).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(textarea);
  expect(textarea.value).toBe('正在输入');
  document.querySelector('button')!.focus();
  dispose();
  jest.runOnlyPendingTimers();
  expect(request).not.toHaveBeenCalled();
  document.querySelector('input')!.focus();
  jest.runOnlyPendingTimers();
  expect(request).not.toHaveBeenCalled();
});
