import { act, render, waitFor } from '@testing-library/react';
import LayeredEditorDom from '../../../../apps/playground/src/layered-editor/LayeredEditorDom';
import { layeredPointer, mockLayeredDom } from './fixtures/layeredDom';
import type {
  PencilkitDemoMessage,
  PencilkitDemoReply,
  PencilkitDemoSample,
  PencilkitDemoState,
} from '../input/native/pencilkitDemoContract';

beforeEach(() => {
  mockLayeredDom();
  const bounds = jest.mocked(Element.prototype.getBoundingClientRect).getMockImplementation()!;
  jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element
  ) {
    const rect = bounds.call(this);
    // Controls occupy a corner, not the entire surface as in the generic DOM fixture.
    return this.matches('button,input,textarea,select,[contenteditable],[data-interactive]')
      ? {
          ...rect,
          x: 700,
          left: 700,
          y: 500,
          top: 500,
          width: 50,
          height: 30,
          right: 750,
          bottom: 530,
        }
      : rect;
  });
});
afterEach(() => jest.restoreAllMocks());

test('real DOM board commits a queued native stroke across a compatible configuration update', async () => {
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
  const surface = view.container.querySelector('[data-testid="layered-surface"]')!;
  const frame = surface.getBoundingClientRect();
  surface.getBoundingClientRect = () => ({ ...frame, height: 560, bottom: 560 });
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
  expect(onState.mock.calls.at(-1)![0].contextKey).not.toBe(state.contextKey);
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

test('real board never creates silent DOM ink when native Pencil is requested; fingers still draw', async () => {
  const onReply = jest.fn(async (_reply: PencilkitDemoReply) => {});
  const view = render(
    <LayeredEditorDom
      nativePencilEnabled
      onNativeState={async () => {}}
      onNativeReply={onReply}
      editorParams={{ diagnostics: '1' }}
    />
  );
  await act(async () => {});
  const host = view.container.querySelector('[data-input-ready="true"]')!;
  expect(host).not.toBeNull();
  for (const phase of ['down', 'move', 'up'] as const) layeredPointer(host, phase, 100, 100);
  expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ reason: 'dom-pencil-fallback' }));
  const controller = window.__layeredEditor!;
  expect(controller.getSnapshot('document').objects).toHaveLength(0);
  expect(controller.getSnapshot('interaction').activeFreehand).toBeUndefined();
  for (const phase of ['down', 'move', 'up'] as const)
    layeredPointer(host, phase, 100, 100, 'touch', 2);
  expect(controller.getSnapshot('document').objects).toHaveLength(1);
  expect(controller.getSnapshot('document').objects[0]).toMatchObject({
    samples: expect.arrayContaining([expect.objectContaining({ source: 'touch' })]),
  });
  view.unmount();
});

test('long and consecutive native strokes reach mounted PF history and retire individually', async () => {
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
  let messageId = 0;
  for (let id = 1; id <= 24; id++) {
    const contextKey = onState.mock.calls.at(-1)![0].contextKey;
    const count = id === 1 ? 5000 : 16;
    const samples: PencilkitDemoSample[] = Array.from({ length: count }, (_, seq) => ({
      seq,
      kind: seq > 0 && seq < count - 1 && seq % 2 ? 'coalesced' : 'main',
      phase: seq === 0 ? 'down' : seq === count - 1 ? 'up' : 'move',
      x: 30 + (seq % 20),
      y: 40 + (seq % 10),
      tabs: 1000 + seq,
      f: 1,
      mf: 8,
      p: 0.125,
    }));
    const begin: PencilkitDemoMessage = {
      type: 'begin',
      protocolVersion: 1,
      messageId: ++messageId,
      id,
      contextKey,
      sample: samples[0],
    };
    view.rerender(<LayeredEditorDom {...props} nativeMessage={begin} />);
    const stroke: PencilkitDemoMessage = {
      type: 'stroke',
      protocolVersion: 1,
      messageId: ++messageId,
      id,
      contextKey,
      stroke: { id, cancelled: false, overflow: false, samples },
    };
    view.rerender(<LayeredEditorDom {...props} nativeMessage={stroke} />);
    await act(async () => {});
    expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ status: 'committed', id }));
    expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ status: 'retire', id }));
    const retired: PencilkitDemoMessage = {
      type: 'retired',
      protocolVersion: 1,
      messageId: ++messageId,
      id,
      contextKey,
    };
    view.rerender(<LayeredEditorDom {...props} nativeMessage={retired} />);
    const objects = window.__layeredEditor!.getSnapshot('document').objects;
    expect(objects).toHaveLength(id);
    const object = objects.at(-1)!;
    if (object.kind !== 'freehand') throw new Error('missing native ink');
    expect(object.samples).toHaveLength(count);
    expect(object.samples[0].source).toBe('native');
    const node = Array.from(view.container.querySelectorAll<SVGGElement>('[data-object-id]')).at(
      -1
    )!;
    expect(node.querySelector('path')?.getAttribute('d')).toBeTruthy();
    expect(node.style.visibility).toBe('visible');
  }
  expect(onReply.mock.calls.some(([reply]) => reply.status === 'rejected')).toBe(false);
  view.unmount();
});
