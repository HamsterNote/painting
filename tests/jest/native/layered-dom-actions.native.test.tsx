import { fireEvent, render } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import LayeredEditorRoute from '../../../apps/playground/src/layered-editor/LayeredEditorRoute';

const mockInjectedScripts: string[] = [];

jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(() => ({})),
  useRouter: jest.fn(() => ({ setParams: jest.fn() })),
}));
jest.mock('@hamster-note/painting-pencilkit', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    isPencilkitDemoAvailable: () => true,
    PaintingPencilkitView: (props: object) => React.createElement(View, props),
  };
});
jest.mock('../../../apps/playground/node_modules/expo/src/dom/base', () => ({
  getBaseURL: () => 'http://localhost:5266/_expo/@dom',
}));
jest.mock('../../../apps/playground/node_modules/expo/src/dom/webview/ExpoDOMWebView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: React.forwardRef(function MockDOMWebView(props: object, ref: object) {
      React.useImperativeHandle(ref, () => ({
        injectJavaScript: (script: string) => mockInjectedScripts.push(script),
      }));
      return React.createElement(View, { ...props, testID: 'actual-expo-dom-webview' });
    }),
  };
});
jest.mock('../../../apps/playground/node_modules/expo/src/dom/webview/RNWebView', () => ({
  __esModule: true,
  default: undefined,
}));
// Exercise Expo's real action registry/message dispatcher, mocking only its native WebView.
jest.mock('../../../apps/playground/src/layered-editor/LayeredEditorDom', () => {
  const React = require('react');
  const Wrapper =
    require('../../../apps/playground/node_modules/expo/src/dom/webview-wrapper').default;
  return {
    __esModule: true,
    default: (props: object) => React.createElement(Wrapper, { ...props, filePath: 'editor' }),
  };
});

test('Expo action names stay registered across initial-off, enable, disable and late DOM messages', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({});
  const view = await render(<LayeredEditorRoute />);
  const webview = () => view.getByTestId('actual-expo-dom-webview');
  expect(webview().props.injectedJavaScriptObject.initialProps.names).toEqual([
    'onNativeState',
    'onNativeReply',
  ]);
  const state = {
    protocolVersion: 1,
    contextKey: 'smoke:1',
    enabled: true,
    frame: { x: 0, y: 0, width: 800, height: 600 },
    exclusions: [],
    scale: 1,
    brush: { color: '#000', nominalSize: 4, opacity: 1 },
  };
  const send = (actionId: string, value: object) =>
    fireEvent(webview(), 'message', {
      nativeEvent: {
        data: JSON.stringify({
          type: '$$native_action',
          data: { uid: 'test', actionId, args: [value] },
        }),
      },
    });
  jest.mocked(useLocalSearchParams).mockReturnValue({ pencilkit: '1' });
  await view.rerender(<LayeredEditorRoute />);
  await send('onNativeState', state);
  expect(JSON.parse(view.getByTestId('layered-pencilkit-canvas').props.demoState).contextKey).toBe(
    'smoke:1'
  );
  jest.mocked(useLocalSearchParams).mockReturnValue({ pencilkit: '0' });
  await view.rerender(<LayeredEditorRoute />);
  await send('onNativeState', state);
  await send('onNativeReply', { id: 0, contextKey: 'smoke:1', status: 'rejected', reason: 'late' });
  expect(view.getByTestId('layered-native-status').props.children).toBe('Web / DOM');
  jest.mocked(useLocalSearchParams).mockReturnValue({ pencilkit: '1' });
  await view.rerender(<LayeredEditorRoute />);
  expect(view.getByTestId('layered-native-status').props.children).toContain('等待 DOM 连接');
  await send('onNativeState', { ...state, contextKey: 'reconnected:1' });
  expect(JSON.parse(view.getByTestId('layered-pencilkit-canvas').props.demoState).contextKey).toBe(
    'reconnected:1'
  );
  await view.unmount();
});

test('native status renders do not retransmit an unacknowledged long stroke through Expo', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ pencilkit: '1' });
  mockInjectedScripts.length = 0;
  const view = await render(<LayeredEditorRoute />);
  const canvas = () => view.getByTestId('layered-pencilkit-canvas');
  const send = (actionId: string, value: object) =>
    fireEvent(view.getByTestId('actual-expo-dom-webview'), 'message', {
      nativeEvent: {
        data: JSON.stringify({
          type: '$$native_action',
          data: { uid: 'long', actionId, args: [value] },
        }),
      },
    });
  await send('onNativeState', {
    protocolVersion: 1,
    contextKey: 'long:1',
    enabled: true,
    frame: { x: 0, y: 0, width: 800, height: 600 },
    exclusions: [],
    scale: 1,
    brush: { color: '#000', nominalSize: 4, opacity: 1 },
  });
  const sample = {
    seq: 0,
    phase: 'down',
    kind: 'main',
    x: 30,
    y: 40,
    tabs: 1000,
    f: 1,
    mf: 8,
    p: 0.125,
  };
  await fireEvent(canvas(), 'begin', { nativeEvent: { id: 1, contextKey: 'long:1', sample } });
  await send('onNativeReply', { messageId: 1, id: 1, contextKey: 'long:1', status: 'accepted' });
  await fireEvent(canvas(), 'stroke', {
    nativeEvent: {
      id: 1,
      contextKey: 'long:1',
      cancelled: false,
      overflow: false,
      samples: Array.from({ length: 5000 }, (_, seq) => ({
        ...sample,
        seq,
        phase: seq === 0 ? 'down' : seq === 4999 ? 'up' : 'move',
        tabs: 1000 + seq,
      })),
    },
  });
  const propMessages = () => mockInjectedScripts.filter((script) => script.includes('$$props'));
  const before = propMessages().length;
  expect(before).toBeGreaterThan(0);
  for (let index = 0; index < 20; index++) {
    await fireEvent(canvas(), 'demoStatus', {
      nativeEvent: {
        contextKey: 'long:1',
        enabled: true,
        width: 800,
        height: 600,
        lastHit: 'pencil',
        routing: 'gesture-ancestor',
        toolBegins: index + 1,
      },
    });
  }
  expect(propMessages()).toHaveLength(before);
  await send('onNativeReply', { messageId: 2, id: 1, contextKey: 'long:1', status: 'committed' });
  expect(view.getByTestId('layered-native-evidence').props.children.join('')).toContain(
    '文档提交 1'
  );
  await view.unmount();
});
