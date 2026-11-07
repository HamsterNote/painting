import { act, render } from '@testing-library/react-native';
import { Platform } from 'react-native';
import NativeLayeredEditorDom from '../../../apps/playground/src/layered-editor/NativeLayeredEditorDom';

jest.mock('../../../apps/playground/src/layered-editor/LayeredEditorDom', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const setToolbarKeyboardScope = jest.fn();
  return {
    __esModule: true,
    default: React.forwardRef(function MockLayeredEditorDom(props: object, ref: object) {
      React.useImperativeHandle(ref, () => ({ setToolbarKeyboardScope }));
      return React.createElement(Text, { ...props, testID: 'dom-boundary' });
    }),
    setToolbarKeyboardScope,
  };
});

const { setToolbarKeyboardScope } = jest.requireMock(
  '../../../apps/playground/src/layered-editor/LayeredEditorDom'
) as { setToolbarKeyboardScope: jest.Mock };

beforeEach(() => {
  setToolbarKeyboardScope.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('iOS waits for the DOM action and keeps the same WebView across prop updates', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  const result = await render(<NativeLayeredEditorDom editorParams={{ fixture: 'mixed' }} />);
  expect(setToolbarKeyboardScope).not.toHaveBeenCalled();
  const request = result.getByTestId('dom-boundary').props.onToolbarKeyboardScope;
  await act(() => request('scope-1', false));
  expect(setToolbarKeyboardScope).toHaveBeenCalledTimes(1);
  expect(setToolbarKeyboardScope).toHaveBeenLastCalledWith('scope-1', false);
  await result.rerender(<NativeLayeredEditorDom editorParams={{ fixture: 'resources' }} />);
  expect(result.getByTestId('dom-boundary').props.onToolbarKeyboardScope).toBe(request);
  expect(setToolbarKeyboardScope).toHaveBeenCalledTimes(1);
  expect(setToolbarKeyboardScope).toHaveBeenLastCalledWith('scope-1', false);
  await act(() => request('scope-1', true));
  expect(setToolbarKeyboardScope).toHaveBeenCalledTimes(2);
  expect(setToolbarKeyboardScope).toHaveBeenLastCalledWith('scope-1', true);
  await result.unmount();
  await request('scope-1', false);
  expect(setToolbarKeyboardScope).toHaveBeenCalledTimes(2);
});

test('Android editor does not use the iOS responder route', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const result = await render(<NativeLayeredEditorDom />);
  expect(result.getByTestId('dom-boundary').props.onToolbarKeyboardScope).toBeUndefined();
  expect(setToolbarKeyboardScope).not.toHaveBeenCalled();
  await result.unmount();
});
