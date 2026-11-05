import { act, render } from '@testing-library/react-native';
import { Platform } from 'react-native';
import NativeLayeredEditorDom from '../../../apps/playground/src/layered-editor/NativeLayeredEditorDom';

jest.mock('../../../apps/playground/src/layered-editor/LayeredEditorDom', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const requestFocus = jest.fn();
  return {
    __esModule: true,
    default: React.forwardRef(function MockLayeredEditorDom(props: object, ref: object) {
      React.useImperativeHandle(ref, () => ({ requestFocus }));
      return React.createElement(Text, { ...props, testID: 'dom-boundary' });
    }),
    requestFocus,
  };
});

const { requestFocus } = jest.requireMock(
  '../../../apps/playground/src/layered-editor/LayeredEditorDom'
) as { requestFocus: jest.Mock };

beforeEach(() => {
  requestFocus.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('iOS waits for the DOM action and keeps the same WebView across prop updates', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  const result = await render(<NativeLayeredEditorDom editorParams={{ fixture: 'mixed' }} />);
  expect(requestFocus).not.toHaveBeenCalled();
  const request = result.getByTestId('dom-boundary').props.onRequestKeyboardFocus;
  await act(() => request());
  expect(requestFocus).toHaveBeenCalledTimes(1);
  await result.rerender(<NativeLayeredEditorDom editorParams={{ fixture: 'resources' }} />);
  expect(result.getByTestId('dom-boundary').props.onRequestKeyboardFocus).toBe(request);
  expect(requestFocus).toHaveBeenCalledTimes(1);
  await act(() => request());
  expect(requestFocus).toHaveBeenCalledTimes(2);
  await result.unmount();
  await request();
  expect(requestFocus).toHaveBeenCalledTimes(2);
});

test('Android editor does not use the iOS responder route', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const result = await render(<NativeLayeredEditorDom />);
  expect(result.getByTestId('dom-boundary').props.onRequestKeyboardFocus).toBeUndefined();
  expect(requestFocus).not.toHaveBeenCalled();
  await result.unmount();
});
