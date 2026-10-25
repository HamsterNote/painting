import { act, fireEvent, render } from '@testing-library/react-native';

jest.mock(
  '@hamster-note/painting-android-ink',
  () => {
    const React = require('react');
    const { View } = require('react-native');
    return {
      isAndroidInkProbeAvailable: jest.fn(() => true),
      PaintingAndroidInkView: (props: object) => React.createElement(View, props),
    };
  },
  { virtual: true }
);

import AndroidInkProbeRoute from '../../../apps/playground/src/android-ink-probe/AndroidInkProbeRoute.android';

afterEach(() => {
  jest.clearAllMocks();
});

test('missing or mismatched native module requests a rebuilt client', async () => {
  jest
    .requireMock('@hamster-note/painting-android-ink')
    .isAndroidInkProbeAvailable.mockReturnValueOnce(false);
  const result = await render(<AndroidInkProbeRoute />);
  expect(result.getByText(/rebuild the Android development client/)).toBeTruthy();
  expect(result.queryByTestId('android-ink-surface')).toBeNull();
});

test('per-stroke retirement keeps later strokes and captures recycled event data', async () => {
  const result = await render(<AndroidInkProbeRoute />);
  const surface = () => result.getByTestId('android-ink-surface');
  await act(() => {
    for (const id of [1, 2, 3]) {
      const event: { nativeEvent: { id: number } | null } = { nativeEvent: { id } };
      surface().props.onStrokeFinished(event);
      event.nativeEvent = null;
    }
  });
  expect(result.getByText('Pending: 1, 2, 3')).toBeTruthy();
  await fireEvent.press(result.getByText('Retire earliest stroke'));
  expect(surface().props.retireId).toBe(1);

  await act(() => {
    surface().props.onStrokeFinished({ nativeEvent: { id: 4 } });
    for (const id of [1, 1]) {
      const event: { nativeEvent: { id: number } | null } = { nativeEvent: { id } };
      surface().props.onRetired(event);
      event.nativeEvent = null;
    }
  });
  expect(result.getByText('Pending: 2, 3, 4')).toBeTruthy();
  await fireEvent.press(result.getByText('Retire earliest stroke'));
  expect(surface().props.retireId).toBe(2);
});

test('reports the native layout and system cancellation without removing finished strokes', async () => {
  const result = await render(<AndroidInkProbeRoute />);
  const surface = result.getByTestId('android-ink-surface');
  await act(() => {
    surface.props.onReady({
      nativeEvent: {
        probeVersion: 1,
        inkVersion: '1.0.0',
        sdkInt: 36,
        density: 2,
        widthPx: 800,
        heightPx: 600,
      },
    });
    surface.props.onStrokeFinished({ nativeEvent: { id: 1 } });
    surface.props.onCancelled({ nativeEvent: { id: 2, reason: 'system-cancel' } });
  });
  expect(result.getByText('Ink 1.0.0 / API 36 / density 2 / 800 x 600px')).toBeTruthy();
  expect(result.getByText('system-cancel')).toBeTruthy();
  expect(result.getByText('Pending: 1')).toBeTruthy();
});
