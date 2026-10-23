import { act, render, waitFor } from '@testing-library/react';
import LayeredEditorDom from '../../../../apps/playground/src/layered-editor/LayeredEditorDom';
import { mockLayeredDom } from './fixtures/layeredDom';
import type {
  PencilkitDemoMessage,
  PencilkitDemoReply,
  PencilkitDemoState,
} from '../input/native/pencilkitDemoContract';

beforeEach(() => mockLayeredDom());
afterEach(() => jest.restoreAllMocks());

test('real DOM board publishes enabled native canvas state after input initialization', async () => {
  const onState = jest.fn(async (_state: PencilkitDemoState) => {});
  const onReply = jest.fn(async (_reply: PencilkitDemoReply) => {});
  const props = {
    nativePencilEnabled: true,
    onNativeState: onState,
    onNativeReply: onReply,
    editorParams: { diagnostics: '1' },
  };
  const view = render(<LayeredEditorDom {...props} />);
  await act(async () => {});
  await waitFor(() => expect(onState).toHaveBeenCalled());
  expect(onState.mock.calls.at(-1)![0]).toMatchObject({
    enabled: true,
    frame: { width: 800, height: 600 },
  });
  const state = onState.mock.calls.at(-1)![0];
  const sample = {
    seq: 0,
    kind: 'main' as const,
    phase: 'down' as const,
    x: 30,
    y: 40,
    tabs: 1000,
    f: 1,
    mf: 8,
    p: 0.125,
  };
  const begin: PencilkitDemoMessage = {
    type: 'begin',
    protocolVersion: 1,
    messageId: 1,
    id: 1,
    contextKey: state.contextKey,
    sample,
  };
  view.rerender(<LayeredEditorDom {...props} nativeMessage={begin} />);
  expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ status: 'accepted', id: 1 }));
  const stroke: PencilkitDemoMessage = {
    type: 'stroke',
    protocolVersion: 1,
    messageId: 2,
    id: 1,
    contextKey: state.contextKey,
    stroke: {
      id: 1,
      cancelled: false,
      overflow: false,
      samples: [sample, { ...sample, seq: 1, phase: 'up', tabs: 1001, f: 0, p: 0 }],
    },
  };
  view.rerender(<LayeredEditorDom {...props} nativeMessage={stroke} />);
  expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ status: 'committed', id: 1 }));
  expect(window.__layeredEditor!.getSnapshot('document').objects).toEqual([
    expect.objectContaining({
      samples: expect.arrayContaining([
        expect.objectContaining({ source: 'native', phase: 'down' }),
        expect.objectContaining({ source: 'native', phase: 'up' }),
      ]),
    }),
  ]);
  view.unmount();
});
