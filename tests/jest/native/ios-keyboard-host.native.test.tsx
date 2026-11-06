import { act, fireEvent, render } from '@testing-library/react-native';
import { DeviceEventEmitter, Keyboard, Platform, TextInput } from 'react-native';
import { NativeEditorHost } from '../../../apps/playground/src/layered-editor/NativeEditorHost';

let mockHostTop = 240;
let mockHostHeight = 622;
let mockDeferred = false;
let mockMeasurements: ((x: number, y: number, width: number, height: number) => void)[] = [];

// Only native geometry is mocked; retain the host's real event subscriptions,
// focus-independent layout state and descendants through interrupted keyboard transitions.
jest.mock('react-native/Libraries/Components/View/View', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: React.forwardRef(function MockView(props: object, ref: object) {
      React.useImperativeHandle(ref, () => ({
        measureInWindow: (
          callback: (x: number, y: number, width: number, height: number) => void
        ) => {
          if (mockDeferred) mockMeasurements.push(callback);
          else callback(0, mockHostTop, 402, mockHostHeight);
        },
      }));
      return React.createElement('View', props);
    }),
  };
});

beforeEach(() => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(Keyboard, 'metrics').mockReturnValue(undefined);
  mockHostTop = 240;
  mockHostHeight = 622;
  mockDeferred = false;
  mockMeasurements = [];
});
afterEach(() => jest.restoreAllMocks());

const keyboard = (name: string, screenY: number, height = 280, isEventFromThisApp = true) =>
  DeviceEventEmitter.emit(name, {
    duration: 250,
    easing: 'keyboard',
    isEventFromThisApp,
    startCoordinates: { screenX: 0, screenY: 874, width: 402, height },
    endCoordinates: { screenX: 0, screenY, width: 402, height },
  });
const editor = () => (
  <NativeEditorHost>
    <TextInput testID="draft" defaultValue="keep" />
  </NativeEditorHost>
);

test('iOS keeps space through an interrupted hide and follows frame-only keyboard updates', async () => {
  const result = await render(editor());
  const draft = result.getByTestId('draft');
  const host = () => result.getByTestId('layered-keyboard-host');
  expect(host().props.style.maxHeight).toBeUndefined();
  await act(async () => keyboard('keyboardWillShow', 592));
  expect(host()).toHaveStyle({ maxHeight: 352 }); // Window coordinates, including PencilKit header.
  await act(async () => keyboard('keyboardDidShow', 592));
  await act(async () => {
    keyboard('keyboardWillChangeFrame', 874);
    keyboard('keyboardWillHide', 874);
  });
  expect(host()).toHaveStyle({ maxHeight: 352 }); // No premature full-height WebView.
  // Color regains focus before hide completes: no second willShow is required.
  await act(async () => keyboard('keyboardDidChangeFrame', 592));
  expect(host()).toHaveStyle({ maxHeight: 352 });
  await act(async () => keyboard('keyboardWillChangeFrame', 492, 380));
  expect(host()).toHaveStyle({ maxHeight: 252 });
  await act(async () => keyboard('keyboardWillChangeFrame', 592));
  expect(host()).toHaveStyle({ maxHeight: 252 }); // Release only on completed geometry.
  await act(async () => keyboard('keyboardDidChangeFrame', 592));
  expect(host()).toHaveStyle({ maxHeight: 352 });
  mockHostTop = 140;
  mockHostHeight = 722;
  await fireEvent(result.getByTestId('layered-keyboard-window'), 'layout', {});
  expect(host()).toHaveStyle({ maxHeight: 452 });
  await act(async () => keyboard('keyboardDidHide', 874));
  expect(host().props.style.maxHeight).toBeUndefined();
  expect(result.getByTestId('draft')).toBe(draft);
  expect(draft.props.defaultValue).toBe('keep');
  await result.unmount();
});

test('visible keyboard metrics initialize the cap; unrelated and off-window frames do not hide the editor', async () => {
  jest
    .spyOn(Keyboard, 'metrics')
    .mockReturnValue({ screenX: 0, screenY: 592, width: 402, height: 280 });
  const result = await render(editor());
  const host = () => result.getByTestId('layered-keyboard-host');
  expect(host()).toHaveStyle({ maxHeight: 352 });
  await act(async () => keyboard('keyboardDidHide', 874, 280, false));
  await act(async () => keyboard('keyboardDidChangeFrame', 200, 280, false));
  expect(host()).toHaveStyle({ maxHeight: 352 });
  await act(async () => keyboard('keyboardDidChangeFrame', 874));
  expect(host().props.style.maxHeight).toBeUndefined();
  await result.unmount();
});

test('a delayed older native measurement cannot overwrite a newer layout or an unmounted host', async () => {
  mockDeferred = true;
  const result = await render(editor());
  await act(async () => keyboard('keyboardDidShow', 592));
  const older = mockMeasurements[0];
  const latest = mockMeasurements.at(-1)!;
  await act(async () => latest(0, 240, 402, 622));
  await act(async () => older(0, 140, 402, 722));
  expect(result.getByTestId('layered-keyboard-host')).toHaveStyle({ maxHeight: 352 });
  await result.unmount();
  const logs = (console.info as jest.Mock).mock.calls.length;
  await act(async () => {
    latest(0, 0, 402, 874);
    keyboard('keyboardDidShow', 300);
  });
  expect((console.info as jest.Mock).mock.calls).toHaveLength(logs);
});
