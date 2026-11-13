import * as objectQuery from '../../core/layeredObjectQuery';
import {
  createLayeredToolSession,
  type LayeredToolScheduler,
  type LassoPerformanceEvent,
} from '../../core/layeredToolSession';
import { layeredRect, makeLayeredController } from '../fixtures/layered';

function scheduler(withIdle = false) {
  const frames = new Set<() => void>(),
    work = new Set<() => void>(),
    all: (() => void)[] = [];
  const idle = new Set<() => void>();
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
    ...(withIdle
      ? { idle: (callback: (budget: number) => void) => enqueue(idle, () => callback(4)) }
      : {}),
  };
  const flush = (queue: Set<() => void>) => {
    const callbacks = [...queue];
    queue.clear();
    callbacks.forEach((callback) => callback());
  };
  return {
    adapter,
    idle,
    idleTick: () => flush(idle),
    idleDrain: () => {
      for (let i = 0; i < 200 && idle.size; i++) flush(idle);
    },
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
  clock.frame();
  clock.drain();
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
  expect(controller.getSnapshot('preview').lassoPending).toBe(true);
  expect(clock.frames.size).toBe(0);
  expect(clock.work.size).toBe(1);
  clock.frame();
  clock.drain();
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
    clock.frame();
    clock.drain();
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
    const prepare = jest.spyOn(objectQuery, 'createControllerObjectQuery');
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
      expect(controller.getSnapshot('preview').lassoPending).toBe(scheduled ? true : undefined);
      expect(query).toHaveBeenCalledTimes(scheduled ? 0 : 1);
      if (scheduled) {
        clock.frame();
        clock.drain();
      }
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

test.each(['cancel', 'tool', 'document', 'destroy', 'new-gesture'] as const)(
  '%s while final work is pending keeps the retained path and invalidates late work',
  (mode) => {
    const controller = makeLayeredController(
      Array.from({ length: 30 }, (_, i) => layeredRect(`r${i}`))
    );
    controller.setTool('lasso');
    controller.setSelection(['r0']);
    const clock = scheduler();
    const session = createLayeredToolSession(controller, () => 'unused', {
      scheduler: clock.adapter,
    });
    session.begin({ x: -20, y: -20 });
    session.update(path);
    session.end();
    expect(controller.getSnapshot('selection')).toEqual(['r0']);
    expect(controller.getSnapshot('preview').lassoPending).toBe(true);
    expect(controller.getSnapshot('preview').path.length).toBeGreaterThan(3);
    clock.frame();
    clock.query(); // partial preparation; result is still pending
    expect(clock.work.size).toBe(1);
    const late = [...clock.all];
    if (mode === 'cancel') session.cancel();
    if (mode === 'tool') controller.setTool('line');
    if (mode === 'document')
      controller.editObjects({ expectedDocumentRevision: 0, removeIds: ['r0'] });
    if (mode === 'destroy') session.destroy();
    const began = mode === 'new-gesture' ? session.begin({ x: 500, y: 500 }) : true;
    expect(began).toBe(true);
    late.forEach((callback) => callback());
    clock.frame();
    clock.drain();
    expect(controller.getSnapshot('selection')).toEqual(mode === 'document' ? [] : ['r0']);
    expect(controller.getSnapshot('preview').lassoPending).toBeUndefined();
    session.destroy();
  }
);

test('idle warmup is bounded, prepares current geometry without editing, and first real drag does no work', () => {
  const controller = makeLayeredController([layeredRect()]);
  controller.setTool('lasso');
  const clock = scheduler(true),
    events: LassoPerformanceEvent[] = [];
  const session = createLayeredToolSession(controller, () => 'unused', {
    scheduler: clock.adapter,
    onPerf: (e) => events.push(e),
  });
  const document = controller.getSnapshot('document'),
    history = controller.getSnapshot('history');
  expect(clock.idle.size).toBe(1);
  clock.idleDrain();
  expect(events.some((e) => e.phase === 'warmup-index' && e.complete)).toBe(true);
  expect(controller.getSnapshot('document')).toBe(document);
  expect(controller.getSnapshot('history')).toBe(history);
  expect(controller.getSnapshot('selection')).toEqual([]);
  expect(controller.getSnapshot('preview').path).toEqual([]);
  const prepare = jest.spyOn(objectQuery, 'createControllerObjectQuery');
  const query = jest.spyOn(objectQuery, 'createLayeredLassoQuery');
  session.begin({ x: -20, y: -20 });
  session.update(path);
  clock.frame();
  clock.idleDrain();
  clock.drain();
  expect(prepare).not.toHaveBeenCalled();
  expect(query).not.toHaveBeenCalled();
  session.end();
  clock.frame();
  clock.drain();
  expect(prepare).not.toHaveBeenCalled();
  expect(query).toHaveBeenCalledTimes(1);
  expect(controller.getSnapshot('selection')).toEqual(['rect']);
  prepare.mockRestore();
  query.mockRestore();
  session.destroy();
});

test.each(['input', 'document', 'destroy'] as const)(
  '%s invalidates queued idle callbacks',
  (mode) => {
    const controller = makeLayeredController([layeredRect()]);
    controller.setTool('lasso');
    const clock = scheduler(true),
      session = createLayeredToolSession(controller, () => 'unused', { scheduler: clock.adapter });
    const old = [...clock.all];
    if (mode === 'input') session.begin({ x: -20, y: -20 });
    if (mode === 'document')
      controller.editObjects({ expectedDocumentRevision: 0, removeIds: ['rect'] });
    if (mode === 'destroy') session.destroy();
    const prepare = jest.spyOn(objectQuery, 'createControllerObjectQuery');
    old.forEach((callback) => callback());
    expect(prepare).not.toHaveBeenCalled();
    expect(controller.getSnapshot('selection')).toEqual([]);
    if (mode === 'input') {
      session.update(path);
      session.end();
      clock.frame();
      clock.drain();
    }
    if (mode === 'document') clock.idleDrain();
    expect(controller.getSnapshot('document').objects.length).toBe(mode === 'document' ? 0 : 1);
    prepare.mockRestore();
    session.destroy();
  }
);

test('release resumes partial idle preparation without restarting or sharing its cursor', () => {
  const controller = makeLayeredController(
    Array.from({ length: 30 }, (_, i) => layeredRect(`r${i}`))
  );
  controller.setTool('lasso');
  const clock = scheduler(true);
  const prepare = jest.spyOn(objectQuery, 'createControllerObjectQuery');
  const events: LassoPerformanceEvent[] = [];
  const session = createLayeredToolSession(controller, () => 'unused', {
    scheduler: clock.adapter,
    onPerf: (e) => events.push(e),
  });
  try {
    for (let i = 0; i < 200 && !events.some((e) => e.phase === 'warmup-prepare'); i++)
      clock.idleTick();
    expect(events.find((e) => e.phase === 'warmup-prepare')?.complete).toBe(false);
    expect(prepare).toHaveBeenCalledTimes(1);
    const late = [...clock.all];
    session.begin({ x: -20, y: -20 });
    session.update(path);
    session.end();
    late.forEach((callback) => callback());
    clock.frame();
    clock.drain();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot('selection')).toHaveLength(30);
    expect(controller.getSnapshot('preview').path).toEqual([]);
  } finally {
    prepare.mockRestore();
    session.destroy();
  }
});
