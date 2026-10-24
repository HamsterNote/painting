import { act, render, waitFor } from '@testing-library/react';
import LayeredEditorDom from '../../../../apps/playground/src/layered-editor/LayeredEditorDom';
import { layeredPointer, mockLayeredDom } from './fixtures/layeredDom';
import * as objectQueries from '../core/layeredObjectQuery';
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
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function nativeDemo() {
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
  type Body<T = PencilkitDemoMessage> = T extends PencilkitDemoMessage
    ? Omit<T, 'protocolVersion' | 'messageId'>
    : never;
  const send = (message: Body) =>
    view.rerender(
      <LayeredEditorDom
        {...props}
        nativeMessage={{ ...message, messageId: ++messageId, protocolVersion: 1 }}
      />
    );
  const samples = new Map<number, { sample: PencilkitDemoSample; contextKey: string }>();
  const begin = (id: number) => {
    const contextKey = onState.mock.calls.at(-1)![0].contextKey;
    const sample: PencilkitDemoSample = {
      seq: 0,
      kind: 'main',
      phase: 'down',
      x: 30,
      y: id * 20,
      tabs: id * 1000,
      f: 1,
      mf: 8,
      p: 0.125,
    };
    samples.set(id, { sample, contextKey });
    send({ type: 'begin', id, contextKey, sample });
  };
  const end = (id: number) => {
    const { sample, contextKey } = samples.get(id)!;
    send({
      type: 'stroke',
      id,
      contextKey,
      stroke: {
        id,
        cancelled: false,
        overflow: false,
        samples: [
          sample,
          { ...sample, seq: 1, phase: 'up', x: 120 + id * 20, tabs: sample.tabs + 100 },
        ],
      },
    });
  };
  const retired = (id: number) =>
    send({ type: 'retired', id, contextKey: samples.get(id)!.contextKey });
  const nodes = () => Array.from(view.container.querySelectorAll<SVGGElement>('[data-object-id]'));
  return {
    view,
    onState,
    onReply,
    begin,
    end,
    retired,
    nodes,
    controller: window.__layeredEditor!,
  };
}

test('a second native pen starts before previous retirement without reusing its raw or history path', async () => {
  const h = await nativeDemo();
  jest.useFakeTimers();
  h.begin(1);
  h.end(1);
  const first = h.controller.getSnapshot('document').objects[0];
  const firstPath = h.nodes()[0].querySelector('path')!.getAttribute('d');
  h.begin(2);
  h.retired(1);
  expect(h.controller.getSnapshot('interaction').activeFreehand).toMatchObject({
    status: 'collecting',
    samples: [expect.objectContaining({ y: 40 })],
  });
  expect(h.nodes()[0].style.visibility).toBe('visible');
  h.end(2);
  expect(h.controller.getSnapshot('document').objects[0]).toBe(first);
  expect(h.nodes()[0].querySelector('path')!.getAttribute('d')).toBe(firstPath);
  expect(h.nodes()[1].querySelector('path')!.getAttribute('d')).not.toBe(firstPath);
  h.retired(2);
  expect(h.nodes().every((node) => node.style.visibility === 'visible')).toBe(true);
  act(() => jest.advanceTimersByTime(5000));
  expect(h.onReply.mock.calls.some(([reply]) => reply.status === 'rejected')).toBe(false);
  h.view.unmount();
});

test('native pen handoff during Line completion preserves history and leaves the UI usable', async () => {
  const h = await nativeDemo();
  jest.useFakeTimers();
  h.begin(1);
  h.end(1);
  const first = h.controller.getSnapshot('document').objects[0];
  const query = jest.spyOn(objectQueries, 'prepareLayeredObjectQuery');
  act(() => {
    h.controller.setTool('line');
  });
  const host = h.view.container.querySelector('[data-input-ready="true"]')!;
  layeredPointer(host, 'down', 100, 200, 'pen', 20);
  layeredPointer(host, 'move', 300, 250, 'pen', 20);
  h.retired(1);
  layeredPointer(host, 'up', 350, 280, 'pen', 20);
  expect(h.controller.getSnapshot('document').objects).toEqual([
    first,
    expect.objectContaining({ kind: 'shape', shapeType: 'line' }),
  ]);
  expect(query).not.toHaveBeenCalled();
  expect(h.nodes().every((node) => node.style.visibility === 'visible')).toBe(true);
  act(() => {
    h.controller.undo();
    h.controller.redo();
    h.controller.setTool('freehand');
  });
  h.begin(2);
  h.end(2);
  h.retired(2);
  act(() => jest.advanceTimersByTime(5000));
  expect(h.controller.getSnapshot('document').objects).toHaveLength(3);
  expect(h.controller.getSnapshot('preview')).toEqual({ objects: [], hiddenIds: [], path: [] });
  expect(h.onReply.mock.calls.some(([reply]) => reply.status === 'rejected')).toBe(false);
  expect(h.onState.mock.calls.at(-1)![0].enabled).toBe(true);
  h.view.unmount();
});

test('native preview has a transparent DOM paper; switching off restores Web paper', async () => {
  const props = { onNativeState: async () => {}, onNativeReply: async () => {} };
  const view = render(<LayeredEditorDom {...props} nativePencilEnabled />);
  await act(async () => {});
  expect((view.getByTestId('layered-surface') as HTMLElement).style.background).toBe('transparent');
  view.rerender(<LayeredEditorDom {...props} nativePencilEnabled={false} />);
  await act(async () => {});
  expect((view.getByTestId('layered-surface') as HTMLElement).style.background).toBe(
    'rgb(255, 255, 255)'
  );
  view.unmount();
});

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
  jest.useFakeTimers();
  const host = view.container.querySelector('[data-input-ready="true"]')!;
  expect(host).not.toBeNull();
  for (const phase of ['down', 'move', 'up'] as const) layeredPointer(host, phase, 100, 100);
  act(() => jest.advanceTimersByTime(5000));
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

test('three committed strokes and a fourth collecting stroke reveal all history after batched retirement', async () => {
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
  jest.useFakeTimers();
  const key = onState.mock.calls.at(-1)![0].contextKey;
  let messageId = 0;
  type MessageBody<T = PencilkitDemoMessage> = T extends PencilkitDemoMessage
    ? Omit<T, 'messageId' | 'protocolVersion'>
    : never;
  const send = (message: MessageBody) => {
    view.rerender(
      <LayeredEditorDom
        {...props}
        nativeMessage={{ ...message, messageId: ++messageId, protocolVersion: 1 }}
      />
    );
  };
  const begin = (id: number): PencilkitDemoSample => {
    const sample: PencilkitDemoSample = {
      seq: 0,
      kind: 'main',
      phase: 'down',
      x: 100,
      y: id * 50,
      tabs: id * 1000,
      f: 1,
      mf: 8,
      p: 0.125,
    };
    // Use the real DOM receiver/controller/display; hold native retirement receipts until after four.
    send({ type: 'begin', id, contextKey: key, sample });
    return sample;
  };
  const finish = (id: number, sample: PencilkitDemoSample) => {
    send({
      type: 'stroke',
      id,
      contextKey: key,
      stroke: {
        id,
        cancelled: false,
        overflow: false,
        samples: [sample, { ...sample, seq: 1, phase: 'up', x: 200, tabs: sample.tabs + 100 }],
      },
    });
    expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ status: 'retire', id }));
  };
  for (let id = 1; id <= 3; id++) {
    finish(id, begin(id));
  }
  const fourth = begin(4);
  act(() => jest.advanceTimersByTime(30000));
  expect(onState.mock.calls.at(-1)![0].enabled).toBe(true);
  expect(window.__layeredEditor!.getSnapshot('document').objects).toHaveLength(3);
  expect(window.__layeredEditor!.getSnapshot('interaction').activeFreehand?.status).toBe(
    'collecting'
  );
  finish(4, fourth);
  const nodes = () => Array.from(view.container.querySelectorAll<SVGGElement>('[data-object-id]'));
  expect(nodes()).toHaveLength(4);
  expect(nodes().every((node) => node.style.visibility === 'hidden')).toBe(true);
  for (const id of [4, 3, 2]) send({ type: 'retired', id, contextKey: key });
  expect(nodes().every((node) => node.style.visibility === 'hidden')).toBe(true);
  send({ type: 'retired', id: 1, contextKey: key });
  for (const node of nodes()) {
    expect(node.querySelector('path')?.getAttribute('d')).toBeTruthy();
    expect(node.style.visibility).toBe('visible');
  }
  act(() => jest.advanceTimersByTime(5000));
  expect(onReply.mock.calls.some(([reply]) => reply.status === 'rejected')).toBe(false);
  expect(onState.mock.calls.at(-1)![0].enabled).toBe(true);
  expect(window.__layeredEditor!.getSnapshot('document').objects).toHaveLength(4);
  const previousPaths = nodes().map((node) => node.querySelector('path')!.getAttribute('d'));
  finish(5, begin(5));
  expect(nodes()).toHaveLength(5);
  expect(
    nodes()
      .slice(0, 4)
      .every((node) => node.style.visibility === 'visible')
  ).toBe(true);
  expect(nodes()[4].style.visibility).toBe('hidden');
  send({ type: 'retired', id: 5, contextKey: key });
  expect(nodes().every((node) => node.style.visibility === 'visible')).toBe(true);
  expect(
    nodes()
      .slice(0, 4)
      .map((node) => node.querySelector('path')!.getAttribute('d'))
  ).toEqual(previousPaths);
  expect(nodes()[4].querySelector('path')?.getAttribute('d')).toBeTruthy();
  expect(window.__layeredEditor!.getSnapshot('document').objects).toHaveLength(5);
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
    const host = view.container.querySelector('[data-input-ready="true"]')!;
    if (id % 2) layeredPointer(host, 'down', 30, 40);
    view.rerender(<LayeredEditorDom {...props} nativeMessage={begin} />);
    if (!(id % 2)) layeredPointer(host, 'down', 30, 40);
    layeredPointer(host, 'move', 35, 45);
    layeredPointer(host, 'up', 40, 50);
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
