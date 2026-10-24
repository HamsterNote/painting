import { act, fireEvent, render, within } from '@testing-library/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { isPencilkitDemoAvailable } from '@hamster-note/painting-pencilkit';
import LayeredEditorRoute from '../../../apps/playground/src/layered-editor/LayeredEditorRoute';

jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(() => ({})),
  useRouter: jest.fn(() => ({ setParams: jest.fn() })),
}));
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
  const originalHost = host();
  const canvas = () => result.getByTestId('layered-pencilkit-canvas');
  expect(canvas().props.demoHost).toBe(true);
  expect(within(canvas()).getByTestId('expo-dom-editor-host')).toBe(originalHost);
  // Ready may precede DOM connection; the persistent host must keep it.
  await fireEvent(canvas(), 'ready', { nativeEvent: { moduleVersion: '0.1.0' } });
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
  expect(result.getByTestId('layered-native-status').props.children).toContain('等待原生配置回执');
  await fireEvent(canvas(), 'demoStatus', {
    nativeEvent: {
      contextKey: 'epoch:1',
      enabled: true,
      width: 800,
      height: 600,
      lastHit: 'none',
      routing: 'gesture-ancestor',
      toolBegins: 0,
    },
  });
  expect(result.getByTestId('layered-native-status').props.children).toBe(
    'PencilKit 已配置，等待原生起笔'
  );
  expect(result.getByTestId('layered-native-evidence').props.children.join('')).toContain(
    '原生起笔 0'
  );
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
  expect(result.getByTestId('layered-native-status').props.children).toContain('等待原生预览');
  await fireEvent(canvas(), 'demoStatus', {
    nativeEvent: {
      contextKey: 'epoch:1',
      enabled: true,
      width: 800,
      height: 600,
      lastHit: 'pencil',
      routing: 'gesture-ancestor',
      toolBegins: 1,
    },
  });
  expect(result.getByTestId('layered-native-evidence').props.children.join('')).toContain(
    '原生起笔 1'
  );
  // Native finish retains its begin key, even if a new compatible DOM layout arrived first.
  await act(async () =>
    host().props.onNativeState({
      protocolVersion: 1,
      contextKey: 'epoch:2',
      enabled: true,
      frame: { x: 0, y: 70, width: 800, height: 580 },
      exclusions: [],
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
  await fireEvent(canvas(), 'demoStatus', {
    nativeEvent: {
      contextKey: 'epoch:2',
      enabled: true,
      width: 800,
      height: 580,
      lastHit: 'pencil',
      routing: 'gesture-ancestor',
      toolBegins: 1,
    },
  });
  const stroke = {
    id: 1,
    contextKey: 'epoch:1',
    cancelled: false,
    overflow: false,
    samples: [sample, { ...sample, seq: 1, phase: 'up', f: 0, p: 0 }],
  };
  await fireEvent(canvas(), 'stroke', { nativeEvent: stroke });
  expect(result.getByTestId('layered-native-evidence').props.children.join('')).toContain('完成 1');
  expect(result.getByTestId('layered-native-evidence').props.children.join('')).toContain(
    '文档提交 0'
  );
  expect(host().props.nativeMessage.type).toBe('begin');
  expect(host().props.nativeMessage.sample).toEqual(sample);
  await act(async () =>
    host().props.onNativeReply({ id: 1, contextKey: 'epoch:1', messageId: 1, status: 'accepted' })
  );
  expect(host().props.nativeMessage.type).toBe('stroke');
  expect(host().props.nativeMessage.contextKey).toBe('epoch:1');
  await act(async () =>
    host().props.onNativeReply({ id: 1, contextKey: 'epoch:1', messageId: 2, status: 'committed' })
  );
  await act(async () =>
    host().props.onNativeReply({ id: 1, contextKey: 'epoch:1', messageId: 2, status: 'committed' })
  );
  expect(result.getByTestId('layered-native-evidence').props.children.join('')).toContain(
    '文档提交 1'
  );
  expect(result.getByTestId('layered-native-status').props.children).toBe(
    'PencilKit 原生链路已验证'
  );
  await act(async () =>
    host().props.onNativeReply({ id: 1, contextKey: 'old-epoch:1', status: 'retire' })
  );
  expect(JSON.parse(canvas().props.demoState).retireIDs).toEqual([]);
  await act(async () =>
    host().props.onNativeReply({ id: 1, contextKey: 'epoch:1', status: 'retire' })
  );
  expect(JSON.parse(canvas().props.demoState).retireIDs).toEqual([1]);
  jest.mocked(useLocalSearchParams).mockReturnValue({ pencilkit: '0' });
  await result.rerender(<LayeredEditorRoute />);
  expect(JSON.parse(canvas().props.demoState).enabled).toBe(false);
  expect(host()).toBe(originalHost);
  expect(result.getByTestId('layered-native-status').props.children).toBe('Web / DOM');
  jest.mocked(useLocalSearchParams).mockReturnValue({ pencilkit: '1' });
  await result.rerender(<LayeredEditorRoute />);
  expect(host()).toBe(originalHost);
  expect(result.getByTestId('layered-native-status').props.children).toContain('等待 DOM 连接');
  expect(result.getByTestId('layered-native-evidence').props.children.join('')).toContain(
    '原生起笔 0'
  );
  await result.unmount();
});

test('old IPA reports a build mismatch and never claims native Demo input', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ pencilkit: '1' });
  jest.mocked(isPencilkitDemoAvailable).mockReturnValue(false);
  const result = await render(<LayeredEditorRoute />);
  expect(result.queryByTestId('layered-pencilkit-canvas')).toBeNull();
  expect(result.getByTestId('layered-native-status').props.children).toContain('构建不匹配');
  expect(result.getByTestId('expo-dom-editor-host').props.nativePencilEnabled).toBe(false);
});

test('native route always registers actions while leaving the experiment disabled by default', async () => {
  const setParams = jest.fn();
  jest.mocked(useRouter).mockReturnValue({ setParams } as unknown as ReturnType<typeof useRouter>);
  const result = await render(<LayeredEditorRoute />);
  const host = result.getByTestId('expo-dom-editor-host');
  expect(host.props.dom).toEqual({ style: { flex: 1 } });
  expect(host.props.nativePencilEnabled).toBe(false);
  expect(host.props.onNativeState).toEqual(expect.any(Function));
  expect(host.props.onNativeReply).toEqual(expect.any(Function));
  expect(result.getByTestId('layered-native-status').props.children).toBe('Web / DOM');
  await fireEvent(result.getByTestId('layered-pencilkit-toggle'), 'valueChange', true);
  expect(setParams).toHaveBeenCalledWith({ pencilkit: '1' });
});

test('native status requires a current configuration acknowledgement and nonempty layout', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ pencilkit: '1' });
  const result = await render(<LayeredEditorRoute />);
  const state = {
    protocolVersion: 1,
    contextKey: 'current:2',
    enabled: false,
    frame: { x: 0, y: 0, width: 800, height: 600 },
    exclusions: [],
    scale: 1,
    brush: { color: '#000', nominalSize: 4, opacity: 1 },
  };
  await act(async () => result.getByTestId('expo-dom-editor-host').props.onNativeState(state));
  const canvas = () => result.getByTestId('layered-pencilkit-canvas');
  const status = () => result.getByTestId('layered-native-status').props.children;
  const evidence = () => result.getByTestId('layered-native-evidence').props.children.join('');
  await fireEvent(canvas(), 'ready', { nativeEvent: { moduleVersion: '0.1.0' } });
  await fireEvent(canvas(), 'demoStatus', {
    nativeEvent: {
      contextKey: 'current:1',
      enabled: true,
      width: 800,
      height: 600,
      lastHit: 'pencil',
      routing: 'gesture-ancestor',
      toolBegins: 0,
    },
  });
  expect(status()).toContain('等待原生配置回执');
  await fireEvent(canvas(), 'demoStatus', { nativeEvent: null });
  await fireEvent(canvas(), 'demoStatus', {
    nativeEvent: {
      contextKey: 'current:2',
      enabled: false,
      width: 800,
      height: 600,
      lastHit: 'disabled',
      routing: 'gesture-ancestor',
      toolBegins: 0,
    },
  });
  expect(status()).toBe('PencilKit 画布已停用');
  expect(evidence()).toContain('hit=disabled');
  await act(async () =>
    result.getByTestId('expo-dom-editor-host').props.onNativeState({ ...state, enabled: true })
  );
  await fireEvent(canvas(), 'demoStatus', {
    nativeEvent: {
      contextKey: 'current:2',
      enabled: true,
      width: 0,
      height: 0,
      lastHit: 'none',
      routing: 'gesture-ancestor',
      toolBegins: 0,
    },
  });
  expect(status()).toContain('等待画布布局');
  await fireEvent(canvas(), 'demoStatus', {
    nativeEvent: {
      contextKey: 'current:2',
      enabled: true,
      width: 800,
      height: 600,
      lastHit: 'none',
      routing: 'unattached',
      toolBegins: 0,
    },
  });
  expect(status()).toBe('PencilKit 原生宿主未连接');
  await fireEvent(canvas(), 'demoStatus', {
    nativeEvent: {
      contextKey: 'current:2',
      enabled: true,
      width: 800,
      height: 600,
      lastHit: 'none',
      routing: 'gesture-ancestor',
      toolBegins: 0,
    },
  });
  expect(status()).toBe('PencilKit 已配置，等待原生起笔');
  expect(evidence()).toContain('原生起笔 0');
  await act(async () =>
    result.getByTestId('expo-dom-editor-host').props.onNativeReply({
      id: 0,
      contextKey: 'current:2',
      status: 'rejected',
      reason: 'dom-pencil-fallback',
    })
  );
  expect(status()).toBe('PencilKit 断言失败：Pencil 到达 DOM，已阻止绘制');
  expect(JSON.parse(canvas().props.demoState).enabled).toBe(false);
  await result.unmount();
});

test('later completed strokes cannot postpone a blocked begin watchdog', async () => {
  jest.useFakeTimers();
  jest.mocked(useLocalSearchParams).mockReturnValue({ pencilkit: '1' });
  const result = await render(<LayeredEditorRoute />);
  try {
    const host = result.getByTestId('expo-dom-editor-host');
    const canvas = () => result.getByTestId('layered-pencilkit-canvas');
    await act(async () =>
      host.props.onNativeState({
        protocolVersion: 1,
        contextKey: 'watchdog:1',
        enabled: true,
        frame: { x: 0, y: 0, width: 800, height: 600 },
        exclusions: [],
        scale: 1,
        brush: { color: '#000', nominalSize: 4, opacity: 1 },
      })
    );
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
    await fireEvent(canvas(), 'begin', {
      nativeEvent: { id: 1, contextKey: 'watchdog:1', sample },
    });
    await act(async () => jest.advanceTimersByTime(3000));
    await fireEvent(canvas(), 'stroke', {
      nativeEvent: {
        id: 1,
        contextKey: 'watchdog:1',
        cancelled: false,
        overflow: false,
        samples: [sample, { ...sample, seq: 1, phase: 'up', tabs: 1001 }],
      },
    });
    await act(async () => jest.advanceTimersByTime(2000));
    expect(result.getByTestId('layered-native-status').props.children).toContain('bridge-stalled');
    expect(JSON.parse(canvas().props.demoState).enabled).toBe(false);
    expect(result.getByTestId('layered-native-evidence').props.children.join('')).toContain(
      '队列 2'
    );
  } finally {
    await result.unmount();
    jest.useRealTimers();
  }
});
