import { makeLayeredController, layeredRect } from '../../../__tests__/fixtures/layered';
import { PresentationCoordinator } from '../../../layered/PresentationCoordinator';
import { createLayeredInputArbiter } from '../../web/layeredInputArbiter';
import { connectPencilkitDemo } from '../pencilkitDemoBridge';
import type {
  PencilkitDemoMessage,
  PencilkitDemoReply,
  PencilkitDemoSample,
  PencilkitDemoState,
} from '../pencilkitDemoContract';
import { serializeLayeredDocument, readLayeredDocument } from '../../../model/documentReader';
import { layeredPointer } from '../../../__tests__/fixtures/layeredDom';

function sample(seq: number, phase: PencilkitDemoSample['phase']): PencilkitDemoSample {
  return {
    seq,
    phase,
    kind: 'main',
    x: 40 + seq * 10,
    y: 60,
    tabs: 1000 + seq,
    f: seq === 2 ? 0 : 0.25,
    mf: 1,
    p: seq === 2 ? 0 : 0.25,
  };
}
function setup() {
  const host = document.createElement('div');
  host.dataset.inputReady = 'true';
  host.getBoundingClientRect = () => ({
    x: 0,
    y: 40,
    left: 0,
    top: 40,
    width: 500,
    height: 400,
    right: 500,
    bottom: 440,
    toJSON: () => ({}),
  });
  document.body.append(host);
  const controller = makeLayeredController();
  const presentation = new PresentationCoordinator(controller);
  const tool = { dispatch: jest.fn(), cancel: jest.fn(() => true) };
  const navigation = { dispatch: jest.fn(), cancel: jest.fn(() => true), begin: jest.fn() };
  const arbiter = createLayeredInputArbiter({ host, controller, tool, navigation });
  const replies: PencilkitDemoReply[] = [];
  const states: PencilkitDemoState[] = [];
  let state!: PencilkitDemoState;
  let receive!: (message: PencilkitDemoMessage) => void;
  const stop = connectPencilkitDemo({
    host,
    controller,
    presentation,
    arbiter,
    connection: {
      onState: (next) => {
        state = next;
        states.push(next);
      },
      onReply: (reply) => replies.push(reply),
      register: (next) => {
        if (next) receive = next;
      },
    },
  });
  let messageId = 0;
  let key = '';
  function begin(id = 1) {
    key = state.contextKey;
    const message: PencilkitDemoMessage = {
      type: 'begin',
      protocolVersion: 1,
      messageId: ++messageId,
      contextKey: key,
      id,
      sample: sample(0, 'down'),
    };
    receive(message);
    return message;
  }
  function end(id = 1, overrides = {}) {
    const message: PencilkitDemoMessage = {
      type: 'stroke',
      protocolVersion: 1,
      messageId: ++messageId,
      contextKey: key,
      id,
      stroke: {
        id,
        cancelled: false,
        overflow: false,
        samples: [sample(0, 'down'), sample(1, 'move'), sample(2, 'up')],
        ...overrides,
      },
    };
    receive(message);
    return message;
  }
  function retired(id = 1, contextKey = key) {
    receive({ type: 'retired', protocolVersion: 1, messageId: ++messageId, contextKey, id });
  }
  return {
    host,
    controller,
    presentation,
    tool,
    navigation,
    replies,
    states,
    begin,
    end,
    receive,
    retired,
    state: () => state,
    disconnect: stop,
    destroy() {
      stop();
      arbiter.destroy();
      presentation.destroy();
      host.remove();
    },
  };
}

test('long native batches commit once and continuous strokes retire without a state message backlog', () => {
  const h = setup();
  const startedWith = h.states.length;
  for (let id = 1; id <= 64; id++) {
    h.begin(id);
    const count = id === 1 ? 20_000 : 64;
    const samples = Array.from({ length: count }, (_, seq) => ({
      ...sample(seq, seq === 0 ? 'down' : seq === count - 1 ? 'up' : 'move'),
      x: 40 + (seq % 20),
      kind: seq > 0 && seq < count - 1 && seq % 2 ? ('coalesced' as const) : ('main' as const),
    }));
    const end = h.end(id, { samples });
    h.receive(end);
    const document = h.controller.getSnapshot('document');
    expect(document.objects).toHaveLength(id);
    const object = document.objects.at(-1)!;
    if (object.kind !== 'freehand') throw new Error('expected native ink');
    expect(object.samples).toHaveLength(count);
    expect(object.samples[0]).toMatchObject({ phase: 'down', source: 'native' });
    expect(object.samples.at(-1)).toMatchObject({ phase: 'up', sequence: count - 1 });
    const identity = h.controller.getPresentationIdentity(object.commitId);
    if (!identity.ok || !identity.value) throw new Error('missing identity');
    const unmount = h.presentation.mount(object.objectId, { setVisible: () => {} });
    h.presentation.acknowledge(identity.value);
    h.retired(id);
    expect(h.presentation.hasNativePreview(object.commitId)).toBe(false);
    unmount();
  }
  expect(h.replies).not.toContainEqual(expect.objectContaining({ status: 'rejected' }));
  expect(h.controller.getSnapshot('interaction').activeFreehand).toBeUndefined();
  expect(h.state().enabled).toBe(true);
  expect(h.states).toHaveLength(startedWith);
  h.destroy();
});

test('real raw goes to schema 3 and shared history; viewport mapping and zero pressure survive', () => {
  const h = setup();
  h.controller.updateViewport({
    type: 'replace',
    expectedRevision: 0,
    viewport: { scale: 2, tx: 10, ty: 20 },
  });
  h.begin();
  expect(h.controller.getSnapshot('input').penSeen).toBe(true);
  expect(
    h.controller.updateViewport({
      type: 'replace',
      expectedRevision: 1,
      viewport: { scale: 1, tx: 0, ty: 0 },
    })
  ).toMatchObject({ ok: true, value: { applied: false } });
  h.end();
  const document = h.controller.getSnapshot('document');
  const object = document.objects[0];
  expect(object.kind).toBe('freehand');
  if (object.kind !== 'freehand') throw new Error('missing native object');
  expect(object.resolvedPressureMode).toBe('real');
  expect(object.samples).toEqual(
    [0, 1, 2].map((seq) => ({
      sequence: seq,
      x: (40 + seq * 10 - 10) / 2,
      y: 20,
      time: 1000 + seq,
      phase: seq === 0 ? 'down' : seq === 2 ? 'up' : 'move',
      source: 'native',
      pressure: seq === 2 ? 0 : 0.25,
    }))
  );
  const serialized = serializeLayeredDocument(document);
  if (!serialized.ok) throw new Error('serialization failed');
  expect(readLayeredDocument(JSON.parse(serialized.value))).toMatchObject({
    ok: true,
    value: document,
  });
  h.controller.setTool('rect');
  h.controller.editObjects({
    expectedDocumentRevision: document.documentRevision,
    upsert: [layeredRect()],
  });
  h.controller.undo();
  expect(h.controller.getSnapshot('document').objects).toHaveLength(1);
  h.controller.undo();
  expect(h.controller.getSnapshot('document').objects).toHaveLength(0);
  h.controller.redo();
  expect(h.controller.getSnapshot('document').objects).toHaveLength(1);
  h.destroy();
});

test('a queued begin survives a same-origin size update and commits exactly once', () => {
  const h = setup();
  const configuredKey = h.state().contextKey;
  const rect = h.host.getBoundingClientRect();
  h.host.getBoundingClientRect = () => ({ ...rect, height: 380, bottom: 420 });
  const begin = h.begin();
  expect(begin.contextKey).toBe(configuredKey);
  expect(h.state().contextKey).not.toBe(configuredKey);
  expect(h.replies).toContainEqual(expect.objectContaining({ status: 'accepted', id: 1 }));
  window.dispatchEvent(new Event('resize'));
  const end = h.end();
  h.receive(end);
  expect(h.controller.getSnapshot('document').objects).toHaveLength(1);
  expect(h.controller.getSnapshot('interaction').activeFreehand).toBeUndefined();
  expect(h.replies).not.toContainEqual(expect.objectContaining({ status: 'rejected' }));
  h.destroy();
});

test.each(['origin', 'viewport', 'brush', 'policy', 'exclusion', 'unknown'] as const)(
  'a queued begin rejects incompatible %s state without a document commit',
  (change) => {
    const h = setup();
    const key = h.state().contextKey;
    if (change === 'origin') {
      const rect = h.host.getBoundingClientRect();
      h.host.getBoundingClientRect = () => ({ ...rect, y: 50, top: 50, bottom: 450 });
    } else if (change === 'viewport') {
      h.controller.updateViewport({
        type: 'replace',
        expectedRevision: 0,
        viewport: { scale: 2, tx: 0, ty: 0 },
      });
    } else if (change === 'brush') {
      h.controller.setFreehandSettings({
        ...h.controller.getSnapshot('tools').settings.freehand,
        color: '#123456',
      });
    } else if (change === 'policy') h.controller.setInputMode('finger');
    else if (change === 'exclusion') {
      const control = document.createElement('button');
      control.getBoundingClientRect = () => h.host.getBoundingClientRect();
      h.host.append(control);
    }
    h.receive({
      type: 'begin',
      protocolVersion: 1,
      messageId: 90,
      id: 1,
      contextKey: change === 'unknown' ? key + '-unknown' : key,
      sample: sample(0, 'down'),
    });
    expect(h.replies).toContainEqual(
      expect.objectContaining({
        status: 'rejected',
        reason: change === 'exclusion' ? 'begin-outside-canvas' : 'stale-begin-context',
      })
    );
    expect(h.controller.getSnapshot('document').objects).toHaveLength(0);
    expect(h.controller.getSnapshot('interaction').activeFreehand).toBeUndefined();
    h.destroy();
  }
);

test.each(['policy', 'undo'] as const)(
  'begin notifications cannot resurrect a lease cancelled by synchronous %s',
  (change) => {
    const h = setup();
    const stop = h.controller.subscribe('interaction', () => {
      if (h.controller.getSnapshot('interaction').activeFreehand?.status === 'collecting')
        if (change === 'policy') h.controller.setInputMode('finger');
        else h.controller.undo();
    });
    h.begin();
    h.end();
    expect(h.controller.getSnapshot('document').objects).toHaveLength(0);
    expect(h.controller.getSnapshot('interaction').activeFreehand).toBeUndefined();
    expect(h.replies).not.toContainEqual(expect.objectContaining({ status: 'accepted' }));
    stop();
    h.begin(2);
    h.end(2);
    expect(h.controller.getSnapshot('document').objects).toHaveLength(1);
    h.destroy();
  }
);

test('brush changes while claiming input cannot replace the configured native begin brush', () => {
  const h = setup();
  const stop = h.controller.subscribe('input', () => {
    if (h.controller.getSnapshot('input').penSeen)
      h.controller.setFreehandSettings({
        ...h.controller.getSnapshot('tools').settings.freehand,
        color: '#123456',
      });
  });
  h.begin();
  h.end();
  expect(h.replies).not.toContainEqual(expect.objectContaining({ status: 'accepted' }));
  expect(h.controller.getSnapshot('document').objects).toHaveLength(0);
  expect(h.controller.getSnapshot('interaction').activeFreehand).toBeUndefined();
  stop();
  h.begin(2);
  h.end(2);
  expect(h.controller.getSnapshot('document').objects).toHaveLength(1);
  h.destroy();
});

test('Web Pencil fallback fails closed and faults explicitly instead of dispatching a tool stroke', () => {
  const h = setup();
  for (const phase of ['down', 'move', 'up'] as const) {
    layeredPointer(h.host, phase, 50, 60);
  }
  expect(h.tool.dispatch).not.toHaveBeenCalled();
  expect(h.controller.getSnapshot('document').objects).toHaveLength(0);
  expect(h.replies).toContainEqual(
    expect.objectContaining({ reason: 'dom-pencil-fallback', status: 'rejected' })
  );
  expect(h.state().enabled).toBe(false);
  h.destroy();
});

test.each(['touch', 'mouse'])('native guard keeps genuine %s tool input on Web', (source) => {
  const h = setup();
  for (const phase of ['down', 'move', 'up'] as const) {
    layeredPointer(h.host, phase, 50, 60, source);
  }
  expect(h.tool.dispatch).toHaveBeenCalledTimes(3);
  expect(h.replies).not.toContainEqual(expect.objectContaining({ reason: 'dom-pencil-fallback' }));
  h.destroy();
});

test('semantic tools keep Web Pencil input and disconnect removes the guard', () => {
  const h = setup();
  h.controller.setTool('rect');
  layeredPointer(h.host, 'down', 50, 60);
  layeredPointer(h.host, 'up', 60, 70);
  expect(h.tool.dispatch).toHaveBeenCalledTimes(2);
  h.controller.setTool('freehand');
  h.disconnect();
  layeredPointer(h.host, 'down', 50, 60);
  layeredPointer(h.host, 'up', 60, 70);
  expect(h.tool.dispatch).toHaveBeenCalledTimes(4);
  expect(h.replies).not.toContainEqual(expect.objectContaining({ reason: 'dom-pencil-fallback' }));
  h.destroy();
});

test('history readiness never retires a different preview or reveals native ink early', () => {
  const h = setup();
  h.begin();
  h.end();
  const first = h.controller.getSnapshot('document').objects[0];
  const visible = jest.fn();
  const identity = h.controller.getPresentationIdentity(
    first.kind === 'freehand' ? first.commitId : ''
  )!;
  if (!identity.ok || !identity.value) throw new Error('missing identity');
  h.presentation.mount(first.objectId, { setVisible: visible, matches: () => true });
  h.presentation.acknowledge(identity.value);
  expect(h.replies).toContainEqual(expect.objectContaining({ status: 'retire', id: 1 }));
  expect(h.presentation.isHidden(first.objectId)).toBe(true);
  h.retired(1, 'stale-epoch');
  expect(h.presentation.isHidden(first.objectId)).toBe(true);
  h.retired();
  expect(h.presentation.isHidden(first.objectId)).toBe(false);
  expect(visible).toHaveBeenLastCalledWith(true);
  h.destroy();
});

test.each([
  { cancelled: true },
  { overflow: true },
  { samples: [sample(0, 'down'), sample(1, 'move')] },
  { samples: [sample(0, 'down'), { ...sample(2, 'up'), seq: 7 }] },
])('rejects the whole invalid batch without history: %j', (change) => {
  const h = setup();
  h.begin();
  h.end(1, change);
  expect(h.controller.getSnapshot('document').objects).toHaveLength(0);
  expect(h.controller.getSnapshot('interaction').activeFreehand).toBeUndefined();
  expect(h.controller.getSnapshot('history').canUndo).toBe(false);
  h.destroy();
});

test('retries are idempotent and changed payload/message IDs conflict', () => {
  const h = setup();
  const begin = h.begin();
  h.receive(begin);
  const end = h.end();
  h.receive(end);
  if (end.type !== 'stroke') throw new Error('expected stroke');
  h.receive({ ...end, messageId: 80 });
  h.receive({
    ...end,
    messageId: 81,
    stroke: { ...end.stroke, samples: [sample(0, 'down'), { ...sample(2, 'up'), x: 999 }] },
  });
  h.receive({ ...end, contextKey: 'changed' });
  expect(h.controller.getSnapshot('document').objects).toHaveLength(1);
  expect(h.replies).toContainEqual(expect.objectContaining({ reason: 'commit-id-conflict' }));
  expect(h.replies).toContainEqual(expect.objectContaining({ reason: 'message-id-conflict' }));
  h.destroy();
});

test.each(['text', 'mode', 'undo', 'layout'] as const)(
  '%s invalidates collecting; stale end cannot create history',
  (reason) => {
    const h = setup();
    h.begin();
    if (reason === 'text') h.controller.setTool('text');
    else if (reason === 'mode') h.controller.setInputMode('finger');
    else if (reason === 'undo') h.controller.undo();
    else {
      const rect = h.host.getBoundingClientRect();
      h.host.getBoundingClientRect = () => ({ ...rect, y: 50, top: 50, bottom: 450 });
      window.dispatchEvent(new Event('resize'));
    }
    h.end();
    expect(h.controller.getSnapshot('document').objects).toHaveLength(0);
    h.destroy();
  }
);

test('native ownership suppresses real palms until all contacts lift, then Web navigation resumes', () => {
  const h = setup();
  const touch = (type: string, id: number) => {
    const event = new Event(type, { bubbles: true });
    Object.assign(event, {
      pointerId: id,
      pointerType: 'touch',
      clientX: 10,
      clientY: 50,
      button: 0,
    });
    (type === 'pointerdown' ? h.host : window).dispatchEvent(event);
  };
  h.begin();
  touch('pointerdown', 1);
  touch('pointerdown', 2);
  h.end();
  touch('pointermove', 1);
  touch('pointermove', 2);
  expect(h.navigation.dispatch).not.toHaveBeenCalled();
  expect(h.navigation.begin).not.toHaveBeenCalled();
  expect(h.tool.dispatch).not.toHaveBeenCalled();
  touch('pointerup', 1);
  touch('pointerup', 2);
  touch('pointerdown', 3);
  expect(h.navigation.dispatch).toHaveBeenCalledTimes(1);
  h.destroy();
});

test('timeout faults without clearing preview or pretending history was physically displayed', () => {
  jest.useFakeTimers();
  const h = setup();
  h.begin();
  h.end();
  jest.advanceTimersByTime(5000);
  expect(h.state().enabled).toBe(false);
  expect(h.replies).toContainEqual(expect.objectContaining({ reason: 'handoff-stalled' }));
  expect(h.replies.filter((reply) => reply.status === 'retire')).toHaveLength(0);
  expect(h.controller.getSnapshot('document').objects).toHaveLength(1);
  h.destroy();
  jest.useRealTimers();
});

test('policy cancellation releases native ownership even when no old raw end will arrive', () => {
  const h = setup();
  h.begin();
  h.controller.setInputMode('finger');
  h.begin(2);
  h.end(2);
  expect(h.controller.getSnapshot('document').objects).toHaveLength(1);
  h.destroy();
});

test('an existing real touch pair rejects native begin without latching automatic pen detection', () => {
  const h = setup();
  for (const id of [1, 2]) {
    const event = new Event('pointerdown', { bubbles: true });
    Object.assign(event, {
      pointerId: id,
      pointerType: 'touch',
      clientX: id * 10,
      clientY: 50,
      button: 0,
    });
    h.host.dispatchEvent(event);
  }
  h.begin();
  expect(h.replies).toContainEqual(expect.objectContaining({ reason: 'input-owner-conflict' }));
  expect(h.controller.getSnapshot('input').penSeen).toBe(false);
  expect(h.controller.getSnapshot('interaction').activeFreehand).toBeUndefined();
  h.destroy();
});
