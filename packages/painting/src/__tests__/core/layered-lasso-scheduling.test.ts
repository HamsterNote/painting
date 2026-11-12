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

test('many batches share one preview frame, live results arrive before up and final samples are retained', () => {
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
  expect(controller.getSnapshot('selection')).toEqual(['a', 'b']);
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
    expect(controller.getSnapshot('selection')).toEqual(['a', 'b']);
    session.update([{ x: -20, y: -20 }]);
    const oldCallbacks = [...clock.all];
    if (mode === 'cancel') session.cancel();
    if (mode === 'tool') controller.setTool('line');
    if (mode === 'document')
      controller.editObjects({ expectedDocumentRevision: 0, removeIds: ['a'] });
    if (mode === 'destroy') session.destroy();
    expect(controller.getSnapshot('selection')).toEqual(mode === 'document' ? ['b'] : ['a']);
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

test('performance events retain the query input prefix while newer batches arrive', () => {
  const controller = makeLayeredController(
    Array.from({ length: 20 }, (_, i) => layeredRect(`r${i}`))
  );
  controller.setTool('lasso');
  const clock = scheduler();
  const events: LassoPerformanceEvent[] = [];
  const session = createLayeredToolSession(controller, () => 'unused', {
    scheduler: clock.adapter,
    onPerf: (event) => events.push(event),
  });
  session.begin({ x: -20, y: -20 });
  session.update(path);
  clock.query(); // This query is still in flight.
  const started = events.find((e) => e.event === 'query-start')!;
  session.update([{ x: -20, y: -20 }]);
  expect(events.filter((e) => e.event === 'input').at(-1)!.version).toBeGreaterThan(
    started.version
  );
  clock.drain();
  const completed = events.find((e) => e.event === 'query-complete' && e.ok)!;
  const submitted = events.find((e) => e.event === 'selection-submit')!;
  expect(completed).toMatchObject({
    version: started.version,
    pointCount: started.pointCount,
    final: false,
  });
  expect(submitted).toMatchObject({
    version: started.version,
    pointCount: started.pointCount,
    final: false,
  });
  expect(events.filter((e) => e.event === 'selection-submit').length).toBeGreaterThan(1);
  session.end();
  expect(events.at(-1)).toMatchObject({ event: 'selection-submit', final: true, pointCount: 6 });
  expect(controller.getSnapshot('selection')).toHaveLength(20);
  session.destroy();
});

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
