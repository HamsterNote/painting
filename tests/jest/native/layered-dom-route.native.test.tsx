import { act, fireEvent, render } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { isPencilkitDemoAvailable } from '@hamster-note/painting-pencilkit';
import LayeredEditorRoute from '../../../apps/playground/src/layered-editor/LayeredEditorRoute';

jest.mock('expo-router', () => ({ useLocalSearchParams: jest.fn(() => ({})) }));
jest.mock('@hamster-note/painting-pencilkit', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    isPencilkitDemoAvailable: jest.fn(() => true),
    PaintingPencilkitView: (props: object) => React.createElement(View, props),
  };
});

beforeEach(() => {
  jest.mocked(useLocalSearchParams).mockReturnValue({});
  jest.mocked(isPencilkitDemoAvailable).mockReturnValue(true);
});

// Jest cannot launch a WebView; only the Expo DOM host boundary is mocked here.
jest.mock('../../../apps/playground/src/layered-editor/LayeredEditorDom', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props: object) =>
      React.createElement(View, { testID: 'expo-dom-editor-host', ...props }),
  };
});

test('opt-in uses the native canvas and queues pooled events until the DOM acknowledges each message', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ pencilkit: '1' });
  const result = await render(<LayeredEditorRoute />);
  const host = () => result.getByTestId('expo-dom-editor-host');
  await act(async () =>
    host().props.onNativeState({
      protocolVersion: 1,
      contextKey: 'epoch:1',
      enabled: true,
      frame: { x: 0, y: 70, width: 800, height: 600 },
      exclusions: [{ x: 700, y: 500, width: 100, height: 100 }],
      scale: 2,
      brush: {
        color: '#123456',
        nominalSize: 5,
        opacity: 0.4,
        pressureMode: 'auto',
        presetRevision: 1,
      },
    })
  );
  const canvas = () => result.getByTestId('layered-pencilkit-canvas');
  expect(canvas().props.inkWidth).toBe(10);
  expect(canvas().props.inkOpacity).toBe(0.4);
  expect(JSON.parse(canvas().props.demoState).exclusions).toHaveLength(1);
  const sample = {
    seq: 0,
    kind: 'main',
    phase: 'down',
    x: 10,
    y: 20,
    tabs: 1000,
    f: 1,
    mf: 8,
    p: 0.125,
  };
  const event: { nativeEvent: object | null } = {
    nativeEvent: { id: 1, contextKey: 'epoch:1', sample },
  };
  await fireEvent(canvas(), 'begin', event);
  event.nativeEvent = null;
  const stroke = {
    id: 1,
    contextKey: 'epoch:1',
    cancelled: false,
    overflow: false,
    samples: [sample, { ...sample, seq: 1, phase: 'up', f: 0, p: 0 }],
  };
  await fireEvent(canvas(), 'stroke', { nativeEvent: stroke });
  expect(host().props.nativeMessage.type).toBe('begin');
  expect(host().props.nativeMessage.sample).toEqual(sample);
  await act(async () =>
    host().props.onNativeReply({ id: 1, contextKey: 'epoch:1', messageId: 1, status: 'accepted' })
  );
  expect(host().props.nativeMessage.type).toBe('stroke');
  await act(async () =>
    host().props.onNativeReply({ id: 1, contextKey: 'old-epoch:1', status: 'retire' })
  );
  expect(JSON.parse(canvas().props.demoState).retireIDs).toEqual([]);
  await act(async () =>
    host().props.onNativeReply({ id: 1, contextKey: 'epoch:1', status: 'retire' })
  );
  expect(JSON.parse(canvas().props.demoState).retireIDs).toEqual([1]);
  await result.unmount();
});

test('old IPA reports a build mismatch and never claims native Demo input', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ pencilkit: '1' });
  jest.mocked(isPencilkitDemoAvailable).mockReturnValue(false);
  const result = await render(<LayeredEditorRoute />);
  expect(result.queryByTestId('layered-pencilkit-canvas')).toBeNull();
  expect(result.getByTestId('layered-native-status').props.children).toContain('构建不匹配');
  expect(result.getByTestId('expo-dom-editor-host').props.nativePencilEnabled).toBeUndefined();
});

test('native route mounts the whole DOM editor with layout-only props', async () => {
  const result = await render(<LayeredEditorRoute />);
  const host = result.getByTestId('expo-dom-editor-host');
  expect(host.props.dom).toEqual({ style: { flex: 1 } });
  expect(
    Object.keys(host.props).filter((key) => !['testID', 'dom', 'children'].includes(key))
  ).toEqual([]);
});
