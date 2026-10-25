import { act, fireEvent, render } from '@testing-library/react-native';
import { Share } from 'react-native';
import type { PencilkitStrokeSummary } from '../../../packages/painting-pencilkit/src/PaintingPencilkitView';

// Only the native boundary is mocked; the Probe's event handler and renderer are real.
jest.mock('../../../packages/painting-pencilkit/src/PaintingPencilkitView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    PaintingPencilkitView: (props: object) => React.createElement(View, props),
    getStrokesLog: jest.fn(async () => ({ gate: 'G1', strokes: [] })),
    clearStrokesLog: jest.fn(async () => undefined),
  };
});

import PencilkitProbeRoute, {
  PENCILKIT_PROBE_TEST_IDS as IDS,
} from '../../../apps/playground/src/pencilkit-probe/PencilkitProbeRoute.ios';

const stroke: PencilkitStrokeSummary = {
  id: 1,
  touchType: 'pencil',
  durationMs: 12.5,
  bounds: { w: 100, h: 100 },
  counts: { down: 1, up: 1, main: 2, coalesced: 3, total: 5 },
  pressure: { capability: true, min: 0.125, max: 0.875 },
  estimated: { flagsUnion: 0, expectingUnion: 0, lateEstimateEvents: 2 },
  overflow: false,
  cancelled: false,
  samples: [],
};

test('captures nativeEvent before RN recycles it, including batched strokes', async () => {
  const result = await render(<PencilkitProbeRoute />);
  const onStroke = result.getByTestId(IDS.canvas).props.onStroke;

  await act(() => {
    for (const id of [1, 2, 3]) {
      const event: { nativeEvent: PencilkitStrokeSummary | null } = {
        nativeEvent: { ...stroke, id },
      };
      onStroke(event);
      event.nativeEvent = null;
    }
  });

  for (const id of [1, 2, 3]) {
    expect(
      result.getByText(
        `#${id} 5 样本(主 2 / 合 3) down 1 up 1 · 12.5ms · 压力 0.125~0.875 · 迟到估计 2`
      )
    ).toBeTruthy();
  }
});

test('ignores malformed events and keeps valid summaries, export and clear usable', async () => {
  const result = await render(<PencilkitProbeRoute />);
  const onStroke = result.getByTestId(IDS.canvas).props.onStroke;
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  try {
    await act(() => {
      for (const event of [
        undefined,
        null,
        {},
        { nativeEvent: undefined },
        { nativeEvent: null },
      ]) {
        onStroke(event);
      }
      for (const payload of [
        [],
        'bad',
        {},
        { ...stroke, counts: null },
        { ...stroke, counts: { ...stroke.counts, total: '5' } },
        { ...stroke, durationMs: '12.5' },
        { ...stroke, durationMs: NaN },
        { ...stroke, pressure: null },
        { ...stroke, pressure: { capability: true, min: 'bad' } },
        { ...stroke, estimated: {} },
      ]) {
        onStroke({ nativeEvent: payload });
      }
    });
    expect(result.getByText(/尚无完成笔/)).toBeTruthy();

    await act(() => {
      onStroke({
        nativeEvent: {
          ...stroke,
          pressure: { capability: false },
          cancelled: true,
          overflow: true,
        },
      });
      onStroke({ nativeEvent: null });
    });
    expect(result.getByText(/#1 .*压力能力缺失.*\[已取消\] \[样本超限截断\]/)).toBeTruthy();
    await fireEvent.press(result.getByTestId(IDS.export));
    expect(share).toHaveBeenCalledWith({
      message: JSON.stringify({ gate: 'G1', strokes: [] }),
    });
    await fireEvent.press(result.getByTestId(IDS.clear));
    expect(result.getByText(/尚无完成笔/)).toBeTruthy();
  } finally {
    share.mockRestore();
  }
});
