import { act, fireEvent, render } from '@testing-library/react-native';
import { DeviceEventEmitter, Keyboard, Platform, TextInput, View } from 'react-native';
import { NativeEditorHost } from '../../../apps/playground/src/layered-editor/NativeEditorHost';

let mockHostTop = 24;
let mockHostHeight = 839;

// Jest has no native geometry. Mock that boundary; Keyboard's Android event
// emitter and the host's subscriptions / state / descendants remain real.
jest.mock('react-native/Libraries/Components/View/View', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: React.forwardRef(function MockView(props: object, ref: object) {
      React.useImperativeHandle(ref, () => ({
        measureInWindow: (
          callback: (x: number, y: number, width: number, height: number) => void
        ) => callback(0, mockHostTop, 412, mockHostHeight),
      }));
      return React.createElement('View', props);
    }),
  };
});

beforeEach(() => {
  jest.replaceProperty(Platform, 'OS', 'android');
  mockHostTop = 24;
  mockHostHeight = 839;
  DeviceEventEmitter.emit('keyboardDidHide', {});
});

afterEach(() => {
  DeviceEventEmitter.emit('keyboardDidHide', {});
  jest.restoreAllMocks();
});

function showKeyboard(screenY: number, height: number) {
  DeviceEventEmitter.emit('keyboardDidShow', {
    duration: 0,
    easing: 'keyboard',
    endCoordinates: { screenX: 0, screenY, width: 412, height },
  });
}

test('Android IME bounds an unresized host, tracks height changes, and restores without remounting', async () => {
  const result = await render(
    <NativeEditorHost>
      <TextInput testID="draft" defaultValue="keep this draft" />
    </NativeEditorHost>
  );
  const draft = result.getByTestId('draft');
  const host = () => result.getByTestId('layered-keyboard-host');
  const window = result.getByTestId('layered-keyboard-window');
  const layout = async () =>
    fireEvent(window, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 412, height: mockHostHeight } },
    });
  await layout();
  expect(host()).toHaveStyle({ flex: 1 });
  // API 36: native keyboard appears but the outer window stays 839px high.
  await act(async () => showKeyboard(520, 360));
  expect(host()).toHaveStyle({ maxHeight: 496 });
  await act(async () => showKeyboard(460, 420));
  expect(host()).toHaveStyle({ maxHeight: 436 });
  // An adjustResize-capable window already fits: the cap is not another inset.
  mockHostHeight = 436;
  await layout();
  expect(host()).toHaveStyle({ flex: 1, maxHeight: 436 });
  // Relayout also refreshes the absolute safe-area/embedded origin.
  mockHostTop = 64;
  await layout();
  expect(host()).toHaveStyle({ maxHeight: 396 });
  await act(async () => DeviceEventEmitter.emit('keyboardDidHide', {}));
  expect(host().props.style.maxHeight).toBeUndefined();
  mockHostHeight = 839;
  await layout();
  await act(async () => showKeyboard(520, 360));
  expect(host()).toHaveStyle({ maxHeight: 456 });
  expect(result.getByTestId('draft')).toBe(draft);
  expect(draft.props.defaultValue).toBe('keep this draft');
  await result.unmount();
});

test('Android host opened while IME is visible uses current metrics on its first layout', async () => {
  jest.spyOn(Keyboard, 'metrics').mockReturnValue({
    screenX: 0,
    screenY: 520,
    width: 412,
    height: 360,
  });
  const result = await render(
    <NativeEditorHost>
      <View />
    </NativeEditorHost>
  );
  const window = result.getByTestId('layered-keyboard-window');
  await fireEvent(window, 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 412, height: 839 } },
  });
  expect(result.getByTestId('layered-keyboard-host')).toHaveStyle({ maxHeight: 496 });
  await result.unmount();
});
