import * as objectQuery from '../../core/layeredObjectQuery';
import {
  createLayeredToolSession,
  type LayeredToolScheduler,
  type LassoPerformanceEvent,
} from '../../core/layeredToolSession';
import { layeredRect, makeLayeredController } from '../fixtures/layered';

function scheduler() {
  const frames = new Set<() => void>(),
    work = new Set<() => void>(),
    all: (() => void)[] = [];
  let time = 0;
  const enqueue = (queue: Set<() => void>, callback: () => void) => {
    queue.add(callback);
    all.push(callback);
    return () => {
      queue.delete(callback);
    };
  };
  const adapter: LayeredToolScheduler = {
    frame: (callback) => enqueue(frames, callback),
    work: (callback) => enqueue(work, callback),
    now: () => time++,
  };
  const flush = (queue: Set<() => void>) => {
    const callbacks = [...queue];
    queue.clear();
    callbacks.forEach((callback) => callback());
  };
  return {
    adapter,
    frames,
    work,
    all,
    frame: () => flush(frames),
    query: () => flush(work),
    drain: () => {
      for (let i = 0; i < 100 && work.size; i++) flush(work);
    },
  };
}
const path = [
  { x: 300, y: -20 },
  { x: 300, y: 140 },
  { x: -20, y: 140 },
];

test('many batches share one preview frame, selection waits for up and final samples are retained', () => {
  const controller = makeLayeredController([
    layeredRect('a'),
    { ...layeredRect('b'), transform: { a: 1, b: 0, c: 0, d: 1, tx: 150, ty: 0 } },
  ]);
  controller.setTool('lasso');
  const clock = scheduler(),
    session = createLayeredToolSession(controller, () => 'unused', { scheduler: clock.adapter });
  const document = controller.getSnapshot('document'),
    history = controller.getSnapshot('history');
  const preview = jest.fn();
  controller.subscribe('preview', preview);
  session.begin({ x: -20, y: -20 });
  for (const point of path) session.update([point]);
  expect(clock.frames.size).toBe(1);
  expect(preview).not.toHaveBeenCalled();
  clock.frame();
  expect(preview).toHaveBeenCalledTimes(1);
  expect(controller.getSnapshot('preview').path).toHaveLength(5);
  clock.drain();
  expect(controller.getSnapshot('selection')).toEqual([]);
  session.update([{ x: -20, y: -20 }]);
  session.end();
  expect(controller.getSnapshot('selection')).toEqual(['a', 'b']);
  expect(controller.getSnapshot('tools').activeTool).toBe('selection');
  expect(controller.getSnapshot('document')).toBe(document);
  expect(controller.getSnapshot('history')).toBe(history);
  for (const callback of clock.all) callback();
  expect(controller.getSnapshot('preview').path).toEqual([]);
  expect(controller.getSnapshot('selection')).toEqual(['a', 'b']);
  session.destroy();
});

test('end before a frame computes the complete final path without an undo transaction', () => {
  const controller = makeLayeredController([layeredRect()]);
  controller.setTool('lasso');
  const clock = scheduler(),
    session = createLayeredToolSession(controller, () => 'unused', { scheduler: clock.adapter });
  session.begin({ x: -20, y: -20 });
  session.update(path);
  session.end();
  expect(controller.getSnapshot('selection')).toEqual(['rect']);
  expect(clock.frames.size + clock.work.size).toBe(0);
  expect(controller.getSnapshot('history').canUndo).toBe(false);
  session.destroy();
});

test('the unpainted last batch changes the final hit set', () => {
  const objects = [
    layeredRect('a'),
    { ...layeredRect('b'), transform: { a: 1, b: 0, c: 0, d: 1, tx: 200, ty: 0 } },
  ];
  const run = (appendLast: boolean) => {
    const controller = makeLayeredController(objects);
    controller.setTool('lasso');
    const clock = scheduler();
    const session = createLayeredToolSession(controller, () => 'unused', {
      scheduler: clock.adapter,
    });
    session.begin({ x: -20, y: -20 });
    session.update([
      { x: 120, y: -20 },
      { x: 120, y: 140 },
    ]);
    clock.frame();
    if (appendLast) session.update([{ x: 300, y: 140 }]);
    session.end();
    const selected = controller.getSnapshot('selection');
    session.destroy();
    return selected;
  };
  expect(run(false)).toEqual(['a']);
  expect(run(true)).toEqual(['a', 'b']);
});

test.each(['cancel', 'tool', 'document', 'destroy'] as const)(
  '%s invalidates all queued callbacks and cannot overwrite a new gesture',
  (mode) => {
    const controller = makeLayeredController([
      layeredRect('a'),
      { ...layeredRect('b'), transform: { a: 1, b: 0, c: 0, d: 1, tx: 150, ty: 0 } },
    ]);
    controller.setTool('lasso');
    controller.setSelection(['a']);
    const clock = scheduler(),
      session = createLayeredToolSession(controller, () => 'unused', { scheduler: clock.adapter });
    session.begin({ x: -20, y: -20 });
    session.update(path);
    clock.drain();
    expect(controller.getSnapshot('selection')).toEqual(['a']);
    session.update([{ x: -20, y: -20 }]);
    const oldCallbacks = [...clock.all];
    if (mode === 'cancel') session.cancel();
    if (mode === 'tool') controller.setTool('line');
    if (mode === 'document')
      controller.editObjects({ expectedDocumentRevision: 0, removeIds: ['a'] });
    if (mode === 'destroy') session.destroy();
    expect(controller.getSnapshot('selection')).toEqual(mode === 'document' ? [] : ['a']);
    controller.setTool('lasso');
    controller.setSelection(['b']);
    if (mode !== 'destroy') session.begin({ x: 500, y: 500 });
    for (const callback of oldCallbacks) callback();
    expect(controller.getSnapshot('selection')).toEqual(['b']);
    expect(controller.getSnapshot('preview').hiddenIds).toEqual([]);
    session.destroy();
  }
);

test('equivalent selection results already suppress notifications', () => {
  const controller = makeLayeredController([layeredRect()]);
  const listener = jest.fn();
  controller.subscribe('selection', listener);
  controller.setSelection(['rect']);
  controller.setSelection(['rect', 'rect']);
  controller.setSelection(['rect']);
  expect(listener).toHaveBeenCalledTimes(1);
});

test('selection membership follows edits, undo and redo and rejects missing IDs atomically', () => {
  const controller = makeLayeredController([layeredRect('a'), layeredRect('b')]);
  controller.setSelection(['b', 'a', 'b']);
  expect(controller.getSnapshot('selection')).toEqual(['b', 'a']);
  expect(
    controller.editObjects({
      expectedDocumentRevision: 0,
      removeIds: ['a'],
      upsert: [layeredRect('c')],
    }).ok
  ).toBe(true);
  expect(controller.setSelection(['c', 'b', 'c']).ok).toBe(true);
  expect(controller.getSnapshot('selection')).toEqual(['c', 'b']);
  expect(controller.setSelection(['b', 'a']).ok).toBe(false);
  expect(controller.getSnapshot('selection')).toEqual(['c', 'b']);
  expect(controller.undo().ok).toBe(true);
  expect(controller.setSelection(['a', 'b']).ok).toBe(true);
  expect(controller.setSelection(['a', 'c']).ok).toBe(false);
  expect(controller.getSnapshot('selection')).toEqual(['a', 'b']);
  expect(controller.redo().ok).toBe(true);
  expect(controller.setSelection(['a']).ok).toBe(false);
  expect(controller.setSelection([]).ok).toBe(true);
  expect(controller.getSnapshot('selection')).toEqual([]);
});

test.each([true, false])(
  'sampling performs no geometry work (scheduled=%s), release queries exactly once',
  (scheduled) => {
    const controller = makeLayeredController(
      Array.from({ length: 20 }, (_, i) => layeredRect(`r${i}`))
    );
    controller.setTool('lasso');
    const clock = scheduler();
    const events: LassoPerformanceEvent[] = [];
    const prepare = jest.spyOn(objectQuery, 'prepareLayeredObjectQuery');
    const query = jest.spyOn(objectQuery, 'createLayeredLassoQuery');
    const selection = jest.fn();
    controller.subscribe('selection', selection);
    const session = createLayeredToolSession(controller, () => 'unused', {
      ...(scheduled ? { scheduler: clock.adapter } : {}),
      onPerf: (event) => events.push(event),
    });
    try {
      session.begin({ x: -20, y: -20 });
      for (const point of path) {
        session.update([point]);
        clock.frame();
        clock.drain();
      }
      expect(prepare).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
      expect(selection).not.toHaveBeenCalled();
      expect(clock.work.size).toBe(0);
      session.update([{ x: -20, y: -20 }]);
      const latest = events.at(-1)!;
      session.end();
      session.end();
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledTimes(1);
      expect(selection).toHaveBeenCalledTimes(1);
      for (const event of ['query-start', 'query-complete', 'selection-submit']) {
        expect(events.filter((e) => e.event === event)).toEqual([
          expect.objectContaining({
            event,
            session: latest.session,
            version: latest.version,
            pointCount: 6,
            final: true,
          }),
        ]);
      }
      expect(controller.getSnapshot('selection')).toHaveLength(20);
      for (const callback of clock.all) callback();
      expect(controller.getSnapshot('preview').path).toEqual([]);
    } finally {
      session.destroy();
      prepare.mockRestore();
      query.mockRestore();
    }
  }
);

test.each(['cancel', 'tool', 'document', 'destroy'] as const)(
  '%s during final evaluation cannot publish a stale result',
  (mode) => {
    const controller = makeLayeredController([layeredRect()]);
    controller.setTool('lasso');
    const session = createLayeredToolSession(controller, () => 'unused', {
      onPerf: (event) => {
        if (event.event !== 'query-complete') return;
        if (mode === 'cancel') session.cancel();
        if (mode === 'tool') controller.setTool('line');
        if (mode === 'document')
          controller.editObjects({ expectedDocumentRevision: 0, removeIds: ['rect'] });
        if (mode === 'destroy') session.destroy();
      },
    });
    session.begin({ x: -20, y: -20 });
    session.update(path);
    session.end();
    expect(controller.getSnapshot('selection')).toEqual([]);
    expect(controller.getSnapshot('preview').path).toEqual([]);
    expect(controller.getSnapshot('tools').activeTool).toBe(mode === 'tool' ? 'line' : 'lasso');
    session.destroy();
  }
);

test('a failing test performance observer cannot alter editing or cancellation', () => {
  const controller = makeLayeredController([layeredRect()]);
  controller.setTool('lasso');
  const session = createLayeredToolSession(controller, () => 'unused', {
    onPerf: () => {
      throw new Error('observer');
    },
  });
  session.begin({ x: -20, y: -20 });
  session.update(path);
  session.end();
  expect(controller.getSnapshot('selection')).toEqual(['rect']);
  session.destroy();
});
