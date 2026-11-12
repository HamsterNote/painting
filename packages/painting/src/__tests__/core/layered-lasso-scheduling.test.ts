import { createLayeredToolSession, type LayeredToolScheduler } from '../../core/layeredToolSession';
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
