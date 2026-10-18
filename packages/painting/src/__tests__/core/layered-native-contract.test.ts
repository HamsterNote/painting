import type {
  NativeSemanticMessage,
  NativeRawCommit,
  WebSemanticReply,
} from '../../input/native/layeredSemanticContract';
import { createLayeredToolSession } from '../../core/layeredToolSession';
import { commitLayeredStroke, layeredRect, makeLayeredController } from '../fixtures/layered';

test('mock semantic pan stays under Web authority and is dropped during collecting', () => {
  const controller = makeLayeredController();
  const message: NativeSemanticMessage = {
    type: 'viewport-intent',
    command: {
      type: 'replace',
      expectedRevision: 0,
      viewport: { scale: 2, tx: 20, ty: 30 },
    },
  };
  expect(controller.updateViewport(message.command).ok).toBe(true);
  controller.beginFreehand({
    type: 'begin',
    commitId: 'native',
    pressureCapability: 'available',
    batch: {
      sessionId: 'native',
      pointerId: 1,
      source: 'native',
      coordinateSpace: 'world',
      viewportRevision: 1,
      batchSequence: 0,
      samples: [{ x: 0, y: 0, sequence: 0, phase: 'down', time: 0 }],
    },
  });
  const result = controller.updateViewport({ ...message.command, expectedRevision: 1 });
  expect(result.ok && result.value).toEqual({ applied: false, reason: 'active-freehand' });
  const reply: WebSemanticReply = {
    type: 'viewport',
    revision: 1,
    ...controller.getSnapshot('viewport').viewport,
  };
  expect(reply).toEqual({ type: 'viewport', revision: 1, scale: 2, tx: 20, ty: 30 });
});

test('raw batch uses accepted samples and stable commitId; no predicted/outline fields', () => {
  const controller = makeLayeredController();
  commitLayeredStroke(controller, 'batch');
  const object = controller.getSnapshot('document').objects[0]!;
  if (object.kind !== 'freehand') throw new Error('expected ink');
  const batch: NativeRawCommit = {
    type: 'raw-commit',
    commitId: object.commitId,
    sessionId: 'batch',
    lockedViewportRevision: 0,
    brushSnapshot: object.brushSnapshot,
    resolvedPressureMode: object.resolvedPressureMode,
    coordinateSpace: 'world',
    acceptedSamples: object.samples,
  };
  expect(Object.keys(batch).sort()).toEqual([
    'acceptedSamples',
    'brushSnapshot',
    'commitId',
    'coordinateSpace',
    'lockedViewportRevision',
    'resolvedPressureMode',
    'sessionId',
    'type',
  ]);
  expect(controller.commitFreehand(batch.commitId).ok).toBe(true);
  expect(controller.getSnapshot('document').objects).toHaveLength(1);
  controller.undo();
  expect(controller.getSnapshot('document').objects).toHaveLength(0);
});

test('mock tool trajectory preserves intermediate swept geometry without DOM events', () => {
  const controller = makeLayeredController([layeredRect()]);
  controller.setTool('eraser');
  const engine = createLayeredToolSession(controller, () => 'unused');
  const message: NativeSemanticMessage = {
    type: 'tool-trajectory',
    sessionId: 'erase',
    phase: 'update',
    viewportRevision: 0,
    tool: 'eraser',
    points: [
      { x: -50, y: 50 },
      { x: 150, y: 50 },
    ],
  };
  engine.begin(message.points[0]);
  engine.update(message.points.slice(1));
  expect(controller.getSnapshot('preview').hiddenIds).toEqual(['rect']);
  engine.cancel();
  expect(controller.getSnapshot('document').objects).toHaveLength(1);
  engine.destroy();
});
